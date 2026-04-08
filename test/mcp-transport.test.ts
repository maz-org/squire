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

vi.mock('../src/service.ts', () => ({
  initialize: vi.fn(),
  isReady: vi.fn(() => true),
  ask: vi.fn(),
}));

vi.mock('../src/db.ts', () => ({
  getDb: () => ({
    db: {
      execute: vi.fn().mockResolvedValue({ rows: [{ count: '1' }] }),
    },
    close: async () => {},
  }),
  shutdownServerPool: vi.fn().mockResolvedValue(undefined),
}));

// Bypass the Drizzle-backed auth provider — this file exercises the MCP
// transport, not OAuth semantics, so we stub `verifyAccessToken` to accept
// any bearer header. The real OAuth flow is covered by
// `test/server-oauth.test.ts` against the test DB. Stubbing here keeps the
// transport tests hermetic from Postgres.
vi.mock('../src/auth.ts', () => ({
  registerClient: vi.fn(),
  createAuthorizationCode: vi.fn(),
  exchangeAuthorizationCode: vi.fn(),
  verifyAccessToken: vi.fn().mockResolvedValue({
    token: 'stub',
    clientId: 'stub-client',
    scopes: [],
  }),
  getAuthProvider: vi.fn(),
  resetAuthProvider: vi.fn(),
  OAuthError: class OAuthError extends Error {},
}));

import { app } from '../src/server.ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Helper to create an MCP client connected via HTTP to the Hono app
async function createHttpClient(): Promise<Client> {
  const token = 'stub-token';
  const client = new Client({ name: 'test-client', version: '1.0' });
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
    fetch: async (url, init) => {
      const headers = new Headers((init as RequestInit)?.headers);
      headers.set('Authorization', `Bearer ${token}`);
      return app.request(url as string, { ...init, headers } as RequestInit);
    },
  });
  await client.connect(transport);
  return client;
}

describe('MCP over Streamable HTTP', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListCardTypes.mockReturnValue([
      { type: 'monster-stats', count: 10 },
      { type: 'items', count: 5 },
    ]);
    mockSearchRules.mockResolvedValue([
      { text: 'Loot: pick up tokens.', source: 'rulebook.pdf:42', score: 0.9 },
    ]);
    mockGetCard.mockReturnValue({ name: 'Algox Archer' });
  });

  it('lists tools via HTTP transport', async () => {
    const client = await createHttpClient();
    const { tools } = await client.listTools();
    expect(tools.length).toBe(5);
    const names = tools.map((t) => t.name);
    expect(names).toContain('search_rules');
    expect(names).toContain('list_card_types');
    await client.close();
  });

  it('calls a tool via HTTP transport', async () => {
    const client = await createHttpClient();
    const result = await client.callTool({ name: 'list_card_types', arguments: {} });
    expect(mockListCardTypes).toHaveBeenCalled();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('monster-stats');
    await client.close();
  });

  it('rejects invalid JSON-RPC with 4xx', async () => {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ not: 'jsonrpc' }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
