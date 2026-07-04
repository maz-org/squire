import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRunAgentLoopWithEvalConfig,
  mockRunLangGraphAgentLoopWithEvalConfig,
  mockGetRetrievalBootstrapStatus,
  mockWriteEvalTrace,
} = vi.hoisted(() => ({
  mockRunAgentLoopWithEvalConfig: vi.fn(),
  mockRunLangGraphAgentLoopWithEvalConfig: vi.fn(),
  mockGetRetrievalBootstrapStatus: vi.fn(),
  mockWriteEvalTrace: vi.fn(),
}));

vi.mock('../src/agent.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/agent.ts')>();
  return {
    ...actual,
    runAgentLoopWithEvalConfig: mockRunAgentLoopWithEvalConfig,
  };
});

vi.mock('../src/agent-langgraph.ts', () => ({
  runLangGraphAgentLoopWithEvalConfig: mockRunLangGraphAgentLoopWithEvalConfig,
}));

vi.mock('../src/vector-store.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/vector-store.ts')>();
  return {
    ...actual,
    getRetrievalBootstrapStatus: mockGetRetrievalBootstrapStatus,
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
import type { EvalCase } from '../eval/schema.ts';

const baseCase: EvalCase = {
  id: 'building-alchemist',
  game: 'frosthaven',
  suite: 'table-qa',
  runtime: 'langgraph',
  caseCategory: 'buildings',
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
      firstAnswerTokenAt: '2026-05-01T00:00:02.400Z',
      firstAnswerTokenLatencyMs: 2400,
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
    mockGetRetrievalBootstrapStatus.mockResolvedValue({ ready: true, indexSize: 12 });
  });

  it('runs Sonnet and Opus through the production LangGraph eval runtime with only model config changed', async () => {
    mockRunLangGraphAgentLoopWithEvalConfig
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
    });

    expect(mockRunAgentLoopWithEvalConfig).not.toHaveBeenCalled();
    expect(mockRunLangGraphAgentLoopWithEvalConfig).toHaveBeenNthCalledWith(1, baseCase.question, {
      toolSurface: 'redesigned',
      anthropicModel: 'claude-sonnet-4-6',
      maxOutputTokens: 2048,
      timeoutMs: 30000,
      toolLoopLimit: 6,
      game: 'frosthaven',
      requestId: 'eval:matrix-smoke:claude-sdk:anthropic:claude-sonnet-4-6:building-alchemist',
      evalCaseId: 'building-alchemist',
      evalSuite: 'table-qa',
      evalCaseCategory: 'buildings',
    });
    expect(mockRunLangGraphAgentLoopWithEvalConfig).toHaveBeenNthCalledWith(2, baseCase.question, {
      toolSurface: 'redesigned',
      anthropicModel: 'claude-opus-4-7',
      maxOutputTokens: 2048,
      timeoutMs: 30000,
      toolLoopLimit: 6,
      game: 'frosthaven',
      requestId: 'eval:matrix-smoke:claude-sdk:anthropic:claude-opus-4-7:building-alchemist',
      evalCaseId: 'building-alchemist',
      evalSuite: 'table-qa',
      evalCaseCategory: 'buildings',
    });
  });

  it('writes SQR-127 trace payloads with Anthropic model settings and provider-native turns', async () => {
    mockRunLangGraphAgentLoopWithEvalConfig.mockResolvedValueOnce(
      successfulAgentResult('claude-opus-4-7'),
    );
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
      traceWriter: { writeTrace: mockWriteEvalTrace },
      traceId: 'trace-opus',
    });

    expect(mockWriteEvalTrace).toHaveBeenCalledWith(
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
        firstAnswerTokenAt: '2026-05-01T00:00:02.400Z',
        firstAnswerTokenLatencyMs: 2400,
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

  it('routes LangGraph eval runs through the LangGraph adapter and labels the trace runtime', async () => {
    mockRunLangGraphAgentLoopWithEvalConfig.mockResolvedValueOnce({
      ...successfulAgentResult('claude-sonnet-4-6'),
      trajectory: {
        ...successfulAgentResult('claude-sonnet-4-6').trajectory,
        model: 'langgraph:claude-sonnet-4-6',
      },
    });
    mockWriteEvalTrace.mockResolvedValue(undefined);

    await runAnthropicEvalCase({
      case: baseCase,
      runLabel: 'langgraph-smoke',
      toolSurface: 'legacy',
      agentRuntime: 'langgraph',
      providerConfig: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        reasoningEffort: undefined,
        maxOutputTokens: 2048,
        timeoutMs: 30000,
        toolLoopLimit: 6,
        broadSearchSynthesisThreshold: 2,
      },
      traceWriter: { writeTrace: mockWriteEvalTrace },
      traceId: 'trace-langgraph',
    });

    expect(mockRunAgentLoopWithEvalConfig).not.toHaveBeenCalled();
    expect(mockRunLangGraphAgentLoopWithEvalConfig).toHaveBeenCalledWith(baseCase.question, {
      toolSurface: 'legacy',
      anthropicModel: 'claude-sonnet-4-6',
      maxOutputTokens: 2048,
      timeoutMs: 30000,
      toolLoopLimit: 6,
      broadSearchSynthesisThreshold: 2,
      game: 'frosthaven',
      requestId: 'trace-langgraph',
      evalCaseId: 'building-alchemist',
      evalSuite: 'table-qa',
      evalCaseCategory: 'buildings',
    });
    expect(mockWriteEvalTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-langgraph',
        agentRuntime: 'langgraph',
        model: 'claude-sonnet-4-6',
        resolvedModel: 'langgraph:claude-sonnet-4-6',
      }),
    );
  });

  it('marks answer-quality failures when result scoring returns a failed pass score', async () => {
    mockRunLangGraphAgentLoopWithEvalConfig.mockResolvedValueOnce(
      successfulAgentResult('claude-opus-4-7'),
    );
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
      traceWriter: { writeTrace: mockWriteEvalTrace },
      traceId: 'trace-quality',
      scoreResult: async () => [
        { name: 'correctness', value: 0.4, comment: 'Missing upgrade distinction.' },
        { name: 'pass', value: 'fail', comment: 'Expected upgrade cost distinction.' },
      ],
    });

    expect(mockWriteEvalTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-quality',
        statusReason: 'quality',
        judgeScores: expect.arrayContaining([
          { name: 'failure_class', value: 'quality' },
          { name: 'tool_call_count', value: 1 },
          { name: 'retry_count', value: 0 },
          { name: 'loop_iterations', value: 2 },
          { name: 'model_latency_ms', value: 1500 },
          { name: 'model_cost_usd', value: 0 },
          { name: 'first_answer_token_latency_ms', value: 2400 },
          { name: 'correctness', value: 0.4, comment: 'Missing upgrade distinction.' },
          { name: 'pass', value: 'fail', comment: 'Expected upgrade cost distinction.' },
        ]),
      }),
    );
  });

  it('fails rule-source evals before the model when retrieval bootstrap is not ready', async () => {
    mockGetRetrievalBootstrapStatus.mockResolvedValueOnce({
      ready: false,
      indexSize: 0,
      error: 'Rule-source embeddings table is empty. Run `npm run index`.',
      missingStep: 'npm run index',
      reason: 'missing_index',
    });
    mockWriteEvalTrace.mockResolvedValue(undefined);

    await expect(
      runAnthropicEvalCase({
        case: {
          ...baseCase,
          id: 'gh2-rule-scenario-level',
          game: 'gloomhaven-2e',
          source: 'GH2 Rulebook',
          question: 'What is the recommended scenario level?',
        },
        runLabel: 'rule-preflight',
        toolSurface: 'redesigned',
        providerConfig: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          reasoningEffort: undefined,
          maxOutputTokens: 2048,
          timeoutMs: 30000,
          toolLoopLimit: 6,
        },
        traceWriter: { writeTrace: mockWriteEvalTrace },
        traceId: 'trace-rule-preflight',
      }),
    ).rejects.toThrow('Rule-source retrieval is not ready for eval case gh2-rule-scenario-level');

    expect(mockRunLangGraphAgentLoopWithEvalConfig).not.toHaveBeenCalled();
    expect(mockWriteEvalTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-rule-preflight',
        statusReason: 'tool',
        errors: [
          expect.objectContaining({
            type: 'tool',
            message: expect.stringContaining('npm run index'),
          }),
        ],
        judgeScores: [{ name: 'failure_class', value: 'tool' }],
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
    expect(
      classifyAnthropicEvalStatus({
        toolCalls: [],
        judgeScores: [{ name: 'trajectory_pass', value: 'fail' }],
      }),
    ).toBe('quality');
  });
});
