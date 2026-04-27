import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSearchRules,
  mockSearchCards,
  mockSearchKnowledge,
  mockListCardTypes,
  mockListCards,
  mockGetCard,
  mockOpenEntity,
  mockInspectSources,
  mockGetSchema,
  mockResolveEntity,
  mockFindScenario,
  mockGetScenario,
  mockGetSection,
  mockFollowLinks,
  mockNeighbors,
} = vi.hoisted(() => ({
  mockSearchRules: vi.fn(),
  mockSearchCards: vi.fn(),
  mockSearchKnowledge: vi.fn(),
  mockListCardTypes: vi.fn(),
  mockListCards: vi.fn(),
  mockGetCard: vi.fn(),
  mockOpenEntity: vi.fn(),
  mockInspectSources: vi.fn(),
  mockGetSchema: vi.fn(),
  mockResolveEntity: vi.fn(),
  mockFindScenario: vi.fn(),
  mockGetScenario: vi.fn(),
  mockGetSection: vi.fn(),
  mockFollowLinks: vi.fn(),
  mockNeighbors: vi.fn(),
}));

vi.mock('../src/tools.ts', () => ({
  searchRules: mockSearchRules,
  searchCards: mockSearchCards,
  searchKnowledge: mockSearchKnowledge,
  listCardTypes: mockListCardTypes,
  listCards: mockListCards,
  getCard: mockGetCard,
  openEntity: mockOpenEntity,
  inspectSources: mockInspectSources,
  getSchema: mockGetSchema,
  resolveEntity: mockResolveEntity,
  findScenario: mockFindScenario,
  getScenario: mockGetScenario,
  getSection: mockGetSection,
  followLinks: mockFollowLinks,
  neighbors: mockNeighbors,
}));

import { createMcpServer } from '../src/mcp.ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

interface TextContent {
  type: 'text';
  text: string;
}

function getTextContent(result: Awaited<ReturnType<Client['callTool']>>): TextContent[] {
  return result.content as TextContent[];
}

async function connectClient() {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe('MCP tool registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindScenario.mockResolvedValue([
      {
        ref: 'gloomhavensecretariat:scenario/061',
        scenarioGroup: 'main',
        scenarioIndex: '61',
        name: 'Life and Death',
        complexity: 2,
        flowChartGroup: null,
        initial: false,
        sourcePdf: 'fh-scenario-book-42-61.pdf',
        sourcePage: 0,
        rawText: 'Scenario 61',
        metadata: {},
      },
    ]);
    mockGetScenario.mockResolvedValue({
      ref: 'gloomhavensecretariat:scenario/061',
      scenarioGroup: 'main',
      scenarioIndex: '61',
      name: 'Life and Death',
      complexity: 2,
      flowChartGroup: null,
      initial: false,
      sourcePdf: 'fh-scenario-book-42-61.pdf',
      sourcePage: 0,
      rawText: 'Scenario 61',
      metadata: {},
    });
    mockGetSection.mockResolvedValue({
      ref: '67.1',
      title: 'Conclusion',
      body: 'Section text',
      sourcePdf: 'fh-section-book-62-81.pdf',
      sourcePage: 0,
      rawText: 'Section text',
      metadata: {},
    });
    mockFollowLinks.mockResolvedValue([
      {
        fromKind: 'scenario',
        fromRef: 'gloomhavensecretariat:scenario/061',
        toKind: 'section',
        toRef: '67.1',
        linkType: 'conclusion',
        label: 'Read Section 67.1',
        context: null,
        metadata: {},
      },
    ]);
    mockInspectSources.mockResolvedValue({
      ok: true,
      sources: [],
      games: [],
      defaultGame: 'frosthaven',
    });
    mockGetSchema.mockReturnValue({ ok: true, kind: 'card', fields: [] });
    mockResolveEntity.mockResolvedValue({ ok: true, query: 'Spyglass', candidates: [] });
    mockOpenEntity.mockResolvedValue({
      ok: true,
      entity: {
        kind: 'section',
        ref: 'section:frosthaven/67.1',
        title: 'Section 67.1',
        sourceLabel: 'Section Book',
        data: {},
      },
      citations: [],
      links: [],
      related: [],
    });
    mockSearchKnowledge.mockResolvedValue({ ok: true, query: 'loot', results: [] });
    mockNeighbors.mockResolvedValue({
      ok: true,
      from: {
        kind: 'scenario',
        ref: 'scenario:frosthaven/061',
        title: 'Life and Death',
        sourceLabel: 'Scenario Book',
      },
      neighbors: [],
    });
  });

  it('registers old tools, discovery tools, and canonical knowledge tools', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('inspect_sources');
    expect(names).toContain('schema');
    expect(names).toContain('resolve_entity');
    expect(names).toContain('search_rules');
    expect(names).toContain('find_scenario');
    expect(names).toContain('get_scenario');
    expect(names).toContain('get_section');
    expect(names).toContain('follow_links');
    expect(names).toContain('open_entity');
    expect(names).toContain('search_knowledge');
    expect(names).toContain('neighbors');
    expect(names).toContain('search_cards');
    expect(names).toContain('list_card_types');
    expect(names).toContain('list_cards');
    expect(names).toContain('get_card');
    expect(tools).toHaveLength(15);
  });

  it('wires the discovery tools through to handlers', async () => {
    const client = await connectClient();

    await expect(
      client.callTool({ name: 'inspect_sources', arguments: {} }),
    ).resolves.toBeDefined();
    expect(mockInspectSources).toHaveBeenCalledWith();

    await expect(
      client.callTool({ name: 'schema', arguments: { kind: 'item' } }),
    ).resolves.toBeDefined();
    expect(mockGetSchema).toHaveBeenCalledWith('item');

    await expect(
      client.callTool({
        name: 'resolve_entity',
        arguments: { query: 'Spyglass', kinds: ['card'], limit: 3 },
      }),
    ).resolves.toBeDefined();
    expect(mockResolveEntity).toHaveBeenCalledWith('Spyglass', {
      kinds: ['card'],
      limit: 3,
    });
  });

  it('wires the traversal tools through to handlers', async () => {
    const client = await connectClient();

    await expect(
      client.callTool({ name: 'find_scenario', arguments: { query: 'scenario 61' } }),
    ).resolves.toBeDefined();
    expect(mockFindScenario).toHaveBeenCalledWith('scenario 61');

    await expect(
      client.callTool({
        name: 'get_scenario',
        arguments: { ref: 'gloomhavensecretariat:scenario/061' },
      }),
    ).resolves.toBeDefined();
    expect(mockGetScenario).toHaveBeenCalledWith('gloomhavensecretariat:scenario/061');

    await expect(
      client.callTool({ name: 'get_section', arguments: { ref: '67.1' } }),
    ).resolves.toBeDefined();
    expect(mockGetSection).toHaveBeenCalledWith('67.1');

    await expect(
      client.callTool({
        name: 'follow_links',
        arguments: { fromKind: 'scenario', fromRef: 'gloomhavensecretariat:scenario/061' },
      }),
    ).resolves.toBeDefined();
    expect(mockFollowLinks).toHaveBeenCalledWith(
      'scenario',
      'gloomhavensecretariat:scenario/061',
      undefined,
    );

    await expect(
      client.callTool({ name: 'open_entity', arguments: { ref: 'section:frosthaven/67.1' } }),
    ).resolves.toBeDefined();
    expect(mockOpenEntity).toHaveBeenCalledWith('section:frosthaven/67.1');

    await expect(
      client.callTool({ name: 'search_knowledge', arguments: { query: 'loot', limit: 3 } }),
    ).resolves.toBeDefined();
    expect(mockSearchKnowledge).toHaveBeenCalledWith('loot', {
      scope: undefined,
      limit: 3,
    });

    await expect(
      client.callTool({
        name: 'neighbors',
        arguments: { ref: 'scenario:frosthaven/061', relation: 'conclusion' },
      }),
    ).resolves.toBeDefined();
    expect(mockNeighbors).toHaveBeenCalledWith('scenario:frosthaven/061', {
      relation: 'conclusion',
      limit: 20,
    });
  });
});

