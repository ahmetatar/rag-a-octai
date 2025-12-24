# Raga Octi

A RAG (Retrieval-Augmented Generation) application built with TypeScript, Express, ChromaDB, and Ollama. This system enables document ingestion and intelligent query responses using vector embeddings and language models.

## Features

- 📄 **Document Ingestion** - Support for PDF and text file processing
- 🔍 **Semantic Search** - Vector-based document retrieval using ChromaDB
- 🤖 **AI-Powered Responses** - Generate intelligent responses using Ollama or Gemini models
- 🧩 **Modular Architecture** - Extensible file handlers, chunkers, and embedding providers
- 🐳 **Docker Support** - Easy deployment with Docker Compose

## Architecture

```
src/
├── config.ts              # Environment configuration
├── index.ts               # Express server entry point
├── core/rag/
│   ├── ingestion.ts       # Document ingestion pipeline
│   ├── rag-orchestrator.ts # Query processing orchestrator
│   ├── chunkers/          # Text chunking strategies
│   ├── embedding/         # Embedding providers (Ollama, Gemini)
│   ├── file-handlers/     # File type processors (PDF, text)
│   ├── lang-models/       # Language model integrations
│   ├── text-processors/   # Text preprocessing utilities
│   └── vector-store/      # ChromaDB vector store integration
├── infrastructure/
│   └── logging/           # Winston logging setup
└── routes/
    ├── ingestion.route.ts # Document upload endpoint
    └── query.route.ts     # Query endpoint
```

## Prerequisites

- Node.js 22+
- Docker / Podman (for ChromaDB and Ollama)
- Ollama (for local LLM inference) or Gemini API key

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd raga_octi_app
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Create a `.env` file in the project root:
   ```env
   # Server
   PORT=3000
   DEBUG=false

   # Chunking
   CHUNK_SIZE=1000
   CHUNK_OVERLAP=0

   # RAG Configuration
   RAG_TOP_K=3
   RETRIEVAL_THRESHOLD=0.35
   MAX_TOKENS=1000

   # Models
   EMBEDDING_MODEL=nomic-embed-text
   GENERATION_MODEL=llama3.2

   # Ollama
   OLLAMA_HOST=http://localhost:11434

   # Gemini (optional)
   GEMINI_API_KEY=your-api-key

   # ChromaDB
   CHROMADB_HOST=localhost
   CHROMADB_PORT=8000
   CHROMA_COLLECTION=docs

   # LangSmith (optional)
   LANG_SMITH_API_KEY=
   LANGSMITH_TRACING=false
   LANGSMITH_ENDPOINT=
   ```

4. **Start infrastructure services**
   ```bash
   # Using Docker Compose
   docker-compose up -d

   # Or for development with Ollama included
   docker-compose -f docker-compose.dev.yml up -d
   ```

5. **Pull required Ollama models**
   ```bash
   ollama pull nomic-embed-text
   ollama pull llama3.2
   ```

## Usage

### Development

```bash
# Start development server with hot reload
npm run dev

# Start with debugging enabled
npm run debug
```

### Production

```bash
# Build the project
npm run build

# Start the server
npm start
```

### API Endpoints

#### Ingest Documents

Upload documents for processing and storage in the vector database.

```bash
curl -X POST \
  -F "docs=@/path/to/document.pdf" \
  -F "docs=@/path/to/another.txt" \
  http://localhost:3000/ingest
```

**Response:**
```json
{
  "status": "success"
}
```

#### Query Documents

Ask questions about the ingested documents.

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"query": "What is the main topic of the documents?"}' \
  http://localhost:3000/query
```

**Response:**
```json
{
  "response": "Based on the documents, the main topic is..."
}
```

## Configuration Options

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `PORT` | Server port | `3000` |
| `DEBUG` | Enable debug mode | `false` |
| `CHUNK_SIZE` | Text chunk size | `1000` |
| `CHUNK_OVERLAP` | Overlap between chunks | `0` |
| `RAG_TOP_K` | Number of documents to retrieve | `3` |
| `RETRIEVAL_THRESHOLD` | Minimum similarity score | `0.35` |
| `MAX_TOKENS` | Maximum response tokens | `1000` |
| `EMBEDDING_MODEL` | Ollama embedding model | - |
| `GENERATION_MODEL` | Ollama generation model | - |
| `OLLAMA_HOST` | Ollama server URL | `http://localhost:11434` |
| `GEMINI_API_KEY` | Google Gemini API key | - |
| `CHROMADB_HOST` | ChromaDB host | `localhost` |
| `CHROMADB_PORT` | ChromaDB port | `8000` |
| `CHROMA_COLLECTION` | ChromaDB collection name | `docs` |

## Testing

```bash
# Run tests
npm test

# Run tests with UI
npm run test:ui

# Run tests with coverage
npm run test:coverage
```

## Docker

### Production Setup

```bash
docker-compose up -d
```

This starts ChromaDB with persistent storage.

### Development Setup

```bash
docker-compose -f docker-compose.dev.yml up -d
```

This starts ChromaDB, Ollama, and the API server with hot reloading.

## Supported File Types

- **Text files** (`.txt`, `text/plain`)
- **PDF files** (`.pdf`, `application/pdf`)
  - Standard PDF processing
  - Page-by-page PDF processing (with metadata)

## Project Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run debug` | Start with Node.js inspector |
| `npm run build` | Compile TypeScript |
| `npm start` | Run production build |
| `npm test` | Run tests |
| `npm run test:ui` | Run tests with Vitest UI |
| `npm run test:coverage` | Run tests with coverage |
| `npm run compose:up` | Start Docker services |
| `npm run compose:down` | Stop Docker services |

## Tech Stack

- **Runtime**: Node.js 22+
- **Language**: TypeScript
- **Framework**: Express 5
- **Vector Database**: ChromaDB
- **LLM Runtime**: Ollama
- **Embeddings**: Ollama / Google Gemini
- **File Processing**: pdf-parse
- **Logging**: Winston
- **Testing**: Vitest
- **Validation**: Zod

## License

MIT License - see [LICENSE](LICENSE) for details.

## Author

Ahmet Atar
