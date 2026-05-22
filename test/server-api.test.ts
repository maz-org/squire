/**
 * HTTP tests for content/search endpoints on `src/server.ts`.
 *
 * This file covers the non-OAuth surface: `/api/health`, `/api/search/*`,
 * `/api/card-types`, `/api/cards`, `/api/cards/:type/:id`, `/api/ask`
 * (including the SSE stream), and the shared error-handling shape.
 *
 * OAuth endpoints (`/.well-known/*`, `/register`, `/authorize`, `/token`,
 * bearer middleware) live in `test/server-oauth.test.ts`. The split keeps
 * each file small enough to be worked on in parallel without merge
 * conflicts, and lets CI reports point at the right owner.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { parseSSE } from './helpers/server-oauth-helpers.ts';
import { LlmBudgetExceededError } from '../src/llm-budget.ts';

function makeStatus(
  overrides: Partial<{
    lifecycle: string;
    ready: boolean;
    bootstrapReady: boolean;
    warmingUp: boolean;
    indexSize: number;
    cardCount: number;
    ruleQueriesReady: boolean;
    cardQueriesReady: boolean;
    askReady: boolean;
    missingBootstrapSteps: string[];
    errors: string[];
    capabilities: {
      rules: { allowed: boolean; reason: string | null; message: string | null };
      cards: { allowed: boolean; reason: string | null; message: string | null };
      ask: { allowed: boolean; reason: string | null; message: string | null };
    };
  }> = {},
) {
  return {
    lifecycle: 'ready',
    ready: true,
    bootstrapReady: true,
    warmingUp: false,
    indexSize: 3,
    cardCount: 15,
    ruleQueriesReady: true,
    cardQueriesReady: true,
    askReady: true,
    missingBootstrapSteps: [],
    errors: [],
    capabilities: {
      rules: { allowed: true, reason: null, message: null },
      cards: { allowed: true, reason: null, message: null },
      ask: { allowed: true, reason: null, message: null },
    },
    ...overrides,
  };
}

const {
  mockInitialize,
  mockEnsureBootstrapStatus,
  mockGetBootstrapStatus,
  mockIsReady,
  mockRefreshInitializationIfReady,
  mockAsk,
  mockEnsureAskBudgetAvailable,
  mockSearchRules,
  mockSearchCards,
  mockListCardTypes,
  mockListCards,
  mockGetCard,
  mockRunReadinessChecks,
} = vi.hoisted(() => ({
  mockInitialize: vi.fn(),
  mockEnsureBootstrapStatus: vi.fn(),
  mockGetBootstrapStatus: vi.fn(),
  mockIsReady: vi.fn(),
  mockRefreshInitializationIfReady: vi.fn(),
  mockAsk: vi.fn(),
  mockEnsureAskBudgetAvailable: vi.fn(),
  mockSearchRules: vi.fn(),
  mockSearchCards: vi.fn(),
  mockListCardTypes: vi.fn(),
  mockListCards: vi.fn(),
  mockGetCard: vi.fn(),
  mockRunReadinessChecks: vi.fn(),
}));

vi.mock('../src/service.ts', () => ({
  initialize: mockInitialize,
  ensureBootstrapStatus: mockEnsureBootstrapStatus,
  getBootstrapStatus: mockGetBootstrapStatus,
  isReady: mockIsReady,
  refreshInitializationIfReady: mockRefreshInitializationIfReady,
  ask: mockAsk,
  ensureAskBudgetAvailable: mockEnsureAskBudgetAvailable,
}));
vi.mock('../src/db.ts', () => ({
  getWorktreeRuntime: vi.fn(),
  shutdownServerPool: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/tools.ts', () => ({
  searchRules: mockSearchRules,
  searchCards: mockSearchCards,
  listCardTypes: mockListCardTypes,
  listCards: mockListCards,
  getCard: mockGetCard,
}));

vi.mock('../src/health.ts', () => ({
  runReadinessChecks: mockRunReadinessChecks,
}));

// Bypass the Drizzle-backed auth provider — these tests don't exercise OAuth
// semantics, so we stub `verifyAccessToken` to accept any bearer header. The
// real OAuth flow is covered by `test/server-oauth.test.ts` against the test
// DB. Mocking here keeps this file hermetic from Postgres.
vi.mock('../src/auth.ts', () => ({
  registerClient: vi.fn(),
  createAuthorizationCode: vi.fn(),
  exchangeAuthorizationCode: vi.fn(),
  verifyAccessToken: vi.fn().mockResolvedValue({
    token: 'stub',
    clientId: 'stub-client',
    scopes: [],
    // Match SquireOAuthProvider.verifyAccessToken shape: `expiresAt` is
    // unix seconds (not a Date). Keeps the stub aligned with production so
    // consumers of AuthInfo don't silently diverge. CodeRabbit nitpick on PR #196.
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  }),
  getAuthProvider: vi.fn(),
  resetAuthProvider: vi.fn(),
  OAuthError: class OAuthError extends Error {},
}));

import { app } from '../src/server.ts';

/** Stub bearer header — the mocked `verifyAccessToken` accepts anything. */
async function auth(): Promise<Record<string, string>> {
  return { Authorization: 'Bearer stub-token' };
}

