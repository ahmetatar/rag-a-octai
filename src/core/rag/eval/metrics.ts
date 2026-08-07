/**
 * Retrieval and answer-quality metrics used by the evaluation harness.
 *
 * These are pure functions over source names and text, so they can be unit-tested without
 * any embedding model, vector store or LLM. The runner produces the inputs (which sources a
 * query retrieved, which sources were expected) and these turn them into scores.
 *
 * `retrieved` is the ORDERED list of source names a query returned (one entry per retrieved
 * chunk, so a source may repeat). `expected` is the set of sources that should have been
 * retrieved for the query.
 */

/**
 * Precision@k: of the top-k retrieved chunks, the fraction whose source is expected.
 * Rewards not retrieving irrelevant chunks. Returns 0 when nothing was retrieved.
 * @param retrieved Ordered retrieved source names.
 * @param expected Expected (relevant) source names.
 * @param k Cut-off rank.
 */
export function precisionAtK(retrieved: string[], expected: string[], k: number): number {
  const topK = retrieved.slice(0, k);
  if (topK.length === 0) {
    return 0;
  }

  const expectedSet = new Set(expected);
  const relevant = topK.filter((source) => expectedSet.has(source)).length;
  return relevant / topK.length;
}

/**
 * Recall@k: the fraction of expected sources that appear anywhere in the top-k.
 * Rewards not missing relevant documents.
 *
 * Returns `undefined` when nothing was expected. Recall over an empty relevant set is
 * mathematically undefined, and the tempting shortcut — scoring it 1 "vacuously" — silently
 * awards a perfect score to every unanswerable case no matter what junk was retrieved,
 * inflating the aggregate exactly where the system is most likely to be wrong. Unanswerable
 * cases are scored by {@link falseRetrievalRate} instead.
 *
 * @param retrieved Ordered retrieved source names.
 * @param expected Expected (relevant) source names.
 * @param k Cut-off rank.
 */
export function recallAtK(retrieved: string[], expected: string[], k: number): number | undefined {
  const expectedSet = new Set(expected);
  if (expectedSet.size === 0) {
    return undefined;
  }

  const topKSources = new Set(retrieved.slice(0, k));
  let covered = 0;
  for (const source of expectedSet) {
    if (topKSources.has(source)) {
      covered++;
    }
  }

  return covered / expectedSet.size;
}

/**
 * Hit@k: 1 when at least one expected source is in the top-k, else 0. Returns `undefined`
 * when nothing was expected, for the reason given on {@link recallAtK}.
 * @param retrieved Ordered retrieved source names.
 * @param expected Expected (relevant) source names.
 * @param k Cut-off rank.
 */
export function hitAtK(retrieved: string[], expected: string[], k: number): number | undefined {
  const recall = recallAtK(retrieved, expected, k);
  return recall === undefined ? undefined : recall > 0 ? 1 : 0;
}

/**
 * Reciprocal rank: 1 / (rank of the first relevant retrieved chunk), or 0 if none is
 * relevant. Averaged across queries this is MRR — it rewards ranking a relevant chunk high.
 * @param retrieved Ordered retrieved source names.
 * @param expected Expected (relevant) source names.
 */
export function reciprocalRank(retrieved: string[], expected: string[]): number {
  const expectedSet = new Set(expected);
  const index = retrieved.findIndex((source) => expectedSet.has(source));
  return index === -1 ? 0 : 1 / (index + 1);
}

/**
 * One expected fact. A plain string must appear verbatim; an array is a set of accepted
 * spellings of the SAME fact, any one of which counts.
 *
 * The alternatives matter: a model that writes "25%" where the corpus says "25 percent" has
 * answered correctly, and a single-spelling key would score that a miss. Without this the
 * metric measures phrasing luck rather than whether the fact came through.
 */
export type ExpectedKeyword = string | string[];

/**
 * Keyword coverage: the fraction of expected facts present (case-insensitive) in an answer.
 * A cheap, deterministic proxy for whether the answer contains the key facts, usable without
 * an LLM judge. Returns 1 when no keywords were specified.
 *
 * @param answer The generated answer.
 * @param keywords Key facts the answer should mention; see {@link ExpectedKeyword}.
 */
export function keywordCoverage(answer: string, keywords: ExpectedKeyword[]): number {
  if (keywords.length === 0) {
    return 1;
  }

  const haystack = answer.toLowerCase();
  const matches = (keyword: ExpectedKeyword) =>
    (Array.isArray(keyword) ? keyword : [keyword]).some((spelling) => haystack.includes(spelling.toLowerCase()));

  return keywords.filter(matches).length / keywords.length;
}

/**
 * Groundedness: the fraction of an answer's word trigrams that also occur in the retrieved
 * chunks it was given. A deterministic, model-free proxy for "did the answer come from the
 * sources, or from the model's own memory?".
 *
 * Trigrams rather than single words because individual words overlap by chance through
 * ordinary language ("the", "is", "system"), while a run of three consecutive words rarely
 * coincides unless the answer is genuinely tracking the source text. This is a proxy, not a
 * judge: a correct answer phrased entirely in the model's own words scores low, and a fluent
 * paraphrase of a wrong source scores high. Read it as a relative signal across runs, and
 * layer an LLM judge on top when an absolute verdict is needed.
 *
 * Returns 1 for an answer with no trigrams (too short to assess) so it cannot drag an
 * aggregate down, and 0 when no sources were provided but an answer was produced — an answer
 * from nothing is grounded in nothing.
 *
 * @param answer The generated answer.
 * @param sourceTexts The retrieved chunk texts the answer was generated from.
 * @returns A score in [0, 1].
 */
