import { describe, expect, it, vi } from 'vitest';

import type { EvalProviderConfig } from '../eval/cli.ts';
import {
  DEFAULT_EVAL_MATRIX_MODELS,
  defaultEvalMatrixModels,
  formatEvalMatrixTable,
  langfuseTraceUrl,
  runEvalMatrix,
  type EvalMatrixRunner,
} from '../eval/matrix.ts';
import type { EvalCase } from '../eval/schema.ts';

const selectedCase: EvalCase = {
  id: 'item-spyglass',
  category: 'card-data',
  source: 'unit-test',
  question: 'What does Spyglass do?',
  finalAnswer: {
    expected: 'Spyglass reveals cards.',
    grading: 'Mentions Spyglass effect.',
  },
};

const secondCase: EvalCase = {
  id: 'rule-advantage',
  category: 'rules',
  source: 'unit-test',
  question: 'How does advantage work?',
  trajectory: {
    requiredTools: ['search_rules'],
    requiredToolKinds: ['search'],
    forbiddenTools: [],
    forbiddenToolKinds: [],
    requiredRefs: [],
    maxToolCalls: 2,
  },
};

function successfulRunner(): EvalMatrixRunner {
  return vi.fn(async ({ evalCase, providerConfig, traceId, traceUrl }) => ({
    ok: true,
    answer: `${providerConfig.model} answered ${evalCase.id}`,
    traceId,
    traceUrl,
    score: 0.8,
    pass: true,
    latencyMs: 1200,
    tokenUsage: { input: 100, output: 50, total: 150 },
    estimatedCostUsd: 0.02,
    toolCallCount: 1,
    loopIterations: 2,
    failureClass: 'none',
  }));
}

