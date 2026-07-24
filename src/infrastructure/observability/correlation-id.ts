import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { RequestHandler } from 'express';

/** Header a correlation id is read from (and echoed back on), in preference order. */
const INBOUND_HEADERS = ['x-correlation-id', 'x-request-id'] as const;
/** Header the resolved correlation id is written back on, so a caller can log it too. */
const OUTBOUND_HEADER = 'x-request-id';

/**
 * Per-request store holding the correlation id. AsyncLocalStorage propagates it down the
 * async call chain (embed → search → generate) so deep code — the logger in particular —
 * can read the id without it being threaded through every function signature.
 */
const storage = new AsyncLocalStorage<{ correlationId: string }>();

/**
 * The correlation id of the in-flight request, or undefined outside a request (startup,
 * shutdown, a background job). The logger appends it when present.
 * @returns The current request's correlation id, if any.
 */
export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

/**
 * Reads an inbound correlation id from the request (so a trace started upstream carries
 * through) or mints one, exposes it on `res.locals` and the response header, and runs the
 * rest of the request inside an AsyncLocalStorage context carrying the id.
 *
 * Mounted before every other middleware so the id covers the whole request lifecycle,
 * including validation failures and the error handler.
 *
 * @returns The correlation-id middleware.
 */
export function correlationIdMiddleware(): RequestHandler {
  return (req, res, next) => {
    const correlationId = inboundCorrelationId(req.headers) ?? randomUUID();

    res.locals.correlationId = correlationId;
    res.setHeader(OUTBOUND_HEADER, correlationId);

    storage.run({ correlationId }, () => next());
  };
}

/**
 * Extracts the first non-empty correlation id from the accepted inbound headers.
 * A repeated header arrives as an array; only the first value is used.
 * @param headers The incoming request headers.
 * @returns The inbound correlation id, or undefined if none was sent.
 */
function inboundCorrelationId(headers: Record<string, string | string[] | undefined>): string | undefined {
  for (const name of INBOUND_HEADERS) {
    const value = headers[name];
    const first = Array.isArray(value) ? value[0] : value;
    const trimmed = first?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return undefined;
}
