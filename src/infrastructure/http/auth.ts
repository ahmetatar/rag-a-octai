import { RequestHandler } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import config, { ApiKeyEntry } from '@app/config';
import { logger } from '../logging';

/**
 * The response-local key under which the resolved tenant id is stored.
 * Downstream handlers read `res.locals[TENANT_LOCAL]` to scope their work.
 */
export const TENANT_LOCAL = 'tenantId';

/**
 * The response-local key under which the resolved API key's scopes are stored. Absent when
 * auth is disabled — that also means unrestricted access, so `requireScope` treats a missing
 * value as a pass, same as an explicit `['*']`.
 */
export const SCOPES_LOCAL = 'scopes';

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
 * Hashes a raw API key for comparison against the configured key-hash map. Only the hash is
 * ever stored (in config/env), so a leaked config or process dump does not expose usable keys.
 * @param key The raw API key.
 * @returns The hex-encoded SHA-256 hash of the key.
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Looks up a raw API key against the configured hash map using a constant-time comparison
 * per candidate, so a request with a wrong key takes the same time regardless of how many
 * leading characters of its hash happen to match.
 * @param apiKeyHashes The configured API key hash → entry map.
 * @param candidate The raw API key presented on the request.
 * @returns The matching entry (tenant + scopes), or undefined when no key matches.
 */
function lookupApiKeyEntry(
  apiKeyHashes: Record<string, ApiKeyEntry>,
  candidate: string
): ApiKeyEntry | undefined {
  const candidateBuffer = Buffer.from(hashApiKey(candidate));

  for (const hash of Object.keys(apiKeyHashes)) {
    const hashBuffer = Buffer.from(hash);
    if (hashBuffer.length === candidateBuffer.length && timingSafeEqual(hashBuffer, candidateBuffer)) {
      return apiKeyHashes[hash];
    }
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
    const entry = apiKey ? lookupApiKeyEntry(config.apiKeyHashes, apiKey) : undefined;

    if (!entry) {
      logger.warn(`Rejected unauthenticated request to ${req.method} ${req.originalUrl}`);
      res.status(401).json({ status: 'error', message: 'Unauthorized' });
      return;
    }

    res.locals[TENANT_LOCAL] = entry.tenantId;
    res.locals[SCOPES_LOCAL] = entry.scopes;
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

/**
 * Builds a middleware that rejects a request whose resolved API key does not carry the given
 * scope. Must run after `authMiddleware()`. A request with no scopes recorded (auth disabled,
 * or a key configured with no scope segment) is treated as unrestricted and always passes —
 * matching the documented "no scope segment = full access" default in `config.apiKeyHashes`.
 * @param scope The scope required to proceed (e.g. `read`, `write`, `delete`).
 * @returns The scope-check middleware.
 */
export function requireScope(scope: string): RequestHandler {
  return (_req, res, next) => {
    const scopes = res.locals[SCOPES_LOCAL];
    const allowed = !Array.isArray(scopes) || scopes.includes('*') || scopes.includes(scope);

    if (!allowed) {
      res.status(403).json({ status: 'error', message: 'Forbidden' });
      return;
    }

    next();
  };
}
