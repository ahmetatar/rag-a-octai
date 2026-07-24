import config from '@app/config';
import { ChromaVectorStore, SearchResult } from './vector-store';
import { BaseEmbedding, createEmbedding } from './embedding';
import { LangModelBase, OllamaLangModelRunner, PromptContext } from './llm';
import { logger } from '@infrastructure/logging';

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
}

/**
 * Factory function to create an instance of RagOrchestrator
 * @returns {Promise<RagOrchestrator>} A promise that resolves to an instance of RagOrchestrator
 */
export async function createRagOrchestrator(): Promise<RagOrchestrator> {
  const embedding = await createEmbedding();
  const store = new ChromaVectorStore(config.chromaHost, config.chromaPort, config.chromaCollection);
  const langModel = new OllamaLangModelRunner(config.generationModel, config.ollamaHost);

  return new RagOrchestrator(langModel, embedding, store);
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
    private readonly store: ChromaVectorStore
  ) {}

  /**
   * Handles a query by retrieving documents and generating a response
   * @param query The input query string
   * @param topK The number of top documents to retrieve
   * @param threshold Optional MINIMUM similarity score a document must reach to be used
   * @param maxTokens Optional maximum number of tokens for the response
   * @returns The generated answer together with the sources it was based on
   */
  async query(query: string, topK: number, threshold?: number, maxTokens?: number): Promise<RagAnswer> {
    //1. Embed the query
    const queryEmbedding = await this.embedding.embed([query]);
    //2. Search the vector store
    const results = await this.store.search(queryEmbedding[0], topK);
    //3. (Optional) Keep only the documents that are similar ENOUGH to the query
    const minScore = threshold ?? 0;
    const filteredResults = results.filter((result) => result.score >= minScore);

    logger.info(
      `Retrieved ${results.length} chunk(s), ${filteredResults.length} at or above similarity ${minScore}` +
        `${results.length ? ` (best: ${results[0].score.toFixed(3)})` : ''}.`
    );

    //4. Generate response using the language model. With no sources the model is asked to
    //   say it cannot answer, which is more useful to a caller than an empty string.
    const promptContext: PromptContext = {
      question: query,
      sources: filteredResults,
      maxTokens: maxTokens ?? 512,
    };
    const response = await this.langModel.generateResponse(promptContext);

    return { response, sources: filteredResults.map(toRagSource) };
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
