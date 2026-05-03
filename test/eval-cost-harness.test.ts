import { describe, expect, it, vi } from 'vitest';

import type { EvalProviderConfig } from '../eval/cli.ts';
import {
  compareEvalRuns,
  formatEvalRunComparison,
  type EvalRunComparisonInput,
} from '../eval/cost-harness.ts';
import { runEvalMatrix, type EvalMatrixRow, type EvalMatrixRunner } from '../eval/matrix.ts';
import type { EvalCase } from '../eval/schema.ts';

const evalCase: EvalCase = {
  id: 'building-alchemist',
  category: 'card-data',
  source: 'unit-test',
  question: 'What does the Alchemist cost?',
  finalAnswer: {
    expected: 'The level 1 Alchemist starts built and has no build cost.',
    grading: 'Mentions level 1 starts built.',
  },
};

const modelConfig: EvalProviderConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  reasoningEffort: 'high',
  maxOutputTokens: 2048,
  timeoutMs: 45_000,
  toolLoopLimit: 4,
  broadSearchSynthesisThreshold: 2,
};

function row(overrides: Partial<EvalMatrixRow>): EvalMatrixRow {
  return {
    runLabel: 'before',
    caseId: 'building-alchemist',
    category: 'card-data',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    ok: true,
    answer: 'answer',
    score: 0.4,
    pass: false,
    latencyMs: 1200,
    tokenInput: 100,
    tokenCachedInput: null,
    tokenOutput: 50,
    tokenTotal: 150,
    guardrailEstimatedCostUsd: 0.05,
    providerEstimatedCostUsd: 0.02,
    estimatedCostUsd: 0.02,
    toolCallCount: 4,
    retryCount: 1,
    loopIterations: 4,
    failureClass: 'quality',
    traceId: 'trace-before',
    traceUrl: 'https://langfuse.test/trace-before',
    promptVersion: 'redesigned-agent-v1',
    promptHash: 'sha256:prompt',
    toolSurface: 'redesigned',
    toolSchemaVersion: 'squire-anthropic-tools-v1',
    toolSchemaHash: 'sha256:tools',
    modelSettings: {
      model: 'claude-sonnet-4-6',
      reasoningEffort: 'high',
      maxOutputTokens: 2048,
      timeoutMs: 45_000,
      toolLoopLimit: 4,
      broadSearchSynthesisThreshold: 2,
    },
    runSettings: {
      retryCount: 1,
      maxEstimatedCostUsd: 1,
      providerConcurrency: { anthropic: 1, openai: 1 },
    },
    ...overrides,
  };
}

function comparisonInput(): EvalRunComparisonInput {
  return {
    before: {
      runLabel: 'before',
      guardrailEstimatedCostUsd: 0.1,
      estimatedCostUsd: 0.02,
      rows: [
        row({ runLabel: 'before', score: 0.4, pass: false, failureClass: 'quality' }),
        row({
          runLabel: 'before',
          caseId: 'rule-looting-definition',
          score: null,
          pass: false,
          latencyMs: null,
          tokenInput: null,
          tokenCachedInput: null,
          tokenOutput: null,
          tokenTotal: null,
          providerEstimatedCostUsd: null,
          estimatedCostUsd: null,
          toolCallCount: null,
          loopIterations: null,
          failureClass: 'timeout',
          traceId: 'timeout-before',
          traceUrl: 'https://langfuse.test/timeout-before',
        }),
      ],
    },
    after: {
      runLabel: 'after',
      guardrailEstimatedCostUsd: 0.1,
      estimatedCostUsd: 0.05,
      rows: [
        row({
          runLabel: 'after',
          score: 0.9,
          pass: true,
          latencyMs: 800,
          tokenInput: 120,
          tokenCachedInput: null,
          tokenOutput: 80,
          tokenTotal: 200,
          providerEstimatedCostUsd: 0.03,
          estimatedCostUsd: 0.03,
          toolCallCount: 2,
          retryCount: 0,
          loopIterations: 2,
          failureClass: 'none',
          traceId: 'trace-after',
          traceUrl: 'https://langfuse.test/trace-after',
        }),
        row({
          runLabel: 'after',
          caseId: 'rule-looting-definition',
          score: 0.8,
          pass: true,
          latencyMs: 900,
          tokenInput: 110,
          tokenCachedInput: null,
          tokenOutput: 60,
          tokenTotal: 170,
          providerEstimatedCostUsd: 0.02,
          estimatedCostUsd: 0.02,
          toolCallCount: 3,
          retryCount: 0,
          loopIterations: 3,
          failureClass: 'none',
          traceId: 'looting-after',
          traceUrl: 'https://langfuse.test/looting-after',
        }),
      ],
    },
  };
}

