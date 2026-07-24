import { describe, expect, it, vi } from 'vitest';
import { MemoryIngestQueue } from './memory-ingest-queue';
import { IngestJobPayload } from './ingest-queue';

const PAYLOAD: IngestJobPayload = { files: [], tenantId: 'acme' };

/** Polls a queue until the job reaches a terminal state or the attempts run out. */
async function waitForTerminal(queue: MemoryIngestQueue, jobId: string) {
  for (let i = 0; i < 50; i++) {
    const status = await queue.getStatus(jobId);
    if (status && (status.state === 'completed' || status.state === 'failed')) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('job did not reach a terminal state');
}

describe('MemoryIngestQueue', () => {
  it('returns a job id and starts in a non-terminal state', async () => {
    const queue = new MemoryIngestQueue(async () => ({ chunks: 1, sources: 1 }));

    const jobId = await queue.enqueue(PAYLOAD);

    expect(jobId).toBeTruthy();
  });

  it('runs the handler and records the result on completion', async () => {
    const handler = vi.fn(async () => ({ chunks: 3, sources: 1 }));
    const queue = new MemoryIngestQueue(handler);

    const jobId = await queue.enqueue(PAYLOAD);
    const status = await waitForTerminal(queue, jobId);

    expect(handler).toHaveBeenCalledWith(PAYLOAD);
    expect(status.state).toBe('completed');
    expect(status.result).toEqual({ chunks: 3, sources: 1 });
  });

  it('records a failure without throwing', async () => {
    const queue = new MemoryIngestQueue(async () => { throw new Error('ingest boom'); });

    const jobId = await queue.enqueue(PAYLOAD);
    const status = await waitForTerminal(queue, jobId);

    expect(status.state).toBe('failed');
    expect(status.error).toBe('ingest boom');
  });

  it('returns null for an unknown job id', async () => {
    const queue = new MemoryIngestQueue(async () => ({ chunks: 0, sources: 0 }));

    await expect(queue.getStatus('nope')).resolves.toBeNull();
  });

  it('waits for in-flight jobs on close', async () => {
    let finished = false;
    const queue = new MemoryIngestQueue(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      finished = true;
      return { chunks: 0, sources: 0 };
    });

    await queue.enqueue(PAYLOAD);
    await queue.close();

    expect(finished).toBe(true);
  });
});
