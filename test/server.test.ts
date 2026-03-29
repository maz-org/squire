import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInitialize, mockIsReady, mockSearchRules, mockSearchCards } = vi.hoisted(() => ({
  mockInitialize: vi.fn(),
  mockIsReady: vi.fn(),
  mockSearchRules: vi.fn(),
  mockSearchCards: vi.fn(),
}));

vi.mock('../src/service.ts', () => ({
  initialize: mockInitialize,
  isReady: mockIsReady,
}));

vi.mock('../src/vector-store.ts', () => ({
  loadIndex: vi.fn(() => [{ id: '1' }, { id: '2' }, { id: '3' }]),
}));

vi.mock('../src/tools.ts', () => ({
  searchRules: mockSearchRules,
  searchCards: mockSearchCards,
}));

import { app } from '../src/server.ts';

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
    const res = await app.request('/api/search/rules?q=loot+action');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toHaveProperty('text');
    expect(body.results[0]).toHaveProperty('source');
    expect(body.results[0]).toHaveProperty('score');
  });

  it('passes query and topK to searchRules', async () => {
    await app.request('/api/search/rules?q=loot&topK=3');
    expect(mockSearchRules).toHaveBeenCalledWith('loot', 3);
  });

  it('defaults topK to 6', async () => {
    await app.request('/api/search/rules?q=loot');
    expect(mockSearchRules).toHaveBeenCalledWith('loot', 6);
  });

  it('returns 400 when q is missing', async () => {
    const res = await app.request('/api/search/rules');
    expect(res.status).toBe(400);
  });

  it('returns 400 when q is empty', async () => {
    const res = await app.request('/api/search/rules?q=');
    expect(res.status).toBe(400);
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
    const res = await app.request('/api/search/cards?q=algox+archer');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toHaveProperty('type');
    expect(body.results[0]).toHaveProperty('data');
    expect(body.results[0]).toHaveProperty('score');
  });

  it('passes query and topK to searchCards', async () => {
    await app.request('/api/search/cards?q=algox&topK=4');
    expect(mockSearchCards).toHaveBeenCalledWith('algox', 4);
  });

  it('defaults topK to 6', async () => {
    await app.request('/api/search/cards?q=algox');
    expect(mockSearchCards).toHaveBeenCalledWith('algox', 6);
  });

  it('returns 400 when q is missing', async () => {
    const res = await app.request('/api/search/cards');
    expect(res.status).toBe(400);
  });
});

// ─── unknown routes ──────────────────────────────────────────────────────────

describe('unknown routes', () => {
  it('returns 404 for unknown paths', async () => {
    const res = await app.request('/api/nonexistent');
    expect(res.status).toBe(404);
  });
});
