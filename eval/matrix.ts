import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  EvalMatrixGuardrails,
  EvalProvider,
  EvalProviderConfig,
  EvalReasoningEffort,
  EvalToolSurface,
} from './cli.ts';
import {
  evalMatrixRunSettingsFor,
  evalModelSettingsFor,
  evalRunCompatibilityFor,
  type EvalMatrixRunSettings,
  type EvalModelSettings,
} from './run-metadata.ts';
import type { EvalCase } from './schema.ts';

export type EvalMatrixSelection = 'id' | 'category' | 'all';

export interface EvalMatrixRunnerInput {
  evalCase: EvalCase;
  providerConfig: EvalProviderConfig;
  runLabel: string;
  toolSurface: EvalToolSurface;
  traceId: string;
  traceUrl: string;
  attempt: number;
}

export interface EvalMatrixRunnerOutput {
  ok: boolean;
  answer: string;
  traceId: string;
  traceUrl: string;
  runUrl?: string;
  score: number | null;
  pass: boolean | null;
  latencyMs: number;
  tokenUsage: {
    input: number;
    output: number;
    total: number;
  };
  estimatedCostUsd: number;
  toolCallCount: number;
  loopIterations: number;
  failureClass: string;
  modelSettings?: EvalModelSettings;
}

export type EvalMatrixRunner = (input: EvalMatrixRunnerInput) => Promise<EvalMatrixRunnerOutput>;

export interface EvalMatrixRow {
  runLabel: string;
  caseId: string;
  category: string;
  provider: EvalProvider;
  model: EvalProviderConfig['model'];
  ok: boolean;
  answer: string | null;
  score: number | null;
  pass: boolean | null;
  latencyMs: number | null;
  tokenInput: number | null;
  tokenOutput: number | null;
  tokenTotal: number | null;
  estimatedCostUsd: number | null;
  toolCallCount: number | null;
  retryCount: number;
  loopIterations: number | null;
  failureClass: string;
  traceId: string;
  traceUrl: string;
  promptVersion: string;
  promptHash: string;
  toolSurface: EvalToolSurface;
  toolSchemaVersion: string;
  toolSchemaHash: string;
  modelSettings: EvalModelSettings;
  runSettings: EvalMatrixRunSettings;
  runUrl?: string;
  error?: string;
}

export interface EvalMatrixResult {
  runLabel: string;
  rows: EvalMatrixRow[];
  estimatedCostUsd: number;
}

export interface RunEvalMatrixOptions {
  cases: EvalCase[];
  runLabel: string;
  toolSurface: EvalToolSurface;
  selection: EvalMatrixSelection;
  modelConfigs: EvalProviderConfig[];
  runner: EvalMatrixRunner;
  guardrails: EvalMatrixGuardrails;
  langfuseBaseUrl: string;
}

export const ESTIMATED_COST_PER_CASE_MODEL_USD = 0.05;

export const DEFAULT_EVAL_MATRIX_MODELS: EvalProviderConfig[] = [
  {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    reasoningEffort: undefined,
    maxOutputTokens: undefined,
    timeoutMs: undefined,
    toolLoopLimit: undefined,
  },
  {
    provider: 'anthropic',
    model: 'claude-opus-4-7',
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

function withSharedKnobs(
  config: EvalProviderConfig,
  shared: EvalProviderConfig,
): EvalProviderConfig {
  return {
    ...config,
    reasoningEffort: providerSupportsReasoningEffort(config.provider, shared.reasoningEffort)
      ? shared.reasoningEffort
      : undefined,
    maxOutputTokens: shared.maxOutputTokens,
    timeoutMs: shared.timeoutMs,
    toolLoopLimit: shared.toolLoopLimit,
  };
}

function providerSupportsReasoningEffort(
  provider: EvalProvider,
  effort: EvalReasoningEffort | undefined,
): boolean {
  if (!effort) return false;
  if (provider === 'anthropic') return ['low', 'medium', 'high', 'max'].includes(effort);
  return ['none', 'low', 'medium', 'high', 'xhigh'].includes(effort);
}

export function defaultEvalMatrixModels(sharedConfig: EvalProviderConfig): EvalProviderConfig[] {
  return DEFAULT_EVAL_MATRIX_MODELS.map((config) => withSharedKnobs(config, sharedConfig));
}

function slugPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '-');
}

export function traceIdForMatrixRow(
  runLabel: string,
  evalCase: EvalCase,
  providerConfig: EvalProviderConfig,
): string {
  return [
    'eval',
    slugPart(runLabel),
    providerConfig.provider,
    slugPart(providerConfig.model),
    slugPart(evalCase.id),
  ].join(':');
}

