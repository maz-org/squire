import { describe, it, expect, vi } from 'vitest';

// ─── Mock extracted data (fs-level, same pattern as extracted-data.test.ts) ──

const FAKE_MONSTER_STATS = JSON.stringify([
  {
    name: 'Algox Archer',
    levelRange: '0-3',
    normal: { 0: { hp: 5, move: 2, attack: 3 } },
    elite: { 0: { hp: 8, move: 3, attack: 4 } },
    immunities: [],
    notes: null,
  },
]);

const FAKE_ITEMS = JSON.stringify([
  {
    number: '001',
    name: 'Boots of Speed',
    slot: 'legs',
    cost: 20,
    effect: 'Move +1',
    uses: null,
    spent: false,
    lost: false,
  },
]);

const { mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

mockExistsSync.mockImplementation((path: string) => {
  if (path.includes('monster-stats.json')) return true;
  if (path.includes('items.json')) return true;
  if (path.includes('index.json')) return true;
  return false;
});

mockReadFileSync.mockImplementation((path: string) => {
  if (typeof path === 'string' && path.includes('monster-stats.json')) return FAKE_MONSTER_STATS;
  if (typeof path === 'string' && path.includes('items.json')) return FAKE_ITEMS;
  if (typeof path === 'string' && path.includes('index.json')) {
    return JSON.stringify([
      {
        id: 'chunk-1',
        text: 'Loot action: pick up all loot tokens in your hex.',
        embedding: Array(384).fill(0.05),
        source: 'rulebook.pdf:42',
        chunkIndex: 0,
      },
      {
        id: 'chunk-2',
        text: 'Movement rules: a figure must move at least one hex.',
        embedding: Array(384).fill(0.03),
        source: 'rulebook.pdf:15',
        chunkIndex: 1,
      },
    ]);
  }
  return '[]';
});

// ─── Mock embedder ───────────────────────────────────────────────────────────

vi.mock('../src/embedder.ts', () => ({
  embed: vi.fn().mockResolvedValue(Array(384).fill(0.05)),
}));

import { searchRules, searchCards, listCardTypes, listCards, getCard } from '../src/tools.ts';
import type { RuleResult, CardResult, CardTypeInfo } from '../src/tools.ts';

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

  it('returns empty array when index is empty', async () => {
    // Make loadIndex return [] by pretending index.json doesn't exist
    mockExistsSync.mockImplementation((path: string) => {
      if (path.includes('index.json')) return false;
      return false;
    });

    const results = await searchRules('loot action');
    expect(results).toEqual([]);

    // Restore normal mock behavior
    mockExistsSync.mockImplementation((path: string) => {
      if (path.includes('monster-stats.json')) return true;
      if (path.includes('items.json')) return true;
      if (path.includes('index.json')) return true;
      return false;
    });
  });

  it('does not include embedding vectors in results', async () => {
    const results = await searchRules('loot');
    for (const r of results) {
      expect(r).not.toHaveProperty('embedding');
      expect(r).not.toHaveProperty('id');
      expect(r).not.toHaveProperty('chunkIndex');
    }
  });
});

// ─── searchCards ─────────────────────────────────────────────────────────────

