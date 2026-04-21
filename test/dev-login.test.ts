/**
 * Tests for the dev-only /dev/login route.
 *
 * Coverage splits into two layers:
 *
 * 1. The registration gate (`shouldRegisterDevLogin`) — pure function,
 *    tested with manipulated env vars. This is the actual security
 *    boundary: if the gate returns false, the route is not present on
 *    the app at all. Every production-shaped environment must be
 *    rejected.
 *
 * 2. End-to-end route behaviour — same-origin enforcement, session
 *    creation, HTMX vs plain-form redirect handling. Uses the real
 *    Hono app + test DB so the middleware stack (session lookup,
 *    cookie signing, DB persistence) is exercised.
 *
 * The worktree runtime's `isManagedLocalDatabaseUrl` accepts the local
 * test DB, so the gate returns true under vitest — the exact shape we
 * want (route is live while the test suite runs against the local DB).
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '../src/server.ts';
import { getDb } from '../src/db.ts';
import { DEV_USER } from '../src/seed/seed-dev-user.ts';
import { sessions, users } from '../src/db/schema/core.ts';
import { eq } from 'drizzle-orm';
import { shouldRegisterDevLogin } from '../src/auth/dev-login.ts';

process.env.SESSION_SECRET = 'test-session-secret-must-be-at-least-32-characters-long';

// Under vitest, `resolveDatabaseUrl()` picks `TEST_DATABASE_URL` (or its
// managed-local default) regardless of `DATABASE_URL` — that's the
// test-isolation guard in src/db.ts. So the gate tests tweak
// TEST_DATABASE_URL to simulate "what URL is the server resolving right
// now," which is what `shouldRegisterDevLogin` actually inspects.
const originalNodeEnv = process.env.NODE_ENV;
const originalTestDatabaseUrl = process.env.TEST_DATABASE_URL;
const originalSquireDevLogin = process.env.SQUIRE_DEV_LOGIN;

describe('shouldRegisterDevLogin', () => {
  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalTestDatabaseUrl === undefined) delete process.env.TEST_DATABASE_URL;
    else process.env.TEST_DATABASE_URL = originalTestDatabaseUrl;
    if (originalSquireDevLogin === undefined) delete process.env.SQUIRE_DEV_LOGIN;
    else process.env.SQUIRE_DEV_LOGIN = originalSquireDevLogin;
  });

  it('returns false when NODE_ENV is production, regardless of DB', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.TEST_DATABASE_URL;
    expect(shouldRegisterDevLogin()).toBe(false);
  });

  it('returns false when NODE_ENV is unset (deny-list → allowlist hardening)', () => {
    delete process.env.NODE_ENV;
    delete process.env.TEST_DATABASE_URL;
    expect(shouldRegisterDevLogin()).toBe(false);
  });

  it('returns false when NODE_ENV is an unexpected value (e.g. "staging")', () => {
    process.env.NODE_ENV = 'staging';
    delete process.env.TEST_DATABASE_URL;
    expect(shouldRegisterDevLogin()).toBe(false);
  });

  it('returns false when the resolved DB URL points at a remote host', () => {
    process.env.NODE_ENV = 'development';
    process.env.TEST_DATABASE_URL = 'postgres://user:pw@prod-host.example.com:5432/squire';
    expect(shouldRegisterDevLogin()).toBe(false);
  });

  it('returns false when the resolved DB URL targets a non-managed DB name on localhost', () => {
    process.env.NODE_ENV = 'development';
    process.env.TEST_DATABASE_URL = 'postgres://squire:squire@localhost:5432/prod_impostor';
    expect(shouldRegisterDevLogin()).toBe(false);
  });

  it('returns false for a malformed DATABASE_URL', () => {
    process.env.NODE_ENV = 'development';
    process.env.TEST_DATABASE_URL = 'not a url';
    expect(shouldRegisterDevLogin()).toBe(false);
  });

  it('returns false when SQUIRE_DEV_LOGIN is unset, even with development NODE_ENV and managed-local DB', () => {
    // SQR-106: explicit opt-in required. NODE_ENV + DB alone is not enough —
    // a shared dev host with NODE_ENV=development and a local Postgres would
    // otherwise pass those two gates without the operator realising the route
    // is exposed.
    delete process.env.SQUIRE_DEV_LOGIN;
    process.env.NODE_ENV = 'development';
    delete process.env.TEST_DATABASE_URL;
    expect(shouldRegisterDevLogin()).toBe(false);
  });

  it('returns false when SQUIRE_DEV_LOGIN is set to a non-"1" truthy value', () => {
    process.env.SQUIRE_DEV_LOGIN = 'true';
    process.env.NODE_ENV = 'development';
    delete process.env.TEST_DATABASE_URL;
    expect(shouldRegisterDevLogin()).toBe(false);
  });

  it('returns true when SQUIRE_DEV_LOGIN=1, NODE_ENV is development, and DB is managed-local', () => {
    process.env.SQUIRE_DEV_LOGIN = '1';
    process.env.NODE_ENV = 'development';
    delete process.env.TEST_DATABASE_URL;
    expect(shouldRegisterDevLogin()).toBe(true);
  });
});

describe('POST /dev/login (local DB + dev NODE_ENV)', () => {
  // These tests assume the route is registered (the registration gate
  // ran at module-load time with NODE_ENV unset, DATABASE_URL pointing
  // at the managed-local test DB — see resolveDatabaseUrl).

  beforeEach(async () => {
    const { db } = getDb('server');
    // Wipe any prior dev-user sessions so each test starts clean.
    // Key off googleSub, not email: the "hand-edited email" regression
    // test below leaves the email rewritten mid-suite, and the dev-login
    // route itself treats googleSub as canonical (see src/auth/dev-login.ts).
    // CodeRabbit caught this on 2026-04-21.
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.googleSub, DEV_USER.googleSub));
    for (const row of existing) {
      await db.delete(sessions).where(eq(sessions.userId, row.id));
    }
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('creates a session for DEV_USER and sets the signed cookie on same-origin POST', async () => {
    const res = await app.request('http://localhost:3000/dev/login', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
      },
    });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('squire_session=');

    // A session row for DEV_USER exists after the POST.
    const { db } = getDb('server');
    const [user] = await db.select().from(users).where(eq(users.email, DEV_USER.email)).limit(1);
    expect(user).toBeDefined();
    const sessionsForUser = await db.select().from(sessions).where(eq(sessions.userId, user!.id));
    expect(sessionsForUser.length).toBe(1);
  });

  it('responds with HX-Redirect when the request is HTMX-driven', async () => {
    const res = await app.request('http://localhost:3000/dev/login', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'hx-request': 'true',
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('hx-redirect')).toBe('/');
  });

  it('blocks cross-origin POSTs', async () => {
    const res = await app.request('http://localhost:3000/dev/login', {
      method: 'POST',
      headers: {
        origin: 'http://evil.example.com',
        host: 'localhost:3000',
      },
    });

    expect(res.status).toBe(403);
  });

  it('blocks a request with no Origin header', async () => {
    const res = await app.request('http://localhost:3000/dev/login', {
      method: 'POST',
      headers: { host: 'localhost:3000' },
    });

    expect(res.status).toBe(403);
  });

  it('finds DEV_USER when email was hand-edited but googleSub still matches', async () => {
    // Regression: Codex review 2026-04-20 — seedDevUser no-ops on conflict
    // by either unique key, so a local row with the canonical googleSub
    // and a hand-edited email is a supported state. The lookup after
    // seedDevUser() must match on googleSub, not email, or /dev/login
    // 500s for that dev.
    const { db } = getDb('server');
    const [seeded] = await db
      .select()
      .from(users)
      .where(eq(users.googleSub, DEV_USER.googleSub))
      .limit(1);
    if (!seeded) {
      const [created] = await db
        .insert(users)
        .values({
          googleSub: DEV_USER.googleSub,
          email: 'hand-edited-before-test@example.local',
          name: DEV_USER.name,
        })
        .returning();
      expect(created).toBeDefined();
    } else {
      await db
        .update(users)
        .set({ email: 'hand-edited-before-test@example.local' })
        .where(eq(users.googleSub, DEV_USER.googleSub));
    }

    try {
      const res = await app.request('http://localhost:3000/dev/login', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/');
    } finally {
      // Restore canonical email even if the request or assertions above
      // throw, so a failure in this test doesn't leak into later tests
      // that assume DEV_USER.email is current. CodeRabbit caught this
      // on 2026-04-21.
      await db
        .update(users)
        .set({ email: DEV_USER.email })
        .where(eq(users.googleSub, DEV_USER.googleSub));
    }
  });
});
