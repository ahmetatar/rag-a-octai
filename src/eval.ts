import { promises as fs } from 'fs';
import path from 'path';
import config from '@app/config';
import { createPdfPageFileHandler, createQueryExpander, createReranker, createTextFileHandler, registerFileHandlers } from '@core/rag';
import { EvalReport, GateConfig, GateResult, LlmJudge, evaluateGates, parseGateConfig, runEval } from '@core/rag/eval';
import { logger } from '@infrastructure/logging';

const EVAL_DIR = path.resolve('eval');
const RESULTS_DIR = path.join(EVAL_DIR, 'results');
const GATES_PATH = path.join(EVAL_DIR, 'gates.json');

/**
 * Entry point for `npm run eval`.
 *
 * Ingests eval/corpus into a dedicated collection, scores eval/dataset.jsonl, prints a
 * table, and writes the full report to eval/results/latest.json so runs can be diffed
 * (e.g. before/after a retrieval change).
 *
 * Set EVAL_GENERATE=true to also generate answers and score keyword coverage (needs a
 * reachable LLM). Retrieval metrics need only an embedding model and ChromaDB.
 *
 * Set EVAL_GATE=true to exit non-zero when the run misses a threshold in eval/gates.json.
 * That is what CI runs; a local run reports the gates but never fails on them.
 *
 * Set EVAL_JUDGE=true to additionally have an LLM judge (EVAL_JUDGE_MODEL, default the
 * generation model) give an absolute correctness verdict on answered cases — layered on top
 * of the deterministic groundedness proxy, never gated (see {@link LlmJudge}). Requires
 * EVAL_GENERATE=true.
 *
 * Honours QUERY_STRATEGY (none/rewrite/multi-query/hyde), so e.g.
 * `QUERY_STRATEGY=hyde npm run eval` measures that expansion strategy against a plain run.
 */
async function main(): Promise<void> {
  registerFileHandlers({
    'text/plain': createTextFileHandler(),
    'application/pdf': createPdfPageFileHandler(),
  });

  // Honours RERANK_ENABLED/RERANK_MODEL_PATH, so `RERANK_ENABLED=true npm run eval` measures
  // the reranked pipeline and can be compared against a plain run.
  const reranker = await createReranker();
  const queryExpander = createQueryExpander();
  const generateAnswers = process.env.EVAL_GENERATE === 'true';
  const judge =
    generateAnswers && process.env.EVAL_JUDGE === 'true'
      ? new LlmJudge(config.evalJudgeModel || config.generationModel, config.ollamaHost)
      : undefined;

  const report = await runEval({
    corpusDir: path.join(EVAL_DIR, 'corpus'),
    datasetPath: path.join(EVAL_DIR, 'dataset.jsonl'),
    collection: process.env.EVAL_COLLECTION || 'eval_harness',
    topK: config.topK,
    tenantId: 'eval',
    generateAnswers,
    reranker,
    fetchK: config.rerankFetchK,
    // Left undefined by default so the runner picks the threshold for the score scale this
    // run actually produces; EVAL_THRESHOLD sweeps it without touching the app config.
    threshold: process.env.EVAL_THRESHOLD ? parseFloat(process.env.EVAL_THRESHOLD) : undefined,
    judge,
    promptCostPer1k: config.evalPromptCostPer1k,
    completionCostPer1k: config.evalCompletionCostPer1k,
    queryExpander,
  });

  logger.info(`Reranking: ${reranker ? 'ON' : 'OFF'}`);
  logger.info(`Query strategy: ${config.queryStrategy}`);
  printReport(report);
  await writeReport(report);

  const gates = await loadGates();
  if (gates) {
    const results = evaluateGates(report, gates);
    printGates(results);
    // Enforced only when asked. A local run is usually an experiment — a sweep of the
    // threshold, a half-finished corpus — and failing it would train people to pass a flag to
    // silence it. CI sets EVAL_GATE=true and gets the hard failure.
    if (process.env.EVAL_GATE === 'true' && results.some((result) => !result.passed)) {
      logger.error('Evaluation gates failed.');
      process.exit(1);
    }
  }
}

/**
 * Prints a per-case table and the aggregate scores.
 * @param report The evaluation report.
 */
