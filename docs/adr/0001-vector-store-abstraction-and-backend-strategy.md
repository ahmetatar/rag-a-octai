# ADR 0001 — Vector store abstraction & backend strategy

- **Status:** Accepted (interface); Recommended path (backend migration)
- **Date:** 2026-07
- **Deciders:** groundwire maintainers
- **Related:** ROADMAP T9 (this task), T4b (deferred hybrid search), T1 (tenant isolation), T2 (durability)

## Context

Retrieval today runs on a single **ChromaDB** node. That is fine for development and a
single-tenant MVP, but for an enterprise deployment it is a **single point of failure**: no
built-in replication, no first-class backup/restore story, and no horizontal scale path. Two
further pressures point at the same decision:

1. **Hybrid search (T4b, deferred).** Chroma has no native BM25/full-text scoring
   (`whereDocument` is substring-only), so lexical queries (exact product codes, IDs, names)
   retrieve poorly. Real hybrid needs either a separate keyword index or a backend that offers
   full-text natively.
2. **Operations.** HA, backup and point-in-time recovery are expected of an enterprise data
   store; bolting them onto single-node Chroma is swimming upstream.

Before any migration we must ensure the codebase is **not welded to Chroma**. Until this task
the orchestrator, ingestor and document endpoints all depended on the concrete
`ChromaVectorStore`.

## Decision

### 1. Introduce a `VectorStore` interface (done in this task)

`src/core/rag/vector-store/vector-store.interface.ts` defines a store-agnostic contract —
`upsert`, `search`, `deleteBySource`, `listSources` — and `ChromaVectorStore` now
`implements` it. The orchestrator, ingestor, document routes and eval runner depend on the
**interface**, never the concrete class (factories still instantiate `ChromaVectorStore`).

Every read/write is scoped by an optional **`tenantId`** — the one filter every candidate
backend can honour uniformly (tenant isolation, T1). Richer, backend-specific metadata
filtering was deliberately kept **out** of the contract so it stays portable; `search`'s old
Chroma-typed `where` parameter was replaced with a plain `tenantId`.

This is **Accepted and implemented**: adding a new backend is now a single new class behind
the interface plus a factory switch, with zero changes to the RAG pipeline.

### 2. Keep ChromaDB as the default for dev / MVP

No migration is forced now. Chroma stays the default backend; the interface simply makes the
door swappable.

### 3. Recommended migration target: **pgvector**, when HA/backup/scale **or** hybrid is needed

When any of {HA, managed backup, horizontal scale, hybrid search} becomes a hard requirement,
migrate to **Postgres + pgvector** as the default choice, unless pure-vector scale/latency at
very large N dominates (then **Qdrant** — see below).

## Options considered

| Dimension | ChromaDB (current) | **pgvector (Postgres)** | Qdrant | Weaviate |
|---|---|---|---|---|
| HA / replication | ✗ single-node | ✓ mature (streaming replicas, managed RDS/Cloud SQL/Neon) | ✓ (clustered/cloud) | ✓ (clustered/cloud) |
| Backup / PITR | weak | ✓ best-in-class (pg_dump, WAL, snapshots) | ✓ snapshots | ✓ snapshots |
| Horizontal scale | ✗ | ~ (read replicas; sharding is manual/Citus) | ✓ sharding built-in | ✓ sharding built-in |
| **Hybrid (BM25/full-text)** | ✗ substring only | ✓ **free** via `tsvector`/GIN + RRF in SQL → **resolves T4b** | ✓ native sparse+dense | ✓ native hybrid module |
| Vector scale/latency at huge N | ok | good to ~10M+ (HNSW); tuning needed beyond | ✓ purpose-built, fastest at scale | ✓ strong |
| Metadata filtering | ok | ✓ arbitrary SQL `WHERE` | ✓ rich payload filters | ✓ rich `where` |
| Ops complexity | low (but fragile) | **low if Postgres already operated**; one system for relational + vectors | medium (new system) | medium-high (new system + GraphQL/modules) |
| Ecosystem / tooling | young | huge (every ORM, migration, monitoring tool) | growing | growing |
| Cost / licensing | OSS | OSS ext; managed everywhere | OSS + cloud | OSS + cloud |
| Tenant isolation (T1) | metadata filter | `WHERE tenant_id = $1` (+ optional RLS/partitioning) | payload filter | tenant filter / native multi-tenancy |

### Why pgvector as the default

- **Hybrid comes for free.** `tsvector` full-text + vector similarity fused with Reciprocal
  Rank Fusion in a single SQL query closes the deferred **T4b** gap without a second datastore.
- **Operational leverage.** Most enterprises already run managed Postgres; HA, backup, PITR,
  monitoring and access control are solved problems there. One system covers relational needs
  (job/audit/tenant tables) **and** vectors.
- **Isolation & filtering.** Tenant scoping is a plain indexed `WHERE`; Row-Level Security or
  per-tenant partitioning is available if stronger isolation than metadata filtering is wanted.

### When Qdrant instead

If the corpus grows past what a single Postgres comfortably serves (tens of millions of
vectors, tight p99 latency, heavy sharding), **Qdrant** is purpose-built for vector scale with
native sharding and sparse+dense hybrid. The cost is running a dedicated vector system.

### Why not Weaviate (for now)

Capable (native hybrid, multi-tenancy modules) but a heavier operational surface and its own
query model; not preferred unless a specific built-in module is the deciding factor.

## Consequences

- **Positive:** The pipeline is backend-agnostic today. A migration is one new
  `implements VectorStore` class + factory switch + a data backfill — no orchestrator/route
  churn. The recommended pgvector path also retires the deferred T4b hybrid item.
- **Negative / cost:** The interface intentionally exposes only tenant-scoped filtering; a
  backend wanting richer per-request metadata filters would need a contract extension. A real
  migration still requires a data backfill and an embedding re-index if dimensions change.
- **Follow-up when triggered:** add `PgVectorStore implements VectorStore` (HNSW index,
  `tsvector` column, RRF query), dual-write + backfill from Chroma, cut over via the factory,
  then fold hybrid RRF scoring into `search`.
