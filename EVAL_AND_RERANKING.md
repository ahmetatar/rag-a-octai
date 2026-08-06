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
| **groundedness** | Did the answer come from the sources, or from the model's memory? | 0–1 |
| **abstention accuracy** | Did it answer when it could, and decline when it could not? | 0–1 |
| **false answer rate** | Of the unanswerable questions, how many did it answer anyway? | 0–1, lower better |
| **false retrieval rate** | Of the unanswerable questions, how many still returned chunks? | 0–1, lower better |

> **Why P@k can look "low":** if a question has one correct document and we return `k=3`
> chunks, the best possible precision is 1/3 = 33%. So on a single-answer dataset, **MRR** is
> the metric that really reflects ranking quality, not P@k.

#### Answerable vs unanswerable cases

The dataset contains questions the corpus **cannot** answer — some far out of scope, some
deliberately close to the corpus ("How far is Jupiter from the Sun?" when the corpus discusses
Jupiter but never distances). These carry `"expectedAnswerable": false` and no expected
sources.

Retrieval metrics (P@k, R@k, MRR, hit) are computed **only over answerable cases**, and print
as `-` for the rest. Recall over an empty relevant set is undefined, and the tempting shortcut
of scoring it 1 "vacuously" hands every unanswerable case a perfect score no matter what junk
it retrieved. Unanswerable cases are judged by the abstention metrics instead.

The system signals "I cannot answer this" with an internal `NO_ANSWER` sentinel token
(`src/core/rag/llm/abstention.ts`), which is what makes abstention measurable rather than a
guess at free-form prose. The token never reaches an API client — it is replaced by a plain
message and the `abstained` flag on the response.

**False answer** and **false retrieval** are tracked separately because they have different
fixes: false retrieval is a threshold or embedding problem, while a false answer on top of it
is a prompting problem.

> **Groundedness is a proxy, not a judge.** It measures word-trigram overlap between the
> answer and the retrieved chunks. A correct answer phrased in the model's own words scores
> low; a fluent paraphrase of the *wrong* chunk scores high. Read it as a relative signal
> across runs.

The eval also mirrors production's `RETRIEVAL_THRESHOLD`, so it scores the chunks the model
would really be given rather than ones production would have discarded. Sweep it with
`EVAL_THRESHOLD` without touching the app config.

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

You'll see a per-question table and aggregate lines. Measured on the shipped corpus with the
local bge embedding model, `qwen3:1.7b` for generation and `EVAL_GENERATE=true`:

```
Evaluation (k=3, threshold=0.45, 17 cases)
Cases: 10 answerable, 7 unanswerable
id                                 ans    P@k    R@k     RR    hit  absOK   gnd
largest-planet                     yes  33.3% 100.0%   1.00     1     ok  71.4%
sun-energy                         yes  50.0% 100.0%   0.50     1     ok   5.7%   ← ranked 2nd
...
unanswerable-saturn-moons           no      -      -      -     -     ok      -
unanswerable-out-of-scope-capital   no      -      -      -     -     ok      -
------------------------------------------------------------------
RETRIEVAL (answerable only)  P@k= 61.7%  R@k=100.0%  MRR= 0.950  hitRate=100.0%
ABSTENTION                   accuracy=100.0%  falseAnswerRate=  0.0%  falseRetrievalRate= 85.7%
ANSWER                       kwCoverage=100.0%  groundedness= 38.7%
LATENCY                      retrieval=    17ms  generation=  2103ms
```

