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
- `eval/dataset.jsonl` — questions, each labelled with **which document holds the answer**,
  **which passage** of it, why the case exists, and what class of question it is.
- `eval/gates.json` — the thresholds a run must clear. CI fails the build below them.
- `npm run eval` — ingests the corpus, runs each question through retrieval, and checks
  whether the right document came back. Then it scores the run and prints a report.

Because the answer key is fixed, you can run it before and after any change and compare the
scores.

### 1.2.1 The corpus: why it is deliberately fictional

Most of the corpus describes **Meridian Systems** and its **Corvus** platform — a company and
a product that do not exist. That is the point. On a general-knowledge corpus the LLM answers
correctly whether or not retrieval worked, so the answer metrics measure the model's memory
instead of the pipeline. Nobody's model knows what `CORVUS_QUOTA_EXCEEDED` means, so a right
answer can only have come from retrieval.

The three original general-knowledge documents (solar system, photosynthesis, Roman empire)
are still there, carrying the ten original questions under the `regression` tag, so a change
that breaks the old behaviour still shows up.

### 1.3 The metrics (plain language)

For each question we know which source *should* be retrieved. After running the query we see
which sources *were* retrieved, in order. From that we compute:

| Metric | Question it answers | Range |
|--------|---------------------|-------|
| **hit@k** | Did the right document appear at all (in the top-k)? | 0 or 1 |
| **recall@k** | Of the documents that should appear, how many did? | 0–1 |
| **precision@k** | Of the documents we returned, how many were relevant? | 0–1 |
| **snippet coverage** | Did the specific *passage* holding the answer come back, not just the right file? | 0–1 |
| **MRR** (reciprocal rank) | How *high* was the right document ranked? (1.0 = always first) | 0–1 |
| **keyword coverage** | Does the generated answer mention the expected key facts? | 0–1 |
| **groundedness** | Did the answer come from the sources, or from the model's memory? | 0–1 |
| **abstention accuracy** | Did it answer when it could, and decline when it could not? | 0–1 |
| **false answer rate** | Of the unanswerable questions, how many did it answer anyway? | 0–1, lower better |
| **false retrieval rate** | Of the unanswerable questions, how many still returned chunks? | 0–1, lower better |

#### Source level vs passage level

`expectedSources` grades at file level: the right document came back. That is not the same as
the model getting what it needs — a document can be retrieved through a chunk that says
nothing about the question. `expectedSnippets` closes that gap: each answerable case quotes a
**verbatim phrase** from the corpus, and `snippetCoverage` checks whether that phrase is in the
text actually retrieved.

Phrases rather than chunk ids, on purpose. A chunk id is invalidated by every change to
`CHUNK_SIZE` or `CHUNK_OVERLAP` — exactly the knobs the harness exists to sweep — while a
quoted phrase survives rechunking. A unit test (`runner.test.ts`) verifies every snippet is
still present in its expected source, so an edit to a corpus document that silently
invalidates a case fails the build, with no vector store or embedding model required.

#### Per-tag aggregates

Each case carries `tags` (`direct`, `indirect`, `distractor`, `multi-source`, `near-corpus`,
`out-of-scope`, `regression`, `golden`, …) and the report prints a **per-tag table** under the
aggregate one. This matters more than it sounds: on the current set the overall keyword
coverage is 96%, while the `multi-source` cases sit at 70%. A whole-set mean would have hidden
a class of question the system is measurably bad at.

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

The eval also mirrors production's threshold, so it scores the chunks the model would really
be given rather than ones production would have discarded. Which threshold that is depends on
the run: `RETRIEVAL_THRESHOLD` when scores are cosine similarities, `RERANK_THRESHOLD` when a
reranker produced them. The report prints the scale it used, because "threshold 0.45" means
two different things on the two scales. Sweep either with `EVAL_THRESHOLD` without touching the
app config.

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

You'll see a per-question table, the aggregate lines, a per-tag table and the gate verdicts.
Measured on the shipped corpus with the local bge embedding model, `qwen3:1.7b` for generation
and `EVAL_GENERATE=true`:

