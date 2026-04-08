/**
 * Tests for `src/extracted-data.ts`.
 *
 * Per tech spec Decision 10: integration tests run against a real Postgres
 * test DB. SQR-56 made this module DB-backed, so the old fs-mocked suite was
 * replaced with the integration coverage below. Pure formatting helpers
 * (`formatExtracted`) are still tested as plain unit tests since they don't
 * touch the DB.
 *
 * The card_* tables are seeded once per RUN by `test/helpers/global-setup.ts`
 * (registered in vitest.config.ts) via the real `seedCards` over
 * `data/extracted/*.json`, mirroring how `npm run seed:cards` populates dev.
 * Tests here are read-only against that shared seed, so we don't truncate
 * between files.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, afterAll, describe, expect, it } from 'vitest';

import {
  TYPES,
  countsByType,
  extractedStats,
  formatExtracted,
  load,
  loadOne,
  searchExtracted,
  searchExtractedRanked,
} from '../src/extracted-data.ts';
import type { CardType } from '../src/schemas.ts';

import { setupTestDb, teardownTestDb } from './helpers/db.ts';

/**
 * Read the raw extracted JSON for a type. This IS the parity snapshot: the
 * committed `data/extracted/<type>.json` file is the source the seed reads,
 * so comparing `load(type)` against it proves nothing is lost end-to-end
 * (JSON → Zod validate → DB upsert → DB SELECT → load record).
 *
 * No static copy is committed under `test/fixtures/` because any committed
 * copy would drift whenever the extractor re-runs. The test is dynamic and
 * always matches whatever the seed consumed on this run.
 */
function readRawExtracted(type: CardType): Array<Record<string, unknown>> {
  const path = join(import.meta.dirname, '..', 'data', 'extracted', `${type}.json`);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Array<Record<string, unknown>>;
  // The seed skips records with `_error` / `_parseError` markers set by the
  // importers; mirror that filter here.
  return raw.filter((r) => !r._error && !r._parseError);
}

/**
 * Records in `data/extracted/*.json` that fail the current Zod schema and
 * get dropped by `seedCards`. Each one is a real data-quality or schema
 * gap that needs its own investigation; tracked in Linear and surfaced
 * here with a pointer so the parity test doesn't silently mask them.
 *
 * Parity test behaviour: records whose sourceId matches an entry here are
 * EXCLUDED from both sides of the comparison. If the underlying Linear
 * issue is fixed, the entry here must be removed in the same PR.
 */
const KNOWN_PARITY_EXCLUSIONS: Partial<Record<CardType, { sourceIds: string[]; issue: string }>> = {
  'character-mats': {
    // Geminate is a split character mat (two forms) and ships with
    // handSize "7|7". Current schema declares handSize as int; evolving
    // to support split mats needs its own design pass.
    sourceIds: ['gloomhavensecretariat:character-mat/geminate'],
    issue: 'SQR-63',
  },
};

function readSearchSnapshot(): Array<{ query: string; expectedTopSourceIds: string[] }> {
  const path = join(import.meta.dirname, 'fixtures', 'search-queries', 'cards.json');
  return JSON.parse(readFileSync(path, 'utf8')) as Array<{
    query: string;
    expectedTopSourceIds: string[];
  }>;
}

