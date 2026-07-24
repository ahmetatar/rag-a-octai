import express from 'express';
import config from '@app/config';
import { ChromaVectorStore, VectorStore } from '@core/rag/vector-store';
import { tenantOf } from '@infrastructure/http';
import { logger } from '@infrastructure/logging';

const router = express.Router();

// One store instance for the route. The constructor only wires a client (no network), so it
// is safe to build at module load; the connection is opened lazily on first use.
const store: VectorStore = new ChromaVectorStore(config.chromaHost, config.chromaPort, config.chromaCollection);

/**
 * GET /documents
 * Response: { documents: Array<{ source, chunks }> }
 * Lists the distinct source documents the caller's tenant has ingested, with each one's
 * chunk count. Scoped to the tenant, so a caller never sees another tenant's documents.
 *
 * Errors:
 * - 401 when auth is enabled and no valid key is given.
 * - 500 on an internal error; the cause is logged, never returned.
 */
router.get('/', async (_req, res) => {
  try {
    const documents = await store.listSources(tenantOf(res.locals));
    res.json({ documents });
  } catch (error) {
    logger.error(`Failed to list documents: ${error instanceof Error ? error.stack ?? error.message : error}`);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * DELETE /documents/:source
 * Removes every chunk of the named source document, scoped to the caller's tenant. Supports
 * the "right to be forgotten": a document can be fully erased from the index.
 *
 * Response: { status: 'ok', source, deletedChunks }
 *
 * Errors:
 * - 404 when the tenant has no document by that name (so a caller can tell a no-op delete
 *   from a real one).
 * - 401 when auth is enabled and no valid key is given.
 * - 500 on an internal error; the cause is logged, never returned.
 */
router.delete('/:source', async (req, res) => {
  const { source } = req.params;
  const tenantId = tenantOf(res.locals);

  try {
    // Look the source up first so an unknown name is a 404 rather than a silent no-op:
    // Chroma's delete-by-filter succeeds even when it matches nothing.
    const existing = await store.listSources(tenantId);
    const match = existing.find((document) => document.source === source);

    if (!match) {
      return res.status(404).json({ status: 'error', message: `No document named "${source}".` });
    }

    await store.deleteBySource(source, tenantId);
    logger.info(`Deleted document "${source}" (${match.chunks} chunk(s)) for tenant ${tenantId}.`);

    res.json({ status: 'ok', source, deletedChunks: match.chunks });
  } catch (error) {
    logger.error(`Failed to delete document: ${error instanceof Error ? error.stack ?? error.message : error}`);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

export default router;
