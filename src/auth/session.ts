/**
 * Session state accessors for the web UI (SQR-38).
 *
 * High-level functions that read auth state from the Hono request context.
 * The requireSession() middleware (session-middleware.ts) does the actual
 * cookie reading and DB lookup, then sets userId on the context. These
 * accessors just read what the middleware already proved.
 *
 * This means: no cookie parsing, no secret reading, no DB queries, no
 * try/catch swallowing. If the middleware ran and set userId, the user is
 * authenticated. If it didn't (public routes, error pages), the user isn't.
 *
 * See docs/plans/sqr-38-re-review.md, Architecture Fixes #2 and #3.
 */

import type { Context } from 'hono';

import { getUserById } from './session-store.ts';

/**
 * Check whether the current request has been authenticated by the session
 * middleware. Returns true if requireSession() ran and set userId on context.
 * For routes without requireSession(), returns false (safe default).
 *
 * Zero DB calls. O(1) context variable check.
 */
export function isAuthenticated(c: Context): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (c as any).get('userId') !== undefined;
}

/**
 * Get the current user from the session, if authenticated.
 * Returns { id, email, name } or null.
 *
 * One DB call (getUserById) when authenticated, zero when not.
 */
export async function getCurrentUser(
  c: Context,
): Promise<{ id: string; email: string; name: string | null } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userId = (c as any).get('userId') as string | undefined;
  if (!userId) return null;
  return getUserById(userId);
}
