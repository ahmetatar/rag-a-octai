# Evaluation & Reranking — Guide + Walkthrough

This document explains two related features of Raga Octi:

1. **The evaluation harness** — an automated "exam" that measures how well the system finds
   the right documents.
2. **Cross-encoder reranking** — a technique that improves retrieval quality, whose benefit
   the harness lets us *measure* instead of guess.

It is written to be usable in a training/teaching setting: the first half explains the
concepts in plain language, the second half is a hands-on, copy-paste **walkthrough**.

---

## Part 1 — Concepts

### 1.1 The problem: "is our search actually good?"

A RAG system answers questions by first **retrieving** the most relevant document chunks,
then asking an LLM to answer using them. If retrieval pulls the wrong chunks, the answer is
wrong no matter how good the LLM is.

The hard question is: **how good is our retrieval, as a number?** Without a number, you can
only eyeball a few queries and say "seems fine." And when you change the search (new
embedding model, reranking, different chunking), you can't tell if you made it better or
worse.

### 1.2 The solution: an evaluation harness

The harness is a **graded exam with an answer key**:

- `eval/corpus/` — a set of documents (the "textbook").
- `eval/dataset.jsonl` — questions, each labelled with **which document holds the answer**.
- `npm run eval` — ingests the corpus, runs each question through retrieval, and checks
  whether the right document came back. Then it scores the run and prints a report.

Because the answer key is fixed, you can run it before and after any change and compare the
scores.

### 1.3 The metrics (plain language)

For each question we know which source *should* be retrieved. After running the query we see
which sources *were* retrieved, in order. From that we compute:

| Metric | Question it answers | Range |
|--------|---------------------|-------|
| **hit@k** | Did the right document appear at all (in the top-k)? | 0 or 1 |
| **recall@k** | Of the documents that should appear, how many did? | 0–1 |
| **precision@k** | Of the documents we returned, how many were relevant? | 0–1 |
| **MRR** (reciprocal rank) | How *high* was the right document ranked? (1.0 = always first) | 0–1 |
| **keyword coverage** | Does the generated answer mention the expected key facts? | 0–1 |

> **Why P@k can look "low":** if a question has one correct document and we return `k=3`
> chunks, the best possible precision is 1/3 = 33%. So on a single-answer dataset, **MRR** is
> the metric that really reflects ranking quality, not P@k.

The metric functions live in `src/core/rag/eval/metrics.ts` and are pure and unit-tested —
you can trust the numbers.

### 1.4 Reranking: why and how

**Vector search** (embeddings) is fast but *coarse*. It compares the query embedding to each
chunk embedding independently. It can retrieve several on-topic chunks but rank the *wrong*
one first, because it never reads the query and a chunk *together*.

A **cross-encoder reranker** does exactly that: it takes `(query, chunk)` as a pair and
outputs a relevance probability in `[0, 1]`. It is slower, so we don't run it on the whole
collection — we use it to **reorder a shortlist**:

```
             ┌─ vector search (fast, coarse) ─┐        ┌─ reranker (slow, precise) ─┐
query ─────► │ fetch top 20 candidates        │ ─────► │ score each (query,chunk)   │ ─► take top 3
             └────────────────────────────────┘        └────────────────────────────┘
```

In this project the reranker is a **local GGUF model** run through `node-llama-cpp` (the same
library used for local embeddings), so it adds **no new heavy dependency**. It is off by
default and enabled with two environment variables.

---

## Part 2 — Walkthrough (hands-on)

### Prerequisites

- ChromaDB running (the harness ingests + queries a real vector store):
  ```bash
  podman run -d --name chromadb -p 8000:8000 \
    -e IS_PERSISTENT=TRUE -e ANONYMIZED_TELEMETRY=FALSE chromadb/chroma:latest
  ```
- An embedding provider. The simplest for the harness is the **local llama** model (no Ollama
  server needed):
  ```bash
  # downloads the small bge embedding model into ./models
  npx --no node-llama-cpp pull --dir ./models hf:ggml-org/bge-small-en-v1.5-Q8_0-GGUF
  ```

### Step 1 — Run the baseline evaluation

```bash
EMBEDDING_PROVIDER=llama npm run eval
```

You'll see a per-question table and an aggregate line. On the shipped corpus it looks like:

```
id                     P@k    R@k    RR     hit
largest-planet         33.3% 100.0%  1.00    1
sun-energy             33.3% 100.0%  0.50    1     ← the answer chunk ranked 2nd, not 1st
...
AGGREGATE              P@k=33.3%  R@k=100.0%  MRR=0.950  hitRate=100.0%
```

Read this as: every question retrieves the right document (**hitRate 100%**), but one case
(`sun-energy`) ranked it **second** (RR = 0.50), dragging **MRR down to 0.950**.

The full report is written to `eval/results/latest.json` for diffing.

### Step 2 — Understand *why* `sun-energy` is imperfect

Vector search found the solar-system document but, among its chunks, ranked a slightly
closer-by-embedding chunk above the one that actually explains fusion. This is the classic
weakness reranking fixes.

### Step 3 — Download a reranker model

```bash
npx --no node-llama-cpp pull --dir ./models "hf:gpustack/bge-reranker-v2-m3-GGUF:Q4_K_M"
# → ./models/hf_gpustack_bge-reranker-v2-m3.Q4_K_M.gguf  (~438 MB)
```

