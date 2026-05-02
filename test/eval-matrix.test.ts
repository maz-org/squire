import { describe, expect, it, vi } from 'vitest';

import type { EvalProviderConfig } from '../eval/cli.ts';
import {
  DEFAULT_EVAL_MATRIX_MODELS,
  defaultEvalMatrixModels,
  formatEvalMatrixTable,
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
  return vi.fn(async ({ evalCase, providerConfig, traceId }) => ({
    ok: true,
    answer: `${providerConfig.model} answered ${evalCase.id}`,
    traceId,
    traceUrl: `https://langfuse.test/project/default/traces/${encodeURIComponent(traceId)}`,
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
    });

    expect(result.rows.map((row) => `${row.provider}:${row.model}`)).toEqual([
      'anthropic:claude-sonnet-4-6',
      'anthropic:claude-opus-4-7',
      'openai:gpt-5.5',
    ]);
    expect(runner).toHaveBeenCalledTimes(3);
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
          estimatedCostUsd: 0.02,
          toolCallCount: 1,
          retryCount: 0,
          loopIterations: 2,
          traceUrl: expect.stringContaining('/traces/'),
        }),
      ]),
    );
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
      }),
    ).toEqual([
      expect.objectContaining({
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        reasoningEffort: undefined,
        maxOutputTokens: 1024,
      }),
      expect.objectContaining({
        provider: 'anthropic',
        model: 'claude-opus-4-7',
        reasoningEffort: undefined,
        timeoutMs: 30_000,
      }),
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-5.5',
        reasoningEffort: 'xhigh',
        toolLoopLimit: 4,
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

    expect(runner).toHaveBeenCalledTimes(12);
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

    expect(result.rows).toHaveLength(3);
    expect(result.rows.filter((row) => row.ok)).toHaveLength(2);
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
      'case\tmodel\tpass\tfailure_class\tscore\tlatency_ms\ttokens\tcost_usd\ttools\tretries\tloops\ttrace\terror',
    );
    expect(formatEvalMatrixTable(result.rows)).toContain('item-spyglass');
    expect(formatEvalMatrixTable(result.rows)).toContain('claude-sonnet-4-6');
    expect(formatEvalMatrixTable(result.rows)).toContain('https://langfuse.test');
  });
});
