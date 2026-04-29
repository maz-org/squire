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
import { sql } from 'drizzle-orm';

const { mockSearch, mockGetEntryBySourceChunk } = vi.hoisted(() => ({
  mockSearch: vi.fn(),
  mockGetEntryBySourceChunk: vi.fn(),
}));

vi.mock('../src/vector-store.ts', () => ({
  search: mockSearch,
  getEntryBySourceChunk: mockGetEntryBySourceChunk,
}));

vi.mock('../src/embedder.ts', () => ({
  embed: vi.fn().mockResolvedValue(Array(384).fill(0.05)),
}));

import {
  searchRules,
  searchCards,
  searchKnowledge,
  listCardTypes,
  listCards,
  getCard,
  openEntity,
  inspectSources,
  getSchema,
  resolveEntity,
  findScenario,
  getScenario,
  getSection,
  followLinks,
  neighbors,
} from '../src/tools.ts';
import type {
  RuleResult,
  CardResult,
  CardTypeInfo,
  EntityResolutionResult,
  ScenarioResult,
  SectionResult,
  ReferenceResult,
  KnowledgeOpenResult,
  KnowledgeSearchResult,
  KnowledgeNeighborsResult,
} from '../src/tools.ts';
import { findScenarios } from '../src/scenario-section-data.ts';
import { getDb } from '../src/db.ts';
import { scenarioBookScenarios } from '../src/db/schema/scenario-section-books.ts';

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
  mockGetEntryBySourceChunk.mockImplementation(async (source: string, chunkIndex: number) => {
    const hit = FAKE_RULE_HITS.find(
      (entry) => entry.source === source && entry.chunkIndex === chunkIndex,
    );
    return hit ?? null;
  });
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

describe('openEntity', () => {
  it('opens a scenario with source metadata and inspectable next links', async () => {
    const result: KnowledgeOpenResult = await openEntity('scenario:frosthaven/061');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);

    expect(result.entity).toMatchObject({
      kind: 'scenario',
      ref: 'scenario:frosthaven/061',
      title: 'Life and Death',
      sourceLabel: 'Scenario Book 62-81',
    });
    expect(result.entity.data).toMatchObject({
      scenarioIndex: '61',
      sourcePdf: 'fh-scenario-book-62-81.pdf',
    });
    expect(result.citations).toEqual([
      expect.objectContaining({
        sourceRef: 'source:frosthaven/fh-scenario-book-62-81',
        sourceLabel: 'Scenario Book 62-81',
        locator: 'scenario 61',
      }),
    ]);
    expect(result.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: 'conclusion',
          target: expect.objectContaining({
            kind: 'section',
            ref: 'section:frosthaven/67.1',
          }),
        }),
      ]),
    );
  });

  it('opens a section with exact text, source metadata, and outgoing links', async () => {
    const result = await openEntity('section:frosthaven/66.2');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);

    expect(result.entity).toMatchObject({
      kind: 'section',
      ref: 'section:frosthaven/66.2',
      title: 'Section 66.2',
      sourceLabel: 'Section Book 62-81',
    });
    expect(result.entity.data.text).toContain('Caravan Guards116');
    expect(result.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: 'unlock',
          target: expect.objectContaining({
            kind: 'scenario',
            ref: 'scenario:frosthaven/116',
          }),
        }),
      ]),
    );
  });

  it('opens a card with canonical ID, card type, display name, and source fields', async () => {
    const result = await openEntity('card:frosthaven/items/gloomhavensecretariat:item/1');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);

    expect(result.entity.kind).toBe('card');
    expect(result.entity.ref).toBe('card:frosthaven/items/gloomhavensecretariat:item/1');
    expect(result.entity.title).toBe('Spyglass');
    expect(result.entity.sourceLabel).toBe('Card Index');
    expect(result.entity.data).toMatchObject({
      type: 'items',
      sourceId: 'gloomhavensecretariat:item/1',
      displayName: 'Spyglass',
    });
    expect(result.citations).toEqual([
      expect.objectContaining({
        sourceRef: 'source:frosthaven/cards/items',
        sourceLabel: 'Card Index',
        locator: 'gloomhavensecretariat:item/1',
      }),
    ]);
  });

  it('opens a rule passage by canonical source and chunk ref', async () => {
    const result = await openEntity('rules:frosthaven/fh-rule-book.pdf#chunk=0');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);

    expect(result.entity).toMatchObject({
      kind: 'rules_passage',
      ref: 'rules:frosthaven/fh-rule-book.pdf#chunk=0',
      sourceLabel: 'Rulebook',
    });
    expect(result.entity.data.text).toContain('Loot action');
  });

  it('returns structured not_found and invalid_ref failures', async () => {
    await expect(openEntity('section:frosthaven/9999.9')).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    await expect(openEntity('nonsense')).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_ref' },
    });
  });

  it('does not open a default-game section for an explicit unsupported game ref', async () => {
    await expect(openEntity('section:gloomhaven2/67.1')).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('does not open a default-game scenario for an explicit unsupported game ref', async () => {
    await expect(openEntity('scenario:gloomhaven2/061')).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('returns ambiguous for underspecified legacy refs', async () => {
    await expect(openEntity('61')).resolves.toMatchObject({
      ok: false,
      error: { code: 'ambiguous' },
    });
  });
});

describe('searchKnowledge', () => {
  it('searches across scopes with openable refs, metadata, citations, and next refs', async () => {
    const result: KnowledgeSearchResult = await searchKnowledge('loot action', {
      scope: ['rules_passage', 'card'],
      limit: 4,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0]).toMatchObject({
      entity: expect.objectContaining({
        kind: expect.stringMatching(/^(rules_passage|card)$/),
        ref: expect.any(String),
        sourceLabel: expect.any(String),
      }),
      score: expect.any(Number),
      snippet: expect.any(String),
      citations: expect.any(Array),
      nextRefs: expect.any(Array),
    });
  });

  it('returns an empty successful result set for no-result searches', async () => {
    const result = await searchKnowledge('zzzzzzz-no-such-token-zzzzzzz', {
      scope: ['card'],
    });
    expect(result).toMatchObject({ ok: true, results: [] });
  });

  it('searches section text and returns openable section refs', async () => {
    const result = await searchKnowledge('Moonshard answers', {
      scope: ['section'],
      limit: 3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity: expect.objectContaining({
            kind: 'section',
            ref: 'section:frosthaven/67.1',
          }),
          snippet: expect.stringContaining('Moonshard answers'),
        }),
      ]),
    );
  });

  it('rejects invalid scopes with structured errors', async () => {
    const result = await searchKnowledge('loot', {
      scope: ['bogus' as never],
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid_filter' },
    });
  });
});

