import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  scenarioBookScenarios,
  sectionBookSections,
  bookReferences,
} from '../../src/db/schema/scenario-section-books.ts';
import { GLOOMHAVEN_2E_GAME_ID } from '../../src/game.ts';
import { seedScenarioSectionBooks } from '../../src/seed/seed-scenario-section-books.ts';
import { ScenarioSectionBooksExtractSchema } from '../../src/scenario-section-schemas.ts';

import { setupTestDb, teardownTestDb } from '../helpers/db.ts';

function readScenarioSectionBooksExtract() {
  const path = join(
    import.meta.dirname,
    '..',
    '..',
    'data',
    'extracted',
    'scenario-section-books.json',
  );
  return ScenarioSectionBooksExtractSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

describe('seedScenarioSectionBooks', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    try {
      await db.execute(
        sql`TRUNCATE book_references, section_book_sections, scenario_book_scenarios RESTART IDENTITY CASCADE`,
      );
      await seedScenarioSectionBooks(db);
    } finally {
      await teardownTestDb();
    }
  });

  it('seeds row counts that match the scenario/section book extract', async () => {
    const extract = readScenarioSectionBooksExtract();
    await seedScenarioSectionBooks(db);
    const scenarios = await db
      .select({ id: scenarioBookScenarios.id })
      .from(scenarioBookScenarios)
      .where(eq(scenarioBookScenarios.game, 'frosthaven'));
    const sections = await db
      .select({ id: sectionBookSections.id })
      .from(sectionBookSections)
      .where(eq(sectionBookSections.game, 'frosthaven'));
    const links = await db
      .select({ id: bookReferences.id })
      .from(bookReferences)
      .where(eq(bookReferences.game, 'frosthaven'));

    expect(scenarios).toHaveLength(extract.scenarios.length);
    expect(sections).toHaveLength(extract.sections.length);
    expect(links).toHaveLength(extract.links.length);
  });

  it('is idempotent when re-run against the same extract', async () => {
    await seedScenarioSectionBooks(db);
    const before = await db
      .select({ id: bookReferences.id })
      .from(bookReferences)
      .where(eq(bookReferences.game, 'frosthaven'));

    await seedScenarioSectionBooks(db);

    const after = await db
      .select({ id: bookReferences.id })
      .from(bookReferences)
      .where(eq(bookReferences.game, 'frosthaven'));
    expect(after).toHaveLength(before.length);
  });

  it('prunes rows that are no longer present in the checked-in extract', async () => {
    const extract = readScenarioSectionBooksExtract();
    await seedScenarioSectionBooks(db);
    await db.insert(scenarioBookScenarios).values({
      game: 'frosthaven',
      ref: 'stale:scenario',
      scenarioGroup: 'stale',
      scenarioIndex: '999',
      name: 'Stale Scenario',
      initial: false,
      metadata: { sourceId: 'stale:scenario' },
    });

    await seedScenarioSectionBooks(db);

    const staleRows = await db
      .select({ id: scenarioBookScenarios.id })
      .from(scenarioBookScenarios)
      .where(eq(scenarioBookScenarios.ref, 'stale:scenario'));
    const scenarios = await db
      .select({ id: scenarioBookScenarios.id })
      .from(scenarioBookScenarios)
      .where(eq(scenarioBookScenarios.game, 'frosthaven'));

    expect(staleRows).toHaveLength(0);
    expect(scenarios).toHaveLength(extract.scenarios.length);
  });

  it('rejects unsupported game seeds until the extract is game-aware', async () => {
    await expect(seedScenarioSectionBooks(db, { game: GLOOMHAVEN_2E_GAME_ID })).rejects.toThrow(
      'seedScenarioSectionBooks currently supports only "frosthaven"',
    );
  });
});
