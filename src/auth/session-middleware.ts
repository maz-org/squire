/**
 * Session cookie middleware for the web UI channel (SQR-38).
 *
 * Reads a signed session cookie, loads the session (with user) from Postgres
 * via SessionRepository, and stores the Session object on the Hono context.
 * Protected routes (like /chat) get requireSession(); public pages like the
 * homepage get optionalSession() so the layout can adapt.
 *
 * Cookie attributes: HttpOnly, SameSite=Strict, signed via SESSION_SECRET.
 * Secure is conditional: true in production, false in dev (localhost HTTP).
 *
 * This is separate from `requireBearerAuth()` in server.ts, which protects
 * /api/* and /mcp with OAuth 2.1 bearer tokens.
 */

import type { Context, Next } from 'hono';
import { getSignedCookie, setSignedCookie, deleteCookie } from 'hono/cookie';

import * as SessionRepository from '../db/repositories/session-repository.ts';

/**
 * Read SESSION_SECRET from the environment. Throws if not set or too short.
 * Used for cookie signing (session cookie + PKCE cookie).
 */
export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be set and at least 32 characters');
  }
  return secret;
}

export const SESSION_COOKIE_NAME = 'squire_session';

/** Secure=true only in production. Localhost runs HTTP where Secure won't stick. */
function isSecureContext(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Hono middleware that detects a session without enforcing it.
 *
 * If a valid session cookie exists, loads the full Session (with user) and
 * sets it on context. If not, does nothing. Used on public pages so the
 * layout can adapt its chrome based on auth state.
 */
export function optionalSession() {
  return async (c: Context, next: Next) => {
    try {
      const secret = getSessionSecret();
      const sessionId = await getSignedCookie(c, secret, SESSION_COOKIE_NAME);
      if (sessionId) {
        const session = await SessionRepository.findById(sessionId);
        if (session) {
          c.set('session', session);
        } else {
          deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
        }
      }
    } catch {
      // Auth check failed. Silently continue as unauthenticated.
    }
    await next();
  };
}

/**
 * Hono middleware that enforces session-cookie authentication.
 *
 * On success: loads Session (with user) and sets it on context, calls next().
 * On failure: returns 401 JSON.
 */
export function requireSession() {
  return async (c: Context, next: Next) => {
    const secret = getSessionSecret();
    const sessionId = await getSignedCookie(c, secret, SESSION_COOKIE_NAME);

    if (!sessionId) {
      console.debug('[session] no signed cookie found on %s', c.req.path);
      return c.json({ error: 'Authentication required', status: 401 }, 401);
    }

    const session = await SessionRepository.findById(sessionId);
    if (!session) {
      console.info('[session] expired or missing session for cookie, clearing');
      deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
      return c.json({ error: 'Session expired', status: 401 }, 401);
    }

    console.debug('[session] authenticated userId=%s on %s', session.userId, c.req.path);
    c.set('session', session);
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
    maxAge: 30 * 24 * 60 * 60,
  });
}

/**
 * Clear the session cookie (logout).
 */
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
}
