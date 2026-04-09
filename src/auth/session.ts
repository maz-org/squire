/**
 * Session state accessors for the web UI (SQR-38).
 *
 * High-level functions that abstract away cookie reading, signature
 * verification, and Postgres session lookup. Consumers (layout shell,
 * route handlers, middleware) call `isLoggedIn(c)` or `getCurrentUser(c)`
 * without knowing about SESSION_SECRET, signed cookies, or the sessions
 * table.
 *
 * These are read-only queries against existing session state. They don't
 * create or destroy sessions (that's handleGoogleCallback / destroySession
 * in google.ts). They don't enforce auth (that's requireSession() in
 * session-middleware.ts). They just answer "who is this request from?"
 */

import type { Context } from 'hono';
import { getSignedCookie } from 'hono/cookie';

import { SESSION_COOKIE_NAME } from './session-middleware.ts';
import { loadSession, getUserById } from './google.ts';

/**
 * Read SESSION_SECRET from the environment. Returns null if not configured
 * (instead of throwing) so callers can gracefully degrade.
 */
function getSessionSecretOrNull(): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  return secret;
}

/**
 * Check whether the current request has a valid session.
 * Returns true if a signed session cookie exists and maps to a
 * non-expired Postgres session row. Does not throw.
 */
export async function isLoggedIn(c: Context): Promise<boolean> {
  const secret = getSessionSecretOrNull();
  if (!secret) return false;

  try {
    const sessionId = await getSignedCookie(c, secret, SESSION_COOKIE_NAME);
    if (!sessionId) return false;

    const session = await loadSession(sessionId);
    return session !== null;
  } catch {
    return false;
  }
}

/**
 * Get the current user from the session, if logged in.
 * Returns { id, email, name } or null.
 */
export async function getCurrentUser(
  c: Context,
): Promise<{ id: string; email: string; name: string | null } | null> {
  const secret = getSessionSecretOrNull();
  if (!secret) return null;

  try {
    const sessionId = await getSignedCookie(c, secret, SESSION_COOKIE_NAME);
    if (!sessionId) return null;

    const session = await loadSession(sessionId);
    if (!session) return null;

    return await getUserById(session.userId);
  } catch {
    return null;
  }
}
