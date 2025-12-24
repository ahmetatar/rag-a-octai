import { ChromaClient, Collection } from 'chromadb';

/**
 * Represents an item to be upserted into the ChromaDB collection.
 */
export interface UpsertItem {
  id: string;
  embedding: number[];
  text: string;
  metadata?: Record<string, any>;
}

/**
 * ChromaVectorStore provides methods to interact with a ChromaDB vector store.
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
      embeddings: items.map((item) => item.embedding),
      documents: items.map((item) => item.text),
      metadatas: items.map((item) => item.metadata || {}),
    });
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
