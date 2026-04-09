/**
 * Session store: Postgres-backed session CRUD and user lookup (SQR-38).
 *
 * Extracted from google.ts to separate session operations (load, create,
 * destroy, user lookup) from Google OAuth flow logic (consent URL, callback,
 * token verification, allowlist). Session-middleware.ts, session.ts, and
 * google.ts all import from here. Clean dependency direction: session
 * operations don't know about Google, Google knows about sessions.
 *
 * See docs/plans/sqr-38-re-review.md, Architecture Fix #1.
 */

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { getDb } from '../db.ts';
import { users, sessions } from '../db/schema/core.ts';
import { writeAuditEvent } from './audit.ts';
import type { AuditEventType, DbOrTx } from './audit.ts';

/** 30-day session lifetime, matching the long-lived token DX policy (ADR 0002). */
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

// ─── Configuration ──────────────────────────────────────────────────────────

/**
 * Read SESSION_SECRET from the environment. Throws if not set or too short.
 * Used by session-middleware.ts (cookie signing) and server.ts (PKCE cookie).
 */
export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be set and at least 32 characters');
  }
  return secret;
}

// ─── Session CRUD ───────────────────────────────────────────────────────────

/**
 * Create a new session for a user. Returns the session ID for cookie setting.
 *
 * Accepts a `DbOrTx` so callers can nest it inside an existing transaction
 * (e.g., handleGoogleCallback upserts user + creates session + writes audit
 * atomically). When called standalone, pass `getDb('server').db`.
 */
export async function createSession(
  handle: DbOrTx,
  userId: string,
  ipAddress?: string | null,
  userAgent?: string | null,
): Promise<{ sessionId: string; expiresAt: Date }> {
  const sessionId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);

  await handle.insert(sessions).values({
    id: sessionId,
    userId,
    expiresAt,
    ipAddress: ipAddress ?? null,
    userAgent: userAgent ?? null,
    lastSeenAt: now,
  });

  return { sessionId, expiresAt };
}

/**
 * Load a session from Postgres. Returns null if not found or expired.
 * If expired, deletes the row (cleanup on read).
 * Updates last_seen_at on each load (no debounce for single-user Phase 1).
 */
export async function loadSession(
  sessionId: string,
): Promise<{ userId: string; expiresAt: Date } | null> {
  const { db } = getDb('server');
  const now = new Date();

  const rows = await db
    .select({ userId: sessions.userId, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (rows.length === 0) return null;

  const session = rows[0];
  if (session.expiresAt <= now) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }

  // TODO: debounce for Phase 3 multi-user if write volume becomes a concern
  await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, sessionId));

  return session;
}

/**
 * Destroy a session (logout). Deletes the row from Postgres and logs audit.
 */
export async function destroySession(
  sessionId: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  const { db } = getDb('server');

  const rows = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  await db.delete(sessions).where(eq(sessions.id, sessionId));

  if (rows.length > 0) {
    await writeAuditEvent(db, {
      eventType: 'google_logout' as AuditEventType,
      userId: rows[0].userId,
      outcome: 'success',
      ipAddress,
      userAgent,
    });
  }
}

// ─── User lookup ────────────────────────────────────────────────────────────

/**
 * Get user info by ID. Returns null if not found.
 */
export async function getUserById(
  userId: string,
): Promise<{ id: string; email: string; name: string | null } | null> {
  const { db } = getDb('server');
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}
