/**
 * CLI: seed traversal tables from `data/extracted/traversal.json`.
 *
 * Usage: `npm run seed:traversal`
 */
import 'dotenv/config';

import { getDb } from '../src/db.ts';
import { seedTraversal } from '../src/seed/seed-traversal.ts';

async function main(): Promise<void> {
  const { db, close } = getDb('cli');
  try {
    const results = await seedTraversal(db);
    for (const result of results) {
      console.log(
        `✓ traversal ${result.type}: inserted ${result.inserted}, pruned ${result.pruned}, skipped ${result.skipped}`,
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
