import { EvalAggregate, EvalReport } from './types';

/**
 * A bound on one metric. At least one of `min`/`max` must be given.
 */
export interface GateBound {
  /** The metric must be at least this value. */
  min?: number;
  /** The metric must be at most this value. */
  max?: number;
}

/**
 * Thresholds a run must satisfy to pass, as loaded from eval/gates.json.
 */
export interface GateConfig {
  /** Bounds applied to the whole-set aggregate. */
  aggregate?: Partial<Record<GateableMetric, GateBound>>;
  /**
   * Bounds applied to the aggregate of the cases carrying a tag. This is where a class of
   * question that the whole-set mean would hide (multi-source, distractors) gets its own floor.
   */
  byTag?: Record<string, Partial<Record<GateableMetric, GateBound>>>;
}

/**
 * The metrics a gate may bound.
 *
 * Deliberately retrieval-only. Generation metrics (keyword coverage, groundedness, abstention)
 * come from a non-deterministic LLM: the same commit scores differently run to run, so a
 * threshold on them fails builds on noise rather than on regressions. They are reported, not
 * gated — the full generation run belongs on a nightly schedule, not on every pull request.
 */
export const GATEABLE_METRICS = [
  'precisionAtK',
  'recallAtK',
  'mrr',
  'hitRate',
  'snippetCoverage',
  'falseRetrievalRate',
] as const;

export type GateableMetric = (typeof GATEABLE_METRICS)[number];

/**
 * One gate's verdict.
 */
export interface GateResult {
  /** Human-readable scope: `aggregate` or `tag:<name>`. */
  scope: string;
  metric: GateableMetric;
  bound: GateBound;
  /** The measured value, or undefined when the run produced no value for this metric. */
  actual?: number;
  passed: boolean;
  /** Why it failed, for the report. Empty when it passed. */
  reason: string;
}

/**
 * Checks a report against the configured gates.
 *
 * A metric the run did not produce is a FAILURE, not a pass: a gate that silently disappears
 * when its metric goes missing is worse than no gate at all, because the build stays green
 * while the thing being guarded stops being measured.
 *
 * @param report The evaluation report.
 * @param config The configured thresholds.
 * @returns One result per configured gate, in scope order.
 */
export function evaluateGates(report: EvalReport, config: GateConfig): GateResult[] {
  const results: GateResult[] = [];

  for (const [metric, bound] of entries(config.aggregate)) {
    results.push(check('aggregate', metric, bound, report.aggregate[metric]));
  }

  for (const [tag, metrics] of Object.entries(config.byTag ?? {})) {
    const aggregate: EvalAggregate | undefined = report.byTag[tag];
    for (const [metric, bound] of entries(metrics)) {
      if (!aggregate) {
        results.push({
          scope: `tag:${tag}`,
          metric,
          bound,
          passed: false,
          reason: `no case in the dataset carries the tag "${tag}"`,
        });
        continue;
      }

      results.push(check(`tag:${tag}`, metric, bound, aggregate[metric]));
    }
  }

  return results;
}

/**
 * Validates a parsed gates file, rejecting metrics that must not be gated.
 * @param raw The parsed JSON.
 * @returns The config.
 * @throws When the file names an unknown or non-deterministic metric, or an empty bound.
 */
export function parseGateConfig(raw: unknown): GateConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('gates file must contain a JSON object');
  }

  const config = raw as GateConfig;
  const scopes: [string, Partial<Record<string, GateBound>> | undefined][] = [
    ['aggregate', config.aggregate],
    ...Object.entries(config.byTag ?? {}).map(
      ([tag, metrics]) => [`byTag.${tag}`, metrics] as [string, Partial<Record<string, GateBound>>]
    ),
  ];

  for (const [scope, metrics] of scopes) {
    for (const [metric, bound] of Object.entries(metrics ?? {})) {
      if (!(GATEABLE_METRICS as readonly string[]).includes(metric)) {
        throw new Error(
          `${scope}.${metric} is not gateable. Only deterministic retrieval metrics may gate a build: ` +
            `${GATEABLE_METRICS.join(', ')}.`
        );
      }

      if (bound?.min === undefined && bound?.max === undefined) {
        throw new Error(`${scope}.${metric} declares neither min nor max`);
      }
    }
  }

  return config;
}

/**
 * Checks one metric against one bound.
 * @param scope The gate's scope, for the message.
 * @param metric The metric name.
 * @param bound The bound to apply.
 * @param actual The measured value.
 */
function check(scope: string, metric: GateableMetric, bound: GateBound, actual?: number): GateResult {
  if (actual === undefined) {
    return { scope, metric, bound, actual, passed: false, reason: 'the run produced no value for this metric' };
  }

  if (bound.min !== undefined && actual < bound.min) {
    return { scope, metric, bound, actual, passed: false, reason: `${format(actual)} is below the floor ${format(bound.min)}` };
  }

  if (bound.max !== undefined && actual > bound.max) {
    return { scope, metric, bound, actual, passed: false, reason: `${format(actual)} is above the ceiling ${format(bound.max)}` };
  }

  return { scope, metric, bound, actual, passed: true, reason: '' };
}

/**
 * Typed `Object.entries` over a metric-to-bound map.
 * @param metrics The map, possibly undefined.
 */
function entries(metrics?: Partial<Record<GateableMetric, GateBound>>): [GateableMetric, GateBound][] {
  return Object.entries(metrics ?? {}) as [GateableMetric, GateBound][];
}

/** Formats a 0–1 metric as a percentage for a failure message. */
function format(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
