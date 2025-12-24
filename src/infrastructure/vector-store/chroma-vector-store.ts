import { Document } from '@infrastructure/file-handlers';
import { ChromaClient, Collection } from 'chromadb';

/**
 * Represents an item to be upserted into the ChromaDB collection.
 */
export interface UpsertItem {
  /** The unique identifier for the item. */
  id: string;
  /** The embedding vector for the item. */
  embedding?: number[];
  /** The text content of the item. */
  text: string;
  /** Optional metadata associated with the item. */
  metadata?: Record<string, any>;
}

/**
 * Represents a search result from the ChromaDB collection.
 */
export interface SearchResult extends Document {
  /** The similarity score of the search result. */
  score: number;
}

/**
 * ChromaVectorStore provides methods to interact with a ChromaDB vector store.
 * @example
 * const vectorStore = new ChromaVectorStore('localhost', 8000, 'my_collection');
 * await vectorStore.upsert(items);
 * const results = await vectorStore.search(queryVector, 5);
 * @see https://chroma.com/docs/ for more information on ChromaDB.
 */
export class ChromaVectorStore {
  private readonly chromaClient: ChromaClient;
  private readonly cache = new Map<string, Collection>();

  constructor(host: string, port: number, private collectionName: string) {
    this.chromaClient = new ChromaClient({ host, port });
  }

  /**
   * Upserts multiple items into the ChromaDB collection.
   * @param items The items to upsert.
   */
  async upsert(items: UpsertItem[]): Promise<void> {
    const collection = await this.getCollection();

    await collection.upsert({
      ids: items.map((item) => item.id),
      embeddings: items.map((item) => item.embedding || []),
      documents: items.map((item) => item.text),
      metadatas: items.map((item) => item.metadata || {}),
    });
  }

  /**
   * Searches the ChromaDB collection for the most similar items to the given query vector.
   * @param queryVector The query embedding vector.
   * @param topK The number of top similar items to retrieve.
   * @returns {SearchResult[]} An array of search results with id, text, metadata, and score.
   */
  async search(queryVector: number[], topK: number): Promise<SearchResult[]> {
    const collection = await this.getCollection();

    const results = await collection.query({
      queryEmbeddings: [queryVector],
      nResults: topK,
    });

    const out = results.documents[0].map((doc, idx) => ({
      id: results.ids[0][idx],
      content: doc || '',
      metadata: results.metadatas[0][idx] || {},
      score: results.distances[0][idx] || 0,
    }));

    return out;
  }

  /**
   * Retrieves the ChromaDB collection, utilizing caching for performance.
   * @returns The ChromaDB collection.
   */
  private async getCollection(): Promise<Collection> {
    if (this.cache.has(this.collectionName)) {
      return this.cache.get(this.collectionName)!;
    }

    try {
      const collection = await this.chromaClient.getOrCreateCollection({ name: this.collectionName });
      this.cache.set(this.collectionName, collection);
      return collection;
    } catch (error) {
      console.error('Error getting or creating collection:', error);
      throw error;
    }
  }
}
