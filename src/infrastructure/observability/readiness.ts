import { ChromaClient } from 'chromadb';
import { Ollama } from 'ollama';
import config from '@app/config';
import { withTimeout } from '@infrastructure/async';

/** The health of a single backing dependency, as reported by the readiness probe. */
export interface DependencyStatus {
  /** Dependency name (e.g. 'chroma', 'ollama'). */
  name: string;
  /** Whether the dependency answered within the readiness timeout. */
  ok: boolean;
  /** Failure reason when not ok; omitted when healthy. */
  error?: string;
}

/** The aggregate readiness of the service and the per-dependency breakdown behind it. */
export interface ReadinessReport {
  /** True only when every dependency is ok. */
  ready: boolean;
  /** One entry per checked dependency. */
  dependencies: DependencyStatus[];
}

/**
 * Pings every backing dependency the service needs to serve traffic — ChromaDB (retrieval)
 * and Ollama (generation) — and reports whether all are reachable.
 *
 * Unlike the liveness `/health`, this is meant for a readiness probe: an orchestrator should
 * stop routing traffic (503) while a dependency is down, without killing the container.
 * Each ping is bounded by a short timeout and NOT retried, so the probe fails fast.
 *
 * @returns The aggregate readiness and the per-dependency breakdown.
 */
export async function checkReadiness(): Promise<ReadinessReport> {
  const dependencies = await Promise.all([
    ping('chroma', () => new ChromaClient({ host: config.chromaHost, port: config.chromaPort }).heartbeat()),
    ping('ollama', () => new Ollama({ host: config.ollamaHost }).list()),
  ]);

  return { ready: dependencies.every((dependency) => dependency.ok), dependencies };
}

/**
 * Runs one dependency ping under the readiness timeout, translating success/failure into a
 * DependencyStatus rather than throwing, so one dead dependency does not mask the others.
 * @param name The dependency's name.
 * @param probe The lightweight call that proves the dependency answers.
 * @returns The dependency's status.
 */
async function ping(name: string, probe: () => Promise<unknown>): Promise<DependencyStatus> {
  try {
    await withTimeout(config.readinessTimeoutMs, () => probe(), `${name}.ping`);
    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