```
Evaluation (k=3, threshold=0.45, 66 cases)
Cases: 51 answerable, 15 unanswerable
id                                 ans    P@k    R@k     RR    hit   snip  absOK   gnd
largest-planet                     yes  33.3% 100.0%   1.00     1 100.0%     ok  71.4%
sun-energy                         yes  33.3% 100.0%   0.50     1 100.0%     ok   5.7%   ← ranked 2nd
spec-quota-error-code              yes  66.7% 100.0%   1.00     1 100.0%     ok  41.2%
multi-sev1-page-and-sla            yes  66.7%  50.0%   1.00     1  50.0%     ok  22.0%   ← one of two documents
...
unanswerable-thirdparty-engine-names no     -      -      -     -      -   FAIL  17.5%
--------------------------------------------------------------------------
RETRIEVAL (answerable only)  P@k= 56.2%  R@k= 98.0%  MRR= 0.928  hitRate=100.0%  snippet= 98.0%
ABSTENTION                   accuracy= 92.4%  falseAnswerRate= 20.0%  falseRetrievalRate=100.0%
ANSWER                       kwCoverage= 96.2%  groundedness= 36.8%
LATENCY                      retrieval=    19ms  generation=  3576ms
```

Read the retrieval line as: every answerable question retrieves the right document
(**hitRate 100%**), but ranking is imperfect (**MRR 0.928**) and 2% of the answer-bearing
passages never make it into the top 3 (**snippet 98%**). Unanswerable rows show `-` for
retrieval metrics by design — see
[Answerable vs unanswerable cases](#answerable-vs-unanswerable-cases).

The abstention line is where hallucination shows up:

- `falseAnswerRate = 20%` — the model answered three questions the corpus cannot answer,
  including inventing a latency SLA that appears nowhere. The prompt alone does not hold the
  line once the questions get close enough to the corpus.
- `falseRetrievalRate = 100%` — retrieval returned above-threshold chunks for **every**
  unanswerable question. On-topic, above threshold, not answer-bearing.

That is a retrieval/threshold problem, and it is invisible to P@k and recall. It is exactly
what these metrics exist to surface.

> **Generation metrics move between runs.** Two consecutive runs of this same commit reported
> `falseAnswerRate` 13.3% and 20.0%, and `abstentionAccuracy` 95.5% and 92.4%. The LLM is
> non-deterministic, so these numbers are a signal, not a contract — which is why CI never
> gates on them.

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

Note that the command sets no threshold. That is deliberate — see the box below.

On the current corpus, each mode at **its own** configured threshold:

| Metric | Reranker OFF (cosine ≥ 0.45) | Reranker ON (relevance ≥ 0.1) |
|---|---|---|
| P@k | 56.2% | **88.2%** |
| R@k | 98.0% | **99.0%** |
| MRR | 0.928 | **0.990** |
| hitRate | 100.0% | 100.0% |
| snippetCoverage | **98.0%** | 97.1% |
| falseRetrievalRate | 100.0% | **33.3%** |
| multi-source R@k | 80.0% | **90.0%** |
| retrieval latency | **17ms** | 1449ms |

The reranker wins on ranking outright — MRR 0.928 → 0.990 — and cuts false retrieval by two
thirds, because it reads each `(question, chunk)` pair together where cosine similarity never
does. It costs ~1.4 s per query, still under half of generation.

> ### The mistake this section used to make
>
> An earlier version of this table ran both modes at `0.45` and concluded that the reranker
> *loses* recall (hitRate 100% → 92.2%). It does not. `0.45` is a **cosine** number; on the
> cross-encoder's probability scale it is a far stricter cut, so the reranker was being asked
> to discard almost everything. Sweeping its own scale:
>
> | Reranker threshold | hitRate | R@k | falseRetrievalRate | multi-source R@k |
> |---|---|---|---|---|
> | 0.05 | 100.0% | 100.0% | 66.7% | 100.0% |
> | **0.10** | **100.0%** | 99.0% | 33.3% | 90.0% |
> | 0.20 | 98.0% | 96.1% | 20.0% | 80.0% |
> | 0.45 | 92.2% | 91.2% | 13.3% | 70.0% |
>
> The "cost" was entirely the units. This is why `RETRIEVAL_THRESHOLD` and `RERANK_THRESHOLD`
> are separate settings, why the orchestrator picks between them based on what **actually
> ran** (a reranker that throws leaves cosine scores behind), and why the query response
> reports `scoreScale`. If you carry a tuned threshold from one mode to the other, you will
> measure a units error and believe it is a quality result.

### Step 4b — Does the embedding model matter?

Same protocol, reranker off, each model at its own best operating point:

| | bge-small (local GGUF, 36 MB) | nomic-embed-text (Ollama, 274 MB) |
|---|---|---|
| MRR | 0.928 | **0.944** |
| snippetCoverage | **98.0%** | 97.1% |
| multi-source R@k | 80.0% | **90.0%** |
| score spread | narrow — thresholding barely bites | **wide — thresholding works** |

nomic wins, and it is the shipped default. But the honest caveat is bigger than the result:
**with the reranker on, the two models score identically** (P@k 88.2%, MRR 0.990, snippet 97.1%
for both), and they stay within a point of each other even when the candidate pool is narrowed
to `RERANK_FETCH_K=5`. With 21 chunks in the store the reranker sees nearly every candidate and
overwrites the embedding's ranking entirely. So on this corpus the embedding choice is only
measurable on the no-reranker path. That is "no difference detectable here", not "no
difference" — telling embedding models apart needs a store large enough that the shortlist
actually excludes something.

### Step 5 — Check the gates

`eval/gates.json` holds the thresholds a run must clear:

```json
{
  "aggregate": { "hitRate": { "min": 0.95 }, "snippetCoverage": { "min": 0.92 } },
  "byTag": { "regression": { "hitRate": { "min": 1.0 } }, "multi-source": { "recallAtK": { "min": 0.7 } } }
}
```

Every run prints the verdicts. Locally they are informational; with `EVAL_GATE=true` a miss
exits non-zero, which is what CI does:

```bash
EVAL_GATE=true EMBEDDING_PROVIDER=llama npm run eval
```

```
Gates (11/11 passed)
  [ ok ] aggregate.hitRate (min 95.0%): PASS
  [ ok ] tag:regression.hitRate (min 100.0%): PASS
  [ ok ] tag:multi-source.recallAtK (min 70.0%): PASS
  ...
```

Two rules are enforced in code, not by convention:

- **Only deterministic retrieval metrics may gate.** Writing `groundedness` or
  `falseAnswerRate` into the file is a hard error — those come from a non-deterministic LLM,
  and a threshold on them fails builds on noise instead of on regressions.
- **A metric the run did not produce is a failure, not a pass.** A gate that quietly
  disappears with its metric is worse than no gate: the build stays green while the thing it
  guards stops being measured. Same for a per-tag gate whose tag no case carries any more.

### Step 6 — Use reranking in the running API

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
{"id": "my-question", "question": "What ...?", "expectedSources": ["my-doc.txt"], "expectedKeywords": ["fact1", ["25 percent", "25%"]], "expectedSnippets": ["the exact phrase from my-doc.txt"], "tags": ["golden", "direct"], "rationale": "Section 3 of my-doc.txt; stated once, verbatim."}
```

- `expectedSources` — the file name(s) whose chunks should be retrieved. Drives the retrieval
  metrics. Empty for a question the corpus cannot answer.
- `expectedSnippets` — **required for answerable cases** (a unit test enforces it). Verbatim
  phrases from the corpus that correct retrieval must surface. Drives snippet coverage.
  Matching ignores case and whitespace, so a phrase may span a line break in the source file.
- `expectedKeywords` — optional; key facts the generated answer should contain. Drives keyword
  coverage (only scored when answer generation is on, see below). An entry may be an **array
  of accepted spellings of the same fact** — `["25 percent", "25%"]` counts as one fact, so a
  correct answer is not scored a miss for phrasing.
- `expectedAnswerable` — optional; defaults to `expectedSources.length > 0`. Set it to `false`
  explicitly for a question that is unanswerable *even though related documents exist*.
- `expectedRefusal` — optional; why the case is unanswerable. Documentation for whoever reads
  the report later, not scored.
- `tags` — what class of question this is. Drives the per-tag table and lets a gate protect one
  class specifically. Conventional tags: `regression`, `golden`, `direct`, `indirect`,
  `distractor`, `multi-source`, `unanswerable`, `near-corpus`, `out-of-scope`, plus one per
  source document.
- `rationale` — one sentence on why the case exists and where its answer comes from. Not
  scored. It is what makes a disputed answer key settleable six months later.

The dataset invariants (unique ids, snippets that still occur in their source, a rationale on
every case, at least two sources on a `multi-source` case) are checked by unit tests, so a
malformed addition fails `npm test` rather than quietly skewing a run.

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

- **Make sure the answers are not already in the model's head.** On a general-knowledge corpus
  the LLM answers correctly whether or not retrieval worked, so keyword coverage measures
  nothing. This is why the Corvus documents are fictional; write new ones the same way.
- Include **distractor documents** on similar topics so vector search has to discriminate —
  that's where reranking earns its keep. Better still, write **distractor pairs**: two
  questions that share vocabulary but live in different documents (the Gold tier's SLA is in
  the support policy; the Gold tier's ingest quota is in the spec).
- Cover **direct** (wording close to the document), **indirect** (needs a synonym or an
  inference) and **multi-source** questions. Prefer a single correct source for clean MRR
  interpretation, and tag the multi-source ones so their recall is read separately.
- **Add unanswerable cases in both flavours** — fully out of scope, and deliberately close to
  the corpus. The near-corpus ones are what catch hallucination.
- Make the documents **long enough to split into several chunks**. If every file is one chunk,
  `CHUNK_OVERLAP` and `RERANK_FETCH_K` have nothing to act on and their A/Bs are meaningless.
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
| `EVAL_THRESHOLD` | Minimum score a chunk must reach; sweeps the cut without touching app config | the scale's configured threshold |
| `RETRIEVAL_THRESHOLD` | Minimum **cosine similarity**; applies when reranking did not run | `0.35` |
| `RERANK_THRESHOLD` | Minimum **cross-encoder relevance**; applies when reranking ran | `0.1` |
| `EVAL_GATE` | Exit non-zero when a threshold in `eval/gates.json` is missed | `false` |
| `RAG_TOP_K` | Final number of chunks kept (`k` in the metrics) | `3` |

## Part 5 — Where the code lives

| Path | Role |
|------|------|
| `src/core/rag/eval/metrics.ts` | Pure metric functions (precision/recall/MRR/…), unit-tested |
| `src/core/rag/eval/runner.ts` | Ingests corpus, runs cases, applies reranking + threshold, aggregates |
| `src/core/rag/llm/abstention.ts` | The `NO_ANSWER` sentinel protocol shared by the prompt, the API and the eval |
| `src/core/rag/eval/gates.ts` | Gate thresholds: parsing, validation, verdicts; unit-tested |
| `src/eval.ts` | `npm run eval` entry point: prints the tables and gates, writes JSON |
| `src/core/rag/reranking/reranker.ts` | `Reranker` abstraction |
| `src/core/rag/reranking/llama-reranker.ts` | Local GGUF reranker via node-llama-cpp |
| `src/core/rag/rag-orchestrator.ts` | Query pipeline; applies reranking in production |
| `eval/corpus/`, `eval/dataset.jsonl` | The corpus and the graded questions |
| `eval/gates.json` | The thresholds CI enforces |
| `.github/workflows/ci.yml` | Build + unit tests, and the deterministic retrieval eval as a merge gate |
| `.github/workflows/eval-full.yml` | Nightly/manual full run with generation; reported, never a gate |

---

## Part 6 — CI

Two workflows, on purpose:

| Workflow | When | Gates the build? |
|---|---|---|
| `ci.yml` | every push and PR | **Yes** — build, unit tests, and the deterministic retrieval eval against `eval/gates.json` |
| `eval-full.yml` | nightly + manual | No — the full run including generation; metrics reported and uploaded as an artifact |

The split is not squeamishness about slow jobs. The retrieval half needs only a local 36 MB
embedding model and a ChromaDB service container, and it gives the same answer every time, so
a threshold on it means something. The generation half needs an LLM, takes minutes, and
returns different numbers on identical code — gating it would teach everyone to rerun until
green, which is worse than not gating at all.

The cheapest check of all is in the unit tests: the answer key is verified against the corpus
with no services running, so an edited document that invalidates a case fails immediately.

---

## One-paragraph summary (for explaining it to someone)

> We built an automated exam for the search half of our RAG system. We give it questions whose
> correct source document — and correct *passage* — we already know, it runs them through
> retrieval, and it grades whether the right text came back and how highly it was ranked. Most
> of the corpus describes a company that does not exist, so a right answer can only have come
> from retrieval and not from the model's memory. The exam runs on every pull request and fails
> the build when the deterministic scores drop. Having it first is what let us measure rather
> than guess — including catching our own error: we first concluded the cross-encoder reranker
> costs recall, then found we had been grading it with a threshold borrowed from a different
> score scale. At its own threshold it beats plain vector search on every retrieval metric. An
> eval you can re-run is what turns a confident wrong answer into a corrected one.
