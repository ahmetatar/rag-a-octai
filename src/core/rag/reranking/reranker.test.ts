import { describe, expect, it } from 'vitest';
import { Reranker } from './reranker';

class FixedReranker extends Reranker {
  constructor(private readonly scores: number[]) {
    super();
  }
  async rank(_query: string, _documents: string[]): Promise<number[]> {
    return this.scores;
  }
}

describe('Reranker', () => {
  it('returns a score per document', async () => {
    const reranker = new FixedReranker([0.9, 0.1]);

    await expect(reranker.rank('q', ['a', 'b'])).resolves.toEqual([0.9, 0.1]);
  });

  it('has a no-op dispose by default', async () => {
    const reranker = new FixedReranker([]);

    await expect(reranker.dispose()).resolves.toBeUndefined();
  });
});
