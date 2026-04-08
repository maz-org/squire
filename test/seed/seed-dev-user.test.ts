/**
 * Tests for `src/seed/seed-dev-user.ts`.
 *
 * Integration test against the real Postgres test DB, per tech spec
 * Decision 10. The dev-user seed is a tiny helper used by local bootstrap
 * (`npm run seed:dev`) to create a predictable authenticated account for
 * testing protected paths without going through the full Google OAuth flow.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';

import { schema } from '../../src/db.ts';
import { DEV_USER, seedDevUser } from '../../src/seed/seed-dev-user.ts';

import { setupTestDb, teardownTestDb } from '../helpers/db.ts';

describe('seedDevUser', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    // Truncate only the users table — global-setup owns card_* seeding.
    await db.delete(schema.users);
  });

  it('inserts the dev user on first run', async () => {
    const result = await seedDevUser(db);

    expect(result.inserted).toBe(true);
    const rows = await db.select().from(schema.users).where(eq(schema.users.email, DEV_USER.email));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: DEV_USER.email,
      googleSub: DEV_USER.googleSub,
      name: DEV_USER.name,
    });
  });

  it('is idempotent — re-running does not insert a duplicate', async () => {
    await seedDevUser(db);
    const second = await seedDevUser(db);

    expect(second.inserted).toBe(false);
    const rows = await db.select().from(schema.users).where(eq(schema.users.email, DEV_USER.email));
    expect(rows).toHaveLength(1);
  });

  it('leaves an existing user with the same email untouched', async () => {
    // Simulate a human-edited dev user: same email, different name.
    await db.insert(schema.users).values({
      email: DEV_USER.email,
      googleSub: 'preexisting-sub',
      name: 'Hand-edited Name',
    });

    const result = await seedDevUser(db);

    expect(result.inserted).toBe(false);
    const rows = await db.select().from(schema.users).where(eq(schema.users.email, DEV_USER.email));
    expect(rows).toHaveLength(1);
    // ON CONFLICT DO NOTHING — existing row is preserved verbatim.
    expect(rows[0].name).toBe('Hand-edited Name');
    expect(rows[0].googleSub).toBe('preexisting-sub');
  });

  it('leaves an existing user with the same googleSub untouched (sibling unique-key path)', async () => {
    // The other unique constraint on users — seedDevUser uses targetless
    // `ON CONFLICT DO NOTHING` specifically so a google_sub collision
    // no-ops the same way an email collision does.
    await db.insert(schema.users).values({
      email: 'other@squire.local',
      googleSub: DEV_USER.googleSub,
      name: 'Existing By Sub',
    });

    const result = await seedDevUser(db);

    expect(result.inserted).toBe(false);
    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.googleSub, DEV_USER.googleSub));
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('other@squire.local');
    expect(rows[0].name).toBe('Existing By Sub');
  });
});
