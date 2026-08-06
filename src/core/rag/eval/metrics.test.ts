import { describe, expect, it } from 'vitest';
import { hitAtK, isAbstention, keywordCoverage, mean, precisionAtK, recallAtK, reciprocalRank } from './metrics';

describe('precisionAtK', () => {
  it('is 1 when every top-k chunk is relevant', () => {
    expect(precisionAtK(['a', 'a', 'b'], ['a', 'b'], 3)).toBe(1);
  });

  it('drops as irrelevant chunks enter the top-k', () => {
    // 1 of 3 relevant.
    expect(precisionAtK(['a', 'x', 'y'], ['a'], 3)).toBeCloseTo(1 / 3);
  });

  it('is 0 when nothing was retrieved', () => {
    expect(precisionAtK([], ['a'], 3)).toBe(0);
  });

  it('respects the k cut-off', () => {
    // Only the first item counts at k=1, and it is relevant.
    expect(precisionAtK(['a', 'x', 'x'], ['a'], 1)).toBe(1);
  });
});

describe('recallAtK', () => {
  it('is 1 when all expected sources appear', () => {
    expect(recallAtK(['a', 'b', 'c'], ['a', 'b'], 3)).toBe(1);
  });

  it('is partial when some expected sources are missing', () => {
    expect(recallAtK(['a', 'x'], ['a', 'b'], 3)).toBe(0.5);
  });

  it('respects the k cut-off', () => {
    // b is beyond k=1, so it is not counted as covered.
    expect(recallAtK(['a', 'b'], ['a', 'b'], 1)).toBe(0.5);
  });

  it('is 1 (vacuously) when nothing is expected', () => {
    expect(recallAtK(['a'], [], 3)).toBe(1);
  });
});

describe('hitAtK', () => {
  it('is 1 when a relevant source is present', () => {
    expect(hitAtK(['x', 'a'], ['a'], 3)).toBe(1);
  });

  it('is 0 when no relevant source is in the top-k', () => {
    expect(hitAtK(['x', 'a'], ['a'], 1)).toBe(0);
  });

  it('is 0 when no source is expected', () => {
    expect(hitAtK(['x'], [], 3)).toBe(0);
  });
});

describe('isAbstention', () => {
  it('recognises a safe English refusal', () => {
    expect(isAbstention("I don't have enough information in the context to answer.")).toBe(true);
  });

  it('recognises a safe Turkish refusal', () => {
    expect(isAbstention('Bu soruyu yanıtlayamam; bağlamda yeterli bilgi yok.')).toBe(true);
  });

  it('does not treat a substantive answer as an abstention', () => {
    expect(isAbstention('Jupiter is the largest planet in the Solar System.')).toBe(false);
  });
});

describe('reciprocalRank', () => {
  it('is 1 when the first chunk is relevant', () => {
    expect(reciprocalRank(['a', 'x'], ['a'])).toBe(1);
  });

  it('is 1/2 when the second chunk is the first relevant one', () => {
    expect(reciprocalRank(['x', 'a'], ['a'])).toBe(0.5);
  });

  it('is 0 when nothing relevant was retrieved', () => {
    expect(reciprocalRank(['x', 'y'], ['a'])).toBe(0);
  });
});

describe('keywordCoverage', () => {
  it('is 1 when every keyword appears (case-insensitive)', () => {
    expect(keywordCoverage('The capital is Paris on the Seine.', ['paris', 'SEINE'])).toBe(1);
  });

  it('is partial when some keywords are missing', () => {
    expect(keywordCoverage('The capital is Paris.', ['Paris', 'Seine'])).toBe(0.5);
  });

  it('is 1 when no keywords are specified', () => {
    expect(keywordCoverage('anything', [])).toBe(1);
  });
});

describe('mean', () => {
  it('averages values', () => {
    expect(mean([1, 2, 3])).toBe(2);
  });

  it('is 0 for an empty list', () => {
    expect(mean([])).toBe(0);
  });
});