export function langfuseTraceUrl(baseUrl: string, traceId: string): string {
  return `${baseUrl.replace(/\/$/, '')}/project/default/traces/${encodeURIComponent(traceId)}`;
}

function estimateMatrixCost(cases: EvalCase[], configs: EvalProviderConfig[]): number {
  return cases.length * configs.length * ESTIMATED_COST_PER_CASE_MODEL_USD;
}

export function assertEvalMatrixGuardrails(
  options: Pick<RunEvalMatrixOptions, 'cases' | 'modelConfigs' | 'selection' | 'guardrails'>,
): void {
  const estimatedCostUsd = estimateMatrixCost(options.cases, options.modelConfigs);

  if (options.selection === 'all' && !options.guardrails.allowFullDataset) {
    throw new Error(
      `A full-dataset matrix run requires --allow-full-dataset (${options.cases.length} case(s), ${options.modelConfigs.length} model(s)).`,
    );
  }

  if (
    estimatedCostUsd > options.guardrails.maxEstimatedCostUsd &&
    !options.guardrails.allowEstimatedCostOverride
  ) {
    throw new Error(
      `Estimated matrix cost $${estimatedCostUsd.toFixed(2)} exceeds --max-estimated-cost-usd=${options.guardrails.maxEstimatedCostUsd} and requires --allow-estimated-cost to proceed.`,
    );
  }

  for (const provider of ['anthropic', 'openai'] as const) {
    const concurrency = options.guardrails.providerConcurrency[provider];
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error(`Invalid ${provider} matrix concurrency: expected a positive integer.`);
    }
  }
}

function isRateLimitError(error: unknown): boolean {
  const status =
    typeof error === 'object' && error && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  if (status === 429) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /rate.?limit|429/i.test(message);
}

function failureClassForError(error: unknown): string {
  if (isRateLimitError(error)) return 'rate_limit';
  const status =
    typeof error === 'object' && error && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  if (status === 401 || status === 403 || status === 404) return 'model_access';
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|abort/i.test(message)) return 'timeout';
  return 'provider_error';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function matrixRetryCountForError(error: unknown): number | undefined {
  return typeof error === 'object' && error && 'matrixRetryCount' in error
    ? Number((error as { matrixRetryCount?: unknown }).matrixRetryCount)
    : undefined;
}

function errorWithRetryCount(error: unknown, retryCount: number): unknown {
  if (typeof error === 'object' && error) {
    return Object.assign(error, { matrixRetryCount: retryCount });
  }
  return Object.assign(new Error(String(error)), { matrixRetryCount: retryCount });
}

async function runWithRetries(
  input: EvalMatrixRunnerInput,
  runner: EvalMatrixRunner,
  retryCount: number,
): Promise<{ output: EvalMatrixRunnerOutput; retryCount: number }> {
  let attempts = 0;
  for (;;) {
    try {
      const output = await runner({ ...input, attempt: attempts + 1 });
      return { output, retryCount: attempts };
    } catch (error) {
      if (!isRateLimitError(error) || attempts >= retryCount) {
        throw errorWithRetryCount(error, attempts);
      }
      attempts += 1;
    }
  }
}

function rowFromOutput(
  input: EvalMatrixRunnerInput,
  output: EvalMatrixRunnerOutput,
  retryCount: number,
  guardrails: EvalMatrixGuardrails,
): EvalMatrixRow {
  const compatibility = evalRunCompatibilityFor(input.providerConfig, input.toolSurface);
  return {
    runLabel: input.runLabel,
    caseId: input.evalCase.id,
    category: input.evalCase.category,
    provider: input.providerConfig.provider,
    model: input.providerConfig.model,
    ok: output.ok,
    answer: output.answer,
    score: output.score,
    pass: output.pass,
    latencyMs: output.latencyMs,
    tokenInput: output.tokenUsage.input,
    tokenOutput: output.tokenUsage.output,
    tokenTotal: output.tokenUsage.total,
    estimatedCostUsd: output.estimatedCostUsd,
    toolCallCount: output.toolCallCount,
    retryCount,
    loopIterations: output.loopIterations,
    failureClass: output.failureClass,
    traceId: output.traceId,
    traceUrl: output.traceUrl,
    ...compatibility,
    modelSettings: {
      ...evalModelSettingsFor(input.providerConfig),
      ...(output.modelSettings ?? {}),
    },
    runSettings: evalMatrixRunSettingsFor(guardrails),
    runUrl: output.runUrl,
  };
}

