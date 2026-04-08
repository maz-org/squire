/**
 * CLI: seed all `card_*` tables from `data/extracted/*.json`.
 *
 * Usage: `npm run seed:cards`. Idempotent — safe to re-run.
 */
import 'dotenv/config';

import { getDb } from '../src/db.ts';
import { seedCards } from '../src/seed/seed-cards.ts';

async function main(): Promise<void> {
  const { db, close } = getDb('cli');
  try {
    const results = await seedCards(db);
    for (const r of results) {
      console.log(`✓ ${r.type}: upserted ${r.inserted}, pruned ${r.pruned}, skipped ${r.skipped}`);
    }
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
