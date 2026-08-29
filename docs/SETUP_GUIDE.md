# Local Setup Guide

A step-by-step walkthrough for getting the Groundwire RAG pipeline running on your machine.
For architectural context see the [README](../README.md); for evaluation and reranking see
[EVAL_AND_RERANKING.md](EVAL_AND_RERANKING.md).

## 1. Prerequisites

Install these before you start:

- **Node.js 22+**
- **Docker** (or Podman) — runs ChromaDB, Redis, and optionally Ollama
- **Ollama** — either the local desktop/CLI install, or the containerized service from
  `docker-compose.dev.yml`
- **curl** — to test endpoints
- Optional: a **Gemini API key** if you want to use Gemini instead of Ollama for generation

Verify Docker is running:

```bash
docker info
```

## 2. Clone and install

```bash
git clone <repository-url>
cd groundwire
npm install
```

## 3. Choose a setup path

There are two ways to run the pipeline locally. **Path A is the fastest way to get a working
system**; Path B gives you more control if you already run Ollama natively (e.g. for GPU
acceleration).

### Path A — Everything in Docker (recommended)

`docker-compose.dev.yml` starts ChromaDB, Ollama, and the API (with hot reload) all wired
together on one network.

```bash
docker-compose -f docker-compose.dev.yml up -d
```

This exposes:

- API on `http://localhost:1453`
- ChromaDB on `http://localhost:8000`
- Ollama on `http://localhost:11434`
- Node debugger on port `9229`

Pull the models the containerized Ollama needs (the embedding + generation models; see
step 5):

```bash
docker exec ollama ollama pull nomic-embed-text
docker exec ollama ollama pull qwen3:1.7b
```

Skip to **step 6** — the API container already has an `.env` mounted via `env_file`.

### Path B — Native Ollama + Docker for the rest

If you already have Ollama installed natively (useful for GPU acceleration on macOS),
run only ChromaDB and Redis in Docker, and the API directly on your host with `npm run dev`.

```bash
docker-compose up -d chromadb redis
```

Continue to step 4.

## 4. Set up environment variables

Create a `.env` file in the project root. This is the minimum needed for Path B (native
Ollama, local API process):

```env
# Server
PORT=3000
DEBUG=true

# Chunking
CHUNK_SIZE=1000
CHUNK_OVERLAP=150

# RAG Configuration
RAG_TOP_K=3
RETRIEVAL_THRESHOLD=0.35
MAX_TOKENS=1000

# Upload limits
MAX_UPLOAD_FILE_SIZE_MB=25
MAX_UPLOAD_FILES=10

# Models — EMBEDDING_PROVIDER applies to BOTH ingestion and querying; documents and
# queries must be embedded by the same model or retrieval returns nonsense.
EMBEDDING_PROVIDER=ollama
EMBEDDING_MODEL=nomic-embed-text
GENERATION_MODEL=llama3.2

# Ollama (native install on the host)
OLLAMA_HOST=http://localhost:11434

# ChromaDB (started via `docker-compose up -d chromadb redis`)
CHROMADB_HOST=localhost
CHROMADB_PORT=8000
CHROMA_COLLECTION=docs

# Async ingest queue — needs the redis container above, or set QUEUE_DRIVER=memory
QUEUE_DRIVER=bull
REDIS_URL=redis://localhost:6379

# Auth — off for local dev; see the README's Configuration Options table to enable it
AUTH_ENABLED=false
```

See the README's **Configuration Options** table for every variable and its default —
this is only the subset you need to get started.

> **Never commit `.env`.** It's already gitignored; keep API keys and key hashes out of
> version control.

## 5. Pull Ollama models

The embedding and generation models must match what's configured in `.env`
(`EMBEDDING_MODEL` / `GENERATION_MODEL`):

```bash
ollama pull nomic-embed-text
ollama pull llama3.2
```

`nomic-embed-text` is the shipped default and is measured to outperform the local GGUF
alternative on the no-rerank path — see
[EVAL_AND_RERANKING.md](EVAL_AND_RERANKING.md) Step 4b before switching.

## 6. (Optional) Enable cross-encoder reranking

Reranking meaningfully improves retrieval quality (MRR 0.928 → 0.990, false-retrieval rate
100% → 33%) at the cost of ~1.4s/query. It needs a GGUF model on disk:

```bash
bash models/download.sh
```

This pulls the bge-small embedding model, a Qwen3 generation model, and the
`bge-reranker-v2-m3` cross-encoder into `./models/`. Then in `.env`:

```env
RERANK_ENABLED=true
RERANK_MODEL_PATH=./models/hf_gpustack_bge-reranker-v2-m3.Q4_K_M.gguf
RERANK_FETCH_K=10
RERANK_THRESHOLD=0.1
```

Full explanation of the two separate thresholds (`RETRIEVAL_THRESHOLD` vs
`RERANK_THRESHOLD`) is in [EVAL_AND_RERANKING.md](EVAL_AND_RERANKING.md).

## 7. Start the API

**Path A (Docker):** already running from step 3 — check logs with
`docker-compose -f docker-compose.dev.yml logs -f api`.

**Path B (native):**

```bash
npm run dev
```

You should see the server start on the configured `PORT`.

## 8. Verify it's working

Check liveness and readiness:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/health/ready
```

`/health/ready` returns `503` until both ChromaDB and Ollama are reachable — if it stays
unhealthy, check the container logs and confirm `OLLAMA_HOST` / `CHROMADB_HOST` are correct
for your setup (native vs. containerized).

Ingest a test document:

```bash
curl -X POST -F "docs=@/path/to/document.pdf" http://localhost:3000/ingest
```

This returns `{"status":"accepted","jobId":"..."}`. Poll for completion:

```bash
curl http://localhost:3000/ingest/status/<jobId>
```

Once `state` is `completed`, query it:

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"query": "What is this document about?"}' \
  http://localhost:3000/query
```

## 9. Run the test and eval suites

```bash
npm test              # unit tests
npm run eval           # retrieval-quality eval against the golden set (needs ChromaDB + embeddings)
```

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `/health/ready` returns `503` | ChromaDB or Ollama unreachable — check `CHROMADB_HOST`/`OLLAMA_HOST` match how you started services (native vs. Docker network hostnames like `chromadb`/`ollama`) |
| Ingest job stuck in `queued` | Redis not running, or `QUEUE_DRIVER=bull` with no Redis reachable at `REDIS_URL` — either start Redis or set `QUEUE_DRIVER=memory` |
| Query returns `abstained: true` for everything | Nothing ingested yet, embedding model mismatch between ingest and query time, or `RETRIEVAL_THRESHOLD`/`RERANK_THRESHOLD` too strict |
| `401` on `/ingest` or `/query` | `AUTH_ENABLED=true` but no valid `x-api-key` header — see the README's Auth section, or set `AUTH_ENABLED=false` for local dev |
| Docker container can't reach native Ollama | Use `http://host.docker.internal:11434` (Docker Desktop / Podman Desktop) or `http://host.containers.internal:11434` (rootless Podman on Linux) instead of `localhost` |

## Next steps

- [EVAL_AND_RERANKING.md](EVAL_AND_RERANKING.md) — measure and tune retrieval quality
- [ADR 0001](adr/0001-vector-store-abstraction-and-backend-strategy.md) — vector store design decisions
- [rag-improvements-task-list.md](rag-improvements-task-list.md) — ongoing improvement backlog
