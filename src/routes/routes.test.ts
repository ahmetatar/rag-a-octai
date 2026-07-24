import { AddressInfo } from 'net';
import { Server } from 'http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import config from '@app/config';
import { createApp } from '@app/app';

const authConfig = { authEnabled: config.authEnabled, apiKeys: config.apiKeys };

afterEach(() => {
  // Auth is toggled per test via config; restore the defaults so other suites are unaffected.
  config.authEnabled = authConfig.authEnabled;
  config.apiKeys = authConfig.apiKeys;
});

// The upload limits these tests assert against (1 MB, 2 files) are set in vitest.config.ts:
// the ingestion route reads them from config at import time, so they must already be in
// the environment before this module loads.
const MAX_UPLOAD_FILE_SIZE_MB = 1;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

/**
 * POSTs a JSON body to a path on the test server.
 */
function postJson(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * POSTs files to /ingest as multipart/form-data.
 * @param files The files to attach, as [field, filename, content, mimeType].
 */
function postFiles(files: [string, string, string, string][]) {
  const form = new FormData();
  files.forEach(([field, filename, content, type]) => {
    form.append(field, new Blob([content], { type }), filename);
  });

  return fetch(`${baseUrl}/ingest`, { method: 'POST', body: form });
}

describe('GET /health', () => {
  it('reports that the process is alive', async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: 'ok' });
  });
});

describe('authentication (when enabled)', () => {
  it('rejects /query without a key', async () => {
    config.authEnabled = true;
    config.apiKeys = { 'sk-acme': 'acme' };

    const response = await postJson('/query', { query: 'hello' });

    expect(response.status).toBe(401);
  });

  it('rejects /ingest without a key', async () => {
    config.authEnabled = true;
    config.apiKeys = { 'sk-acme': 'acme' };

    const response = await fetch(`${baseUrl}/ingest`, { method: 'POST', body: new FormData() });

    expect(response.status).toBe(401);
  });

  it('lets a valid key through to request validation', async () => {
    config.authEnabled = true;
    config.apiKeys = { 'sk-acme': 'acme' };

    // A valid key passes auth; the empty body then fails validation with 400, which proves
    // the request got past the auth layer (401 would mean it did not).
    const response = await fetch(`${baseUrl}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'sk-acme' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
  });

  it('leaves /health open without a key', async () => {
    config.authEnabled = true;
    config.apiKeys = { 'sk-acme': 'acme' };

    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
  });
});

describe('unknown routes', () => {
  it('answers with JSON rather than Express\' HTML error page', async () => {
    const response = await fetch(`${baseUrl}/does-not-exist`);

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({
      status: 'error',
      message: 'Cannot GET /does-not-exist',
    });
  });

  it('does not treat a known path with the wrong method as a match', async () => {
    const response = await postJson('/health', {});

    expect(response.status).toBe(404);
  });
});

describe('POST /query validation', () => {
  it.each([
    ['a missing query', {}, 'query'],
    ['a blank query', { query: '   ' }, 'query'],
    ['a query over the length limit', { query: 'a'.repeat(5000) }, 'query'],
    ['a non-integer topK', { query: 'q', topK: 2.5 }, 'topK'],
    ['a topK above the maximum', { query: 'q', topK: 10_000 }, 'topK'],
    ['a threshold outside the score range', { query: 'q', threshold: 5 }, 'threshold'],
  ])('rejects %s', async (_case, body, field) => {
    const response = await postJson('/query', body);

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { message: string; details: string[] };
    expect(payload.message).toBe('Invalid request');
    expect(payload.details.join(' ')).toContain(field);
  });

  it('never reaches the model when the body is invalid', async () => {
    // Nothing is running on the configured Ollama/Chroma hosts during tests, so a 400
    // here also proves validation short-circuits before any dependency is touched.
    const response = await postJson('/query', {});

    expect(response.status).toBe(400);
  });
});

describe('POST /ingest validation', () => {
  it('rejects a request with no file', async () => {
    const response = await fetch(`${baseUrl}/ingest`, { method: 'POST', body: new FormData() });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ status: 'error' });
  });

  it('rejects a file type that has no registered handler', async () => {
    const response = await postFiles([['docs', 'image.png', 'not really a png', 'image/png']]);

    expect(response.status).toBe(415);
    const payload = (await response.json()) as { message: string };
    expect(payload.message).toContain('image/png');
    expect(payload.message).toContain('text/plain');
  });

  it('rejects a file larger than the configured limit', async () => {
    const oversized = 'x'.repeat((MAX_UPLOAD_FILE_SIZE_MB + 1) * 1024 * 1024);
    const response = await postFiles([['docs', 'big.txt', oversized, 'text/plain']]);

    expect(response.status).toBe(413);
  });

  it('rejects more files than the configured limit', async () => {
    const response = await postFiles([
      ['docs', 'a.txt', 'a', 'text/plain'],
      ['docs', 'b.txt', 'b', 'text/plain'],
      ['docs', 'c.txt', 'c', 'text/plain'],
    ]);

    expect(response.status).toBe(413);
  });

  it('rejects files sent under the wrong field name', async () => {
    const response = await postFiles([['files', 'a.txt', 'a', 'text/plain']]);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ message: expect.stringContaining('docs') });
  });
});