// `card_*` tables are seeded once per run by `test/helpers/global-setup.ts`
// (registered in vitest.config.ts). Tests here are read-only against that
// seed.
beforeAll(async () => {
  await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

// ─── load / loadOne / countsByType ───────────────────────────────────────────

describe('load', () => {
  it('returns rows ordered by source_id with the _type tag', async () => {
    const rows = await load('battle-goals');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r._type).toBe('battle-goals');
    // Ordering: source_id ascending. A round-trip-stable smoke check.
    const ids = rows.map((r) => r.sourceId as string);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it('hides internal columns (id, game, searchVector)', async () => {
    const rows = await load('items');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r).not.toHaveProperty('id');
      expect(r).not.toHaveProperty('game');
      expect(r).not.toHaveProperty('searchVector');
    }
  });

  it('returns an empty array for an unknown game', async () => {
    const rows = await load('items', { game: 'no-such-game' });
    expect(rows).toEqual([]);
  });
});

describe('loadOne', () => {
  it('fetches a single row by canonical sourceId', async () => {
    const row = await loadOne('items', 'gloomhavensecretariat:item/1');
    expect(row).not.toBeNull();
    expect(row!._type).toBe('items');
    expect(row!.sourceId).toBe('gloomhavensecretariat:item/1');
  });

  it('returns null when sourceId does not exist', async () => {
    const row = await loadOne('items', 'gloomhavensecretariat:item/does-not-exist');
    expect(row).toBeNull();
  });

  it('is case-sensitive (sourceId is canonical, not human input)', async () => {
    const row = await loadOne('items', 'GLOOMHAVENSECRETARIAT:ITEM/1');
    expect(row).toBeNull();
  });
});

describe('countsByType', () => {
  it('returns one entry per card type with non-negative counts', async () => {
    const counts = await countsByType();
    for (const t of TYPES) {
      expect(counts[t]).toBeGreaterThanOrEqual(0);
    }
  });

  it('counts match load() row counts', async () => {
    const counts = await countsByType();
    const loaded = await load('battle-goals');
    expect(counts['battle-goals']).toBe(loaded.length);
  });
});

// ─── load parity (raw data/extracted as snapshot) ───────────────────────────
//
// The parity test compares `load(type)` against `data/extracted/<type>.json`
// directly — the raw JSON IS the snapshot. Committing static copies under
// `test/fixtures/parity-snapshots/` (SQR-55) was redundant and prone to
// drift, so SQR-57 deleted them in favour of this dynamic check. Any field
// silently lost in the seed → DB → load pipeline fails the test loudly.

/**
 * Drop keys whose value is null or undefined so that a column stored as
 * NULL in the DB compares equal to a record where the corresponding key
 * is simply absent in the raw JSON (e.g. `complexity` on solo scenarios).
 * Recurses into nested objects and arrays so that jsonb columns
 * (requirements, objectives, rewards dicts) normalize the same way.
 */
function stripNullish(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNullish);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null || v === undefined) continue;
      out[k] = stripNullish(v);
    }
    return out;
  }
  return value;
}

describe('load parity', () => {
  for (const type of TYPES) {
    it(`${type}: load() matches data/extracted/${type}.json`, async () => {
      const raw = readRawExtracted(type);
      const exclusion = KNOWN_PARITY_EXCLUSIONS[type];
      const excluded = new Set(exclusion?.sourceIds ?? []);

      // Sort both sides by the same JS comparator (bytewise). Postgres's
      // `ORDER BY source_id` uses DB collation which disagrees with JS on
      // punctuation — irrelevant here because we just need deterministic
      // matching order, not to reproduce Postgres' order.
      const bySourceId = (a: Record<string, unknown>, b: Record<string, unknown>) => {
        const x = a.sourceId as string;
        const y = b.sourceId as string;
        return x < y ? -1 : x > y ? 1 : 0;
      };

      const expected = raw
        .filter((r) => !excluded.has(r.sourceId as string))
        .slice()
        .sort(bySourceId)
        .map(stripNullish);

      const rows = await load(type);
      const actual = rows
        .filter((r) => !excluded.has(r.sourceId as string))
        // Strip the `_type` tag the DB-backed loader adds; raw JSON predates it.
        .map(({ _type: _ignored, ...rest }) => rest)
        .slice()
        .sort(bySourceId)
        .map(stripNullish);

      expect(actual).toEqual(expected);
    });
  }
});

// ─── search ──────────────────────────────────────────────────────────────────

