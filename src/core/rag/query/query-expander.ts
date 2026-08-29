/**
 * The result of expanding a user's question into the text(s) actually used for vector search.
 */
export interface QueryExpansion {
  /**
   * Text(s) to embed and search with, best-effort ordered by expected usefulness. Never
   * empty: every {@link QueryExpander} falls back to `[question]` on failure, so a broken
   * expansion degrades to plain retrieval rather than failing the query.
   */
  searchTexts: string[];
}

/**
 * Turns a user's question into one or more strings to embed and search the vector store
 * with, instead of embedding the raw question directly.
 *
 * The raw question is often a poor match for the embedding space a document store actually
 * lives in: it is short, conversational, and phrased as a question rather than as the
 * declarative prose a chunk is written in. The strategies here each address that gap
 * differently — see {@link QueryRewriteExpander}, {@link MultiQueryExpander},
 * {@link HydeQueryExpander} — and {@link IdentityQueryExpander} is the no-op default.
 */
export abstract class QueryExpander {
  /**
   * Expands a question into the search text(s) to use.
   * @param question The user's raw question.
   * @returns The expansion. Must never throw — an expander that cannot run its strategy
   * (LLM unreachable, malformed response) returns `{ searchTexts: [question] }`.
   */
  abstract expand(question: string): Promise<QueryExpansion>;
}

/**
 * The default, zero-cost expander: searches with the question exactly as asked. Every other
 * strategy is measured against this baseline.
 */
export class IdentityQueryExpander extends QueryExpander {
  /** @inheritdoc */
  async expand(question: string): Promise<QueryExpansion> {
    return { searchTexts: [question] };
  }
}
