/**
 * CLI: seed correction edges (supersedes/clarifies) from FAQ/errata chunks.
 *
 * Usage: `npm run seed:corrections`
 */
import 'dotenv/config';

import { getDb } from '../src/db.ts';
import { requireGameId, SUPPORTED_GAME_IDS } from '../src/game.ts';
import { seedCorrections } from '../src/seed/seed-corrections.ts';

async function main(): Promise<void> {
  const { db, close } = getDb('cli');
  try {
    const explicitGame = process.env.SQUIRE_SEED_GAME ?? process.env.GHS_DATA_GAME;
    const games =
      explicitGame && explicitGame !== 'all' ? [requireGameId(explicitGame)] : SUPPORTED_GAME_IDS;
    for (const game of games) {
      const result = await seedCorrections(db, { game });
      console.log(`✓ ${game}/corrections: ${result.edges} edges`);
      for (const row of result.report) {
        const unmatched =
          row.unmatched.length > 0 ? ` — unmatched: ${row.unmatched.join('; ')}` : '';
        console.log(`  ${row.source}#${row.chunkIndex}: ${row.edges} edges${unmatched}`);
      }
    }
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
