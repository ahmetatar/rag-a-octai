import { promises as fs } from 'fs';
import path from 'path';
import config from '@app/config';
import { logger } from '@infrastructure/logging';
import { RecursiveChunker } from '../chunkers';
import { createEmbedding } from '../embedding';
import { FileInfo, resolveFileHandler } from '../file-handlers';
import { RagDataIngestor } from '../ingestion';
import { isAbstention, OllamaLangModelRunner } from '../llm';
import { defaultThresholdFor, ScoreScale } from '../rag-orchestrator';
import { Reranker } from '../reranking';
import { ChromaVectorStore, SearchResult, VectorStore } from '../vector-store';
import {
  AbstentionOutcome,
  abstentionAccuracy,
  falseAnswerRate,
  falseRetrievalRate,
  groundedness,
  hitAtK,
  keywordCoverage,
  meanDefined,
  precisionAtK,
  recallAtK,
  reciprocalRank,
  snippetCoverage,
} from './metrics';
import { EvalAggregate, EvalCase, EvalCaseResult, EvalReport } from './types';

/**
 * Options for a single evaluation run.
 */
export interface RunEvalOptions {
  /** Directory of corpus files to ingest. */
  corpusDir: string;
  /** Path to the JSONL dataset of eval cases. */
  datasetPath: string;
  /** Collection to ingest into and query; kept separate from production data. */
  collection: string;
  /** Retrieval cut-off. */
  topK: number;
  /** Tenant to tag/scope the eval corpus under. */
  tenantId: string;
  /** When true, generate answers and score keyword coverage (needs a working LLM). */
  generateAnswers: boolean;
  /** Optional reranker; when set, candidates are reranked before the top-K is scored. */
  reranker?: Reranker;
  /** Candidates to fetch before reranking down to topK (only used with a reranker). */
  fetchK?: number;
  /**
   * Minimum score a chunk must reach to be kept, mirroring the orchestrator. Without it the
   * eval scores chunks production would have discarded, so its numbers describe a pipeline
   * that does not exist. Defaults to the configured threshold for whichever score scale the
   * run produces — cosine without a reranker, cross-encoder relevance with one.
   */
  threshold?: number;
}

/** Maps a file extension to a MIME type the handlers understand. */
const MIME_BY_EXTENSION: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/plain',
  '.pdf': 'application/pdf',
};

/**
 * Runs the evaluation: ingests the corpus, runs each case through retrieval (and optionally
 * generation), and returns a scored report.
 *
 * Retrieval metrics need only an embedding model and ChromaDB. Answer metrics additionally
 * need a reachable LLM; when generation fails the run still returns retrieval metrics.
 *
 * @param options The run configuration.
 * @returns The evaluation report.
 */
export async function runEval(options: RunEvalOptions): Promise<EvalReport> {
  const embedding = await createEmbedding();
  const store = new ChromaVectorStore(config.chromaHost, config.chromaPort, options.collection);

  await ingestCorpus(options, embedding, store);

  const cases = await loadDataset(options.datasetPath);
  const langModel = options.generateAnswers
    ? new OllamaLangModelRunner(config.generationModel, config.ollamaHost)
    : undefined;

  // The eval's scale is fixed for the whole run: unlike a live query, a reranker that is
  // configured here is loaded up front and either works for every case or fails the run.
  const scoreScale: ScoreScale = options.reranker ? 'reranker' : 'cosine';
  const threshold = options.threshold ?? defaultThresholdFor(scoreScale);
  const results: EvalCaseResult[] = [];
  for (const evalCase of cases) {
    results.push(await scoreCase(evalCase, options, threshold, embedding, store, langModel));
  }

  return {
    k: options.topK,
    threshold,
    scoreScale,
    generatedAnswers: options.generateAnswers,
    breakdown: {
      total: results.length,
      answerable: results.filter((result) => result.answerable).length,
      unanswerable: results.filter((result) => !result.answerable).length,
      byTag: countByTag(results),
    },
    cases: results,
    aggregate: aggregate(results),
    byTag: aggregateByTag(results),
  };
}

/**
 * Whether a case's answer exists in the corpus. Explicit `expectedAnswerable` wins; otherwise
 * a case with no expected sources is taken to be unanswerable.
 * @param evalCase The case.
 */
export function isAnswerable(evalCase: EvalCase): boolean {
  return evalCase.expectedAnswerable ?? evalCase.expectedSources.length > 0;
}

