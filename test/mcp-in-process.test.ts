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

import { createInProcessClient } from '../src/mcp.ts';

describe('in-process MCP client', () => {
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
    mockSearchKnowledge.mockResolvedValue({ ok: true, query: 'loot', results: [] });
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

  it('creates a connected MCP client', async () => {
    const client = await createInProcessClient();
    expect(client).toBeDefined();
    await client.close();
  });

  it('lists redesigned tools via in-process transport', async () => {
    const client = await createInProcessClient();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      'inspect_sources',
      'schema',
      'resolve_entity',
      'lookup_entity',
      'open_entity',
      'search_knowledge',
      'neighbors',
      'write_campaign_state',
      'write_character_state',
      'propose_state_change',
      'confirm_state_change',
      'cancel_state_change',
      'create_campaign',
      'create_character',
      'invite_member',
    ]);
    await client.close();
  });

  it('calls a redesigned tool via in-process transport', async () => {
    const client = await createInProcessClient();
    const result = await client.callTool({
      name: 'search_knowledge',
      arguments: { query: 'loot' },
    });
    expect(mockSearchKnowledge).toHaveBeenCalledWith('loot', {
      scope: undefined,
      limit: 6,
    });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('loot');
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
