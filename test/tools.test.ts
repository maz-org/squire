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

import {
  searchRules,
  searchCards,
  listCardTypes,
  listCards,
  getCard,
  findScenario,
  getScenario,
  getSection,
  followLinks,
} from '../src/tools.ts';
import type {
  RuleResult,
  CardResult,
  CardTypeInfo,
  ScenarioResult,
  SectionResult,
  ReferenceResult,
} from '../src/tools.ts';

import { setupTestDb, teardownTestDb } from './helpers/db.ts';

const FAKE_RULE_HITS = [
  {
    id: 'chunk-1',
    text: 'Loot action: pick up all loot tokens in your hex.',
    source: 'fh-rule-book.pdf',
    chunkIndex: 0,
    game: 'frosthaven',
    score: 0.92,
  },
  {
    id: 'chunk-2',
    text: 'Scenario setup: place the overlay tiles shown in the diagram.',
    source: 'fh-scenario-book-42-61.pdf',
    chunkIndex: 1,
    game: 'frosthaven',
    score: 0.61,
  },
  {
    id: 'chunk-3',
    text: 'Section 67.1 links to Life and Death (scenario 61).',
    source: 'fh-section-book-62-81.pdf',
    chunkIndex: 2,
    game: 'frosthaven',
    score: 0.58,
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
  it('returns structured results with text, source, sourceLabel, and score', async () => {
    const results: RuleResult[] = await searchRules('loot action');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('text');
    expect(results[0]).toHaveProperty('source');
    expect(results[0]).toHaveProperty('sourceLabel');
    expect(results[0]).toHaveProperty('score');
    expect(typeof results[0].text).toBe('string');
    expect(typeof results[0].source).toBe('string');
    expect(typeof results[0].sourceLabel).toBe('string');
    expect(typeof results[0].score).toBe('number');
  });

  it('adds source labels that distinguish rulebook, scenario, and section books', async () => {
    const results = await searchRules('scenario 61');
    expect(results.map((r) => [r.source, r.sourceLabel])).toEqual([
      ['fh-rule-book.pdf', 'Rulebook'],
      ['fh-scenario-book-42-61.pdf', 'Scenario Book 42-61'],
      ['fh-section-book-62-81.pdf', 'Section Book 62-81'],
    ]);
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

describe('scenario/section book tools', () => {
  it('findScenario resolves an exact scenario-number query', async () => {
    const results: ScenarioResult[] = await findScenario('scenario 61');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].scenarioIndex).toBe('61');
    expect(results[0].name).toBe('Life and Death');
    expect(results[0].ref).toBe('gloomhavensecretariat:scenario/061');
  });

  it('getScenario returns the seeded traversal scenario record', async () => {
    const scenario = await getScenario('gloomhavensecretariat:scenario/061');
    expect(scenario).not.toBeNull();
    expect(scenario!.sourcePdf).toBe('fh-scenario-book-62-81.pdf');
    expect(scenario!.rawText).toContain('67.1');
  });

  it('getSection returns exact section text for a known section ref', async () => {
    const section: SectionResult | null = await getSection('67.1');
    expect(section).not.toBeNull();
    expect(section!.sectionNumber).toBe(67);
    expect(section!.sectionVariant).toBe(1);
    expect(section!.text).toContain('Your ears fill with the sound of your own');
    expect(section!.text).toContain('seals grow weak.');
  });

  it('followLinks returns the scenario 61 conclusion link to section 67.1', async () => {
    const links: ReferenceResult[] = await followLinks(
      'scenario',
      'gloomhavensecretariat:scenario/061',
      'conclusion',
    );
    expect(links).toEqual([
      expect.objectContaining({
        fromKind: 'scenario',
        fromRef: 'gloomhavensecretariat:scenario/061',
        toKind: 'section',
        toRef: '67.1',
        linkType: 'conclusion',
      }),
    ]);
  });

  it('supports repeated section chasing across a real two-hop read_now chain', async () => {
    const firstHop = await followLinks('section', '103.1', 'read_now');
    expect(firstHop).toEqual([
      expect.objectContaining({
        fromKind: 'section',
        fromRef: '103.1',
        toKind: 'section',
        toRef: '11.5',
        linkType: 'read_now',
      }),
    ]);

    const secondHop = await followLinks('section', '11.5', 'read_now');
    expect(secondHop).toEqual([
      expect.objectContaining({
        fromKind: 'section',
        fromRef: '11.5',
        toKind: 'section',
        toRef: '155.1',
        linkType: 'read_now',
      }),
    ]);

    const finalSection = await getSection('155.1');
    expect(finalSection).not.toBeNull();
    expect(finalSection!.text).toContain('made short work of them');
  });

  it('keeps scenario-box links whose section refs are OCR-spaced around the dot', async () => {
    const links: ReferenceResult[] = await followLinks(
      'scenario',
      'gloomhavensecretariat:scenario/087',
      'read_now',
    );
    expect(links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromRef: 'gloomhavensecretariat:scenario/087',
          toRef: '77.2',
          linkType: 'read_now',
        }),
      ]),
    );
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
