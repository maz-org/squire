import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockMessagesCreate, mockSearchRules, mockSearchCards, mockListCardTypes, mockGetCard } =
  vi.hoisted(() => ({
    mockMessagesCreate: vi.fn(),
    mockSearchRules: vi.fn(),
    mockSearchCards: vi.fn(),
    mockListCardTypes: vi.fn(),
    mockGetCard: vi.fn(),
  }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockMessagesCreate };
  },
}));

vi.mock('../src/tools.ts', () => ({
  searchRules: mockSearchRules,
  searchCards: mockSearchCards,
  listCardTypes: mockListCardTypes,
  listCards: vi.fn(() => []),
  getCard: mockGetCard,
}));

import { runAgentLoop, executeToolCall, AGENT_TOOLS, MAX_AGENT_ITERATIONS } from '../src/agent.ts';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a mock response where Claude returns text immediately (no tool use). */
function textResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

/** Create a mock response where Claude calls one tool. */
function toolUseResponse(toolName: string, toolInput: Record<string, unknown>, id = 'tool_1') {
  return {
    content: [{ type: 'tool_use', id, name: toolName, input: toolInput }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

// ─── runAgentLoop ────────────────────────────────────────────────────────────

describe('runAgentLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchRules.mockResolvedValue([
      { text: 'Loot: pick up all loot tokens.', source: 'rulebook.pdf:42', score: 0.9 },
    ]);
    mockSearchCards.mockReturnValue([]);
    mockListCardTypes.mockReturnValue([{ type: 'items', count: 10 }]);
    mockGetCard.mockReturnValue({ name: 'Boots of Speed', effect: 'Move +1' });
  });

  it('returns text immediately when Claude responds without tool use', async () => {
    mockMessagesCreate.mockResolvedValue(textResponse('Loot tokens are picked up in your hex.'));
    const result = await runAgentLoop('What is the loot action?');
    expect(result).toBe('Loot tokens are picked up in your hex.');
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
  });

  it('passes tools to Claude API', async () => {
    mockMessagesCreate.mockResolvedValue(textResponse('Answer'));
    await runAgentLoop('test');
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: AGENT_TOOLS,
        system: expect.stringContaining('Frosthaven rules assistant'),
      }),
    );
  });

  it('executes tool calls and loops until text response', async () => {
    // First call: Claude calls search_rules
    mockMessagesCreate
      .mockResolvedValueOnce(toolUseResponse('search_rules', { query: 'loot action' }))
      // Second call: Claude returns text answer
      .mockResolvedValueOnce(textResponse('You pick up loot tokens.'));

    const result = await runAgentLoop('What is the loot action?');
    expect(result).toBe('You pick up loot tokens.');
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
    expect(mockSearchRules).toHaveBeenCalledWith('loot action', 6);
  });

  it('handles multiple tool calls in a single turn', async () => {
    mockMessagesCreate
      .mockResolvedValueOnce({
        content: [
          { type: 'tool_use', id: 'tool_1', name: 'search_rules', input: { query: 'loot' } },
          { type: 'tool_use', id: 'tool_2', name: 'search_cards', input: { query: 'loot' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 50 },
      })
      .mockResolvedValueOnce(textResponse('Here is what I found about loot.'));

    const result = await runAgentLoop('Tell me about loot');
    expect(result).toBe('Here is what I found about loot.');
    expect(mockSearchRules).toHaveBeenCalledWith('loot', 6);
    expect(mockSearchCards).toHaveBeenCalledWith('loot', 6);
  });

  it('handles get_card lookup', async () => {
    mockMessagesCreate
      .mockResolvedValueOnce(toolUseResponse('get_card', { type: 'items', id: 'Boots of Speed' }))
      .mockResolvedValueOnce(textResponse('Boots of Speed grants Move +1.'));

    const result = await runAgentLoop('What does Boots of Speed do?');
    expect(result).toBe('Boots of Speed grants Move +1.');
    expect(mockGetCard).toHaveBeenCalledWith('items', 'Boots of Speed');
  });

  it('handles list_card_types discovery', async () => {
    mockMessagesCreate
      .mockResolvedValueOnce(toolUseResponse('list_card_types', {}))
      .mockResolvedValueOnce(textResponse('There are items and more.'));

    const result = await runAgentLoop('What card types are available?');
    expect(result).toBe('There are items and more.');
    expect(mockListCardTypes).toHaveBeenCalled();
  });

  it('respects iteration limit', async () => {
    // Claude keeps calling tools forever
    mockMessagesCreate.mockResolvedValue(toolUseResponse('search_rules', { query: 'loop' }));

    const result = await runAgentLoop('infinite loop question');
    expect(mockMessagesCreate).toHaveBeenCalledTimes(MAX_AGENT_ITERATIONS);
    expect(result).toContain('unable to produce an answer');
  });

  it('prepends history messages', async () => {
    mockMessagesCreate.mockResolvedValue(textResponse('Follow-up answer'));
    const history = [
      { role: 'user' as const, content: 'What is loot?' },
      { role: 'assistant' as const, content: 'Loot tokens are picked up.' },
    ];

    await runAgentLoop('What about traps?', { history });
    const messages = mockMessagesCreate.mock.calls[0][0].messages;
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ role: 'user', content: 'What is loot?' });
    expect(messages[1]).toEqual({ role: 'assistant', content: 'Loot tokens are picked up.' });
    expect(messages[2]).toEqual({ role: 'user', content: 'What about traps?' });
  });

  it('truncates history to last 20 messages', async () => {
    mockMessagesCreate.mockResolvedValue(textResponse('Answer'));
    const history = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `message ${i}`,
    }));

    await runAgentLoop('Final question', { history });
    const messages = mockMessagesCreate.mock.calls[0][0].messages;
    // 20 history + 1 question = 21
    expect(messages).toHaveLength(21);
    expect(messages[0].content).toBe('message 10');
  });
});

