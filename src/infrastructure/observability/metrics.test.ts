import { describe, expect, it } from 'vitest';
import { observeRetrievalTopScore, registry } from './metrics';

describe('metrics registry', () => {
  it('collects default Node process metrics', async () => {
    const text = await registry.metrics();

    expect(text).toContain('process_cpu_user_seconds_total');
  });

  it('records an observed retrieval score into the retrieval-score histogram', async () => {
    observeRetrievalTopScore(0.87);

    const text = await registry.metrics();

    expect(text).toContain('rag_retrieval_top_score');
    // The _count series must reflect at least the observation just made.
    const count = text.match(/^rag_retrieval_top_score_count (\d+)/m);
    expect(count).not.toBeNull();
    expect(Number(count![1])).toBeGreaterThanOrEqual(1);
  });
});
