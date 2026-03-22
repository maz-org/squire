import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('dotenv/config', () => ({}));
vi.mock('../src/instrumentation.ts', () => ({ sdk: { shutdown: vi.fn() } }));
vi.mock('@langfuse/tracing', () => ({
  startActiveObservation: vi.fn((_name: string, fn: (trace: unknown) => unknown) =>
    fn({ update: vi.fn() }),
  ),
  startObservation: vi.fn(() => ({ update: vi.fn(), end: vi.fn() })),
}));

const {
  mockMessagesCreate,
  mockEmbed,
  mockLoadIndex,
  mockSearch,
  mockSearchExtracted,
  mockFormatExtracted,
} = vi.hoisted(() => ({
  mockMessagesCreate: vi.fn(),
  mockEmbed: vi.fn(),
  mockLoadIndex: vi.fn(),
  mockSearch: vi.fn(),
  mockSearchExtracted: vi.fn(),
  mockFormatExtracted: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockMessagesCreate };
  },
}));

vi.mock('../src/embedder.ts', () => ({
  embed: mockEmbed,
}));

vi.mock('../src/vector-store.ts', () => ({
  loadIndex: mockLoadIndex,
  search: mockSearch,
}));

vi.mock('../src/extracted-data.ts', () => ({
  searchExtracted: mockSearchExtracted,
  formatExtracted: mockFormatExtracted,
}));

import { askFrosthaven } from '../src/query.ts';

describe('askFrosthaven', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
    mockLoadIndex.mockReturnValue([
      { source: 'rulebook.pdf', text: 'Some rulebook text', embedding: [0.1, 0.2, 0.3] },
    ]);
    mockSearch.mockReturnValue([
      { source: 'rulebook.pdf', text: 'Some rulebook text', score: 0.9 },
    ]);
    mockSearchExtracted.mockReturnValue([]);
    mockFormatExtracted.mockReturnValue('');
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Mocked answer' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
  });

  it('returns empty index message when loadIndex returns []', async () => {
    mockLoadIndex.mockReturnValue([]);
    const result = await askFrosthaven('What is the loot action?');
    expect(result).toBe(
      'The rulebook index is empty. Run `npm run index` first to index the docs.',
    );
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('calls embed with the question', async () => {
    await askFrosthaven('What is the loot action?');
    expect(mockEmbed).toHaveBeenCalledWith('What is the loot action?');
  });

  it('calls Claude API with correct model and system prompt', async () => {
    await askFrosthaven('What is the loot action?');
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        system: expect.stringContaining('Frosthaven rules assistant'),
      }),
    );
  });

  it('returns the Claude API response text', async () => {
    const result = await askFrosthaven('What is the loot action?');
    expect(result).toBe('Mocked answer');
  });

  it('includes card data context when searchExtracted returns results', async () => {
    mockSearchExtracted.mockReturnValue([{ name: 'Trample' }]);
    mockFormatExtracted.mockReturnValue('Trample: Move 3, Attack 2');

    await askFrosthaven('What does Trample do?');

    const userMessage = mockMessagesCreate.mock.calls[0][0].messages[0].content as string;
    expect(userMessage).toContain('## Card Data');
    expect(userMessage).toContain('Trample: Move 3, Attack 2');
  });
});
