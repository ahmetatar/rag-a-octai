/**
 * One evaluation case: a question and what a correct system should retrieve/answer.
 */
export interface EvalCase {
  /** Stable identifier for the case. */
  id: string;
  /** The question to ask. */
  question: string;
  /** Source file names that should be retrieved for this question. */
  expectedSources: string[];
  /** Key facts the generated answer should mention (optional; enables answer scoring). */
  expectedKeywords?: string[];
}

/**
 * The scored result for a single evaluation case.
 */
export interface EvalCaseResult {
  id: string;
  question: string;
  /** Source names retrieved, in rank order. */
  retrievedSources: string[];
  precisionAtK: number;
  recallAtK: number;
  reciprocalRank: number;
  hit: number;
  /** Present only when answers were generated. */
  keywordCoverage?: number;
  /** The generated answer, when generation was enabled. */
  answer?: string;
}

/**
 * Aggregate scores across all cases (means of the per-case metrics).
 */
export interface EvalAggregate {
  precisionAtK: number;
  recallAtK: number;
  mrr: number;
  hitRate: number;
  keywordCoverage?: number;
}

/**
 * A full evaluation report, suitable for printing and for diffing across runs.
 */
export interface EvalReport {
  /** The retrieval cut-off used. */
  k: number;
  /** Whether answers were generated (and answer metrics computed). */
  generatedAnswers: boolean;
  cases: EvalCaseResult[];
  aggregate: EvalAggregate;
}
