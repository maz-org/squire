import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockMessagesCreate,
  mockMessagesStream,
  mockSearchKnowledge,
  mockNeighbors,
  mockOpenEntity,
} = vi.hoisted(() => ({
  mockMessagesCreate: vi.fn(),
  mockMessagesStream: vi.fn(),
  mockSearchKnowledge: vi.fn(),
  mockNeighbors: vi.fn(),
  mockOpenEntity: vi.fn(),
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

describe.sequential('runLangGraphAgentLoopWithTrajectory', () => {
  beforeEach(() => {
    vi.resetAllMocks();
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
    mockMessagesCreate.mockResolvedValueOnce(
      textResponse('I have enough evidence to answer from the rulebook result.'),
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
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
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
      )
      .mockResolvedValueOnce(textResponse('I have the target section content.'));
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
    expect(mockMessagesCreate).toHaveBeenCalledTimes(3);
    expect(mockOpenEntity).toHaveBeenCalledWith('section:frosthaven/79.4');
    expect(result.trajectory.toolCalls.map((call) => call.name)).toEqual([
      'neighbors',
      'open_entity',
    ]);
  });
});
