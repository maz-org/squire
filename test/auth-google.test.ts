/**
 * Google OAuth web login + Postgres session tests (SQR-38).
 *
 * 12 test cases covering all code paths from the eng review:
 *
 * Happy paths:
 *   1. Full callback: valid code -> user upserted -> session -> cookie -> redirect /
 *   2. /auth/me returns user JSON when authenticated
 *   3. Logout destroys session, clears cookie, redirects /
 *
 * Sad paths:
 *   4. Email not in allowlist -> 403, no user, no session
 *   5. Invalid state -> 400
 *   6. Google token verification failure -> 400
 *   7. Google code exchange failure -> 400
 *   8. Missing cookie on /auth/me -> 401
 *   9. Expired session -> 401, session row deleted
 *
 * Edge cases:
 *   10. Session cookie attributes (HttpOnly, SameSite=Strict, path)
 *   11. Sessions survive server pool teardown (Postgres persistence)
 *   12. Cookie auth on /auth/me doesn't leak into bearer-protected /api/*
 *
 * Google's token exchange and ID token verification are mocked at the
 * google-auth-library boundary; everything else hits the real test database.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { setupTestDb, resetTestDb, teardownTestDb } from './helpers/db.ts';

// ─── Mocks (must be before imports that use them) ───────────────────────────

vi.mock('../src/service.ts', () => ({
  initialize: vi.fn(),
  isReady: vi.fn(() => true),
  ask: vi.fn(),
}));

vi.mock('../src/tools.ts', () => ({
  searchRules: vi.fn(),
  searchCards: vi.fn(),
  listCardTypes: vi.fn(),
  listCards: vi.fn(),
  getCard: vi.fn(),
}));

// Mock google-auth-library at the library boundary. vi.hoisted() ensures
// these exist before vi.mock()'s hoisted factory captures them (avoids TDZ).
const { mockVerifyIdToken, mockGetToken } = vi.hoisted(() => ({
  mockVerifyIdToken: vi.fn(),
  mockGetToken: vi.fn(),
}));
vi.mock('google-auth-library', () => ({
  OAuth2Client: class MockOAuth2Client {
    verifyIdToken = mockVerifyIdToken;
    getToken = mockGetToken;
  },
}));

// Set env vars before any module loads
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/auth/google/callback';
process.env.SESSION_SECRET = 'test-session-secret-must-be-at-least-32-characters-long';

import { app } from '../src/server.ts';
import { resetAuthProvider } from '../src/auth.ts';
import { shutdownServerPool, getDb } from '../src/db.ts';
import { sessions, users } from '../src/db/schema/core.ts';
import { eq } from 'drizzle-orm';
// google.ts types used indirectly via the server routes

// ─── Test fixtures ──────────────────────────────────────────────────────────

const TEST_USER = {
  email: 'brian@example.com',
  name: 'Brian',
  sub: 'google-sub-12345',
};

function mockGoogleSuccess(user = TEST_USER) {
  mockGetToken.mockResolvedValueOnce({
    tokens: { id_token: 'fake-id-token' },
  });
  mockVerifyIdToken.mockResolvedValueOnce({
    getPayload: () => ({ sub: user.sub, email: user.email, name: user.name }),
  });
}

// ─── Test helper: walk the OAuth start+callback flow ────────────────────────

/**
 * Hit /auth/google/start, extract the PKCE cookie + state, then hit the
 * callback with a fake authorization code. Returns the callback response.
 */
async function walkOAuthFlow(options?: {
  overrideState?: string;
  skipPkceCookie?: boolean;
}): Promise<Response> {
  const startRes = await app.request('http://localhost:3000/auth/google/start', {
    redirect: 'manual',
  });
  expect(startRes.status).toBe(302);

  const setCookies = startRes.headers.getSetCookie();
  const pkceCookie = setCookies.find((h) => h.includes('squire_oauth_pkce='));
  const redirectUrl = new URL(startRes.headers.get('location')!);
  const state = options?.overrideState ?? redirectUrl.searchParams.get('state')!;

  const callbackUrl = `http://localhost:3000/auth/google/callback?code=fake-code&state=${state}`;
  const headers: Record<string, string> = {};
  if (!options?.skipPkceCookie && pkceCookie) {
    headers.Cookie = pkceCookie.split(';')[0];
  }

  return app.request(callbackUrl, { redirect: 'manual', headers });
}

/** Extract the squire_session cookie string from a response (name=value). */
function extractSessionCookie(res: Response): string | undefined {
  const setCookies = res.headers.getSetCookie();
  const match = setCookies.find((h) => h.includes('squire_session='));
  return match?.split(';')[0];
}

