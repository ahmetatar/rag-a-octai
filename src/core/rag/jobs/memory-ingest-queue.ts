import { randomUUID } from 'crypto';
import { logger } from '@infrastructure/logging';
import { IngestJobHandler, IngestJobPayload, IngestJobStatus, IngestQueue } from './ingest-queue';

/**
 * In-process ingest queue.
 *
 * Runs jobs asynchronously in the same process and keeps their status in memory. Used for
 * tests and single-instance setups without Redis. NOT durable: queued/running jobs are lost
 * on restart, and status is not shared across instances — use the BullMQ driver for those.
 */
export class MemoryIngestQueue implements IngestQueue {
  private readonly statuses = new Map<string, IngestJobStatus>();
  /** In-flight job promises, so close() can wait for them to settle. */
  private readonly inFlight = new Set<Promise<void>>();

  constructor(private readonly handler: IngestJobHandler) {}

  /** @inheritdoc */
  async enqueue(payload: IngestJobPayload): Promise<string> {
    const id = randomUUID();
    this.statuses.set(id, { id, state: 'queued' });

    // Detached on purpose: the point of the queue is to return before the work is done.
    const task = this.run(id, payload);
    this.inFlight.add(task);
    task.finally(() => this.inFlight.delete(task));

    return id;
  }

  /** @inheritdoc */
  async getStatus(jobId: string): Promise<IngestJobStatus | null> {
    return this.statuses.get(jobId) ?? null;
  }

  /** @inheritdoc */
  async close(): Promise<void> {
    await Promise.allSettled(this.inFlight);
  }

  /**
   * Runs a single job and records its terminal status.
   * @param id The job id.
   * @param payload The job payload.
   */
  private async run(id: string, payload: IngestJobPayload): Promise<void> {
    this.statuses.set(id, { id, state: 'active' });

    try {
      const result = await this.handler(payload);
      this.statuses.set(id, { id, state: 'completed', result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Ingest job ${id} failed: ${message}`);
      this.statuses.set(id, { id, state: 'failed', error: message });
    }
  }
}
