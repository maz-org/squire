/**
 * Google OAuth 2.0 web login flow (SQR-38).
 *
 * Squire acts as an OAuth **client** here (redirecting users to Google for
 * consent), not an OAuth **server** (that's `provider.ts` for MCP clients).
 * The two systems are deliberately isolated: different problem, different
 * failure modes, different test surface.
 *
 * Phase 1 allowlist: a hard-coded constant. Any email not in the list gets
 * a 403 "not invited" page. Graduates to a Postgres-backed allowlist table
 * in Phase 3 (multi-user). See ADR 0009.
 */

import { createHash, randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

import { getDb } from '../db.ts';
import { writeAuditEvent } from './audit.ts';
import * as UserRepository from '../db/repositories/user-repository.ts';
import { EmailConflictError } from '../db/repositories/user-repository.ts';
import * as SessionRepository from '../db/repositories/session-repository.ts';

// ─── Configuration ──────────────────────────────────────────────────────────

function getGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REDIRECT_URI');
  }
  return { clientId, clientSecret, redirectUri };
}

// SESSION_LIFETIME_MS lives in session-repository.ts; getSessionSecret() in session-middleware.ts

/**
 * Hard-coded email allowlist for Phase 1 single-user MVP (ADR 0009).
 * Any email not in this list gets a 403 on callback.
 * Graduates to a Postgres-backed table in Phase 3.
 */
export const ALLOWED_EMAILS: readonly string[] = [
  // Add allowed email addresses here. This is intentionally left empty
  // in the committed source; populate via environment or at deploy time.
  // For local dev, the test suite mocks this.
] as const;

// ─── Google ID token verification ───────────────────────────────────────────

/**
 * Verify a Google ID token and extract the payload. Uses google-auth-library's
 * built-in JWKS caching and signature verification.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
): Promise<{ sub: string; email: string; name?: string }> {
  const client = new OAuth2Client(clientId);
  const ticket = await client.verifyIdToken({
    idToken,
    audience: clientId,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload?.email) {
    throw new Error('Google ID token missing sub or email');
  }
  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
  };
}

// ─── PKCE + state helpers ───────────────────────────────────────────────────

/** Generate a random state parameter for CSRF protection during OAuth flow. */
export function generateState(): string {
  return randomBytes(32).toString('hex');
}

/** Generate a PKCE code verifier (RFC 7636). */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** Compute S256 code challenge from a verifier. */
export function computeCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Build the Google consent URL with PKCE and state parameters.
 * Returns the URL to redirect to and the state + verifier to store in a cookie.
 */
