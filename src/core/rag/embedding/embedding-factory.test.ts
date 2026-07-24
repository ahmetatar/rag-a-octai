import { afterEach, describe, expect, it } from 'vitest';
import config from '@app/config';
import { createEmbedding, resetEmbedding } from './embedding-factory';
import { OllamaEmbedding } from './ollama-embedding';
import { GeminiEmbedding } from './gemini-embedding';

const originalConfig = { ...config };

afterEach(() => {
  Object.assign(config, originalConfig);
  resetEmbedding();
});

describe('createEmbedding', () => {
  it('builds the provider named by EMBEDDING_PROVIDER', async () => {
    config.embeddingProvider = 'ollama';
    config.embeddingModel = 'nomic-embed-text';

    await expect(createEmbedding()).resolves.toBeInstanceOf(OllamaEmbedding);
  });

  it('builds a Gemini embedder when configured for it', async () => {
    config.embeddingProvider = 'gemini';
    config.embeddingModel = 'gemini-embedding-001';
    config.geminiApiKey = 'test-key';

    await expect(createEmbedding()).resolves.toBeInstanceOf(GeminiEmbedding);
  });

  it('hands ingestion and querying the very same instance', async () => {
    config.embeddingProvider = 'ollama';
    config.embeddingModel = 'nomic-embed-text';

    // Documents and queries must land in the same vector space; sharing one instance is
    // what guarantees they were produced by the same model.
    expect(await createEmbedding()).toBe(await createEmbedding());
  });

  it('rejects an unknown provider by name', async () => {
    config.embeddingProvider = 'not-a-provider';

    await expect(createEmbedding()).rejects.toThrow(/Unknown EMBEDDING_PROVIDER "not-a-provider"/);
  });

  it.each([
    ['ollama', 'embeddingModel', 'EMBEDDING_MODEL'],
    ['llama', 'embeddingModelPath', 'EMBEDDING_MODEL_PATH'],
    ['gemini', 'embeddingModel', 'EMBEDDING_MODEL'],
  ])('reports the missing setting for the %s provider', async (provider, field, variable) => {
    config.embeddingProvider = provider;
    (config as Record<string, unknown>)[field] = '';

    await expect(createEmbedding()).rejects.toThrow(`${variable} is required when EMBEDDING_PROVIDER is "${provider}"`);
  });

  it('requires an API key for the gemini provider', async () => {
    config.embeddingProvider = 'gemini';
    config.embeddingModel = 'gemini-embedding-001';
    config.geminiApiKey = '';

    await expect(createEmbedding()).rejects.toThrow(/GEMINI_API_KEY is required/);
  });

  it('can be retried after a misconfiguration is corrected', async () => {
    config.embeddingProvider = 'ollama';
    config.embeddingModel = '';
    await expect(createEmbedding()).rejects.toThrow(/EMBEDDING_MODEL is required/);

    config.embeddingModel = 'nomic-embed-text';
    await expect(createEmbedding()).resolves.toBeInstanceOf(OllamaEmbedding);
  });
});