/**
 * Ingests every corpus file into the eval collection.
 * @param options The run configuration.
 * @param embedding The shared embedding model.
 * @param store The eval vector store.
 */
async function ingestCorpus(options: RunEvalOptions, embedding: Awaited<ReturnType<typeof createEmbedding>>, store: VectorStore): Promise<void> {
  const chunker = new RecursiveChunker({ chunkSize: config.chunkSize, overlap: config.chunkOverlap });
  const ingestor = new RagDataIngestor(chunker, resolveFileHandler, embedding, store, config.embeddingBatchSize);

  const entries = await fs.readdir(options.corpusDir);
  const files: FileInfo[] = [];

  for (const name of entries) {
    const mimetype = MIME_BY_EXTENSION[path.extname(name).toLowerCase()];
    if (!mimetype) {
      continue;
    }

    const buffer = await fs.readFile(path.join(options.corpusDir, name));
    files.push({ originalname: name, mimetype, size: buffer.length, encoding: '', buffer });
  }

  const summary = await ingestor.ingest(files, undefined, options.tenantId);
  logger.info(`Eval corpus ingested: ${summary.chunks} chunk(s) from ${summary.sources} source(s).`);
}

/**
 * Scores a single case: retrieves, computes retrieval metrics, and optionally generates an
 * answer and scores keyword coverage.
 */
async function scoreCase(
  evalCase: EvalCase,
  options: RunEvalOptions,
  threshold: number,
  embedding: Awaited<ReturnType<typeof createEmbedding>>,
  store: VectorStore,
  langModel?: OllamaLangModelRunner
): Promise<EvalCaseResult> {
  const answerable = isAnswerable(evalCase);
  const retrievalStart = performance.now();

  const [queryVector] = await embedding.embed([evalCase.question]);
  // Mirror the orchestrator: with a reranker, fetch a wider pool, rerank, then cut to topK.
  const fetchK = options.reranker ? Math.max(options.topK, options.fetchK ?? options.topK) : options.topK;
  const candidates = await store.search(queryVector, fetchK, options.tenantId);
  const ranked = (await rerankCandidates(evalCase.question, candidates, options.reranker)).slice(0, options.topK);
  // Same cut production applies, so the eval scores the chunks the model would really see.
  const results = ranked.filter((result) => result.score >= threshold);

  const retrievalMs = performance.now() - retrievalStart;
  const retrievedSources = results.map((result) => String(result.metadata?.source ?? ''));

  const result: EvalCaseResult = {
    id: evalCase.id,
    question: evalCase.question,
    answerable,
    tags: evalCase.tags,
    retrievedSources,
    retrievalMs,
  };

  // Passage-level retrieval: scored for every case, answerable or not. An unanswerable case
  // declares no snippets, so it simply stays undefined rather than needing a special branch.
  result.snippetCoverage = snippetCoverage(
    results.map((source) => source.content),
    evalCase.expectedSnippets ?? []
  );

  // Retrieval metrics need a relevant set to score against; an unanswerable case has none,
  // so it is left unscored here and counted by the false-retrieval rate instead.
  if (answerable) {
    result.precisionAtK = precisionAtK(retrievedSources, evalCase.expectedSources, options.topK);
    result.recallAtK = recallAtK(retrievedSources, evalCase.expectedSources, options.topK);
    result.reciprocalRank = reciprocalRank(retrievedSources, evalCase.expectedSources);
    result.hit = hitAtK(retrievedSources, evalCase.expectedSources, options.topK);
  }

  if (langModel) {
    try {
      const generationStart = performance.now();
      const answer = await langModel.generateResponse({ question: evalCase.question, sources: results, maxTokens: config.maxTokens });
      result.generationMs = performance.now() - generationStart;
      result.answer = answer;

      const abstained = isAbstention(answer);
      result.abstained = abstained;
      result.abstentionCorrect = abstained === !answerable;

      // Keyword coverage and groundedness describe the CONTENT of an answer. An abstention
      // has no content to score, and scoring it would punish a correct refusal for not
      // containing the keywords it was right to omit.
      if (!abstained) {
        result.keywordCoverage = keywordCoverage(answer, evalCase.expectedKeywords ?? []);
        result.groundedness = groundedness(answer, results.map((source) => source.content));
      }
    } catch (error) {
      logger.warn(`Generation failed for case ${evalCase.id}: ${error instanceof Error ? error.message : error}`);
    }
  }

  return result;
}

