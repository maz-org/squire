import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCreateOpenAiResponsesClient,
  mockRunAnthropicEvalCase,
  mockRunOpenAiResponsesEvalCase,
  mockTraceScoresForEvalResult,
} = vi.hoisted(() => ({
  mockCreateOpenAiResponsesClient: vi.fn(),
  mockRunAnthropicEvalCase: vi.fn(),
  mockRunOpenAiResponsesEvalCase: vi.fn(),
  mockTraceScoresForEvalResult: vi.fn(),
}));

vi.mock('../eval/anthropic-runner.ts', () => ({
  runAnthropicEvalCase: mockRunAnthropicEvalCase,
}));

vi.mock('../eval/openai-runner.ts', () => ({
  createOpenAiResponsesClient: mockCreateOpenAiResponsesClient,
  runOpenAiResponsesEvalCase: mockRunOpenAiResponsesEvalCase,
}));

vi.mock('../eval/scoring.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../eval/scoring.ts')>();
  return {
    ...actual,
    traceScoresForEvalResult: mockTraceScoresForEvalResult,
  };
});

import { createEvalMatrixRunner } from '../eval/matrix-runtime.ts';
import type { EvalMatrixRunnerInput } from '../eval/matrix.ts';
import type { EvalCase } from '../eval/schema.ts';
import type { EvalTraceInput } from '../eval/trace.ts';

const evalCase: EvalCase = {
  id: 'item-spyglass',
  category: 'card-data',
  source: 'unit-test',
  question: 'What does Spyglass do?',
  finalAnswer: {
    expected: 'Spyglass reveals cards.',
    grading: 'Mentions Spyglass effect.',
  },
};

function trace(overrides: Partial<EvalTraceInput> = {}): EvalTraceInput {
  return {
    traceId: 'matrix-trace',
    runLabel: 'matrix-run',
    datasetName: 'squire-evals',
    caseId: evalCase.id,
    caseCategory: evalCase.category,
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    resolvedModel: 'claude-sonnet-4-6',
    promptVersion: 'redesigned-agent-v1',
    promptHash: 'sha256:test',
    toolSurface: 'redesigned',
    toolSchemaVersion: 'test-tools',
    toolSchemaHash: 'sha256:tools',
    modelSettings: {},
    inputQuestion: evalCase.question,
    finalAnswer: 'Spyglass reveals the top card.',
    statusReason: 'completed',
    stopReason: 'end_turn',
    startedAt: '2026-05-01T00:00:00.000Z',
    endedAt: '2026-05-01T00:00:01.000Z',
    durationMs: 1000,
    providerRequest: {},
    providerResponse: {},
    providerNativeTranscript: {},
    tokenUsage: { input: 10, output: 5, total: 15 },
    costEstimate: { totalUsd: 0.01 },
    errors: [],
    retries: [],
    toolCalls: [{ toolName: 'search_cards', callIndex: 0, arguments: {}, result: {}, ok: true }],
    judgeScores: [
      { name: 'failure_class', value: 'none' },
      { name: 'correctness', value: 0.8 },
      { name: 'pass', value: 'pass' },
      { name: 'loop_iterations', value: 2 },
    ],
    ...overrides,
  };
}

function input(provider: 'anthropic' | 'openai'): EvalMatrixRunnerInput {
  return {
    evalCase,
    providerConfig: {
      provider,
      model: provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-5.5',
      reasoningEffort: undefined,
      maxOutputTokens: undefined,
      timeoutMs: undefined,
      toolLoopLimit: undefined,
    },
    runLabel: 'matrix-run',
    toolSurface: 'redesigned',
    traceId: `${provider}-trace`,
    traceUrl: `https://langfuse.test/traces/${provider}-trace`,
    attempt: 1,
  };
}

