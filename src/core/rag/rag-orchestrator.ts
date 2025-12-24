import config from '@app/config';
import { BaseEmbedding, OllamaEmbedding } from '@infrastructure/embedding';
import { LangModelBase, OllamaLangModel, PromptContext } from '@infrastructure/lang-models';
import { ChromaVectorStore } from '@infrastructure/vector-store';

/**
 * Factory function to create an instance of RagOrchestrator
 * @returns {RagOrchestrator} An instance of RagOrchestrator
 */
export function createRagOrchestrator(): RagOrchestrator {
  const embedding = new OllamaEmbedding(config.embeddingModel, config.ollamaHost);
  const store = new ChromaVectorStore(config.chromaHost, config.chromaPort, config.chromaCollection);
  const langModel = new OllamaLangModel(config.generationModel, config.ollamaHost);

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
   * @param threshold Optional score threshold to filter documents
   * @param maxTokens Optional maximum number of tokens for the response
   * @returns The generated response string
   */
  async query(query: string, topK: number, threshold?: number, maxTokens?: number): Promise<string> {
    //1. Embed the query
    const queryEmbedding = await this.embedding.embed([query]);
    //2. Search the vector store
    const results = await this.store.search(queryEmbedding[0], topK);
    //3. (Optional) Filter results based on threshold
    const filteredResults = results.filter((result) => result.score >= (threshold || 0));
    if (filteredResults.length === 0) {
      return '';
    }
    //4. Generate response using the language model
    const promptContext: PromptContext = {
      question: query,
      sources: filteredResults,
      maxTokens: maxTokens || 512,
    };
    const response = await this.langModel.generateResponse(promptContext);

    return response;
  }
}
