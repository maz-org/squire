import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSearchKnowledge,
  mockOpenEntity,
  mockLookupEntity,
  mockInspectSources,
  mockGetSchema,
  mockResolveEntity,
  mockNeighbors,
} = vi.hoisted(() => ({
  mockSearchKnowledge: vi.fn(),
  mockOpenEntity: vi.fn(),
  mockLookupEntity: vi.fn(),
  mockInspectSources: vi.fn(),
  mockGetSchema: vi.fn(),
  mockResolveEntity: vi.fn(),
  mockNeighbors: vi.fn(),
}));

vi.mock('../src/tools.ts', () => ({
  searchKnowledge: mockSearchKnowledge,
  openEntity: mockOpenEntity,
  lookupEntity: mockLookupEntity,
  inspectSources: mockInspectSources,
  getSchema: mockGetSchema,
  resolveEntity: mockResolveEntity,
  neighbors: mockNeighbors,
}));

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp.ts';

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

describe('MCP redesigned tool registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInspectSources.mockResolvedValue({
      ok: true,
      sources: [],
      games: [],
      defaultGame: 'frosthaven',
    });
    mockGetSchema.mockReturnValue({ ok: true, kind: 'card', fields: [] });
    mockResolveEntity.mockResolvedValue({ ok: true, query: 'Spyglass', candidates: [] });
    mockLookupEntity.mockResolvedValue({
      ok: true,
      entity: {
        kind: 'card',
        ref: 'card:frosthaven/items/gloomhavensecretariat:item/1',
        title: 'Spyglass',
        sourceLabel: 'Card Index',
        data: {},
      },
      citations: [],
      links: [],
      related: [],
    });
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

  it('registers redesigned knowledge tools only', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toEqual([
      'inspect_sources',
      'schema',
      'resolve_entity',
      'lookup_entity',
      'open_entity',
      'search_knowledge',
      'neighbors',
    ]);
    expect(names).not.toContain('search_rules');
    expect(names).not.toContain('search_cards');
    expect(names).not.toContain('list_card_types');
    expect(names).not.toContain('list_cards');
    expect(names).not.toContain('get_card');
    expect(names).not.toContain('find_scenario');
    expect(names).not.toContain('get_scenario');
    expect(names).not.toContain('get_section');
    expect(names).not.toContain('follow_links');
  });

  it('wires discovery tools through to handlers', async () => {
    const client = await connectClient();

    await expect(
      client.callTool({ name: 'inspect_sources', arguments: {} }),
    ).resolves.toBeDefined();
    expect(mockInspectSources).toHaveBeenCalledWith();

    await expect(
      client.callTool({ name: 'inspect_sources', arguments: { game: 'gh2' } }),
    ).resolves.toBeDefined();
    expect(mockInspectSources).toHaveBeenLastCalledWith({ game: 'gh2' });

    await expect(
      client.callTool({ name: 'schema', arguments: { kind: 'item' } }),
    ).resolves.toBeDefined();
    expect(mockGetSchema).toHaveBeenCalledWith('item');

    await expect(
      client.callTool({
        name: 'resolve_entity',
        arguments: { query: 'Spyglass', kinds: ['card'], limit: 3, game: 'gh2' },
      }),
    ).resolves.toBeDefined();
    expect(mockResolveEntity).toHaveBeenCalledWith('Spyglass', {
      kinds: ['card'],
      limit: 3,
      game: 'gh2',
    });

    await expect(
      client.callTool({
        name: 'lookup_entity',
        arguments: { query: 'item 1', kinds: ['item'], limit: 2, game: 'gh2' },
      }),
    ).resolves.toBeDefined();
    expect(mockLookupEntity).toHaveBeenCalledWith('item 1', {
      kinds: ['item'],
      limit: 2,
      game: 'gh2',
    });
  });

  it('wires canonical search, open, and traversal tools through to handlers', async () => {
    const client = await connectClient();

    await expect(
      client.callTool({
        name: 'open_entity',
        arguments: { ref: 'section:frosthaven/67.1', game: 'gh2' },
      }),
    ).resolves.toBeDefined();
    expect(mockOpenEntity).toHaveBeenCalledWith('section:frosthaven/67.1', { game: 'gh2' });

    const searchResult = await client.callTool({
      name: 'search_knowledge',
      arguments: { query: 'loot', limit: 3, game: 'gh2' },
    });
    expect(mockSearchKnowledge).toHaveBeenCalledWith('loot', {
      scope: undefined,
      limit: 3,
      game: 'gh2',
    });
    expect(getTextContent(searchResult)[0].text).toContain('loot');

    await expect(
      client.callTool({
        name: 'neighbors',
        arguments: { ref: 'scenario:frosthaven/061', relation: 'conclusion', game: 'gh2' },
      }),
    ).resolves.toBeDefined();
    expect(mockNeighbors).toHaveBeenCalledWith('scenario:frosthaven/061', {
      relation: 'conclusion',
      limit: 20,
      game: 'gh2',
    });
  });
});
