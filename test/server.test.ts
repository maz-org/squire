import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInitialize, mockIsReady } = vi.hoisted(() => ({
  mockInitialize: vi.fn(),
  mockIsReady: vi.fn(),
}));

vi.mock('../src/service.ts', () => ({
  initialize: mockInitialize,
  isReady: mockIsReady,
}));

vi.mock('../src/vector-store.ts', () => ({
  loadIndex: vi.fn(() => [{ id: '1' }, { id: '2' }, { id: '3' }]),
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

describe('unknown routes', () => {
  it('returns 404 for unknown paths', async () => {
    const res = await app.request('/api/nonexistent');
    expect(res.status).toBe(404);
  });
});
