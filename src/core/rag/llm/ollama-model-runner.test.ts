import { AddressInfo } from 'net';
import http, { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OllamaLangModelRunner } from './ollama-model-runner';

/** The last chat request the stand-in Ollama server received. */
let lastRequest: Record<string, any>;
let server: Server;
let host: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      lastRequest = JSON.parse(body || '{}');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ model: lastRequest.model, done: true, message: { role: 'assistant', content: 'ok' } }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

describe('OllamaLangModelRunner', () => {
  it('caps generation with num_predict when a token limit is given', async () => {
    const runner = new OllamaLangModelRunner('test-model', host);

    await runner.generateResponse({ question: 'q?', maxTokens: 123, sources: [{ content: 'context' }] });

    expect(lastRequest.options).toEqual({ num_predict: 123 });
  });

  it('sends no options when no token limit is given', async () => {
    const runner = new OllamaLangModelRunner('test-model', host);

    await runner.generateResponse({ question: 'q?', sources: [{ content: 'context' }] });

    expect(lastRequest.options).toBeUndefined();
  });

  it('numbers the retrieved chunks in the prompt so the model can refer to them', async () => {
    const runner = new OllamaLangModelRunner('test-model', host);

    await runner.generateResponse({ question: 'q?', sources: [{ content: 'first' }, { content: 'second' }] });

    const userMessage = lastRequest.messages.find((message: any) => message.role === 'user').content;
    expect(userMessage).toContain('[1] first');
    expect(userMessage).toContain('[2] second');
    expect(userMessage).toContain('Question: q?');
  });

  it('tells the model to admit it cannot answer when no chunk was retrieved', async () => {
    const runner = new OllamaLangModelRunner('test-model', host);

    await runner.generateResponse({ question: 'q?', sources: [] });

    const userMessage = lastRequest.messages.find((message: any) => message.role === 'user').content;
    expect(userMessage).toContain("You don't have any relevant information");
    expect(userMessage).not.toContain('Context:');
  });

  it('returns the assistant message content', async () => {
    const runner = new OllamaLangModelRunner('test-model', host);

    await expect(runner.generateResponse({ question: 'q?' })).resolves.toBe('ok');
  });
});
