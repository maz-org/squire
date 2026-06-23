import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { schema } from '../src/db.ts';
import { GLOOMHAVEN_2E_GAME_ID } from '../src/game.ts';
import {
  getCard,
  findScenario,
  followLinks,
  getScenario,
  getSection,
  searchCards,
} from '../src/tools.ts';

import { setupTestDb, teardownTestDb } from './helpers/db.ts';

describe('GH2 imported GHS data', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  it('writes representative GH2 rows to every supported card table', async () => {
    const tables = [
      ['monster-stats', schema.cardMonsterStats],
      ['monster-abilities', schema.cardMonsterAbilities],
      ['character-abilities', schema.cardCharacterAbilities],
      ['character-mats', schema.cardCharacterMats],
      ['items', schema.cardItems],
      ['events', schema.cardEvents],
      ['battle-goals', schema.cardBattleGoals],
      ['scenarios', schema.cardScenarios],
      ['personal-quests', schema.cardPersonalQuests],
    ] as const;

    for (const [type, table] of tables) {
      const rows = await db
        .select({ id: table.id })
        .from(table)
        .where(eq(table.game, GLOOMHAVEN_2E_GAME_ID));
      expect(rows.length, `${type} should have GH2 rows`).toBeGreaterThan(0);
    }

    const buildings = await db
      .select({ id: schema.cardBuildings.id })
      .from(schema.cardBuildings)
      .where(eq(schema.cardBuildings.game, GLOOMHAVEN_2E_GAME_ID));
    expect(buildings, 'GH2 has no supported GHS buildings.json source').toHaveLength(0);
  });

  it('seeds available GH2 locked-class ability decks under real class names', async () => {
    const rows = await db
      .select({ className: schema.cardCharacterAbilities.characterClass })
      .from(schema.cardCharacterAbilities)
      .where(eq(schema.cardCharacterAbilities.game, GLOOMHAVEN_2E_GAME_ID));

    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.className, (counts.get(row.className) ?? 0) + 1);

    expect(counts.get('Doomstalker')).toBe(30);
    expect(counts.get('Quartermaster')).toBe(30);
    expect(counts.has('Angry Face')).toBe(false);
    expect(counts.has('Three Spears')).toBe(false);
  });

  it('opens and searches GH2 item and monster card rows through the card tools', async () => {
    await expect(
      getCard('items', 'gloomhavensecretariat:item/1', { game: 'gh2' }),
    ).resolves.toMatchObject({
      sourceId: 'gloomhavensecretariat:item/1',
      name: 'Weathered Boots',
    });

    const weatheredBoots = await searchCards('Weathered Boots', 5, { game: 'gh2' });
    expect(weatheredBoots.map((hit) => hit.data.name)).toContain('Weathered Boots');

    await expect(
      getCard('monster-stats', 'gloomhavensecretariat:monster-stat/ancient-artillery/0-3', {
        game: 'gloomhaven-2e',
      }),
    ).resolves.toMatchObject({
      sourceId: 'gloomhavensecretariat:monster-stat/ancient-artillery/0-3',
      name: 'Ancient Artillery',
    });

    await expect(
      getCard('monster-abilities', 'gloomhavensecretariat:monster-ability/ancient-artillery/600', {
        game: 'gloomhaven2',
      }),
    ).resolves.toMatchObject({
      sourceId: 'gloomhavensecretariat:monster-ability/ancient-artillery/600',
      monsterType: 'Ancient Artillery',
    });
  });

  it('finds and opens GH2 scenario and section metadata', async () => {
    const matches = await findScenario('Training Course', { game: 'gh2' });
    expect(matches.map((scenario) => scenario.name)).toContain('Training Course');

    await expect(
      getScenario('gloomhavensecretariat:scenario/000', { game: 'gh2' }),
    ).resolves.toMatchObject({
      ref: 'gloomhavensecretariat:scenario/000',
      name: 'Training Course',
    });

    await expect(getSection('55.4', { game: 'gh2' })).resolves.toMatchObject({
      ref: '55.4',
      text: expect.stringContaining('Section 55.4: The Void.'),
    });

    const links = await followLinks('section', '55.4', 'cross_reference', { game: 'gh2' });
    expect(links.map((link) => link.toRef)).toContain('gloomhavensecretariat:scenario/054');
  });
});
