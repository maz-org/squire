/**
 * Seed scenario/section book tables from `data/extracted/scenario-section-books.json`.
 *
 * This is deterministic generated data, not user state, so the seed uses a
 * replace-by-game transaction instead of row-by-row upserts: delete current
 * rows for the game, then insert the latest extract. That keeps the tables in
 * lockstep with the checked-in artifact and makes prune semantics boring.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { eq } from 'drizzle-orm';

import type { Db } from '../db.ts';
import {
  bookReferences,
  scenarioBookScenarios,
  sectionBookSections,
} from '../db/schema/scenario-section-books.ts';
import { ScenarioSectionBooksExtractSchema } from '../scenario-section-schemas.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTRACTED_PATH = join(
  __dirname,
  '..',
  '..',
  'data',
  'extracted',
  'scenario-section-books.json',
);

export interface SeedScenarioSectionBooksOptions {
  game?: string;
}

export interface SeedScenarioSectionBooksResult {
  type: 'scenarios' | 'sections' | 'links';
  inserted: number;
  pruned: number;
  skipped: number;
}

export async function seedScenarioSectionBooks(
  db: Db,
  opts: SeedScenarioSectionBooksOptions = {},
): Promise<SeedScenarioSectionBooksResult[]> {
  const game = opts.game ?? 'frosthaven';
  if (game !== 'frosthaven') {
    throw new Error(
      `seedScenarioSectionBooks currently supports only "frosthaven"; got ${JSON.stringify(game)}`,
    );
  }
  const extract = ScenarioSectionBooksExtractSchema.parse(
    JSON.parse(readFileSync(EXTRACTED_PATH, 'utf-8')),
  );

  const scenarioRows = extract.scenarios.map((scenario) => ({ game, ...scenario }));
  const sectionRows = extract.sections.map((section) => ({ game, ...section }));
  const linkRows = extract.links.map((link) => ({ game, ...link }));

  return db.transaction(async (tx) => {
    const deletedLinks = await tx
      .delete(bookReferences)
      .where(eq(bookReferences.game, game))
      .returning({ id: bookReferences.id });
    const deletedSections = await tx
      .delete(sectionBookSections)
      .where(eq(sectionBookSections.game, game))
      .returning({ id: sectionBookSections.id });
    const deletedScenarios = await tx
      .delete(scenarioBookScenarios)
      .where(eq(scenarioBookScenarios.game, game))
      .returning({ id: scenarioBookScenarios.id });

    if (scenarioRows.length > 0) {
      await tx.insert(scenarioBookScenarios).values(scenarioRows);
    }
    if (sectionRows.length > 0) {
      await tx.insert(sectionBookSections).values(sectionRows);
    }
    if (linkRows.length > 0) {
      await tx.insert(bookReferences).values(linkRows);
    }

    return [
      {
        type: 'scenarios' as const,
        inserted: scenarioRows.length,
        pruned: deletedScenarios.length,
        skipped: 0,
      },
      {
        type: 'sections' as const,
        inserted: sectionRows.length,
        pruned: deletedSections.length,
        skipped: 0,
      },
      {
        type: 'links' as const,
        inserted: linkRows.length,
        pruned: deletedLinks.length,
        skipped: 0,
      },
    ];
  });
}
