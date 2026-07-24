/**
 * Reranks candidate documents against a query using a cross-encoder.
 *
 * Vector search ranks by embedding similarity, which is fast but coarse: it can miss which
 * of several similar chunks actually answers the question. A cross-encoder reads the query
 * and each candidate together and scores true relevance, so reranking the vector-search
 * candidates and keeping the best usually improves ordering markedly.
 */
export abstract class Reranker {
  /**
   * Scores each document's relevance to the query.
   * @param query The user query.
   * @param documents Candidate document texts.
   * @returns A relevance score per document, aligned by index. Higher means more relevant.
   */
  abstract rank(query: string, documents: string[]): Promise<number[]>;

  /**
   * Releases any resources the reranker holds. No-op by default.
   */
  async dispose(): Promise<void> {}
}
