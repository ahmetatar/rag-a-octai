import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import express, { NextFunction, Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import config from '@app/config';
import {
  createIngestQueue,
  getRegisteredMimeTypes,
  IngestJobFile,
  IngestQueue,
  isMimeTypeSupported,
} from '@core/rag';
import { logger } from '@infrastructure/logging';
import { tenantOf } from '@infrastructure/http';

const router = express.Router();

const MAX_FILE_SIZE_BYTES = config.maxUploadFileSizeMb * 1024 * 1024;

// Uploaded files are staged here for the async worker; created once at startup.
if (!existsSync(config.uploadDir)) {
  mkdirSync(config.uploadDir, { recursive: true });
}

// One shared queue instance backs both the enqueue and status handlers, and is closed on
// shutdown (see closeIngestQueue).
let queue: IngestQueue | undefined;

/**
 * Returns the shared ingest queue, creating it on first use.
 * @returns The ingest queue.
 */
function getQueue(): IngestQueue {
  if (!queue) {
    queue = createIngestQueue();
  }
  return queue;
}

/**
 * Closes the ingest queue if it was created. Called on graceful shutdown.
 */
export async function closeIngestQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}

/**
 * Raised when an uploaded file has a MIME type that no handler is registered for.
 */
class UnsupportedFileTypeError extends Error {
  constructor(mimetype: string) {
    super(`Unsupported file type "${mimetype}". Supported types: ${getRegisteredMimeTypes().join(', ')}.`);
    this.name = 'UnsupportedFileTypeError';
  }
}

// Files are streamed to disk (not held in memory) so the request returns quickly and large
// uploads never sit in the heap; the worker reads them back when it processes the job.
const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, file, callback) => {
      // Random on-disk name avoids collisions; the real name travels in the job payload.
      callback(null, `${randomUUID()}${path.extname(file.originalname)}`);
    },
  }),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: config.maxUploadFiles,
  },
  fileFilter: (_req, file, callback) => {
    // Read the registry per request: handlers are registered after this module loads.
    if (!isMimeTypeSupported(file.mimetype)) {
      callback(new UnsupportedFileTypeError(file.mimetype));
      return;
    }

    callback(null, true);
  },
});

const uploadDocs = upload.array('docs');

/**
 * Maps an upload failure onto an HTTP status and a message safe to return to the client.
 * @param error The error raised by multer or by the file filter.
 * @returns The status code and client-facing message describing the failure.
 */
function describeUploadError(error: unknown): { status: number; message: string } {
  if (error instanceof UnsupportedFileTypeError) {
    return { status: 415, message: error.message };
  }

  if (error instanceof MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return { status: 413, message: `Each file must be at most ${config.maxUploadFileSizeMb} MB.` };
      case 'LIMIT_FILE_COUNT':
        return { status: 413, message: `At most ${config.maxUploadFiles} file(s) can be uploaded at once.` };
      case 'LIMIT_UNEXPECTED_FILE':
        return { status: 400, message: `Unexpected field "${error.field}". Upload files under the "docs" field.` };
      default:
        return { status: 400, message: `Upload failed (${error.code}).` };
    }
  }

  return { status: 400, message: 'Upload failed.' };
}

/**
 * Runs the upload middleware and turns upload failures into client errors instead of
 * letting them fall through to the generic 500 handler.
 */
function handleUpload(req: Request, res: Response, next: NextFunction): void {
  uploadDocs(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }

    const { status, message } = describeUploadError(error);
    logger.warn(`Upload rejected (${status}): ${message}`);
    res.status(status).json({ status: 'error', message });
  });
}

/**
 * POST /ingest
 * Accepts multipart/form-data with files under the 'docs' field, stages them, and enqueues
 * an ingestion job. Returns 202 with a job id immediately — ingestion runs in the
 * background so a large upload never blocks the request.
 *
 * Response: { status: 'accepted', jobId }
 *
 * Errors:
 * - 400 no file / malformed request
 * - 413 file too large or too many files
 * - 415 unsupported file type
 * - 401 when auth is enabled and no valid key is given
 */
router.post('/', handleUpload, async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];

  if (files.length === 0) {
    return res.status(400).json({ status: 'error', message: 'No files provided under the "docs" field.' });
  }

  const jobFiles: IngestJobFile[] = files.map((file) => ({
    path: file.path,
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
  }));

  try {
    const jobId = await getQueue().enqueue({
      files: jobFiles,
      params: req.query as Record<string, unknown>,
      tenantId: tenantOf(res.locals),
    });

    res.status(202).json({ status: 'accepted', jobId });
  } catch (error) {
    logger.error(`Failed to enqueue ingestion: ${error instanceof Error ? error.stack ?? error.message : error}`);
    res.status(500).json({ status: 'error', message: 'Could not enqueue ingestion' });
  }
});

/**
 * GET /ingest/status/:jobId
 * Returns the current state of a previously submitted ingestion job.
 *
 * Response: { id, state: 'queued'|'active'|'completed'|'failed', result?, error? }
 * - 404 when the job id is unknown (or its history has expired).
 */
router.get('/status/:jobId', async (req, res) => {
  try {
    const status = await getQueue().getStatus(req.params.jobId);

    if (!status) {
      return res.status(404).json({ status: 'error', message: 'Unknown job id' });
    }

    res.json(status);
  } catch (error) {
    logger.error(`Failed to read job status: ${error instanceof Error ? error.stack ?? error.message : error}`);
    res.status(500).json({ status: 'error', message: 'Could not read job status' });
  }
});

export default router;