describe('neighbors', () => {
  it('traverses scenario conclusion links as openable neighbors', async () => {
    const result: KnowledgeNeighborsResult = await neighbors('scenario:frosthaven/061', {
      relation: 'conclusion',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);

    expect(result.from).toMatchObject({
      kind: 'scenario',
      ref: 'scenario:frosthaven/061',
      sourceLabel: 'Scenario Book 62-81',
    });
    expect(result.neighbors).toEqual([
      expect.objectContaining({
        relation: 'conclusion',
        target: expect.objectContaining({
          kind: 'section',
          ref: 'section:frosthaven/67.1',
        }),
      }),
    ]);
  });

  it('returns structured errors for invalid refs and unsupported relations', async () => {
    await expect(neighbors('nonsense')).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_ref' },
    });
    await expect(
      neighbors('scenario:frosthaven/061', { relation: 'not_a_relation' as never }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'unsupported_relation' },
    });
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

describe('knowledge discovery tools', () => {
  it('inspectSources advertises source capabilities and live counts', async () => {
    const result = await inspectSources();

    expect(result.ok).toBe(true);
    expect(result.defaultGame).toBe('frosthaven');
    expect(result.games).toEqual([{ id: 'frosthaven', label: 'Frosthaven', default: true }]);
    expect(result.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: 'source:frosthaven/rulebook',
          kinds: ['rules_passage'],
          searchable: true,
          openable: false,
        }),
        expect.objectContaining({
          ref: 'source:frosthaven/scenario-section-books',
          kinds: ['scenario', 'section'],
          relations: ['conclusion', 'read_now', 'section_link', 'unlock', 'cross_reference'],
          counts: expect.objectContaining({
            scenario: expect.any(Number),
            section: expect.any(Number),
          }),
        }),
        expect.objectContaining({
          ref: 'source:frosthaven/cards',
          kinds: ['card_type', 'card'],
          relations: ['belongs_to_type'],
          counts: expect.objectContaining({
            items: expect.any(Number),
            'monster-stats': expect.any(Number),
            'character-abilities': expect.any(Number),
          }),
        }),
      ]),
    );
  });

  it('getSchema returns schema metadata and resolves common aliases', () => {
    expect(getSchema('scenario')).toEqual(
      expect.objectContaining({
        ok: true,
        kind: 'scenario',
        refPattern: '<scenario-ref>',
        relations: ['conclusion', 'read_now', 'section_link', 'unlock', 'cross_reference'],
      }),
    );

    expect(getSchema('rules_passage')).toEqual(
      expect.objectContaining({
        ok: true,
        kind: 'rules_passage',
      }),
    );

    expect(getSchema('item')).toEqual(
      expect.objectContaining({
        ok: true,
        kind: 'card',
        refPattern: '<source-id>',
        filterFields: expect.arrayContaining(['type', 'name', 'level', 'class', 'number']),
      }),
    );

    expect(getSchema('no-such-kind')).toEqual({
      ok: false,
      error: 'unknown_kind',
      kind: 'no-such-kind',
      hint: 'Call inspect_sources first and pass one of the returned kinds.',
    });
  });

  it('resolveEntity returns ranked opener-ready candidates for scenarios and sections', async () => {
    const scenario: EntityResolutionResult = await resolveEntity('scenario 61');
    expect(scenario.ok).toBe(true);
    expect(scenario.candidates[0]).toEqual(
      expect.objectContaining({
        confidence: 0.99,
        matchReason: 'Exact scenario number',
        entity: expect.objectContaining({
          kind: 'scenario',
          ref: 'gloomhavensecretariat:scenario/061',
          title: 'Life and Death',
        }),
      }),
    );

    const section = await resolveEntity('section 90.2', { kinds: ['section'] });
    expect(section.candidates[0]).toEqual(
      expect.objectContaining({
        confidence: 0.99,
        matchReason: 'Exact section ref',
        entity: expect.objectContaining({
          kind: 'section',
          ref: '90.2',
          title: 'Section 90.2',
        }),
      }),
    );
  });

  it('resolveEntity returns card candidates for items, monsters, and character abilities', async () => {
    const item = await resolveEntity('Spyglass', { kinds: ['card'] });
    expect(item.candidates[0]).toEqual(
      expect.objectContaining({
        confidence: expect.any(Number),
        entity: expect.objectContaining({
          kind: 'card',
          ref: 'card:frosthaven/items/gloomhavensecretariat:item/1',
          title: 'Spyglass',
        }),
      }),
    );
    expect(item.candidates[0].entity).not.toHaveProperty('data');
    await expect(openEntity(item.candidates[0].entity.ref)).resolves.toMatchObject({
      ok: true,
      entity: expect.objectContaining({
        kind: 'card',
        ref: 'card:frosthaven/items/gloomhavensecretariat:item/1',
      }),
    });

    const monster = await resolveEntity('Living Bones', { kinds: ['monster'] });
    expect(monster.candidates[0].entity).toEqual(
      expect.objectContaining({
        kind: 'card',
        ref: expect.stringMatching(/^card:frosthaven\/monster-stats\//),
        title: 'Living Bones',
      }),
    );
    expect(monster.candidates[0].entity).not.toHaveProperty('data');

    const ability = await resolveEntity('Blinkblade level 4 cards', {
      kinds: ['character-ability'],
    });
    expect(ability.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity: expect.objectContaining({
            kind: 'card',
            ref: expect.stringMatching(/^card:frosthaven\/character-abilities\//),
          }),
        }),
      ]),
    );
    expect(ability.candidates[0].entity).not.toHaveProperty('data');
  });

  it('resolveEntity accepts building aliases and returns openable building refs', async () => {
    const result = await resolveEntity('Alchemist building level 1', {
      kinds: ['building'],
    });

    expect(result.ok).toBe(true);
    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        entity: expect.objectContaining({
          kind: 'card',
          ref: 'card:frosthaven/buildings/gloomhavensecretariat:building/35/L1',
          title: 'Alchemist',
        }),
      }),
    );
    await expect(openEntity(result.candidates[0].entity.ref)).resolves.toMatchObject({
      ok: true,
      entity: expect.objectContaining({
        data: expect.objectContaining({
          level: 1,
          buildCost: {
            prosperity: 0,
            gold: 0,
            lumber: 0,
            metal: 0,
            hide: 0,
          },
        }),
      }),
    });
    await expect(
      openEntity('card:frosthaven/buildings/gloomhavensecretariat:building/35/L2'),
    ).resolves.toMatchObject({
      ok: true,
      entity: expect.objectContaining({
        data: expect.objectContaining({
          level: 2,
          buildCost: {
            prosperity: 1,
            gold: 0,
            lumber: 2,
            metal: 2,
            hide: 1,
          },
        }),
      }),
    });
  });

  it('resolveEntity validates kind filters against the discovery registry', async () => {
    await expect(resolveEntity('Spyglass', { kinds: ['nonsense'] })).resolves.toEqual({
      ok: false,
      error: 'invalid_filter',
      query: 'Spyglass',
      hint: 'Unknown kind filter: nonsense. Call inspect_sources first.',
      candidates: [],
    });
  });

  it('resolveEntity returns no card candidates for a blank query', async () => {
    await expect(resolveEntity('   ', { kinds: ['card'] })).resolves.toEqual({
      ok: true,
      query: '   ',
      candidates: [],
    });
  });
});

