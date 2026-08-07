import { promises as fs } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { evaluateGates, GateConfig, parseGateConfig } from './gates';
import { EvalReport } from './types';

const GATES = path.resolve('eval', 'gates.json');

/** Builds a report carrying only the aggregates a test cares about. */
function report(partial: Partial<EvalReport> = {}): EvalReport {
  return {
    k: 3,
    threshold: 0.45,
    generatedAnswers: false,
    breakdown: { total: 0, answerable: 0, unanswerable: 0, byTag: {} },
    cases: [],
    aggregate: {},
    byTag: {},
    ...partial,
  };
}

describe('evaluateGates', () => {
  it('passes a metric that clears its floor', () => {
    const results = evaluateGates(report({ aggregate: { hitRate: 0.97 } }), {
      aggregate: { hitRate: { min: 0.95 } },
    });

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(true);
  });

  it('fails a metric below its floor', () => {
    const [result] = evaluateGates(report({ aggregate: { hitRate: 0.9 } }), {
      aggregate: { hitRate: { min: 0.95 } },
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain('below the floor');
  });

  it('fails a metric above its ceiling', () => {
    const [result] = evaluateGates(report({ aggregate: { falseRetrievalRate: 0.8 } }), {
      aggregate: { falseRetrievalRate: { max: 0.5 } },
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain('above the ceiling');
  });

  // A gate that quietly passes when its metric stops being produced is worse than no gate:
  // the build stays green while the thing it guards goes unmeasured.
  it('fails a gate whose metric the run did not produce', () => {
    const [result] = evaluateGates(report({ aggregate: {} }), { aggregate: { mrr: { min: 0.5 } } });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain('no value');
  });

  it('applies a per-tag gate to that tag only', () => {
    const results = evaluateGates(
      report({ aggregate: { recallAtK: 0.99 }, byTag: { 'multi-source': { recallAtK: 0.4 } } }),
      { byTag: { 'multi-source': { recallAtK: { min: 0.7 } } } }
    );

    expect(results).toHaveLength(1);
    expect(results[0].scope).toBe('tag:multi-source');
    expect(results[0].passed).toBe(false);
  });

  // A tag that no case carries any more means the dataset lost the cases a gate was written
  // to protect — silently passing would hide exactly that deletion.
  it('fails a gate on a tag no case carries', () => {
    const [result] = evaluateGates(report(), { byTag: { 'multi-source': { hitRate: { min: 0.5 } } } });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain('multi-source');
  });
});

describe('parseGateConfig', () => {
  it('accepts a deterministic retrieval metric', () => {
    expect(parseGateConfig({ aggregate: { mrr: { min: 0.8 } } })).toEqual({ aggregate: { mrr: { min: 0.8 } } });
  });

  // Generation metrics move run to run because the LLM does; gating them fails builds on
  // noise. They are reported by the nightly full run instead.
  it('rejects a generation metric as a gate', () => {
    expect(() => parseGateConfig({ aggregate: { groundedness: { min: 0.5 } } })).toThrow(/not gateable/);
    expect(() => parseGateConfig({ byTag: { golden: { falseAnswerRate: { max: 0.1 } } } })).toThrow(/not gateable/);
  });

  it('rejects a bound that constrains nothing', () => {
    expect(() => parseGateConfig({ aggregate: { hitRate: {} } })).toThrow(/neither min nor max/);
  });

  it('rejects a non-object file', () => {
    expect(() => parseGateConfig('nope')).toThrow(/JSON object/);
  });
});

describe('the committed gates file', () => {
  it('parses and gates only deterministic retrieval metrics', async () => {
    const config: GateConfig = parseGateConfig(JSON.parse(await fs.readFile(GATES, 'utf-8')));

    expect(Object.keys(config.aggregate ?? {}).length).toBeGreaterThan(0);
    expect(Object.keys(config.byTag ?? {})).toContain('regression');
  });
});
