import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSearchRules, mockSearchCards, mockListCardTypes, mockListCards, mockGetCard } =
  vi.hoisted(() => ({
    mockSearchRules: vi.fn(),
    mockSearchCards: vi.fn(),
    mockListCardTypes: vi.fn(),
    mockListCards: vi.fn(),
    mockGetCard: vi.fn(),
  }));

vi.mock('../src/tools.ts', () => ({
  searchRules: mockSearchRules,
  searchCards: mockSearchCards,
  listCardTypes: mockListCardTypes,
  listCards: mockListCards,
  getCard: mockGetCard,
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
  it('registers all 5 tools', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('search_rules');
    expect(names).toContain('search_cards');
    expect(names).toContain('list_card_types');
    expect(names).toContain('list_cards');
    expect(names).toContain('get_card');
    expect(tools).toHaveLength(5);
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
