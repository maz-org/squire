import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const {
  mockMessagesCreate,
  mockMessagesStream,
  mockSearchRules,
  mockSearchCards,
  mockListCardTypes,
  mockInspectSources,
  mockGetSchema,
  mockResolveEntity,
  mockGetCard,
  mockFindScenario,
  mockGetScenario,
  mockGetSection,
  mockFollowLinks,
} = vi.hoisted(() => ({
  mockMessagesCreate: vi.fn(),
  mockMessagesStream: vi.fn(),
  mockSearchRules: vi.fn(),
  mockSearchCards: vi.fn(),
  mockListCardTypes: vi.fn(),
  mockInspectSources: vi.fn(),
  mockGetSchema: vi.fn(),
  mockResolveEntity: vi.fn(),
  mockGetCard: vi.fn(),
  mockFindScenario: vi.fn(),
  mockGetScenario: vi.fn(),
  mockGetSection: vi.fn(),
  mockFollowLinks: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockMessagesCreate, stream: mockMessagesStream };
  },
}));

vi.mock('../src/tools.ts', () => ({
  searchRules: mockSearchRules,
  searchCards: mockSearchCards,
  listCardTypes: mockListCardTypes,
  inspectSources: mockInspectSources,
  getSchema: mockGetSchema,
  resolveEntity: mockResolveEntity,
  listCards: vi.fn(() => []),
  getCard: mockGetCard,
  findScenario: mockFindScenario,
  getScenario: mockGetScenario,
  getSection: mockGetSection,
  followLinks: mockFollowLinks,
}));

import { runAgentLoop, executeToolCall, AGENT_TOOLS, MAX_AGENT_ITERATIONS } from '../src/agent.ts';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a mock MessageStream that emits text deltas and resolves to a final message. */
function mockStream(finalMessage: Record<string, unknown>, textDeltas: string[] = []) {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    on(event: string, cb: (...args: unknown[]) => void) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
      // Fire text deltas immediately after registration
      if (event === 'text') {
        for (const delta of textDeltas) {
          cb(delta, '');
        }
      }
      return this;
    },
    async finalMessage() {
      return finalMessage;
    },
  };
}

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

