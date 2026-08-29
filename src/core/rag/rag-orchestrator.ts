import config from '@app/config';
import { ChromaVectorStore, SearchResult, VectorStore } from './vector-store';
import { BaseEmbedding, createEmbedding } from './embedding';
import { isAbstention, LangModelBase, OllamaLangModelRunner, presentAnswer, PromptContext } from './llm';
import { createQueryExpander, IdentityQueryExpander, QueryExpander } from './query';
import { createReranker, Reranker } from './reranking';
import { logger } from '@infrastructure/logging';
import { observeRetrievalTopScore } from '@infrastructure/observability';

/** How many characters of a retrieved chunk are echoed back as a citation excerpt. */
const EXCERPT_LENGTH = 240;

/**
 * A retrieved chunk that contributed to an answer, in a shape safe to return to clients.
 */
export interface RagSource {
  /** The chunk id in the vector store. */
  id?: string;
  /** The name of the file the chunk came from, when known. */
  source?: string;
  /** The page the chunk came from, for paginated documents. */
  page?: number;
  /** The similarity score of the chunk; a HIGHER value means a closer match. */
  score: number;
  /** The beginning of the chunk, so the answer can be traced back to the text. */
  excerpt: string;
}

/**
 * Which scoring stage produced the `score` on a {@link RagSource}.
 *
 * `cosine` is embedding-space similarity in [-1, 1]; `reranker` is a cross-encoder relevance
 * probability in [0, 1]. They are not comparable, so a caller that stores or thresholds a
 * score needs to know which one it has.
 */
export type ScoreScale = 'cosine' | 'reranker';

/**
 * The result of a RAG query: the generated answer plus the chunks it was based on.
 */
export interface RagAnswer {
  /** The generated answer. */
  response: string;
  /** The chunks handed to the language model, ordered from the closest match. */
  sources: RagSource[];
  /**
   * True when the model declined to answer because the retrieved context did not contain the
   * answer. A caller should treat this as "no answer found" rather than as an answer — it is
   * the difference between a grounded miss and an ungrounded guess.
   */
  abstained: boolean;
  /**
   * The scale the `score` on each source is on. Reranking degrades to vector order on
   * failure, so this reports what actually happened rather than what was configured.
   */
  scoreScale: ScoreScale;
  /** The minimum score a chunk had to reach, on that scale. */
  threshold: number;
}

/**
 * Factory function to create an instance of RagOrchestrator
 * @returns {Promise<RagOrchestrator>} A promise that resolves to an instance of RagOrchestrator
 */
export async function createRagOrchestrator(): Promise<RagOrchestrator> {
  const embedding = await createEmbedding();
  const store = new ChromaVectorStore(config.chromaHost, config.chromaPort, config.chromaCollection);
  const langModel = new OllamaLangModelRunner(config.generationModel, config.ollamaHost);
  const reranker = await createReranker();
  const queryExpander = createQueryExpander();

  return new RagOrchestrator(langModel, embedding, store, reranker, queryExpander);
}

/**
 * RagOrchestrator class to manage the RAG process
 * Combines embedding, vector store, and language model to handle queries
 * @class
 * @example
 * const ragOrchestrator = new RagOrchestrator(langModel, embedding, store);
 * const response = await ragOrchestrator.query('What is RAG?', 5, 0.4, 512);
 */
export class RagOrchestrator {
  constructor(
    private readonly langModel: LangModelBase,
    private readonly embedding: BaseEmbedding,
    private readonly store: VectorStore,
    private readonly reranker?: Reranker,
    private readonly queryExpander: QueryExpander = new IdentityQueryExpander()
  ) {}

  /**
   * Handles a query by retrieving documents and generating a response
   * @param query The input query string
   * @param topK The number of top documents to retrieve
   * @param threshold Optional MINIMUM score a document must reach to be used. Left undefined,
   * the scale-appropriate configured default is used — see {@link ScoreScale}.
   * @param maxTokens Optional maximum number of tokens for the response
   * @param tenantId Optional tenant whose documents the search is restricted to
   * @returns The generated answer together with the sources it was based on
   */
  async query(
    query: string,
    topK: number,
    threshold?: number,
    maxTokens?: number,
    tenantId?: string
  ): Promise<RagAnswer> {
    //1. Expand the query into the text(s) to actually search with (identity by default — see
    //   QueryExpander), then embed all of them in one batch.
    const expansion = await this.queryExpander.expand(query);
    const searchVectors = await this.embedding.embed(expansion.searchTexts);
    //2. Search the vector store once per search text, restricted to the tenant's own
    //   documents, then merge into one candidate list (best score per chunk id) — so
    //   everything downstream sees the same shape of candidate list regardless of how many
    //   searches ran. With a reranker, fetch a wider pool per search so it has more to choose
    //   from before we cut to top-K.
    const fetchK = this.reranker ? Math.max(topK, config.rerankFetchK) : topK;
    const resultsPerSearch = await Promise.all(searchVectors.map((vector) => this.store.search(vector, fetchK, tenantId)));
    const candidates = mergeSearchResults(resultsPerSearch, fetchK);

    //3. Rerank the candidates (cross-encoder) and keep the best top-K, or use vector order.
    const reranked = await this.rerank(query, candidates);
    const results = reranked.results.slice(0, topK);

    //4. Keep only the documents that are relevant ENOUGH to the query, on the scale the
    //   scores are actually on. `reranked.scale` reports what ran, not what was configured:
    //   reranking degrades to vector order on failure, and applying the cross-encoder's
    //   threshold to cosine scores would then silently change how strict the filter is.
    const scoreScale = reranked.scale;
    const minScore = threshold ?? defaultThresholdFor(scoreScale);
    const filteredResults = results.filter((result) => result.score >= minScore);

    logger.info(
      `Retrieved ${candidates.length} candidate(s), scale=${scoreScale}, ` +
        `${filteredResults.length}/${results.length} kept at or above score ${minScore}` +
        `${results.length ? ` (best: ${results[0].score.toFixed(3)})` : ''}.`
    );

    // Record the best retrieved score so retrieval-quality drift is visible in metrics.
    if (results.length) {
      observeRetrievalTopScore(results[0].score);
    }

    //4. Generate response using the language model. With no sources the model is asked to
    //   say it cannot answer, which is more useful to a caller than an empty string.
    const promptContext: PromptContext = {
      question: query,
      sources: filteredResults,
      maxTokens: maxTokens ?? 512,
    };
    const { text: rawResponse } = await this.langModel.generateResponse(promptContext);
    const abstained = isAbstention(rawResponse);

    // An abstention cites nothing: returning sources next to "I could not find an answer"
    // would invite a caller to treat them as supporting evidence for an answer that was
    // never given.
    return {
      response: presentAnswer(rawResponse),
      sources: abstained ? [] : filteredResults.map(toRagSource),
      abstained,
      scoreScale,
      threshold: minScore,
    };
  }

