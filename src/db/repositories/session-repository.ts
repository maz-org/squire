/**
 * Session repository: Postgres-backed session queries (SQR-38).
 *
 * All session table access goes through here. Uses Drizzle relational
 * queries to load sessions with their user in a single JOIN.
 */

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { getDb } from '../../db.ts';
import { sessions, users } from '../schema/core.ts';
import type { DbOrTx } from '../../auth/audit.ts';
import type { Session, CreateSessionInput, User } from './types.ts';

/** 30-day session lifetime, matching the long-lived token DX policy (ADR 0002). */
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

// ─── Row types (Drizzle boundary, not exported) ─────────────────────────────

type SessionRow = typeof sessions.$inferSelect;
type UserRow = typeof users.$inferSelect;

function userToDomain(row: UserRow): User {
  return {
    id: row.id,
    googleSub: row.googleSub,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
    createdAt: row.createdAt,
  };
}

function toDomain(row: SessionRow & { user: UserRow }): Session {
  return {
    id: row.id,
    userId: row.userId,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    lastSeenAt: row.lastSeenAt,
    user: userToDomain(row.user),
  };
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Load a session with its user in one relational query.
 * Returns null if not found or expired. Deletes expired rows on read.
 * Updates lastSeenAt on each successful load.
 */
export async function findById(sessionId: string): Promise<Session | null> {
  const { db } = getDb('server');
  const now = new Date();

  const row = await db.query.sessions.findFirst({
    where: { id: sessionId },
    with: { user: true },
  });

  if (!row) return null;
  if (!row.user) {
    console.warn('[session] session row missing joined user; deleting orphaned session');
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }
  const user = row.user;

  if (row.expiresAt <= now) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }

  // Fire-and-forget: a transient write failure here must not invalidate the
  // session. The session is valid regardless of whether we can bump the timestamp.
  // TODO: debounce for Phase 3 multi-user if write volume becomes a concern
  try {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, sessionId));
  } catch (err) {
    console.warn('[session] lastSeenAt update failed (non-fatal):', (err as Error).message);
  }

  return toDomain({ ...row, user });
}

/**
 * Create a new session. Returns the session ID and expiry for cookie setting.
 *
 * Accepts DbOrTx so this can run inside handleGoogleCallback's transaction
 * (user upsert + session create + audit are atomic).
 */
export async function create(
  handle: DbOrTx,
  input: CreateSessionInput,
): Promise<{ sessionId: string; expiresAt: Date }> {
  const sessionId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);

  await handle.insert(sessions).values({
    id: sessionId,
    userId: input.userId,
    expiresAt,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    lastSeenAt: now,
  });

  return { sessionId, expiresAt };
}

/**
 * Destroy a session. Returns the userId of the deleted session (for audit
 * logging by the caller), or null if the session didn't exist.
 */
export async function destroy(sessionId: string): Promise<string | null> {
  const { db } = getDb('server');

  const rows = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  await db.delete(sessions).where(eq(sessions.id, sessionId));

  return rows[0]?.userId ?? null;
}
