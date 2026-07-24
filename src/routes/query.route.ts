import { createRagOrchestrator } from '@core/rag';
import { logger } from '@infrastructure/logging';
import { lazySingleton } from '@infrastructure/async';
import { tenantOf } from '@infrastructure/http';
import express from 'express';
import { z } from 'zod';
import config from '@app/config';

const router = express.Router();

// Built on the first request and reused afterwards. Building it is async (the embedding
// model may need loading), so it must not happen at module load.
const getRagOrchestrator = lazySingleton(createRagOrchestrator);

/**
 * Shape of an accepted query request.
 *
 * `topK` and `threshold` fall back to the configured defaults, so a caller can tune a
 * single request (e.g. widen recall for a vague question) without changing the server.
 * Similarity scores are bounded by [-1, 1], so a threshold outside that range would
 * either match everything or nothing and is rejected as a mistake.
 */
const queryRequestSchema = z.object({
  query: z.string().trim().min(1, 'Query must not be empty').max(config.maxQueryLength),
  topK: z.number().int().positive().max(config.maxTopK).optional(),
  threshold: z.number().min(-1).max(1).optional(),
});

/**
 * POST /query
 * Body: { query: string, topK?: number, threshold?: number }
 * Response: { response: string, sources: Array<{ id, source, page, score, excerpt }> }
 * Generates a response based on the input query, together with the retrieved chunks it
 * was based on so the answer can be traced back to the documents.
 *
 * Example request body:
 * {
 *   "query": "What is the capital of France?"
 * }
 *
 * Example response body:
 * {
 *   "response": "The capital of France is Paris.",
 *   "sources": [
 *     { "id": "chunk-1", "source": "france.pdf", "page": 3, "score": 0.82, "excerpt": "..." }
 *   ]
 * }
 *
 * Error Handling:
 * - 400 when the body fails validation (missing/empty query, out-of-range topK or threshold).
 * - 500 when an internal error occurs; the cause is logged, never returned.
 *
 * Sample curl command:
 * curl -X POST http://localhost:3000/query -H "Content-Type: application/json" -d '{"query": "What is the capital of France?"}'
 */
router.post('/', async (req, res) => {
  const parsed = queryRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    // These messages describe the caller's own request, so they are safe to return.
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`);
    return res.status(400).json({ status: 'error', message: 'Invalid request', details });
  }

  const { query, topK, threshold } = parsed.data;

  try {
    const ragOrchestrator = await getRagOrchestrator();
    const answer = await ragOrchestrator.query(
      query,
      topK ?? config.topK,
      threshold ?? config.retrievalThreshold,
      config.maxTokens,
      tenantOf(res.locals)
    );

    res.json(answer);
  } catch (error) {
    logger.error(`Error generating response: ${error instanceof Error ? error.stack ?? error.message : error}`);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

export default router;
