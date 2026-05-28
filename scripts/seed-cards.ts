/**
 * CLI: seed all `card_*` tables from `data/extracted/*.json`.
 *
 * Usage: `npm run seed:cards`. Idempotent — safe to re-run.
 */
import 'dotenv/config';

import { getDb } from '../src/db.ts';
import { requireGameId } from '../src/game.ts';
import { seedAvailableCardGames, seedCards } from '../src/seed/seed-cards.ts';

async function main(): Promise<void> {
  const { db, close } = getDb('cli');
  try {
    const explicitGame = process.env.SQUIRE_SEED_GAME ?? process.env.GHS_DATA_GAME;
    const game = explicitGame && explicitGame !== 'all' ? requireGameId(explicitGame) : null;
    const results = game
      ? (await seedCards(db, { game })).map((result) => ({
          ...result,
          game,
        }))
      : await seedAvailableCardGames(db);
    for (const r of results) {
      console.log(
        `✓ ${r.game}/${r.type}: upserted ${r.inserted}, pruned ${r.pruned}, skipped ${r.skipped}`,
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
