# RAGA OCTI - RAG Document Ingestion System

A production-ready Retrieval-Augmented Generation (RAG) document ingestion service built with TypeScript, Express, and ChromaDB. This application provides a scalable API for ingesting and processing documents with advanced chunking, embedding, and vector storage capabilities.

## 🎯 Features

- **Multi-Format Document Support**: Process PDF, text, and markdown files
- **Flexible Chunking Strategies**: 
  - Recursive chunking for hierarchical text splitting
  - Sliding window chunking for context preservation
- **Multiple Embedding Options**:
  - Ollama integration for local embeddings
  - Google Gemini support
- **Vector Storage**: ChromaDB integration for efficient similarity search
- **Dependency Injection**: Clean architecture using InversifyJS
- **Type-Safe**: Full TypeScript support with strict typing
- **Containerized Deployment**: Docker/Podman compose ready
- **Testing**: Vitest integration with UI and coverage support
- **Production Ready**: Winston logging, environment-based configuration

## 📋 Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Application](#running-the-application)
- [API Documentation](#api-documentation)
- [Architecture](#architecture)
- [Development](#development)
- [Testing](#testing)
- [Docker Deployment](#docker-deployment)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

## 🔧 Prerequisites

- **Node.js**: v22.x or higher
- **npm**: v10.x or higher
- **Docker/Podman**: For running ChromaDB (recommended)
- **Ollama** (optional): For local embeddings - [Installation Guide](https://ollama.ai)

## 📦 Installation

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

Create a `.env` file in the root directory:

```env
# Server Configuration
PORT=1453
DEBUG=false

# RAG Configuration
RAG_MAX_TOKENS=100
RAG_OVERLAP=0
RAG_TOP_K=4

# Embedding Configuration
EMBEDDING_MODEL=nomic-embed-text
GENERATION_MODEL=gpt-4o-mini

# Ollama Configuration
OLLAMA_HOST=http://localhost:11434

# ChromaDB Configuration
CHROMADB_HOST=localhost
CHROMADB_PORT=8000
CHROMA_COLLECTION=docs
```

## ⚙️ Configuration

The application uses environment variables for configuration. Key settings include:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `1453` | Server port |
| `DEBUG` | `false` | Enable debug logging |
| `RAG_MAX_TOKENS` | `100` | Maximum tokens per chunk |
| `RAG_OVERLAP` | `0` | Overlap between chunks |
| `RAG_TOP_K` | `4` | Number of results for similarity search |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Model for embeddings |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama API endpoint |
| `CHROMADB_HOST` | `localhost` | ChromaDB host |
| `CHROMADB_PORT` | `8000` | ChromaDB port |
| `CHROMA_COLLECTION` | `docs` | ChromaDB collection name |

## 🚀 Running the Application

### Development Mode

```bash
# Start ChromaDB
npm run compose:up

# Run the application with hot-reload
npm run dev
```

The server will start on `http://localhost:1453` (or your configured PORT).

### Debug Mode

```bash
npm run debug
```

This starts the server with Node.js inspector on port 9229, allowing you to attach a debugger.

### Production Mode

```bash
# Build the application
npm run build

# Start the production server
npm start
```

## 📚 API Documentation

### POST /ingest

Ingest documents into the RAG system.

**Endpoint**: `POST http://localhost:1453/ingest`

**Content-Type**: `multipart/form-data`

**Request Parameters**:
- `docs`: File(s) to ingest (supports multiple files)

**Query Parameters** (optional):
- Additional file loading parameters can be passed as query strings

**Example using cURL**:

```bash
# Single file
curl -X POST \
  -F "docs=@/path/to/document.pdf" \
  http://localhost:1453/ingest

# Multiple files
curl -X POST \
  -F "docs=@/path/to/doc1.txt" \
  -F "docs=@/path/to/doc2.pdf" \
  -F "docs=@/path/to/doc3.md" \
  http://localhost:1453/ingest
```

**Example using JavaScript/Fetch**:

```javascript
const formData = new FormData();
formData.append('docs', fileInput.files[0]);

const response = await fetch('http://localhost:1453/ingest', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log(result); // { status: 'success' }
```

**Response**:

Success:
```json
{
  "status": "success"
}
```

Error:
```json
{
  "status": "error",
  "message": "Ingestion failed"
}
```

**Supported File Types**:
- Text files (`.txt`)
- Markdown files (`.md`)
- PDF files (`.pdf`)

## 🏗️ Architecture

The application follows Clean Architecture principles with clear separation of concerns:

### Core Layers

1. **Infrastructure Layer** (`src/infrastructure/`)
   - **Chunkers**: Text splitting strategies
     - `RecursiveChunker`: Hierarchical text splitting
     - `SlidingWindowChunker`: Overlapping window approach
   - **Embedding**: Vector embedding providers
     - `OllamaEmbedding`: Local embeddings via Ollama
     - `GeminiEmbedding`: Google Gemini API
   - **File Handlers**: Multi-format document processing
     - `TextFileHandler`: Plain text and markdown
     - `PdfFileHandler`: Standard PDF processing
     - `PdfPageFileHandler`: Page-by-page PDF processing
   - **Vector Store**: ChromaDB integration
   - **Logging**: Winston-based logging system

2. **Core Layer** (`src/core/`)
   - **RAG Pipeline**: Document ingestion and query processing
     - `RagDataIngestor`: Main ingestion orchestrator
     - File processing, chunking, embedding, and storage

3. **API Layer** (`src/routes/`)
   - RESTful endpoints for document ingestion
   - Request validation and error handling

### Dependency Injection

The application uses InversifyJS for dependency injection, providing:
- Loose coupling between components
- Easy testing and mocking
- Flexible component swapping
- Singleton scope for stateful services

Container bindings are defined in `src/container.ts`.

### Data Flow

```
1. File Upload (HTTP)
   ↓
2. File Handler (format-specific processing)
   ↓
3. Text Processor (cleaning & normalization)
   ↓
4. Chunker (text splitting)
   ↓
5. Embedding Generator (vector creation)
   ↓
6. Vector Store (ChromaDB persistence)
```

## 👨‍💻 Development

### Available Scripts

```bash
# Development with hot-reload
npm run dev

# Debug mode with inspector
npm run debug

# Build TypeScript
npm run build

# Run tests
npm run test

# Test with UI
npm run test:ui

# Test coverage
npm run test:coverage

# Start production server
npm start

# Start ChromaDB
npm run compose:up

# Stop ChromaDB
npm run compose:down
```

### Code Style

The project uses TypeScript with strict type checking. Key practices:

- **Path Aliases**: Use `@app`, `@core`, `@infrastructure`, `@routes`
- **Decorators**: `@injectable()` for DI container registration
- **Async/Await**: Consistent promise handling
- **Error Handling**: Comprehensive try-catch blocks

### Adding New File Handlers

1. Create handler class implementing `FileHandler`:

```typescript
import { injectable } from 'inversify';
import { Document, FileHandler, FileInfo } from './file-handler';

@injectable()
export class MyCustomHandler extends FileHandler {
  async handleFile(fileInfo: FileInfo): Promise<Document> {
    // Implementation
    return { content: '...', metadata: {} };
  }
}
```

2. Register in container (`src/container.ts`):

```typescript
container.bind(MyCustomHandler).toSelf().inSingletonScope();
```

3. Register MIME type mapping (`src/core/rag/pipeline-setup.ts`):

```typescript
registerFileHandler({ 
  'application/custom': container.get(MyCustomHandler) 
});
```

### Adding New Chunking Strategy

1. Implement `Chunker` interface:

```typescript
import { injectable } from 'inversify';
import { Chunker, ChunkOptions, Document } from './chunker';

@injectable()
export class MyChunker implements Chunker {
  async chunk(text: string, options: ChunkOptions): Promise<Document[]> {
    // Implementation
  }
}
```

2. Bind in container to use as default or named binding.

## 🧪 Testing

The project uses Vitest for testing:

```bash
# Run all tests
npm test

# Run tests with UI
npm run test:ui

# Generate coverage report
npm run test:coverage
```

### Writing Tests

```typescript
import { describe, it, expect } from 'vitest';
import { RecursiveChunker } from './recursive-chunker';

describe('RecursiveChunker', () => {
  it('should split text into chunks', async () => {
    const chunker = new RecursiveChunker();
    const result = await chunker.chunk('text', { chunkSize: 100 });
    expect(result).toBeDefined();
  });
});
```

## 🐳 Docker Deployment

### Using Docker Compose

The project includes Docker Compose configurations for easy deployment:

**Development**:
```bash
npm run compose:up
```

**Production** (using `docker-compose.yml`):
```bash
docker-compose up -d
```

### ChromaDB Service

ChromaDB runs as a containerized service:

- **Port**: 8000
- **Persistent Storage**: Volume-backed for data persistence
- **Health Checks**: Automatic health monitoring
- **Network**: Isolated bridge network

### Configuration

The ChromaDB service is configured with:
- Persistent storage enabled
- Telemetry disabled for privacy
- Health check endpoint monitoring

## 📁 Project Structure

```
raga_octi_app/
├── src/
│   ├── core/                    # Core business logic
│   │   └── rag/                # RAG pipeline implementation
│   │       ├── ingestion.ts    # Document ingestion
│   │       ├── query.ts        # Query processing
│   │       └── pipeline-setup.ts
│   ├── infrastructure/         # Infrastructure layer
│   │   ├── chunkers/          # Text chunking strategies
│   │   ├── embedding/         # Embedding providers
│   │   ├── file-handlers/     # Document processors
│   │   ├── logging/           # Logging configuration
│   │   ├── text-processors/   # Text preprocessing
│   │   └── vector-store/      # Vector database integration
│   ├── routes/                # API routes
│   │   └── ingestion.route.ts # Ingestion endpoint
│   ├── config.ts              # Application configuration
│   ├── container.ts           # DI container setup
│   └── index.ts               # Application entry point
├── docker-compose.yml         # Production Docker config
├── docker-compose.dev.yml     # Development Docker config
├── package.json               # Dependencies & scripts
├── tsconfig.json             # TypeScript configuration
├── vitest.config.ts          # Test configuration
└── README.md                 # This file
```

## 🔍 Key Components

### RagDataIngestor

The main orchestrator for document ingestion:

```typescript
const files: FileInfo[] = [...];
await ragDataIngestor.ingest(files, params);
```

### File Handlers

Process different document formats:

- **TextFileHandler**: Plain text and markdown files
- **PdfFileHandler**: Standard PDF documents
- **PdfPageFileHandler**: Page-level PDF processing

### Chunkers

Split documents into manageable pieces:

- **RecursiveChunker**: Hierarchical splitting with semantic awareness
- **SlidingWindowChunker**: Overlapping windows for context preservation

### Embeddings

Generate vector representations:

- **OllamaEmbedding**: Local model via Ollama
- **GeminiEmbedding**: Google Gemini API

### Vector Store

Persist and query embeddings:

- **ChromaVectorStore**: ChromaDB integration with similarity search

## 🛠️ Troubleshooting

### Common Issues

**ChromaDB Connection Failed**:
```bash
# Check if ChromaDB is running
docker ps | grep chromadb

# Restart ChromaDB
npm run compose:down
npm run compose:up
```

**Ollama Not Found**:
```bash
# Install Ollama
# macOS: brew install ollama
# or download from https://ollama.ai

# Start Ollama service
ollama serve

# Pull embedding model
ollama pull nomic-embed-text
```

**Port Already in Use**:
```bash
# Change PORT in .env file
PORT=3000

# Or kill process using the port
lsof -ti:1453 | xargs kill
```

## 📄 License

ISC

## 👤 Author

**Ahmet Atar**

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Coding Standards

- Follow TypeScript best practices
- Maintain test coverage
- Use meaningful commit messages
- Document public APIs
- Follow existing code style

---

**Built with ❤️ using TypeScript, Express, and ChromaDB**
