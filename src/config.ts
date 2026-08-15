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
  /**
   * Characters each chunk repeats from the end of the previous one, ~15% of `chunkSize`.
   *
   * Not zero: the splitter cuts on character count, so with no overlap a sentence that
   * straddles a boundary is torn in half and neither chunk carries the whole fact. A query
   * matching that fact then finds two partial chunks instead of one complete one. The
   * overlap costs ~15% more vectors and buys a boundary that no longer destroys meaning.
   */
  chunkOverlap: process.env.CHUNK_OVERLAP ? parseInt(process.env.CHUNK_OVERLAP) : 150,
  /** Number of chunks embedded per batch during ingestion */
  embeddingBatchSize: process.env.EMBEDDING_BATCH_SIZE ? parseInt(process.env.EMBEDDING_BATCH_SIZE) : 64,
  /** Number of top documents to retrieve */
  topK: process.env.RAG_TOP_K ? parseInt(process.env.RAG_TOP_K) : 3,
  /** Upper bound a request may ask for via its own `topK` */
  maxTopK: process.env.RAG_MAX_TOP_K ? parseInt(process.env.RAG_MAX_TOP_K) : 50,
  /**
   * When true, a cross-encoder reranks the vector-search candidates before the top-K is
   * chosen. Requires RERANK_MODEL_PATH; disabled by default so the app runs without a
   * reranker model.
   */
  rerankEnabled: process.env.RERANK_ENABLED === 'true',
  /** Path to a GGUF reranker model (e.g. bge-reranker) for the llama ranking context */
  rerankModelPath: process.env.RERANK_MODEL_PATH ? path.resolve(process.env.RERANK_MODEL_PATH) : '',
  /** How many candidates to pull from vector search before reranking down to top-K */
  rerankFetchK: process.env.RERANK_FETCH_K ? parseInt(process.env.RERANK_FETCH_K) : 20,
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
  /** Directory where uploaded files are staged for the async ingest worker */
  uploadDir: process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.resolve('uploads'),
  /**
   * Ingest queue driver: 'bull' (BullMQ + Redis, persistent) or 'memory' (in-process, lost
   * on restart). Defaults to 'bull'; tests and no-Redis setups use 'memory'.
   */
  queueDriver: (process.env.QUEUE_DRIVER || 'bull').toLowerCase(),
  /** Redis connection URL for the BullMQ queue driver */
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  /** How many ingest jobs the worker processes concurrently */
  queueConcurrency: process.env.QUEUE_CONCURRENCY ? parseInt(process.env.QUEUE_CONCURRENCY) : 2,
  /** Retry attempts for a failed ingest job (BullMQ) */
  jobAttempts: process.env.JOB_ATTEMPTS ? parseInt(process.env.JOB_ATTEMPTS) : 3,
  /** Timeout for a single external call (Ollama/Chroma), in milliseconds */
  externalTimeoutMs: process.env.EXTERNAL_TIMEOUT_MS ? parseInt(process.env.EXTERNAL_TIMEOUT_MS) : 30_000,
  /**
   * Timeout for a single dependency ping in the /health/ready probe, in milliseconds. Kept
   * short (and un-retried) so a readiness check fails fast rather than hanging a probe.
   */
  readinessTimeoutMs: process.env.READINESS_TIMEOUT_MS ? parseInt(process.env.READINESS_TIMEOUT_MS) : 3_000,
  /** Retry attempts for a failed external call (Ollama/Chroma) */
  externalRetryAttempts: process.env.EXTERNAL_RETRY_ATTEMPTS ? parseInt(process.env.EXTERNAL_RETRY_ATTEMPTS) : 3,
  /**
   * Minimum COSINE SIMILARITY a chunk must reach to be kept, in [-1, 1]. Applies when the
   * results being filtered are in vector-search order — that is, whenever reranking did not
   * actually run.
   */
  retrievalThreshold: process.env.RETRIEVAL_THRESHOLD ? parseFloat(process.env.RETRIEVAL_THRESHOLD) : 0.35,
  /**
   * Minimum CROSS-ENCODER RELEVANCE a chunk must reach to be kept, in [0, 1]. Applies only
   * when reranking actually ran.
   *
   * Separate from `retrievalThreshold` because the two numbers grade different things. A
   * cosine similarity of 0.45 means "reasonably close in embedding space"; a cross-encoder
   * score of 0.45 means "the model is 45% confident this chunk answers the question". Feeding
   * one number to both stages made turning the reranker on silently change how strict the
   * filter was, which is how a measured improvement can turn out to be a units error.
   */
  rerankThreshold: process.env.RERANK_THRESHOLD ? parseFloat(process.env.RERANK_THRESHOLD) : 0.1,
  // 0.1 is where the eval set's knee is: hit rate stays at 100%, recall at 99%, and false
  // retrieval falls from 100% to 33%. Raising it to 0.2 halves false retrieval again but
  // starts costing multi-document questions their second source.
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
   * SHA-256 key hash (hex) → { tenantId, scopes } map, parsed from `API_KEY_HASHES` as
   * comma-separated `hash:tenantId` or `hash:tenantId:scope1|scope2` pairs (e.g.
   * `9f86d0...:acme,3608bd...:globex:read|write`). Raw keys are never configured or stored —
   * hash a key with
   * `node -e "console.log(require('crypto').createHash('sha256').update('<key>').digest('hex'))"`
   * to produce the value for this map. A key with no scope segment gets `['*']` (full access),
   * so existing two-field entries keep working unchanged. Only consulted when authEnabled is
   * true.
   */
  apiKeyHashes: parseApiKeys(process.env.API_KEY_HASHES),
  /** Tenant assigned to every request when auth is disabled (single-tenant mode). */
  defaultTenant: process.env.DEFAULT_TENANT || 'default',
};

/** A configured API key's resolved tenant and permitted scopes. */
export interface ApiKeyEntry {
  tenantId: string;
  /** Permitted scopes (e.g. `read`, `write`, `delete`), or `['*']` for unrestricted access. */
  scopes: string[];
}

/**
 * Parses the `API_KEY_HASHES` environment variable into a key-hash → entry lookup.
 * @param raw Comma-separated `hash:tenantId` or `hash:tenantId:scope1|scope2` pairs.
 * @returns A map from API key hash (hex) to its tenant and scopes.
 */
function parseApiKeys(raw?: string): Record<string, ApiKeyEntry> {
  // Object.create(null) avoids a prototype-chain lookup bypass: a plain `{}` literal
  // inherits Object.prototype, so `apiKeys['constructor']` (or '__proto__', 'toString', ...)
  // would resolve to a truthy non-string value instead of undefined, letting an attacker
  // skip the 401 check with no real key.
  const keys: Record<string, ApiKeyEntry> = Object.create(null);

  for (const pair of (raw || '').split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;

    const [hash, tenantId, scopesField] = trimmed.split(':');
    if (!hash?.trim() || !tenantId?.trim()) continue;

    const scopes = scopesField
      ? scopesField
          .split('|')
          .map((scope) => scope.trim())
          .filter(Boolean)
      : ['*'];
    if (scopes.length === 0) continue;

    keys[hash.trim()] = { tenantId: tenantId.trim(), scopes };
  }

  return keys;
}
