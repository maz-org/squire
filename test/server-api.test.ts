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

const {
  mockInitialize,
  mockIsReady,
  mockAsk,
  mockSearchRules,
  mockSearchCards,
  mockListCardTypes,
  mockListCards,
  mockGetCard,
} = vi.hoisted(() => ({
  mockInitialize: vi.fn(),
  mockIsReady: vi.fn(),
  mockAsk: vi.fn(),
  mockSearchRules: vi.fn(),
  mockSearchCards: vi.fn(),
  mockListCardTypes: vi.fn(),
  mockListCards: vi.fn(),
  mockGetCard: vi.fn(),
}));

vi.mock('../src/service.ts', () => ({
  initialize: mockInitialize,
  isReady: mockIsReady,
  ask: mockAsk,
}));

// /api/health queries Postgres directly (COUNT(*) on embeddings). Mock
// getDb so these tests stay hermetic — no Postgres needed to run.
vi.mock('../src/db.ts', () => ({
  getDb: () => ({
    db: {
      execute: vi.fn().mockResolvedValue({ rows: [{ count: '3' }] }),
    },
    close: async () => {},
  }),
  shutdownServerPool: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/tools.ts', () => ({
  searchRules: mockSearchRules,
  searchCards: mockSearchCards,
  listCardTypes: mockListCardTypes,
  listCards: mockListCards,
  getCard: mockGetCard,
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

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with ready status', async () => {
    mockIsReady.mockReturnValue(true);
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('ready', true);
    expect(body).toHaveProperty('index_size');
    expect(typeof body.index_size).toBe('number');
  });

  it('returns ready=false when service is not initialized', async () => {
    mockIsReady.mockReturnValue(false);
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ready).toBe(false);
  });

  it('includes index_size in response', async () => {
    mockIsReady.mockReturnValue(true);
    const res = await app.request('/api/health');
    const body = await res.json();
    expect(body.index_size).toBe(3);
  });

  it('returns JSON content type', async () => {
    mockIsReady.mockReturnValue(true);
    const res = await app.request('/api/health');
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});

// ─── GET /api/search/rules ───────────────────────────────────────────────────

describe('GET /api/search/rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchRules.mockResolvedValue([
      { text: 'Loot: pick up all loot tokens.', source: 'rulebook.pdf:42', score: 0.9 },
    ]);
  });

  it('returns search results', async () => {
    const res = await app.request('/api/search/rules?q=loot+action', { headers: await auth() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toHaveProperty('text');
    expect(body.results[0]).toHaveProperty('source');
    expect(body.results[0]).toHaveProperty('score');
  });

  it('passes query and topK to searchRules', async () => {
    await app.request('/api/search/rules?q=loot&topK=3', { headers: await auth() });
    expect(mockSearchRules).toHaveBeenCalledWith('loot', 3);
  });

  it('defaults topK to 6', async () => {
    await app.request('/api/search/rules?q=loot', { headers: await auth() });
    expect(mockSearchRules).toHaveBeenCalledWith('loot', 6);
  });

  it('returns 400 when q is missing', async () => {
    const res = await app.request('/api/search/rules', { headers: await auth() });
    expect(res.status).toBe(400);
  });

  it('returns 400 when q is empty', async () => {
    const res = await app.request('/api/search/rules?q=', { headers: await auth() });
    expect(res.status).toBe(400);
  });

  it('defaults topK when given invalid value', async () => {
    await app.request('/api/search/rules?q=loot&topK=abc', { headers: await auth() });
    expect(mockSearchRules).toHaveBeenCalledWith('loot', 6);
  });
});

// ─── GET /api/search/cards ───────────────────────────────────────────────────

describe('GET /api/search/cards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    await app.request('/api/search/cards?q=algox&topK=4', { headers: await auth() });
    expect(mockSearchCards).toHaveBeenCalledWith('algox', 4);
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
});

// ─── GET /api/card-types ─────────────────────────────────────────────────────

describe('GET /api/card-types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListCardTypes.mockReturnValue([
      { type: 'monster-stats', count: 10 },
      { type: 'items', count: 5 },
    ]);
  });

  it('returns all card types', async () => {
    const res = await app.request('/api/card-types', { headers: await auth() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.types).toHaveLength(2);
    expect(body.types[0]).toHaveProperty('type');
    expect(body.types[0]).toHaveProperty('count');
  });
});

// ─── GET /api/cards ──────────────────────────────────────────────────────────

describe('GET /api/cards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListCards.mockReturnValue([{ name: 'Algox Archer' }]);
  });

  it('returns cards of a given type', async () => {
    const res = await app.request('/api/cards?type=monster-stats', { headers: await auth() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cards).toHaveLength(1);
    expect(mockListCards).toHaveBeenCalledWith('monster-stats', undefined);
  });

  it('returns 400 when type is missing', async () => {
    const res = await app.request('/api/cards', { headers: await auth() });
    expect(res.status).toBe(400);
  });

  it('passes filter as parsed JSON', async () => {
    const filter = encodeURIComponent(JSON.stringify({ name: 'Algox Archer' }));
    await app.request(`/api/cards?type=monster-stats&filter=${filter}`, { headers: await auth() });
    expect(mockListCards).toHaveBeenCalledWith('monster-stats', { name: 'Algox Archer' });
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
    vi.clearAllMocks();
    mockGetCard.mockReturnValue({ name: 'Algox Archer', levelRange: '0-3' });
  });

  it('returns a card by type and id', async () => {
    const res = await app.request('/api/cards/monster-stats/Algox%20Archer', {
      headers: await auth(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.card).toHaveProperty('name', 'Algox Archer');
    expect(mockGetCard).toHaveBeenCalledWith('monster-stats', 'Algox Archer');
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
    vi.clearAllMocks();
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

  it('returns 400 when question is missing', async () => {
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
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

  it('passes campaignId and userId to ask()', async () => {
    const campaignId = '550e8400-e29b-41d4-a716-446655440000';
    const userId = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ question: 'What items do I have?', campaignId, userId }),
    });
    expect(mockAsk).toHaveBeenCalledWith(
      'What items do I have?',
      expect.objectContaining({ campaignId, userId }),
    );
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

// ─── Error handling ──────────────────────────────────────────────────────────

describe('error handling', () => {
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
