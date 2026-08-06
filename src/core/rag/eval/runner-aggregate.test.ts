import { describe, expect, it } from 'vitest';
import { EvalCaseResult } from './types';
import { aggregateEvalResults } from './runner';

const ANSWERABLE: EvalCaseResult = {
  id: 'answerable',
  question: 'A question with a source',
  expectedAnswerable: true,
  retrievedSources: ['guide.txt'],
  precisionAtK: 1,
  recallAtK: 1,
  reciprocalRank: 1,
  hit: 1,
  keywordCoverage: 1,
};

describe('aggregateEvalResults', () => {
  it('reports unanswerable safety metrics without diluting retrieval scores', () => {
    const unanswerable: EvalCaseResult = {
      id: 'unanswerable',
      question: 'A question outside the corpus',
      expectedAnswerable: false,
      retrievedSources: ['unrelated.txt'],
      precisionAtK: 0,
      recallAtK: 1,
      reciprocalRank: 0,
      hit: 0,
      falseRetrieval: 1,
      abstained: 0,
      falseAnswer: 1,
    };

    expect(aggregateEvalResults([ANSWERABLE, unanswerable])).toMatchObject({
      answerableCases: 1,
      unanswerableCases: 1,
      precisionAtK: 1,
      recallAtK: 1,
      mrr: 1,
      hitRate: 1,
      falseRetrievalRate: 1,
      abstentionAccuracy: 0,
      falseAnswerRate: 1,
    });
  });

  it('does not fabricate answer-quality metrics when answers were not generated', () => {
    const unanswerable: EvalCaseResult = {
      id: 'unanswerable-no-generation',
      question: 'A question outside the corpus',
      expectedAnswerable: false,
      retrievedSources: [],
      precisionAtK: 0,
      recallAtK: 1,
      reciprocalRank: 0,
      hit: 0,
      falseRetrieval: 0,
    };

    const aggregate = aggregateEvalResults([ANSWERABLE, unanswerable]);

    expect(aggregate.falseRetrievalRate).toBe(0);
    expect(aggregate.abstentionAccuracy).toBeUndefined();
    expect(aggregate.falseAnswerRate).toBeUndefined();
  });
});