/** Create a mock response where Claude emits scratch text before a tool call. */
function textAndToolUseResponse(
  text: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  id = 'tool_1',
) {
  return {
    content: [
      { type: 'text', text },
      { type: 'tool_use', id, name: toolName, input: toolInput },
    ],
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
    mockInspectSources.mockResolvedValue({
      ok: true,
      sources: [],
      games: [],
      defaultGame: 'frosthaven',
    });
    mockGetSchema.mockReturnValue({ ok: true, kind: 'card', fields: [] });
    mockResolveEntity.mockResolvedValue({ ok: true, query: 'Spyglass', candidates: [] });
    mockGetCard.mockReturnValue({ name: 'Boots of Speed', effect: 'Move +1' });
    mockFindScenario.mockResolvedValue([
      { ref: 'gloomhavensecretariat:scenario/061', scenarioIndex: '61', name: 'Life and Death' },
    ]);
    mockGetScenario.mockResolvedValue({
      ref: 'gloomhavensecretariat:scenario/061',
      scenarioIndex: '61',
      name: 'Life and Death',
    });
    mockGetSection.mockResolvedValue({
      ref: '67.1',
      sectionNumber: 67,
      sectionVariant: 1,
      text: 'sits on a traveling stool...',
    });
    mockFollowLinks.mockResolvedValue([
      {
        fromKind: 'scenario',
        fromRef: 'gloomhavensecretariat:scenario/061',
        toKind: 'section',
        toRef: '67.1',
        linkType: 'conclusion',
        rawLabel: null,
        rawContext: null,
        sequence: 0,
      },
    ]);
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

  it('does not persist scratch text from a tool-use turn as the final answer', async () => {
    mockMessagesCreate
      .mockResolvedValueOnce(
        textAndToolUseResponse('Let me check the scenario book.', 'search_rules', {
          query: 'scenario 61 conclusion',
        }),
      )
      .mockResolvedValueOnce(textResponse('Read section 67.1.'));

    const result = await runAgentLoop('What section unlocks scenario 61?');
    expect(result).toBe('Read section 67.1.');
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

  it('uses traversal tools for an exact scenario conclusion lookup', async () => {
    mockMessagesCreate
      .mockResolvedValueOnce(toolUseResponse('find_scenario', { query: 'scenario 61' }))
      .mockResolvedValueOnce(
        toolUseResponse('follow_links', {
          fromKind: 'scenario',
          fromRef: 'gloomhavensecretariat:scenario/061',
          linkType: 'conclusion',
        }),
      )
      .mockResolvedValueOnce(toolUseResponse('get_section', { ref: '67.1' }))
      .mockResolvedValueOnce(textResponse('Read section 67.1.'));

    const result = await runAgentLoop(
      'show the full text of the section to read at the conclusion of scenario 61',
    );
    expect(result).toBe('Read section 67.1.');
    expect(mockFindScenario).toHaveBeenCalledWith('scenario 61');
    expect(mockFollowLinks).toHaveBeenCalledWith(
      'scenario',
      'gloomhavensecretariat:scenario/061',
      'conclusion',
    );
    expect(mockGetSection).toHaveBeenCalledWith('67.1');
  });

  it('can keep following section-to-section references across multiple hops', async () => {
    mockGetSection
      .mockResolvedValueOnce({
        ref: '103.1',
        sectionNumber: 103,
        sectionVariant: 1,
        text: 'When the third episode is overcome, read 11.5.',
      })
      .mockResolvedValueOnce({
        ref: '11.5',
        sectionNumber: 11,
        sectionVariant: 5,
        text: 'The next time any character enters C, read 155.1.',
      })
      .mockResolvedValueOnce({
        ref: '155.1',
        sectionNumber: 155,
        sectionVariant: 1,
        text: 'My lovely dancers made short work of them.',
      });

    mockMessagesCreate
      .mockResolvedValueOnce(toolUseResponse('get_section', { ref: '103.1' }))
      .mockResolvedValueOnce(
        toolUseResponse('follow_links', {
          fromKind: 'section',
          fromRef: '103.1',
          linkType: 'read_now',
        }),
      )
      .mockResolvedValueOnce(toolUseResponse('get_section', { ref: '11.5' }))
      .mockResolvedValueOnce(
        toolUseResponse('follow_links', {
          fromKind: 'section',
          fromRef: '11.5',
          linkType: 'read_now',
        }),
      )
      .mockResolvedValueOnce(toolUseResponse('get_section', { ref: '155.1' }))
      .mockResolvedValueOnce(textResponse('The chain goes 103.1 -> 11.5 -> 155.1.'));

    const result = await runAgentLoop(
      'Starting from section 103.1, which section do I end up reading after following the next two explicit read instructions?',
    );

    expect(result).toBe('The chain goes 103.1 -> 11.5 -> 155.1.');
    expect(mockFollowLinks).toHaveBeenNthCalledWith(1, 'section', '103.1', 'read_now');
    expect(mockFollowLinks).toHaveBeenNthCalledWith(2, 'section', '11.5', 'read_now');
    expect(mockGetSection).toHaveBeenNthCalledWith(1, '103.1');
    expect(mockGetSection).toHaveBeenNthCalledWith(2, '11.5');
    expect(mockGetSection).toHaveBeenNthCalledWith(3, '155.1');
  });

  it('handles max_tokens by continuing', async () => {
    mockMessagesCreate
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Partial ans' }],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 100, output_tokens: 4096 },
      })
      .mockResolvedValueOnce(textResponse('Partial answer continued.'));

    const result = await runAgentLoop('Long question');
    expect(result).toBe('Partial answer continued.');
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
  });

  it('handles refusal by returning gracefully', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'I cannot help with that.' }],
      stop_reason: 'refusal',
      usage: { input_tokens: 100, output_tokens: 20 },
    });

    const result = await runAgentLoop('Bad question');
    expect(result).toBe('I cannot help with that.');
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
  });

  it('recovers from tool execution errors', async () => {
    mockSearchRules.mockRejectedValueOnce(new Error('Embedder failed'));
    mockMessagesCreate
      .mockResolvedValueOnce(toolUseResponse('search_rules', { query: 'loot' }))
      .mockResolvedValueOnce(textResponse('I encountered an error but can still help.'));

    const result = await runAgentLoop('What is loot?');
    expect(result).toBe('I encountered an error but can still help.');
    // The tool result should have been sent back as an error
    const toolResultMsg = mockMessagesCreate.mock.calls[1][0].messages.at(-1);
    expect(toolResultMsg.content[0].is_error).toBe(true);
    expect(toolResultMsg.content[0].content).toContain('Embedder failed');
  });

  it('respects iteration limit', async () => {
    // Claude keeps calling tools forever
    mockMessagesCreate.mockResolvedValue(toolUseResponse('search_rules', { query: 'loop' }));

    const result = await runAgentLoop('infinite loop question');
    expect(mockMessagesCreate).toHaveBeenCalledTimes(MAX_AGENT_ITERATIONS);
    expect(result).toContain('unable to produce an answer');
  });

  it('forces synthesis after three repeated rule searches', async () => {
    mockMessagesCreate
      .mockResolvedValueOnce(toolUseResponse('search_rules', { query: 'looting rules' }))
      .mockResolvedValueOnce(
        toolUseResponse('search_rules', {
          query: 'loot ability end-of-turn looting money tokens treasure tiles',
        }),
      )
      .mockResolvedValueOnce(
        toolUseResponse('search_rules', {
          query: 'end-of-turn looting character loot token own hex',
        }),
      )
      .mockResolvedValueOnce(textResponse('Looting means picking up loot tokens.'));

    const result = await runAgentLoop('What is looting?');

    expect(result).toBe('Looting means picking up loot tokens.');
    expect(mockSearchRules).toHaveBeenCalledTimes(3);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(4);
    expect(mockMessagesCreate.mock.calls[3][0]).not.toHaveProperty('tools');
    expect(mockMessagesCreate.mock.calls[3][0].messages.at(-1)).toEqual({
      role: 'user',
      content:
        'Use the retrieved rulebook context to answer now. Do not search again unless the existing tool results are empty or clearly unrelated.',
    });
  });

  it('keeps discovery-only tools out of repeated rule search synthesis guard', async () => {
    mockMessagesCreate
      .mockResolvedValueOnce(toolUseResponse('search_rules', { query: 'looting rules' }))
      .mockResolvedValueOnce(toolUseResponse('inspect_sources', {}))
      .mockResolvedValueOnce(
        toolUseResponse('search_rules', {
          query: 'loot ability end-of-turn looting money tokens treasure tiles',
        }),
      )
      .mockResolvedValueOnce(
        toolUseResponse('search_rules', {
          query: 'end-of-turn looting character loot token own hex',
        }),
      )
      .mockResolvedValueOnce(textResponse('Looting means picking up loot tokens.'));

    const result = await runAgentLoop('What is looting?');

    expect(result).toBe('Looting means picking up loot tokens.');
    expect(mockSearchRules).toHaveBeenCalledTimes(3);
    expect(mockInspectSources).toHaveBeenCalledTimes(1);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(5);
    expect(mockMessagesCreate.mock.calls[4][0]).not.toHaveProperty('tools');
    expect(mockMessagesCreate.mock.calls[4][0].messages.at(-1)).toEqual({
      role: 'user',
      content:
        'Use the retrieved rulebook context to answer now. Do not search again unless the existing tool results are empty or clearly unrelated.',
    });
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
    mockInspectSources.mockResolvedValue({
      ok: true,
      sources: [],
      games: [],
      defaultGame: 'frosthaven',
    });
    mockGetSchema.mockReturnValue({ ok: true, kind: 'card', fields: [] });
    mockResolveEntity.mockResolvedValue({ ok: true, query: 'Spyglass', candidates: [] });
    mockGetCard.mockReturnValue({ name: 'Test Item' });
    mockFindScenario.mockResolvedValue([{ ref: 'gloomhavensecretariat:scenario/061' }]);
    mockGetScenario.mockResolvedValue({ ref: 'gloomhavensecretariat:scenario/061' });
    mockGetSection.mockResolvedValue({ ref: '67.1' });
    mockFollowLinks.mockResolvedValue([{ toRef: '67.1' }]);
  });

  it('dispatches search_rules', async () => {
    const result = await executeToolCall('search_rules', { query: 'loot', topK: 3 });
    expect(mockSearchRules).toHaveBeenCalledWith('loot', 3);
    expect(JSON.parse(result.content)).toHaveLength(1);
  });

  it('search_rules populates sourceBooks from per-result sourceLabel', async () => {
    mockSearchRules.mockResolvedValue([
      { text: 'Rule A', source: 'rulebook.pdf:1', score: 0.9, sourceLabel: 'Rulebook' },
      { text: 'Rule B', source: 'section-a.pdf:2', score: 0.8, sourceLabel: 'Section Book A' },
      { text: 'Rule C', source: 'rulebook.pdf:3', score: 0.7, sourceLabel: 'Rulebook' },
    ]);
    const result = await executeToolCall('search_rules', { query: 'loot' });
    // Deduplicated: Rulebook appeared twice but should be in sourceBooks once.
    expect(result.sourceBooks).toEqual(['Rulebook', 'Section Book A']);
  });

  it('search_rules returns sourceBooks: [] when results have no sourceLabel', async () => {
    mockSearchRules.mockResolvedValue([
      { text: 'Rule A', source: 'rulebook.pdf:1', score: 0.9 },
      { text: 'Rule B', source: 'section-a.pdf:2', score: 0.8 },
    ]);
    const result = await executeToolCall('search_rules', { query: 'loot' });
    // Empty array (not undefined) so callers know search ran but found no book labels.
    expect(result.sourceBooks).toEqual([]);
  });

  it('search_rules returns sourceBooks: [] when results array is empty', async () => {
    mockSearchRules.mockResolvedValue([]);
    const result = await executeToolCall('search_rules', { query: 'loot' });
    expect(result.sourceBooks).toEqual([]);
  });

  it('dispatches search_cards', async () => {
    const result = await executeToolCall('search_cards', { query: 'boots' });
    expect(mockSearchCards).toHaveBeenCalledWith('boots', 6);
    expect(JSON.parse(result.content)).toHaveLength(1);
  });

  it('dispatches list_card_types', async () => {
    const result = await executeToolCall('list_card_types', {});
    expect(mockListCardTypes).toHaveBeenCalled();
    expect(JSON.parse(result.content)).toEqual([{ type: 'items', count: 5 }]);
  });

  it('dispatches inspect_sources', async () => {
    const result = await executeToolCall('inspect_sources', {});
    expect(mockInspectSources).toHaveBeenCalled();
    expect(JSON.parse(result.content)).toEqual({
      ok: true,
      sources: [],
      games: [],
      defaultGame: 'frosthaven',
    });
  });

  it('dispatches schema', async () => {
    const result = await executeToolCall('schema', { kind: 'item' });
    expect(mockGetSchema).toHaveBeenCalledWith('item');
    expect(JSON.parse(result.content)).toEqual({ ok: true, kind: 'card', fields: [] });
  });

  it('dispatches resolve_entity', async () => {
    const result = await executeToolCall('resolve_entity', {
      query: 'Spyglass',
      kinds: ['card'],
      limit: 3,
    });
    expect(mockResolveEntity).toHaveBeenCalledWith('Spyglass', {
      kinds: ['card'],
      limit: 3,
    });
    expect(JSON.parse(result.content)).toEqual({
      ok: true,
      query: 'Spyglass',
      candidates: [],
    });
  });

  it('dispatches get_card', async () => {
    const result = await executeToolCall('get_card', { type: 'items', id: 'Test Item' });
    expect(mockGetCard).toHaveBeenCalledWith('items', 'Test Item');
    expect(JSON.parse(result.content)).toEqual({ name: 'Test Item' });
  });

  it('returns not found for missing card', async () => {
    mockGetCard.mockReturnValue(null);
    const result = await executeToolCall('get_card', { type: 'items', id: 'missing' });
    expect(result.content).toContain('Card not found');
  });

  it('dispatches find_scenario', async () => {
    const result = await executeToolCall('find_scenario', { query: 'scenario 61' });
    expect(mockFindScenario).toHaveBeenCalledWith('scenario 61');
    expect(JSON.parse(result.content)).toEqual([{ ref: 'gloomhavensecretariat:scenario/061' }]);
  });

  it('dispatches get_scenario', async () => {
    const result = await executeToolCall('get_scenario', {
      ref: 'gloomhavensecretariat:scenario/061',
    });
    expect(mockGetScenario).toHaveBeenCalledWith('gloomhavensecretariat:scenario/061');
    expect(JSON.parse(result.content)).toEqual({ ref: 'gloomhavensecretariat:scenario/061' });
  });

  it('dispatches get_section', async () => {
    const result = await executeToolCall('get_section', { ref: '67.1' });
    expect(mockGetSection).toHaveBeenCalledWith('67.1');
    expect(JSON.parse(result.content)).toEqual({ ref: '67.1' });
  });

  it('dispatches follow_links', async () => {
    const result = await executeToolCall('follow_links', {
      fromKind: 'scenario',
      fromRef: 'gloomhavensecretariat:scenario/061',
      linkType: 'conclusion',
    });
    expect(mockFollowLinks).toHaveBeenCalledWith(
      'scenario',
      'gloomhavensecretariat:scenario/061',
      'conclusion',
    );
    expect(JSON.parse(result.content)).toEqual([{ toRef: '67.1' }]);
  });

  it('returns error for unknown tool', async () => {
    const result = await executeToolCall('unknown_tool', {});
    expect(result.content).toContain('Unknown tool');
  });
});

