import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockRunAgentLoop, mockEmbed, mockLoadIndex } = vi.hoisted(() => ({
  mockRunAgentLoop: vi.fn(),
  mockEmbed: vi.fn(),
  mockLoadIndex: vi.fn(),
}));

vi.mock('../src/agent.ts', () => ({
  runAgentLoop: mockRunAgentLoop,
}));

vi.mock('../src/tools.ts', () => ({
  listCardTypes: vi.fn(() => [
    { type: 'monster-stats', count: 5 },
    { type: 'items', count: 3 },
  ]),
}));

vi.mock('../src/embedder.ts', () => ({
  embed: mockEmbed,
}));

vi.mock('../src/vector-store.ts', () => ({
  loadIndex: mockLoadIndex,
}));

vi.mock('../src/extracted-data.ts', () => ({
  TYPES: ['monster-stats', 'items'],
  load: vi.fn(() => [{ name: 'test' }]),
}));

import { initialize, isReady, ask, _resetForTesting } from '../src/service.ts';

// ─── initialize / isReady ────────────────────────────────────────────────────

describe('initialize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
    mockLoadIndex.mockReturnValue([
      { id: 'chunk-1', text: 'test', embedding: [0.1], source: 'test.pdf', chunkIndex: 0 },
    ]);
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  it('isReady returns false before initialize', () => {
    expect(isReady()).toBe(false);
  });

  it('initialize loads index and warms embedder', async () => {
    await initialize();
    expect(mockLoadIndex).toHaveBeenCalled();
    expect(mockEmbed).toHaveBeenCalledWith('warmup');
  });

  it('isReady returns true after initialize', async () => {
    await initialize();
    expect(isReady()).toBe(true);
  });

  it('initialize throws when index is empty', async () => {
    vi.resetModules();
    vi.doMock('../src/agent.ts', () => ({ runAgentLoop: mockRunAgentLoop }));
    vi.doMock('../src/tools.ts', () => ({
      listCardTypes: vi.fn(() => [{ type: 'monster-stats', count: 5 }]),
    }));
    vi.doMock('../src/embedder.ts', () => ({ embed: mockEmbed }));
    vi.doMock('../src/vector-store.ts', () => ({ loadIndex: vi.fn(() => []) }));
    vi.doMock('../src/extracted-data.ts', () => ({
      TYPES: ['monster-stats'],
      load: vi.fn(() => []),
    }));

    const { initialize: freshInit } = await import('../src/service.ts');
    await expect(freshInit()).rejects.toThrow(/index is empty/i);
  });
});

// ─── ask ─────────────────────────────────────────────────────────────────────

describe('ask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
    mockLoadIndex.mockReturnValue([
      { id: 'chunk-1', text: 'test', embedding: [0.1], source: 'test.pdf', chunkIndex: 0 },
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

  it('throws if not initialized', async () => {
    vi.resetModules();
    vi.doMock('../src/agent.ts', () => ({ runAgentLoop: mockRunAgentLoop }));
    vi.doMock('../src/tools.ts', () => ({
      listCardTypes: vi.fn(() => [{ type: 'monster-stats', count: 5 }]),
    }));
    vi.doMock('../src/embedder.ts', () => ({ embed: mockEmbed }));
    vi.doMock('../src/vector-store.ts', () => ({ loadIndex: mockLoadIndex }));
    vi.doMock('../src/extracted-data.ts', () => ({
      TYPES: ['monster-stats'],
      load: vi.fn(() => [{ name: 'test' }]),
    }));

    const { ask: freshAsk } = await import('../src/service.ts');
    await expect(freshAsk('test')).rejects.toThrow(/not initialized/i);
  });
});
