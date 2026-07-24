import config from '@app/config';
import { logger } from '@infrastructure/logging';
import { lazySingleton } from '@infrastructure/async';
import { BaseEmbedding } from './base-embedding';
import { GeminiEmbedding } from './gemini-embedding';
import { LlamaTextEmbedder } from './llama-embedding';
import { OllamaEmbedding } from './ollama-embedding';

/**
 * Embedding providers supported by the application.
 */
export type EmbeddingProvider = 'ollama' | 'llama' | 'gemini';

const PROVIDERS: readonly string[] = ['ollama', 'llama', 'gemini'];

/**
 * Returns the embedding instance shared by ingestion and querying.
 *
 * Documents and queries MUST be embedded by the same model: their vectors are
 * compared inside the same collection, so a different provider or model means a
 * different vector space (and usually a different dimension) and retrieval
 * silently returns nonsense. This factory is the single place that decides which
 * model is used, and the instance is cached so the model is loaded only once.
 *
 * @returns A promise that resolves to the shared embedding instance.
 */
export const createEmbedding = lazySingleton<BaseEmbedding>(buildEmbedding);

/**
 * Clears the cached embedding instance. Intended for tests.
 */
export function resetEmbedding(): void {
  createEmbedding.reset();
}

/**
 * Builds the embedding instance configured by `EMBEDDING_PROVIDER`.
 * @returns A promise that resolves to the configured embedding instance.
 * @throws Error if the provider is unknown or its required settings are missing.
 */
async function buildEmbedding(): Promise<BaseEmbedding> {
  const provider = config.embeddingProvider;

  if (!PROVIDERS.includes(provider)) {
    throw new Error(`Unknown EMBEDDING_PROVIDER "${provider}". Supported providers: ${PROVIDERS.join(', ')}.`);
  }

  switch (provider as EmbeddingProvider) {
    case 'ollama': {
      const model = requireSetting(config.embeddingModel, 'EMBEDDING_MODEL', provider);
      logger.info(`Embedding provider: ollama (model: ${model}, host: ${config.ollamaHost})`);
      return new OllamaEmbedding(model, config.ollamaHost);
    }
    case 'llama': {
      const modelPath = requireSetting(config.embeddingModelPath, 'EMBEDDING_MODEL_PATH', provider);
      logger.info(`Embedding provider: llama (model path: ${modelPath})`);
      return LlamaTextEmbedder.create(modelPath);
    }
    case 'gemini': {
      const model = requireSetting(config.embeddingModel, 'EMBEDDING_MODEL', provider);
      const apiKey = requireSetting(config.geminiApiKey, 'GEMINI_API_KEY', provider);
      logger.info(`Embedding provider: gemini (model: ${model})`);
      return new GeminiEmbedding(model, apiKey);
    }
  }
}

/**
 * Asserts that a required configuration value is present.
 * @param value The configured value.
 * @param name The environment variable that provides it.
 * @param provider The provider that requires it.
 * @returns The value, guaranteed to be non-empty.
 * @throws Error if the value is empty.
 */
function requireSetting(value: string, name: string, provider: string): string {
  if (!value) {
    throw new Error(`${name} is required when EMBEDDING_PROVIDER is "${provider}".`);
  }

  return value;
}
