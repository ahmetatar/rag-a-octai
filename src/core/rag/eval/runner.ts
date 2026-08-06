import { promises as fs } from 'fs';
import path from 'path';
import config from '@app/config';
import { logger } from '@infrastructure/logging';
import { RecursiveChunker } from '../chunkers';
import { createEmbedding } from '../embedding';
import { FileInfo, resolveFileHandler } from '../file-handlers';
import { RagDataIngestor } from '../ingestion';
import { OllamaLangModelRunner } from '../llm';
import { Reranker } from '../reranking';
import { ChromaVectorStore, SearchResult, VectorStore } from '../vector-store';
import { hitAtK, isAbstention, keywordCoverage, mean, precisionAtK, recallAtK, reciprocalRank } from './metrics';
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
  /** Minimum retrieval/reranking score, matching the production query pipeline. */
  threshold: number;
  /** Tenant to tag/scope the eval corpus under. */
  tenantId: string;
  /** When true, generate answers and score keyword coverage (needs a working LLM). */
  generateAnswers: boolean;
  /** Optional reranker; when set, candidates are reranked before the top-K is scored. */
  reranker?: Reranker;
  /** Candidates to fetch before reranking down to topK (only used with a reranker). */
  fetchK?: number;
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

  const results: EvalCaseResult[] = [];
  for (const evalCase of cases) {
    results.push(await scoreCase(evalCase, options, embedding, store, langModel));
  }

  return { k: options.topK, generatedAnswers: options.generateAnswers, cases: results, aggregate: aggregateEvalResults(results) };
}

/**
 * Ingests every corpus file into the eval collection.
 * @param options The run configuration.
 * @param embedding The shared embedding model.
 * @param store The eval vector store.
 */
async function ingestCorpus(options: RunEvalOptions, embedding: Awaited<ReturnType<typeof createEmbedding>>, store: VectorStore): Promise<void> {
  const chunker = new RecursiveChunker({ chunkSize: config.chunkSize, overlap: config.chunkOverlap, unit: config.chunkUnit });
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
  embedding: Awaited<ReturnType<typeof createEmbedding>>,
  store: VectorStore,
  langModel?: OllamaLangModelRunner
): Promise<EvalCaseResult> {
  const [queryVector] = await embedding.embed([evalCase.question]);
  // Mirror the orchestrator: with a reranker, fetch a wider pool, rerank, then cut to topK.
  const fetchK = options.reranker ? Math.max(options.topK, options.fetchK ?? options.topK) : options.topK;
  const candidates = await store.search(queryVector, fetchK, options.tenantId);
  // Keep this ordering and threshold behaviour aligned with RagOrchestrator.query.
  const results = (await rerankCandidates(evalCase.question, candidates, options.reranker))
    .slice(0, options.topK)
    .filter((result) => result.score >= options.threshold);
  const retrievedSources = results.map((result) => String(result.metadata?.source ?? ''));
  const expectedAnswerable = evalCase.expectedAnswerable ?? evalCase.expectedSources.length > 0;

  const result: EvalCaseResult = {
    id: evalCase.id,
    question: evalCase.question,
    expectedAnswerable,
    retrievedSources,
    precisionAtK: precisionAtK(retrievedSources, evalCase.expectedSources, options.topK),
    recallAtK: recallAtK(retrievedSources, evalCase.expectedSources, options.topK),
    reciprocalRank: reciprocalRank(retrievedSources, evalCase.expectedSources),
    hit: hitAtK(retrievedSources, evalCase.expectedSources, options.topK),
  };

  if (!expectedAnswerable) {
    result.falseRetrieval = results.length > 0 ? 1 : 0;
  }

  if (langModel) {
    try {
      const answer = await langModel.generateResponse({ question: evalCase.question, sources: results, maxTokens: config.maxTokens });
      result.answer = answer;
      if (expectedAnswerable) {
        result.keywordCoverage = keywordCoverage(answer, evalCase.expectedKeywords ?? []);
      }
      if (!expectedAnswerable && (evalCase.expectedRefusal ?? true)) {
        result.abstained = isAbstention(answer) ? 1 : 0;
        result.falseAnswer = result.abstained ? 0 : 1;
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
 * Aggregates per-case results into means. Keyword coverage is averaged only over cases that
 * produced an answer.
 * @param results The per-case results.
 * @returns The aggregate scores.
 */
export function aggregateEvalResults(results: EvalCaseResult[]): EvalAggregate {
  const answerable = results.filter((result) => result.expectedAnswerable);
  const unanswerable = results.filter((result) => !result.expectedAnswerable);
  const withCoverage = answerable.filter((result) => result.keywordCoverage !== undefined);
  const withAbstention = unanswerable.filter((result) => result.abstained !== undefined);

  return {
    answerableCases: answerable.length,
    unanswerableCases: unanswerable.length,
    precisionAtK: mean(answerable.map((result) => result.precisionAtK)),
    recallAtK: mean(answerable.map((result) => result.recallAtK)),
    mrr: mean(answerable.map((result) => result.reciprocalRank)),
    hitRate: mean(answerable.map((result) => result.hit)),
    keywordCoverage: withCoverage.length ? mean(withCoverage.map((result) => result.keywordCoverage!)) : undefined,
    falseRetrievalRate: unanswerable.length
      ? mean(unanswerable.map((result) => result.falseRetrieval ?? 0))
      : undefined,
    abstentionAccuracy: withAbstention.length
      ? mean(withAbstention.map((result) => result.abstained!))
      : undefined,
    falseAnswerRate: withAbstention.length
      ? mean(withAbstention.map((result) => result.falseAnswer!))
      : undefined,
  };
}
