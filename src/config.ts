import dotenv from 'dotenv';

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
  /** Number of top documents to retrieve */
  topK: process.env.RAG_TOP_K ? parseInt(process.env.RAG_TOP_K) : 3,
  /** Embedding model to use */
  embeddingModel: process.env.EMBEDDING_MODEL || '',
  /** Generation model to use */
  generationModel: process.env.GENERATION_MODEL || '',
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
  /** Retrieval similarity threshold */
  retrievalThreshold: process.env.RETRIEVAL_THRESHOLD ? parseFloat(process.env.RETRIEVAL_THRESHOLD) : 0.35,
  /** LangSmith API key */
  langSmithApiKey: process.env.LANG_SMITH_API_KEY || '',
  /** Enable or disable LangSmith tracing */
  langSmithTracing: process.env.LANGSMITH_TRACING === 'true',
  /** LangSmith endpoint URL */
  langSmithEndpoint: process.env.LANGSMITH_ENDPOINT || '',
};
