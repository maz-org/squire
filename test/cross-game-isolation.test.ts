import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { cardItems } from '../src/db/schema/cards.ts';
import {
  bookReferences,
  scenarioBookScenarios,
  sectionBookSections,
} from '../src/db/schema/scenario-section-books.ts';
import { GLOOMHAVEN_2E_GAME_ID } from '../src/game.ts';
import {
  addEntries,
  deleteEntriesForSources,
  getEntryBySourceChunk,
  search,
} from '../src/vector-store.ts';
import {
  findScenario,
  getCard,
  getScenario,
  getSection,
  openEntity,
  searchCards,
  searchKnowledge,
} from '../src/tools.ts';
import { seedAvailableCardGames } from '../src/seed/seed-cards.ts';

import { setupTestDb, teardownTestDb } from './helpers/db.ts';

const SHARED_SCENARIO_REF = 'gloomhavensecretariat:scenario/061';
const SHARED_SCENARIO_INDEX = '61';
const GH2_SCENARIO_NAME = 'GH2 Boundary Scenario';
const GH2_SCENARIO_TEXT = 'GH2 boundary scenario text. Do not confuse with Life and Death.';

const SHARED_SECTION_REF = '67.1';
const GH2_SECTION_TEXT = 'GH2 boundary section 67.1 text. Do not reuse Frosthaven Moonshard prose.';

const SHARED_ITEM_SOURCE_ID = 'gloomhavensecretariat:item/1';
const GH2_ITEM_NAME = 'Spyglass';
const GH2_ITEM_EFFECT = 'GH2 boundary item effect. Do not reuse the Frosthaven Spyglass.';
const FROSTHAVEN_ITEM_EFFECT = 'During your attack ability, gain advantage on one attack.';

const SHARED_VECTOR_SOURCE = 'shared-boundary-rulebook.pdf';

function axisVector(axis: number, dim = 384): number[] {
  const v = new Array<number>(dim).fill(0);
  v[axis] = 1;
  return v;
}

async function deleteGh2Fixtures(): Promise<void> {
  const db = await setupTestDb();
  await db.execute(sql`
    DELETE FROM ${bookReferences}
    WHERE game = ${GLOOMHAVEN_2E_GAME_ID}
      AND (
        from_ref IN (${SHARED_SCENARIO_REF}, ${SHARED_SECTION_REF})
        OR to_ref IN (${SHARED_SCENARIO_REF}, ${SHARED_SECTION_REF})
      )
  `);
  await db.execute(sql`
    DELETE FROM ${cardItems}
    WHERE game = ${GLOOMHAVEN_2E_GAME_ID}
      AND source_id = ${SHARED_ITEM_SOURCE_ID}
  `);
  await db.execute(sql`
    DELETE FROM ${sectionBookSections}
    WHERE game = ${GLOOMHAVEN_2E_GAME_ID}
      AND ref = ${SHARED_SECTION_REF}
  `);
  await db.execute(sql`
    DELETE FROM ${scenarioBookScenarios}
    WHERE game = ${GLOOMHAVEN_2E_GAME_ID}
      AND ref = ${SHARED_SCENARIO_REF}
  `);
}

async function insertGh2Fixtures(): Promise<void> {
  const db = await setupTestDb();
  await db.execute(sql`
    INSERT INTO ${scenarioBookScenarios} (
      game, ref, scenario_group, scenario_index, name, complexity, flow_chart_group,
      initial, source_pdf, source_page, raw_text, metadata
    )
    VALUES (
      ${GLOOMHAVEN_2E_GAME_ID},
      ${SHARED_SCENARIO_REF},
      'boundary-fixtures',
      ${SHARED_SCENARIO_INDEX},
      ${GH2_SCENARIO_NAME},
      null,
      null,
      false,
      'gh2-boundary-scenario-book.pdf',
      61,
      ${GH2_SCENARIO_TEXT},
      '{}'::jsonb
    )
  `);
  await db.execute(sql`
    INSERT INTO ${sectionBookSections} (
      game, ref, section_number, section_variant, source_pdf, source_page, text, metadata
    )
    VALUES (
      ${GLOOMHAVEN_2E_GAME_ID},
      ${SHARED_SECTION_REF},
      67,
      1,
      'gh2-boundary-section-book.pdf',
      67,
      ${GH2_SECTION_TEXT},
      '{}'::jsonb
    )
  `);
  await db.execute(sql`
    INSERT INTO ${cardItems} (
      game, source_id, number, name, slot, cost, craft_cost, effect, uses, spent, lost
    )
    VALUES (
      ${GLOOMHAVEN_2E_GAME_ID},
      ${SHARED_ITEM_SOURCE_ID},
      '001',
      ${GH2_ITEM_NAME},
      'one hand',
      10,
      null,
      ${GH2_ITEM_EFFECT},
      null,
      false,
      false
    )
  `);
}

