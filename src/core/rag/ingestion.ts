import config from '@app/config';
import { Chunker, RecursiveChunker } from './chunkers';
import { Document, FileHandlerResolver, FileInfo, HandlerResolveParameters, resolveFileHandler } from './file-handlers';
import { BaseEmbedding, createEmbedding } from './embedding';
import { ChromaVectorStore, UpsertItem } from './vector-store';
import { logger } from '@infrastructure/logging';

/**
 * Factory function to create a RagDataIngestor instance.
 * @returns {RagDataIngestor} A new instance of RagDataIngestor.
 */
export async function createRagDataIngestor(): Promise<RagDataIngestor> {
  const chunker = new RecursiveChunker({ chunkSize: config.chunkSize, overlap: config.chunkOverlap });
  const embedding = await createEmbedding();
  const store = new ChromaVectorStore(config.chromaHost, config.chromaPort, config.chromaCollection);

  return new RagDataIngestor(chunker, resolveFileHandler, embedding, store, config.embeddingBatchSize);
}

/**
 * Represents a RAG (Retrieval-Augmented Generation) pipeline.
 * Handles the ingestion of files, text chunking, embedding generation, and storage in a vector store.
 * @class
 * @property {Chunker} chunker - The chunker used to split text into smaller chunks.
 * @property {FileHandlerResolver} resolveHandler - Resolves the handler for a file's MIME type.
 * @property {BaseEmbedding} embedding - The embedding model used to generate vector representations.
 * @property {ChromaVectorStore} store - The vector store for storing embeddings and associated metadata.
 * @example
 * const ragDataIngestor = new RagDataIngestor(chunker, resolveFileHandler, embedding, store);
 * await ragDataIngestor.ingest(files);
 */
export class RagDataIngestor {
  constructor(
    private readonly chunker: Chunker,
    private readonly resolveHandler: FileHandlerResolver,
    private readonly embedding: BaseEmbedding,
    private readonly store: ChromaVectorStore,
    private readonly embeddingBatchSize = 64
  ) {}

  /**
   * Ingests an array of files into the RAG pipeline.
   *
   * Ingestion is idempotent per source: a document's existing chunks are deleted before
   * its new ones are stored, so re-uploading the same file replaces its content instead of
   * piling up duplicate vectors. Embeddings are generated in batches to bound memory use
   * and request size on large documents.
   *
   * @param files The array of files to ingest.
   * @param params Parameters passed to factory-registered file handlers.
   * @param tenantId Tenant the documents belong to; tagged on every chunk and used to scope
   * the delete-then-upsert so tenants stay isolated.
   * @returns A promise that resolves when ingestion is complete.
   */
  async ingest(files: FileInfo[], params?: HandlerResolveParameters, tenantId?: string) {
    if (!files || files.length === 0) {
      throw new Error('No files provided for ingestion');
    }

    const allChunks = await this.buildChunks(files, params, tenantId);

    if (allChunks.length === 0) {
      logger.warn('Ingestion produced no chunks; nothing to store.');
      return;
    }

    // Replace each source's existing chunks. Done for every source before any upsert so
    // that re-uploading a file within the same request cannot delete what it just stored.
    const sources = new Set(allChunks.map((chunk) => String(chunk.metadata?.source ?? '')));
    for (const source of sources) {
      if (source) {
        await this.store.deleteBySource(source, tenantId);
      }
    }

    const embeddings = await this.embedInBatches(allChunks.map((chunk) => chunk.content));
    // Chunks and embeddings are paired by index below, so a length mismatch means every
    // pair after the gap is wrong. Fail loudly instead of storing corrupted vectors.
    if (embeddings.length !== allChunks.length) {
      throw new Error(
        `Embedding count mismatch: got ${embeddings.length} embeddings for ${allChunks.length} chunks.`
      );
    }

    const upsertItems = allChunks.map<UpsertItem>((chunk, index) => ({
      id: chunk.id || '',
      text: chunk.content,
      metadata: chunk.metadata || {},
      embedding: embeddings[index],
    }));

    await this.store.upsert(upsertItems);
    logger.info(`Ingested ${upsertItems.length} chunk(s) from ${sources.size} source(s).`);
  }

  /**
   * Extracts and chunks every file, tagging each chunk with its source and a deterministic
   * id.
   *
   * Chunk ids are `${source}#${index}` rather than random: with a stable id, re-ingesting a
   * document overwrites its own chunks instead of creating new rows, and identical uploads
   * converge instead of accumulating.
   *
   * @param files The files to process.
   * @param params Parameters passed to factory-registered file handlers.
   * @param tenantId Tenant tagged on every chunk's metadata for later isolation.
   * @returns The chunks from all files, in order.
   */
  private async buildChunks(
    files: FileInfo[],
    params?: HandlerResolveParameters,
    tenantId?: string
  ): Promise<Document[]> {
    const allChunks: Document[] = [];
    // Chunk indices run per source so ids stay stable regardless of upload order.
    const indexBySource = new Map<string, number>();

    for (const file of files) {
      // Resolve a handler for this file's MIME type (fresh per file, no shared state).
      const handler = this.resolveHandler(file.mimetype, params);
      const result = await handler.handleFile(file);
      const docs = Array.isArray(result) ? result : [result];

      for (const doc of docs) {
        const chunks = await this.chunker.chunk(doc.content, {
          source: file.originalname,
          mimeType: file.mimetype,
          ...(tenantId ? { tenantId } : {}),
          ...doc.metadata,
        });

        for (const chunk of chunks) {
          const nextIndex = indexBySource.get(file.originalname) ?? 0;
          indexBySource.set(file.originalname, nextIndex + 1);
          chunk.id = `${file.originalname}#${nextIndex}`;
          allChunks.push(chunk);
        }
      }
    }

    return allChunks;
  }

  /**
   * Embeds texts in batches, preserving input order.
   * @param texts The texts to embed.
   * @returns One vector per text, in the same order.
   */
  private async embedInBatches(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];

    for (let start = 0; start < texts.length; start += this.embeddingBatchSize) {
      const batch = texts.slice(start, start + this.embeddingBatchSize);
      vectors.push(...(await this.embedding.embed(batch)));
    }

    return vectors;
  }
}
