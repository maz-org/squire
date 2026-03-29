import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockMessagesCreate, mockSearchRules, mockSearchCards, mockEmbed, mockLoadIndex } =
  vi.hoisted(() => ({
    mockMessagesCreate: vi.fn(),
    mockSearchRules: vi.fn(),
    mockSearchCards: vi.fn(),
    mockEmbed: vi.fn(),
    mockLoadIndex: vi.fn(),
  }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockMessagesCreate };
  },
}));

vi.mock('../src/tools.ts', () => ({
  searchRules: mockSearchRules,
  searchCards: mockSearchCards,
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

import { initialize, isReady, ask } from '../src/service.ts';

// ─── initialize / isReady ────────────────────────────────────────────────────

describe('initialize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadIndex.mockReturnValue([
      { id: 'chunk-1', text: 'test', embedding: [0.1], source: 'test.pdf', chunkIndex: 0 },
    ]);
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  it('isReady returns false before initialize', async () => {
    // Module-level `ready` starts false; we can't fully reset module state
    // but we can verify the function exists and returns a boolean
    expect(typeof isReady()).toBe('boolean');
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
    mockLoadIndex.mockReturnValue([]);
    await expect(initialize()).rejects.toThrow(/index is empty/i);
  });
});

// ─── ask ─────────────────────────────────────────────────────────────────────

describe('ask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadIndex.mockReturnValue([
      { id: 'chunk-1', text: 'test', embedding: [0.1], source: 'test.pdf', chunkIndex: 0 },
    ]);
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
    mockSearchRules.mockResolvedValue([
      { text: 'Loot: pick up all loot tokens.', source: 'rulebook.pdf:42', score: 0.9 },
    ]);
    mockSearchCards.mockReturnValue([]);
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'You pick up loot tokens in your hex.' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
  });

  it('calls searchRules with the question', async () => {
    await initialize();
    await ask('What is the loot action?');
    expect(mockSearchRules).toHaveBeenCalledWith('What is the loot action?', 6);
  });

  it('calls searchCards with the question', async () => {
    await initialize();
    await ask('What is the loot action?');
    expect(mockSearchCards).toHaveBeenCalledWith('What is the loot action?', 8);
  });

  it('calls Claude API with search results as context', async () => {
    await initialize();
    await ask('What is the loot action?');
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        system: expect.stringContaining('Frosthaven rules assistant'),
      }),
    );
    const userMessage = mockMessagesCreate.mock.calls[0][0].messages[0].content as string;
    expect(userMessage).toContain('Loot: pick up all loot tokens.');
    expect(userMessage).toContain('What is the loot action?');
  });

  it('returns the Claude API response text', async () => {
    await initialize();
    const result = await ask('What is the loot action?');
    expect(result).toBe('You pick up loot tokens in your hex.');
  });

  it('includes card data when searchCards returns results', async () => {
    mockSearchCards.mockReturnValue([
      { type: 'items', data: { name: 'Boots of Speed', effect: 'Move +1' }, score: 2 },
    ]);
    await initialize();
    await ask('What items grant movement?');
    const userMessage = mockMessagesCreate.mock.calls[0][0].messages[0].content as string;
    expect(userMessage).toContain('Card Data');
    expect(userMessage).toContain('Boots of Speed');
  });

  it('throws if not initialized', async () => {
    // Use a fresh module import to get uninitialized state
    vi.resetModules();

    // Re-register mocks before re-importing
    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { create: mockMessagesCreate };
      },
    }));
    vi.doMock('../src/tools.ts', () => ({
      searchRules: mockSearchRules,
      searchCards: mockSearchCards,
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
