/**
 * Integration tests for `src/scenario-section-data.ts`.
 *
 * Scenario/section book tables are seeded once per run by
 * `test/helpers/global-setup.ts`. These tests add minimal GH2 fixture rows
 * to prove game-scoped queries do not leak across campaigns.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FROSTHAVEN_GAME_ID, GLOOMHAVEN_2E_GAME_ID } from '../src/game.ts';
import {
  findScenarios,
  getScenario,
  getScenarioSectionBooksBootstrapStatus,
  getSection,
  searchSections,
} from '../src/scenario-section-data.ts';

import { setupTestDb, teardownTestDb } from './helpers/db.ts';

const GH2_SCENARIO_REF = 'gh2:test/isolation-scenario';
const GH2_SCENARIO_NAME = 'GH2 Isolation Test Scenario';
const GH2_SECTION_REF = 'gh2:test/isolation-section';
const GH2_SECTION_TEXT = 'GH2 isolation section marker text for search.';

beforeAll(async () => {
  await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

describe('game isolation', () => {
  beforeAll(async () => {
    const db = await setupTestDb();
    await db.execute(sql`
      INSERT INTO scenario_book_scenarios (
        game, ref, scenario_group, scenario_index, name, initial, metadata
      )
      VALUES (
        ${GLOOMHAVEN_2E_GAME_ID},
        ${GH2_SCENARIO_REF},
        'test',
        '999',
        ${GH2_SCENARIO_NAME},
        false,
        '{}'::jsonb
      )
    `);
    await db.execute(sql`
      INSERT INTO section_book_sections (
        game, ref, section_number, section_variant, source_pdf, source_page, text, metadata
      )
      VALUES (
        ${GLOOMHAVEN_2E_GAME_ID},
        ${GH2_SECTION_REF},
        999,
        1,
        'gh2-test.pdf',
        1,
        ${GH2_SECTION_TEXT},
        '{}'::jsonb
      )
    `);
  });

  afterAll(async () => {
    const db = await setupTestDb();
    await db.execute(sql`
      DELETE FROM section_book_sections
      WHERE game = ${GLOOMHAVEN_2E_GAME_ID} AND ref = ${GH2_SECTION_REF}
    `);
    await db.execute(sql`
      DELETE FROM scenario_book_scenarios
      WHERE game = ${GLOOMHAVEN_2E_GAME_ID} AND ref = ${GH2_SCENARIO_REF}
    `);
  });

  it('defaults to Frosthaven when game is omitted', async () => {
    expect(await getScenario(GH2_SCENARIO_REF)).toBeNull();
    expect(await getSection(GH2_SECTION_REF)).toBeNull();
  });

  it('does not return GH2 rows from Frosthaven scenario/section queries', async () => {
    const scenarios = await findScenarios(GH2_SCENARIO_NAME, 6, { game: FROSTHAVEN_GAME_ID });
    expect(scenarios).toEqual([]);

    const sections = await searchSections('GH2 isolation section marker', 6, {
      game: FROSTHAVEN_GAME_ID,
    });
    expect(sections).toEqual([]);
  });

  it('returns GH2 rows only for explicit Gloomhaven 2.0 queries', async () => {
    const scenario = await getScenario(GH2_SCENARIO_REF, { game: GLOOMHAVEN_2E_GAME_ID });
    expect(scenario).toMatchObject({ ref: GH2_SCENARIO_REF, name: GH2_SCENARIO_NAME });

    const section = await getSection(GH2_SECTION_REF, { game: GLOOMHAVEN_2E_GAME_ID });
    expect(section).toMatchObject({ ref: GH2_SECTION_REF, text: GH2_SECTION_TEXT });

    const scenarios = await findScenarios('999', 6, { game: GLOOMHAVEN_2E_GAME_ID });
    expect(scenarios.some((row) => row.ref === GH2_SCENARIO_REF)).toBe(true);
  });

  it('scopes bootstrap counts to the requested game', async () => {
    const frosthaven = await getScenarioSectionBooksBootstrapStatus({ game: FROSTHAVEN_GAME_ID });
    const gh2 = await getScenarioSectionBooksBootstrapStatus({ game: GLOOMHAVEN_2E_GAME_ID });

    expect(frosthaven.scenarioCount).toBeGreaterThan(gh2.scenarioCount);
    expect(gh2.scenarioCount).toBeGreaterThan(1);
    expect(gh2.sectionCount).toBeGreaterThan(1);
    expect(gh2.linkCount).toBeGreaterThan(0);
    expect(gh2.ready).toBe(true);
  });
});
