/**
 * CLI: seed a single dev user for local testing of authenticated paths.
 *
 * Usage: `npm run seed:dev` (as part of the dev bundle). Refuses to run
 * against production — the helper is a local convenience, not a prod
 * data-fix tool. Idempotent.
 */
import 'dotenv/config';

import { getDb } from '../src/db.ts';
import { DEV_USER, seedDevUser } from '../src/seed/seed-dev-user.ts';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('[seed-dev-user] refusing to run with NODE_ENV=production');
    process.exit(1);
  }

  const { db, close } = getDb('cli');
  try {
    const result = await seedDevUser(db);
    if (result.inserted) {
      console.log(`✓ dev user created: ${DEV_USER.email}`);
    } else {
      console.log(`✓ dev user already exists: ${DEV_USER.email}`);
    }
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
