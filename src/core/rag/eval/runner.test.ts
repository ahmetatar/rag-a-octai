import path from 'path';
import { describe, expect, it } from 'vitest';
import { loadDataset } from './runner';

const DATASET = path.resolve('eval', 'dataset.jsonl');

describe('loadDataset', () => {
  it('parses the committed eval dataset into well-formed cases', async () => {
    const cases = await loadDataset(DATASET);

    expect(cases.length).toBeGreaterThan(0);
    for (const evalCase of cases) {
      expect(evalCase.id).toBeTruthy();
      expect(evalCase.question).toBeTruthy();
      expect(Array.isArray(evalCase.expectedSources)).toBe(true);
      expect(typeof evalCase.expectedAnswerable).toBe('boolean');
      if (evalCase.expectedAnswerable) {
        expect(evalCase.expectedSources.length).toBeGreaterThan(0);
      }
    }
  });

  it('uses unique case ids', async () => {
    const cases = await loadDataset(DATASET);
    const ids = cases.map((evalCase) => evalCase.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
