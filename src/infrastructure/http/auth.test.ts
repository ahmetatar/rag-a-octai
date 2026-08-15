import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import config, { ApiKeyEntry } from '@app/config';
import { authMiddleware, hashApiKey, requireScope, tenantOf, TENANT_LOCAL } from './auth';

const originalConfig = { ...config };

afterEach(() => {
  Object.assign(config, originalConfig);
});

/** Builds a single-entry `apiKeyHashes` map for the given raw key, tenant, and scopes. */
function apiKeyHashesFor(rawKey: string, tenantId: string, scopes: string[] = ['*']): Record<string, ApiKeyEntry> {
  return { [hashApiKey(rawKey)]: { tenantId, scopes } };
}

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
    config.apiKeyHashes = apiKeyHashesFor('sk-acme', 'acme');
    const res = fakeResponse();
    const next = vi.fn();

    authMiddleware()(fakeRequest(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('rejects an unknown key', () => {
    config.authEnabled = true;
    config.apiKeyHashes = apiKeyHashesFor('sk-acme', 'acme');
    const res = fakeResponse();
    const next = vi.fn();

    authMiddleware()(fakeRequest({ 'x-api-key': 'sk-wrong' }), res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('resolves the tenant from a valid x-api-key header', () => {
    config.authEnabled = true;
    config.apiKeyHashes = { ...apiKeyHashesFor('sk-acme', 'acme'), ...apiKeyHashesFor('sk-globex', 'globex') };
    const res = fakeResponse();
    const next = vi.fn();

    authMiddleware()(fakeRequest({ 'x-api-key': 'sk-globex' }), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.locals[TENANT_LOCAL]).toBe('globex');
  });

  it('accepts a key via the Authorization: Bearer header', () => {
    config.authEnabled = true;
    config.apiKeyHashes = apiKeyHashesFor('sk-acme', 'acme');
    const res = fakeResponse();
    const next = vi.fn();

    authMiddleware()(fakeRequest({ authorization: 'Bearer sk-acme' }), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.locals[TENANT_LOCAL]).toBe('acme');
  });

  it('rejects a key equal to an Object.prototype property name', () => {
    config.authEnabled = true;
    config.apiKeyHashes = apiKeyHashesFor('sk-acme', 'acme');
    const res = fakeResponse();
    const next = vi.fn();

    authMiddleware()(fakeRequest({ 'x-api-key': 'constructor' }), res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('records the resolved scopes on res.locals', () => {
    config.authEnabled = true;
    config.apiKeyHashes = apiKeyHashesFor('sk-acme', 'acme', ['read']);
    const res = fakeResponse();
    const next = vi.fn();

    authMiddleware()(fakeRequest({ 'x-api-key': 'sk-acme' }), res, next);

    expect(res.locals.scopes).toEqual(['read']);
  });
});

describe('requireScope', () => {
  it('passes through when no scopes were recorded (auth disabled)', () => {
    const res = fakeResponse();
    const next = vi.fn();

    requireScope('write')({} as Request, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });

  it('passes through for a wildcard-scoped key', () => {
    const res = fakeResponse();
    res.locals.scopes = ['*'];
    const next = vi.fn();

    requireScope('delete')({} as Request, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('passes through when the required scope is present', () => {
    const res = fakeResponse();
    res.locals.scopes = ['read', 'write'];
    const next = vi.fn();

    requireScope('write')({} as Request, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects with 403 when the required scope is missing', () => {
    const res = fakeResponse();
    res.locals.scopes = ['read'];
    const next = vi.fn();

    requireScope('delete')({} as Request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
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
