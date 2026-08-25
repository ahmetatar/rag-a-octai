import { Queue, Worker } from 'bullmq';
import IORedis, { Redis } from 'ioredis';
import config from '@app/config';
import { logger } from '@infrastructure/logging';
import { IngestJobHandler, IngestJobPayload, IngestJobStatus, IngestQueue } from './ingest-queue';

const QUEUE_NAME = 'ingest';

/**
 * Persistent ingest queue backed by BullMQ + Redis.
 *
 * Jobs survive process restarts, are retried with backoff, and their status is visible
 * across instances. A blocking Worker needs its own Redis connection separate from the
 * Queue's, and BullMQ requires `maxRetriesPerRequest: null` on worker connections.
 */
export class BullIngestQueue implements IngestQueue {
  private readonly queue: Queue<IngestJobPayload>;
  private readonly worker: Worker<IngestJobPayload>;
  private readonly connections: Redis[];

  constructor(handler: IngestJobHandler) {
    const queueConnection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
    const workerConnection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
    this.connections = [queueConnection, workerConnection];

    this.queue = new Queue<IngestJobPayload>(QUEUE_NAME, { connection: queueConnection });

    this.worker = new Worker<IngestJobPayload>(
      QUEUE_NAME,
      async (job) => {
        const maxAttempts = job.opts.attempts ?? 1;
        const isLastAttempt = job.attemptsMade + 1 >= maxAttempts;
        return handler(job.data, isLastAttempt);
      },
      {
        connection: workerConnection,
        concurrency: config.queueConcurrency,
      }
    );

    this.worker.on('failed', (job, error) => {
      logger.error(`Ingest job ${job?.id} failed: ${error.message}`);
    });
  }

  /** @inheritdoc */
  async enqueue(payload: IngestJobPayload): Promise<string> {
    const job = await this.queue.add(QUEUE_NAME, payload, {
      attempts: config.jobAttempts,
      backoff: { type: 'exponential', delay: 1000 },
      // Keep a bounded history so status stays queryable for a while without unbounded growth.
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600 },
    });

    return String(job.id);
  }

  /** @inheritdoc */
  async getStatus(jobId: string): Promise<IngestJobStatus | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) {
      return null;
    }

    const state = await job.getState();

    if (state === 'completed') {
      return { id: jobId, state: 'completed', result: job.returnvalue };
    }
    if (state === 'failed') {
      return { id: jobId, state: 'failed', error: job.failedReason };
    }
    if (state === 'active') {
      return { id: jobId, state: 'active' };
    }

    // waiting / delayed / prioritized / waiting-children all mean "not started yet".
    return { id: jobId, state: 'queued' };
  }

  /** @inheritdoc */
  async close(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
    await Promise.allSettled(this.connections.map((connection) => connection.quit()));
  }
}
