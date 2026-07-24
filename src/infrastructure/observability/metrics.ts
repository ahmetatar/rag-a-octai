import { Request, RequestHandler, Response } from 'express';
import { collectDefaultMetrics, Histogram, Registry } from 'prom-client';

/**
 * A dedicated registry rather than the global default one, so the metric set is
 * self-contained and a test can read it without picking up state from elsewhere. Node
 * process/GC metrics are collected into it automatically.
 */
export const registry = new Registry();
collectDefaultMetrics({ register: registry });

/**
 * Duration of every HTTP request, in seconds, labelled by method, matched route and status.
 * Its `_count` child series doubles as the total request count, so no separate counter is
 * needed. The route label is the MATCHED route (e.g. `/ingest/status/:jobId`), never the raw
 * path, to keep label cardinality bounded.
 */
const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds (its _count series is the total request count).',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

/**
 * Score of the best-ranked chunk for each query — cosine similarity ([-1, 1]) for plain
 * vector search, or the cross-encoder score when reranking is on. Surfaces retrieval quality
 * drift in production (a falling top score means the corpus is answering queries worse).
 */
const retrievalTopScore = new Histogram({
  name: 'rag_retrieval_top_score',
  help: 'Score of the highest-ranked retrieved chunk per query.',
  buckets: [-1, -0.5, 0, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 1],
  registers: [registry],
});

/**
 * Records the best retrieval score for a query. Called by the orchestrator once per query
 * that retrieved at least one chunk.
 * @param score The score of the top-ranked chunk.
 */
export function observeRetrievalTopScore(score: number): void {
  retrievalTopScore.observe(score);
}

/**
 * Times every request and records it under {@link httpRequestDuration} on completion.
 * Mounted early (right after correlation id) so the timing spans the whole request.
 * @returns The metrics timing middleware.
 */
export function metricsMiddleware(): RequestHandler {
  return (req, res, next) => {
    const stopTimer = httpRequestDuration.startTimer();

    res.on('finish', () => {
      stopTimer({ method: req.method, route: routeLabel(req), status: res.statusCode });
    });

    next();
  };
}

/**
 * GET /metrics handler: renders the registry in Prometheus text format.
 * Left unauthenticated (like /health) because a Prometheus scraper carries no API key.
 * @param _req The request (unused).
 * @param res The response to write the exposition to.
 */
export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  res.setHeader('Content-Type', registry.contentType);
  res.end(await registry.metrics());
}

/**
 * Derives a low-cardinality route label from the request. Uses the route Express matched
 * (mount path + route pattern with `:params` intact), and falls back to 'unknown' for
 * requests that never matched a route (404s), so raw paths never explode label cardinality.
 * @param req The request.
 * @returns The route label.
 */
function routeLabel(req: Request): string {
  const routePath = req.route?.path;
  if (routePath === undefined) {
    return 'unknown';
  }

  const suffix = routePath === '/' ? '' : routePath;
  return `${req.baseUrl}${suffix}` || '/';
}
