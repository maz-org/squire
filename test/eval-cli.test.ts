import { describe, expect, it } from 'vitest';

import { parseEvalArgs } from '../eval/cli.ts';

describe('parseEvalArgs', () => {
  it('defaults to the redesigned tool surface', () => {
    expect(parseEvalArgs([]).toolSurface).toBe('redesigned');
  });

  it('accepts the legacy tool surface', () => {
    expect(parseEvalArgs(['--tool-surface=legacy']).toolSurface).toBe('legacy');
  });

  it('rejects unknown tool surfaces', () => {
    expect(() => parseEvalArgs(['--tool-surface=old'])).toThrow(/Invalid --tool-surface/);
  });

  it('rejects an empty tool surface', () => {
    expect(() => parseEvalArgs(['--tool-surface='])).toThrow(
      /Invalid --tool-surface: value cannot be empty/,
    );
  });

  it('rejects an empty run name', () => {
    expect(() => parseEvalArgs(['--name='])).toThrow(/Invalid --name: value cannot be empty/);
  });

  it('parses the local report output path', () => {
    expect(parseEvalArgs(['--local-report=/tmp/eval.json']).localReportPath).toBe('/tmp/eval.json');
  });

  it('parses replay and trace diff options', () => {
    expect(
      parseEvalArgs([
        '--replay',
        '--trace-id=eval:debug-run:anthropic:claude-sonnet-4-6:case-1',
        '--diff-trace-id=eval:debug-run:case-1:openai',
        '--diff-provider=openai',
        '--diff-model=gpt-5.5',
        '--diff-run-label=debug-run-openai',
      ]).replay,
    ).toEqual({
      enabled: true,
      traceId: 'eval:debug-run:anthropic:claude-sonnet-4-6:case-1',
      diffTraceId: 'eval:debug-run:case-1:openai',
      diffProvider: 'openai',
      diffModel: 'gpt-5.5',
      diffRunLabel: 'debug-run-openai',
    });
  });

  it('requires a single case id or explicit trace id for replay mode', () => {
    expect(() => parseEvalArgs(['--replay'])).toThrow(/Invalid --replay: pass --id or --trace-id/);
  });

  it('requires a case id or explicit diff trace id for provider-based replay diffs', () => {
    expect(() =>
      parseEvalArgs([
        '--replay',
        '--trace-id=eval:debug-run:anthropic:claude-sonnet-4-6:case-1',
        '--diff-provider=openai',
        '--diff-model=gpt-5.5',
      ]),
    ).toThrow(/Invalid replay diff: pass --id or --diff-trace-id/);
  });

  it('parses matrix runner guardrails', () => {
    expect(
      parseEvalArgs([
        '--matrix',
        '--allow-full-dataset',
        '--allow-estimated-cost',
        '--max-estimated-cost-usd=2.5',
        '--anthropic-concurrency=2',
        '--openai-concurrency=3',
        '--retry-count=4',
        '--fail-fast-model-failure',
      ]),
    ).toMatchObject({
      matrixMode: true,
      matrixGuardrails: {
        allowFullDataset: true,
        allowEstimatedCostOverride: true,
        maxEstimatedCostUsd: 2.5,
        retryCount: 4,
        continueOnModelFailure: false,
        providerConcurrency: { anthropic: 2, openai: 3 },
      },
    });
  });

  it('defaults matrix guardrails to selected-case, low-cost runs', () => {
    expect(parseEvalArgs(['--matrix']).matrixGuardrails).toEqual({
      allowFullDataset: false,
      allowEstimatedCostOverride: false,
      maxEstimatedCostUsd: 1,
      retryCount: 1,
      continueOnModelFailure: true,
      providerConcurrency: { anthropic: 1, openai: 1 },
    });
  });

  it('rejects an empty local report output path', () => {
    expect(() => parseEvalArgs(['--local-report='])).toThrow(
      /Invalid --local-report: value cannot be empty/,
    );
  });

  it('defaults to the verified Anthropic Sonnet model', () => {
    expect(parseEvalArgs([]).providerConfig).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      reasoningEffort: undefined,
      maxOutputTokens: undefined,
      timeoutMs: undefined,
      toolLoopLimit: undefined,
    });
  });

  it('parses provider, model, run label, timeout, max output, reasoning effort, and tool loop limit', () => {
    expect(
      parseEvalArgs([
        '--provider=openai',
        '--model=gpt-5.5',
        '--run-label=matrix-smoke',
        '--timeout-ms=45000',
        '--max-output-tokens=2048',
        '--reasoning-effort=low',
        '--tool-loop-limit=6',
      ]).providerConfig,
    ).toEqual({
      provider: 'openai',
      model: 'gpt-5.5',
      reasoningEffort: 'low',
      maxOutputTokens: 2048,
      timeoutMs: 45000,
      toolLoopLimit: 6,
    });
  });

  it('uses run-label as the run name when present', () => {
    expect(parseEvalArgs(['--run-label=nightly-smoke']).runName).toBe('nightly-smoke');
  });

  it('keeps --name as a backwards-compatible run label alias', () => {
    expect(parseEvalArgs(['--name=legacy-name']).runName).toBe('legacy-name');
  });

  it('lets the --name alias override the environment run label', () => {
    expect(
      parseEvalArgs(['--name=legacy-name'], new Date('2026-05-01T02:00:00Z'), {
        SQUIRE_EVAL_RUN_LABEL: 'env-run',
      }).runName,
    ).toBe('legacy-name');
  });

  it('rejects conflicting run labels', () => {
    expect(() => parseEvalArgs(['--name=legacy', '--run-label=new'])).toThrow(
      /Invalid run label: use either --run-label or --name, not both/,
    );
  });

  it('applies environment fallback for eval provider config', () => {
    expect(
      parseEvalArgs([], new Date('2026-05-01T02:00:00Z'), {
        SQUIRE_EVAL_PROVIDER: 'anthropic',
        SQUIRE_EVAL_MODEL: 'claude-opus-4-7',
        SQUIRE_EVAL_RUN_LABEL: 'env-run',
        SQUIRE_EVAL_TIMEOUT_MS: '60000',
        SQUIRE_EVAL_MAX_OUTPUT_TOKENS: '4096',
        SQUIRE_EVAL_REASONING_EFFORT: 'high',
        SQUIRE_EVAL_TOOL_LOOP_LIMIT: '8',
      }),
    ).toMatchObject({
      runName: 'env-run',
      providerConfig: {
        provider: 'anthropic',
        model: 'claude-opus-4-7',
        reasoningEffort: 'high',
        maxOutputTokens: 4096,
        timeoutMs: 60000,
        toolLoopLimit: 8,
      },
    });
  });

  it('lets CLI values override environment fallback values', () => {
    expect(
      parseEvalArgs(
        [
          '--provider=openai',
          '--model=gpt-5.5',
          '--run-label=cli-run',
          '--timeout-ms=1000',
          '--max-output-tokens=128',
          '--reasoning-effort=none',
          '--tool-loop-limit=2',
        ],
        new Date('2026-05-01T02:00:00Z'),
        {
          SQUIRE_EVAL_PROVIDER: 'anthropic',
          SQUIRE_EVAL_MODEL: 'claude-opus-4-7',
          SQUIRE_EVAL_RUN_LABEL: 'env-run',
          SQUIRE_EVAL_TIMEOUT_MS: '60000',
          SQUIRE_EVAL_MAX_OUTPUT_TOKENS: '4096',
          SQUIRE_EVAL_REASONING_EFFORT: 'high',
          SQUIRE_EVAL_TOOL_LOOP_LIMIT: '8',
        },
      ),
    ).toMatchObject({
      runName: 'cli-run',
      providerConfig: {
        provider: 'openai',
        model: 'gpt-5.5',
        reasoningEffort: 'none',
        maxOutputTokens: 128,
        timeoutMs: 1000,
        toolLoopLimit: 2,
      },
    });
  });

  it('rejects unsupported providers', () => {
    expect(() => parseEvalArgs(['--provider=local'])).toThrow(
      /Invalid --provider: local. Expected "anthropic" or "openai"./,
    );
  });

  it('rejects unsupported model combinations', () => {
    expect(() => parseEvalArgs(['--provider=openai', '--model=claude-sonnet-4-6'])).toThrow(
      /Invalid --model: claude-sonnet-4-6 is not supported for provider openai/,
    );
  });

  it('rejects invalid reasoning effort for the selected provider', () => {
    expect(() =>
      parseEvalArgs([
        '--provider=anthropic',
        '--model=claude-sonnet-4-6',
        '--reasoning-effort=xhigh',
      ]),
    ).toThrow(/Invalid --reasoning-effort: xhigh is not supported for provider anthropic/);
  });

  it('rejects non-positive numeric config values', () => {
    expect(() => parseEvalArgs(['--timeout-ms=0'])).toThrow(
      /Invalid --timeout-ms: expected a positive integer/,
    );
    expect(() => parseEvalArgs(['--max-output-tokens=-1'])).toThrow(
      /Invalid --max-output-tokens: expected a positive integer/,
    );
    expect(() => parseEvalArgs(['--tool-loop-limit=1.5'])).toThrow(
      /Invalid --tool-loop-limit: expected a positive integer/,
    );
  });

  it('rejects invalid matrix guardrail values', () => {
    expect(() => parseEvalArgs(['--max-estimated-cost-usd=0'])).toThrow(
      /Invalid --max-estimated-cost-usd: expected a positive number/,
    );
    expect(() => parseEvalArgs(['--retry-count=-1'])).toThrow(
      /Invalid --retry-count: expected a non-negative integer/,
    );
    expect(() => parseEvalArgs(['--anthropic-concurrency=0'])).toThrow(
      /Invalid --anthropic-concurrency: expected a positive integer/,
    );
  });
});