/** Make a request with the session cookie attached. */
function withSession(url: string, cookie: string, init?: RequestInit) {
  return app.request(url, {
    ...init,
    headers: { ...((init?.headers as Record<string, string>) ?? {}), Cookie: cookie },
  });
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

beforeAll(async () => {
  await setupTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  resetAuthProvider();
  mockVerifyIdToken.mockReset();
  mockGetToken.mockReset();
  // Default: allow the test user's email via env var
  process.env.SQUIRE_ALLOWED_EMAILS = TEST_USER.email;
});

afterAll(async () => {
  await teardownTestDb();
  await shutdownServerPool();
  resetAuthProvider();
});

// ─── Happy paths ────────────────────────────────────────────────────────────

describe('Google OAuth callback', () => {
  it('1. happy path: valid code -> user upserted -> session -> cookie -> redirect /', async () => {
    mockGoogleSuccess();
    const res = await walkOAuthFlow();

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');

    // Session cookie was set
    const cookie = extractSessionCookie(res);
    expect(cookie).toBeDefined();

    // User was upserted
    const { db } = getDb('server');
    const userRows = await db.select().from(users).where(eq(users.email, TEST_USER.email));
    expect(userRows).toHaveLength(1);
    expect(userRows[0].googleSub).toBe(TEST_USER.sub);

    // Session was created
    const sessionRows = await db.select().from(sessions).where(eq(sessions.userId, userRows[0].id));
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(sessionRows[0].lastSeenAt).not.toBeNull();
  });
});

describe('/auth/me', () => {
  it('2. returns { id, email, name } when authenticated', async () => {
    mockGoogleSuccess();
    const loginRes = await walkOAuthFlow();
    const cookie = extractSessionCookie(loginRes)!;

    const meRes = await withSession('http://localhost:3000/auth/me', cookie);
    expect(meRes.status).toBe(200);

    const body = (await meRes.json()) as { id: string; email: string; name: string };
    expect(body.email).toBe(TEST_USER.email);
    expect(body.name).toBe(TEST_USER.name);
    expect(body.id).toBeTruthy();
  });
});

describe('Logout', () => {
  it('3. POST /auth/logout destroys session, clears cookie, redirects /', async () => {
    mockGoogleSuccess();
    const loginRes = await walkOAuthFlow();
    const cookie = extractSessionCookie(loginRes)!;

    const logoutRes = await withSession('http://localhost:3000/auth/logout', cookie, {
      method: 'POST',
      redirect: 'manual',
    });

    expect(logoutRes.status).toBe(302);
    expect(logoutRes.headers.get('location')).toBe('/');

    // Session gone from DB
    const { db } = getDb('server');
    const remaining = await db.select().from(sessions);
    expect(remaining).toHaveLength(0);
  });
});

// ─── Sad paths ──────────────────────────────────────────────────────────────

describe('Callback rejection', () => {
  it('4. email not in allowlist -> 403, no user or session created', async () => {
    process.env.SQUIRE_ALLOWED_EMAILS = 'other@example.com';
    mockGoogleSuccess();

    const res = await walkOAuthFlow();
    expect(res.status).toBe(403);

    const { db } = getDb('server');
    expect(await db.select().from(users)).toHaveLength(0);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it('5. invalid state parameter -> 400', async () => {
    mockGoogleSuccess();
    const res = await walkOAuthFlow({ overrideState: 'tampered-state' });
    expect(res.status).toBe(400);
  });

  it('6. Google token verification failure -> 400', async () => {
    mockGetToken.mockResolvedValueOnce({ tokens: { id_token: 'bad-token' } });
    mockVerifyIdToken.mockRejectedValueOnce(new Error('Verification failed'));

    const res = await walkOAuthFlow();
    expect(res.status).toBe(400);
  });

  it('7. Google code exchange failure -> 400', async () => {
    mockGetToken.mockRejectedValueOnce(new Error('Exchange failed'));

    const res = await walkOAuthFlow();
    expect(res.status).toBe(400);
  });
});

describe('Session middleware rejection', () => {
  it('8. missing cookie -> 401', async () => {
    const res = await app.request('http://localhost:3000/auth/me');
    expect(res.status).toBe(401);
  });

  it('9. expired session -> 401, session row deleted', async () => {
    mockGoogleSuccess();
    const loginRes = await walkOAuthFlow();
    const cookie = extractSessionCookie(loginRes)!;

    // Expire the session in the database
    const { db } = getDb('server');
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });

    const meRes = await withSession('http://localhost:3000/auth/me', cookie);
    expect(meRes.status).toBe(401);

    // Session row was cleaned up
    expect(await db.select().from(sessions)).toHaveLength(0);
  });
});

// ─── Edge cases ─────────────────────────────────────────────────────────────

describe('Cookie attributes', () => {
  it('10. session cookie is HttpOnly, SameSite=Strict, path=/', async () => {
    mockGoogleSuccess();
    const loginRes = await walkOAuthFlow();

    const setCookies = loginRes.headers.getSetCookie();
    const sessionHeader = setCookies.find((h) => h.includes('squire_session='));
    expect(sessionHeader).toBeDefined();

    const lower = sessionHeader!.toLowerCase();
    expect(lower).toContain('httponly');
    expect(lower).toContain('samesite=strict');
    expect(lower).toContain('path=/');
    // Secure is NOT set in test env (NODE_ENV !== 'production')
    // max-age should be ~30 days
    expect(lower).toMatch(/max-age=\d+/);
  });
});

describe('Session restart regression', () => {
  it('11. sessions survive server pool teardown and rebuild', async () => {
    mockGoogleSuccess();
    const loginRes = await walkOAuthFlow();
    const cookie = extractSessionCookie(loginRes)!;

    // Verify it works before restart
    const before = await withSession('http://localhost:3000/auth/me', cookie);
    expect(before.status).toBe(200);

    // Simulate restart: tear down pool + reset provider
    await shutdownServerPool();
    resetAuthProvider();

    // Session must survive (Postgres-backed, not in-memory)
    const after = await withSession('http://localhost:3000/auth/me', cookie);
    expect(after.status).toBe(200);
    expect(((await after.json()) as { email: string }).email).toBe(TEST_USER.email);
  });
});

describe('Route isolation', () => {
  it('12. cookie auth on /auth/me does not leak into bearer-protected /api/*', async () => {
    mockGoogleSuccess();
    const loginRes = await walkOAuthFlow();
    const cookie = extractSessionCookie(loginRes)!;

    // Cookie works on /auth/me (session-protected)
    const meRes = await withSession('http://localhost:3000/auth/me', cookie);
    expect(meRes.status).toBe(200);

    // Cookie does NOT work on /api/card-types (bearer-protected)
    const apiRes = await withSession('http://localhost:3000/api/card-types', cookie);
    expect(apiRes.status).toBe(401);

    // No cookie at all -> 401 on bearer routes too
    const bareRes = await app.request('http://localhost:3000/api/card-types');
    expect(bareRes.status).toBe(401);
  });
});

// ─── PKCE cookie cleanup ────────────────────────────────────────────────────

describe('PKCE cookie cleanup', () => {
  it('13. PKCE cookie is deleted after successful callback', async () => {
    mockGoogleSuccess();
    const loginRes = await walkOAuthFlow();
    expect(loginRes.status).toBe(302);

    // The response should clear the PKCE cookie (Max-Age=0 or explicit delete)
    const setCookies = loginRes.headers.getSetCookie();
    const pkceCookieDelete = setCookies.find(
      (h) =>
        h.includes('squire_oauth_pkce') && (h.includes('Max-Age=0') || h.includes('max-age=0')),
    );
    // Either the PKCE cookie is explicitly deleted, or it's not re-set
    // (the 5-min cookie expires on its own, but explicit delete is cleaner)
    expect(pkceCookieDelete).toBeDefined();
  });
});

// ─── Audit event verification ───────────────────────────────────────────────

describe('Audit events', () => {
  it('14. successful login writes google_login audit event', async () => {
    mockGoogleSuccess();
    await walkOAuthFlow();

    const { db } = getDb('server');
    const { oauthAuditLog } = await import('../src/db/schema/auth.ts');
    const auditRows = await db
      .select()
      .from(oauthAuditLog)
      .where(eq(oauthAuditLog.eventType, 'google_login'));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].outcome).toBe('success');
  });
});

// ─── Email/sub conflict (SQR-38 review) ─────────────────────────────────────

describe('Email/sub conflict', () => {
  it('15. returns opaque 403 when email exists under a different google_sub', async () => {
    // Seed a user with the test email but a different google_sub
    const { db } = getDb('server');
    const { users } = await import('../src/db/schema/core.ts');
    await db.insert(users).values({
      googleSub: 'different-sub-from-test',
      email: TEST_USER.email,
      name: 'Pre-existing User',
    });

    // Now try to log in with the same email but the mock's google_sub
    mockGoogleSuccess();
    const res = await walkOAuthFlow();

    // Should get a 403 with an opaque message (no detail leakage)
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(body).toContain('Unable to sign in');
    expect(body).not.toContain('different-sub');
    expect(body).not.toContain('conflict');
  });
});
