import { Document } from '../file-handlers';
import { ChromaClient, Collection, Where } from 'chromadb';
import { logger } from '@infrastructure/logging';

/**
 * Vector spaces supported by ChromaDB.
 */
export type VectorSpace = 'cosine' | 'l2' | 'ip';

/**
 * Converts a ChromaDB distance into a similarity score.
 *
 * ChromaDB reports a DISTANCE, where a lower value means a closer match. Callers
 * filter with a "minimum relevance" threshold, which needs the opposite scale,
 * so the distance is inverted here once instead of at every call site.
 *
 * @param distance The distance reported by ChromaDB.
 * @param space The vector space the collection was created with.
 * @returns A similarity score where a higher value means a closer match.
 * `cosine` and `ip` yield scores in [-1, 1]; `l2` yields scores in (0, 1].
 */
export function toSimilarity(distance: number, space: VectorSpace): number {
  switch (space) {
    // Chroma reports `1 - cosine_similarity` and `1 - inner_product`.
    case 'cosine':
    case 'ip':
      return 1 - distance;
    // Squared euclidean distance is unbounded, so map it onto (0, 1] instead.
    case 'l2':
      return 1 / (1 + distance);
  }
}

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
  /** The similarity score of the search result; a HIGHER value means a closer match. */
  score: number;
  /** The raw distance reported by ChromaDB; a LOWER value means a closer match. */
  distance: number;
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

  constructor(
    host: string,
    port: number,
    private collectionName: string,
    private readonly space: VectorSpace = 'cosine'
  ) {
    this.chromaClient = new ChromaClient({ host, port });
  }

  /**
   * Upserts multiple items into the ChromaDB collection, in batches.
   *
   * A single upsert of every chunk sends all vectors in one request, which is a large
   * payload for a big document. Batching bounds each request's size.
   *
   * @param items The items to upsert.
   * @param batchSize Maximum number of items per upsert request.
   */
  async upsert(items: UpsertItem[], batchSize = 128): Promise<void> {
    if (items.length === 0) {
      return;
    }

    const collection = await this.getCollection();

    for (let start = 0; start < items.length; start += batchSize) {
      const batch = items.slice(start, start + batchSize);

      await collection.upsert({
        ids: batch.map((item) => item.id),
        embeddings: batch.map((item) => item.embedding || []),
        documents: batch.map((item) => item.text),
        metadatas: batch.map((item) => item.metadata || {}),
      });
    }
  }

  /**
   * Deletes every vector belonging to a given source document.
   *
   * Re-ingesting a document would otherwise pile a fresh copy of its chunks on top of the
   * old ones (chunk ids used to be random), so retrieval returned duplicates. Deleting by
   * source first makes ingestion idempotent, and correctly drops now-stale chunks when a
   * re-ingested document produces fewer of them.
   *
   * @param source The `source` metadata value identifying the document.
   * @param tenantId Optional tenant to scope the deletion to, so one tenant re-ingesting a
   * document cannot delete another tenant's document that happens to share a name.
   */
  async deleteBySource(source: string, tenantId?: string): Promise<void> {
    const collection = await this.getCollection();
    const where: Where = tenantId ? { $and: [{ source }, { tenantId }] } : { source };
    await collection.delete({ where });
  }

  /**
   * Searches the ChromaDB collection for the most similar items to the given query vector.
   * @param queryVector The query embedding vector.
   * @param topK The number of top similar items to retrieve.
   * @param where Optional metadata filter (e.g. `{ tenantId }`) constraining the search.
   * @returns {SearchResult[]} An array of search results with id, text, metadata, distance and
   * similarity score, ordered from the closest match to the furthest.
   */
  async search(queryVector: number[], topK: number, where?: Where): Promise<SearchResult[]> {
    const collection = await this.getCollection();

    const results = await collection.query({
      queryEmbeddings: [queryVector],
      nResults: topK,
      ...(where ? { where } : {}),
    });

    const out: SearchResult[] = [];

    results.ids[0].forEach((id, idx) => {
      const distance = results.distances[0]?.[idx];

      // Without a distance the result cannot be scored, so it cannot be ranked or
      // thresholded either. Dropping it is safer than scoring it as a perfect match.
      if (typeof distance !== 'number') {
        logger.warn(`Search result "${id}" came back without a distance and was skipped.`);
        return;
      }

      out.push({
        id,
        content: results.documents[0][idx] || '',
        metadata: results.metadatas[0][idx] || {},
        distance,
        score: toSimilarity(distance, this.space),
      });
    });

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
      const collection = await this.chromaClient.getOrCreateCollection({
        name: this.collectionName,
        configuration: { hnsw: { space: this.space } },
      });

      this.warnOnSpaceMismatch(collection);
      this.cache.set(this.collectionName, collection);
      return collection;
    } catch (error) {
      logger.error(`Error getting or creating collection "${this.collectionName}": ${error}`);
      throw error;
    }
  }

  /**
   * Warns when an existing collection uses a different vector space than the configured one.
   * The configuration passed to `getOrCreateCollection` only applies when the collection is
   * created, so a pre-existing collection keeps its original space and would be scored with
   * the wrong distance-to-similarity conversion.
   * @param collection The resolved ChromaDB collection.
   */
  private warnOnSpaceMismatch(collection: Collection): void {
    const actualSpace = collection.configuration?.hnsw?.space;

    if (actualSpace && actualSpace !== this.space) {
      logger.warn(
        `Collection "${this.collectionName}" was created with the "${actualSpace}" space but ` +
          `"${this.space}" is configured. Similarity scores will be wrong until the collection ` +
          `is deleted and re-ingested.`
      );
    }
  }
}
