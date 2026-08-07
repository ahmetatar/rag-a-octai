import { promises as fs } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { EvalCase } from './types';
import { isAnswerable, loadDataset } from './runner';

const DATASET = path.resolve('eval', 'dataset.jsonl');
const CORPUS = path.resolve('eval', 'corpus');

/** Lowercases and collapses whitespace, matching how snippetCoverage compares text. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Reads the corpus once, normalised, keyed by file name. */
async function loadCorpus(): Promise<Record<string, string>> {
  const names = (await fs.readdir(CORPUS)).filter((name) => name.endsWith('.txt'));
  const entries = await Promise.all(
    names.map(async (name) => [name, normalise(await fs.readFile(path.join(CORPUS, name), 'utf-8'))] as const)
  );

  return Object.fromEntries(entries);
}

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

  it('names only corpus files that exist as expected sources', async () => {
    const [cases, corpus] = await Promise.all([loadDataset(DATASET), loadCorpus()]);

    for (const evalCase of cases) {
      for (const source of evalCase.expectedSources) {
        expect(Object.keys(corpus), `${evalCase.id} expects a missing source`).toContain(source);
      }
    }
  });

  // The answer key is only worth anything if it still matches the corpus. This is the one
  // check that catches an edited document silently invalidating a case, and it needs no
  // embedding model or vector store — so it runs on every commit, not only in the eval job.
  it('quotes every expected snippet verbatim from one of its expected sources', async () => {
    const [cases, corpus] = await Promise.all([loadDataset(DATASET), loadCorpus()]);

    for (const evalCase of cases) {
      for (const snippet of evalCase.expectedSnippets ?? []) {
        const found = evalCase.expectedSources.some((source) => corpus[source]?.includes(normalise(snippet)));
        expect(found, `${evalCase.id}: snippet not found in its expected sources: "${snippet}"`).toBe(true);
      }
    }
  });

  // Source-level expectations alone cannot tell a run that retrieved the right file from one
  // that retrieved the right passage, so an answerable case without snippets is a hole.
  it('gives every answerable case a passage-level answer key', async () => {
    const cases = await loadDataset(DATASET);

    for (const evalCase of cases.filter(isAnswerable)) {
      expect(evalCase.expectedSnippets?.length, `${evalCase.id} has no expectedSnippets`).toBeGreaterThan(0);
    }
  });

  it('records tags and a rationale for every case', async () => {
    const cases = await loadDataset(DATASET);

    for (const evalCase of cases) {
      expect(evalCase.tags?.length, `${evalCase.id} has no tags`).toBeGreaterThan(0);
      expect(evalCase.rationale, `${evalCase.id} has no rationale`).toBeTruthy();
    }
  });

  // These are the classes of question the dataset exists to cover. Losing one silently would
  // leave a whole failure mode unmeasured while the aggregates still looked healthy.
  it('covers every case class the harness is meant to exercise', async () => {
    const cases = await loadDataset(DATASET);
    const count = (tag: string) => cases.filter((evalCase: EvalCase) => evalCase.tags?.includes(tag)).length;

    for (const tag of ['regression', 'golden', 'direct', 'indirect', 'distractor', 'multi-source', 'near-corpus', 'out-of-scope']) {
      expect(count(tag), `no case tagged "${tag}"`).toBeGreaterThan(0);
    }
  });

  // A multi-source case that names one document is not a multi-source case.
  it('gives every multi-source case at least two expected sources', async () => {
    const cases = await loadDataset(DATASET);

    for (const evalCase of cases.filter((c: EvalCase) => c.tags?.includes('multi-source'))) {
      expect(evalCase.expectedSources.length, `${evalCase.id} is tagged multi-source`).toBeGreaterThan(1);
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
