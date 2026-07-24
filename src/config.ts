import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config();

/**
 * Configuration settings for the RAG (Retrieval-Augmented Generation) system.
 */
export default {
  /** The port on which the server will listen */
  port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
  /** Enable or disable debug mode */
  debugMode: process.env.DEBUG === 'true',
  /** Size of text chunks */
  chunkSize: process.env.CHUNK_SIZE ? parseInt(process.env.CHUNK_SIZE) : 1000,
  /** Overlap between text chunks */
  chunkOverlap: process.env.CHUNK_OVERLAP ? parseInt(process.env.CHUNK_OVERLAP) : 0,
  /** Number of chunks embedded per batch during ingestion */
  embeddingBatchSize: process.env.EMBEDDING_BATCH_SIZE ? parseInt(process.env.EMBEDDING_BATCH_SIZE) : 64,
  /** Number of top documents to retrieve */
  topK: process.env.RAG_TOP_K ? parseInt(process.env.RAG_TOP_K) : 3,
  /** Upper bound a request may ask for via its own `topK` */
  maxTopK: process.env.RAG_MAX_TOP_K ? parseInt(process.env.RAG_MAX_TOP_K) : 50,
  /** Maximum accepted length of a query string, in characters */
  maxQueryLength: process.env.MAX_QUERY_LENGTH ? parseInt(process.env.MAX_QUERY_LENGTH) : 2000,
  /** Embedding provider used for BOTH ingestion and querying ('ollama' | 'llama' | 'gemini') */
  embeddingProvider: (process.env.EMBEDDING_PROVIDER || 'ollama').toLowerCase(),
  /** Embedding model to use */
  embeddingModel: process.env.EMBEDDING_MODEL || '',
  /** Path to the embedding model */
  embeddingModelPath: process.env.EMBEDDING_MODEL_PATH ? path.resolve(process.env.EMBEDDING_MODEL_PATH) : '',
  /** Generation model to use */
  generationModel: process.env.GENERATION_MODEL || '',
  /** Path to the generation model */
  generationModelPath: process.env.GENERATION_MODEL_PATH ? path.resolve(process.env.GENERATION_MODEL_PATH) : '',
  /** Ollama host URL */
  ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
  /** Gemini API key */
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  /** ChromaDB host */
  chromaHost: process.env.CHROMADB_HOST || 'localhost',
  /** ChromaDB port */
  chromaPort: process.env.CHROMADB_PORT ? parseInt(process.env.CHROMADB_PORT) : 8000,
  /** ChromaDB collection name */
  chromaCollection: process.env.CHROMA_COLLECTION || 'docs',
  /** Maximum tokens for generation */
  maxTokens: process.env.MAX_TOKENS ? parseInt(process.env.MAX_TOKENS) : 1000,
  /** Maximum size of a single uploaded file, in megabytes */
  maxUploadFileSizeMb: process.env.MAX_UPLOAD_FILE_SIZE_MB ? parseInt(process.env.MAX_UPLOAD_FILE_SIZE_MB) : 25,
  /** Maximum number of files accepted in one ingestion request */
  maxUploadFiles: process.env.MAX_UPLOAD_FILES ? parseInt(process.env.MAX_UPLOAD_FILES) : 10,
  /** Retrieval similarity threshold */
  retrievalThreshold: process.env.RETRIEVAL_THRESHOLD ? parseFloat(process.env.RETRIEVAL_THRESHOLD) : 0.35,
  /**
   * Allowed CORS origins, comma-separated. Empty disables CORS entirely (same-origin only),
   * '*' allows any origin. Defaults to disabled — an API with no browser client needs no CORS.
   */
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  /** Time window for rate limiting, in milliseconds */
  rateLimitWindowMs: process.env.RATE_LIMIT_WINDOW_MS ? parseInt(process.env.RATE_LIMIT_WINDOW_MS) : 60_000,
  /** Maximum requests allowed per IP within the rate-limit window */
  rateLimitMax: process.env.RATE_LIMIT_MAX ? parseInt(process.env.RATE_LIMIT_MAX) : 100,
  /**
   * Express `trust proxy` setting. Behind a reverse proxy (nginx, a load balancer) set this
   * to the number of proxies so the rate limiter keys on the real client IP rather than the
   * proxy's. Defaults to 0 (no proxy trusted).
   */
  trustProxy: process.env.TRUST_PROXY ? parseInt(process.env.TRUST_PROXY) : 0,
  /**
   * When true, /ingest and /query require a valid API key and each request is scoped to the
   * key's tenant. When false the service runs single-tenant: every request is assigned the
   * default tenant, so the isolation code path still applies uniformly.
   */
  authEnabled: process.env.AUTH_ENABLED === 'true',
  /**
   * API key → tenant id map, parsed from `API_KEYS` as comma-separated `key:tenantId` pairs
   * (e.g. `sk-a:acme,sk-b:globex`). Only consulted when authEnabled is true.
   */
  apiKeys: parseApiKeys(process.env.API_KEYS),
  /** Tenant assigned to every request when auth is disabled (single-tenant mode). */
  defaultTenant: process.env.DEFAULT_TENANT || 'default',
};

/**
 * Parses the `API_KEYS` environment variable into a key → tenant lookup.
 * @param raw Comma-separated `key:tenantId` pairs.
 * @returns A map from API key to tenant id.
 */
function parseApiKeys(raw?: string): Record<string, string> {
  const keys: Record<string, string> = {};

  for (const pair of (raw || '').split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;

    // Split on the FIRST colon only, so a key containing colons is preserved.
    const separator = trimmed.indexOf(':');
    if (separator <= 0 || separator === trimmed.length - 1) continue;

    const key = trimmed.slice(0, separator).trim();
    const tenantId = trimmed.slice(separator + 1).trim();
    if (key && tenantId) {
      keys[key] = tenantId;
    }
  }

  return keys;
}