  /**
   * Reranks candidates with the cross-encoder, replacing each result's score with the
   * reranker's relevance score and sorting by it. Returns candidates unchanged (already in
   * similarity order) when no reranker is configured or if reranking fails — a reranker
   * problem should degrade to plain vector search, not fail the query.
   *
   * Reports the scale the returned scores are on, because the caller thresholds them and the
   * two scales are not interchangeable. It has to be what happened, not what was configured:
   * a reranker that throws leaves cosine scores behind.
   *
   * @param query The user query.
   * @param candidates The vector-search candidates.
   * @returns The results ordered best-first, and the scale their scores are on.
   */
  private async rerank(query: string, candidates: SearchResult[]): Promise<RerankOutcome> {
    if (!this.reranker || candidates.length === 0) {
      return { results: candidates, scale: 'cosine' };
    }

    try {
      const scores = await this.reranker.rank(query, candidates.map((candidate) => candidate.content));

      return {
        results: candidates
          .map((candidate, index) => ({ ...candidate, score: scores[index] ?? 0 }))
          .sort((a, b) => b.score - a.score),
        scale: 'reranker',
      };
    } catch (error) {
      logger.warn(`Reranking failed, falling back to vector order: ${error instanceof Error ? error.message : error}`);
      return { results: candidates, scale: 'cosine' };
    }
  }
}

/**
 * What reranking produced: the ordered results and the scale their scores are on.
 */
interface RerankOutcome {
  results: SearchResult[];
  scale: ScoreScale;
}

/**
 * The configured threshold for a score scale.
 * @param scale The scale the scores being filtered are on.
 */
export function defaultThresholdFor(scale: ScoreScale): number {
  return scale === 'reranker' ? config.rerankThreshold : config.retrievalThreshold;
}

/**
 * Merges the result sets from one or more searches (one per query-expansion search text) into
 * a single candidate list: the same chunk found by two different searches keeps its BEST
 * score rather than appearing twice, and the merged list is capped at `limit` so a
 * multi-search expansion never hands the reranker (or the threshold) a larger candidate pool
 * than a single search would have — cost stays bounded regardless of how many search texts
 * the expander produced.
 *
 * Exported so the eval harness can merge the same way production does (see
 * `eval/runner.ts:scoreCase`) — the eval mirrors the query pipeline rather than reimplementing
 * it, so its numbers describe the pipeline that actually runs.
 *
 * @param resultsPerSearch One result array per search text, each already in best-first order.
 * @param limit Maximum candidates to return.
 * @returns The merged, deduplicated, best-first candidate list.
 */
export function mergeSearchResults(resultsPerSearch: SearchResult[][], limit: number): SearchResult[] {
  if (resultsPerSearch.length === 1) {
    return resultsPerSearch[0];
  }

  const bestById = new Map<string, SearchResult>();
  for (const results of resultsPerSearch) {
    for (const result of results) {
      // Every stored chunk has an id; content is a fallback key for the (untyped) case a
      // store implementation omits one, so a merge never accidentally drops a real result.
      const key = result.id ?? result.content;
      const existing = bestById.get(key);
      if (!existing || result.score > existing.score) {
        bestById.set(key, result);
      }
    }
  }

  return Array.from(bestById.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Projects a search result onto the citation shape returned to clients.
 * Only the fields a caller can act on are exposed; the full chunk text stays server-side.
 * @param result The search result to project.
 * @returns The citation for the retrieved chunk.
 */
function toRagSource(result: SearchResult): RagSource {
  const metadata = result.metadata ?? {};

  return {
    id: result.id,
    source: typeof metadata.source === 'string' ? metadata.source : undefined,
    page: typeof metadata.page === 'number' ? metadata.page : undefined,
    score: Number(result.score.toFixed(4)),
    excerpt: result.content.slice(0, EXCERPT_LENGTH),
  };
}
