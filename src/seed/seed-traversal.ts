/**
 * Seed traversal tables from `data/extracted/traversal.json`.
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
import { traversalLinks, traversalScenarios, traversalSections } from '../db/schema/traversal.ts';
import { TraversalExtractSchema } from '../traversal-schemas.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTRACTED_PATH = join(__dirname, '..', '..', 'data', 'extracted', 'traversal.json');

export interface SeedTraversalOptions {
  game?: string;
}

export interface SeedTraversalResult {
  type: 'scenarios' | 'sections' | 'links';
  inserted: number;
  pruned: number;
  skipped: number;
}

export async function seedTraversal(
  db: Db,
  opts: SeedTraversalOptions = {},
): Promise<SeedTraversalResult[]> {
  const game = opts.game ?? 'frosthaven';
  const extract = TraversalExtractSchema.parse(JSON.parse(readFileSync(EXTRACTED_PATH, 'utf-8')));

  const scenarioRows = extract.scenarios.map((scenario) => ({ game, ...scenario }));
  const sectionRows = extract.sections.map((section) => ({ game, ...section }));
  const linkRows = extract.links.map((link) => ({ game, ...link }));

  return db.transaction(async (tx) => {
    const deletedLinks = await tx
      .delete(traversalLinks)
      .where(eq(traversalLinks.game, game))
      .returning({ id: traversalLinks.id });
    const deletedSections = await tx
      .delete(traversalSections)
      .where(eq(traversalSections.game, game))
      .returning({ id: traversalSections.id });
    const deletedScenarios = await tx
      .delete(traversalScenarios)
      .where(eq(traversalScenarios.game, game))
      .returning({ id: traversalScenarios.id });

    if (scenarioRows.length > 0) {
      await tx.insert(traversalScenarios).values(scenarioRows);
    }
    if (sectionRows.length > 0) {
      await tx.insert(traversalSections).values(sectionRows);
    }
    if (linkRows.length > 0) {
      await tx.insert(traversalLinks).values(linkRows);
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