export function buildGoogleAuthUrl(state: string, codeChallenge: string): string {
  const { clientId, redirectUri } = getGoogleConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'online',
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// ─── Token exchange ─────────────────────────────────────────────────────────

/**
 * Exchange an authorization code for Google tokens.
 * Returns the raw token response including id_token.
 */
export async function exchangeGoogleCode(
  code: string,
  codeVerifier: string,
): Promise<{ id_token: string }> {
  const { clientId, clientSecret, redirectUri } = getGoogleConfig();
  const client = new OAuth2Client(clientId, clientSecret, redirectUri);
  const { tokens } = await client.getToken({
    code,
    codeVerifier,
  });
  if (!tokens.id_token) {
    throw new Error('Google token response missing id_token');
  }
  return { id_token: tokens.id_token };
}

// ─── User upsert + session creation ─────────────────────────────────────────

export interface HandleCallbackResult {
  sessionId: string;
  userId: string;
  email: string;
  name: string | null;
}

/**
 * Full callback handler logic: verify token, check allowlist, upsert user,
 * create session. Returns session info for cookie setting.
 *
 * Throws on any failure (caller catches and returns appropriate HTTP error).
 */
export async function handleGoogleCallback(
  code: string,
  state: string,
  cookieState: string | undefined,
  cookieVerifier: string | undefined,
  ipAddress?: string,
  userAgent?: string,
): Promise<HandleCallbackResult> {
  // 1. Verify state matches
  if (!cookieState || !cookieVerifier || state !== cookieState) {
    console.warn('[auth:google] state mismatch: cookie=%s param=%s', !!cookieState, !!state);
    throw new GoogleAuthError('invalid_state', 'State parameter mismatch', 400);
  }

  // 2. Exchange code for tokens
  let idToken: string;
  try {
    const tokens = await exchangeGoogleCode(code, cookieVerifier);
    idToken = tokens.id_token;
  } catch (err) {
    console.warn('[auth:google] token exchange failed:', (err as Error).message);
    throw new GoogleAuthError(
      'token_exchange_failed',
      'Failed to exchange authorization code',
      400,
    );
  }

  // 3. Verify ID token
  const { clientId } = getGoogleConfig();
  let tokenPayload: { sub: string; email: string; name?: string };
  try {
    tokenPayload = await verifyGoogleIdToken(idToken, clientId);
  } catch (err) {
    console.warn('[auth:google] ID token verification failed:', (err as Error).message);
    throw new GoogleAuthError('token_verification_failed', 'Failed to verify Google ID token', 400);
  }

  const { sub: googleSub, email, name } = tokenPayload;

  // 4. Check allowlist
  const allowedEmails = getAllowedEmails();
  console.info(
    '[auth:google] verified user email=%s, checking allowlist (%d entries)',
    email,
    allowedEmails.length,
  );
  if (!allowedEmails.includes(email.toLowerCase())) {
    console.warn('[auth:google] email not in allowlist: %s', email);
    const { db } = getDb('server');
    await writeAuditEvent(db, {
      eventType: 'google_login_denied',
      outcome: 'failure',
      failureReason: 'email_not_allowed',
      ipAddress,
      userAgent,
      metadata: { email },
    });
    throw new GoogleAuthError('not_allowed', 'Email not in allowlist', 403);
  }

  // 5. Upsert user + create session in a transaction
  const { db } = getDb('server');
  let result: { sessionId: string; userId: string; email: string; name: string | null };
  try {
    result = await db.transaction(async (tx) => {
      const user = await UserRepository.upsertByGoogleSub(tx, {
        googleSub,
        email,
        name: name ?? null,
      });
      const { sessionId } = await SessionRepository.create(tx, {
        userId: user.id,
        ipAddress,
        userAgent,
      });

      await writeAuditEvent(tx, {
        eventType: 'google_login',
        userId: user.id,
        outcome: 'success',
        ipAddress,
        userAgent,
        metadata: { email, googleSub },
      });

      return { sessionId, userId: user.id, email, name: name ?? null };
    });
  } catch (err) {
    // EmailConflictError: email exists under a different google_sub.
    // Return an opaque error to the user (no detail leakage about existing accounts).
    // The critical log was already emitted by the repository.
    if (err instanceof EmailConflictError) {
      throw new GoogleAuthError('login_failed', 'Unable to sign in. Please try again.', 403);
    }
    throw err;
  }

  // Log truncated session ID only (full ID is a session secret)
  console.info(
    '[auth:google] login succeeded: email=%s session=%s...',
    email,
    result.sessionId.slice(0, 8),
  );
  return result;
}

// Session CRUD lives in db/repositories/session-repository.ts and
// db/repositories/user-repository.ts. google.ts only handles the OAuth flow.

// ─── Allowlist accessor (mockable in tests) ─────────────────────────────────

/**
 * Returns the current allowed emails list. Reads from ALLOWED_EMAILS constant
 * first, then falls back to SQUIRE_ALLOWED_EMAILS env var (comma-separated).
 * The env var exists so tests and deploys can configure the allowlist without
 * editing source. Extracted as a function so tests can also vi.spyOn it.
 */
export function getAllowedEmails(): string[] {
  const envEmails = process.env.SQUIRE_ALLOWED_EMAILS;
  if (envEmails) {
    return envEmails
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  }
  return [...ALLOWED_EMAILS].map((e) => e.toLowerCase());
}

// ─── Error type ─────────────────────────────────────────────────────────────

export class GoogleAuthError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'GoogleAuthError';
    this.code = code;
    this.status = status;
  }
}
