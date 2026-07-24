import express from 'express';
import { checkReadiness } from '@infrastructure/observability';
import { logger } from '@infrastructure/logging';

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

/**
 * GET /health/ready
 * Response: { ready: boolean, dependencies: Array<{ name, ok, error? }> }
 * Status: 200 when every backing dependency (ChromaDB, Ollama) answers; 503 otherwise.
 *
 * Readiness probe: unlike liveness, it DOES ping the dependencies, so an orchestrator can
 * stop routing traffic while Chroma or Ollama is down without restarting the container.
 * A probe failure is expected operational signal, so it is not logged as an error.
 */
router.get('/ready', async (_req, res) => {
  const report = await checkReadiness();

  if (!report.ready) {
    const down = report.dependencies.filter((dependency) => !dependency.ok).map((dependency) => dependency.name);
    logger.warn(`Readiness check failed; unavailable dependency(ies): ${down.join(', ')}`);
  }

  res.status(report.ready ? 200 : 503).json(report);
});

export default router;
