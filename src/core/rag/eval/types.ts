import { ExpectedKeyword } from './metrics';

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
  /**
   * Key facts the generated answer should mention (optional; enables answer scoring). An
   * entry may be an array of accepted spellings of the same fact — see
   * {@link ExpectedKeyword}.
   */
  expectedKeywords?: ExpectedKeyword[];
  /**
   * Verbatim phrases from the corpus that correct retrieval must surface. Scores retrieval at
   * PASSAGE level, one step below `expectedSources`: the right file can come back while the
   * chunk carrying the answer does not.
   *
   * Phrases rather than chunk ids on purpose — a chunk id is invalidated by every chunk-size
   * or overlap change, which are the very knobs the eval exists to sweep.
   */
  expectedSnippets?: string[];
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
  /**
   * Labels describing what the case exercises (`direct`, `indirect`, `distractor`,
   * `multi-source`, `unanswerable`, `regression`, …). Not scored on their own; the report
   * aggregates per tag so a regression confined to one case class stays visible instead of
   * being averaged away by the rest of the set.
   */
  tags?: string[];
  /**
   * Why this case exists and where its answer comes from, in a sentence. Documentation only —
   * it is what makes a disputed answer key settleable months later.
   */
  rationale?: string;
}

/**
 * The scored result for a single evaluation case.
 */
export interface EvalCaseResult {
  id: string;
  question: string;
  /** Whether the corpus was expected to be able to answer this case. */
  answerable: boolean;
  /** The case's tags, carried through so the report can aggregate per tag. */
  tags?: string[];
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
  /**
   * Fraction of the case's expected snippets found in the retrieved chunk texts. Undefined
   * when the case declares no snippets. Retrieval-only — needs no generation.
   */
  snippetCoverage?: number;
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
  /** Mean snippet coverage over the cases that declared snippets. */
  snippetCoverage?: number;
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
  /** How many cases carry each tag, so the reader can size every per-tag aggregate. */
  byTag: Record<string, number>;
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
  /**
   * Aggregates restricted to the cases carrying each tag. A whole-set mean hides a
   * regression that only hits one class of question (say, multi-source); this is where it
   * shows up.
   */
  byTag: Record<string, EvalAggregate>;
}