// ─── streaming ───────────────────────────────────────────────────────────────

describe('runAgentLoop with emit (streaming)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchRules.mockResolvedValue([
      { text: 'Loot: pick up all loot tokens.', source: 'rulebook.pdf:42', score: 0.9 },
    ]);
    mockSearchCards.mockReturnValue([]);
    mockGetCard.mockReturnValue({ name: 'Boots of Speed', effect: 'Move +1' });
  });

  it('uses stream() instead of create() when emit is provided', async () => {
    const msg = textResponse('Streamed answer');
    mockMessagesStream.mockReturnValue(mockStream(msg, ['Streamed ', 'answer']));
    const emit = vi.fn().mockResolvedValue(undefined);

    await runAgentLoop('test', { emit });
    expect(mockMessagesStream).toHaveBeenCalledTimes(1);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('emits text deltas', async () => {
    const msg = textResponse('Hello world');
    mockMessagesStream.mockReturnValue(mockStream(msg, ['Hello ', 'world']));
    const emit = vi.fn().mockResolvedValue(undefined);

    await runAgentLoop('test', { emit });
    expect(emit).toHaveBeenCalledWith('text', { delta: 'Hello ' });
    expect(emit).toHaveBeenCalledWith('text', { delta: 'world' });
  });

  it('emits done event at the end', async () => {
    const msg = textResponse('Done');
    mockMessagesStream.mockReturnValue(mockStream(msg, ['Done']));
    const emit = vi.fn().mockResolvedValue(undefined);

    await runAgentLoop('test', { emit });
    expect(emit).toHaveBeenCalledWith('done', {});
  });

  it('emits tool_call and tool_result events', async () => {
    const toolMsg = toolUseResponse('search_rules', { query: 'loot' });
    const finalMsg = textResponse('Answer');
    mockMessagesStream
      .mockReturnValueOnce(mockStream(toolMsg))
      .mockReturnValueOnce(mockStream(finalMsg, ['Answer']));
    const emit = vi.fn().mockResolvedValue(undefined);

    await runAgentLoop('test', { emit });
    expect(emit).toHaveBeenCalledWith('tool_call', {
      name: 'search_rules',
      input: { query: 'loot' },
    });
    expect(emit).toHaveBeenCalledWith('tool_result', {
      name: 'search_rules',
      ok: true,
      sourceBooks: [],
    });
    expect(emit).toHaveBeenCalledWith('done', {});
  });

  it('does not treat streamed scratch text before tool use as the final answer', async () => {
    const toolMsg = textAndToolUseResponse('Let me look that up.', 'search_rules', {
      query: 'scenario 61 conclusion',
    });
    const finalMsg = textResponse('Read section 67.1.');
    mockMessagesStream
      .mockReturnValueOnce(mockStream(toolMsg, ['Let me ', 'look that up.']))
      .mockReturnValueOnce(mockStream(finalMsg, ['Read section 67.1.']));
    const emit = vi.fn().mockResolvedValue(undefined);

    const result = await runAgentLoop('test', { emit });
    expect(result).toBe('Read section 67.1.');
  });
});
