import { seedDevUser } from '../../../src/seed/seed-dev-user.ts';
import { resetTestDb, setupTestDb, teardownTestDb } from '../../helpers/db.ts';

let db: Awaited<ReturnType<typeof setupTestDb>> | null = null;

/**
 * Browser E2E tests share one long-running server and the same dev user.
 * Reset mutable state before each test so one spec cannot leave an active
 * campaign, session, or conversation that changes the next spec's UI.
 */
export async function resetE2eDb(): Promise<void> {
  process.env.VITEST = 'true';
  db ??= await setupTestDb();
  await resetTestDb();
  await seedDevUser(db);
}

export async function teardownE2eDb(): Promise<void> {
  await teardownTestDb();
  db = null;
}
