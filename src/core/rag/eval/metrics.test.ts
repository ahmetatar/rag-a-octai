import { describe, expect, it } from 'vitest';
import {
  AbstentionOutcome,
  abstentionAccuracy,
  falseAnswerRate,
  falseRetrievalRate,
  groundedness,
  hitAtK,
  keywordCoverage,
  mean,
  meanDefined,
  precisionAtK,
  recallAtK,
  reciprocalRank,
} from './metrics';

/** Builds an outcome, so each test states only the field it is about. */
function outcome(partial: Partial<AbstentionOutcome>): AbstentionOutcome {
  return { answerable: true, abstained: false, retrievedCount: 1, ...partial };
}

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

  // The old behaviour returned 1 here, which handed every unanswerable case a perfect score
  // no matter what it retrieved.
  it('is undefined when nothing is expected, rather than a vacuous 1', () => {
    expect(recallAtK(['a'], [], 3)).toBeUndefined();
  });
});

describe('hitAtK', () => {
  it('is 1 when a relevant source is present', () => {
    expect(hitAtK(['x', 'a'], ['a'], 3)).toBe(1);
  });

  it('is 0 when no relevant source is in the top-k', () => {
    expect(hitAtK(['x', 'a'], ['a'], 1)).toBe(0);
  });

  it('is undefined when nothing is expected', () => {
    expect(hitAtK(['x'], [], 3)).toBeUndefined();
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

describe('groundedness', () => {
  it('is 1 when the answer is lifted from the sources', () => {
    expect(groundedness('the sky is blue', ['everyone knows the sky is blue today'])).toBe(1);
  });

  it('is 0 when the answer shares no trigram with the sources', () => {
    expect(groundedness('mars has two moons', ['photosynthesis happens in chloroplasts'])).toBe(0);
  });

  it('ignores case and punctuation differences', () => {
    expect(groundedness('The Sky, Is Blue!', ['the sky is blue'])).toBe(1);
  });

  it('is partial when only some of the answer is supported', () => {
    // Trigrams: "the sky is", "sky is blue", "is blue always", "blue always sunny" -> 2 of 4.
    expect(groundedness('the sky is blue always sunny', ['the sky is blue'])).toBeCloseTo(0.5);
  });

  it('is 0 when an answer was produced with no sources at all', () => {
    expect(groundedness('jupiter is the largest planet', [])).toBe(0);
  });

  it('is 1 for an answer too short to form a trigram', () => {
    expect(groundedness('yes', ['anything'])).toBe(1);
  });
});

describe('abstentionAccuracy', () => {
  it('credits answering an answerable case and declining an unanswerable one', () => {
    const outcomes = [outcome({ answerable: true, abstained: false }), outcome({ answerable: false, abstained: true })];
    expect(abstentionAccuracy(outcomes)).toBe(1);
  });

  it('penalises declining an answerable case as much as answering an unanswerable one', () => {
    expect(abstentionAccuracy([outcome({ answerable: true, abstained: true })])).toBe(0);
    expect(abstentionAccuracy([outcome({ answerable: false, abstained: false })])).toBe(0);
  });

  it('cannot be gamed by a system that refuses everything', () => {
    const outcomes = [
      outcome({ answerable: true, abstained: true }),
      outcome({ answerable: true, abstained: true }),
      outcome({ answerable: false, abstained: true }),
    ];
    expect(abstentionAccuracy(outcomes)).toBeCloseTo(1 / 3);
  });

  it('is 1 for an empty list', () => {
    expect(abstentionAccuracy([])).toBe(1);
  });
});

describe('falseAnswerRate', () => {
  it('counts unanswerable cases that were answered anyway', () => {
    const outcomes = [
      outcome({ answerable: false, abstained: false }),
      outcome({ answerable: false, abstained: true }),
    ];
    expect(falseAnswerRate(outcomes)).toBe(0.5);
  });

  it('ignores answerable cases entirely', () => {
    const outcomes = [outcome({ answerable: true, abstained: false }), outcome({ answerable: false, abstained: true })];
    expect(falseAnswerRate(outcomes)).toBe(0);
  });

  it('is 0 when there are no unanswerable cases', () => {
    expect(falseAnswerRate([outcome({ answerable: true })])).toBe(0);
  });
});

describe('falseRetrievalRate', () => {
  it('counts unanswerable cases that still retrieved something', () => {
    const outcomes = [
      outcome({ answerable: false, retrievedCount: 3 }),
      outcome({ answerable: false, retrievedCount: 0 }),
    ];
    expect(falseRetrievalRate(outcomes)).toBe(0.5);
  });

  // A correct refusal on top of bad retrieval is still bad retrieval; the two are separate
  // failures with separate fixes.
  it('is independent of whether the model abstained', () => {
    const outcomes = [outcome({ answerable: false, abstained: true, retrievedCount: 2 })];
    expect(falseRetrievalRate(outcomes)).toBe(1);
  });

  it('is 0 when there are no unanswerable cases', () => {
    expect(falseRetrievalRate([outcome({ answerable: true, retrievedCount: 5 })])).toBe(0);
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

describe('meanDefined', () => {
  it('averages only the values that are present', () => {
    expect(meanDefined([1, undefined, 3])).toBe(2);
  });

  it('is undefined when no value is present', () => {
    expect(meanDefined([undefined, undefined])).toBeUndefined();
  });
});
