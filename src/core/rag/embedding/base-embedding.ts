/**
 * Base class for embedding implementations.
 */
export abstract class BaseEmbedding {
  /**
   * Generate embedding for the given text.
   *
   * Implementations MUST return one vector per input text, in the SAME order as the
   * input. Callers pair vectors with their source text by index, so any reordering
   * attaches the wrong vector to the wrong text.
   *
   * @param texts The input texts to embed.
   * @returns The embeddings, ordered to match `texts`.
   */
  abstract embed(texts: string | string[]): Promise<number[][]>;
}