describe('searchCards', () => {
  it('returns structured results with type, data, and score', () => {
    const results: CardResult[] = searchCards('algox archer stats');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('type');
    expect(results[0]).toHaveProperty('data');
    expect(results[0]).toHaveProperty('score');
    expect(typeof results[0].type).toBe('string');
    expect(typeof results[0].data).toBe('object');
    expect(typeof results[0].score).toBe('number');
  });

  it('does not include _type in data (it is promoted to type)', () => {
    const results = searchCards('algox archer');
    for (const r of results) {
      expect(r.data).not.toHaveProperty('_type');
      expect(r.type).toBeDefined();
    }
  });

  it('returns monster-stats type for monster queries', () => {
    const results = searchCards('algox archer');
    expect(results.some((r) => r.type === 'monster-stats')).toBe(true);
  });

  it('returns items type for item queries', () => {
    const results = searchCards('boots speed');
    expect(results.some((r) => r.type === 'items')).toBe(true);
  });

  it('respects topK parameter', () => {
    const results = searchCards('attack move', 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('returns empty array for empty query', () => {
    const results = searchCards('');
    expect(results).toEqual([]);
  });

  it('returns empty array for stopword-only queries', () => {
    const results = searchCards('the and for');
    expect(results).toEqual([]);
  });

  it('includes card data fields in data property', () => {
    const results = searchCards('algox archer');
    const monster = results.find((r) => r.type === 'monster-stats');
    expect(monster).toBeDefined();
    expect(monster!.data).toHaveProperty('name', 'Algox Archer');
    expect(monster!.data).toHaveProperty('normal');
    expect(monster!.data).toHaveProperty('elite');
  });

  it('score is positive for matching results', () => {
    const results = searchCards('algox archer');
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0);
    }
  });
});

// ─── listCardTypes ───────────────────────────────────────────────────────────

describe('listCardTypes', () => {
  it('returns all available card types with counts', () => {
    const types: CardTypeInfo[] = listCardTypes();
    expect(types.length).toBeGreaterThan(0);
    // Our mocks have monster-stats and items with data
    const monsterStats = types.find((t) => t.type === 'monster-stats');
    expect(monsterStats).toBeDefined();
    expect(monsterStats!.count).toBe(1);
  });

  it('each entry has type and count fields', () => {
    const types = listCardTypes();
    for (const t of types) {
      expect(t).toHaveProperty('type');
      expect(t).toHaveProperty('count');
      expect(typeof t.type).toBe('string');
      expect(typeof t.count).toBe('number');
    }
  });

  it('includes types with zero records', () => {
    const types = listCardTypes();
    // events has no mock data, so count should be 0
    const events = types.find((t) => t.type === 'events');
    expect(events).toBeDefined();
    expect(events!.count).toBe(0);
  });

  it('returns all 8 card types', () => {
    const types = listCardTypes();
    expect(types.length).toBe(8);
    const typeNames = types.map((t) => t.type);
    expect(typeNames).toContain('monster-stats');
    expect(typeNames).toContain('monster-abilities');
    expect(typeNames).toContain('character-abilities');
    expect(typeNames).toContain('character-mats');
    expect(typeNames).toContain('items');
    expect(typeNames).toContain('events');
    expect(typeNames).toContain('battle-goals');
    expect(typeNames).toContain('buildings');
  });
});

// ─── listCards ────────────────────────────────────────────────────────────────

describe('listCards', () => {
  it('returns all cards of a given type', () => {
    const cards = listCards('monster-stats');
    expect(cards.length).toBe(1);
    expect(cards[0]).toHaveProperty('name', 'Algox Archer');
  });

  it('returns empty array for type with no data', () => {
    const cards = listCards('events');
    expect(cards).toEqual([]);
  });

  it('filters cards by a field value', () => {
    const cards = listCards('monster-stats', { name: 'Algox Archer' });
    expect(cards.length).toBe(1);
    expect(cards[0]).toHaveProperty('name', 'Algox Archer');
  });

  it('returns empty when filter matches nothing', () => {
    const cards = listCards('monster-stats', { name: 'Nonexistent Monster' });
    expect(cards).toEqual([]);
  });

  it('filters items by slot', () => {
    const cards = listCards('items', { slot: 'legs' });
    expect(cards.length).toBe(1);
    expect(cards[0]).toHaveProperty('name', 'Boots of Speed');
  });

  it('filters with multiple fields (AND logic)', () => {
    const cards = listCards('items', { slot: 'legs', name: 'Boots of Speed' });
    expect(cards.length).toBe(1);
  });

  it('does not include internal _type or _error fields in results', () => {
    const cards = listCards('monster-stats');
    for (const card of cards) {
      expect(card).not.toHaveProperty('_type');
      expect(card).not.toHaveProperty('_error');
      expect(card).not.toHaveProperty('_parseError');
    }
  });
});

// ─── getCard ─────────────────────────────────────────────────────────────────

describe('getCard', () => {
  it('looks up a monster by name', () => {
    const card = getCard('monster-stats', 'Algox Archer');
    expect(card).not.toBeNull();
    expect(card!.name).toBe('Algox Archer');
  });

  it('looks up an item by number', () => {
    const card = getCard('items', '001');
    expect(card).not.toBeNull();
    expect(card!.name).toBe('Boots of Speed');
  });

  it('returns null for non-existent card', () => {
    const card = getCard('monster-stats', 'Nonexistent Monster');
    expect(card).toBeNull();
  });

  it('returns null for empty type', () => {
    const card = getCard('events', '999');
    expect(card).toBeNull();
  });

  it('does not include internal fields in result', () => {
    const card = getCard('monster-stats', 'Algox Archer');
    expect(card).not.toBeNull();
    expect(card).not.toHaveProperty('_type');
    expect(card).not.toHaveProperty('_error');
    expect(card).not.toHaveProperty('_parseError');
  });

  it('is case-insensitive for name lookups', () => {
    const card = getCard('monster-stats', 'algox archer');
    expect(card).not.toBeNull();
    expect(card!.name).toBe('Algox Archer');
  });
});
