/**
 * CLI: seed concept nodes and edges from the curated list.
 *
 * Usage: `npm run seed:concepts`
 */
import 'dotenv/config';

import { getDb } from '../src/db.ts';
import { requireGameId, SUPPORTED_GAME_IDS } from '../src/game.ts';
import { seedConcepts } from '../src/seed/seed-concepts.ts';

async function main(): Promise<void> {
  const { db, close } = getDb('cli');
  try {
    const explicitGame = process.env.SQUIRE_SEED_GAME ?? process.env.GHS_DATA_GAME;
    const games =
      explicitGame && explicitGame !== 'all' ? [requireGameId(explicitGame)] : SUPPORTED_GAME_IDS;
    for (const game of games) {
      const result = await seedConcepts(db, { game });
      console.log(`✓ ${game}/concepts: ${result.concepts} concepts, ${result.edges} edges`);
      for (const row of result.report) {
        console.log(
          `  ${row.slug}: defines=${row.defines} clarifies=${row.clarifies} references=${row.references}`,
        );
      }
      if (result.undefinedConcepts.length > 0) {
        console.warn(`  ⚠ no rulebook definition matched: ${result.undefinedConcepts.join(', ')}`);
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
