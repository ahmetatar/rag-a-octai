import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();
/**
 * Configuration settings for the RAG (Retrieval-Augmented Generation) system.
 */
export default {
  port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
  debugMode: process.env.DEBUG === 'true',
  chunkSize: process.env.RAG_MAX_TOKENS ? parseInt(process.env.RAG_MAX_TOKENS) : 100,
  chunkOverlap: process.env.RAG_OVERLAP ? parseInt(process.env.RAG_OVERLAP) : 0,
  topK: process.env.RAG_TOP_K ? parseInt(process.env.RAG_TOP_K) : 4,
  embeddingModel: process.env.EMBEDDING_MODEL || 'nomic-embed-text',
  generationModel: process.env.GENERATION_MODEL || 'gpt-4o-mini',
  ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
  chromaHost: process.env.CHROMADB_HOST || 'localhost',
  chromaPort: process.env.CHROMADB_PORT ? parseInt(process.env.CHROMADB_PORT) : 8000,
  chromaCollection: process.env.CHROMA_COLLECTION || 'docs',
};
