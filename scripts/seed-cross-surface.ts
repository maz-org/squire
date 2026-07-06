/**
 * CLI: seed cross-surface edges (scenario→monster stat cards).
 *
 * Usage: `npm run seed:cross-surface`
 */
import 'dotenv/config';

import { getDb } from '../src/db.ts';
import { requireGameId, SUPPORTED_GAME_IDS } from '../src/game.ts';
import { seedCrossSurface } from '../src/seed/seed-cross-surface.ts';

async function main(): Promise<void> {
  const { db, close } = getDb('cli');
  try {
    const explicitGame = process.env.SQUIRE_SEED_GAME ?? process.env.GHS_DATA_GAME;
    const games =
      explicitGame && explicitGame !== 'all' ? [requireGameId(explicitGame)] : SUPPORTED_GAME_IDS;
    for (const game of games) {
      const result = await seedCrossSurface(db, { game });
      console.log(`✓ ${game}/cross-surface: ${result.edges} edges`);
      const unmatched = result.report.flatMap((row) => row.unmatchedMonsters);
      if (unmatched.length > 0) {
        console.warn(`  ⚠ unmatched monster names: ${[...new Set(unmatched)].join(', ')}`);
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
