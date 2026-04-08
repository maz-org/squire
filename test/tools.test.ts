/**
 * Tests for `src/tools.ts` — the atomic search tools the agent composes.
 *
 * Per tech spec Decision 10: card-data tools run against a real Postgres
 * test DB seeded from `data/extracted/*.json`. The vector store is mocked
 * for `searchRules` since the pgvector path has its own integration coverage
 * in `test/vector-store.test.ts` and we don't want to re-embed the rulebook
 * for every tools test.
 */
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

const { mockSearch } = vi.hoisted(() => ({
  mockSearch: vi.fn(),
}));

vi.mock('../src/vector-store.ts', () => ({
  search: mockSearch,
}));

vi.mock('../src/embedder.ts', () => ({
  embed: vi.fn().mockResolvedValue(Array(384).fill(0.05)),
}));

import { searchRules, searchCards, listCardTypes, listCards, getCard } from '../src/tools.ts';
import type { RuleResult, CardResult, CardTypeInfo } from '../src/tools.ts';

import { setupTestDb, teardownTestDb } from './helpers/db.ts';

const FAKE_RULE_HITS = [
  {
    id: 'chunk-1',
    text: 'Loot action: pick up all loot tokens in your hex.',
    source: 'rulebook.pdf:42',
    chunkIndex: 0,
    game: 'frosthaven',
    score: 0.92,
  },
  {
    id: 'chunk-2',
    text: 'Movement rules: a figure must move at least one hex.',
    source: 'rulebook.pdf:15',
    chunkIndex: 1,
    game: 'frosthaven',
    score: 0.61,
  },
];

// `card_*` tables are seeded once per run by `test/helpers/global-setup.ts`.
beforeAll(async () => {
  await setupTestDb();
  mockSearch.mockImplementation(async (_v: number[], k = 6) => FAKE_RULE_HITS.slice(0, k));
});

afterAll(async () => {
  await teardownTestDb();
});

// ─── searchRules ─────────────────────────────────────────────────────────────

describe('searchRules', () => {
  it('returns structured results with text, source, and score', async () => {
    const results: RuleResult[] = await searchRules('loot action');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('text');
    expect(results[0]).toHaveProperty('source');
    expect(results[0]).toHaveProperty('score');
    expect(typeof results[0].text).toBe('string');
    expect(typeof results[0].source).toBe('string');
    expect(typeof results[0].score).toBe('number');
  });

  it('respects topK parameter', async () => {
    const results = await searchRules('loot action', 1);
    expect(results.length).toBe(1);
  });

  it('returns empty array when the vector store is empty', async () => {
    mockSearch.mockResolvedValueOnce([]);
    const results = await searchRules('loot action');
    expect(results).toEqual([]);
  });

  it('does not include internal fields in results', async () => {
    const results = await searchRules('loot');
    for (const r of results) {
      expect(r).not.toHaveProperty('embedding');
      expect(r).not.toHaveProperty('id');
      expect(r).not.toHaveProperty('chunkIndex');
    }
  });

  it('threads opts.game through to the vector store', async () => {
    mockSearch.mockClear();
    await searchRules('loot', 3, { game: 'gloomhaven' });
    expect(mockSearch).toHaveBeenCalledTimes(1);
    const callArgs = mockSearch.mock.calls[0];
    expect(callArgs[2]).toEqual({ game: 'gloomhaven' });
  });
});

// ─── searchCards ─────────────────────────────────────────────────────────────

