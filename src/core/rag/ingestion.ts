import {
  BaseEmbedding,
  ChromaVectorStore,
  Chunker,
  Document,
  FileHandlerContext,
  FileInfo,
  HandlerResolveParameters,
  OllamaEmbedding,
  RecursiveChunker,
  UpsertItem,
} from '@infrastructure/index';
import config from '@app/config';

/**
 * Factory function to create a RagDataIngestor instance.
 * @returns {RagDataIngestor} A new instance of RagDataIngestor.
 */
export function createRagDataIngestor(): RagDataIngestor {
  const chunker = new RecursiveChunker({ chunkSize: config.chunkSize, overlap: config.chunkOverlap });
  const fileHandlerContext = new FileHandlerContext();
  const embedding = new OllamaEmbedding(config.embeddingModel, config.ollamaHost);
  const store = new ChromaVectorStore(config.chromaHost, config.chromaPort, config.chromaCollection);

  return new RagDataIngestor(chunker, fileHandlerContext, embedding, store);
}

/**
 * Represents a RAG (Retrieval-Augmented Generation) pipeline.
 * Handles the ingestion of files, text chunking, embedding generation, and storage in a vector store.
 * @class
 * @property {Chunker} chunker - The chunker used to split text into smaller chunks.
 * @property {FileHandlerContext} fileHandlerContext - The context for handling different file types.
 * @property {BaseEmbedding} embedding - The embedding model used to generate vector representations.
 * @property {ChromaVectorStore} store - The vector store for storing embeddings and associated metadata.
 * @example
 * const ragDataIngestor = new RagDataIngestor(chunker, fileHandlerContext, embedding, store);
 * await ragDataIngestor.ingest(files);
 */
export class RagDataIngestor {
  constructor(
    private readonly chunker: Chunker,
    private readonly fileHandlerContext: FileHandlerContext,
    private readonly embedding: BaseEmbedding,
    private readonly store: ChromaVectorStore
  ) {}

  /**
   * Ingests an array of files into the RAG pipeline.
   * @param files The array of files to ingest.
   * @returns A promise that resolves when ingestion is complete.
   */
  async ingest(files: FileInfo[], params?: HandlerResolveParameters) {
    const allChunks: Document[] = [];

    if (files.length === 0) {
      throw new Error('No files provided for ingestion');
    }

    for (const file of files) {
      // 1. Set the appropriate file handler based on the file's MIME type
      this.fileHandlerContext.setFileHandler(file.mimetype, params);
      // 2. Process the file to extract text
      const result = await this.fileHandlerContext.handleFile(file);
      // 3. Chunk the extracted text
      const docs = Array.isArray(result) ? result : [result];
      
      for (const doc of docs) {
        const chunks = await this.chunker.chunk(doc.content, {
          source: file.originalname,
          mimeType: file.mimetype,
          ...doc.metadata,
        });
        allChunks.push(...chunks);
      }
    }
    // 4. Generate embeddings for all chunks
    const embeddings = await this.embedding.embed(allChunks.map((chunk) => chunk.content));
    // 5. Prepare documents for storage
    const upsertItems = allChunks.map<UpsertItem>((chunk, index) => ({
      id: chunk.id || '',
      text: chunk.content,
      metadata: chunk.metadata || {},
      embedding: embeddings[index],
    }));
    // 6. Upsert documents into the vector store
    await this.store.upsert(upsertItems);
  }
}
