import { AddressInfo } from 'net';
import { Server } from 'http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import config, { ApiKeyEntry } from '@app/config';
import { tenantRateLimitMiddleware } from '@app/app';
import { authMiddleware, hashApiKey } from '@infrastructure/http';

const originalConfig = { authEnabled: config.authEnabled, apiKeyHashes: config.apiKeyHashes, rateLimitMax: config.rateLimitMax };

afterEach(() => {
  config.authEnabled = originalConfig.authEnabled;
  config.apiKeyHashes = originalConfig.apiKeyHashes;
  config.rateLimitMax = originalConfig.rateLimitMax;
});

/** Builds a single-entry `apiKeyHashes` map for the given raw key and tenant. */
function apiKeyHashesFor(rawKey: string, tenantId: string): Record<string, ApiKeyEntry> {
  return { [hashApiKey(rawKey)]: { tenantId, scopes: ['*'] } };
}

/**
 * Starts a minimal app that mirrors app.ts's data-route wiring (authMiddleware then the
 * tenant rate limiter) in front of a no-op route, on an ephemeral port.
 * @returns The base URL and a stop function.
 */
async function startTestApp(): Promise<{ baseUrl: string; stop: () => void }> {
  const app = express();
  app.use(authMiddleware(), tenantRateLimitMiddleware());
  app.get('/probe', (_req, res) => res.status(200).json({ ok: true }));

  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return { baseUrl, stop: () => server.close() };
}

describe('tenant rate limiter', () => {
  it('blocks a tenant with 429 once its own quota is exhausted', async () => {
    config.authEnabled = true;
    config.rateLimitMax = 2;
    config.apiKeyHashes = apiKeyHashesFor('sk-acme', 'acme');
    const { baseUrl, stop } = await startTestApp();

    try {
      const first = await fetch(`${baseUrl}/probe`, { headers: { 'x-api-key': 'sk-acme' } });
      const second = await fetch(`${baseUrl}/probe`, { headers: { 'x-api-key': 'sk-acme' } });
      const third = await fetch(`${baseUrl}/probe`, { headers: { 'x-api-key': 'sk-acme' } });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(third.status).toBe(429);
    } finally {
      stop();
    }
  });

  it('gives each tenant its own budget, independent of the other', async () => {
    config.authEnabled = true;
    config.rateLimitMax = 1;
    config.apiKeyHashes = { ...apiKeyHashesFor('sk-acme', 'acme'), ...apiKeyHashesFor('sk-globex', 'globex') };
    const { baseUrl, stop } = await startTestApp();

    try {
      const acmeFirst = await fetch(`${baseUrl}/probe`, { headers: { 'x-api-key': 'sk-acme' } });
      const acmeSecond = await fetch(`${baseUrl}/probe`, { headers: { 'x-api-key': 'sk-acme' } });
      const globexFirst = await fetch(`${baseUrl}/probe`, { headers: { 'x-api-key': 'sk-globex' } });

      expect(acmeFirst.status).toBe(200);
      // Acme has exhausted its own quota (limit 1)...
      expect(acmeSecond.status).toBe(429);
      // ...but Globex, a different tenant, is unaffected.
      expect(globexFirst.status).toBe(200);
    } finally {
      stop();
    }
  });
});