describe('searchCards', () => {
  it('returns structured results with type, data, and score', async () => {
    const results: CardResult[] = await searchCards('algox archer');
    expect(results.length).toBeGreaterThan(0);
    const first = results[0];
    expect(first).toHaveProperty('type');
    expect(first).toHaveProperty('data');
    expect(first).toHaveProperty('score');
    expect(typeof first.type).toBe('string');
    expect(typeof first.data).toBe('object');
    expect(typeof first.score).toBe('number');
    expect(first.score).toBeGreaterThan(0);
  });

  it('promotes _type from data into the top-level type field', async () => {
    const results = await searchCards('algox archer');
    for (const r of results) {
      expect(r.data).not.toHaveProperty('_type');
      expect(r.type).toBeDefined();
    }
  });

  it('weights name fields above cross-references (monster-stats wins)', async () => {
    const results = await searchCards('algox archer');
    expect(results[0].type).toBe('monster-stats');
  });

  it('respects topK parameter', async () => {
    const results = await searchCards('attack', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('returns empty array for a query that matches nothing', async () => {
    const results = await searchCards('zzzzzzz-no-such-token-zzzzzzz');
    expect(results).toEqual([]);
  });
});

// ─── listCardTypes ───────────────────────────────────────────────────────────

describe('listCardTypes', () => {
  it('returns all 10 card types', async () => {
    const types: CardTypeInfo[] = await listCardTypes();
    expect(types.length).toBe(10);
    const names = types.map((t) => t.type);
    expect(names).toEqual(
      expect.arrayContaining([
        'monster-stats',
        'monster-abilities',
        'character-abilities',
        'character-mats',
        'items',
        'events',
        'battle-goals',
        'buildings',
        'scenarios',
        'personal-quests',
      ]),
    );
  });

  it('each entry has type and numeric count fields', async () => {
    const types = await listCardTypes();
    for (const t of types) {
      expect(typeof t.type).toBe('string');
      expect(typeof t.count).toBe('number');
      expect(t.count).toBeGreaterThanOrEqual(0);
    }
  });

  it('reports non-zero counts for seeded types', async () => {
    const types = await listCardTypes();
    const monsterStats = types.find((t) => t.type === 'monster-stats');
    expect(monsterStats!.count).toBeGreaterThan(0);
  });
});

// ─── listCards ───────────────────────────────────────────────────────────────

describe('listCards', () => {
  it('returns all cards of a given type', async () => {
    const cards = await listCards('battle-goals');
    expect(cards.length).toBeGreaterThan(0);
    expect(cards[0]).toHaveProperty('name');
  });

  it('strips internal fields from results', async () => {
    const cards = await listCards('items');
    for (const card of cards) {
      expect(card).not.toHaveProperty('_type');
      expect(card).not.toHaveProperty('id');
      expect(card).not.toHaveProperty('game');
      expect(card).not.toHaveProperty('searchVector');
    }
  });

  it('filters by a single field value (AND logic)', async () => {
    const all = await listCards('battle-goals');
    const target = all[0];
    const filtered = await listCards('battle-goals', { name: target.name });
    expect(filtered.length).toBeGreaterThan(0);
    for (const c of filtered) expect(c.name).toBe(target.name);
  });

  it('returns empty when filter matches nothing', async () => {
    const cards = await listCards('items', { name: 'No Such Item Exists' });
    expect(cards).toEqual([]);
  });
});

// ─── getCard ─────────────────────────────────────────────────────────────────

describe('getCard', () => {
  it('looks up a card by canonical sourceId', async () => {
    const card = await getCard('items', 'gloomhavensecretariat:item/1');
    expect(card).not.toBeNull();
    expect(card!.sourceId).toBe('gloomhavensecretariat:item/1');
  });

  it('returns null for an unknown sourceId', async () => {
    const card = await getCard('items', 'gloomhavensecretariat:item/does-not-exist');
    expect(card).toBeNull();
  });

  it('strips internal fields from the result', async () => {
    const card = await getCard('items', 'gloomhavensecretariat:item/1');
    expect(card).not.toBeNull();
    expect(card).not.toHaveProperty('_type');
    expect(card).not.toHaveProperty('id');
    expect(card).not.toHaveProperty('game');
    expect(card).not.toHaveProperty('searchVector');
  });

  it('is case-sensitive on sourceId', async () => {
    const card = await getCard('items', 'GLOOMHAVENSECRETARIAT:ITEM/1');
    expect(card).toBeNull();
  });
});
