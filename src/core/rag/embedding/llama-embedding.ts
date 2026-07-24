import { LlamaEmbedding, LlamaEmbeddingContext } from 'node-llama-cpp';
import { BaseEmbedding } from './base-embedding';
import { logger } from '@infrastructure/logging';

/**
 * Llama embedding implementation.
 * Extends the BaseEmbedding class to provide Llama-specific embedding functionality.
 * Uses the node-llama-cpp library to interact with Llama models.
 * @extends BaseEmbedding
 */
export class LlamaTextEmbedder extends BaseEmbedding {
  private constructor(private embeddingContext: LlamaEmbeddingContext) {
    super();
  }

  /**
   * Create a new LlamaTextEmbedder instance.
   * @param modelPath The path to the Llama model.
   * @returns A promise that resolves to a LlamaTextEmbedder instance.
   */
  static async create(modelPath: string): Promise<LlamaTextEmbedder> {
    const { getLlama, LlamaLogLevel } = await import('node-llama-cpp');

    const llama = await getLlama({ logLevel: LlamaLogLevel.error });
    const model = await llama.loadModel({ modelPath });
    const embbeddingContext = await model.createEmbeddingContext();
    return new LlamaTextEmbedder(embbeddingContext);
  }

  /** @inheritdoc */
  async embed(texts: string | string[]): Promise<number[][]> {
    const textsArray = Array.isArray(texts) ? texts : [texts];

    // The result of Promise.all keeps the input order; collecting into a shared array
    // from inside the callbacks would order them by completion instead, which silently
    // pairs every text with another text's vector.
    const embeddings: LlamaEmbedding[] = await Promise.all(
      textsArray.map((text) => this.embeddingContext.getEmbeddingFor(text))
    );

    logger.info(`Generated ${embeddings.length} embeddings using Llama model.`);
    return embeddings.map((embedding) => Array.from(embedding.vector));
  }
}
