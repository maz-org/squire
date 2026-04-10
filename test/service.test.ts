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
  getBootstrapStatus,
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
    });
    mockListCardTypes.mockResolvedValueOnce([
      { type: 'monster-stats', count: 0 },
      { type: 'items', count: 0 },
    ]);

    const status = await getBootstrapStatus();
    expect(status.ready).toBe(false);
    expect(status.missingBootstrapSteps).toEqual(['npm run index', 'npm run seed:cards']);
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

    expect(mockInitializeRetrieval).toHaveBeenCalledWith(mockEmbed);
    expect(isReady()).toBe(true);
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
});
