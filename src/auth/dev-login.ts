/**
 * Dev-only `/dev/login` route: mints a session for `DEV_USER` without
 * going through Google OAuth, so Claude Code's preview tab (which sandboxes
 * off-localhost URLs and can't complete the Google round-trip) can still
 * drive authenticated flows end-to-end.
 *
 * Production safety (belt and suspenders):
 *
 * 1. `shouldRegisterDevLogin()` returns false when `NODE_ENV === 'production'`
 *    OR when the active `DATABASE_URL` points at anything other than a
 *    managed-local dev/test database. `src/server.ts` only calls
 *    `registerDevLoginRoute()` when this returns true, so the route does
 *    not even exist in production — you can grep prod logs / the route
 *    table and find nothing.
 *
 * 2. The handler itself re-checks the local-DB gate at request time, so
 *    a config-only change (e.g., setting `DATABASE_URL` to a remote host
 *    after the server started) neutralises the route without a restart.
 *
 * 3. A same-origin Origin-header check blocks cross-site POSTs. The NODE_ENV
 *    + local-DB gate is already enough to keep this route out of any
 *    hostile network, but the check costs nothing and protects the dev
 *    machine from a malicious tab.
 *
 * The real security boundary is the registration gate — the other two are
 * defence in depth.
 */

import type { Context, Hono } from 'hono';

import { getDb, isManagedLocalDatabaseUrl, resolveDatabaseUrl } from '../db.ts';
import * as SessionRepository from '../db/repositories/session-repository.ts';
import { DEV_USER, seedDevUser } from '../seed/seed-dev-user.ts';
import { setSessionCookie } from './session-middleware.ts';
import { users } from '../db/schema/core.ts';
import { eq } from 'drizzle-orm';

/**
 * Returns true iff the dev-login route is safe to register on this process.
 * Registration happens once at server startup — we do NOT want to register
 * the route in production, even behind a handler-level guard, because route
 * tables are part of the server's attack surface. A non-existent route is
 * strictly safer than a registered one with runtime checks.
 *
 * Hardened after a pre-landing adversarial review 2026-04-21 flagged that
 * the prior `NODE_ENV !== 'production'` gate was a deny-list:
 *
 * - Unset or empty NODE_ENV would pass the check
 * - If the default managed-local DB URL also matched (fresh machine with a
 *   stray local Postgres instance), the route would register on a host that
 *   the operator may not have realised was running in dev mode
 *
 * This check is now a positive allowlist — `NODE_ENV` must explicitly be
 * `development` or `test`, and the DB URL must still resolve to a
 * managed-local name. Both conditions have to hold.
 */
export function shouldRegisterDevLogin(): boolean {
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv !== 'development' && nodeEnv !== 'test') return false;
  try {
    return isManagedLocalDatabaseUrl(resolveDatabaseUrl());
  } catch {
    // Malformed DATABASE_URL → refuse. We only register when we can prove
    // the DB is a managed-local one, not when we fail to disprove it.
    return false;
  }
}

function isSameOriginRequest(c: Context): boolean {
  const origin = c.req.header('origin');
  if (!origin) return false;
  try {
    // Compare full origins (scheme + host + port) against the request URL's
    // own origin. Comparing origin.host to the Host header alone ignores the
    // scheme, so `https://localhost:3000` could pass for an `http://localhost:3000`
    // request — CodeRabbit caught this on 2026-04-21. Using c.req.url's origin
    // ties the check to what the server actually served, not to a
    // caller-supplied Host header.
    const requestOrigin = new URL(c.req.url).origin;
    return new URL(origin).origin === requestOrigin;
  } catch {
    return false;
  }
}

export function registerDevLoginRoute(app: Hono): void {
  app.post('/dev/login', async (c) => {
    // Defence in depth: registration-time gate already ran, but recheck
    // at handler time so a config change after startup can't be exploited
    // without a server restart.
    if (!shouldRegisterDevLogin()) {
      return c.json({ error: 'Not found', status: 404 }, 404);
    }

    // Same-origin check stands in for CSRF on a route that can't require
    // a pre-existing session token.
    if (!isSameOriginRequest(c)) {
      return c.json({ error: 'Cross-origin request blocked', status: 403 }, 403);
    }

    const { db } = getDb('server');

    // Ensure DEV_USER exists. `seedDevUser` is idempotent — no-op on
    // repeat calls after the first dev bootstrap.
    await seedDevUser(db);

    // Lookup by googleSub, not email. `seedDevUser()` no-ops on conflict
    // by either `email` or `google_sub`, so the existing row could legitimately
    // have a hand-edited email while keeping the canonical `DEV_USER.googleSub`.
    // googleSub is the stable identity (comment in seed-dev-user.ts spells
    // it out: "fixed, obviously-fake value so it can never collide with a
    // real Google sub claim").
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.googleSub, DEV_USER.googleSub))
      .limit(1);
    if (!user) {
      return c.json({ error: 'Dev user not found after seed', status: 500 }, 500);
    }

    const { sessionId } = await SessionRepository.create(db, {
      userId: user.id,
      ipAddress: c.req.header('x-forwarded-for') ?? null,
      userAgent: c.req.header('user-agent') ?? null,
    });

    await setSessionCookie(c, sessionId);

    // HTMX-aware: the login button posts with hx-post, so respond with a
    // client-side redirect header. For a plain form POST, fall back to a
    // 302 the browser will follow.
    if (c.req.header('hx-request') === 'true') {
      c.header('HX-Redirect', '/');
      return c.body(null, 200);
    }
    return c.redirect('/');
  });
}
