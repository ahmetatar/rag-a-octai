import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import config from '@app/config';
import { authMiddleware, tenantOf, TENANT_LOCAL } from './auth';

const originalConfig = { ...config };

afterEach(() => {
  Object.assign(config, originalConfig);
});

/** Builds a fake request whose headers come from the given map. */
function fakeRequest(headers: Record<string, string> = {}): Request {
  return {
    method: 'POST',
    originalUrl: '/query',
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

/** Builds a fake response that records status/json and exposes locals. */
function fakeResponse() {
  const res = {
    locals: {} as Record<string, unknown>,
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe('authMiddleware — auth disabled', () => {
  it('assigns the default tenant and passes through', () => {
    config.authEnabled = false;
    config.defaultTenant = 'default';
    const res = fakeResponse();
    const next = vi.fn();

    authMiddleware()(fakeRequest(), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.locals[TENANT_LOCAL]).toBe('default');
  });
});

describe('authMiddleware — auth enabled', () => {
  it('rejects a request with no key', () => {
    config.authEnabled = true;
    config.apiKeys = { 'sk-acme': 'acme' };
    const res = fakeResponse();
    const next = vi.fn();

    authMiddleware()(fakeRequest(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('rejects an unknown key', () => {
    config.authEnabled = true;
    config.apiKeys = { 'sk-acme': 'acme' };
    const res = fakeResponse();
    const next = vi.fn();

    authMiddleware()(fakeRequest({ 'x-api-key': 'sk-wrong' }), res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('resolves the tenant from a valid x-api-key header', () => {
    config.authEnabled = true;
    config.apiKeys = { 'sk-acme': 'acme', 'sk-globex': 'globex' };
    const res = fakeResponse();
    const next = vi.fn();

    authMiddleware()(fakeRequest({ 'x-api-key': 'sk-globex' }), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.locals[TENANT_LOCAL]).toBe('globex');
  });

  it('accepts a key via the Authorization: Bearer header', () => {
    config.authEnabled = true;
    config.apiKeys = { 'sk-acme': 'acme' };
    const res = fakeResponse();
    const next = vi.fn();

    authMiddleware()(fakeRequest({ authorization: 'Bearer sk-acme' }), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.locals[TENANT_LOCAL]).toBe('acme');
  });
});

describe('tenantOf', () => {
  it('returns the resolved tenant when present', () => {
    expect(tenantOf({ [TENANT_LOCAL]: 'acme' })).toBe('acme');
  });

  it('falls back to the default tenant when absent', () => {
    config.defaultTenant = 'fallback';
    expect(tenantOf({})).toBe('fallback');
  });
});
