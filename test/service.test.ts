import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const {
  mockRunAgentLoop,
  mockEmbed,
  mockInitializeRetrieval,
  mockGetRetrievalBootstrapStatus,
  mockListCardTypes,
} = vi.hoisted(() => ({
  mockRunAgentLoop: vi.fn(),
  mockEmbed: vi.fn(),
  mockInitializeRetrieval: vi.fn(),
    mockGetRetrievalBootstrapStatus: vi.fn(),
  mockListCardTypes: vi.fn(),
  }));

vi.mock('../src/agent.ts', () => ({
  runAgentLoop: mockRunAgentLoop,
}));

vi.mock('../src/tools.ts', () => ({
  listCardTypes: mockListCardTypes,
}));

vi.mock('../src/embedder.ts', () => ({
  embed: mockEmbed,
}));

vi.mock('../src/vector-store.ts', () => ({
  EMBEDDINGS_BOOTSTRAP_MESSAGE:
    'Embeddings table is empty. Run `npm run index` to populate the rulebook vector store.',
  getRetrievalBootstrapStatus: mockGetRetrievalBootstrapStatus,
  initializeRetrieval: mockInitializeRetrieval,
}));

vi.mock('../src/extracted-data.ts', () => ({
  TYPES: ['monster-stats', 'items'],
  load: vi.fn(() => [{ name: 'test' }]),
}));

import {
  initialize,
  isReady,
  ask,
  ensureBootstrapStatus,
  getBootstrapStatus,
  refreshBootstrapState,
  refreshInitializationIfReady,
  _resetForTesting,
} from '../src/service.ts';

// ─── initialize / isReady ────────────────────────────────────────────────────

describe('initialize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
    mockInitializeRetrieval.mockResolvedValue(undefined);
    mockGetRetrievalBootstrapStatus.mockResolvedValue({ ready: true, indexSize: 8 });
    mockListCardTypes.mockResolvedValue([
      { type: 'monster-stats', count: 5 },
      { type: 'items', count: 3 },
    ]);
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  it('isReady returns false before initialize', () => {
    expect(isReady()).toBe(false);
  });

  it('delegates retrieval bootstrap to initializeRetrieval', async () => {
    await initialize();
    // service passes the embedder in so retrieval can warm it without
    // importing it itself — keeps the retrieval layer free of a direct
    // embedder dependency in the type surface.
    expect(mockInitializeRetrieval).toHaveBeenCalledWith(mockEmbed);
  });

  it('isReady returns true after initialize', async () => {
    await initialize();
    expect(isReady()).toBe(true);
  });

  it('surfaces retrieval initialization errors', async () => {
    mockInitializeRetrieval.mockRejectedValueOnce(new Error('Vector index is empty.'));
    await expect(initialize()).rejects.toThrow(/index is empty/i);
  });

  it('reports missing bootstrap steps when embeddings or cards are absent', async () => {
    mockGetRetrievalBootstrapStatus.mockResolvedValueOnce({
      ready: false,
      indexSize: 0,
      error: 'Embeddings table is empty. Run `npm run index` to populate the rulebook vector store.',
      missingStep: 'npm run index',
      reason: 'missing_index',
    });
    mockListCardTypes.mockResolvedValueOnce([
      { type: 'monster-stats', count: 0 },
      { type: 'items', count: 0 },
    ]);

    await refreshBootstrapState();
    const status = getBootstrapStatus();
    expect(status.ready).toBe(false);
    expect(status.lifecycle).toBe('boot_blocked');
    expect(status.missingBootstrapSteps).toEqual(['npm run index', 'npm run seed:cards']);
  });

  it('returns an immediate starting snapshot before the first live probe', () => {
    const status = getBootstrapStatus();
    expect(status.lifecycle).toBe('starting');
    expect(status.ready).toBe(false);
    expect(status.errors).toEqual([]);
  });

  it('populates the first bootstrap snapshot only through the live probe path', async () => {
    mockGetRetrievalBootstrapStatus.mockResolvedValue({
      ready: false,
      indexSize: 0,
      error: 'database unavailable',
      reason: 'dependency_unavailable',
    });
    mockListCardTypes.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const status = await ensureBootstrapStatus();
    expect(status.lifecycle).toBe('dependency_failed');
    expect(status.errors[0]).toMatch(/database unavailable/);
  });

  it('retries initialization when bootstrap prerequisites later become available', async () => {
    mockGetRetrievalBootstrapStatus.mockResolvedValue({
      ready: true,
      indexSize: 8,
    });
    mockListCardTypes.mockResolvedValue([
      { type: 'monster-stats', count: 5 },
      { type: 'items', count: 3 },
    ]);

    await refreshInitializationIfReady();

    await vi.waitFor(() => expect(mockInitializeRetrieval).toHaveBeenCalledWith(mockEmbed));
    expect(isReady()).toBe(true);
  });

  it('reports warming_up immediately while initialization is in flight', async () => {
    let resolveWarmup: (() => void) | null = null;
    mockInitializeRetrieval.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWarmup = resolve;
        }),
    );

    const init = initialize();
    await vi.waitFor(async () => {
      expect(getBootstrapStatus().lifecycle).toBe('warming_up');
    });

    const status = getBootstrapStatus();
    expect(status.lifecycle).toBe('warming_up');
    expect(status.warmingUp).toBe(true);
    expect(status.capabilities.ask).toEqual({
      allowed: false,
      reason: 'warming_up',
      message: 'Service is warming up. Retry in a moment.',
    });

    resolveWarmup?.();
    await init;
  });

  it('reports warming_up when retrying after an init failure', async () => {
    let failWarmup = true;
    let resolveRetry: (() => void) | null = null;
    mockInitializeRetrieval.mockImplementation(() => {
      if (failWarmup) {
        failWarmup = false;
        return Promise.reject(new Error('embedder cold start failed'));
      }
      return new Promise<void>((resolve) => {
        resolveRetry = resolve;
      });
    });

    await expect(initialize()).rejects.toThrow(/embedder cold start failed/i);
    expect(getBootstrapStatus().lifecycle).toBe('init_failed');

    const retry = initialize();
    await vi.waitFor(() => {
      expect(getBootstrapStatus().lifecycle).toBe('warming_up');
    });

    resolveRetry?.();
    await retry;
    expect(getBootstrapStatus().lifecycle).toBe('ready');
  });

  it('keeps rule queries available when only card bootstrap probing fails', async () => {
    mockGetRetrievalBootstrapStatus.mockResolvedValue({
      ready: true,
      indexSize: 8,
    });
    mockListCardTypes.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const status = await ensureBootstrapStatus();
    expect(status.lifecycle).toBe('dependency_failed');
    expect(status.capabilities.rules).toEqual({
      allowed: true,
      reason: null,
      message: null,
    });
    expect(status.capabilities.cards.allowed).toBe(false);
    expect(status.capabilities.ask.allowed).toBe(false);
  });
});

