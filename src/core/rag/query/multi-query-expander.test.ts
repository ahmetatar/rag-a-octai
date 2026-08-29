import { AddressInfo } from 'net';
import http, { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MultiQueryExpander } from './multi-query-expander';

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

describe('MultiQueryExpander', () => {
  it('asks for JSON output and returns the original question plus every variant', async () => {
    nextReply = JSON.stringify({ queries: ['variant one', 'variant two', 'variant three'] });
    const expander = new MultiQueryExpander('test-model', host);

    const expansion = await expander.expand('original question');

    expect(expansion.searchTexts).toEqual(['original question', 'variant one', 'variant two', 'variant three']);
    expect(lastRequest.format).toBe('json');
  });

  it('drops non-string or blank entries from a malformed variant list', async () => {
    nextReply = JSON.stringify({ queries: ['good variant', '', 42, null, '   '] });
    const expander = new MultiQueryExpander('test-model', host);

    const expansion = await expander.expand('original question');

    expect(expansion.searchTexts).toEqual(['original question', 'good variant']);
  });

  it('falls back to the raw query alone when the response is not valid JSON', async () => {
    nextReply = 'not json';
    const expander = new MultiQueryExpander('test-model', host);

    const expansion = await expander.expand('original question');

    expect(expansion.searchTexts).toEqual(['original question']);
  });

  it('falls back to the raw query alone when queries is missing entirely', async () => {
    nextReply = JSON.stringify({ something: 'else' });
    const expander = new MultiQueryExpander('test-model', host);

    const expansion = await expander.expand('original question');

    expect(expansion.searchTexts).toEqual(['original question']);
  });

  it('honours a configured variant count in the prompt', async () => {
    nextReply = JSON.stringify({ queries: ['a', 'b'] });
    const expander = new MultiQueryExpander('test-model', host, 2);

    await expander.expand('original question');

    const systemMessage = lastRequest.messages.find((message: any) => message.role === 'system').content;
    expect(systemMessage).toContain('exactly 2');
  });
});
