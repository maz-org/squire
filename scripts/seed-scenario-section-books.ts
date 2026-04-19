/**
 * CLI: seed scenario/section book tables from `data/extracted/scenario-section-books.json`.
 *
 * Usage: `npm run seed:scenario-section-books`
 */
import 'dotenv/config';

import { getDb } from '../src/db.ts';
import { seedScenarioSectionBooks } from '../src/seed/seed-scenario-section-books.ts';

async function main(): Promise<void> {
  const { db, close } = getDb('cli');
  try {
    const results = await seedScenarioSectionBooks(db);
    for (const result of results) {
      console.log(
        `✓ ${result.type}: inserted ${result.inserted}, pruned ${result.pruned}, skipped ${result.skipped}`,
      );
    }
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