// ─── ask ─────────────────────────────────────────────────────────────────────

describe('ask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
    mockInitializeRetrieval.mockResolvedValue(undefined);
    mockGetRetrievalBootstrapStatus.mockResolvedValue({ ready: true, indexSize: 8 });
    mockListCardTypes.mockResolvedValue([
      { type: 'monster-stats', count: 5 },
      { type: 'items', count: 3 },
    ]);
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
    mockRunAgentLoop.mockResolvedValue('You pick up loot tokens in your hex.');
  });

  it('delegates to runAgentLoop', async () => {
    await initialize();
    const result = await ask('What is the loot action?');
    expect(mockRunAgentLoop).toHaveBeenCalledWith('What is the loot action?', undefined);
    expect(result).toBe('You pick up loot tokens in your hex.');
  });

  it('passes options through to runAgentLoop', async () => {
    await initialize();
    const options = {
      history: [{ role: 'user' as const, content: 'What is loot?' }],
      campaignId: '550e8400-e29b-41d4-a716-446655440000',
      userId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    };
    await ask('Follow-up', options);
    expect(mockRunAgentLoop).toHaveBeenCalledWith('Follow-up', options);
  });

  it('initializes lazily when asked before warmup', async () => {
    await ask('test');
    expect(mockInitializeRetrieval).toHaveBeenCalled();
    expect(mockRunAgentLoop).toHaveBeenCalledWith('test', undefined);
  });

  it('does not run the agent loop after readiness has regressed', async () => {
    await initialize();

    mockGetRetrievalBootstrapStatus.mockResolvedValue({
      ready: false,
      indexSize: 0,
      error: 'database unavailable',
      reason: 'dependency_unavailable',
    });
    mockListCardTypes.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await refreshBootstrapState();

    await expect(ask('test after regression')).rejects.toThrow(/database unavailable/i);
    expect(mockRunAgentLoop).not.toHaveBeenCalledWith('test after regression', undefined);
  });
});