// ─── executeToolCall ─────────────────────────────────────────────────────────

describe('executeToolCall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchRules.mockResolvedValue([{ text: 'rule text', source: 'test.pdf:1', score: 0.9 }]);
    mockSearchCards.mockReturnValue([{ type: 'items', data: { name: 'Test' }, score: 1 }]);
    mockListCardTypes.mockReturnValue([{ type: 'items', count: 5 }]);
    mockGetCard.mockReturnValue({ name: 'Test Item' });
  });

  it('dispatches search_rules', async () => {
    const result = await executeToolCall('search_rules', { query: 'loot', topK: 3 });
    expect(mockSearchRules).toHaveBeenCalledWith('loot', 3);
    expect(JSON.parse(result)).toHaveLength(1);
  });

  it('dispatches search_cards', async () => {
    const result = await executeToolCall('search_cards', { query: 'boots' });
    expect(mockSearchCards).toHaveBeenCalledWith('boots', 6);
    expect(JSON.parse(result)).toHaveLength(1);
  });

  it('dispatches list_card_types', async () => {
    const result = await executeToolCall('list_card_types', {});
    expect(mockListCardTypes).toHaveBeenCalled();
    expect(JSON.parse(result)).toEqual([{ type: 'items', count: 5 }]);
  });

  it('dispatches get_card', async () => {
    const result = await executeToolCall('get_card', { type: 'items', id: 'Test Item' });
    expect(mockGetCard).toHaveBeenCalledWith('items', 'Test Item');
    expect(JSON.parse(result)).toEqual({ name: 'Test Item' });
  });

  it('returns not found for missing card', async () => {
    mockGetCard.mockReturnValue(null);
    const result = await executeToolCall('get_card', { type: 'items', id: 'missing' });
    expect(result).toContain('Card not found');
  });

  it('returns error for unknown tool', async () => {
    const result = await executeToolCall('unknown_tool', {});
    expect(result).toContain('Unknown tool');
  });
});
