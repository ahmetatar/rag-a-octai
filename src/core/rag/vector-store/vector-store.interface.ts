import { Document } from '../file-handlers';

/**
 * Represents an item to be upserted into the vector store.
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
 * Represents a search result from the vector store.
 */
export interface SearchResult extends Document {
  /** The similarity score of the search result; a HIGHER value means a closer match. */
  score: number;
  /** The raw distance reported by the store; a LOWER value means a closer match. */
  distance: number;
}

/**
 * A distinct source document held in the store, with how many chunks it was split into.
 */
export interface SourceSummary {
  /** The `source` metadata value identifying the document (its original file name). */
  source: string;
  /** How many chunks this source is stored as. */
  chunks: number;
}

/**
 * The store-agnostic contract the RAG pipeline depends on for vector persistence and
 * retrieval. Concrete backends (currently {@link ChromaVectorStore}; a managed backend such
 * as pgvector/Qdrant/Weaviate could be added — see docs/adr/0001) implement this, so the
 * orchestrator, ingestor and document endpoints depend on the interface, never a specific DB.
 *
 * Every read/write is scoped by an optional `tenantId`, the one filter every backend can
 * honour uniformly; richer, backend-specific metadata filtering is deliberately kept out of
 * this contract to keep it portable.
 */
export interface VectorStore {
  /**
   * Upserts items into the store, in batches.
   * @param items The items to upsert.
   * @param batchSize Maximum number of items per request.
   */
  upsert(items: UpsertItem[], batchSize?: number): Promise<void>;

  /**
   * Returns the top-K most similar items to a query vector, best match first.
   * @param queryVector The query embedding.
   * @param topK How many results to return.
   * @param tenantId Optional tenant to restrict the search to.
   */
  search(queryVector: number[], topK: number, tenantId?: string): Promise<SearchResult[]>;

  /**
   * Deletes every item belonging to a source document.
   * @param source The `source` metadata value identifying the document.
   * @param tenantId Optional tenant to scope the deletion to.
   */
  deleteBySource(source: string, tenantId?: string): Promise<void>;

  /**
   * Lists the distinct source documents held for a tenant, with each one's chunk count.
   * @param tenantId Optional tenant to scope the listing to.
   */
  listSources(tenantId?: string): Promise<SourceSummary[]>;
}
