/**
 * Seed a single predictable dev user into the `users` table.
 *
 * Used by `npm run seed:dev` so local testing of authenticated paths has a
 * stable account without walking through the Google OAuth flow. Idempotent
 * via `ON CONFLICT (email) DO NOTHING` — existing rows (including
 * hand-edited ones) are left untouched so a human can tweak the row without
 * the next `seed:dev` run clobbering it.
 *
 * This helper must NOT run against production. The CLI wrapper in
 * `scripts/seed-dev-user.ts` checks `NODE_ENV` before invoking it; the
 * library function itself is env-agnostic so tests can call it directly.
 *
 * Scope per SQR-36 / Decision 5 + 8: no campaigns, players, or auth tokens
 * — those belong to later projects. Only the `users` row.
 */
import type { Db } from '../db.ts';
import { users } from '../db/schema/core.ts';

/**
 * Canonical dev user. `googleSub` is a fixed, obviously-fake value so it
 * can never collide with a real Google `sub` claim (those are decimal
 * strings). Exported so tests and future auth helpers can reference the
 * same record without duplicating literals.
 */
export const DEV_USER = {
  googleSub: 'dev-user-google-sub-local',
  email: 'dev@squire.local',
  name: 'Dev User',
} as const;

export interface SeedDevUserResult {
  /** True if a new row was inserted. False if a matching row already existed. */
  inserted: boolean;
}

export async function seedDevUser(db: Db): Promise<SeedDevUserResult> {
  // `returning` only yields rows that were actually inserted when combined
  // with `ON CONFLICT DO NOTHING`, so its length tells us whether the row
  // was new without a separate SELECT.
  //
  // `onConflictDoNothing()` without a target absorbs a conflict on EITHER
  // unique constraint (`email` or `google_sub`). Pinning to one would
  // crash the other path: if a dev hand-edits the email while leaving the
  // fake `google_sub` in place, a target on `email` would let the insert
  // through and trip the `google_sub` unique violation instead of no-op.
  const rows = await db
    .insert(users)
    .values({
      googleSub: DEV_USER.googleSub,
      email: DEV_USER.email,
      name: DEV_USER.name,
    })
    .onConflictDoNothing()
    .returning({ id: users.id });

  return { inserted: rows.length > 0 };
}