### Step 4 — Run the evaluation **with reranking**

```bash
EMBEDDING_PROVIDER=llama \
RERANK_ENABLED=true \
RERANK_MODEL_PATH=./models/hf_gpustack_bge-reranker-v2-m3.Q4_K_M.gguf \
RERANK_FETCH_K=10 \
npm run eval
```

Now the report shows:

```
id                     P@k    R@k    RR     hit
sun-energy             33.3% 100.0%  1.00    1     ← now ranked 1st
...
AGGREGATE              P@k=33.3%  R@k=100.0%  MRR=1.000  hitRate=100.0%
```

**MRR improved from 0.950 → 1.000.** The reranker read each `(question, chunk)` pair, saw
that the fusion chunk best answers "how does the Sun produce energy?", and pulled it to rank
1. **This is the whole point:** we didn't guess reranking helped — we measured it.

### Step 5 — Use reranking in the running API

Set the same variables for the server and start it:

```bash
RERANK_ENABLED=true \
RERANK_MODEL_PATH=./models/hf_gpustack_bge-reranker-v2-m3.Q4_K_M.gguf \
npm start
```

Every `POST /query` now fetches `RERANK_FETCH_K` candidates, reranks them, and returns the
best `topK`. If the reranker model is missing or errors, the query **degrades gracefully** to
plain vector order instead of failing.

---

## Part 3 — Extending the harness

Making the exam harder (and more representative) is how you keep it useful.

### Add a document

Drop a `.txt` or `.md` file into `eval/corpus/`. It will be ingested automatically on the
next run.

### Add questions

Append lines to `eval/dataset.jsonl` (one JSON object per line):

```json
{"id": "my-question", "question": "What ...?", "expectedAnswerable": true, "expectedSources": ["my-doc.txt"], "expectedKeywords": ["fact1", "fact2"]}
```

- `expectedAnswerable` — whether the corpus contains enough information to answer. It must
  be `false` for a deliberately unanswerable case.
- `expectedSources` — the file name(s) whose chunks should be retrieved. Drives the retrieval
  metrics.
- `expectedKeywords` — optional; key facts the generated answer should contain. Drives
  keyword coverage (only scored when answer generation is on, see below).

To evaluate a safe refusal, add an unanswerable case. It must have no expected source:

```json
{"id": "outside-corpus", "question": "What is the 2027 price?", "expectedAnswerable": false, "expectedRefusal": true, "expectedSources": []}
```

Such cases do not affect retrieval precision, recall, or MRR. Instead the report measures
`falseRetrieval` (a source survived the production threshold), and with `EVAL_GENERATE=true`,
`abstention` and `falseAnswer`. Refusal detection uses deterministic English/Turkish phrases;
it is intended for repeatable regression testing, not as a semantic LLM judge.

### Score generated answers too

```bash
EVAL_GENERATE=true EMBEDDING_PROVIDER=llama npm run eval
```

This also runs the LLM and adds a **keyword coverage** column. It needs a reachable LLM
(Ollama or a local generation model); without one it skips answer metrics and still reports
retrieval metrics.

### Tips for a meaningful dataset

- Include **distractor documents** on similar topics so vector search has to discriminate —
  that's where reranking earns its keep.
- Prefer questions with a **single correct source** for clean MRR interpretation.
- Keep the corpus small and fast; the harness is meant to run often.

---

## Part 4 — Configuration reference

| Variable | Meaning | Default |
|----------|---------|---------|
| `RERANK_ENABLED` | Turn cross-encoder reranking on | `false` |
| `RERANK_MODEL_PATH` | Path to a GGUF reranker model | – |
| `RERANK_FETCH_K` | Candidates fetched before reranking down to `topK` | `20` |
| `EVAL_COLLECTION` | ChromaDB collection the harness uses | `eval_harness` |
| `EVAL_GENERATE` | Also generate answers and score keyword coverage | `false` |
| `RAG_TOP_K` | Final number of chunks kept (`k` in the metrics) | `3` |
| `RETRIEVAL_THRESHOLD` | Minimum score retained by eval, matching production queries | `0.35` |

## Part 5 — Where the code lives

| Path | Role |
|------|------|
| `src/core/rag/eval/metrics.ts` | Pure metric functions (precision/recall/MRR/…), unit-tested |
| `src/core/rag/eval/runner.ts` | Ingests corpus, runs cases, applies reranking, aggregates |
| `src/eval.ts` | `npm run eval` entry point: prints the table, writes JSON |
| `src/core/rag/reranking/reranker.ts` | `Reranker` abstraction |
| `src/core/rag/reranking/llama-reranker.ts` | Local GGUF reranker via node-llama-cpp |
| `src/core/rag/rag-orchestrator.ts` | Query pipeline; applies reranking in production |
| `eval/corpus/`, `eval/dataset.jsonl` | The corpus and the graded questions |

---

## One-paragraph summary (for explaining it to someone)

> We built an automated exam for the search half of our RAG system. We give it questions
> whose correct source document we already know, it runs them through retrieval, and it grades
> whether the right document came back and how highly it was ranked — as numbers like MRR. On
> top of that we added an optional cross-encoder reranker: after the fast vector search fetches
> a shortlist, the reranker rereads each candidate together with the question and reorders them
> by true relevance. Because we had the exam first, we could prove the reranker's value with a
> number: MRR went from 0.95 to 1.0.
