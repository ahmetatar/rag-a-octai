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
 * Rewards not missing relevant documents. Returns 1 when nothing was expected (vacuously).
 * @param retrieved Ordered retrieved source names.
 * @param expected Expected (relevant) source names.
 * @param k Cut-off rank.
 */
export function recallAtK(retrieved: string[], expected: string[], k: number): number {
  const expectedSet = new Set(expected);
  if (expectedSet.size === 0) {
    return 1;
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
 * Hit@k: 1 when at least one expected source is in the top-k, else 0.
 * @param retrieved Ordered retrieved source names.
 * @param expected Expected (relevant) source names.
 * @param k Cut-off rank.
 */
export function hitAtK(retrieved: string[], expected: string[], k: number): number {
  return recallAtK(retrieved, expected, k) > 0 ? 1 : 0;
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
 * Keyword coverage: the fraction of expected keywords present (case-insensitive) in an
 * answer. A cheap, deterministic proxy for whether the answer contains the key facts,
 * usable without an LLM judge. Returns 1 when no keywords were specified.
 * @param answer The generated answer.
 * @param keywords Key facts the answer should mention.
 */
export function keywordCoverage(answer: string, keywords: string[]): number {
  if (keywords.length === 0) {
    return 1;
  }

  const haystack = answer.toLowerCase();
  const found = keywords.filter((keyword) => haystack.includes(keyword.toLowerCase())).length;
  return found / keywords.length;
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
