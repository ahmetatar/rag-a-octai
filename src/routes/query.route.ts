import { createRagOrchestrator } from '@core/rag';
import express from 'express';
import config from '@app/config';
import logger from '@infrastructure/logging/default-logger';

const router = express.Router();
const ragOrchestrator = createRagOrchestrator();

/**
 * POST /query
 * Body: { query: string }
 * Response: { response: string }
 * Generates a response based on the input query
 *
 * Example request body:
 * {
 *   "query": "What is the capital of France?"
 * }
 *
 * Example response body:
 * {
 *   "response": "The capital of France is Paris."
 * }
 *
 * Error Handling:
 * - If the query is missing, responds with status 400 and an error message.
 * - If an internal error occurs, responds with status 500 and an error message.
 *
 * Sample curl command:
 * curl -X POST http://localhost:3000/query -H "Content-Type: application/json" -d '{"query": "What is the capital of France?"}'
 *
 * Sample response:
 * {
 *   "response": "The capital of France is Paris."
 * }
 */
router.post('/', async (req, res) => {
  const { query } = req.body;

  if (!query) {
    return res.status(400).json({ error: 'Query is required' });
  }

  try {
    const response = await ragOrchestrator.query(query, config.topK, config.retrievalThreshold, config.maxTokens);
    res.json({ response });
  } catch (error) {
    logger.error('Error generating response:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
