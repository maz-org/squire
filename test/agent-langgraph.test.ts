import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRunAgentLoopWithTrajectory } = vi.hoisted(() => ({
  mockRunAgentLoopWithTrajectory: vi.fn(),
}));

vi.mock('../src/agent.ts', () => ({
  runAgentLoopWithTrajectory: mockRunAgentLoopWithTrajectory,
}));

import { runLangGraphAgentLoopWithTrajectory } from '../src/agent-langgraph.ts';
import type { AgentStreamEventName } from '../src/service.ts';

describe('runLangGraphAgentLoopWithTrajectory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunAgentLoopWithTrajectory.mockImplementation(async (_question, options) => {
      await options.emit('tool_call', { name: 'find_scenario', input: { query: '61' } });
      await options.emit('text', { delta: 'Let me find scenario 61 first.' });
      await options.emit('debug', { message: 'agent_loop state update' });
      await options.emit('tool_result', {
        name: 'find_scenario',
        ok: true,
        sourceBooks: ['Scenario Book'],
      });
      await options.emit('done', {});
      return {
        answer: 'Scenario 61 is unlocked by Locked Down.',
        trajectory: {
          toolCalls: [],
          modelCalls: [],
          finalAnswer: 'Scenario 61 is unlocked by Locked Down.',
          tokenUsage: {
            inputTokens: 10,
            outputTokens: 5,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            totalTokens: 15,
          },
          model: 'claude-sonnet-4-6',
          iterations: 1,
          stopReason: 'end_turn',
        },
      };
    });
  });

  it('only emits text from the explicit final_answer node', async () => {
    const emitted: Array<[AgentStreamEventName, unknown]> = [];

    const result = await runLangGraphAgentLoopWithTrajectory('What unlocks scenario 61?', {
      emit: async (event, data) => {
        emitted.push([event, data]);
      },
      toolSurface: 'legacy',
    });

    expect(result.answer).toBe('Scenario 61 is unlocked by Locked Down.');
    expect(mockRunAgentLoopWithTrajectory).toHaveBeenCalledWith('What unlocks scenario 61?', {
      emit: expect.any(Function),
      toolSurface: 'legacy',
    });
    expect(emitted).toEqual([
      ['tool_call', { name: 'find_scenario', input: { query: '61' } }],
      ['debug', { message: 'agent_loop state update' }],
      ['tool_result', { name: 'find_scenario', ok: true, sourceBooks: ['Scenario Book'] }],
      ['text', { delta: 'Scenario 61 is unlocked by Locked Down.' }],
      ['done', {}],
    ]);
  });
});
