import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockMessagesCreate,
  mockMessagesStream,
  mockSearchKnowledge,
  mockNeighbors,
  mockOpenEntity,
  mockStartedSpans,
  mockStartActiveSpan,
} = vi.hoisted(() => ({
  mockMessagesCreate: vi.fn(),
  mockMessagesStream: vi.fn(),
  mockSearchKnowledge: vi.fn(),
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
  resolveEntity: vi.fn(),
  openEntity: mockOpenEntity,
  searchKnowledge: mockSearchKnowledge,
  neighbors: mockNeighbors,
  searchRules: vi.fn(),
  searchCards: vi.fn(),
  listCardTypes: vi.fn(),
  listCards: vi.fn(),
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
  if (typeof value !== 'string') return value;
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
    mockMessagesCreate.mockResolvedValueOnce(
      toolUseResponse('search_knowledge', {
        query: 'loot',
        scope: ['rules_passage'],
      }),
    );
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
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([expect.objectContaining({ name: 'search_knowledge' })]),
      }),
    );
    expect(mockMessagesStream).toHaveBeenCalledWith(
      expect.not.objectContaining({ tools: expect.anything() }),
    );

    const userVisibleEvents = emitted.filter(([event]) => event !== 'debug');
    expect(userVisibleEvents).toEqual([
      ['tool_progress', { message: 'Searching selected sources', toolName: 'search_knowledge' }],
      [
        'tool_call',
        { name: 'search_knowledge', input: { query: 'loot', scope: ['rules_passage'] } },
      ],
      ['tool_result', { name: 'search_knowledge', ok: true, sourceBooks: ['Rulebook'] }],
      ['text', { delta: 'Use loot abilities ' }],
      ['text', { delta: 'to pick up loot tokens.' }],
      ['done', {}],
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

    const result = await runLangGraphAgentLoopWithTrajectory(
      'What is the text of the section that unlocks scenario 61?',
      {
        emit: async () => undefined,
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
  });

  it('adds LangSmith-native root trace attributes for production LangGraph runs', async () => {
    mockMessagesCreate.mockResolvedValueOnce(
      toolUseResponse('search_knowledge', {
        query: 'loot',
        scope: ['rules_passage'],
      }),
    );
    mockMessagesStream.mockReturnValueOnce(
      mockStream(textResponse('Use loot abilities to pick up loot tokens.')),
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
      input_tokens: 180,
      output_tokens: 70,
      total_tokens: 250,
      input_token_details: { cache_creation: 0, cache_read: 0 },
    });
    expect(attributes).toMatchObject({
      'langsmith.traceable': 'true',
      'langsmith.span.kind': 'chain',
      'langsmith.trace.name': 'squire.agent.langgraph',
      'langsmith.metadata.runtime': 'langgraph',
      'langsmith.metadata.squireEnv': 'test',
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
      'squire.agent.iterations': 1,
      'squire.agent.tool_call_count': 1,
      'squire.agent.stop_reason': 'end_turn',
    });
    expect(attributes['langsmith.span.tags']).toBe(
      'agent, runtime, anthropic, langgraph, claude-sonnet-4-6, redesigned, env:test',
    );
  });
});
