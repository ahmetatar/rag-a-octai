import express from 'express';
import multer from 'multer';
import logger from '@infrastructure/logging/default-logger';
import { createRagDataIngestor } from '@core/rag';
import { HandlerResolveParameters } from '@infrastructure/file-handlers';

const router = express.Router();
const upload = multer();
const ragDataIngestor = createRagDataIngestor();
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
 */
router.post('/', upload.array('docs'), async (req, res) => {
  const files = req.files as Express.Multer.File[];

  try {
    await ragDataIngestor.ingest(files, req.query as HandlerResolveParameters);
  } catch (error) {
    logger.error('Error during ingestion:', error);
    return res.status(500).json({ status: 'error', message: 'Ingestion failed', error });
  }

  res.json({ status: 'success' });
});

export default router;
