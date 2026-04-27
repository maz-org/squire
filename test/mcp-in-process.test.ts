import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSearchRules,
  mockSearchCards,
  mockListCardTypes,
  mockListCards,
  mockGetCard,
  mockInspectSources,
  mockGetSchema,
  mockResolveEntity,
  mockFindScenario,
  mockGetScenario,
  mockGetSection,
  mockFollowLinks,
} = vi.hoisted(() => ({
  mockSearchRules: vi.fn(),
  mockSearchCards: vi.fn(),
  mockListCardTypes: vi.fn(),
  mockListCards: vi.fn(),
  mockGetCard: vi.fn(),
  mockInspectSources: vi.fn(),
  mockGetSchema: vi.fn(),
  mockResolveEntity: vi.fn(),
  mockFindScenario: vi.fn(),
  mockGetScenario: vi.fn(),
  mockGetSection: vi.fn(),
  mockFollowLinks: vi.fn(),
}));

vi.mock('../src/tools.ts', () => ({
  searchRules: mockSearchRules,
  searchCards: mockSearchCards,
  listCardTypes: mockListCardTypes,
  listCards: mockListCards,
  getCard: mockGetCard,
  inspectSources: mockInspectSources,
  getSchema: mockGetSchema,
  resolveEntity: mockResolveEntity,
  findScenario: mockFindScenario,
  getScenario: mockGetScenario,
  getSection: mockGetSection,
  followLinks: mockFollowLinks,
}));

import { createInProcessClient } from '../src/mcp.ts';

describe('in-process MCP client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListCardTypes.mockReturnValue([
      { type: 'monster-stats', count: 10 },
      { type: 'items', count: 5 },
    ]);
    mockSearchRules.mockResolvedValue([
      { text: 'Loot: pick up tokens.', source: 'rulebook.pdf:42', score: 0.9 },
    ]);
    mockInspectSources.mockResolvedValue({
      ok: true,
      sources: [],
      games: [],
      defaultGame: 'frosthaven',
    });
    mockGetSchema.mockReturnValue({ ok: true, kind: 'card', fields: [] });
    mockResolveEntity.mockResolvedValue({ ok: true, query: 'Spyglass', candidates: [] });
    mockGetCard.mockReturnValue({ name: 'Algox Archer' });
  });

  it('creates a connected MCP client', async () => {
    const client = await createInProcessClient();
    expect(client).toBeDefined();
    await client.close();
  });

  it('lists tools via in-process transport', async () => {
    const client = await createInProcessClient();
    const { tools } = await client.listTools();
    expect(tools.length).toBe(12);
    const names = tools.map((t) => t.name);
    expect(names).toContain('inspect_sources');
    expect(names).toContain('schema');
    expect(names).toContain('resolve_entity');
    expect(names).toContain('search_rules');
    expect(names).toContain('find_scenario');
    expect(names).toContain('get_scenario');
    expect(names).toContain('get_section');
    expect(names).toContain('follow_links');
    expect(names).toContain('list_card_types');
    expect(names).toContain('get_card');
    await client.close();
  });

  it('calls a tool via in-process transport', async () => {
    const client = await createInProcessClient();
    const result = await client.callTool({ name: 'list_card_types', arguments: {} });
    expect(mockListCardTypes).toHaveBeenCalled();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('monster-stats');
    await client.close();
  });

  it('can call search_rules', async () => {
    const client = await createInProcessClient();
    await client.callTool({ name: 'search_rules', arguments: { query: 'loot' } });
    expect(mockSearchRules).toHaveBeenCalledWith('loot', 6);
    await client.close();
  });

  it('each call creates an independent client', async () => {
    const client1 = await createInProcessClient();
    const client2 = await createInProcessClient();
    expect(client1).not.toBe(client2);
    await client1.close();
    await client2.close();
  });
});