async function deleteVectorFixtures(): Promise<void> {
  await deleteEntriesForSources([SHARED_VECTOR_SOURCE], 'frosthaven');
  await deleteEntriesForSources([SHARED_VECTOR_SOURCE], GLOOMHAVEN_2E_GAME_ID);
}

beforeAll(async () => {
  await setupTestDb();
  await deleteGh2Fixtures();
  await insertGh2Fixtures();
});

afterAll(async () => {
  try {
    await deleteVectorFixtures();
    await deleteGh2Fixtures();
    const db = await setupTestDb();
    await seedAvailableCardGames(db, { types: ['items'] });
  } finally {
    await teardownTestDb();
  }
});

beforeEach(async () => {
  await deleteVectorFixtures();
});

describe('cross-game storage isolation', () => {
  it('keeps vector search and exact chunk lookup isolated by game for the same source/chunk', async () => {
    await addEntries([
      {
        id: 'fh-boundary::0',
        text: 'Frosthaven boundary vector text',
        embedding: axisVector(0),
        source: SHARED_VECTOR_SOURCE,
        chunkIndex: 0,
        game: 'frosthaven',
      },
      {
        id: 'gh2-boundary::0',
        text: 'GH2 boundary vector text',
        embedding: axisVector(0),
        source: SHARED_VECTOR_SOURCE,
        chunkIndex: 0,
        game: GLOOMHAVEN_2E_GAME_ID,
      },
    ]);

    const defaultHits = await search(axisVector(0), 10);
    expect(
      defaultHits.map((hit) => hit.game),
      'vector search leaked GH2 rows into the default Frosthaven result set',
    ).toEqual(defaultHits.map(() => 'frosthaven'));
    expect(defaultHits.map((hit) => hit.id)).toContain('fh-boundary::0');
    expect(defaultHits.map((hit) => hit.id)).not.toContain('gh2-boundary::0');

    const gh2Hits = await search(axisVector(0), 10, { game: 'gh2' });
    expect(
      gh2Hits.map((hit) => hit.game),
      'vector search leaked Frosthaven rows into the GH2 result set',
    ).toEqual(gh2Hits.map(() => GLOOMHAVEN_2E_GAME_ID));
    expect(gh2Hits.map((hit) => hit.id)).toContain('gh2-boundary::0');
    expect(gh2Hits.map((hit) => hit.id)).not.toContain('fh-boundary::0');

    await expect(
      getEntryBySourceChunk(SHARED_VECTOR_SOURCE, 0),
      'exact vector lookup leaked GH2 text into default Frosthaven lookup',
    ).resolves.toMatchObject({ text: 'Frosthaven boundary vector text', game: 'frosthaven' });
    await expect(
      getEntryBySourceChunk(SHARED_VECTOR_SOURCE, 0, { game: 'gh2' }),
      'exact vector lookup leaked Frosthaven text into GH2 lookup',
    ).resolves.toMatchObject({ text: 'GH2 boundary vector text', game: GLOOMHAVEN_2E_GAME_ID });
  });

  it('keeps same-source item records isolated across card lookup and card search', async () => {
    const frosthavenCard = await getCard('items', SHARED_ITEM_SOURCE_ID);
    const gh2Card = await getCard('items', SHARED_ITEM_SOURCE_ID, { game: 'gh2' });

    expect(
      frosthavenCard?.effect,
      'card lookup leaked the GH2 item into default Frosthaven lookup',
    ).not.toBe(GH2_ITEM_EFFECT);
    expect(gh2Card, 'card lookup did not find the GH2 item fixture').toMatchObject({
      sourceId: SHARED_ITEM_SOURCE_ID,
      number: '001',
      name: GH2_ITEM_NAME,
      effect: GH2_ITEM_EFFECT,
    });

    const frosthavenSearch = await searchCards('Spyglass');
    expect(
      frosthavenSearch.some((hit) => hit.data.effect === GH2_ITEM_EFFECT),
      'card search leaked the GH2 same-name Spyglass into default Frosthaven results',
    ).toBe(false);

    const gh2Search = await searchCards('Spyglass', 10, { game: 'gloomhaven 2.0' });
    expect(
      gh2Search.some((hit) => hit.data.effect === GH2_ITEM_EFFECT),
      'card search did not include the GH2 same-source Spyglass fixture',
    ).toBe(true);
    expect(
      gh2Search.some((hit) => hit.data.effect === FROSTHAVEN_ITEM_EFFECT),
      'card search leaked Frosthaven same-name Spyglass into GH2 results',
    ).toBe(false);
  });

  it('keeps same-number scenarios isolated across scenario lookup and knowledge search', async () => {
    const frosthavenScenario = await getScenario(SHARED_SCENARIO_REF);
    const gh2Scenario = await getScenario(SHARED_SCENARIO_REF, { game: 'gh2' });

    expect(
      frosthavenScenario?.name,
      'scenario lookup leaked the GH2 scenario 61 into default Frosthaven lookup',
    ).toBe('Life and Death');
    expect(gh2Scenario?.name, 'scenario lookup leaked Frosthaven scenario 61 into GH2 lookup').toBe(
      GH2_SCENARIO_NAME,
    );

    const frosthavenMatches = await findScenario('scenario 61');
    expect(
      frosthavenMatches.map((scenario) => scenario.name),
      'scenario search leaked GH2 scenario 61 into default Frosthaven results',
    ).toContain('Life and Death');
    expect(frosthavenMatches.map((scenario) => scenario.name)).not.toContain(GH2_SCENARIO_NAME);

    const gh2Knowledge = await searchKnowledge('scenario 61', {
      game: 'gh2',
      scope: ['scenario'],
      limit: 3,
    });
    expect(gh2Knowledge.ok).toBe(true);
    if (!gh2Knowledge.ok) throw new Error(gh2Knowledge.error.message);
    expect(
      gh2Knowledge.results.map((hit) => hit.entity.title),
      'knowledge scenario search leaked Frosthaven scenario 61 into GH2 results',
    ).toEqual([GH2_SCENARIO_NAME]);
  });

  it('keeps same-number sections isolated across section lookup and knowledge search', async () => {
    const frosthavenSection = await getSection(SHARED_SECTION_REF);
    const gh2Section = await getSection(SHARED_SECTION_REF, { game: 'gh2' });

    expect(
      frosthavenSection?.text,
      'section lookup leaked GH2 section 67.1 into default Frosthaven lookup',
    ).toContain('Moonshard answers');
    expect(gh2Section?.text, 'section lookup leaked Frosthaven section 67.1 into GH2 lookup').toBe(
      GH2_SECTION_TEXT,
    );

    const frosthavenKnowledge = await searchKnowledge('67.1', {
      scope: ['section'],
      limit: 3,
    });
    expect(frosthavenKnowledge.ok).toBe(true);
    if (!frosthavenKnowledge.ok) throw new Error(frosthavenKnowledge.error.message);
    expect(
      frosthavenKnowledge.results.map((hit) => hit.snippet),
      'knowledge section search leaked GH2 section 67.1 into default Frosthaven results',
    ).not.toContain(GH2_SECTION_TEXT);

    const gh2Knowledge = await searchKnowledge('67.1', {
      game: 'gloomhaven2',
      scope: ['section'],
      limit: 3,
    });
    expect(gh2Knowledge.ok).toBe(true);
    if (!gh2Knowledge.ok) throw new Error(gh2Knowledge.error.message);
    expect(
      gh2Knowledge.results.map((hit) => hit.snippet),
      'knowledge section search leaked Frosthaven section 67.1 into GH2 results',
    ).toEqual([GH2_SECTION_TEXT]);
  });

  it('canonical refs preserve the requested game when legacy refs collide', async () => {
    await expect(
      openEntity(SHARED_SCENARIO_REF),
      'legacy scenario ref should default to Frosthaven when games collide',
    ).resolves.toMatchObject({
      ok: true,
      entity: {
        kind: 'scenario',
        ref: 'scenario:frosthaven/061',
        title: 'Life and Death',
      },
    });
    await expect(
      openEntity(SHARED_SCENARIO_REF, { game: 'gh2' }),
      'legacy scenario ref with active GH2 should not open Frosthaven scenario 61',
    ).resolves.toMatchObject({
      ok: true,
      entity: {
        kind: 'scenario',
        ref: `scenario:${GLOOMHAVEN_2E_GAME_ID}/061`,
        title: GH2_SCENARIO_NAME,
      },
    });

    await expect(
      openEntity(`section:gh2/${SHARED_SECTION_REF}`),
      'alias-qualified GH2 section ref should canonicalize without opening Frosthaven',
    ).resolves.toMatchObject({
      ok: true,
      entity: {
        kind: 'section',
        ref: `section:${GLOOMHAVEN_2E_GAME_ID}/${SHARED_SECTION_REF}`,
        data: { text: GH2_SECTION_TEXT },
      },
    });

    await expect(
      openEntity(`card:gh2/items/${SHARED_ITEM_SOURCE_ID}`),
      'alias-qualified GH2 card ref should canonicalize without opening Frosthaven',
    ).resolves.toMatchObject({
      ok: true,
      entity: {
        kind: 'card',
        ref: `card:${GLOOMHAVEN_2E_GAME_ID}/items/${SHARED_ITEM_SOURCE_ID}`,
        data: {
          canonicalRef: `card:${GLOOMHAVEN_2E_GAME_ID}/items/${SHARED_ITEM_SOURCE_ID}`,
          effect: GH2_ITEM_EFFECT,
        },
      },
    });
  });
});
