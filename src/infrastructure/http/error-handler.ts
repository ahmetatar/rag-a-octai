import { ErrorRequestHandler, RequestHandler } from 'express';
import { logger } from '../logging';

/**
 * Terminal middleware for requests that matched no route.
 * Without it Express answers with its own HTML error page, which is inconsistent
 * with the JSON every other endpoint returns.
 */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ status: 'error', message: `Cannot ${req.method} ${req.originalUrl}` });
};

/**
 * Terminal error middleware.
 *
 * Express only treats a middleware as an error handler when it declares four
 * parameters, so `next` must stay in the signature even though it is only used to
 * delegate once the response has already started.
 *
 * The cause is logged server-side and never returned: it can carry stack traces,
 * internal hostnames and file paths.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  logger.error(
    `Unhandled error on ${req.method} ${req.originalUrl}: ` +
      `${error instanceof Error ? error.stack ?? error.message : error}`
  );

  // Headers are already on the wire; only Express' default handler can close this out.
  if (res.headersSent) {
    next(error);
    return;
  }

  res.status(500).json({ status: 'error', message: 'Internal server error' });
};
