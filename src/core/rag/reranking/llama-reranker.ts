import type { LlamaRankingContext } from 'node-llama-cpp';
import { Reranker } from './reranker';
import { logger } from '@infrastructure/logging';

/**
 * Cross-encoder reranker backed by a local GGUF model via node-llama-cpp.
 *
 * Reuses the same llama.cpp binding the app already uses for local embeddings, so no extra
 * runtime dependency is pulled in. Needs a reranker model (e.g. bge-reranker) in GGUF form.
 *
 * @see https://node-llama-cpp.withcat.ai/guide/embedding#reranking
 */
export class LlamaReranker extends Reranker {
  private constructor(private readonly rankingContext: LlamaRankingContext) {
    super();
  }

  /**
   * Loads the reranker model and creates a ranking context.
   * @param modelPath Path to the GGUF reranker model.
   * @returns A ready reranker.
   */
  static async create(modelPath: string): Promise<LlamaReranker> {
    const { getLlama, LlamaLogLevel } = await import('node-llama-cpp');

    const llama = await getLlama({ logLevel: LlamaLogLevel.error });
    const model = await llama.loadModel({ modelPath });
    const rankingContext = await model.createRankingContext();

    logger.info(`Reranker loaded from ${modelPath}`);
    return new LlamaReranker(rankingContext);
  }

  /** @inheritdoc */
  async rank(query: string, documents: string[]): Promise<number[]> {
    if (documents.length === 0) {
      return [];
    }

    // rankAll returns a probability in [0, 1] per document, aligned to the input order.
    return this.rankingContext.rankAll(query, documents);
  }

  /** @inheritdoc */
  async dispose(): Promise<void> {
    await this.rankingContext.dispose();
  }
}
