import { AddressInfo } from 'net';
import http, { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HydeQueryExpander } from './hyde-query-expander';

let lastRequest: Record<string, any>;
let nextReply: string;
let server: Server;
let host: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      lastRequest = JSON.parse(body || '{}');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ model: lastRequest.model, done: true, message: { role: 'assistant', content: nextReply } }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

describe('HydeQueryExpander', () => {
  it('searches with the hypothetical passage, not the question', async () => {
    nextReply = 'The Kestrel spool buffer is capped at 2 GB before it starts dropping frames.';
    const expander = new HydeQueryExpander('test-model', host);

    const expansion = await expander.expand('How big is the spool buffer?');

    expect(expansion.searchTexts).toEqual(['The Kestrel spool buffer is capped at 2 GB before it starts dropping frames.']);
    const userMessage = lastRequest.messages.find((message: any) => message.role === 'user').content;
    expect(userMessage).toBe('How big is the spool buffer?');
  });

  it('falls back to the raw question when the model returns an empty passage', async () => {
    nextReply = '';
    const expander = new HydeQueryExpander('test-model', host);

    const expansion = await expander.expand('original question');

    expect(expansion.searchTexts).toEqual(['original question']);
  });

  it('falls back to the raw question when the request fails', async () => {
    const expander = new HydeQueryExpander('test-model', 'http://127.0.0.1:1');

    const expansion = await expander.expand('original question');

    expect(expansion.searchTexts).toEqual(['original question']);
  });
});
