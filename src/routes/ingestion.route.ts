import express, { NextFunction, Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import config from '@app/config';
import {
  createRagDataIngestor,
  getRegisteredMimeTypes,
  HandlerResolveParameters,
  isMimeTypeSupported,
} from '@core/rag';
import { logger } from '@infrastructure/logging';
import { lazySingleton } from '@infrastructure/async';
import { tenantOf } from '@infrastructure/http';

const router = express.Router();

const MAX_FILE_SIZE_BYTES = config.maxUploadFileSizeMb * 1024 * 1024;

/**
 * Raised when an uploaded file has a MIME type that no handler is registered for.
 */
class UnsupportedFileTypeError extends Error {
  constructor(mimetype: string) {
    super(`Unsupported file type "${mimetype}". Supported types: ${getRegisteredMimeTypes().join(', ')}.`);
    this.name = 'UnsupportedFileTypeError';
  }
}

// Uploads are buffered in memory and every chunk is embedded, so an unbounded upload is
// an easy way to exhaust memory. Reject oversized or unsupported files before that.
const upload = multer({
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

// Built on the first request and reused afterwards. Building it is async (the embedding
// model may need loading), so it must not happen at module load.
const getRagDataIngestor = lazySingleton(createRagDataIngestor);

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
 * Endpoint to ingest documents
 * Expects multipart/form-data with files under the 'docs' field
 * Returns JSON status response
 * Example request using curl:
 * curl -X POST -F "docs=@/path/to/doc1.txt" -F "docs=@/path/to/doc2.pdf" http://localhost:3000/ingest
 * Response:
 * {
 *   "status": "success"
 * }
 * or
 * {
 *   "status": "error",
 *   "message": "Ingestion failed"
 * }
 *
 * Error Handling:
 * - 400 when no file is provided or the request is malformed.
 * - 413 when a file exceeds MAX_UPLOAD_FILE_SIZE_MB or there are more than MAX_UPLOAD_FILES files.
 * - 415 when a file's MIME type has no registered handler.
 * - 500 when ingestion itself fails; the cause is logged, never returned.
 */
router.post('/', handleUpload, async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];

  if (files.length === 0) {
    return res.status(400).json({ status: 'error', message: 'No files provided under the "docs" field.' });
  }

  try {
    const ragDataIngestor = await getRagDataIngestor();
    await ragDataIngestor.ingest(files, req.query as HandlerResolveParameters, tenantOf(res.locals));
  } catch (error) {
    // Log the cause server-side; the client only learns that ingestion failed, since the
    // error may carry internal paths, hostnames or stack traces.
    logger.error(`Error during ingestion: ${error instanceof Error ? error.stack ?? error.message : error}`);
    return res.status(500).json({ status: 'error', message: 'Ingestion failed' });
  }

  res.json({ status: 'success' });
});

export default router;
