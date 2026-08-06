import path from 'path';
import { describe, expect, it } from 'vitest';
import { isAnswerable, loadDataset } from './runner';

const DATASET = path.resolve('eval', 'dataset.jsonl');

describe('loadDataset', () => {
  it('parses the committed eval dataset into well-formed cases', async () => {
    const cases = await loadDataset(DATASET);

    expect(cases.length).toBeGreaterThan(0);
    for (const evalCase of cases) {
      expect(evalCase.id).toBeTruthy();
      expect(evalCase.question).toBeTruthy();
      expect(Array.isArray(evalCase.expectedSources)).toBe(true);
    }
  });

  it('uses unique case ids', async () => {
    const cases = await loadDataset(DATASET);
    const ids = cases.map((evalCase) => evalCase.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every answerable case at least one expected source', async () => {
    const cases = await loadDataset(DATASET);

    for (const evalCase of cases.filter(isAnswerable)) {
      expect(evalCase.expectedSources.length).toBeGreaterThan(0);
    }
  });

  // Without unanswerable cases the abstention metrics have nothing to measure, and the
  // dataset cannot show whether the system hallucinates.
  it('contains unanswerable cases, each documenting why', async () => {
    const cases = await loadDataset(DATASET);
    const unanswerable = cases.filter((evalCase) => !isAnswerable(evalCase));

    expect(unanswerable.length).toBeGreaterThan(0);
    for (const evalCase of unanswerable) {
      expect(evalCase.expectedSources).toEqual([]);
      expect(evalCase.expectedRefusal).toBeTruthy();
    }
  });
});

describe('isAnswerable', () => {
  it('infers answerability from expected sources when not stated', () => {
    expect(isAnswerable({ id: 'a', question: 'q', expectedSources: ['doc.txt'] })).toBe(true);
    expect(isAnswerable({ id: 'b', question: 'q', expectedSources: [] })).toBe(false);
  });

  // A case can be unanswerable even though related documents exist, so the explicit flag has
  // to win over the inference.
  it('lets an explicit flag override the inference', () => {
    expect(
      isAnswerable({ id: 'c', question: 'q', expectedSources: ['doc.txt'], expectedAnswerable: false })
    ).toBe(false);
  });
});
