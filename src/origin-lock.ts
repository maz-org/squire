import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

export const ORIGIN_SECRET_HEADER = 'x-origin-secret';
export const ORIGIN_LOCK_BYPASS_PATHS = new Set(['/api/live', '/api/health']);

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function secretsMatch(actual: string | undefined, expected: string): boolean {
  if (!hasText(actual)) return false;

  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function originSharedSecretMiddleware(options?: {
  secret?: string;
  bypassPaths?: ReadonlySet<string>;
}): MiddlewareHandler {
  return async (c, next) => {
    const secret = options?.secret ?? process.env.ORIGIN_SHARED_SECRET;
    if (!hasText(secret)) {
      await next();
      return;
    }

    const bypassPaths = options?.bypassPaths ?? ORIGIN_LOCK_BYPASS_PATHS;
    if (bypassPaths.has(c.req.path)) {
      await next();
      return;
    }

    if (!secretsMatch(c.req.header(ORIGIN_SECRET_HEADER), secret)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    await next();
  };
}
