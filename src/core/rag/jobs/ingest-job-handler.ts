import { promises as fs } from 'fs';
import { logger } from '@infrastructure/logging';
import { FileInfo, HandlerResolveParameters } from '../file-handlers';
import { RagDataIngestor } from '../ingestion';
import { IngestJobHandler, IngestJobPayload, IngestJobResult } from './ingest-queue';

/**
 * Builds the handler that turns a queued job into an actual ingestion run.
 *
 * Staged files are read from disk into buffers here (the buffer never travels through the
 * queue), and the shared ingestor processes them. Staged files are removed on success, or on
 * failure once the queue has no more retries left for this job — removing them after every
 * failed attempt would delete the file out from under a still-pending retry, turning a
 * transient error into a permanent ENOENT on the next attempt.
 *
 * @param getIngestor Resolves the shared ingestor (lazy; the embedding model may load).
 * @returns A job handler.
 */
export function createIngestJobHandler(getIngestor: () => Promise<RagDataIngestor>): IngestJobHandler {
  return async (payload: IngestJobPayload, isLastAttempt = true): Promise<IngestJobResult> => {
    try {
      const ingestor = await getIngestor();
      const files = await readStagedFiles(payload);
      const result = await ingestor.ingest(files, payload.params as HandlerResolveParameters, payload.tenantId);
      await removeStagedFiles(payload);
      return result;
    } catch (error) {
      if (isLastAttempt) {
        await removeStagedFiles(payload);
      }
      throw error;
    }
  };
}

/**
 * Reads each staged file into a FileInfo the ingestor understands.
 * @param payload The job payload.
 * @returns The files with their buffers.
 */
async function readStagedFiles(payload: IngestJobPayload): Promise<FileInfo[]> {
  return Promise.all(
    payload.files.map(async (file) => ({
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      encoding: '',
      buffer: await fs.readFile(file.path),
    }))
  );
}

/**
 * Deletes the staged files, tolerating already-missing ones.
 * @param payload The job payload.
 */
async function removeStagedFiles(payload: IngestJobPayload): Promise<void> {
  await Promise.allSettled(
    payload.files.map(async (file) => {
      try {
        await fs.unlink(file.path);
      } catch (error) {
        logger.warn(`Could not remove staged file ${file.path}: ${error instanceof Error ? error.message : error}`);
      }
    })
  );
}