function rowFromError(
  input: EvalMatrixRunnerInput,
  error: unknown,
  retryCount: number,
  guardrails: EvalMatrixGuardrails,
): EvalMatrixRow {
  const compatibility = evalRunCompatibilityFor(input.providerConfig, input.toolSurface);
  return {
    runLabel: input.runLabel,
    caseId: input.evalCase.id,
    category: input.evalCase.category,
    provider: input.providerConfig.provider,
    model: input.providerConfig.model,
    ok: false,
    answer: null,
    score: null,
    pass: false,
    latencyMs: null,
    tokenInput: null,
    tokenOutput: null,
    tokenTotal: null,
    estimatedCostUsd: null,
    toolCallCount: null,
    retryCount,
    loopIterations: null,
    failureClass: failureClassForError(error),
    traceId: input.traceId,
    traceUrl: input.traceUrl,
    ...compatibility,
    modelSettings: evalModelSettingsFor(input.providerConfig),
    runSettings: evalMatrixRunSettingsFor(guardrails),
    error: errorMessage(error),
  };
}

async function runMatrixInput(
  input: EvalMatrixRunnerInput,
  runner: EvalMatrixRunner,
  guardrails: EvalMatrixGuardrails,
): Promise<EvalMatrixRow> {
  try {
    const result = await runWithRetries(input, runner, guardrails.retryCount);
    return rowFromOutput(input, result.output, result.retryCount, guardrails);
  } catch (error) {
    if (!guardrails.continueOnModelFailure) throw error;
    const retryCount = matrixRetryCountForError(error) ?? 0;
    return rowFromError(input, error, retryCount, guardrails);
  }
}

async function runProviderQueue(
  inputs: EvalMatrixRunnerInput[],
  concurrency: number,
  runner: EvalMatrixRunner,
  guardrails: EvalMatrixGuardrails,
): Promise<EvalMatrixRow[]> {
  const rows: EvalMatrixRow[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const input = inputs[index];
      if (!input) return;
      rows[index] = await runMatrixInput(input, runner, guardrails);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()));
  return rows;
}

export async function runEvalMatrix(options: RunEvalMatrixOptions): Promise<EvalMatrixResult> {
  const estimatedCostUsd = estimateMatrixCost(options.cases, options.modelConfigs);
  assertEvalMatrixGuardrails(options);

  const inputs = options.cases.flatMap((evalCase) =>
    options.modelConfigs.map((providerConfig) => {
      const traceId = traceIdForMatrixRow(options.runLabel, evalCase, providerConfig);
      return {
        evalCase,
        providerConfig,
        runLabel: options.runLabel,
        toolSurface: options.toolSurface,
        traceId,
        traceUrl: langfuseTraceUrl(options.langfuseBaseUrl, traceId),
        attempt: 1,
      };
    }),
  );

  const rowsByProvider = await Promise.all(
    (['anthropic', 'openai'] as const).map((provider) =>
      runProviderQueue(
        inputs.filter((input) => input.providerConfig.provider === provider),
        options.guardrails.providerConcurrency[provider],
        options.runner,
        options.guardrails,
      ),
    ),
  );
  const unorderedRows = rowsByProvider.flat();
  const rowKey = (row: EvalMatrixRow) => `${row.caseId}:${row.provider}:${row.model}`;
  const rowsByKey = new Map(unorderedRows.map((row) => [rowKey(row), row]));
  const rows = inputs.map((input) =>
    rowsByKey.get(
      `${input.evalCase.id}:${input.providerConfig.provider}:${input.providerConfig.model}`,
    ),
  );

  return {
    runLabel: options.runLabel,
    rows: rows.filter((row): row is EvalMatrixRow => !!row),
    estimatedCostUsd,
  };
}

function formatNullable(value: string | number | boolean | null | undefined): string {
  if (value === undefined || value === null) return '-';
  return String(value);
}

export function formatEvalMatrixTable(rows: EvalMatrixRow[]): string {
  const lines = [
    'case\tmodel\tpass\tfailure_class\tscore\tlatency_ms\ttokens\tcost_usd\ttools\tretries\tloops\ttrace\terror',
  ];
  for (const row of rows) {
    lines.push(
      [
        row.caseId,
        `${row.provider}:${row.model}`,
        row.pass === null ? '-' : row.pass ? 'pass' : 'fail',
        row.failureClass,
        formatNullable(row.score),
        formatNullable(row.latencyMs),
        row.tokenTotal === null ? '-' : `${row.tokenInput}/${row.tokenOutput}/${row.tokenTotal}`,
        row.estimatedCostUsd === null ? '-' : row.estimatedCostUsd.toFixed(4),
        formatNullable(row.toolCallCount),
        row.retryCount,
        formatNullable(row.loopIterations),
        row.traceUrl,
        row.error ?? '',
      ].join('\t'),
    );
  }
  return lines.join('\n');
}

export function writeEvalMatrixLocalReport(outputPath: string, result: EvalMatrixResult): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        ...result,
      },
      null,
      2,
    )}\n`,
  );
}