describe('eval cost and performance harness', () => {
  it('compares two named runs across accuracy, latency, token, cost, retry, timeout, loop, and tool deltas', () => {
    const comparison = compareEvalRuns(comparisonInput());

    expect(comparison.beforeRunLabel).toBe('before');
    expect(comparison.afterRunLabel).toBe('after');
    expect(comparison.groups).toEqual([
      expect.objectContaining({
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        casesCompared: 2,
        before: expect.objectContaining({
          passRate: 0,
          timeoutRate: 0.5,
          totalEstimatedCostUsd: 0.02,
          averageRetryCount: 1,
        }),
        after: expect.objectContaining({
          passRate: 1,
          timeoutRate: 0,
          totalEstimatedCostUsd: 0.05,
          averageRetryCount: 0,
        }),
        delta: expect.objectContaining({
          passRate: 1,
          averageLatencyMs: -350,
          totalTokens: 220,
          averageRetryCount: -1,
          timeoutRate: -0.5,
          averageLoopIterations: -1.5,
          averageToolCallCount: -1.5,
        }),
        diagnosis: expect.arrayContaining(['raw_answer_quality improved', 'timeouts improved']),
      }),
    ]);
    expect(comparison.groups[0].delta.totalEstimatedCostUsd).toBeCloseTo(0.03);
    expect(formatEvalRunComparison(comparison)).toContain('pass_delta');
    expect(formatEvalRunComparison(comparison)).toContain('anthropic:claude-sonnet-4-6');
  });

  it('records model knobs and run guardrails on every matrix row', async () => {
    const runner: EvalMatrixRunner = vi.fn(async ({ providerConfig, traceId }) => ({
      ok: true,
      answer: 'ok',
      traceId,
      traceUrl: `https://langfuse.test/project/default/traces/${traceId}`,
      score: 1,
      pass: true,
      latencyMs: 500,
      tokenUsage: { input: 10, output: 5, total: 15 },
      estimatedCostUsd: 0.01,
      toolCallCount: 1,
      loopIterations: 2,
      failureClass: 'none',
      modelSettings: {
        providerEcho: providerConfig.provider,
      },
    }));

    const result = await runEvalMatrix({
      cases: [evalCase],
      runLabel: 'knob-capture',
      toolSurface: 'redesigned',
      selection: 'id',
      modelConfigs: [modelConfig],
      runner,
      guardrails: {
        allowFullDataset: false,
        allowEstimatedCostOverride: true,
        maxEstimatedCostUsd: 3,
        retryCount: 2,
        continueOnModelFailure: true,
        providerConcurrency: { anthropic: 2, openai: 1 },
      },
      langfuseBaseUrl: 'https://langfuse.test',
    });

    expect(result.rows[0]).toMatchObject({
      promptVersion: 'redesigned-agent-v1',
      toolSurface: 'redesigned',
      toolSchemaVersion: 'squire-anthropic-tools-v1',
      modelSettings: {
        model: 'claude-sonnet-4-6',
        reasoningEffort: 'high',
        maxOutputTokens: 2048,
        timeoutMs: 45_000,
        toolLoopLimit: 4,
        broadSearchSynthesisThreshold: 2,
        providerEcho: 'anthropic',
      },
      runSettings: {
        retryCount: 2,
        maxEstimatedCostUsd: 3,
        providerConcurrency: { anthropic: 2, openai: 1 },
      },
    });
  });

  it('rejects incompatible comparisons when prompt or tool schema versions differ', () => {
    const input = comparisonInput();
    input.after.rows[0] = row({
      runLabel: 'after',
      promptHash: 'sha256:different-prompt',
      toolSchemaVersion: 'squire-anthropic-tools-v2',
    });

    expect(() => compareEvalRuns(input)).toThrow(
      /Cannot compare before to after.*promptHash.*toolSchemaVersion/s,
    );
  });

  it('rejects comparisons with missing compatibility metadata', () => {
    const input = comparisonInput();
    const { modelSettings, ...legacyBeforeRow } = row({ runLabel: 'before' });
    input.before.rows = [legacyBeforeRow as EvalMatrixRow];
    input.after.rows = [row({ runLabel: 'after' })];
    expect(modelSettings).toBeDefined();

    expect(() => compareEvalRuns(input)).toThrow(
      /Cannot compare before to after.*missing modelSettings before/s,
    );
  });

  it('rejects comparisons when model or run settings differ', () => {
    const input = comparisonInput();
    input.before.rows = [row({ runLabel: 'before' })];
    input.after.rows = [
      row({
        runLabel: 'after',
        modelSettings: {
          ...row({}).modelSettings,
          broadSearchSynthesisThreshold: 3,
        },
        runSettings: {
          retryCount: 0,
          maxEstimatedCostUsd: 1,
          providerConcurrency: { anthropic: 1, openai: 1 },
        },
      }),
    ];

    expect(() => compareEvalRuns(input)).toThrow(
      /Cannot compare before to after.*modelSettings.*runSettings/s,
    );
  });
});
