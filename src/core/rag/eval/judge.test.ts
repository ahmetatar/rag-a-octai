import { AddressInfo } from 'net';
import http, { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LlmJudge } from './judge';

/** The last chat request the stand-in Ollama server received. */
let lastRequest: Record<string, any>;
/** Scripts the next response body; set per-test before calling judge(). */
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

describe('LlmJudge', () => {
  it('asks for JSON output and returns the parsed verdict', async () => {
    nextReply = JSON.stringify({ correct: true, reasoning: 'matches the expected fact' });
    const judge = new LlmJudge('test-model', host);

    const verdict = await judge.judge('What is the SLA?', 'The SLA is 99.9%.', ['99.9%']);

    expect(verdict).toEqual({ correct: true, reasoning: 'matches the expected fact' });
    expect(lastRequest.format).toBe('json');
    const userMessage = lastRequest.messages.find((message: any) => message.role === 'user').content;
    expect(userMessage).toContain('What is the SLA?');
    expect(userMessage).toContain('99.9%');
  });

  it('reports an incorrect verdict', async () => {
    nextReply = JSON.stringify({ correct: false, reasoning: 'answer contradicts the expected fact' });
    const judge = new LlmJudge('test-model', host);

    const verdict = await judge.judge('q?', 'wrong answer', ['right fact']);

    expect(verdict?.correct).toBe(false);
  });

  it('takes the first accepted spelling of a multi-spelling expected keyword', async () => {
    nextReply = JSON.stringify({ correct: true, reasoning: 'ok' });
    const judge = new LlmJudge('test-model', host);

    await judge.judge('q?', 'a', [['25%', '25 percent']]);

    const userMessage = lastRequest.messages.find((message: any) => message.role === 'user').content;
    expect(userMessage).toContain('25%');
  });

  it('returns undefined rather than throwing when the response is not valid JSON', async () => {
    nextReply = 'not json';
    const judge = new LlmJudge('test-model', host);

    await expect(judge.judge('q?', 'a', ['fact'])).resolves.toBeUndefined();
  });

  it('returns undefined when the parsed response is missing the correct field', async () => {
    nextReply = JSON.stringify({ reasoning: 'no verdict given' });
    const judge = new LlmJudge('test-model', host);

    await expect(judge.judge('q?', 'a', ['fact'])).resolves.toBeUndefined();
  });
});
