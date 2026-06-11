import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockMessagesCreate,
  mockMessagesStream,
  mockSearchKnowledge,
  mockListCards,
  mockResolveEntity,
  mockLookupEntity,
  mockNeighbors,
  mockOpenEntity,
  mockStartedSpans,
  mockStartActiveSpan,
} = vi.hoisted(() => ({
  mockMessagesCreate: vi.fn(),
  mockMessagesStream: vi.fn(),
  mockSearchKnowledge: vi.fn(),
  mockListCards: vi.fn(),
  mockResolveEntity: vi.fn(),
  mockLookupEntity: vi.fn(),
  mockNeighbors: vi.fn(),
  mockOpenEntity: vi.fn(),
  mockStartedSpans: [] as Array<{ name: string; span: { attributes: Record<string, unknown> } }>,
  mockStartActiveSpan: vi.fn((name: string, ...args: unknown[]) => {
    const callback = args.find((arg) => typeof arg === 'function') as
      | ((span: {
          attributes: Record<string, unknown>;
          setAttributes: (attributes: Record<string, unknown>) => void;
          recordException: (error: unknown) => void;
          setStatus: (status: unknown) => void;
          end: () => void;
        }) => unknown)
      | undefined;
    if (!callback) throw new Error(`No span callback for ${name}`);

    const attributes: Record<string, unknown> = {};
    const span = {
      attributes,
      setAttributes: (nextAttributes: Record<string, unknown>) => {
        Object.assign(attributes, nextAttributes);
      },
      recordException: vi.fn(),
      setStatus: vi.fn(),
      end: vi.fn(),
    };
    mockStartedSpans.push({ name, span });
    return callback(span);
  }),
}));

vi.mock('@opentelemetry/api', () => ({
  SpanStatusCode: { ERROR: 2 },
  trace: {
    getTracer: () => ({
      startActiveSpan: mockStartActiveSpan,
    }),
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockMessagesCreate, stream: mockMessagesStream };
  },
}));

vi.mock('../src/tools.ts', () => ({
  inspectSources: vi.fn(),
  getSchema: vi.fn(),
  resolveEntity: mockResolveEntity,
  lookupEntity: mockLookupEntity,
  openEntity: mockOpenEntity,
  searchKnowledge: mockSearchKnowledge,
  neighbors: mockNeighbors,
  searchRules: vi.fn(),
  searchCards: vi.fn(),
  listCardTypes: vi.fn(),
  listCards: mockListCards,
  getCard: vi.fn(),
  findScenario: vi.fn(),
  getScenario: vi.fn(),
  getSection: vi.fn(),
  followLinks: vi.fn(),
}));

import { runLangGraphAgentLoopWithTrajectory } from '../src/agent-langgraph.ts';
import type { AgentStreamEventName } from '../src/service.ts';

function toolUseResponse(toolName: string, toolInput: Record<string, unknown>, id = 'tool_1') {
  return {
    content: [{ type: 'tool_use', id, name: toolName, input: toolInput }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

function textResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 80, output_tokens: 20 },
  };
}

function mockStream(finalMessage: Record<string, unknown>, textDeltas: string[] = []) {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    on(event: string, cb: (...args: unknown[]) => void) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
      if (event === 'text') {
        for (const delta of textDeltas) cb(delta, '');
      }
      return this;
    },
    async finalMessage() {
      return finalMessage;
    },
  };
}

function spanAttributes(name: string): Record<string, unknown> {
  const record = mockStartedSpans.find((entry) => entry.name === name);
  if (!record) throw new Error(`No span named ${name}`);
  return record.span.attributes;
}

function parseJsonAttribute(attributes: Record<string, unknown>, key: string): unknown {
  const value = attributes[key];
  if (typeof value !== 'string') throw new Error(`Expected ${key} to be a JSON string attribute.`);
  return JSON.parse(value);
}

