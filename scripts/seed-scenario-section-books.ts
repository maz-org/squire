/**
 * CLI: seed scenario/section book tables from `data/extracted/scenario-section-books.json`.
 *
 * Usage: `npm run seed:scenario-section-books`
 */
import 'dotenv/config';

import { getDb } from '../src/db.ts';
import { requireGameId } from '../src/game.ts';
import {
  seedAvailableScenarioSectionBookGames,
  seedScenarioSectionBooks,
} from '../src/seed/seed-scenario-section-books.ts';

async function main(): Promise<void> {
  const { db, close } = getDb('cli');
  try {
    const explicitGame = process.env.SQUIRE_SEED_GAME ?? process.env.GHS_DATA_GAME;
    const game = explicitGame ? requireGameId(explicitGame) : null;
    const results = game
      ? (await seedScenarioSectionBooks(db, { game })).map((result) => ({ ...result, game }))
      : await seedAvailableScenarioSectionBookGames(db);
    for (const result of results) {
      console.log(
        `✓ ${result.game}/${result.type}: inserted ${result.inserted}, pruned ${result.pruned}, skipped ${result.skipped}`,
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
