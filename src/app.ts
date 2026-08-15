import express, { Express, RequestHandler } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import config from '@app/config';
import * as routes from '@routes/index';
import { registerFileHandlers, createTextFileHandler, createPdfPageFileHandler, createHtmlFileHandler } from '@core/rag';
import { authMiddleware, errorHandler, notFoundHandler, tenantOf } from '@infrastructure/http';
import { correlationIdMiddleware, metricsMiddleware, metricsHandler } from '@infrastructure/observability';

/**
 * Registers the file handlers the application ships with.
 * Part of building the app rather than of starting the server, so anything driving the
 * app (including tests) gets the same set of supported MIME types.
 */
function registerDefaultFileHandlers(): void {
  registerFileHandlers({
    'text/plain': createTextFileHandler(),
    'text/html': createHtmlFileHandler(),
    'application/pdf': createPdfPageFileHandler(),
  });
}

/**
 * Builds the CORS middleware from configuration.
 * Returns a no-op when no origins are configured, so a purely server-to-server API is not
 * forced to speak CORS at all.
 * @returns The CORS middleware.
 */
function corsMiddleware(): RequestHandler {
  if (config.corsOrigins.length === 0) {
    return (_req, _res, next) => next();
  }

  const origin = config.corsOrigins.includes('*') ? true : config.corsOrigins;
  return cors({ origin });
}

/**
 * Builds a rate limiter keyed by tenant id instead of IP, so tenants sharing an egress IP
 * (corporate NAT, VPN) don't share one budget, and a tenant can't dodge the limit by
 * spreading requests across multiple IPs. Must run after `authMiddleware()`, which resolves
 * the tenant into `res.locals`.
 *
 * One instance is shared across all three data routers (/ingest, /query, /documents) so the
 * quota is per tenant across the whole API, not per tenant per route.
 * @returns The tenant-scoped rate limiter middleware.
 */
export function tenantRateLimitMiddleware(): RequestHandler {
  return rateLimit({
    windowMs: config.rateLimitWindowMs,
    limit: config.rateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (_req, res) => tenantOf(res.locals),
    message: { status: 'error', message: 'Too many requests, please try again later.' },
  });
}

/**
 * Builds the Express application with every route and middleware wired up.
 *
 * Kept separate from the server bootstrap in `index.ts` so tests can drive the app on an
 * ephemeral port without binding the configured one or installing signal handlers.
 *
 * @returns The configured Express application.
 */
export function createApp(): Express {
  registerDefaultFileHandlers();

  const app = express();

  // Controls which proxy hops the rate limiter trusts for the client IP. Left at 0 unless
  // deployed behind a reverse proxy.
  app.set('trust proxy', config.trustProxy);

  // Assign a correlation id first of all, so every subsequent middleware and log line —
  // including rejections and the error handler — can be tied to one request. The metrics
  // timer sits right after it so the recorded duration spans the whole request.
  app.use(correlationIdMiddleware());
  app.use(metricsMiddleware());

  // Security headers, CORS and a per-IP rate limit come first so they apply to every
  // route, including the ones that reject bad input.
  app.use(helmet());
  app.use(corsMiddleware());
  app.use(
    rateLimit({
      windowMs: config.rateLimitWindowMs,
      limit: config.rateLimitMax,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { status: 'error', message: 'Too many requests, please try again later.' },
    })
  );

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Prometheus scrape endpoint. Unauthenticated (like /health) because a scraper carries no
  // API key; it still gets the security headers and rate limit registered above.
  app.get('/metrics', metricsHandler);

  // /health stays unauthenticated so liveness/readiness probes work without a key. The data
  // routes sit behind auth, which also resolves the request's tenant; the tenant rate limiter
  // runs right after so it can key on that resolved tenant. One shared instance means the
  // quota is per tenant across all three routes, not per tenant per route.
  const tenantRateLimit = tenantRateLimitMiddleware();
  app.use('/health', routes.healthRouter);
  app.use('/ingest', authMiddleware(), tenantRateLimit, routes.ingestionRouter);
  app.use('/query', authMiddleware(), tenantRateLimit, routes.queryRouter);
  app.use('/documents', authMiddleware(), tenantRateLimit, routes.documentsRouter);

  // Both must stay last: Express matches middleware in registration order, so a route
  // registered after them would never be reached.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
