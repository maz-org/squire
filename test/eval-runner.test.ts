import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseEvalArgs } from '../eval/cli.ts';
import { formatEvalMatrixProgress, runEval } from '../eval/runner.ts';

describe('eval runner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints a local before-after matrix comparison without running eval cases', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'squire-eval-compare-'));
    const beforePath = join(dir, 'before.json');
    const afterPath = join(dir, 'after.json');
    const baseRow = {
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
      tokenOutput: 50,
      tokenTotal: 150,
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
      modelSettings: { model: 'claude-sonnet-4-6' },
      runSettings: {
        retryCount: 1,
        maxEstimatedCostUsd: 1,
        providerConcurrency: { anthropic: 1, openai: 1 },
      },
    };
    writeFileSync(
      beforePath,
      `${JSON.stringify({ runLabel: 'before', estimatedCostUsd: 0.02, rows: [baseRow] })}\n`,
    );
    writeFileSync(
      afterPath,
      `${JSON.stringify({
        runLabel: 'after',
        estimatedCostUsd: 0.03,
        rows: [
          {
            ...baseRow,
            runLabel: 'after',
            pass: true,
            score: 0.9,
            latencyMs: 800,
            estimatedCostUsd: 0.03,
            failureClass: 'none',
          },
        ],
      })}\n`,
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await runEval(parseEvalArgs([`--compare-runs=${beforePath},${afterPath}`]), {});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Eval run comparison: before -> after'),
    );
  });

  it('formats incremental matrix progress lines', () => {
    expect(
      formatEvalMatrixProgress({
        completed: 3,
        total: 7,
        row: {
          runLabel: 'progress',
          caseId: 'rule-poison',
          category: 'rulebook',
          provider: 'openai',
          model: 'gpt-5.4-mini',
          ok: true,
          answer: 'answer',
          score: 1,
          pass: true,
          latencyMs: 1234,
          tokenInput: 100,
          tokenOutput: 20,
          tokenTotal: 120,
          estimatedCostUsd: 0.01,
          toolCallCount: 2,
          retryCount: 0,
          loopIterations: 3,
          failureClass: 'none',
          traceId: 'trace',
          traceUrl: 'https://langfuse.test/trace',
          promptVersion: 'redesigned-agent-v1',
          promptHash: 'sha256:prompt',
          toolSurface: 'redesigned',
          toolSchemaVersion: 'tools',
          toolSchemaHash: 'sha256:tools',
          modelSettings: { model: 'gpt-5.4-mini' },
          runSettings: {
            retryCount: 0,
            maxEstimatedCostUsd: 1,
            providerConcurrency: { anthropic: 1, openai: 1 },
          },
        },
      }),
    ).toBe(
      '[3/7] pass openai:gpt-5.4-mini rule-poison failure=none score=1 latency=1234ms tokens=120 tools=2 loops=3',
    );
  });

  it('honors estimated-cost guardrails for plain OpenAI Langfuse runs', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(
      runEval(
        parseEvalArgs([
          '--provider=openai',
          '--model=gpt-5.5',
          '--id=rule-poison',
          '--run-label=plain-openai-cost-guardrail',
          '--max-estimated-cost-usd=0.001',
        ]),
        {},
      ),
    ).rejects.toThrow(/requires --allow-estimated-cost/);
  });
});
