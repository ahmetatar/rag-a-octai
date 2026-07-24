import config from '@app/config';
import { logger } from '@infrastructure/logging';
import { resilient } from '@infrastructure/async';

/**
 * Wraps an external dependency call (Ollama, Chroma, Gemini) with the app's configured
 * timeout and retry policy, logging each retry. Centralised so every external call gets the
 * same resilience without repeating the config wiring.
 *
 * @param label Name used in timeout/retry diagnostics.
 * @param operation The external call; receives an AbortSignal it may honour.
 * @returns The operation's result.
 */
export function resilientCall<T>(label: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  return resilient(label, operation, {
    timeoutMs: config.externalTimeoutMs,
    attempts: config.externalRetryAttempts,
    onRetry: (error, attempt, delayMs) =>
      logger.warn(
        `${label} attempt ${attempt} failed (${error instanceof Error ? error.message : error}); ` +
          `retrying in ${delayMs}ms`
      ),
  });
}
