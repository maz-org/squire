import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRunAgentLoopWithEvalConfig, mockWriteEvalTrace } = vi.hoisted(() => ({
  mockRunAgentLoopWithEvalConfig: vi.fn(),
  mockWriteEvalTrace: vi.fn(),
}));

vi.mock('../src/agent.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/agent.ts')>();
  return {
    ...actual,
    runAgentLoopWithEvalConfig: mockRunAgentLoopWithEvalConfig,
  };
});

vi.mock('../eval/trace.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../eval/trace.ts')>();
  return {
    ...actual,
    writeEvalTrace: mockWriteEvalTrace,
  };
});

import type { AskOptions } from '../src/service.ts';
import {
  classifyAnthropicEvalFailure,
  classifyAnthropicEvalStatus,
  runAnthropicEvalCase,
} from '../eval/anthropic-runner.ts';
import type { LangfuseTraceIngestionClient } from '../eval/trace.ts';

const traceClient: LangfuseTraceIngestionClient = {
  api: {
    ingestion: {
      batch: vi.fn(),
    },
  },
};

const baseCase = {
  id: 'building-alchemist',
  category: 'buildings',
  source: 'dataset',
  question: 'What does the level 1 Alchemist unlock?',
};

function successfulAgentResult(model: 'claude-sonnet-4-6' | 'claude-opus-4-7') {
  return {
    answer: 'It can brew 2-herb potions.',
    trajectory: {
      toolCalls: [
        {
          iteration: 1,
          id: 'toolu_1',
          name: 'open_entity',
          input: { ref: 'building:35' },
          ok: true,
          outputSummary: 'json object (name, level, effect)',
          sourceLabels: ['Building 35'],
          canonicalRefs: ['building:35'],
          startedAt: '2026-05-01T00:00:01.000Z',
          endedAt: '2026-05-01T00:00:01.125Z',
          durationMs: 125,
        },
      ],
      modelCalls: [
        {
          iteration: 1,
          model,
          stopReason: 'tool_use',
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationInputTokens: 30,
          cacheReadInputTokens: 0,
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'open_entity' }],
          startedAt: '2026-05-01T00:00:00.000Z',
          endedAt: '2026-05-01T00:00:00.500Z',
          durationMs: 500,
        },
        {
          iteration: 2,
          model,
          stopReason: 'end_turn',
          inputTokens: 150,
          outputTokens: 75,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 15,
          content: [{ type: 'text', text: 'It can brew 2-herb potions.' }],
          startedAt: '2026-05-01T00:00:01.500Z',
          endedAt: '2026-05-01T00:00:02.500Z',
          durationMs: 1000,
        },
      ],
      finalAnswer: 'It can brew 2-herb potions.',
      tokenUsage: {
        inputTokens: 250,
        outputTokens: 125,
        cacheCreationInputTokens: 30,
        cacheReadInputTokens: 15,
        totalTokens: 420,
      },
      model,
      iterations: 2,
      stopReason: 'end_turn',
    },
  };
}

