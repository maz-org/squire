import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockChatAnthropic, mockCreateDeepAgent, mockExecuteToolCall, mockStateBackend, mockTool } =
  vi.hoisted(() => ({
    mockChatAnthropic: vi.fn(),
    mockCreateDeepAgent: vi.fn(),
    mockExecuteToolCall: vi.fn(),
    mockStateBackend: vi.fn(),
    mockTool: vi.fn((func, fields) => ({ ...fields, func })),
  }));

vi.mock('@langchain/anthropic', () => ({
  ChatAnthropic: mockChatAnthropic,
}));

vi.mock('@langchain/core/tools', () => ({
  tool: mockTool,
}));

vi.mock('deepagents', () => ({
  createDeepAgent: mockCreateDeepAgent,
  StateBackend: mockStateBackend,
}));

vi.mock('../src/agent.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/agent.ts')>();
  return {
    ...actual,
    executeToolCall: mockExecuteToolCall,
  };
});

import { runDeepAgentsEvalCase } from '../eval/deep-agents-runner.ts';

function nextNow() {
  const values = [
    new Date('2026-05-04T00:00:00.000Z'),
    new Date('2026-05-04T00:00:00.125Z'),
    new Date('2026-05-04T00:00:00.250Z'),
    new Date('2026-05-04T00:00:01.000Z'),
  ];
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
}

describe('Deep Agents eval runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteToolCall.mockResolvedValue({
      content: JSON.stringify({ ok: true, ref: 'card:frosthaven/item/1' }),
      sourceBooks: ['Item 1'],
    });
    mockCreateDeepAgent.mockImplementation((params) => {
      return {
        invoke: async () => {
          const inspectSources = params.tools.find(
            (candidate: { name: string }) => candidate.name === 'inspect_sources',
          );
          await inspectSources.func({});
          return {
            messages: [
              new AIMessage({
                content: 'Spyglass reveals the top monster ability card.',
                response_metadata: {
                  model_name: 'claude-sonnet-4-6',
                  stop_reason: 'end_turn',
                },
                usage_metadata: {
                  input_tokens: 100,
                  output_tokens: 25,
                  total_tokens: 125,
                  input_token_details: { cache_read: 10, cache_creation: 5 },
                },
                tool_calls: [{ id: 'todo-1', name: 'write_todos', args: { todos: [] } }],
              }),
              new ToolMessage({
                content: 'todos updated',
                tool_call_id: 'todo-1',
                status: 'success',
              }),
            ],
          };
        },
      };
    });
  });

  it('creates a fresh state-backed Deep Agent and writes runtime-aware traces', async () => {
    const traceClient = { api: { ingestion: { batch: vi.fn() } } };

    const result = await runDeepAgentsEvalCase({
      case: {
        id: 'item-spyglass',
        category: 'card-data',
        question: 'What does Spyglass do?',
      },
      runLabel: 'runtime-smoke',
      toolSurface: 'redesigned',
      providerConfig: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        reasoningEffort: undefined,
        maxOutputTokens: undefined,
        timeoutMs: undefined,
        toolLoopLimit: undefined,
      },
      traceClient,
      traceId: 'eval:runtime-smoke:deep-agents:anthropic:claude-sonnet-4-6:item-spyglass',
      judgeScores: [{ name: 'pass', value: 'pass' }],
      now: nextNow(),
    });

    expect(mockCreateDeepAgent).toHaveBeenCalledTimes(1);
    expect(mockStateBackend).toHaveBeenCalledTimes(1);
    expect(mockExecuteToolCall).toHaveBeenCalledWith('inspect_sources', {});
    expect(result.trace).toMatchObject({
      agentRuntime: 'deep-agents',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      finalAnswer: 'Spyglass reveals the top monster ability card.',
    });
    expect(result.trajectory.toolCalls.map((call) => call.name)).toEqual([
      'inspect_sources',
      'deep_agents.write_todos',
    ]);
    expect(traceClient.api.ingestion.batch).toHaveBeenCalledWith(
      expect.objectContaining({
        batch: expect.arrayContaining([
          expect.objectContaining({
            body: expect.objectContaining({
              metadata: expect.objectContaining({ agentRuntime: 'deep-agents' }),
            }),
          }),
        ]),
      }),
    );
  });
});
