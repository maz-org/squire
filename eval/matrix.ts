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
    cachedInput?: number | undefined;
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
  tokenCachedInput: number | null;
  tokenOutput: number | null;
  tokenTotal: number | null;
  guardrailEstimatedCostUsd: number;
  providerEstimatedCostUsd: number | null;
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
  guardrailEstimatedCostUsd: number;
  estimatedCostUsd: number;
}

export interface EvalMatrixProgressEvent {
  completed: number;
  total: number;
  row: EvalMatrixRow;
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
  langfuseProjectId?: string;
  onProgress?: (event: EvalMatrixProgressEvent) => void;
}

export const ESTIMATED_COST_PER_CASE_MODEL_USD = 0.05;

interface EvalModelPrice {
  inputUsdPerMillionTokens: number;
  cachedInputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
}

type EvalModelPriceKey = `${EvalProvider}:${EvalProviderConfig['model']}`;

const priceKey = (config: Pick<EvalProviderConfig, 'provider' | 'model'>): EvalModelPriceKey =>
  `${config.provider}:${config.model}` as EvalModelPriceKey;

// These are API token prices for the eval candidate models, separate from the
// flat guardrail estimate used to decide whether a run may start.
export const EVAL_MODEL_PRICE_TABLE: Partial<Record<EvalModelPriceKey, EvalModelPrice>> = {
  'anthropic:claude-sonnet-4-6': {
    inputUsdPerMillionTokens: 3,
    cachedInputUsdPerMillionTokens: 0.3,
    outputUsdPerMillionTokens: 15,
  },
  'anthropic:claude-opus-4-7': {
    inputUsdPerMillionTokens: 5,
    cachedInputUsdPerMillionTokens: 0.5,
    outputUsdPerMillionTokens: 25,
  },
  'anthropic:claude-haiku-4-5': {
    inputUsdPerMillionTokens: 1,
    cachedInputUsdPerMillionTokens: 0.1,
    outputUsdPerMillionTokens: 5,
  },
  'openai:gpt-5.5': {
    inputUsdPerMillionTokens: 5,
    cachedInputUsdPerMillionTokens: 0.5,
    outputUsdPerMillionTokens: 30,
  },
  'openai:gpt-5.4': {
    inputUsdPerMillionTokens: 2.5,
    cachedInputUsdPerMillionTokens: 0.25,
    outputUsdPerMillionTokens: 15,
  },
  'openai:gpt-5.4-mini': {
    inputUsdPerMillionTokens: 0.75,
    cachedInputUsdPerMillionTokens: 0.075,
    outputUsdPerMillionTokens: 4.5,
  },
  'openai:gpt-5.4-nano': {
    inputUsdPerMillionTokens: 0.2,
    cachedInputUsdPerMillionTokens: 0.02,
    outputUsdPerMillionTokens: 1.25,
  },
} as const;

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
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
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
  {
    provider: 'openai',
    model: 'gpt-5.4',
    reasoningEffort: undefined,
    maxOutputTokens: undefined,
    timeoutMs: undefined,
    toolLoopLimit: undefined,
  },
  {
    provider: 'openai',
    model: 'gpt-5.4-mini',
    reasoningEffort: undefined,
    maxOutputTokens: undefined,
    timeoutMs: undefined,
    toolLoopLimit: undefined,
  },
  {
    provider: 'openai',
    model: 'gpt-5.4-nano',
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
    broadSearchSynthesisThreshold: shared.broadSearchSynthesisThreshold,
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

export function langfuseTraceUrl(baseUrl: string, projectId: string, traceId: string): string {
  return `${baseUrl.replace(/\/$/, '')}/project/${encodeURIComponent(projectId)}/traces/${encodeURIComponent(traceId)}`;
}

function estimateMatrixCost(cases: EvalCase[], configs: EvalProviderConfig[]): number {
  return cases.length * configs.length * ESTIMATED_COST_PER_CASE_MODEL_USD;
}

function roundUsd(value: number): number {
  return Number(value.toFixed(6));
}

function providerCostEstimateUsd(
  providerConfig: EvalProviderConfig,
  tokenUsage: EvalMatrixRunnerOutput['tokenUsage'],
): number | null {
  const price = EVAL_MODEL_PRICE_TABLE[priceKey(providerConfig)];
  if (!price) return null;

  const cachedInput = Math.min(Math.max(0, tokenUsage.cachedInput ?? 0), tokenUsage.input);
  const uncachedInput = Math.max(0, tokenUsage.input - cachedInput);
  return roundUsd(
    (uncachedInput * price.inputUsdPerMillionTokens +
      cachedInput * price.cachedInputUsdPerMillionTokens +
      tokenUsage.output * price.outputUsdPerMillionTokens) /
      1_000_000,
  );
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
  const providerEstimatedCostUsd =
    providerCostEstimateUsd(input.providerConfig, output.tokenUsage) ?? output.estimatedCostUsd;
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
    tokenCachedInput: output.tokenUsage.cachedInput ?? null,
    tokenOutput: output.tokenUsage.output,
    tokenTotal: output.tokenUsage.total,
    guardrailEstimatedCostUsd: ESTIMATED_COST_PER_CASE_MODEL_USD,
    providerEstimatedCostUsd,
    estimatedCostUsd: providerEstimatedCostUsd,
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
    tokenCachedInput: null,
    tokenOutput: null,
    tokenTotal: null,
    guardrailEstimatedCostUsd: ESTIMATED_COST_PER_CASE_MODEL_USD,
    providerEstimatedCostUsd: null,
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
  onRowComplete: (row: EvalMatrixRow) => void,
): Promise<EvalMatrixRow[]> {
  const rows: EvalMatrixRow[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const input = inputs[index];
      if (!input) return;
      const row = await runMatrixInput(input, runner, guardrails);
      rows[index] = row;
      onRowComplete(row);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()));
  return rows;
}

