import { promises as fs } from 'fs';
import path from 'path';
import config from '@app/config';
import { createPdfPageFileHandler, createTextFileHandler, registerFileHandlers } from '@core/rag';
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

  const report = await runEval({
    corpusDir: path.join(EVAL_DIR, 'corpus'),
    datasetPath: path.join(EVAL_DIR, 'dataset.jsonl'),
    collection: process.env.EVAL_COLLECTION || 'eval_harness',
    topK: config.topK,
    tenantId: 'eval',
    generateAnswers: process.env.EVAL_GENERATE === 'true',
  });

  printReport(report);
  await writeReport(report);
}

/**
 * Prints a per-case table and the aggregate scores.
 * @param report The evaluation report.
 */
function printReport(report: EvalReport): void {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

  logger.info(`\nEvaluation (k=${report.k}, ${report.cases.length} cases)`);
  logger.info('id                     P@k    R@k    RR     hit');
  for (const c of report.cases) {
    const row = [
      c.id.padEnd(22),
      pct(c.precisionAtK).padStart(6),
      pct(c.recallAtK).padStart(6),
      c.reciprocalRank.toFixed(2).padStart(6),
      String(c.hit).padStart(4),
    ].join(' ');
    logger.info(row);
  }

  const a = report.aggregate;
  logger.info('----------------------------------------------');
  logger.info(
    `AGGREGATE               P@k=${pct(a.precisionAtK)}  R@k=${pct(a.recallAtK)}  ` +
      `MRR=${a.mrr.toFixed(3)}  hitRate=${pct(a.hitRate)}` +
      (a.keywordCoverage !== undefined ? `  kwCoverage=${pct(a.keywordCoverage)}` : '')
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