describe('eval matrix runner', () => {
  it('builds Langfuse trace links with the configured project id', () => {
    expect(langfuseTraceUrl('https://langfuse.test/', 'project-123', 'eval:run:model:case')).toBe(
      'https://langfuse.test/project/project-123/traces/eval%3Arun%3Amodel%3Acase',
    );
  });

  it('falls back to the default Langfuse project id when configured blank', async () => {
    const runner = successfulRunner();

    const result = await runEvalMatrix({
      cases: [selectedCase],
      runLabel: 'matrix-smoke',
      toolSurface: 'redesigned',
      selection: 'id',
      modelConfigs: [DEFAULT_EVAL_MATRIX_MODELS[0]!],
      runner,
      guardrails: {
        allowFullDataset: false,
        allowEstimatedCostOverride: false,
        maxEstimatedCostUsd: 1,
        retryCount: 0,
        continueOnModelFailure: true,
        providerConcurrency: { anthropic: 1, openai: 1 },
      },
      langfuseBaseUrl: 'https://langfuse.test',
      langfuseProjectId: '   ',
    });

    expect(result.rows[0]?.traceUrl).toContain('/project/default/traces/');
  });

  it('runs one selected case across every configured provider/model', async () => {
    const runner = successfulRunner();

    const result = await runEvalMatrix({
      cases: [selectedCase],
      runLabel: 'matrix-smoke',
      toolSurface: 'redesigned',
      selection: 'id',
      modelConfigs: DEFAULT_EVAL_MATRIX_MODELS,
      runner,
      guardrails: {
        allowFullDataset: false,
        allowEstimatedCostOverride: false,
        maxEstimatedCostUsd: 1,
        retryCount: 0,
        continueOnModelFailure: true,
        providerConcurrency: { anthropic: 1, openai: 1 },
      },
      langfuseBaseUrl: 'https://langfuse.test',
      langfuseProjectId: 'project-123',
    });

    expect(result.rows.map((row) => `${row.provider}:${row.model}`)).toEqual([
      'anthropic:claude-sonnet-4-6',
      'anthropic:claude-opus-4-7',
      'anthropic:claude-haiku-4-5',
      'openai:gpt-5.5',
      'openai:gpt-5.4',
      'openai:gpt-5.4-mini',
      'openai:gpt-5.4-nano',
    ]);
    expect(runner).toHaveBeenCalledTimes(7);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          caseId: 'item-spyglass',
          provider: 'openai',
          model: 'gpt-5.5',
          score: 0.8,
          pass: true,
          latencyMs: 1200,
          tokenInput: 100,
          tokenOutput: 50,
          tokenTotal: 150,
          guardrailEstimatedCostUsd: 0.05,
          providerEstimatedCostUsd: 0.002,
          estimatedCostUsd: 0.002,
          toolCallCount: 1,
          retryCount: 0,
          loopIterations: 2,
          traceUrl: expect.stringContaining('/project/project-123/traces/'),
        }),
      ]),
    );
  });

  it('keeps Claude SDK and Deep Agents rows and traces distinct for the same provider model case', async () => {
    const runner = successfulRunner();

    const result = await runEvalMatrix({
      cases: [selectedCase],
      runLabel: 'runtime-compare',
      toolSurface: 'redesigned',
      selection: 'id',
      modelConfigs: [DEFAULT_EVAL_MATRIX_MODELS[0]!],
      agentRuntimes: ['claude-sdk', 'deep-agents'],
      runner,
      guardrails: {
        allowFullDataset: false,
        allowEstimatedCostOverride: false,
        maxEstimatedCostUsd: 1,
        retryCount: 0,
        continueOnModelFailure: true,
        providerConcurrency: { anthropic: 1, openai: 1 },
      },
      langfuseBaseUrl: 'https://langfuse.test',
      langfuseProjectId: 'project-123',
    });

    expect(result.rows.map((row) => row.agentRuntime)).toEqual(['claude-sdk', 'deep-agents']);
    expect(result.rows.map((row) => row.traceId)).toEqual([
      'eval:runtime-compare:claude-sdk:anthropic:claude-sonnet-4-6:item-spyglass',
      'eval:runtime-compare:deep-agents:anthropic:claude-sonnet-4-6:item-spyglass',
    ]);
  });

  it('shares provider-safe tuning knobs across the default matrix models', () => {
    expect(
      defaultEvalMatrixModels({
        provider: 'openai',
        model: 'gpt-5.5',
        reasoningEffort: 'xhigh',
        maxOutputTokens: 1024,
        timeoutMs: 30_000,
        toolLoopLimit: 4,
        broadSearchSynthesisThreshold: 2,
      }),
    ).toEqual([
      expect.objectContaining({
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        reasoningEffort: undefined,
        maxOutputTokens: 1024,
        broadSearchSynthesisThreshold: 2,
      }),
      expect.objectContaining({
        provider: 'anthropic',
        model: 'claude-opus-4-7',
        reasoningEffort: undefined,
        timeoutMs: 30_000,
        broadSearchSynthesisThreshold: 2,
      }),
      expect.objectContaining({
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        reasoningEffort: undefined,
        timeoutMs: 30_000,
        broadSearchSynthesisThreshold: 2,
      }),
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-5.5',
        reasoningEffort: 'xhigh',
        toolLoopLimit: 4,
        broadSearchSynthesisThreshold: 2,
      }),
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-5.4',
        reasoningEffort: 'xhigh',
        toolLoopLimit: 4,
        broadSearchSynthesisThreshold: 2,
      }),
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-5.4-mini',
        reasoningEffort: 'xhigh',
        toolLoopLimit: 4,
        broadSearchSynthesisThreshold: 2,
      }),
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-5.4-nano',
        reasoningEffort: 'xhigh',
        toolLoopLimit: 4,
        broadSearchSynthesisThreshold: 2,
      }),
    ]);
  });

  it('dispatches category and full-dataset selections without duplicating runner logic', async () => {
    const runner = successfulRunner();

    await runEvalMatrix({
      cases: [selectedCase, secondCase],
      runLabel: 'matrix-category',
      toolSurface: 'redesigned',
      selection: 'category',
      modelConfigs: DEFAULT_EVAL_MATRIX_MODELS,
      runner,
      guardrails: {
        allowFullDataset: false,
        allowEstimatedCostOverride: false,
        maxEstimatedCostUsd: 10,
        retryCount: 0,
        continueOnModelFailure: true,
        providerConcurrency: { anthropic: 1, openai: 1 },
      },
      langfuseBaseUrl: 'https://langfuse.test',
    });
    await runEvalMatrix({
      cases: [selectedCase, secondCase],
      runLabel: 'matrix-full',
      toolSurface: 'redesigned',
      selection: 'all',
      modelConfigs: DEFAULT_EVAL_MATRIX_MODELS,
      runner,
      guardrails: {
        allowFullDataset: true,
        allowEstimatedCostOverride: false,
        maxEstimatedCostUsd: 10,
        retryCount: 0,
        continueOnModelFailure: true,
        providerConcurrency: { anthropic: 1, openai: 1 },
      },
      langfuseBaseUrl: 'https://langfuse.test',
    });

    expect(runner).toHaveBeenCalledTimes(28);
  });

  it('keeps successful rows when another model fails', async () => {
    const runner: EvalMatrixRunner = vi.fn(async ({ providerConfig, traceId }) => {
      if (providerConfig.provider === 'openai') {
        throw Object.assign(new Error('rate limited'), { status: 429 });
      }
      return {
        ok: true,
        answer: 'ok',
        traceId,
        traceUrl: `https://langfuse.test/project/default/traces/${traceId}`,
        score: 1,
        pass: true,
        latencyMs: 500,
        tokenUsage: { input: 10, output: 5, total: 15 },
        estimatedCostUsd: 0.01,
        toolCallCount: 0,
        loopIterations: 1,
        failureClass: 'none',
      };
    });

    const result = await runEvalMatrix({
      cases: [selectedCase],
      runLabel: 'partial-failure',
      toolSurface: 'redesigned',
      selection: 'id',
      modelConfigs: DEFAULT_EVAL_MATRIX_MODELS,
      runner,
      guardrails: {
        allowFullDataset: false,
        allowEstimatedCostOverride: false,
        maxEstimatedCostUsd: 1,
        retryCount: 0,
        continueOnModelFailure: true,
        providerConcurrency: { anthropic: 1, openai: 1 },
      },
      langfuseBaseUrl: 'https://langfuse.test',
    });

    expect(result.rows).toHaveLength(7);
    expect(result.rows.filter((row) => row.ok)).toHaveLength(3);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'openai',
          ok: false,
          failureClass: 'rate_limit',
          error: 'rate limited',
        }),
      ]),
    );
  });

  it('requires explicit guardrail overrides for full dataset and high-cost runs', async () => {
    const runner = successfulRunner();

    await expect(
      runEvalMatrix({
        cases: [selectedCase, secondCase],
        runLabel: 'matrix-full',
        toolSurface: 'redesigned',
        selection: 'all',
        modelConfigs: DEFAULT_EVAL_MATRIX_MODELS,
        runner,
        guardrails: {
          allowFullDataset: false,
          allowEstimatedCostOverride: false,
          maxEstimatedCostUsd: 10,
          retryCount: 0,
          continueOnModelFailure: true,
          providerConcurrency: { anthropic: 1, openai: 1 },
        },
        langfuseBaseUrl: 'https://langfuse.test',
      }),
    ).rejects.toThrow(/requires --allow-full-dataset/);

    await expect(
      runEvalMatrix({
        cases: [selectedCase],
        runLabel: 'matrix-cost',
        toolSurface: 'redesigned',
        selection: 'id',
        modelConfigs: DEFAULT_EVAL_MATRIX_MODELS,
        runner,
        guardrails: {
          allowFullDataset: false,
          allowEstimatedCostOverride: false,
          maxEstimatedCostUsd: 0.001,
          retryCount: 0,
          continueOnModelFailure: true,
          providerConcurrency: { anthropic: 1, openai: 1 },
        },
        langfuseBaseUrl: 'https://langfuse.test',
      }),
    ).rejects.toThrow(/requires --allow-estimated-cost/);
  });

  it('calculates row provider costs from model prices while keeping guardrail estimates', async () => {
    const configs: EvalProviderConfig[] = [
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        reasoningEffort: undefined,
        maxOutputTokens: undefined,
        timeoutMs: undefined,
        toolLoopLimit: undefined,
      },
      {
        provider: 'openai',
        model: 'gpt-5.5',
        reasoningEffort: undefined,
        maxOutputTokens: undefined,
        timeoutMs: undefined,
        toolLoopLimit: undefined,
      },
    ];
    const runner: EvalMatrixRunner = vi.fn(async ({ providerConfig, traceId }) => ({
      ok: true,
      answer: 'priced',
      traceId,
      traceUrl: `https://langfuse.test/project/default/traces/${traceId}`,
      score: 1,
      pass: true,
      latencyMs: 500,
      tokenUsage:
        providerConfig.provider === 'openai'
          ? { input: 1_000_000, cachedInput: 400_000, output: 100_000, total: 1_100_000 }
          : { input: 1_000_000, output: 100_000, total: 1_100_000 },
      estimatedCostUsd: 0.05,
      toolCallCount: 0,
      loopIterations: 1,
      failureClass: 'none',
    }));

    const result = await runEvalMatrix({
      cases: [selectedCase],
      runLabel: 'matrix-pricing',
      toolSurface: 'redesigned',
      selection: 'id',
      modelConfigs: configs,
      runner,
      guardrails: {
        allowFullDataset: false,
        allowEstimatedCostOverride: false,
        maxEstimatedCostUsd: 1,
        retryCount: 0,
        continueOnModelFailure: true,
        providerConcurrency: { anthropic: 1, openai: 1 },
      },
      langfuseBaseUrl: 'https://langfuse.test',
    });

    expect(result).toMatchObject({
      estimatedCostUsd: 0.1,
      guardrailEstimatedCostUsd: 0.1,
    });
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          tokenCachedInput: null,
          guardrailEstimatedCostUsd: 0.05,
          providerEstimatedCostUsd: 4.5,
          estimatedCostUsd: 4.5,
        }),
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-5.5',
          tokenCachedInput: 400_000,
          guardrailEstimatedCostUsd: 0.05,
          providerEstimatedCostUsd: 6.2,
          estimatedCostUsd: 6.2,
        }),
      ]),
    );
  });

  it('does not bill cached input tokens beyond total input tokens', async () => {
    const config: EvalProviderConfig = {
      provider: 'openai',
      model: 'gpt-5.5',
      reasoningEffort: undefined,
      maxOutputTokens: undefined,
      timeoutMs: undefined,
      toolLoopLimit: undefined,
    };
    const runner: EvalMatrixRunner = vi.fn(async ({ traceId }) => ({
      ok: true,
      answer: 'priced',
      traceId,
      traceUrl: `https://langfuse.test/project/default/traces/${traceId}`,
      score: 1,
      pass: true,
      latencyMs: 500,
      tokenUsage: { input: 1_000_000, cachedInput: 2_000_000, output: 0, total: 1_000_000 },
      estimatedCostUsd: 0.05,
      toolCallCount: 0,
      loopIterations: 1,
      failureClass: 'none',
    }));

    const result = await runEvalMatrix({
      cases: [selectedCase],
      runLabel: 'matrix-cached-input-clamp',
      toolSurface: 'redesigned',
      selection: 'id',
      modelConfigs: [config],
      runner,
      guardrails: {
        allowFullDataset: false,
        allowEstimatedCostOverride: false,
        maxEstimatedCostUsd: 1,
        retryCount: 0,
        continueOnModelFailure: true,
        providerConcurrency: { anthropic: 1, openai: 1 },
      },
      langfuseBaseUrl: 'https://langfuse.test',
    });

    expect(result.rows[0]).toMatchObject({
      tokenCachedInput: 2_000_000,
      providerEstimatedCostUsd: 0.5,
      estimatedCostUsd: 0.5,
    });
  });

  it('retries provider rate limits before recording a matrix failure', async () => {
    const config: EvalProviderConfig = {
      provider: 'openai',
      model: 'gpt-5.5',
      reasoningEffort: undefined,
      maxOutputTokens: undefined,
      timeoutMs: undefined,
      toolLoopLimit: undefined,
    };
    const runner: EvalMatrixRunner = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('429 rate limit'), { status: 429 }))
      .mockResolvedValueOnce({
        ok: true,
        answer: 'ok after retry',
        traceId: 'retry-trace',
        traceUrl: 'https://langfuse.test/project/default/traces/retry-trace',
        score: 1,
        pass: true,
        latencyMs: 900,
        tokenUsage: { input: 20, output: 10, total: 30 },
        estimatedCostUsd: 0.01,
        toolCallCount: 0,
        loopIterations: 1,
        failureClass: 'none',
      });

    const result = await runEvalMatrix({
      cases: [selectedCase],
      runLabel: 'matrix-retry',
      toolSurface: 'redesigned',
      selection: 'id',
      modelConfigs: [config],
      runner,
      guardrails: {
        allowFullDataset: false,
        allowEstimatedCostOverride: false,
        maxEstimatedCostUsd: 1,
        retryCount: 1,
        continueOnModelFailure: true,
        providerConcurrency: { anthropic: 1, openai: 1 },
      },
      langfuseBaseUrl: 'https://langfuse.test',
    });

    expect(runner).toHaveBeenCalledTimes(2);
    expect(result.rows[0]).toMatchObject({ ok: true, retryCount: 1 });
  });

  it('keeps retry counts when a retried call ends with a non-rate-limit failure', async () => {
    const config: EvalProviderConfig = {
      provider: 'openai',
      model: 'gpt-5.5',
      reasoningEffort: undefined,
      maxOutputTokens: undefined,
      timeoutMs: undefined,
      toolLoopLimit: undefined,
    };
    const runner: EvalMatrixRunner = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('429 rate limit'), { status: 429 }))
      .mockRejectedValueOnce(new Error('request timeout'));

    const result = await runEvalMatrix({
      cases: [selectedCase],
      runLabel: 'matrix-mixed-failure',
      toolSurface: 'redesigned',
      selection: 'id',
      modelConfigs: [config],
      runner,
      guardrails: {
        allowFullDataset: false,
        allowEstimatedCostOverride: false,
        maxEstimatedCostUsd: 1,
        retryCount: 1,
        continueOnModelFailure: true,
        providerConcurrency: { anthropic: 1, openai: 1 },
      },
      langfuseBaseUrl: 'https://langfuse.test',
    });

    expect(runner).toHaveBeenCalledTimes(2);
    expect(result.rows[0]).toMatchObject({
      ok: false,
      failureClass: 'timeout',
      retryCount: 1,
    });
  });

  it('emits progress after each completed matrix row', async () => {
    const onProgress = vi.fn();

    await runEvalMatrix({
      cases: [selectedCase],
      runLabel: 'matrix-progress',
      toolSurface: 'redesigned',
      selection: 'id',
      modelConfigs: DEFAULT_EVAL_MATRIX_MODELS.slice(0, 2),
      runner: successfulRunner(),
      guardrails: {
        allowFullDataset: false,
        allowEstimatedCostOverride: false,
        maxEstimatedCostUsd: 1,
        retryCount: 0,
        continueOnModelFailure: true,
        providerConcurrency: { anthropic: 1, openai: 1 },
      },
      langfuseBaseUrl: 'https://langfuse.test',
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        completed: 1,
        total: 2,
        row: expect.objectContaining({ caseId: 'item-spyglass' }),
      }),
    );
    expect(onProgress).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        completed: 2,
        total: 2,
        row: expect.objectContaining({ caseId: 'item-spyglass' }),
      }),
    );
  });

  it('formats the matrix summary table with comparison fields and Langfuse links', async () => {
    const result = await runEvalMatrix({
      cases: [selectedCase],
      runLabel: 'matrix-table',
      toolSurface: 'redesigned',
      selection: 'id',
      modelConfigs: DEFAULT_EVAL_MATRIX_MODELS.slice(0, 1),
      runner: successfulRunner(),
      guardrails: {
        allowFullDataset: false,
        allowEstimatedCostOverride: false,
        maxEstimatedCostUsd: 1,
        retryCount: 0,
        continueOnModelFailure: true,
        providerConcurrency: { anthropic: 1, openai: 1 },
      },
      langfuseBaseUrl: 'https://langfuse.test',
    });

    expect(formatEvalMatrixTable(result.rows)).toContain(
      'case\truntime_model\tpass\tfailure_class\tscore\tlatency_ms\ttokens\tcached_input_tokens\tguardrail_cost_usd\tprovider_cost_usd\ttools\tretries\tloops\ttrace\terror',
    );
    expect(formatEvalMatrixTable(result.rows)).toContain('item-spyglass');
    expect(formatEvalMatrixTable(result.rows)).toContain('claude-sonnet-4-6');
    expect(formatEvalMatrixTable(result.rows)).toContain('https://langfuse.test');
  });
});
