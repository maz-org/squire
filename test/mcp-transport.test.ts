import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockSearchKnowledge,
  mockOpenEntity,
  mockLookupEntity,
  mockInspectSources,
  mockGetSchema,
  mockResolveEntity,
  mockNeighbors,
  mockVerifyAccessToken,
} = vi.hoisted(() => ({
  mockSearchKnowledge: vi.fn(),
  mockOpenEntity: vi.fn(),
  mockLookupEntity: vi.fn(),
  mockInspectSources: vi.fn(),
  mockGetSchema: vi.fn(),
  mockResolveEntity: vi.fn(),
  mockNeighbors: vi.fn(),
  mockVerifyAccessToken: vi.fn(),
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
  verifyAccessToken: mockVerifyAccessToken,
  getAuthProvider: vi.fn(),
  resetAuthProvider: vi.fn(),
  OAuthError: class OAuthError extends Error {},
}));

import { app } from '../src/server.ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  hashRateLimitIdentity,
  MCP_REQUEST_RATE_LIMIT_POLICY,
  resetRateLimiterForTesting,
  setRateLimiterForTesting,
  type RateLimiter,
  type RateLimitConsumeInput,
  type RateLimitDecision,
} from '../src/rate-limit.ts';

function authInfoForToken(token: string) {
  return {
    token,
    clientId: token === 'other-token' ? 'other-client' : 'stub-client',
    scopes: [],
    // Match SquireOAuthProvider.verifyAccessToken shape: `expiresAt` is
    // unix seconds (not a Date). CodeRabbit nitpick on PR #196.
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
}

function installOneRequestLimiter() {
  const counts = new Map<string, number>();
  const identities: string[] = [];

  const limiter = {
    async consume(input: RateLimitConsumeInput): Promise<RateLimitDecision> {
      identities.push(input.identity);
      const used = (counts.get(input.identity) ?? 0) + 1;
      counts.set(input.identity, used);
      const allowed = used <= 1;
      return {
        allowed,
        policy: input.policy,
        identityHash: hashRateLimitIdentity(input.identity, 'mcp-rate-limit-test-secret'),
        remaining: allowed ? 0 : 0,
        retryAfterSeconds: allowed ? 0 : 30,
        resetAfterSeconds: 30,
      };
    },
  };

  setRateLimiterForTesting(limiter as unknown as RateLimiter);
  return { identities };
}

function mcpPost(headers: Record<string, string> = {}) {
  return app.request('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({ not: 'jsonrpc' }),
  });
}

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
    mockVerifyAccessToken.mockImplementation(async (token: string) => authInfoForToken(token));
    mockInspectSources.mockResolvedValue({
      ok: true,
      sources: [],
      games: [],
      defaultGame: 'frosthaven',
    });
    mockGetSchema.mockReturnValue({ ok: true, kind: 'card', fields: [] });
    mockResolveEntity.mockResolvedValue({ ok: true, query: 'Spyglass', candidates: [] });
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

  afterEach(() => {
    resetRateLimiterForTesting();
  });

  it('lists tools via HTTP transport', async () => {
    const client = await createHttpClient();
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
    await client.close();
  });

  it('calls a tool via HTTP transport', async () => {
    const client = await createHttpClient();
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

  it('rejects invalid JSON-RPC with 4xx', async () => {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ not: 'jsonrpc' }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('rate limits authenticated MCP requests by OAuth client before opening transport', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const limiter = installOneRequestLimiter();

    try {
      const allowed = await mcpPost({ Authorization: 'Bearer stub-token' });
      expect(allowed.status).not.toBe(429);

      const limited = await mcpPost({ Authorization: 'Bearer stub-token' });
      expect(limited.status).toBe(429);
      expect(limited.headers.get('retry-after')).toBe('30');
      await expect(limited.json()).resolves.toMatchObject({
        error: 'rate_limited',
        retry_after_seconds: 30,
      });

      expect(limiter.identities).toEqual(['client:stub-client', 'client:stub-client']);

      const logLine = warn.mock.calls
        .map((call) => String(call[0]))
        .find((line) => {
          return line.includes('"event":"rate_limit_rejected"');
        });
      expect(logLine).toBeTruthy();
      expect(logLine).not.toContain('stub-client');

      const event = JSON.parse(logLine!);
      expect(event).toMatchObject({
        level: 'warn',
        event: 'rate_limit_rejected',
        route: '/mcp',
        method: 'POST',
        policy: MCP_REQUEST_RATE_LIMIT_POLICY.name,
        limit: MCP_REQUEST_RATE_LIMIT_POLICY.limit,
        window_ms: MCP_REQUEST_RATE_LIMIT_POLICY.windowMs,
        identity_kind: 'client',
        retry_after_seconds: 30,
      });
      expect(event.identity_hash).toMatch(/^[A-Za-z0-9_-]{32}$/);
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps independent MCP buckets for different OAuth clients', async () => {
    installOneRequestLimiter();

    const allowed = await mcpPost({ Authorization: 'Bearer stub-token' });
    expect(allowed.status).not.toBe(429);

    const limited = await mcpPost({ Authorization: 'Bearer stub-token' });
    expect(limited.status).toBe(429);

    const otherClient = await mcpPost({ Authorization: 'Bearer other-token' });
    expect(otherClient.status).not.toBe(429);
  });

  it('prefers authenticated user identity over OAuth client identity when present', async () => {
    mockVerifyAccessToken.mockResolvedValue({
      token: 'user-token',
      clientId: 'stub-client',
      scopes: [],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      extra: { userId: '11111111-1111-4111-8111-111111111111' },
    });
    const limiter = installOneRequestLimiter();

    const res = await mcpPost({ Authorization: 'Bearer user-token' });
    expect(res.status).not.toBe(429);
    expect(limiter.identities).toEqual(['user:11111111-1111-4111-8111-111111111111']);
  });

  it('rate limits unauthenticated MCP requests by trusted client IP fallback', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const limiter = installOneRequestLimiter();

    try {
      const allowed = await mcpPost({ 'X-Forwarded-For': '198.51.100.70' });
      expect(allowed.status).toBe(401);

      const limited = await mcpPost({ 'X-Forwarded-For': '198.51.100.70' });
      expect(limited.status).toBe(429);

      expect(limiter.identities).toEqual(['ip:198.51.100.70', 'ip:198.51.100.70']);

      const logLine = warn.mock.calls
        .map((call) => String(call[0]))
        .find((line) => {
          return line.includes('"event":"rate_limit_rejected"');
        });
      expect(logLine).toBeTruthy();
      expect(logLine).not.toContain('198.51.100.70');
      expect(JSON.parse(logLine!)).toMatchObject({
        route: '/mcp',
        identity_kind: 'ip',
      });
    } finally {
      warn.mockRestore();
    }
  });
});
