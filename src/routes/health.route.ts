import express from 'express';

const router = express.Router();

/**
 * GET /health
 * Response: { status: 'ok', uptime: number }
 *
 * Liveness probe: answers as long as the process is running and able to serve requests.
 * It deliberately does NOT call ChromaDB or Ollama, so a slow dependency cannot make an
 * orchestrator restart the container. Dependency state belongs in a separate readiness
 * check.
 */
router.get('/', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

export default router;
