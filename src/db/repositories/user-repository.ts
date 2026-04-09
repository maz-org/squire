/**
 * User repository: Postgres-backed user queries (SQR-38).
 *
 * All user table access goes through here. Accepts DbOrTx so callers
 * can nest operations inside existing transactions.
 */

import { eq } from 'drizzle-orm';

import { getDb } from '../../db.ts';
import { users } from '../schema/core.ts';
import type { DbOrTx } from '../../auth/audit.ts';
import type { User, CreateUserInput } from './types.ts';

/**
 * Thrown when a Google login presents an email that already exists under a
 * different google_sub. This is a data integrity anomaly, not a normal user
 * error. The caller should return an opaque error to the user (no detail
 * leakage) and the console.error log provides forensic context.
 */
export class EmailConflictError extends Error {
  constructor(email: string) {
    super(`Email conflict: ${email} exists with a different Google account`);
    this.name = 'EmailConflictError';
  }
}

// ─── Row types (Drizzle boundary, not exported) ─────────────────────────────

type UserRow = typeof users.$inferSelect;

function toDomain(row: UserRow): User {
  return {
    id: row.id,
    googleSub: row.googleSub,
    email: row.email,
    name: row.name,
    createdAt: row.createdAt,
  };
}

// ─── Queries ────────────────────────────────────────────────────────────────

export async function findById(userId: string): Promise<User | null> {
  const { db } = getDb('server');
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (rows.length === 0) return null;
  return toDomain(rows[0]);
}

/**
 * Upsert a user by Google sub (stable identifier). On conflict with
 * google_sub, updates email and name (they can change on the Google side).
 *
 * Accepts DbOrTx so this can run inside handleGoogleCallback's transaction.
 */
export async function upsertByGoogleSub(handle: DbOrTx, input: CreateUserInput): Promise<User> {
  try {
    const [row] = await handle
      .insert(users)
      .values({
        googleSub: input.googleSub,
        email: input.email,
        name: input.name,
      })
      .onConflictDoUpdate({
        target: users.googleSub,
        set: { email: input.email, name: input.name },
      })
      .returning();
    return toDomain(row);
  } catch (err: unknown) {
    // Email uniqueness collision: a row exists with the same email but a
    // different google_sub. This should never happen in normal operation.
    // Do NOT silently update the existing row's google_sub (account takeover
    // risk). Reject the login with a generic error and log the conflict as
    // a critical data quality event for forensic investigation.
    const pgError = err as { code?: string; constraint?: string };
    if (pgError.code === '23505' && pgError.constraint?.includes('email')) {
      console.error(
        '[CRITICAL] email/google_sub conflict: email=%s has existing row with different sub. New sub=%s. Login rejected.',
        input.email,
        input.googleSub,
      );
      throw new EmailConflictError(input.email);
    }
    throw err;
  }
}