describe('SQR-128 Anthropic eval runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs Sonnet and Opus through the same eval-only Claude loop with only model config changed', async () => {
    mockRunAgentLoopWithEvalConfig
      .mockResolvedValueOnce(successfulAgentResult('claude-sonnet-4-6'))
      .mockResolvedValueOnce(successfulAgentResult('claude-opus-4-7'));
    mockWriteEvalTrace.mockResolvedValue(undefined);

    await runAnthropicEvalCase({
      case: baseCase,
      runLabel: 'matrix-smoke',
      toolSurface: 'redesigned',
      providerConfig: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        reasoningEffort: undefined,
        maxOutputTokens: 2048,
        timeoutMs: 30000,
        toolLoopLimit: 6,
      },
      traceClient,
    });
    await runAnthropicEvalCase({
      case: baseCase,
      runLabel: 'matrix-smoke',
      toolSurface: 'redesigned',
      providerConfig: {
        provider: 'anthropic',
        model: 'claude-opus-4-7',
        reasoningEffort: undefined,
        maxOutputTokens: 2048,
        timeoutMs: 30000,
        toolLoopLimit: 6,
      },
      traceClient,
    });

    expect(mockRunAgentLoopWithEvalConfig).toHaveBeenNthCalledWith(1, baseCase.question, {
      toolSurface: 'redesigned',
      anthropicModel: 'claude-sonnet-4-6',
      maxOutputTokens: 2048,
      timeoutMs: 30000,
      toolLoopLimit: 6,
    });
    expect(mockRunAgentLoopWithEvalConfig).toHaveBeenNthCalledWith(2, baseCase.question, {
      toolSurface: 'redesigned',
      anthropicModel: 'claude-opus-4-7',
      maxOutputTokens: 2048,
      timeoutMs: 30000,
      toolLoopLimit: 6,
    });
  });

  it('writes SQR-127 trace payloads with Anthropic model settings and provider-native turns', async () => {
    mockRunAgentLoopWithEvalConfig.mockResolvedValueOnce(successfulAgentResult('claude-opus-4-7'));
    mockWriteEvalTrace.mockResolvedValue(undefined);

    await runAnthropicEvalCase({
      case: baseCase,
      runLabel: 'opus-smoke',
      toolSurface: 'legacy',
      providerConfig: {
        provider: 'anthropic',
        model: 'claude-opus-4-7',
        reasoningEffort: 'high',
        maxOutputTokens: 4096,
        timeoutMs: 45000,
        toolLoopLimit: 4,
      },
      traceClient,
      traceId: 'trace-opus',
    });

    expect(mockWriteEvalTrace).toHaveBeenCalledWith(
      traceClient,
      expect.objectContaining({
        traceId: 'trace-opus',
        runLabel: 'opus-smoke',
        caseId: 'building-alchemist',
        caseCategory: 'buildings',
        provider: 'anthropic',
        model: 'claude-opus-4-7',
        resolvedModel: 'claude-opus-4-7',
        promptVersion: 'legacy-agent-v1',
        toolSurface: 'legacy',
        toolSchemaVersion: 'squire-anthropic-tools-v1',
        modelSettings: {
          model: 'claude-opus-4-7',
          maxOutputTokens: 4096,
          reasoningEffort: 'high',
          timeoutMs: 45000,
          toolLoopLimit: 4,
        },
        stopReason: 'end_turn',
        statusReason: 'completed',
        tokenUsage: {
          input: 250,
          output: 125,
          cached: 15,
          cacheCreationInput: 30,
          cacheReadInput: 15,
          total: 420,
        },
        providerNativeTranscript: {
          modelCalls: successfulAgentResult('claude-opus-4-7').trajectory.modelCalls,
        },
        toolCalls: [
          expect.objectContaining({
            toolName: 'open_entity',
            providerToolCallId: 'toolu_1',
            arguments: { ref: 'building:35' },
            result: { outputSummary: 'json object (name, level, effect)' },
          }),
        ],
      }),
    );
  });

  it('marks answer-quality failures when result scoring returns a failed pass score', async () => {
    mockRunAgentLoopWithEvalConfig.mockResolvedValueOnce(successfulAgentResult('claude-opus-4-7'));
    mockWriteEvalTrace.mockResolvedValue(undefined);

    await runAnthropicEvalCase({
      case: baseCase,
      runLabel: 'quality-smoke',
      toolSurface: 'redesigned',
      providerConfig: {
        provider: 'anthropic',
        model: 'claude-opus-4-7',
        reasoningEffort: undefined,
        maxOutputTokens: 4096,
        timeoutMs: 45000,
        toolLoopLimit: 4,
      },
      traceClient,
      traceId: 'trace-quality',
      scoreResult: async () => [
        { name: 'correctness', value: 0.4, comment: 'Missing upgrade distinction.' },
        { name: 'pass', value: 'fail', comment: 'Expected upgrade cost distinction.' },
      ],
    });

    expect(mockWriteEvalTrace).toHaveBeenCalledWith(
      traceClient,
      expect.objectContaining({
        traceId: 'trace-quality',
        statusReason: 'quality',
        judgeScores: [
          { name: 'failure_class', value: 'quality' },
          { name: 'tool_call_count', value: 1 },
          { name: 'retry_count', value: 0 },
          { name: 'loop_iterations', value: 2 },
          { name: 'model_latency_ms', value: 1500 },
          { name: 'model_cost_usd', value: 0 },
          { name: 'correctness', value: 0.4, comment: 'Missing upgrade distinction.' },
          { name: 'pass', value: 'fail', comment: 'Expected upgrade cost distinction.' },
        ],
      }),
    );
  });

  it('keeps production AskOptions free of provider and model selection fields', () => {
    const invalidProductionOptions: AskOptions = {
      // @ts-expect-error Provider/model selection is intentionally eval-only.
      provider: 'anthropic',
      model: 'claude-opus-4-7',
    };
    const productionOptionsKeys = Object.keys({
      history: [],
      toolSurface: 'legacy',
      campaignId: 'campaign',
      userId: 'user',
      emit: async () => {},
    } satisfies AskOptions);

    expect(productionOptionsKeys).not.toContain('provider');
    expect(productionOptionsKeys).not.toContain('model');
    expect(productionOptionsKeys).not.toContain('anthropicModel');
    expect(invalidProductionOptions).toHaveProperty('provider', 'anthropic');
  });

  it('classifies Anthropic access, timeout, tool, and quality failures', () => {
    expect(classifyAnthropicEvalFailure({ status: 401, message: 'Unauthorized' })).toBe('access');
    expect(classifyAnthropicEvalFailure(new Error('request timeout after 30000ms'))).toBe(
      'timeout',
    );
    expect(
      classifyAnthropicEvalStatus({
        toolCalls: [{ ok: false, error: 'Tool error: database unavailable' }],
        judgeScores: [],
      }),
    ).toBe('tool');
    expect(
      classifyAnthropicEvalStatus({
        toolCalls: [],
        judgeScores: [{ name: 'pass', value: 'fail' }],
      }),
    ).toBe('quality');
  });
});
