import { v4 as uuidv4 } from 'uuid';
import { Document } from '../file-handlers';

/**
 * What `chunkSize`/`overlap` are measured in.
 *
 * `characters` is the historical default: cheap, but a poor proxy for what actually limits an
 * LLM — its context window is a TOKEN budget, and a character count over- or under-shoots that
 * budget depending on the script and vocabulary of the text. `tokens` measures chunk size the
 * same way the model's limit is expressed.
 */
export type ChunkUnit = 'characters' | 'tokens';

/**
 * Options for chunking text into smaller pieces.
 */
export interface ChunkingOptions {
  /** The maximum size of each chunk, in `unit`. */
  chunkSize: number;
  /** The amount of overlap between chunks, in `unit`. */
  overlap?: number;
  /** What `chunkSize`/`overlap` are measured in. Defaults to `characters`. */
  unit?: ChunkUnit;
}

/**
 * Abstract class representing a text chunker.
 */
export abstract class Chunker {
  /**
   * Chunks the given text based on the provided options.
   * @param text The text to be chunked.
   * @param metadata Optional metadata to associate with each chunk.
   * @returns An array of text chunks.
   */
  abstract chunk(text: string, metadata?: Record<string, any>): Document[] | Promise<Document[]>;

  /**
   * Creates a chunk with a unique ID and optional metadata.
   * @param text The text content of the chunk.
   * @param idPrefix The prefix for the chunk ID.
   * @param metadata Optional metadata for the chunk.
   * @returns The created chunk.
   */
  protected createChunk(content: string, metadata?: Record<string, any>): Document {
    return {
      id: `chunk-${uuidv4()}`,
      content,
      metadata,
    };
  }

  /**
   * Asserts that the chunk size is greater than the overlap.
   * @param chunkOptions The chunking options to validate.
   * @throws Error if overlap is greater than or equal to chunk size.
   */
  protected assertChunkSizeGreaterThanOverlap(chunkOptions: ChunkingOptions): void {
    if (chunkOptions.overlap !== undefined && chunkOptions.overlap >= chunkOptions.chunkSize) {
      throw new Error('Overlap must be smaller than chunk size.');
    }
  }
}
