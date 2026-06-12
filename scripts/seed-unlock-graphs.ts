/**
 * CLI: seed `unlock_graph_*` tables from `data/extracted/unlock-graphs/`.
 *
 * Usage: `npm run seed:unlock-graphs`. Idempotent — safe to re-run.
 */
import 'dotenv/config';

import { getDb } from '../src/db.ts';
import { seedUnlockGraphs } from '../src/seed/seed-unlock-graphs.ts';

async function main(): Promise<void> {
  const { db, close } = getDb('cli');
  try {
    const results = await seedUnlockGraphs(db);
    for (const r of results) {
      console.log(
        `✓ ${r.game}/${r.module}: ${r.scenarios} scenarios, ${r.threads} threads ` +
          `(pruned ${r.prunedScenarios}/${r.prunedThreads})`,
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
