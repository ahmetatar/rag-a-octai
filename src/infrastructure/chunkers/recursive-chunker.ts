import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Chunker, ChunkingOptions } from './chunker';
import { Document } from '@infrastructure/file-handlers';

/**
 * A chunker that uses recursive character splitting to divide text into chunks.
 */
export class RecursiveChunker extends Chunker {
  private readonly options: ChunkingOptions;

  constructor(options: ChunkingOptions) {
    super();
    this.options = {
      chunkSize: options?.chunkSize,
      overlap: options?.overlap,
    };
  }

  /** @inheritdoc */
  async chunk(text: string, metadata?: Record<string, any>): Promise<Document[]> {
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: this.options.chunkSize,
      chunkOverlap: this.options.overlap ?? 0,
    });

    const chunks = await textSplitter.splitText(text);

    return chunks.map((chunk, index) =>
      this.createChunk(chunk, {
        ...metadata,
        chunk: index,
        totalChunks: chunks.length,
      })
    );
  }
}
