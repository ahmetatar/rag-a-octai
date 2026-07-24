/**
 * Error thrown when an operation exceeds its time budget.
 */
export class TimeoutError extends Error {
  constructor(ms: number, label: string) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Runs an operation with a timeout.
 *
 * The operation receives an AbortSignal so it can cancel real work (fetch, etc.) rather
 * than leaking it; if the operation ignores the signal, the returned promise still rejects
 * on time so a caller is never blocked indefinitely by a hung dependency.
 *
 * @param ms Time budget in milliseconds. `0` or negative disables the timeout.
 * @param operation The work to run; receives an AbortSignal.
 * @param label Name used in the timeout error message.
 * @returns The operation's result.
 * @throws TimeoutError when the budget elapses first.
 */
export function withTimeout<T>(
  ms: number,
  operation: (signal: AbortSignal) => Promise<T>,
  label = 'operation'
): Promise<T> {
  if (ms <= 0) {
    return operation(new AbortController().signal);
  }

  const controller = new AbortController();

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(ms, label));
    }, ms);

    operation(controller.signal).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Options controlling retry behaviour.
 */
export interface RetryOptions {
  /** Total attempts, including the first. Defaults to 3. */
  attempts?: number;
  /** Base delay in milliseconds for the first backoff. Defaults to 200. */
  baseDelayMs?: number;
  /** Maximum backoff delay in milliseconds. Defaults to 5000. */
  maxDelayMs?: number;
  /** Decides whether an error is worth retrying. Defaults to always retry. */
  isRetryable?: (error: unknown) => boolean;
  /** Called before each retry (not before the first attempt). For logging. */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** Injectable sleep, so tests need not wait real time. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter in [0, 1), so backoff is deterministic in tests. */
  jitter?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs an operation with exponential backoff + jitter on failure.
 *
 * Transient failures (a dependency briefly unavailable, a timeout) are common with network
 * calls; retrying with growing, jittered delays smooths over them without hammering a
 * struggling dependency. Non-retryable errors (e.g. a 4xx) should be excluded via
 * `isRetryable` so a genuine bug is not retried pointlessly.
 *
 * @param operation The work to run; receives the 1-based attempt number.
 * @param options Retry tuning.
 * @returns The operation's result.
 * @throws The last error once attempts are exhausted or the error is not retryable.
 */
export async function withRetry<T>(operation: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const isRetryable = options.isRetryable ?? (() => true);
  const sleep = options.sleep ?? defaultSleep;
  const jitter = options.jitter ?? Math.random;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;

      if (attempt === attempts || !isRetryable(error)) {
        throw error;
      }

      // Exponential backoff (2^(n-1) * base), capped, with up to 50% jitter to avoid
      // synchronized retry storms across callers.
      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delayMs = Math.round(exponential * (0.5 + 0.5 * jitter()));

      options.onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Composes withTimeout and withRetry: each attempt is bounded by a timeout, and failed
 * attempts (including timeouts) are retried with backoff. This is the wrapper external
 * calls (Ollama, Chroma) use so a hung or flaky dependency neither blocks a caller
 * indefinitely nor fails on the first transient hiccup.
 *
 * @param label Name used in timeout/retry diagnostics.
 * @param operation The external call; receives an AbortSignal it may honour.
 * @param options Timeout budget plus retry tuning.
 * @returns The operation's result.
 */
export function resilient<T>(
  label: string,
  operation: (signal: AbortSignal) => Promise<T>,
  options: RetryOptions & { timeoutMs?: number } = {}
): Promise<T> {
  const { timeoutMs = 0, ...retry } = options;
  return withRetry(() => withTimeout(timeoutMs, operation, label), retry);
}