function resetRouteMocks() {
  vi.clearAllMocks();
  mockInitialize.mockReset();
  mockEnsureBootstrapStatus.mockReset();
  mockGetBootstrapStatus.mockReset();
  mockIsReady.mockReset();
  mockRefreshInitializationIfReady.mockReset();
  mockAsk.mockReset();
  mockEnsureAskBudgetAvailable.mockReset();
  mockSearchRules.mockReset();
  mockSearchCards.mockReset();
  mockListCardTypes.mockReset();
  mockListCards.mockReset();
  mockGetCard.mockReset();
  mockRunReadinessChecks.mockReset();
}

describe('GET /api/health', () => {
  beforeEach(() => {
    resetRouteMocks();
    mockIsReady.mockReturnValue(true);
    mockRefreshInitializationIfReady.mockResolvedValue(undefined);
    mockGetBootstrapStatus.mockReturnValue(makeStatus());
    mockEnsureBootstrapStatus.mockResolvedValue(makeStatus());
    mockRunReadinessChecks.mockResolvedValue({
      status: 'ok',
      db: { status: 'ok' },
      vector: { status: 'ok' },
      embedder: { status: 'ok' },
    });
  });

  it('returns 200 with structured readiness status when every component is ready', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      status: 'ok',
      db: { status: 'ok' },
      vector: { status: 'ok' },
      embedder: { status: 'ok' },
    });
  });

  it('returns 503 with the failing readiness components named', async () => {
    mockRunReadinessChecks.mockResolvedValueOnce({
      status: 'error',
      db: { status: 'ok' },
      vector: { status: 'error', error: 'type "vector" does not exist' },
      embedder: { status: 'error', error: 'embedder is not loaded' },
    });

    const res = await app.request('/api/health');
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('error');
    expect(body.vector).toEqual({ status: 'error', error: 'type "vector" does not exist' });
    expect(body.embedder).toEqual({ status: 'error', error: 'embedder is not loaded' });
  });

  it('returns live status without dependency checks', async () => {
    const res = await app.request('/api/live');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok' });
    expect(mockRunReadinessChecks).not.toHaveBeenCalled();
  });

  it('returns JSON content type', async () => {
    const res = await app.request('/api/health');
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('reports lifecycle state without invoking recovery hooks', async () => {
    await app.request('/api/health');
    expect(mockRefreshInitializationIfReady).not.toHaveBeenCalled();
    expect(mockGetBootstrapStatus).not.toHaveBeenCalled();
  });
});

// ─── GET /api/search/rules ───────────────────────────────────────────────────