export function groundedness(answer: string, sourceTexts: string[]): number {
  const answerGrams = trigrams(answer);
  if (answerGrams.length === 0) {
    return 1;
  }

  const sourceGrams = new Set(sourceTexts.flatMap((text) => trigrams(text)));
  if (sourceGrams.size === 0) {
    return 0;
  }

  const supported = answerGrams.filter((gram) => sourceGrams.has(gram)).length;
  return supported / answerGrams.length;
}

/**
 * Snippet coverage: the fraction of a case's expected snippets that appear in the text of
 * the retrieved chunks. Source-level metrics only say the right FILE came back; this says
 * the right PASSAGE came back, which is what the model actually reads.
 *
 * Matching is whitespace-insensitive and case-insensitive, because a corpus is hard-wrapped
 * and a snippet that straddles a line break is still the same passage. It is deliberately
 * NOT chunk-id based: chunk ids shift whenever chunk size or overlap changes, which are
 * exactly the knobs the eval exists to sweep, so an id-based answer key would invalidate
 * itself on every experiment. A verbatim phrase survives rechunking.
 *
 * Returns `undefined` when the case declares no snippets, so cases without a passage-level
 * answer key neither inflate nor deflate the aggregate.
 *
 * @param retrievedTexts The contents of the chunks that survived retrieval and thresholding.
 * @param snippets Verbatim phrases from the corpus that a correct retrieval must surface.
 * @returns A score in [0, 1], or undefined when no snippets were declared.
 */
export function snippetCoverage(retrievedTexts: string[], snippets: string[]): number | undefined {
  if (snippets.length === 0) {
    return undefined;
  }

  const haystack = normaliseWhitespace(retrievedTexts.join('\n'));
  const found = snippets.filter((snippet) => haystack.includes(normaliseWhitespace(snippet))).length;
  return found / snippets.length;
}

/**
 * Abstention accuracy: the fraction of cases where the system's decision to answer or
 * decline matched what the case called for. Counts BOTH directions — declining an
 * answerable question is as wrong as answering an unanswerable one — so it cannot be gamed
 * by a system that refuses everything.
 *
 * @param outcomes One entry per case: whether it was answerable and whether the model abstained.
 * @returns A score in [0, 1]; 1 for an empty list (nothing to get wrong).
 */
export function abstentionAccuracy(outcomes: AbstentionOutcome[]): number {
  if (outcomes.length === 0) {
    return 1;
  }

  const correct = outcomes.filter((outcome) => outcome.abstained === !outcome.answerable).length;
  return correct / outcomes.length;
}

/**
 * False-answer rate: of the cases that had NO answer in the corpus, the fraction where the
 * model answered anyway. This is the hallucination metric — the closer to 0 the better.
 *
 * @param outcomes One entry per case.
 * @returns A score in [0, 1]; 0 when there were no unanswerable cases.
 */
export function falseAnswerRate(outcomes: AbstentionOutcome[]): number {
  const unanswerable = outcomes.filter((outcome) => !outcome.answerable);
  if (unanswerable.length === 0) {
    return 0;
  }

  return unanswerable.filter((outcome) => !outcome.abstained).length / unanswerable.length;
}

/**
 * False-retrieval rate: of the cases that had no answer in the corpus, the fraction where
 * retrieval still surfaced chunks above the threshold. Distinct from
 * {@link falseAnswerRate} because the two failures have different fixes: false retrieval is
 * a threshold/embedding problem, a false answer on top of it is a prompting problem.
 *
 * @param outcomes One entry per case.
 * @returns A score in [0, 1]; 0 when there were no unanswerable cases.
 */
export function falseRetrievalRate(outcomes: AbstentionOutcome[]): number {
  const unanswerable = outcomes.filter((outcome) => !outcome.answerable);
  if (unanswerable.length === 0) {
    return 0;
  }

  return unanswerable.filter((outcome) => outcome.retrievedCount > 0).length / unanswerable.length;
}

/**
 * What one case did, as far as answering-vs-declining is concerned.
 */
export interface AbstentionOutcome {
  /** Whether the corpus actually contains an answer for this case. */
  answerable: boolean;
  /** Whether the model declined to answer. */
  abstained: boolean;
  /** How many chunks survived retrieval and thresholding. */
  retrievedCount: number;
}

/**
 * Averages a list of numbers, returning 0 for an empty list.
 * @param values The values to average.
 */
export function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Averages only the values that are present, ignoring `undefined`. Used for metrics that are
 * undefined for some cases (retrieval scores on unanswerable cases, answer scores when
 * generation was off) so those cases neither inflate nor deflate the aggregate.
 *
 * @param values The values, some possibly undefined.
 * @returns The mean of the defined values, or undefined when none are defined.
 */
export function meanDefined(values: (number | undefined)[]): number | undefined {
  const present = values.filter((value): value is number => value !== undefined);
  return present.length === 0 ? undefined : mean(present);
}

/**
 * Splits text into normalised word trigrams. Case, punctuation and runs of whitespace are
 * discarded so that formatting differences between an answer and its source do not read as
 * a lack of grounding.
 *
 * @param text The text to shingle.
 * @returns The trigrams, joined by single spaces.
 */
function trigrams(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const grams: string[] = [];
  for (let index = 0; index + 2 < words.length; index++) {
    grams.push(`${words[index]} ${words[index + 1]} ${words[index + 2]}`);
  }

  return grams;
}

/**
 * Lowercases text and collapses every run of whitespace to a single space, so that a hard
 * line break inside a corpus file does not stop a snippet from matching.
 * @param text The text to normalise.
 */
function normaliseWhitespace(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}
