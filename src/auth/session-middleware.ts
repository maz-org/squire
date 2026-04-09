/**
 * Session cookie middleware for the web UI channel (SQR-38).
 *
 * Reads a signed session cookie, loads the session from Postgres, and
 * attaches the userId to the Hono context. Protected routes (like /chat)
 * get this middleware; unprotected routes (like /, /auth/google/start) don't.
 *
 * Cookie attributes: HttpOnly, SameSite=Strict, signed via SESSION_SECRET.
 * Secure is conditional: true in production, false in dev (localhost runs
 * plain HTTP and Secure cookies won't stick over HTTP).
 *
 * This is separate from `requireBearerAuth()` in server.ts, which protects
 * the /api/* and /mcp endpoints for MCP/REST clients using OAuth 2.1 bearer
 * tokens. The two auth systems are isolated by design: different mechanisms,
 * different threat models, different cookie/header transports.
 */

import type { Context, Next } from 'hono';
import { getSignedCookie, setSignedCookie, deleteCookie } from 'hono/cookie';

import { loadSession, getSessionSecret } from './google.ts';

export const SESSION_COOKIE_NAME = 'squire_session';

/** Secure=true only in production. Localhost runs HTTP where Secure won't stick. */
function isSecureContext(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Hono middleware that enforces session-cookie authentication.
 *
 * On success: sets `c.set('userId', string)` and calls `next()`.
 * On failure: returns 401 JSON. Callers that want an HTML redirect
 * should wrap this middleware or check the response.
 */
export function requireSession() {
  return async (c: Context, next: Next) => {
    const secret = getSessionSecret();
    const sessionId = await getSignedCookie(c, secret, SESSION_COOKIE_NAME);

    if (!sessionId) {
      console.debug('[session] no signed cookie found on %s', c.req.path);
      return c.json({ error: 'Authentication required', status: 401 }, 401);
    }

    const session = await loadSession(sessionId);
    if (!session) {
      console.info('[session] expired or missing session for cookie, clearing');
      deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
      return c.json({ error: 'Session expired', status: 401 }, 401);
    }

    console.debug('[session] authenticated userId=%s on %s', session.userId, c.req.path);
    c.set('userId', session.userId);
    await next();
  };
}

/**
 * Set the session cookie after a successful Google OAuth callback.
 */
export async function setSessionCookie(c: Context, sessionId: string): Promise<void> {
  const secret = getSessionSecret();
  await setSignedCookie(c, SESSION_COOKIE_NAME, sessionId, secret, {
    path: '/',
    httpOnly: true,
    secure: isSecureContext(),
    sameSite: 'Strict',
    maxAge: 30 * 24 * 60 * 60, // 30 days in seconds
  });
}

/**
 * Clear the session cookie (logout).
 */
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
}
