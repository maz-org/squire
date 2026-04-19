import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  scenarioBookScenarios,
  sectionBookSections,
  bookReferences,
} from '../../src/db/schema/scenario-section-books.ts';
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
});