describe('search_rules tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchRules.mockResolvedValue([
      { text: 'Loot: pick up tokens.', source: 'rulebook.pdf:42', score: 0.9 },
    ]);
  });

  it('calls searchRules and returns results', async () => {
    const client = await connectClient();
    const result = await client.callTool({ name: 'search_rules', arguments: { query: 'loot' } });
    expect(mockSearchRules).toHaveBeenCalledWith('loot', 6);
    const content = getTextContent(result);
    expect(content).toHaveLength(1);
    expect(content[0].text).toContain('Loot');
  });

  it('respects topK parameter', async () => {
    const client = await connectClient();
    await client.callTool({ name: 'search_rules', arguments: { query: 'loot', topK: 3 } });
    expect(mockSearchRules).toHaveBeenCalledWith('loot', 3);
  });
});

describe('search_cards tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchCards.mockReturnValue([
      { type: 'monster-stats', data: { name: 'Algox Archer' }, score: 2 },
    ]);
  });

  it('calls searchCards and returns results', async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: 'search_cards',
      arguments: { query: 'algox archer' },
    });
    expect(mockSearchCards).toHaveBeenCalledWith('algox archer', 6);
    const content = getTextContent(result);
    expect(content).toHaveLength(1);
    expect(content[0].text).toContain('Algox Archer');
  });
});

describe('list_card_types tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListCardTypes.mockReturnValue([
      { type: 'monster-stats', count: 10 },
      { type: 'items', count: 5 },
    ]);
  });

  it('returns card types', async () => {
    const client = await connectClient();
    const result = await client.callTool({ name: 'list_card_types', arguments: {} });
    expect(mockListCardTypes).toHaveBeenCalled();
    const content = getTextContent(result);
    expect(content).toHaveLength(1);
    const text = content[0].text;
    expect(text).toContain('monster-stats');
    expect(text).toContain('items');
  });
});

describe('list_cards tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListCards.mockReturnValue([{ name: 'Algox Archer' }]);
  });

  it('calls listCards with type', async () => {
    const client = await connectClient();
    await client.callTool({
      name: 'list_cards',
      arguments: { type: 'monster-stats' },
    });
    expect(mockListCards).toHaveBeenCalledWith('monster-stats', undefined);
  });

  it('passes filter when provided', async () => {
    const client = await connectClient();
    await client.callTool({
      name: 'list_cards',
      arguments: { type: 'monster-stats', filter: '{"name":"Algox Archer"}' },
    });
    expect(mockListCards).toHaveBeenCalledWith('monster-stats', { name: 'Algox Archer' });
  });
});

describe('get_card tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCard.mockReturnValue({ name: 'Algox Archer', levelRange: '0-3' });
  });

  it('returns a card', async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: 'get_card',
      arguments: { type: 'monster-stats', id: 'Algox Archer' },
    });
    expect(mockGetCard).toHaveBeenCalledWith('monster-stats', 'Algox Archer');
    const content = getTextContent(result);
    expect(content).toHaveLength(1);
    expect(content[0].text).toContain('Algox Archer');
  });

  it('returns error when card not found', async () => {
    mockGetCard.mockReturnValue(null);
    const client = await connectClient();
    const result = await client.callTool({
      name: 'get_card',
      arguments: { type: 'monster-stats', id: 'Nonexistent' },
    });
    expect(result.isError).toBe(true);
  });
});
