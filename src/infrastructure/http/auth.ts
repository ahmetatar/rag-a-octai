import { RequestHandler } from 'express';
import config from '@app/config';
import { logger } from '../logging';

/**
 * The response-local key under which the resolved tenant id is stored.
 * Downstream handlers read `res.locals[TENANT_LOCAL]` to scope their work.
 */
export const TENANT_LOCAL = 'tenantId';

/**
 * Extracts the API key from a request, accepting either `x-api-key` or a
 * `Authorization: Bearer <key>` header.
 * @param header The x-api-key header value.
 * @param authorization The Authorization header value.
 * @returns The API key, or undefined when none is present.
 */
function extractApiKey(header?: string, authorization?: string): string | undefined {
  if (header) {
    return header.trim();
  }

  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim();
  }

  return undefined;
}

/**
 * Builds the authentication middleware.
 *
 * Config is read at request time (not when the middleware is built) so tests — and a
 * future dynamic reload — can toggle auth without rebuilding the app.
 *
 * When auth is disabled the request is assigned the default tenant, keeping the tenant
 * isolation path uniform between single- and multi-tenant deployments. When enabled, a
 * request without a key mapped to a tenant is rejected with 401.
 *
 * @returns The auth middleware.
 */
export function authMiddleware(): RequestHandler {
  return (req, res, next) => {
    if (!config.authEnabled) {
      res.locals[TENANT_LOCAL] = config.defaultTenant;
      return next();
    }

    const apiKey = extractApiKey(req.header('x-api-key'), req.header('authorization'));
    const tenantId = apiKey ? config.apiKeys[apiKey] : undefined;

    if (!tenantId) {
      logger.warn(`Rejected unauthenticated request to ${req.method} ${req.originalUrl}`);
      res.status(401).json({ status: 'error', message: 'Unauthorized' });
      return;
    }

    res.locals[TENANT_LOCAL] = tenantId;
    next();
  };
}

/**
 * Reads the tenant id resolved by the auth middleware for a request.
 * Falls back to the default tenant, so a route is never left without a tenant even if the
 * middleware was somehow bypassed.
 * @param locals The response's `locals` object.
 * @returns The tenant id for the request.
 */
export function tenantOf(locals: Record<string, unknown>): string {
  const tenantId = locals[TENANT_LOCAL];
  return typeof tenantId === 'string' && tenantId ? tenantId : config.defaultTenant;
}