export async function runEvalMatrix(options: RunEvalMatrixOptions): Promise<EvalMatrixResult> {
  const guardrailEstimatedCostUsd = estimateMatrixCost(options.cases, options.modelConfigs);
  assertEvalMatrixGuardrails(options);
  const configuredLangfuseProjectId = options.langfuseProjectId?.trim();
  const langfuseProjectId =
    configuredLangfuseProjectId && configuredLangfuseProjectId.length > 0
      ? configuredLangfuseProjectId
      : 'default';

  const inputs = options.cases.flatMap((evalCase) =>
    options.modelConfigs.map((providerConfig) => {
      const traceId = traceIdForMatrixRow(options.runLabel, evalCase, providerConfig);
      return {
        evalCase,
        providerConfig,
        runLabel: options.runLabel,
        toolSurface: options.toolSurface,
        traceId,
        traceUrl: langfuseTraceUrl(options.langfuseBaseUrl, langfuseProjectId, traceId),
        attempt: 1,
      };
    }),
  );

  let completed = 0;
  const onRowComplete = (row: EvalMatrixRow) => {
    completed += 1;
    options.onProgress?.({ completed, total: inputs.length, row });
  };

  const rowsByProvider = await Promise.all(
    (['anthropic', 'openai'] as const).map((provider) =>
      runProviderQueue(
        inputs.filter((input) => input.providerConfig.provider === provider),
        options.guardrails.providerConcurrency[provider],
        options.runner,
        options.guardrails,
        onRowComplete,
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
    guardrailEstimatedCostUsd,
    estimatedCostUsd: guardrailEstimatedCostUsd,
  };
}

function formatNullable(value: string | number | boolean | null | undefined): string {
  if (value === undefined || value === null) return '-';
  return String(value);
}

export function formatEvalMatrixTable(rows: EvalMatrixRow[]): string {
  const lines = [
    'case\tmodel\tpass\tfailure_class\tscore\tlatency_ms\ttokens\tcached_input_tokens\tguardrail_cost_usd\tprovider_cost_usd\ttools\tretries\tloops\ttrace\terror',
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
        formatNullable(row.tokenCachedInput),
        row.guardrailEstimatedCostUsd.toFixed(4),
        row.providerEstimatedCostUsd === null ? '-' : row.providerEstimatedCostUsd.toFixed(4),
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
