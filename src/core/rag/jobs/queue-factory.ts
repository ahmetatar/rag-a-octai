import config from '@app/config';
import { logger } from '@infrastructure/logging';
import { createRagDataIngestor } from '../ingestion';
import { lazySingleton } from '@infrastructure/async';
import { BullIngestQueue } from './bull-ingest-queue';
import { createIngestJobHandler } from './ingest-job-handler';
import { IngestQueue } from './ingest-queue';
import { MemoryIngestQueue } from './memory-ingest-queue';

/**
 * Creates the ingest queue for the configured driver.
 *
 * The ingestor is resolved lazily and shared, so the embedding model loads at most once
 * whether the worker runs one job or many.
 *
 * @returns The queue implementation selected by `QUEUE_DRIVER`.
 */
export function createIngestQueue(): IngestQueue {
  const getIngestor = lazySingleton(createRagDataIngestor);
  const handler = createIngestJobHandler(getIngestor);

  if (config.queueDriver === 'memory') {
    logger.info('Ingest queue driver: memory (in-process, non-durable)');
    return new MemoryIngestQueue(handler);
  }

  logger.info(`Ingest queue driver: bull (Redis at ${config.redisUrl})`);
  return new BullIngestQueue(handler);
}