Read the retrieval line as: every answerable question retrieves the right document
(**hitRate 100%**), but one case (`sun-energy`) ranked it **second** (RR = 0.50), dragging
**MRR down to 0.950**. Unanswerable rows show `-` for retrieval metrics by design — see
[Answerable vs unanswerable cases](#answerable-vs-unanswerable-cases).

The abstention line is where hallucination shows up, and this run splits the two failures
cleanly:

- `falseAnswerRate = 0%` — the model never answered a question the corpus could not answer.
  The prompt is holding the line.
- `falseRetrievalRate = 85.7%` — but retrieval still returned chunks for **6 of 7**
  unanswerable questions. They were on-topic and above threshold, just not answer-bearing.

That is a retrieval/threshold problem sitting behind a prompt that currently compensates for
it. It is invisible to P@k and recall, and it is exactly what these metrics exist to surface.

> **`kwCoverage = 100%` here means nothing.** The shipped corpus is general knowledge, so
> `qwen3` produces the expected keywords whether or not retrieval worked — see the dataset
> tips below. `groundedness = 38.7%` is the more honest signal: the answers are largely
> phrased in the model's own words rather than lifted from the chunks.

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
id                     ans    P@k    R@k     RR    hit  absOK   gnd
sun-energy             yes  33.3% 100.0%   1.00      1     ok  68.0%   ← now ranked 1st
...
RETRIEVAL (answerable only)  P@k=33.3%  R@k=100.0%  MRR= 1.000  hitRate=100.0%
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
{"id": "my-question", "question": "What ...?", "expectedSources": ["my-doc.txt"], "expectedKeywords": ["fact1", "fact2"]}
```

- `expectedSources` — the file name(s) whose chunks should be retrieved. Drives the retrieval
  metrics. Empty for a question the corpus cannot answer.
- `expectedKeywords` — optional; key facts the generated answer should contain. Drives
  keyword coverage (only scored when answer generation is on, see below).
- `expectedAnswerable` — optional; defaults to `expectedSources.length > 0`. Set it to `false`
  explicitly for a question that is unanswerable *even though related documents exist*.
- `expectedRefusal` — optional; why the case is unanswerable. Documentation for whoever reads
  the report later, not scored.

An unanswerable case looks like this:

```json
{"id": "unanswerable-saturn-moons", "question": "How many moons does Saturn have?", "expectedSources": [], "expectedAnswerable": false, "expectedRefusal": "Saturn appears in the corpus, but only its rings are described."}
```

**Add unanswerable cases in both flavours:** fully out of scope, *and* deliberately close to
the corpus. The near-corpus ones are what actually catch hallucination — retrieval will
happily return on-topic chunks that do not contain the answer, and the question is whether the
system notices.

### Score generated answers too

```bash
EVAL_GENERATE=true EMBEDDING_PROVIDER=llama npm run eval
```

This also runs the LLM and adds the **keyword coverage**, **groundedness** and **abstention**
metrics. It needs a reachable LLM (Ollama or a local generation model); without one it skips
answer metrics and still reports retrieval metrics — including `falseRetrievalRate`, which is
retrieval-only and so is reported either way.

### Tips for a meaningful dataset

- Include **distractor documents** on similar topics so vector search has to discriminate —
  that's where reranking earns its keep.
- Prefer questions with a **single correct source** for clean MRR interpretation.
- **Make sure the answers are not already in the model's head.** On a general-knowledge corpus
  the LLM answers correctly whether or not retrieval worked, so keyword coverage measures
  nothing. Domain-specific content the model cannot know is what makes answer metrics real.
- Keep the corpus small and fast; the harness is meant to run often.

---

## Part 4 — Configuration reference

| Variable | Meaning | Default |
|----------|---------|---------|
| `RERANK_ENABLED` | Turn cross-encoder reranking on | `false` |
| `RERANK_MODEL_PATH` | Path to a GGUF reranker model | – |
| `RERANK_FETCH_K` | Candidates fetched before reranking down to `topK` | `20` |
| `EVAL_COLLECTION` | ChromaDB collection the harness uses | `eval_harness` |
| `EVAL_GENERATE` | Also generate answers and score answer/abstention metrics | `false` |
| `EVAL_THRESHOLD` | Minimum score a chunk must reach; sweeps the cut without touching app config | `RETRIEVAL_THRESHOLD` |
| `RAG_TOP_K` | Final number of chunks kept (`k` in the metrics) | `3` |

## Part 5 — Where the code lives

| Path | Role |
|------|------|
| `src/core/rag/eval/metrics.ts` | Pure metric functions (precision/recall/MRR/…), unit-tested |
| `src/core/rag/eval/runner.ts` | Ingests corpus, runs cases, applies reranking + threshold, aggregates |
| `src/core/rag/llm/abstention.ts` | The `NO_ANSWER` sentinel protocol shared by the prompt, the API and the eval |
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