describe('GET /api/search/rules', () => {
  beforeEach(() => {
    resetRouteMocks();
    mockIsReady.mockReturnValue(true);
    mockGetBootstrapStatus.mockReturnValue(makeStatus());
    mockEnsureBootstrapStatus.mockResolvedValue(makeStatus());
    mockSearchRules.mockResolvedValue([
      {
        text: 'Loot: pick up all loot tokens.',
        source: 'fh-rule-book.pdf',
        sourceLabel: 'Rulebook',
        score: 0.9,
      },
    ]);
  });

  it('returns search results', async () => {
    const res = await app.request('/api/search/rules?q=loot+action', { headers: await auth() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toHaveProperty('text');
    expect(body.results[0]).toHaveProperty('source');
    expect(body.results[0]).toHaveProperty('sourceLabel');
    expect(body.results[0]).toHaveProperty('score');
  });

  it('passes query and topK to searchRules', async () => {
    await app.request('/api/search/rules?q=loot&topK=3&game=gh2', { headers: await auth() });
    expect(mockSearchRules).toHaveBeenCalledWith('loot', 3, { game: 'gh2' });
  });

  it('defaults topK to 6', async () => {
    await app.request('/api/search/rules?q=loot', { headers: await auth() });
    expect(mockSearchRules).toHaveBeenCalledWith('loot', 6);
  });

  it('returns 400 for unsupported game ids before searching rules', async () => {
    const res = await app.request('/api/search/rules?q=loot&game=no-such-game', {
      headers: await auth(),
    });
    expect(res.status).toBe(400);
    expect(mockSearchRules).not.toHaveBeenCalled();
  });

  it('returns 400 when q is missing', async () => {
    const res = await app.request('/api/search/rules', { headers: await auth() });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing q before bootstrap gating during startup', async () => {
    mockIsReady.mockReturnValueOnce(false);
    const res = await app.request('/api/search/rules', { headers: await auth() });
    expect(res.status).toBe(400);
    expect(mockEnsureBootstrapStatus).not.toHaveBeenCalled();
  });

  it('returns 400 when q is empty', async () => {
    const res = await app.request('/api/search/rules?q=', { headers: await auth() });
    expect(res.status).toBe(400);
  });

  it('defaults topK when given invalid value', async () => {
    await app.request('/api/search/rules?q=loot&topK=abc', { headers: await auth() });
    expect(mockSearchRules).toHaveBeenCalledWith('loot', 6);
  });

  it('returns 503 with an actionable bootstrap error when embeddings are missing', async () => {
    mockIsReady.mockReturnValueOnce(false);
    mockEnsureBootstrapStatus.mockResolvedValueOnce(
      makeStatus({
        lifecycle: 'boot_blocked',
        ready: false,
        bootstrapReady: false,
        indexSize: 0,
        ruleQueriesReady: false,
        askReady: false,
        missingBootstrapSteps: ['npm run index'],
        errors: [
          'Embeddings table is empty. Run `npm run index` to populate the Frosthaven book vector store.',
        ],
        capabilities: {
          rules: {
            allowed: false,
            reason: 'missing_index',
            message:
              'Embeddings table is empty. Run `npm run index` to populate the Frosthaven book vector store.',
          },
          cards: { allowed: true, reason: null, message: null },
          ask: {
            allowed: false,
            reason: 'missing_index',
            message:
              'Embeddings table is empty. Run `npm run index` to populate the Frosthaven book vector store.',
          },
        },
      }),
    );
    const res = await app.request('/api/search/rules?q=loot', { headers: await auth() });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('Service unavailable.');
    expect(body).not.toHaveProperty('missing_bootstrap_steps');
  });
});

// ─── GET /api/search/cards ───────────────────────────────────────────────────

describe('GET /api/search/cards', () => {
  beforeEach(() => {
    resetRouteMocks();
    mockIsReady.mockReturnValue(true);
    mockGetBootstrapStatus.mockReturnValue(makeStatus());
    mockEnsureBootstrapStatus.mockResolvedValue(makeStatus());
    mockSearchCards.mockReturnValue([
      { type: 'monster-stats', data: { name: 'Algox Archer' }, score: 2 },
    ]);
  });

  it('returns search results', async () => {
    const res = await app.request('/api/search/cards?q=algox+archer', { headers: await auth() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toHaveProperty('type');
    expect(body.results[0]).toHaveProperty('data');
    expect(body.results[0]).toHaveProperty('score');
  });

  it('passes query and topK to searchCards', async () => {
    await app.request('/api/search/cards?q=algox&topK=4&game=gh2', { headers: await auth() });
    expect(mockSearchCards).toHaveBeenCalledWith('algox', 4, { game: 'gh2' });
  });

  it('defaults topK to 6', async () => {
    await app.request('/api/search/cards?q=algox', { headers: await auth() });
    expect(mockSearchCards).toHaveBeenCalledWith('algox', 6);
  });

  it('returns 400 when q is missing', async () => {
    const res = await app.request('/api/search/cards', { headers: await auth() });
    expect(res.status).toBe(400);
  });

  it('returns 400 when q is empty', async () => {
    const res = await app.request('/api/search/cards?q=', { headers: await auth() });
    expect(res.status).toBe(400);
  });

  it('defaults topK when given invalid value', async () => {
    await app.request('/api/search/cards?q=algox&topK=abc', { headers: await auth() });
    expect(mockSearchCards).toHaveBeenCalledWith('algox', 6);
  });

  it('returns 503 with an actionable bootstrap error when card data is missing', async () => {
    mockIsReady.mockReturnValueOnce(false);
    mockEnsureBootstrapStatus.mockResolvedValueOnce(
      makeStatus({
        lifecycle: 'boot_blocked',
        ready: false,
        bootstrapReady: false,
        cardCount: 0,
        cardQueriesReady: false,
        askReady: false,
        missingBootstrapSteps: ['npm run seed:cards'],
        errors: ['No card data found in Postgres. Run `npm run seed:cards` first.'],
        capabilities: {
          rules: { allowed: true, reason: null, message: null },
          cards: {
            allowed: false,
            reason: 'missing_cards',
            message: 'No card data found in Postgres. Run `npm run seed:cards` first.',
          },
          ask: {
            allowed: false,
            reason: 'missing_cards',
            message: 'No card data found in Postgres. Run `npm run seed:cards` first.',
          },
        },
      }),
    );
    const res = await app.request('/api/search/cards?q=algox', { headers: await auth() });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('Service unavailable.');
  });
});

// ─── GET /api/card-types ─────────────────────────────────────────────────────

describe('GET /api/card-types', () => {
  beforeEach(() => {
    resetRouteMocks();
    mockIsReady.mockReturnValue(true);
    mockGetBootstrapStatus.mockReturnValue(makeStatus());
    mockEnsureBootstrapStatus.mockResolvedValue(makeStatus());
    mockListCardTypes.mockReturnValue([
      { type: 'monster-stats', count: 10 },
      { type: 'items', count: 5 },
    ]);
  });

  it('returns all card types', async () => {
    const res = await app.request('/api/card-types?game=gh2', { headers: await auth() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.types).toHaveLength(2);
    expect(body.types[0]).toHaveProperty('type');
    expect(body.types[0]).toHaveProperty('count');
    expect(mockListCardTypes).toHaveBeenCalledWith({ game: 'gh2' });
  });
});

// ─── GET /api/cards ──────────────────────────────────────────────────────────

describe('GET /api/cards', () => {
  beforeEach(() => {
    resetRouteMocks();
    mockIsReady.mockReturnValue(true);
    mockGetBootstrapStatus.mockReturnValue(makeStatus());
    mockEnsureBootstrapStatus.mockResolvedValue(makeStatus());
    mockListCards.mockReturnValue([{ name: 'Algox Archer' }]);
  });

  it('returns cards of a given type', async () => {
    const res = await app.request('/api/cards?type=monster-stats&game=gh2', {
      headers: await auth(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cards).toHaveLength(1);
    expect(mockListCards).toHaveBeenCalledWith('monster-stats', undefined, { game: 'gh2' });
  });

  it('returns 400 when type is missing', async () => {
    const res = await app.request('/api/cards', { headers: await auth() });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing type before bootstrap gating during startup', async () => {
    mockIsReady.mockReturnValueOnce(false);
    const res = await app.request('/api/cards', { headers: await auth() });
    expect(res.status).toBe(400);
    expect(mockEnsureBootstrapStatus).not.toHaveBeenCalled();
  });

  it('passes filter as parsed JSON', async () => {
    const filter = encodeURIComponent(JSON.stringify({ name: 'Algox Archer' }));
    await app.request(`/api/cards?type=monster-stats&filter=${filter}&game=gh2`, {
      headers: await auth(),
    });
    expect(mockListCards).toHaveBeenCalledWith(
      'monster-stats',
      { name: 'Algox Archer' },
      { game: 'gh2' },
    );
  });

  it('returns 400 for invalid filter JSON', async () => {
    const res = await app.request('/api/cards?type=monster-stats&filter=not-json', {
      headers: await auth(),
    });
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/cards/:type/:id ────────────────────────────────────────────────

describe('GET /api/cards/:type/:id', () => {
  beforeEach(() => {
    resetRouteMocks();
    mockIsReady.mockReturnValue(true);
    mockGetBootstrapStatus.mockReturnValue(makeStatus());
    mockEnsureBootstrapStatus.mockResolvedValue(makeStatus());
    mockGetCard.mockReturnValue({ name: 'Algox Archer', levelRange: '0-3' });
  });

  it('returns a card by type and id', async () => {
    const res = await app.request('/api/cards/monster-stats/Algox%20Archer?game=gh2', {
      headers: await auth(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.card).toHaveProperty('name', 'Algox Archer');
    expect(mockGetCard).toHaveBeenCalledWith('monster-stats', 'Algox Archer', { game: 'gh2' });
  });

  it('returns 404 when card is not found', async () => {
    mockGetCard.mockReturnValue(null);
    const res = await app.request('/api/cards/monster-stats/Nonexistent', {
      headers: await auth(),
    });
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/ask ───────────────────────────────────────────────────────────

describe('POST /api/ask', () => {
  beforeEach(() => {
    resetRouteMocks();
    mockIsReady.mockReturnValue(true);
    mockGetBootstrapStatus.mockReturnValue(makeStatus());
    mockEnsureBootstrapStatus.mockResolvedValue(makeStatus());
    mockEnsureAskBudgetAvailable.mockResolvedValue(undefined);
    mockAsk.mockResolvedValue('Loot tokens are picked up in your hex.');
  });

  it('returns SSE content type', async () => {
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ question: 'What is the loot action?' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });

  it('calls service.ask with the question and emit callback', async () => {
    await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ question: 'What is the loot action?' }),
    });
    expect(mockAsk).toHaveBeenCalledWith(
      'What is the loot action?',
      expect.objectContaining({ emit: expect.any(Function) }),
    );
  });

  it('returns 429 before opening the stream when the LLM budget is exhausted', async () => {
    mockEnsureAskBudgetAvailable.mockRejectedValueOnce(
      new LlmBudgetExceededError({
        spentUsd: 10,
        budgetUsd: 10,
        remainingUsd: 0,
        budgetDay: '2026-05-20',
        exceeded: true,
      }),
    );

    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ question: 'What is the loot action?' }),
    });

    expect(res.status).toBe(429);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toMatchObject({
      error: 'llm_budget_exceeded',
      error_description: 'Daily LLM budget exhausted. Try again tomorrow.',
    });
    expect(mockAsk).not.toHaveBeenCalled();
  });

  it('returns 400 when question is missing', async () => {
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON before bootstrap gating during startup', async () => {
    mockIsReady.mockReturnValueOnce(false);
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: '{',
    });
    expect(res.status).toBe(400);
    expect(mockEnsureBootstrapStatus).not.toHaveBeenCalled();
  });

  it('returns 400 when question is empty', async () => {
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ question: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON body', async () => {
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('passes history to ask()', async () => {
    const history = [
      { role: 'user', content: 'What is loot?' },
      { role: 'assistant', content: 'Loot tokens are picked up.' },
    ];
    await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ question: 'What about traps?', history }),
    });
    expect(mockAsk).toHaveBeenCalledWith('What about traps?', expect.objectContaining({ history }));
  });

  it('ignores client-supplied userId on the bearer API path', async () => {
    const campaignId = '550e8400-e29b-41d4-a716-446655440000';
    const userId = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ question: 'What items do I have?', campaignId, userId }),
    });
    expect(mockEnsureAskBudgetAvailable).toHaveBeenCalledWith(null);
    expect(mockAsk).toHaveBeenCalledWith(
      'What items do I have?',
      expect.objectContaining({ campaignId }),
    );
    expect(mockAsk.mock.calls[0]?.[1]).not.toHaveProperty('userId');
  });

  it('correlates REST ask traces with an HTTP request ID', async () => {
    const response = await app.request('/api/ask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': 'req-from-edge',
        ...(await auth()),
      },
      body: JSON.stringify({ question: 'What is loot?' }),
    });

    expect(response.headers.get('X-Request-ID')).toBe('req-from-edge');
    expect(mockAsk).toHaveBeenCalledWith(
      'What is loot?',
      expect.objectContaining({ requestId: 'req-from-edge' }),
    );
  });

  it('replaces malformed REST request IDs before trace correlation', async () => {
    const response = await app.request('/api/ask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': 'bad request id',
        ...(await auth()),
      },
      body: JSON.stringify({ question: 'What is loot?' }),
    });

    const requestId = response.headers.get('X-Request-ID');
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(mockAsk).toHaveBeenCalledWith('What is loot?', expect.objectContaining({ requestId }));
  });

  it('passes toolSurface to ask()', async () => {
    await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ question: 'What is loot?', toolSurface: 'legacy' }),
    });
    expect(mockAsk).toHaveBeenCalledWith(
      'What is loot?',
      expect.objectContaining({ toolSurface: 'legacy' }),
    );
  });

  it('passes active game to ask()', async () => {
    await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ question: 'What is loot?', game: 'gh2' }),
    });
    expect(mockAsk).toHaveBeenCalledWith('What is loot?', expect.objectContaining({ game: 'gh2' }));
  });

  it('returns 400 for unsupported ask game ids', async () => {
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ question: 'test', game: 'no-such-game' }),
    });
    expect(res.status).toBe(400);
    expect(mockAsk).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid toolSurface', async () => {
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ question: 'test', toolSurface: 'old' }),
    });
    expect(res.status).toBe(400);
    expect(mockAsk).not.toHaveBeenCalled();
  });

  it('returns 400 for non-UUID campaignId', async () => {
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ question: 'test', campaignId: 'not-a-uuid' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-UUID userId', async () => {
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ question: 'test', userId: 'not-a-uuid' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid history role', async () => {
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({
        question: 'test',
        history: [{ role: 'system', content: 'hi' }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when history is not an array', async () => {
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ question: 'test', history: 'not-array' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when history item missing content', async () => {
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({
        question: 'test',
        history: [{ role: 'user' }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 503 JSON before opening the stream when bootstrap is incomplete', async () => {
    mockIsReady.mockReturnValueOnce(false);
    mockEnsureBootstrapStatus.mockResolvedValueOnce(
      makeStatus({
        lifecycle: 'boot_blocked',
        ready: false,
        bootstrapReady: false,
        indexSize: 0,
        cardCount: 0,
        ruleQueriesReady: false,
        cardQueriesReady: false,
        askReady: false,
        missingBootstrapSteps: ['npm run index', 'npm run seed:cards'],
        errors: [
          'Embeddings table is empty. Run `npm run index` to populate the Frosthaven book vector store.',
          'No card data found in Postgres. Run `npm run seed:cards` first.',
        ],
        capabilities: {
          rules: {
            allowed: false,
            reason: 'missing_index',
            message:
              'Embeddings table is empty. Run `npm run index` to populate the Frosthaven book vector store.',
          },
          cards: {
            allowed: false,
            reason: 'missing_cards',
            message: 'No card data found in Postgres. Run `npm run seed:cards` first.',
          },
          ask: {
            allowed: false,
            reason: 'missing_index',
            message:
              'Embeddings table is empty. Run `npm run index` to populate the Frosthaven book vector store.',
          },
        },
      }),
    );
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ question: 'test' }),
    });
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.error).toBe('Service unavailable.');
    expect(body).not.toHaveProperty('missing_bootstrap_steps');
  });

  it('returns 503 when traversal data is missing for ask', async () => {
    mockIsReady.mockReturnValueOnce(false);
    mockEnsureBootstrapStatus.mockResolvedValueOnce(
      makeStatus({
        lifecycle: 'boot_blocked',
        ready: false,
        bootstrapReady: false,
        askReady: false,
        missingBootstrapSteps: ['npm run seed:scenario-section-books'],
        errors: [
          'No scenario and section book data found in Postgres. Run `npm run seed:scenario-section-books` first.',
        ],
        capabilities: {
          rules: { allowed: true, reason: null, message: null },
          cards: { allowed: true, reason: null, message: null },
          ask: {
            allowed: false,
            reason: 'missing_scenario_section_books',
            message:
              'No scenario and section book data found in Postgres. Run `npm run seed:scenario-section-books` first.',
          },
        },
      }),
    );
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ question: 'show the full text of section 90.2' }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('Service unavailable.');
    expect(mockAsk).not.toHaveBeenCalled();
  });

  it('emits error event when ask() throws', async () => {
    mockAsk.mockRejectedValue(new Error('Claude API error'));
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ question: 'test' }),
    });
    expect(res.status).toBe(200); // SSE streams always return 200
    const text = await res.text();
    const events = parseSSE(text);
    const errorEvent = events.find((e) => e.event === 'error');
    expect(errorEvent).toBeDefined();
    expect(JSON.parse(errorEvent!.data)).toHaveProperty('message', 'Internal server error');
  });
});

