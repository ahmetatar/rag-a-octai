import express, { Express, RequestHandler } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import config from '@app/config';
import * as routes from '@routes/index';
import { registerFileHandlers, createTextFileHandler, createPdfPageFileHandler } from '@core/rag';
import { errorHandler, notFoundHandler } from '@infrastructure/http';

/**
 * Registers the file handlers the application ships with.
 * Part of building the app rather than of starting the server, so anything driving the
 * app (including tests) gets the same set of supported MIME types.
 */
function registerDefaultFileHandlers(): void {
  registerFileHandlers({
    'text/plain': createTextFileHandler(),
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
  app.use('/health', routes.healthRouter);
  app.use('/ingest', routes.ingestionRouter);
  app.use('/query', routes.queryRouter);

  // Both must stay last: Express matches middleware in registration order, so a route
  // registered after them would never be reached.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
