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
import type { User } from './types.ts';

export async function findById(userId: string): Promise<User | null> {
  const { db } = getDb('server');
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
}

/**
 * Upsert a user by Google sub (stable identifier). On conflict with
 * google_sub, updates email and name (they can change on the Google side).
 * Returns the user's id.
 *
 * Accepts DbOrTx so this can run inside handleGoogleCallback's transaction.
 */
export async function upsertByGoogleSub(
  handle: DbOrTx,
  googleSub: string,
  email: string,
  name: string | null,
): Promise<{ id: string }> {
  const [user] = await handle
    .insert(users)
    .values({ googleSub, email, name })
    .onConflictDoUpdate({
      target: users.googleSub,
      set: { email, name },
    })
    .returning({ id: users.id });
  return user;
}
