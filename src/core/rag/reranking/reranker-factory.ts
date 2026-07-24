import config from '@app/config';
import { logger } from '@infrastructure/logging';
import { LlamaReranker } from './llama-reranker';
import { Reranker } from './reranker';

/**
 * Builds the reranker, or returns undefined when reranking is disabled.
 *
 * Reranking is opt-in (RERANK_ENABLED + RERANK_MODEL_PATH): without a reranker model the
 * app still works, using vector-search order directly. Returning undefined — rather than a
 * no-op reranker — lets the orchestrator skip the extra candidate fetch entirely when off.
 *
 * @returns A reranker, or undefined when reranking is disabled or misconfigured.
 */
export async function createReranker(): Promise<Reranker | undefined> {
  if (!config.rerankEnabled) {
    return undefined;
  }

  if (!config.rerankModelPath) {
    logger.warn('RERANK_ENABLED is true but RERANK_MODEL_PATH is empty; reranking is off.');
    return undefined;
  }

  return LlamaReranker.create(config.rerankModelPath);
}