function printReport(report: EvalReport): void {
  // A dash rather than a zero for an unscored metric: an unanswerable case has no recall,
  // and printing 0.0% would read as a failure instead of as "not applicable".
  const pct = (value?: number) => (value === undefined ? '     -' : `${(value * 100).toFixed(1)}%`.padStart(6));
  const num = (value?: number, digits = 2) => (value === undefined ? '     -' : value.toFixed(digits).padStart(6));

  const { breakdown } = report;
  // Width the id column to the longest id present, so adding a long case id does not shift
  // every other row out of its column.
  const idWidth = Math.max(2, ...report.cases.map((c) => c.id.length));

  logger.info(
    `\nEvaluation (k=${report.k}, threshold=${report.threshold} on the ${report.scoreScale} scale, ` +
      `${breakdown.total} cases)`
  );
  logger.info(`Cases: ${breakdown.answerable} answerable, ${breakdown.unanswerable} unanswerable`);
  logger.info(`${'id'.padEnd(idWidth)}  ans    P@k    R@k     RR    hit   snip  absOK   gnd`);
  for (const c of report.cases) {
    const row = [
      c.id.padEnd(idWidth),
      (c.answerable ? 'yes' : 'no').padStart(4),
      pct(c.precisionAtK),
      pct(c.recallAtK),
      num(c.reciprocalRank),
      (c.hit === undefined ? '-' : String(c.hit)).padStart(5),
      pct(c.snippetCoverage),
      (c.abstentionCorrect === undefined ? '-' : c.abstentionCorrect ? 'ok' : 'FAIL').padStart(6),
      pct(c.groundedness),
    ].join(' ');
    logger.info(row);
  }

  const a = report.aggregate;
  logger.info('--------------------------------------------------------------------------');
  logger.info(
    `RETRIEVAL (answerable only)  P@k=${pct(a.precisionAtK)}  R@k=${pct(a.recallAtK)}  ` +
      `MRR=${num(a.mrr, 3)}  hitRate=${pct(a.hitRate)}  snippet=${pct(a.snippetCoverage)}`
  );
  if (breakdown.unanswerable > 0) {
    logger.info(
      `ABSTENTION                   accuracy=${pct(a.abstentionAccuracy)}  ` +
        `falseAnswerRate=${pct(a.falseAnswerRate)}  falseRetrievalRate=${pct(a.falseRetrievalRate)}`
    );
  }
  if (report.generatedAnswers) {
    logger.info(`ANSWER                       kwCoverage=${pct(a.keywordCoverage)}  groundedness=${pct(a.groundedness)}`);
  }
  if (a.judgeAccuracy !== undefined) {
    logger.info(`JUDGE                        accuracy=${pct(a.judgeAccuracy)}`);
  }
  logger.info(
    `LATENCY                      retrieval=${num(a.retrievalMs, 0)}ms  generation=${num(a.generationMs, 0)}ms`
  );
  if (a.totalPromptTokens !== undefined || a.totalCompletionTokens !== undefined) {
    const cost = a.totalCostUsd !== undefined ? `  cost=$${a.totalCostUsd.toFixed(4)}` : '';
    logger.info(
      `TOKENS                       prompt=${a.totalPromptTokens ?? 0}  completion=${a.totalCompletionTokens ?? 0}${cost}`
    );
  }

  printByTag(report);
}

/**
 * Prints the per-tag aggregates. A whole-set mean can stay flat while one class of question
 * collapses; this table is where that shows.
 * @param report The evaluation report.
 */
function printByTag(report: EvalReport): void {
  const pct = (value?: number) => (value === undefined ? '     -' : `${(value * 100).toFixed(1)}%`.padStart(6));
  const num = (value?: number, digits = 3) => (value === undefined ? '     -' : value.toFixed(digits).padStart(6));

  const tags = Object.keys(report.byTag);
  if (tags.length === 0) {
    return;
  }

  const tagWidth = Math.max(3, ...tags.map((tag) => tag.length));
  logger.info(`\nBy tag (a case counts under every tag it carries, so these do not sum to the total)`);
  logger.info(`${'tag'.padEnd(tagWidth)}      n    P@k    R@k    MRR    hit   snip  falseRetr`);
  for (const tag of tags) {
    const a = report.byTag[tag];
    logger.info(
      [
        tag.padEnd(tagWidth),
        String(report.breakdown.byTag[tag] ?? 0).padStart(6),
        pct(a.precisionAtK),
        pct(a.recallAtK),
        num(a.mrr),
        pct(a.hitRate),
        pct(a.snippetCoverage),
        pct(a.falseRetrievalRate).padStart(10),
      ].join(' ')
    );
  }
}

/**
 * Prints the gate verdicts.
 * @param results The evaluated gates.
 */
function printGates(results: GateResult[]): void {
  const failed = results.filter((result) => !result.passed);
  logger.info(`\nGates (${results.length - failed.length}/${results.length} passed)`);
  for (const result of results) {
    const bound = [
      result.bound.min !== undefined ? `min ${(result.bound.min * 100).toFixed(1)}%` : '',
      result.bound.max !== undefined ? `max ${(result.bound.max * 100).toFixed(1)}%` : '',
    ]
      .filter(Boolean)
      .join(', ');
    const verdict = result.passed ? 'PASS' : `FAIL — ${result.reason}`;
    logger.info(`  [${result.passed ? ' ok ' : 'FAIL'}] ${result.scope}.${result.metric} (${bound}): ${verdict}`);
  }
}

/**
 * Loads eval/gates.json when it exists.
 * @returns The gate config, or undefined when no gates file is present.
 */
async function loadGates(): Promise<GateConfig | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(GATES_PATH, 'utf-8');
  } catch {
    return undefined;
  }

  return parseGateConfig(JSON.parse(raw));
}

/**
 * Writes the report to eval/results/latest.json.
 * @param report The evaluation report.
 */
async function writeReport(report: EvalReport): Promise<void> {
  await fs.mkdir(RESULTS_DIR, { recursive: true });
  const target = path.join(RESULTS_DIR, 'latest.json');
  await fs.writeFile(target, JSON.stringify(report, null, 2));
  logger.info(`\nReport written to ${target}`);
}

main().catch((error) => {
  logger.error(`Evaluation failed: ${error instanceof Error ? error.stack ?? error.message : error}`);
  process.exit(1);
});