describe('searchExtracted / searchExtractedRanked', () => {
  it('returns scored hits ordered by descending score', async () => {
    const ranked = await searchExtractedRanked('algox archer', 6);
    expect(ranked.length).toBeGreaterThan(0);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
  });

  it('weights name fields above cross-reference arrays', async () => {
    // Without setweight, scenarios that list "Algox Archer" in their
    // monsters[] array outranked the actual monster-stats row. The 'A'/'D'
    // weighting in 0002_card_fts.sql is the fix; this test guards it.
    const ranked = await searchExtractedRanked('algox archer', 6);
    expect(ranked[0].record._type).toBe('monster-stats');
  });

  it('searchExtracted strips the score wrapper', async () => {
    const records = await searchExtracted('algox archer', 3);
    expect(records.length).toBeGreaterThan(0);
    for (const r of records) {
      expect(r).toHaveProperty('_type');
      expect(r).not.toHaveProperty('score');
    }
  });

  it('respects the k limit', async () => {
    const records = await searchExtracted('attack', 2);
    expect(records.length).toBeLessThanOrEqual(2);
  });

  it('returns empty for a query that matches nothing', async () => {
    const records = await searchExtracted('zzzzzzzzz-no-such-token-zzzzzzz', 6);
    expect(records).toEqual([]);
  });
});

// ─── search fixture parity ───────────────────────────────────────────────────
//
// `test/fixtures/search-queries/cards.json` captures the expected top-6
// sourceIds for a curated set of 20 FTS-friendly queries (see the fixture for
// the list). The fixture was regenerated in SQR-57 from the Postgres FTS
// `searchExtracted` implementation, replacing the pre-migration keyword-scorer
// output from SQR-55. Guards against ranking regressions introduced by
// tsvector / ts_rank / weight-vector changes.
//
// To update intentionally: run `node --experimental-strip-types scripts/
// regen-cards-search-fixture.ts` (ad-hoc; see PR description for the inline
// script used to generate the committed version).

describe('searchExtracted fixture parity', () => {
  const fixture = readSearchSnapshot();
  for (const { query, expectedTopSourceIds } of fixture) {
    it(`"${query}": top ${expectedTopSourceIds.length} FTS results match`, async () => {
      const records = await searchExtracted(query, 6);
      const actual = records.map((r) => r.sourceId);
      expect(actual).toEqual(expectedTopSourceIds);
    });
  }
});

describe('extractedStats', () => {
  it('returns a comma-separated count summary covering every type', async () => {
    const summary = await extractedStats();
    for (const t of TYPES) {
      expect(summary).toContain(`${t}:`);
    }
  });
});

// ─── formatExtracted (pure unit tests, no DB) ────────────────────────────────

