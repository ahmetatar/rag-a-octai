import { describe, expect, it } from 'vitest';
import { lazySingleton } from './lazy-singleton';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('lazySingleton', () => {
  it('does not run the factory until it is called', async () => {
    let calls = 0;
    lazySingleton(async () => ++calls);

    expect(calls).toBe(0);
  });

  it('runs the factory once for concurrent callers and hands them the same instance', async () => {
    let calls = 0;
    const get = lazySingleton(async () => {
      calls++;
      await sleep(20);
      return { id: calls };
    });

    const instances = await Promise.all(Array.from({ length: 20 }, () => get()));

    expect(calls).toBe(1);
    expect(instances.every((instance) => instance === instances[0])).toBe(true);
  });

  it('retries after a failure instead of caching the rejection', async () => {
    let attempts = 0;
    const get = lazySingleton(async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error('dependency unavailable');
      }
      return 'ready';
    });

    await expect(get()).rejects.toThrow('dependency unavailable');
    await expect(get()).resolves.toBe('ready');
    expect(attempts).toBe(2);
  });

  it('builds a new instance after reset', async () => {
    let calls = 0;
    const get = lazySingleton(async () => ({ id: ++calls }));

    const first = await get();
    get.reset();
    const second = await get();

    expect(second).not.toBe(first);
    expect(calls).toBe(2);
  });
});
