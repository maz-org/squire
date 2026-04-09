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
}
