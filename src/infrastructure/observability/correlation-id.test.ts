import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { correlationIdMiddleware, getCorrelationId } from './correlation-id';

/**
 * Drives the middleware with a fake request/response and returns what it observed: the id
 * seen from inside the AsyncLocalStorage context, the header written back, and res.locals.
 */
function run(headers: Record<string, string> = {}) {
  const req = { headers } as unknown as Request;
  const setHeader = vi.fn();
  const res = { locals: {} as Record<string, unknown>, setHeader } as unknown as Response;

  let idInsideContext: string | undefined;
  correlationIdMiddleware()(req, res, () => {
    idInsideContext = getCorrelationId();
  });

  return { idInsideContext, setHeader, locals: res.locals as { correlationId?: string } };
}

describe('correlationIdMiddleware', () => {
  it('mints an id when the request carries none', () => {
    const { idInsideContext, setHeader, locals } = run();

    expect(idInsideContext).toBeTruthy();
    expect(locals.correlationId).toBe(idInsideContext);
    expect(setHeader).toHaveBeenCalledWith('x-request-id', idInsideContext);
  });

  it('adopts an inbound x-correlation-id so an upstream trace carries through', () => {
    const { idInsideContext, setHeader } = run({ 'x-correlation-id': 'trace-abc' });

    expect(idInsideContext).toBe('trace-abc');
    expect(setHeader).toHaveBeenCalledWith('x-request-id', 'trace-abc');
  });

  it('falls back to x-request-id when x-correlation-id is absent', () => {
    const { idInsideContext } = run({ 'x-request-id': 'req-xyz' });

    expect(idInsideContext).toBe('req-xyz');
  });

  it('ignores a blank inbound header and mints a fresh id', () => {
    const { idInsideContext } = run({ 'x-correlation-id': '   ' });

    expect(idInsideContext).toBeTruthy();
    expect(idInsideContext).not.toBe('   ');
  });
});

describe('getCorrelationId', () => {
  it('is undefined outside any request context', () => {
    expect(getCorrelationId()).toBeUndefined();
  });
});
