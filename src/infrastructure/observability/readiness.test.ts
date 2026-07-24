import { beforeEach, describe, expect, it, vi } from 'vitest';

// The readiness probe constructs a fresh Chroma/Ollama client and pings it; mocking the
// constructors lets each test drive the ping outcome without a real dependency running.
const heartbeat = vi.fn();
const list = vi.fn();

vi.mock('chromadb', () => ({
  ChromaClient: class {
    heartbeat() {
      return heartbeat();
    }
  },
}));
vi.mock('ollama', () => ({
  Ollama: class {
    list() {
      return list();
    }
  },
}));

import { checkReadiness } from './readiness';

beforeEach(() => {
  heartbeat.mockReset();
  list.mockReset();
});

describe('checkReadiness', () => {
  it('reports ready when every dependency answers', async () => {
    heartbeat.mockResolvedValue(1);
    list.mockResolvedValue({ models: [] });

    const report = await checkReadiness();

    expect(report.ready).toBe(true);
    expect(report.dependencies).toEqual([
      { name: 'chroma', ok: true },
      { name: 'ollama', ok: true },
    ]);
  });

  it('reports not ready and names the failing dependency with its reason', async () => {
    heartbeat.mockResolvedValue(1);
    list.mockRejectedValue(new Error('connection refused'));

    const report = await checkReadiness();

    expect(report.ready).toBe(false);
    const ollama = report.dependencies.find((dependency) => dependency.name === 'ollama');
    expect(ollama).toMatchObject({ ok: false, error: 'connection refused' });
    // One dead dependency must not mask the healthy one.
    expect(report.dependencies.find((dependency) => dependency.name === 'chroma')).toEqual({
      name: 'chroma',
      ok: true,
    });
  });

  it('is not ready when both dependencies are down', async () => {
    heartbeat.mockRejectedValue(new Error('no chroma'));
    list.mockRejectedValue(new Error('no ollama'));

    const report = await checkReadiness();

    expect(report.ready).toBe(false);
    expect(report.dependencies.every((dependency) => !dependency.ok)).toBe(true);
  });
});
