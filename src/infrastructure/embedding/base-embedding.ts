/**
 * Base class for embedding implementations.
 */
export abstract class BaseEmbedding {
  /**
   * Generate embedding for the given text.
   * @param texts The input texts to embed.
   * @returns The embedding as an array of numbers.
   */
  abstract embed(texts: string | string[]): Promise<number[][]>;
}
