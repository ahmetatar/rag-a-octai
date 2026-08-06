import { promises as fs } from 'fs';
import path from 'path';
import config from '@app/config';
import { createPdfPageFileHandler, createReranker, createTextFileHandler, registerFileHandlers } from '@core/rag';
import { EvalReport, runEval } from '@core/rag/eval';
import { logger } from '@infrastructure/logging';

const EVAL_DIR = path.resolve('eval');
const RESULTS_DIR = path.join(EVAL_DIR, 'results');

/**
 * Entry point for `npm run eval`.
 *
 * Ingests eval/corpus into a dedicated collection, scores eval/dataset.jsonl, prints a
 * table, and writes the full report to eval/results/latest.json so runs can be diffed
 * (e.g. before/after a retrieval change).
 *
 * Set EVAL_GENERATE=true to also generate answers and score keyword coverage (needs a
 * reachable LLM). Retrieval metrics need only an embedding model and ChromaDB.
 */
async function main(): Promise<void> {
  registerFileHandlers({
    'text/plain': createTextFileHandler(),
    'application/pdf': createPdfPageFileHandler(),
  });

  // Honours RERANK_ENABLED/RERANK_MODEL_PATH, so `RERANK_ENABLED=true npm run eval` measures
  // the reranked pipeline and can be compared against a plain run.
  const reranker = await createReranker();

  const report = await runEval({
    corpusDir: path.join(EVAL_DIR, 'corpus'),
    datasetPath: path.join(EVAL_DIR, 'dataset.jsonl'),
    collection: process.env.EVAL_COLLECTION || 'eval_harness',
    topK: config.topK,
    tenantId: 'eval',
    generateAnswers: process.env.EVAL_GENERATE === 'true',
    reranker,
    fetchK: config.rerankFetchK,
    // Mirrors production's cut by default; EVAL_THRESHOLD sweeps it without touching the app.
    threshold: process.env.EVAL_THRESHOLD ? parseFloat(process.env.EVAL_THRESHOLD) : config.retrievalThreshold,
  });

  logger.info(`Reranking: ${reranker ? 'ON' : 'OFF'}`);
  printReport(report);
  await writeReport(report);
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

  logger.info(`\nEvaluation (k=${report.k}, threshold=${report.threshold}, ${breakdown.total} cases)`);
  logger.info(`Cases: ${breakdown.answerable} answerable, ${breakdown.unanswerable} unanswerable`);
  logger.info(`${'id'.padEnd(idWidth)}  ans    P@k    R@k     RR    hit  absOK   gnd`);
  for (const c of report.cases) {
    const row = [
      c.id.padEnd(idWidth),
      (c.answerable ? 'yes' : 'no').padStart(4),
      pct(c.precisionAtK),
      pct(c.recallAtK),
      num(c.reciprocalRank),
      (c.hit === undefined ? '-' : String(c.hit)).padStart(5),
      (c.abstentionCorrect === undefined ? '-' : c.abstentionCorrect ? 'ok' : 'FAIL').padStart(6),
      pct(c.groundedness),
    ].join(' ');
    logger.info(row);
  }

  const a = report.aggregate;
  logger.info('------------------------------------------------------------------');
  logger.info(
    `RETRIEVAL (answerable only)  P@k=${pct(a.precisionAtK)}  R@k=${pct(a.recallAtK)}  ` +
      `MRR=${num(a.mrr, 3)}  hitRate=${pct(a.hitRate)}`
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
  logger.info(
    `LATENCY                      retrieval=${num(a.retrievalMs, 0)}ms  generation=${num(a.generationMs, 0)}ms`
  );
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
