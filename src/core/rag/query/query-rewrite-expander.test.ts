import { AddressInfo } from 'net';
import http, { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QueryRewriteExpander } from './query-rewrite-expander';

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

describe('QueryRewriteExpander', () => {
  it('searches with the rewritten query', async () => {
    nextReply = 'Kestrel collector spool buffer size';
    const expander = new QueryRewriteExpander('test-model', host);

    const expansion = await expander.expand('hey what is the buffer thing for kestrel again');

    expect(expansion.searchTexts).toEqual(['Kestrel collector spool buffer size']);
    const userMessage = lastRequest.messages.find((message: any) => message.role === 'user').content;
    expect(userMessage).toBe('hey what is the buffer thing for kestrel again');
  });

  it('falls back to the raw query when the model returns an empty rewrite', async () => {
    nextReply = '   ';
    const expander = new QueryRewriteExpander('test-model', host);

    const expansion = await expander.expand('original question');

    expect(expansion.searchTexts).toEqual(['original question']);
  });

  it('falls back to the raw query when the request fails', async () => {
    const expander = new QueryRewriteExpander('test-model', 'http://127.0.0.1:1');

    const expansion = await expander.expand('original question');

    expect(expansion.searchTexts).toEqual(['original question']);
  });
});
