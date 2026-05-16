import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { shutdownServerPool } from '../src/db.ts';
import * as SessionRepository from '../src/db/repositories/session-repository.ts';
import { sessions, users } from '../src/db/schema/core.ts';
import { hashSecret } from '../src/security/hashing.ts';
import { resetTestDb, setupTestDb, teardownTestDb } from './helpers/db.ts';

let db: Awaited<ReturnType<typeof setupTestDb>>;

async function createUser() {
  const id = randomUUID();
  const [user] = await db
    .insert(users)
    .values({
      googleSub: `google-sub-${id}`,
      email: `user-${id}@example.com`,
      name: 'Session User',
    })
    .returning();
  return user;
}

describe('SessionRepository', () => {
  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
    await shutdownServerPool();
  });

  it('stores only the SHA-256 session token hash while returning the raw token', async () => {
    const user = await createUser();

    const { sessionId } = await SessionRepository.create(db, { userId: user.id });

    const [stored] = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(stored.id).toBe(hashSecret(sessionId));
    expect(stored.id).not.toBe(sessionId);
    expect(stored.id).toMatch(/^[0-9a-f]{64}$/);

    const loaded = await SessionRepository.findById(sessionId);
    expect(loaded?.id).toBe(sessionId);
    expect(loaded?.user.email).toBe(user.email);
  });

  it('does not authenticate when the persisted hash is replayed as a session token', async () => {
    const user = await createUser();
    const { sessionId } = await SessionRepository.create(db, { userId: user.id });
    const [stored] = await db.select().from(sessions).where(eq(sessions.userId, user.id));

    await expect(SessionRepository.findById(stored.id)).resolves.toBeNull();
    await expect(SessionRepository.findById(sessionId)).resolves.toMatchObject({
      id: sessionId,
      userId: user.id,
    });
  });

  it('destroys sessions by hashing the raw session token before lookup', async () => {
    const user = await createUser();
    const { sessionId } = await SessionRepository.create(db, { userId: user.id });
    const [stored] = await db.select().from(sessions).where(eq(sessions.userId, user.id));

    await expect(SessionRepository.destroy(sessionId)).resolves.toBe(user.id);

    const remaining = await db.select().from(sessions).where(eq(sessions.id, stored.id));
    expect(remaining).toHaveLength(0);
    await expect(SessionRepository.destroy(stored.id)).resolves.toBeNull();
  });
});
