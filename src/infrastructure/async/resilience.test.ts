import { describe, expect, it, vi } from 'vitest';
import { TimeoutError, withRetry, withTimeout } from './resilience';

const noSleep = () => Promise.resolve();

describe('withTimeout', () => {
  it('resolves when the operation finishes in time', async () => {
    await expect(withTimeout(1000, async () => 'ok')).resolves.toBe('ok');
  });

  it('rejects with TimeoutError when the operation is too slow', async () => {
    const slow = withTimeout(20, () => new Promise((resolve) => setTimeout(() => resolve('late'), 200)), 'slow op');

    await expect(slow).rejects.toBeInstanceOf(TimeoutError);
    await expect(slow).rejects.toThrow('slow op timed out after 20ms');
  });

  it('aborts the signal when it times out', async () => {
    let aborted = false;
    await withTimeout(20, (signal) => {
      signal.addEventListener('abort', () => (aborted = true));
      return new Promise((resolve) => setTimeout(resolve, 200));
    }).catch(() => undefined);

    expect(aborted).toBe(true);
  });

  it('propagates the operation error unchanged', async () => {
    await expect(withTimeout(1000, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });

  it('skips the timer when ms <= 0', async () => {
    await expect(withTimeout(0, async () => 'no-timeout')).resolves.toBe('no-timeout');
  });
});

describe('withRetry', () => {
  it('returns immediately on first success', async () => {
    const op = vi.fn(async () => 'ok');

    await expect(withRetry(op, { sleep: noSleep })).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure and then succeeds', async () => {
    let calls = 0;
    const op = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error('transient');
      return 'recovered';
    });

    await expect(withRetry(op, { attempts: 3, sleep: noSleep, jitter: () => 0 })).resolves.toBe('recovered');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting attempts', async () => {
    const op = vi.fn(async () => { throw new Error('always fails'); });

    await expect(withRetry(op, { attempts: 3, sleep: noSleep })).rejects.toThrow('always fails');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-retryable error', async () => {
    const op = vi.fn(async () => { throw new Error('4xx'); });

    await expect(
      withRetry(op, { attempts: 5, sleep: noSleep, isRetryable: () => false })
    ).rejects.toThrow('4xx');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('backs off exponentially with the configured base', async () => {
    const delays: number[] = [];
    const op = vi.fn(async () => { throw new Error('fail'); });

    await withRetry(op, {
      attempts: 4,
      baseDelayMs: 100,
      jitter: () => 0, // fixes multiplier at 0.5
      sleep: async (ms) => void delays.push(ms),
    }).catch(() => undefined);

    // 100*2^0*0.5=50, 100*2^1*0.5=100, 100*2^2*0.5=200
    expect(delays).toEqual([50, 100, 200]);
  });

  it('caps the backoff at maxDelayMs', async () => {
    const delays: number[] = [];
    const op = vi.fn(async () => { throw new Error('fail'); });

    await withRetry(op, {
      attempts: 5,
      baseDelayMs: 1000,
      maxDelayMs: 1500,
      jitter: () => 1, // multiplier 1.0
      sleep: async (ms) => void delays.push(ms),
    }).catch(() => undefined);

    expect(Math.max(...delays)).toBeLessThanOrEqual(1500);
  });
});