describe.sequential('runLangGraphAgentLoopWithTrajectory', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockStartedSpans.length = 0;
    mockSearchKnowledge.mockResolvedValue({
      ok: true,
      query: 'loot',
      results: [
        {
          entity: {
            kind: 'rules_passage',
            ref: 'rules:frosthaven/rulebook#chunk=1',
            title: 'Loot',
            sourceLabel: 'Rulebook',
          },
          score: 0.9,
          snippet: 'Loot tokens are picked up during loot abilities.',
          citations: [{ sourceRef: 'rulebook.pdf', sourceLabel: 'Rulebook', locator: 'p. 42' }],
          nextRefs: [],
        },
      ],
    });
    mockNeighbors.mockResolvedValue({
      ok: true,
      ref: 'scenario:frosthaven/060',
      neighbors: [
        {
          ref: 'section:frosthaven/79.4',
          title: 'Locked Down',
          kind: 'section',
          linkType: 'unlock',
        },
      ],
    });
    mockOpenEntity.mockResolvedValue({
      ok: true,
      entity: {
        kind: 'section',
        ref: 'section:frosthaven/79.4',
        title: 'Locked Down',
        data: { text: 'New Scenario: Life and Death - 61' },
      },
      citations: [{ sourceRef: 'section-book.pdf', sourceLabel: 'Section Book' }],
    });
  });

  it('runs a staged graph and emits answer text only from final_answer', async () => {
    mockMessagesCreate
      .mockResolvedValueOnce(
        toolUseResponse('search_knowledge', {
          query: 'loot',
          scope: ['rules_passage', 'section', 'card'],
        }),
      )
      .mockResolvedValueOnce(textResponse('Use loot abilities to pick up loot tokens.'));
    mockMessagesStream.mockReturnValueOnce(
      mockStream(textResponse('Use loot abilities to pick up loot tokens.'), [
        'Use loot abilities ',
        'to pick up loot tokens.',
      ]),
    );
    const emitted: Array<[AgentStreamEventName, unknown]> = [];

    const result = await runLangGraphAgentLoopWithTrajectory('How does loot work?', {
      emit: async (event, data) => {
        emitted.push([event, data]);
      },
      toolSurface: 'legacy',
      userMessageId: 'message-1',
    });

    expect(result.answer).toBe('Use loot abilities to pick up loot tokens.');
    expect(result.trajectory.model).toBe('langgraph:claude-sonnet-4-6');
    expect(result.trajectory.toolCalls).toHaveLength(1);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
    expect(mockMessagesStream).toHaveBeenCalledTimes(1);
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([expect.objectContaining({ name: 'search_knowledge' })]),
      }),
    );
    const userVisibleEvents = emitted.filter(([event]) => event !== 'debug');
    expect(userVisibleEvents).toEqual([
      [
        'tool_plan',
        {
          message: "I'll search the rulebook, the section book, and the cards.",
          toolName: 'search_knowledge',
        },
      ],
      ['tool_progress', { message: 'Searching available sources', toolName: 'search_knowledge' }],
      [
        'tool_call',
        {
          name: 'search_knowledge',
          input: { query: 'loot', scope: ['rules_passage', 'section', 'card'] },
        },
      ],
      [
        'tool_result',
        {
          name: 'search_knowledge',
          ok: true,
          message: 'Searched available sources',
          sourceBooks: ['Rulebook'],
        },
      ],
      ['text', { delta: 'Use loot abilities ' }],
      ['text', { delta: 'to pick up loot tokens.' }],
      ['done', {}],
    ]);
  });

  it('does not expose post-tool retrieval prose as the final answer', async () => {
    mockMessagesCreate
      .mockResolvedValueOnce(
        toolUseResponse('list_cards', {
          type: 'monster-stats',
          filter: { name: 'Living Spirit' },
        }),
      )
      .mockResolvedValueOnce(
        textResponse('The stat card only covers levels 0-3. I need to check levels 4-7.'),
      )
      .mockResolvedValueOnce(textResponse('An elite level 7 Living Spirit has 10 hit points.'));
    mockListCards.mockResolvedValueOnce([
      {
        name: 'Living Spirit',
        levelRange: '0-3',
        sourceId: 'gloomhavensecretariat:monster-stat/living-spirit/0-3',
      },
      {
        name: 'Living Spirit',
        levelRange: '4-7',
        sourceId: 'gloomhavensecretariat:monster-stat/living-spirit/4-7',
        elite: { '7': { hp: 10, move: 4, attack: 6 } },
      },
    ]);

    const result = await runLangGraphAgentLoopWithTrajectory(
      'How many hit points does an elite level 7 Living Spirit have?',
      {
        toolSurface: 'redesigned',
        userMessageId: 'message-living-spirit',
      },
    );

    expect(result.answer).toBe('An elite level 7 Living Spirit has 10 hit points.');
    expect(mockMessagesCreate).toHaveBeenCalledTimes(3);
  });

  it('emits card lookup intent before the card work row can render', async () => {
    const cardRef =
      'card:gloomhaven-2e/monster-stats/gloomhavensecretariat:monster-stat/bandit-archer/0-3';
    mockMessagesCreate.mockResolvedValueOnce(
      toolUseResponse('lookup_entity', {
        query: 'Bandit Archer monster stat card',
        kinds: ['monster-stat'],
      }),
    );
    mockMessagesStream.mockReturnValueOnce(
      mockStream(textResponse('An elite level 3 Bandit Archer has 10 hit points.'), [
        'An elite level 3 Bandit Archer has 10 hit points.',
      ]),
    );
    mockLookupEntity.mockResolvedValueOnce({
      ok: true,
      entity: {
        kind: 'card',
        ref: cardRef,
        title: 'Bandit Archer',
        sourceLabel: 'Card Index',
        data: { normal: { hp: 6 }, elite: { hp: 10 } },
      },
      citations: [{ sourceRef: 'cards.json', sourceLabel: 'Card Index', locator: cardRef }],
      links: [],
      related: [],
    });
    const emitted: Array<[AgentStreamEventName, unknown]> = [];

    const result = await runLangGraphAgentLoopWithTrajectory(
      'How many hit points does an elite level 3 Bandit Archer have?',
      {
        emit: async (event, data) => {
          emitted.push([event, data]);
        },
        toolSurface: 'redesigned',
        userMessageId: 'message-bandit-card',
      },
    );

    expect(result.answer).toBe('An elite level 3 Bandit Archer has 10 hit points.');
    expect(result.trajectory.toolCalls.map((call) => call.name)).toEqual(['lookup_entity']);
    const visibleEvents = emitted.filter(([event]) => event !== 'debug');
    expect(visibleEvents).not.toContainEqual([
      'tool_plan',
      expect.objectContaining({ toolName: 'resolve_entity' }),
    ]);
    expect(visibleEvents).not.toContainEqual([
      'tool_progress',
      expect.objectContaining({ toolName: 'resolve_entity' }),
    ]);
    expect(visibleEvents).not.toContainEqual([
      'tool_result',
      expect.objectContaining({ name: 'resolve_entity' }),
    ]);
    expect(
      visibleEvents.filter(([event]) =>
        ['tool_plan', 'tool_progress', 'tool_result'].includes(event),
      ),
    ).toEqual([
      [
        'tool_plan',
        {
          message: "I'll check that stat card.",
          toolName: 'lookup_entity',
        },
      ],
      [
        'tool_result',
        {
          name: 'lookup_entity',
          ok: true,
          message: 'Checked Bandit Archer stat card',
          sourceBooks: ['Card Index'],
        },
      ],
    ]);
  });

  it('keeps scenario resolution silent until the scenario book is opened', async () => {
    mockMessagesCreate
      .mockResolvedValueOnce(
        toolUseResponse('resolve_entity', {
          query: 'scenario 61',
          kinds: ['scenario'],
        }),
      )
      .mockResolvedValueOnce(
        toolUseResponse('open_entity', { ref: 'scenario:frosthaven/061' }, 'tool_open_scenario'),
      );
    mockMessagesStream.mockReturnValueOnce(
      mockStream(textResponse('Scenario 61 is Dangerous Grove.'), [
        'Scenario 61 ',
        'is Dangerous Grove.',
      ]),
    );
    mockResolveEntity.mockResolvedValueOnce({
      query: 'scenario 61',
      candidates: [
        {
          entity: {
            kind: 'scenario',
            ref: 'scenario:frosthaven/061',
            title: 'Scenario 61',
            sourceLabel: 'Scenario Book',
          },
          confidence: 0.99,
          matchReason: 'Exact scenario match',
        },
      ],
    });
    mockOpenEntity.mockResolvedValueOnce({
      ok: true,
      entity: {
        kind: 'scenario',
        ref: 'scenario:frosthaven/061',
        title: 'Scenario 61',
        data: { name: 'Dangerous Grove' },
      },
      citations: [{ sourceRef: 'scenario-book.json', sourceLabel: 'Scenario Book' }],
    });
    const emitted: Array<[AgentStreamEventName, unknown]> = [];

    const result = await runLangGraphAgentLoopWithTrajectory('What is scenario 61?', {
      emit: async (event, data) => {
        emitted.push([event, data]);
      },
      toolSurface: 'redesigned',
      userMessageId: 'message-scenario-61',
    });

    expect(result.answer).toBe('Scenario 61 is Dangerous Grove.');
    const workEvents = emitted.filter(([event]) =>
      ['tool_plan', 'tool_progress', 'tool_result'].includes(event),
    );
    expect(workEvents).toEqual([
      [
        'tool_plan',
        {
          message: "I'll look that up in the scenario book.",
          toolName: 'open_entity',
        },
      ],
      [
        'tool_result',
        {
          name: 'open_entity',
          ok: true,
          message: 'Looked up scenario 61 in the scenario book',
          sourceBooks: ['Scenario Book'],
        },
      ],
    ]);
  });

  it('continues after neighbors before finalizing answers that need target content', async () => {
    mockMessagesCreate
      .mockResolvedValueOnce(toolUseResponse('neighbors', { ref: 'scenario:frosthaven/060' }))
      .mockResolvedValueOnce(
        toolUseResponse('open_entity', { ref: 'section:frosthaven/79.4' }, 'tool_open_section'),
      );
    mockMessagesStream.mockReturnValueOnce(
      mockStream(textResponse('Section 79.4 unlocks Scenario 61.'), [
        'Section 79.4 unlocks ',
        'Scenario 61.',
      ]),
    );
    const emitted: Array<[AgentStreamEventName, unknown]> = [];

    const result = await runLangGraphAgentLoopWithTrajectory(
      'What is the text of the section that unlocks scenario 61?',
      {
        emit: async (event, data) => {
          emitted.push([event, data]);
        },
        toolSurface: 'redesigned',
        userMessageId: 'message-neighbors',
      },
    );

    expect(result.answer).toBe('Section 79.4 unlocks Scenario 61.');
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
    expect(mockOpenEntity).toHaveBeenCalledWith('section:frosthaven/79.4');
    expect(result.trajectory.toolCalls.map((call) => call.name)).toEqual([
      'neighbors',
      'open_entity',
    ]);
    expect(emitted).toContainEqual([
      'tool_plan',
      {
        message: "I'll look that up in the section book.",
        toolName: 'open_entity',
      },
    ]);
  });

  it('adds LangSmith-native root trace attributes for production LangGraph runs', async () => {
    mockMessagesCreate
      .mockResolvedValueOnce(
        toolUseResponse('search_knowledge', {
          query: 'loot',
          scope: ['rules_passage'],
        }),
      )
      .mockResolvedValueOnce(textResponse('I found the loot rule.'));
    mockMessagesStream.mockReturnValueOnce(
      mockStream(textResponse('Use loot abilities to pick up loot tokens.'), [
        'Use loot abilities to pick up loot tokens.',
      ]),
    );

    await runLangGraphAgentLoopWithTrajectory('How does loot work?', {
      emit: async () => undefined,
      toolSurface: 'redesigned',
      requestId: 'req-langgraph',
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
      userMessageId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      userId: '7ba7b810-9dad-11d1-80b4-00c04fd430c8',
      game: 'frosthaven',
    });

    const attributes = spanAttributes('squire.agent.langgraph.run');
    expect(parseJsonAttribute(attributes, 'gen_ai.prompt')).toEqual({
      question: 'How does loot work?',
    });
    expect(parseJsonAttribute(attributes, 'gen_ai.completion')).toEqual({
      finalAnswer: 'Use loot abilities to pick up loot tokens.',
    });
    expect(parseJsonAttribute(attributes, 'langsmith.usage_metadata')).toEqual({
      input_tokens: 260,
      output_tokens: 90,
      total_tokens: 350,
      input_token_details: { cache_creation: 0, cache_read: 0 },
    });
    expect(attributes).toMatchObject({
      'langsmith.traceable': 'true',
      'langsmith.span.kind': 'chain',
      'langsmith.trace.name': 'squire.agent.langgraph',
      'langsmith.metadata.runtime': 'langgraph',
      'langsmith.metadata.squireEnv': 'test',
      'langsmith.metadata.thread_id': '550e8400-e29b-41d4-a716-446655440000',
      'langsmith.metadata.requestId': 'req-langgraph',
      'langsmith.metadata.conversationId': '550e8400-e29b-41d4-a716-446655440000',
      'langsmith.metadata.userMessageId': '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      'langsmith.metadata.userId': '7ba7b810-9dad-11d1-80b4-00c04fd430c8',
      'langsmith.metadata.game': 'frosthaven',
      'squire.env': 'test',
      'squire.request_id': 'req-langgraph',
      'squire.conversation_id': '550e8400-e29b-41d4-a716-446655440000',
      'squire.user_message_id': '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      'squire.user_id': '7ba7b810-9dad-11d1-80b4-00c04fd430c8',
      'squire.game': 'frosthaven',
      'squire.agent.runtime': 'langgraph',
      'squire.agent.iterations': 2,
      'squire.agent.tool_call_count': 1,
      'squire.agent.stop_reason': 'end_turn',
      'squire.agent.input_tokens': 260,
      'squire.agent.output_tokens': 90,
      'squire.agent.cache_creation_input_tokens': 0,
      'squire.agent.cache_read_input_tokens': 0,
    });
    expect(attributes['langsmith.span.tags']).toBe(
      'agent, runtime, anthropic, langgraph, claude-sonnet-4-6, redesigned, env:test',
    );
  });
});
