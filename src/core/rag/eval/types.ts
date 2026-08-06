/**
 * One evaluation case: a question and what a correct system should retrieve/answer.
 */
export interface EvalCase {
  /** Stable identifier for the case. */
  id: string;
  /** The question to ask. */
  question: string;
  /**
   * Source file names that should be retrieved for this question. Empty for a case the
   * corpus cannot answer.
   */
  expectedSources: string[];
  /** Key facts the generated answer should mention (optional; enables answer scoring). */
  expectedKeywords?: string[];
  /**
   * Whether the corpus contains an answer at all. Defaults to `expectedSources.length > 0`
   * when omitted, so existing datasets keep working; set it explicitly to describe a case
   * that is unanswerable even though related documents exist.
   */
  expectedAnswerable?: boolean;
  /**
   * Why this case is unanswerable, for the humans reading the report. Documentation only —
   * not scored.
   */
  expectedRefusal?: string;
}

/**
 * The scored result for a single evaluation case.
 */
export interface EvalCaseResult {
  id: string;
  question: string;
  /** Whether the corpus was expected to be able to answer this case. */
  answerable: boolean;
  /** Source names retrieved and kept after thresholding, in rank order. */
  retrievedSources: string[];
  /**
   * Retrieval metrics. Undefined for unanswerable cases, which have no relevant set to
   * score against — they are measured by the aggregate's false-retrieval rate instead.
   */
  precisionAtK?: number;
  recallAtK?: number;
  reciprocalRank?: number;
  hit?: number;
  /** Present only when answers were generated. */
  keywordCoverage?: number;
  /** Fraction of the answer's trigrams found in the retrieved chunks; generation only. */
  groundedness?: number;
  /** Whether the model declined to answer; generation only. */
  abstained?: boolean;
  /** Whether abstaining (or not) was the right call; generation only. */
  abstentionCorrect?: boolean;
  /** The generated answer, when generation was enabled. */
  answer?: string;
  /** Wall-clock time for retrieval, in milliseconds. */
  retrievalMs?: number;
  /** Wall-clock time for generation, in milliseconds; generation only. */
  generationMs?: number;
}

/**
 * Aggregate scores across all cases. Retrieval means cover the answerable cases only;
 * abstention metrics cover every case that produced an answer.
 */
export interface EvalAggregate {
  precisionAtK?: number;
  recallAtK?: number;
  mrr?: number;
  hitRate?: number;
  keywordCoverage?: number;
  /** Mean groundedness over answered (non-abstained) cases. */
  groundedness?: number;
  /** Fraction of cases where answering-vs-declining matched expectation. */
  abstentionAccuracy?: number;
  /** Of unanswerable cases, the fraction answered anyway. Lower is better. */
  falseAnswerRate?: number;
  /** Of unanswerable cases, the fraction that still retrieved chunks. Lower is better. */
  falseRetrievalRate?: number;
  /** Mean retrieval latency in milliseconds. */
  retrievalMs?: number;
  /** Mean generation latency in milliseconds. */
  generationMs?: number;
}

/**
 * How the cases in a run were split, so a reader can tell what the aggregates cover.
 */
export interface EvalCaseBreakdown {
  total: number;
  answerable: number;
  unanswerable: number;
}

/**
 * A full evaluation report, suitable for printing and for diffing across runs.
 */
export interface EvalReport {
  /** The retrieval cut-off used. */
  k: number;
  /** The minimum score a chunk had to reach to be kept, mirroring production. */
  threshold: number;
  /** Whether answers were generated (and answer metrics computed). */
  generatedAnswers: boolean;
  /** The answerable/unanswerable split of the dataset. */
  breakdown: EvalCaseBreakdown;
  cases: EvalCaseResult[];
  aggregate: EvalAggregate;
}