describe('bootstrapErrorResponse fast path', () => {
  beforeEach(() => {
    resetRouteMocks();
    mockIsReady.mockReturnValue(true);
    mockGetBootstrapStatus.mockReturnValue(makeStatus());
    mockEnsureBootstrapStatus.mockResolvedValue(makeStatus());
    mockSearchRules.mockResolvedValue([
      {
        text: 'Loot: pick up all loot tokens.',
        source: 'fh-rule-book.pdf',
        sourceLabel: 'Rulebook',
        score: 0.9,
      },
    ]);
  });

  it('skips bootstrap probes for ready search requests', async () => {
    await app.request('/api/search/rules?q=loot', { headers: await auth() });
    expect(mockGetBootstrapStatus).not.toHaveBeenCalled();
    expect(mockEnsureBootstrapStatus).not.toHaveBeenCalled();
  });

  it('lets a ready request reach the handler via capability middleware', async () => {
    await app.request('/api/search/rules?q=loot', { headers: await auth() });
    expect(mockSearchRules).toHaveBeenCalledTimes(1);
  });

  it('blocks the handler when capability middleware denies the route', async () => {
    mockIsReady.mockReturnValueOnce(false);
    mockEnsureBootstrapStatus.mockResolvedValueOnce(
      makeStatus({
        lifecycle: 'boot_blocked',
        ready: false,
        bootstrapReady: false,
        ruleQueriesReady: false,
        askReady: false,
        capabilities: {
          rules: {
            allowed: false,
            reason: 'missing_index',
            message:
              'Embeddings table is empty. Run `npm run index` to populate the Frosthaven book vector store.',
          },
          cards: { allowed: true, reason: null, message: null },
          ask: {
            allowed: false,
            reason: 'missing_index',
            message:
              'Embeddings table is empty. Run `npm run index` to populate the Frosthaven book vector store.',
          },
        },
      }),
    );

    const res = await app.request('/api/search/rules?q=loot', { headers: await auth() });
    expect(res.status).toBe(503);
    expect(mockSearchRules).not.toHaveBeenCalled();
  });

  it('allows rule routes when only card probing has degraded', async () => {
    mockIsReady.mockReturnValueOnce(false);
    mockEnsureBootstrapStatus.mockResolvedValueOnce(
      makeStatus({
        lifecycle: 'dependency_failed',
        ready: false,
        bootstrapReady: false,
        ruleQueriesReady: true,
        cardQueriesReady: false,
        askReady: false,
        capabilities: {
          rules: { allowed: true, reason: null, message: null },
          cards: {
            allowed: false,
            reason: 'dependency_unavailable',
            message: 'card data query failed: connect ECONNREFUSED.',
          },
          ask: {
            allowed: false,
            reason: 'dependency_unavailable',
            message: 'card data query failed: connect ECONNREFUSED.',
          },
        },
      }),
    );

    const res = await app.request('/api/search/rules?q=loot', { headers: await auth() });
    expect(res.status).toBe(200);
    expect(mockSearchRules).toHaveBeenCalledTimes(1);
  });

  it('blocks rule routes when warmup has failed', async () => {
    mockIsReady.mockReturnValueOnce(false);
    mockEnsureBootstrapStatus.mockResolvedValueOnce(
      makeStatus({
        lifecycle: 'init_failed',
        ready: false,
        bootstrapReady: true,
        ruleQueriesReady: false,
        cardQueriesReady: true,
        askReady: false,
        capabilities: {
          rules: {
            allowed: false,
            reason: 'init_failed',
            message: 'embedder cold start failed',
          },
          cards: { allowed: true, reason: null, message: null },
          ask: {
            allowed: false,
            reason: 'init_failed',
            message: 'embedder cold start failed',
          },
        },
      }),
    );

    const res = await app.request('/api/search/rules?q=loot', { headers: await auth() });
    expect(res.status).toBe(503);
    expect(mockSearchRules).not.toHaveBeenCalled();
  });
});

// ─── Error handling ──────────────────────────────────────────────────────────

describe('error handling', () => {
  beforeEach(() => {
    resetRouteMocks();
    mockIsReady.mockReturnValue(true);
    mockGetBootstrapStatus.mockReturnValue(makeStatus());
    mockEnsureBootstrapStatus.mockResolvedValue(makeStatus());
  });

  it('returns structured 404 for unknown paths', async () => {
    const res = await app.request('/api/nonexistent');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('status', 404);
  });

  it('returns structured error for unhandled exceptions', async () => {
    mockSearchRules.mockRejectedValue(new Error('Unexpected failure'));
    const res = await app.request('/api/search/rules?q=test', { headers: await auth() });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('status', 500);
  });

  it('all error responses have consistent shape', async () => {
    // 400 case
    const res400 = await app.request('/api/search/rules', { headers: await auth() });
    expect(res400.status).toBe(400);
    const body400 = await res400.json();
    expect(body400).toHaveProperty('error');
    expect(body400).toHaveProperty('status', 400);
  });
});