describe('formatExtracted', () => {
  it('returns empty string for empty array', () => {
    expect(formatExtracted([])).toBe('');
  });

  it('formats monster stats with name and levels', () => {
    const text = formatExtracted([
      {
        _type: 'monster-stats',
        name: 'Ooze',
        levelRange: '0-3',
        normal: { 0: { hp: 5, move: 1, attack: 2 } },
        elite: { 0: { hp: 8, move: 2, attack: 3 } },
        immunities: ['poison'],
        notes: null,
      },
    ]);
    expect(text).toContain('Monster: Ooze');
    expect(text).toContain('Level 0');
    expect(text).toContain('HP 5');
    expect(text).toContain('Immunities: poison');
  });

  it('formats battle goals with condition', () => {
    const text = formatExtracted([
      {
        _type: 'battle-goals',
        name: 'Assassin',
        condition: 'Kill an enemy before its first turn.',
        checkmarks: 2,
      },
    ]);
    expect(text).toContain('Battle Goal');
    expect(text).toContain('Assassin');
    expect(text).toContain('Kill an enemy');
    expect(text).toContain('Checkmarks: 2');
  });

  it('formats items with slot, cost, and lost flag', () => {
    const text = formatExtracted([
      {
        _type: 'items',
        number: '099',
        name: 'Major Healing Potion',
        slot: 'small item',
        cost: 20,
        effect: 'Heal 4',
        uses: 1,
        spent: false,
        lost: true,
      },
    ]);
    expect(text).toContain('Item #099');
    expect(text).toContain('Major Healing Potion');
    expect(text).toContain('20g');
    expect(text).toContain('Heal 4');
    expect(text).toContain('[lost]');
  });

  it('formats character abilities with top and bottom actions', () => {
    const text = formatExtracted([
      {
        _type: 'character-abilities',
        cardName: 'Nimble Knife',
        characterClass: 'Drifter',
        level: 1,
        initiative: 23,
        top: { action: 'Attack 3', effects: ['Pierce 1'] },
        bottom: { action: 'Move 4', effects: [] },
        lost: false,
      },
    ]);
    expect(text).toContain('Drifter');
    expect(text).toContain('Nimble Knife');
    expect(text).toContain('Attack 3');
    expect(text).toContain('Move 4');
  });

  it('formats events with options', () => {
    const text = formatExtracted([
      {
        _type: 'events',
        eventType: 'road',
        season: 'winter',
        number: '05',
        flavorText: 'A storm approaches.',
        optionA: { text: 'Take shelter', outcome: 'Gain 5 gold' },
        optionB: { text: 'Push through', outcome: 'Lose 2 HP' },
      },
    ]);
    expect(text).toContain('winter');
    expect(text).toContain('road event #05');
    expect(text).toContain('A storm approaches');
    expect(text).toContain('Take shelter');
    expect(text).toContain('Push through');
  });

  it('formats buildings with cost and effect', () => {
    const text = formatExtracted([
      {
        _type: 'buildings',
        buildingNumber: '05',
        name: 'Mining Camp',
        level: 1,
        buildCost: { gold: 20, lumber: 5, metal: null, hide: null },
        effect: 'Gain 2 metal each week',
        notes: null,
      },
    ]);
    expect(text).toContain('Mining Camp');
    expect(text).toContain('20 gold');
    expect(text).toContain('5 lumber');
    expect(text).toContain('Gain 2 metal');
  });

  it('formats monster abilities with initiative', () => {
    const text = formatExtracted([
      {
        _type: 'monster-abilities',
        monsterType: 'Algox Archer',
        cardName: 'Aimed Shot',
        initiative: 45,
        abilities: ['Attack +2', 'Range +1'],
      },
    ]);
    expect(text).toContain('Algox Archer');
    expect(text).toContain('Aimed Shot');
    expect(text).toContain('initiative 45');
    expect(text).toContain('Attack +2');
  });

  it('formats character mats with hp curve and traits', () => {
    const text = formatExtracted([
      {
        _type: 'character-mats',
        name: 'Banner Spear',
        characterClass: 'Banner Spear',
        handSize: 11,
        hp: { 1: 8, 2: 9, 3: 10 },
        traits: ['Quatryl'],
        perks: ['Remove two -1 cards'],
        masteries: ['Long reach mastery'],
      },
    ]);
    expect(text).toContain('Banner Spear');
    expect(text).toContain('Hand size: 11');
    expect(text).toContain('Traits: Quatryl');
    expect(text).toContain('L1=8');
  });

  it('formats personal quests with requirements', () => {
    const text = formatExtracted([
      {
        _type: 'personal-quests',
        cardId: '501',
        name: 'A Study in Shadow',
        requirements: [
          { description: 'Kill 20 enemies', target: 20, options: null, dependsOn: null },
        ],
        openEnvelope: 'A',
      },
    ]);
    expect(text).toContain('Personal Quest #501');
    expect(text).toContain('Kill 20 enemies');
    expect(text).toContain('open envelope A');
  });

  it('formats scenarios with monsters and rewards', () => {
    const text = formatExtracted([
      {
        _type: 'scenarios',
        index: '01',
        name: 'Black Barrow',
        complexity: 1,
        monsters: ['Algox Archer', 'Algox Scout'],
        allies: [],
        unlocks: ['02', '03'],
        rewards: '5 XP',
        lootDeckConfig: { gold: 6 },
        initial: true,
      },
    ]);
    expect(text).toContain('Scenario #01');
    expect(text).toContain('Black Barrow');
    expect(text).toContain('Monsters: Algox Archer, Algox Scout');
    expect(text).toContain('Starting scenario');
    expect(text).toContain('Rewards: 5 XP');
  });
});
