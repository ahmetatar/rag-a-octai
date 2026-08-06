import config from '@app/config';
import { ChromaVectorStore, SearchResult, VectorStore } from './vector-store';
import { BaseEmbedding, createEmbedding } from './embedding';
import { isAbstention, LangModelBase, OllamaLangModelRunner, presentAnswer, PromptContext } from './llm';
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

  return new RagOrchestrator(langModel, embedding, store, reranker);
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
    private readonly reranker?: Reranker
  ) {}

  /**
   * Handles a query by retrieving documents and generating a response
   * @param query The input query string
   * @param topK The number of top documents to retrieve
   * @param threshold Optional MINIMUM similarity score a document must reach to be used
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
    //1. Embed the query
    const queryEmbedding = await this.embedding.embed([query]);
    //2. Search the vector store, restricted to the tenant's own documents. With a reranker,
    //   fetch a wider candidate pool so it has more to choose from before we cut to top-K.
    const fetchK = this.reranker ? Math.max(topK, config.rerankFetchK) : topK;
    const candidates = await this.store.search(queryEmbedding[0], fetchK, tenantId);

    //3. Rerank the candidates (cross-encoder) and keep the best top-K, or use vector order.
    const results = (await this.rerank(query, candidates)).slice(0, topK);

    //4. (Optional) Keep only the documents that are relevant ENOUGH to the query
    const minScore = threshold ?? 0;
    const filteredResults = results.filter((result) => result.score >= minScore);

    logger.info(
      `Retrieved ${candidates.length} candidate(s), reranked=${Boolean(this.reranker)}, ` +
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
    const rawResponse = await this.langModel.generateResponse(promptContext);
    const abstained = isAbstention(rawResponse);

    // An abstention cites nothing: returning sources next to "I could not find an answer"
    // would invite a caller to treat them as supporting evidence for an answer that was
    // never given.
    return {
      response: presentAnswer(rawResponse),
      sources: abstained ? [] : filteredResults.map(toRagSource),
      abstained,
    };
  }

  /**
   * Reranks candidates with the cross-encoder, replacing each result's score with the
   * reranker's relevance score and sorting by it. Returns candidates unchanged (already in
   * similarity order) when no reranker is configured or if reranking fails — a reranker
   * problem should degrade to plain vector search, not fail the query.
   *
   * @param query The user query.
   * @param candidates The vector-search candidates.
   * @returns The results ordered best-first.
   */
  private async rerank(query: string, candidates: SearchResult[]): Promise<SearchResult[]> {
    if (!this.reranker || candidates.length === 0) {
      return candidates;
    }

    try {
      const scores = await this.reranker.rank(query, candidates.map((candidate) => candidate.content));

      return candidates
        .map((candidate, index) => ({ ...candidate, score: scores[index] ?? 0 }))
        .sort((a, b) => b.score - a.score);
    } catch (error) {
      logger.warn(`Reranking failed, falling back to vector order: ${error instanceof Error ? error.message : error}`);
      return candidates;
    }
  }
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