describe('scenario/section book tools', () => {
  it('findScenario returns no matches for a blank query', async () => {
    await expect(findScenario('   ')).resolves.toEqual([]);
  });

  it('findScenario resolves an exact scenario-number query', async () => {
    const results: ScenarioResult[] = await findScenario('scenario 61');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].scenarioIndex).toBe('61');
    expect(results[0].name).toBe('Life and Death');
    expect(results[0].ref).toBe('gloomhavensecretariat:scenario/061');
  });

  it('findScenarios sorts exact-name matches by numeric scenario index', async () => {
    const { db } = getDb();
    const refs = ['test:sort-probe/061', 'test:sort-probe/100', 'test:sort-probe/4A'];
    await db.insert(scenarioBookScenarios).values([
      {
        game: 'frosthaven',
        ref: refs[0],
        scenarioGroup: 'main',
        scenarioIndex: '61',
        name: 'Sort Probe',
        complexity: null,
        flowChartGroup: null,
        initial: false,
        sourcePdf: null,
        sourcePage: null,
        rawText: null,
        metadata: {},
      },
      {
        game: 'frosthaven',
        ref: refs[1],
        scenarioGroup: 'main',
        scenarioIndex: '100',
        name: 'Sort Probe',
        complexity: null,
        flowChartGroup: null,
        initial: false,
        sourcePdf: null,
        sourcePage: null,
        rawText: null,
        metadata: {},
      },
      {
        game: 'frosthaven',
        ref: refs[2],
        scenarioGroup: 'main',
        scenarioIndex: '4A',
        name: 'Sort Probe',
        complexity: null,
        flowChartGroup: null,
        initial: false,
        sourcePdf: null,
        sourcePage: null,
        rawText: null,
        metadata: {},
      },
    ]);

    try {
      const results = await findScenarios('Sort Probe', 20);
      const interesting = results
        .filter((result) => refs.includes(result.ref))
        .map((result) => result.scenarioIndex);

      expect(interesting).toEqual(['61', '100', '4A']);
    } finally {
      await db.execute(sql`DELETE FROM scenario_book_scenarios WHERE ref LIKE 'test:sort-probe/%'`);
    }
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
    expect(section!.text).toContain('Your ears fill with the sound of your own breathing');
    expect(section!.text).toContain('Moonshard answers.');
    expect(section!.text).toContain('the seals grow weak.');
    expect(section!.text).not.toContain('ownbreathing');
    expect(section!.text).not.toContain('Moonshardanswers');
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

  it('follows unlock links recovered from repaired section prose like 66.2', async () => {
    const links = await followLinks('section', '66.2', 'unlock');
    expect(links).toEqual([
      expect.objectContaining({
        fromKind: 'section',
        fromRef: '66.2',
        toKind: 'scenario',
        toRef: 'gloomhavensecretariat:scenario/116',
        linkType: 'unlock',
      }),
    ]);
  });

  it('resolves incoming unlock links for a scenario through neighbors', async () => {
    const result = await neighbors('scenario:frosthaven/061', { relation: 'unlock' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);

    expect(result.neighbors).toEqual([
      expect.objectContaining({
        relation: 'unlock',
        target: expect.objectContaining({
          kind: 'section',
          ref: 'section:frosthaven/79.4',
        }),
      }),
    ]);
  });

  it('includes incoming section links when listing scenario neighbors', async () => {
    const result = await neighbors('scenario:frosthaven/061');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);

    expect(result.neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: 'section_link',
          target: expect.objectContaining({
            kind: 'section',
            ref: 'section:frosthaven/105.1',
          }),
        }),
        expect.objectContaining({
          relation: 'section_link',
          target: expect.objectContaining({
            kind: 'section',
            ref: 'section:frosthaven/82.2',
          }),
        }),
        expect.objectContaining({
          relation: 'section_link',
          target: expect.objectContaining({
            kind: 'section',
            ref: 'section:frosthaven/97.3',
          }),
        }),
      ]),
    );
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
