/**
 * Session state accessors for the web UI (SQR-38).
 *
 * Read auth state from the Hono request context. The middleware resolves
 * the Session (with user) and stores it on context. These accessors just
 * read what the middleware already proved. Zero DB calls.
 */

import type { Context } from 'hono';
import type { Session } from '../db/repositories/types.ts';

/**
 * Check whether the current request has been authenticated by the session
 * middleware. Returns true if a Session is on context.
 */
export function isAuthenticated(c: Context): boolean {
  return c.get('session') !== undefined;
}

/**
 * Get the full Session (with user) from context, if authenticated.
 */
export function getSession(c: Context): Session | undefined {
  return c.get('session');
}