/**
 * Reranks candidates by relevance score when a reranker is provided; otherwise returns them
 * in vector-search order. Mirrors the orchestrator so eval scores what production would.
 * @param query The query.
 * @param candidates The vector-search candidates.
 * @param reranker Optional reranker.
 * @returns Candidates ordered best-first.
 */
async function rerankCandidates(query: string, candidates: SearchResult[], reranker?: Reranker): Promise<SearchResult[]> {
  if (!reranker || candidates.length === 0) {
    return candidates;
  }

  const scores = await reranker.rank(query, candidates.map((candidate) => candidate.content));
  return candidates
    .map((candidate, index) => ({ ...candidate, score: scores[index] ?? 0 }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Loads and parses a JSONL dataset of eval cases.
 * @param datasetPath Path to the .jsonl file.
 * @returns The parsed cases.
 */
export async function loadDataset(datasetPath: string): Promise<EvalCase[]> {
  const raw = await fs.readFile(datasetPath, 'utf-8');

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('//'))
    .map((line) => JSON.parse(line) as EvalCase);
}

/**
 * Aggregates per-case results. Every mean ignores cases where the metric is undefined, so
 * retrieval scores cover the answerable cases and answer scores cover the answered ones —
 * a case is never counted as a success at something it was never scored on.
 *
 * @param results The per-case results.
 * @returns The aggregate scores.
 */
function aggregate(results: EvalCaseResult[]): EvalAggregate {
  // Abstention is only meaningful for cases that actually produced an answer; a case whose
  // generation failed (or was disabled) has made no decision to judge.
  const outcomes: AbstentionOutcome[] = results
    .filter((result) => result.abstained !== undefined)
    .map((result) => ({
      answerable: result.answerable,
      abstained: result.abstained!,
      retrievedCount: result.retrievedSources.length,
    }));

  return {
    precisionAtK: meanDefined(results.map((result) => result.precisionAtK)),
    recallAtK: meanDefined(results.map((result) => result.recallAtK)),
    mrr: meanDefined(results.map((result) => result.reciprocalRank)),
    hitRate: meanDefined(results.map((result) => result.hit)),
    snippetCoverage: meanDefined(results.map((result) => result.snippetCoverage)),
    keywordCoverage: meanDefined(results.map((result) => result.keywordCoverage)),
    groundedness: meanDefined(results.map((result) => result.groundedness)),
    abstentionAccuracy: outcomes.length ? abstentionAccuracy(outcomes) : undefined,
    falseAnswerRate: outcomes.length ? falseAnswerRate(outcomes) : undefined,
    falseRetrievalRate: hasUnanswerable(results) ? falseRetrievalRate(retrievalOutcomes(results)) : undefined,
    retrievalMs: meanDefined(results.map((result) => result.retrievalMs)),
    generationMs: meanDefined(results.map((result) => result.generationMs)),
  };
}

/**
 * Counts how many cases carry each tag. A case with several tags counts once under each, so
 * the counts deliberately do not sum to the case total.
 * @param results The per-case results.
 */
function countByTag(results: EvalCaseResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const result of results) {
    for (const tag of result.tags ?? []) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }

  return counts;
}

/**
 * Aggregates the cases carrying each tag separately. The whole-set mean can stay flat while
 * one class of question — multi-source, distractors — regresses badly; this is what makes
 * that visible.
 *
 * @param results The per-case results.
 * @returns Tag name to the aggregate over the cases carrying it.
 */
function aggregateByTag(results: EvalCaseResult[]): Record<string, EvalAggregate> {
  const byTag: Record<string, EvalAggregate> = {};
  for (const tag of Object.keys(countByTag(results)).sort()) {
    byTag[tag] = aggregate(results.filter((result) => (result.tags ?? []).includes(tag)));
  }

  return byTag;
}

/** Whether the dataset contained any case the corpus cannot answer. */
function hasUnanswerable(results: EvalCaseResult[]): boolean {
  return results.some((result) => !result.answerable);
}

/**
 * Abstention outcomes for the false-RETRIEVAL rate, which is a retrieval-only measure and so
 * covers every case — including ones where generation was disabled or failed.
 * @param results The per-case results.
 */
function retrievalOutcomes(results: EvalCaseResult[]): AbstentionOutcome[] {
  return results.map((result) => ({
    answerable: result.answerable,
    abstained: result.abstained ?? false,
    retrievedCount: result.retrievedSources.length,
  }));
}
