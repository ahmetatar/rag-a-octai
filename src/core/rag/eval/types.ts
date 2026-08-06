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
  /**
   * Whether the indexed corpus contains enough information to answer this question.
   * Defaults to true for legacy cases that name an expected source, otherwise false.
   */
  expectedAnswerable?: boolean;
  /**
   * Whether an unanswerable case must produce a safe refusal rather than an answer.
   * Defaults to true when expectedAnswerable is false.
   */
  expectedRefusal?: boolean;
  /** Key facts the generated answer should mention (optional; enables answer scoring). */
  expectedKeywords?: string[];
}

/**
 * The scored result for a single evaluation case.
 */
export interface EvalCaseResult {
  id: string;
  question: string;
  /** Whether this case is expected to be answerable from the eval corpus. */
  expectedAnswerable: boolean;
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
  /** 1 when an unanswerable case still returned one or more sources after thresholding. */
  falseRetrieval?: number;
  /** 1 when the generated response safely declined an unanswerable question. */
  abstained?: number;
  /** 1 when the generated response attempted to answer an unanswerable question. */
  falseAnswer?: number;
}

/**
 * Aggregate scores across all cases (means of the per-case metrics).
 */
export interface EvalAggregate {
  /** Number of cases expected to be answerable. */
  answerableCases: number;
  /** Number of cases expected to be unanswerable. */
  unanswerableCases: number;
  precisionAtK: number;
  recallAtK: number;
  mrr: number;
  hitRate: number;
  keywordCoverage?: number;
  /** Share of unanswerable cases that returned at least one source after thresholding. */
  falseRetrievalRate?: number;
  /** Share of refusal-required cases where the model correctly abstained. */
  abstentionAccuracy?: number;
  /** Share of refusal-required cases where the model tried to answer anyway. */
  falseAnswerRate?: number;
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