describe('eval matrix runtime adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateOpenAiResponsesClient.mockReturnValue({ responses: { create: vi.fn() } });
    mockTraceScoresForEvalResult.mockResolvedValue([
      { name: 'correctness', value: 0.8 },
      { name: 'pass', value: 'pass' },
    ]);
  });

  it('adapts Anthropic trace output into matrix summary rows', async () => {
    mockRunAnthropicEvalCase.mockResolvedValue({
      answer: 'Spyglass reveals the top card.',
      trajectory: { toolCalls: [] },
      durationMs: 1000,
      toolSurface: 'redesigned',
      traceId: 'anthropic-trace',
      trace: trace({ traceId: 'anthropic-trace' }),
    });

    const runner = createEvalMatrixRunner({} as never, { OPENAI_API_KEY: 'test-key' });
    const output = await runner(input('anthropic'));

    expect(mockRunAnthropicEvalCase).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'anthropic-trace',
        runLabel: 'matrix-run',
        traceClient: {},
      }),
    );
    expect(output).toMatchObject({
      ok: true,
      traceId: 'anthropic-trace',
      traceUrl: 'https://langfuse.test/traces/anthropic-trace',
      score: 0.8,
      pass: true,
      tokenUsage: { input: 10, output: 5, total: 15 },
      estimatedCostUsd: 0.01,
      toolCallCount: 1,
      loopIterations: 2,
      failureClass: 'none',
    });
  });

  it('falls back to the matrix cost estimate when provider traces have no cost', async () => {
    mockRunAnthropicEvalCase.mockResolvedValue({
      answer: 'Spyglass reveals the top card.',
      trajectory: { toolCalls: [] },
      durationMs: 1000,
      toolSurface: 'redesigned',
      traceId: 'anthropic-trace',
      trace: trace({ traceId: 'anthropic-trace', costEstimate: { totalUsd: 0 } }),
    });

    const runner = createEvalMatrixRunner({} as never, { OPENAI_API_KEY: 'test-key' });
    const output = await runner(input('anthropic'));

    expect(output.estimatedCostUsd).toBe(0.05);
  });

  it('throws OpenAI rate-limit results so matrix retries can handle them', async () => {
    mockRunOpenAiResponsesEvalCase.mockResolvedValue({
      ok: false,
      answer: '',
      failureClass: 'api_status',
      failureMessage: '429 rate limit',
      trajectory: {
        toolCalls: [],
        finalAnswer: '',
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        model: 'gpt-5.5',
        iterations: 1,
        stopReason: 'api_status',
      },
      trace: trace({
        provider: 'openai',
        model: 'gpt-5.5',
        resolvedModel: 'gpt-5.5',
        traceId: 'openai-trace',
        statusReason: 'api_status',
      }),
    });

    const runner = createEvalMatrixRunner({} as never, { OPENAI_API_KEY: 'test-key' });

    await expect(runner(input('openai'))).rejects.toMatchObject({ status: 429 });
  });

  it('does not judge failed OpenAI calls and marks the matrix row as failed', async () => {
    mockRunOpenAiResponsesEvalCase.mockImplementation(async (options) => {
      const scores = await options.scoreResult({
        ok: false,
        answer: '',
        failureClass: 'api_status',
        failureMessage: 'provider failed',
        trajectory: {
          toolCalls: [],
          finalAnswer: '',
          tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          model: 'gpt-5.5',
          iterations: 1,
          stopReason: 'api_status',
        },
      });

      return {
        ok: false,
        answer: '',
        failureClass: 'api_status',
        failureMessage: 'provider failed',
        trajectory: {
          toolCalls: [],
          finalAnswer: '',
          tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          model: 'gpt-5.5',
          iterations: 1,
          stopReason: 'api_status',
        },
        trace: trace({
          provider: 'openai',
          model: 'gpt-5.5',
          resolvedModel: 'gpt-5.5',
          traceId: 'openai-trace',
          statusReason: 'api_status',
          finalAnswer: null,
          judgeScores: [
            { name: 'failure_class', value: 'api_status' },
            { name: 'loop_iterations', value: 1 },
            ...(scores ?? []),
          ],
        }),
      };
    });

    const runner = createEvalMatrixRunner({} as never, { OPENAI_API_KEY: 'test-key' });
    const output = await runner(input('openai'));

    expect(mockTraceScoresForEvalResult).not.toHaveBeenCalled();
    expect(output).toMatchObject({
      ok: false,
      pass: false,
      score: null,
      failureClass: 'api_status',
    });
  });
});
