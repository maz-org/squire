/**
 * Seed scenario/section book tables from `data/extracted/scenario-section-books.json`.
 *
 * This is deterministic generated data, not user state, so the seed uses a
 * replace-by-game transaction instead of row-by-row upserts: delete current
 * rows for the game, then insert the latest extract. That keeps the tables in
 * lockstep with the checked-in artifact and makes prune semantics boring. It
 * also means this path does not need the PDF embedding source-hash metadata:
 * there is no skip-by-source cache to go stale.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { and, eq } from 'drizzle-orm';

import type { Db } from '../db.ts';
import { DEFAULT_GAME_ID, FROSTHAVEN_GAME_ID, requireGameId, type GameId } from '../game.ts';
import {
  bookReferences,
  scenarioBookScenarios,
  sectionBookSections,
} from '../db/schema/scenario-section-books.ts';
import { knowledgeEdges } from '../db/schema/knowledge-edges.ts';
import { ScenarioSectionBooksExtractSchema } from '../scenario-section-schemas.ts';
import {
  availableExtractedGames,
  extractedDataPath,
  readExtractedRecords,
} from '../extracted-paths.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTRACTED_PATH = join(
  __dirname,
  '..',
  '..',
  'data',
  'extracted',
  'scenario-section-books.json',
);

/**
 * Canonicalize a book-reference storage ref into a knowledge-edge node id
 * (ADR 0027): scenarios keep their printed index; sections keep their
 * dotted number. Unrecognized shapes pass through unchanged so an odd
 * upstream ref is visible in the edge rather than silently dropped.
 */
export function canonicalEdgeRef(kind: string, ref: string, game: GameId): string {
  if (kind === 'scenario') {
    const match = ref.match(/^(?:gloomhavensecretariat|printed-book):scenario\/(.+)$/);
    if (match) return `scenario:${game}/${match[1]}`;
    if (ref.startsWith('scenario:')) return ref;
    return `scenario:${game}/${ref}`;
  }
  if (kind === 'section') {
    if (ref.startsWith('section:')) return ref;
    return `section:${game}/${ref}`;
  }
  return ref;
}

/** The mirror collapses per-sequence duplicates onto the edge unique key. */
export function dedupeEdgeRows<
  T extends { game: string; fromRef: string; edgeType: string; toRef: string },
>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.game}|${row.fromRef}|${row.edgeType}|${row.toRef}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface SeedScenarioSectionBooksOptions {
  game?: string;
  extractedDir?: string;
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
  const game = requireGameId(opts.game ?? DEFAULT_GAME_ID);
  const gameScopedExtractPath = extractedDataPath('scenario-section-books', game, {
    extractedDir: opts.extractedDir,
  });
  const extract =
    game === FROSTHAVEN_GAME_ID || existsSync(gameScopedExtractPath)
      ? ScenarioSectionBooksExtractSchema.parse(
          JSON.parse(
            readFileSync(
              game === FROSTHAVEN_GAME_ID ? EXTRACTED_PATH : gameScopedExtractPath,
              'utf-8',
            ),
          ),
        )
      : ScenarioSectionBooksExtractSchema.parse({
          scenarios: readExtractedRecords('scenarios', game, {
            extractedDir: opts.extractedDir,
          }).map((scenario) => ({
            ref: scenario.sourceId,
            scenarioGroup: scenario.scenarioGroup,
            scenarioIndex: scenario.index,
            name: scenario.name,
            complexity: scenario.complexity ?? null,
            flowChartGroup: scenario.flowChartGroup ?? null,
            initial: scenario.initial ?? false,
            sourcePdf: null,
            sourcePage: null,
            rawText: null,
            metadata: {
              sourceId: scenario.sourceId,
              monsters: scenario.monsters,
              allies: scenario.allies,
              unlocks: scenario.unlocks,
              requirements: scenario.requirements,
              objectives: scenario.objectives,
              rewards: scenario.rewards,
              lootDeckConfig: scenario.lootDeckConfig,
            },
          })),
          sections: [],
          links: [],
          warnings: [
            `${game}: seeded scenario metadata from GHS; printed scenario/section prose and links are not imported for this game yet.`,
          ],
        });

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

    // Mirror printed-book links into the knowledge_edges substrate
    // (ADR 0027). book_references stays the source of record; the parity
    // test in test/knowledge-edges.test.ts guards drift.
    await tx
      .delete(knowledgeEdges)
      .where(and(eq(knowledgeEdges.game, game), eq(knowledgeEdges.provenance, 'book_references')));
    const edgeRows = dedupeEdgeRows(
      linkRows.map((link) => ({
        game,
        fromKind: link.fromKind,
        fromRef: canonicalEdgeRef(link.fromKind, link.fromRef, game),
        edgeType: link.linkType,
        toKind: link.toKind,
        toRef: canonicalEdgeRef(link.toKind, link.toRef, game),
        provenance: 'book_references',
        metadata: {
          ...(link.rawLabel ? { rawLabel: link.rawLabel } : {}),
          ...(link.rawContext ? { rawContext: link.rawContext } : {}),
        },
      })),
    );
    if (edgeRows.length > 0) {
      await tx.insert(knowledgeEdges).values(edgeRows);
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

export async function seedAvailableScenarioSectionBookGames(
  db: Db,
  opts: Omit<SeedScenarioSectionBooksOptions, 'game'> = {},
): Promise<Array<SeedScenarioSectionBooksResult & { game: string }>> {
  const results: Array<SeedScenarioSectionBooksResult & { game: string }> = [];

  for (const game of availableExtractedGames({ extractedDir: opts.extractedDir })) {
    const gameResults = await seedScenarioSectionBooks(db, { ...opts, game });
    results.push(...gameResults.map((result) => ({ ...result, game })));
  }

  return results;
}
