export type EvalToolSurface = 'redesigned' | 'legacy';
export type EvalProvider = 'anthropic' | 'openai';
export type EvalProviderModel = 'claude-sonnet-4-6' | 'claude-opus-4-7' | 'gpt-5.5';
export type EvalReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'max' | 'xhigh';

export const DEFAULT_EVAL_MODELS = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-5.5',
} as const satisfies Record<EvalProvider, EvalProviderModel>;

export interface EvalProviderConfig {
  provider: EvalProvider;
  model: EvalProviderModel;
  reasoningEffort: EvalReasoningEffort | undefined;
  maxOutputTokens: number | undefined;
  timeoutMs: number | undefined;
  toolLoopLimit: number | undefined;
  broadSearchSynthesisThreshold?: number | undefined;
}

export interface EvalReplayCliOptions {
  enabled: boolean;
  traceId: string | undefined;
  diffTraceId: string | undefined;
  diffProvider: EvalProvider | undefined;
  diffModel: EvalProviderModel | undefined;
  diffRunLabel: string | undefined;
}

export interface EvalMatrixGuardrails {
  allowFullDataset: boolean;
  allowEstimatedCostOverride: boolean;
  maxEstimatedCostUsd: number;
  retryCount: number;
  continueOnModelFailure: boolean;
  providerConcurrency: Record<EvalProvider, number>;
}

export interface EvalCliOptions {
  shouldSeed: boolean;
  categoryFilter: string | undefined;
  idFilter: string | undefined;
  runName: string;
  toolSurface: EvalToolSurface;
  localReportPath: string | undefined;
  providerConfig: EvalProviderConfig;
  replay: EvalReplayCliOptions | undefined;
  matrixMode: boolean;
  matrixGuardrails: EvalMatrixGuardrails;
  comparison: EvalRunComparisonCliOptions | undefined;
}

export interface EvalRunComparisonCliOptions {
  beforeReportPath: string;
  afterReportPath: string;
}

function valueFor(args: string[], prefix: string): string | undefined {
  const arg = args.find((candidate) => candidate.startsWith(prefix));
  if (!arg) return undefined;

  const value = arg.slice(prefix.length);
  if (value.length === 0) {
    throw new Error(`Invalid ${prefix.slice(0, -1)}: value cannot be empty.`);
  }
  return value;
}

function settingFor(
  args: string[],
  prefix: string,
  env: NodeJS.ProcessEnv,
  envName: string,
): string | undefined {
  return valueFor(args, prefix) ?? env[envName];
}

function assertProvider(value: string): EvalProvider {
  if (value === 'anthropic' || value === 'openai') return value;

  throw new Error(`Invalid --provider: ${value}. Expected "anthropic" or "openai".`);
}

export function defaultEvalModelForProvider(provider: EvalProvider): EvalProviderModel {
  return DEFAULT_EVAL_MODELS[provider];
}

function assertModel(provider: EvalProvider, value: string): EvalProviderModel {
  const modelsByProvider = {
    anthropic: ['claude-sonnet-4-6', 'claude-opus-4-7'],
    openai: ['gpt-5.5'],
  } as const;
  if ((modelsByProvider[provider] as readonly string[]).includes(value)) {
    return value as EvalProviderModel;
  }

  throw new Error(`Invalid --model: ${value} is not supported for provider ${provider}.`);
}

function assertReasoningEffort(
  provider: EvalProvider,
  value: string | undefined,
): EvalReasoningEffort | undefined {
  if (!value) return undefined;

  const effortsByProvider = {
    anthropic: ['low', 'medium', 'high', 'max'],
    openai: ['none', 'low', 'medium', 'high', 'xhigh'],
  } as const;
  if ((effortsByProvider[provider] as readonly string[]).includes(value)) {
    return value as EvalReasoningEffort;
  }

  throw new Error(
    `Invalid --reasoning-effort: ${value} is not supported for provider ${provider}.`,
  );
}

function positiveIntegerFor(
  args: string[],
  prefix: string,
  env: NodeJS.ProcessEnv,
  envName: string,
): number | undefined {
  const value = settingFor(args, prefix, env, envName);
  if (!value) return undefined;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${prefix.slice(0, -1)}: expected a positive integer.`);
  }
  return parsed;
}

function replayOptionsFor(
  args: string[],
  idFilter: string | undefined,
  provider: EvalProvider,
): EvalReplayCliOptions | undefined {
  const enabled = args.includes('--replay');
  const traceId = valueFor(args, '--trace-id=');
  const diffTraceId = valueFor(args, '--diff-trace-id=');
  const diffRunLabel = valueFor(args, '--diff-run-label=');
  const rawDiffProvider = valueFor(args, '--diff-provider=');
  const diffProvider = rawDiffProvider ? assertProvider(rawDiffProvider) : undefined;
  const rawDiffModel = valueFor(args, '--diff-model=');
  const diffModel = rawDiffModel ? assertModel(diffProvider ?? provider, rawDiffModel) : undefined;

  if (!enabled && !traceId && !diffTraceId && !diffProvider && !diffModel && !diffRunLabel) {
    return undefined;
  }

  if (!enabled) {
    throw new Error('Invalid replay options: pass --replay when using replay trace flags.');
  }
  if (!traceId && !idFilter) {
    throw new Error('Invalid --replay: pass --id or --trace-id.');
  }
  if (!diffTraceId && !idFilter && (diffProvider || diffModel || diffRunLabel)) {
    throw new Error('Invalid replay diff: pass --id or --diff-trace-id.');
  }

  return {
    enabled,
    traceId,
    diffTraceId,
    diffProvider,
    diffModel,
    diffRunLabel,
  };
}

function optionalPositiveIntegerFor(args: string[], prefix: string, fallback: number): number {
  const value = valueFor(args, prefix);
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${prefix.slice(0, -1)}: expected a positive integer.`);
  }
  return parsed;
}

function optionalNonNegativeIntegerFor(args: string[], prefix: string, fallback: number): number {
  const value = valueFor(args, prefix);
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${prefix.slice(0, -1)}: expected a non-negative integer.`);
  }
  return parsed;
}

function optionalPositiveNumberFor(args: string[], prefix: string, fallback: number): number {
  const value = valueFor(args, prefix);
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${prefix.slice(0, -1)}: expected a positive number.`);
  }
  return parsed;
}

function comparisonOptionsFor(args: string[]): EvalRunComparisonCliOptions | undefined {
  const raw = valueFor(args, '--compare-runs=');
  if (!raw) return undefined;

  const paths = raw
    .split(',')
    .map((path) => path.trim())
    .filter(Boolean);
  if (paths.length !== 2) {
    throw new Error('Invalid --compare-runs: expected two comma-separated report paths.');
  }
  return {
    beforeReportPath: paths[0],
    afterReportPath: paths[1],
  };
}

export function parseEvalArgs(
  args: string[],
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): EvalCliOptions {
  const surface = valueFor(args, '--tool-surface=') ?? 'redesigned';
  if (surface !== 'redesigned' && surface !== 'legacy') {
    throw new Error(`Invalid --tool-surface: ${surface}. Expected "redesigned" or "legacy".`);
  }

  const legacyName = valueFor(args, '--name=');
  const cliRunLabel = valueFor(args, '--run-label=');
  if (legacyName && cliRunLabel) {
    throw new Error('Invalid run label: use either --run-label or --name, not both.');
  }
  const runName =
    legacyName ??
    cliRunLabel ??
    env.SQUIRE_EVAL_RUN_LABEL ??
    `eval-${now.toISOString().slice(0, 16)}-${surface}`;

  const provider = assertProvider(
    settingFor(args, '--provider=', env, 'SQUIRE_EVAL_PROVIDER') ?? 'anthropic',
  );
  const model = assertModel(
    provider,
    settingFor(args, '--model=', env, 'SQUIRE_EVAL_MODEL') ?? defaultEvalModelForProvider(provider),
  );
  const reasoningEffort = assertReasoningEffort(
    provider,
    settingFor(args, '--reasoning-effort=', env, 'SQUIRE_EVAL_REASONING_EFFORT'),
  );

  return {
    shouldSeed: args.includes('--seed'),
    categoryFilter: valueFor(args, '--category='),
    idFilter: valueFor(args, '--id='),
    runName,
    toolSurface: surface,
    localReportPath: valueFor(args, '--local-report='),
    providerConfig: {
      provider,
      model,
      reasoningEffort,
      maxOutputTokens: positiveIntegerFor(
        args,
        '--max-output-tokens=',
        env,
        'SQUIRE_EVAL_MAX_OUTPUT_TOKENS',
      ),
      timeoutMs: positiveIntegerFor(args, '--timeout-ms=', env, 'SQUIRE_EVAL_TIMEOUT_MS'),
      toolLoopLimit: positiveIntegerFor(
        args,
        '--tool-loop-limit=',
        env,
        'SQUIRE_EVAL_TOOL_LOOP_LIMIT',
      ),
      broadSearchSynthesisThreshold: positiveIntegerFor(
        args,
        '--broad-search-synthesis-threshold=',
        env,
        'SQUIRE_EVAL_BROAD_SEARCH_SYNTHESIS_THRESHOLD',
      ),
    },
    replay: replayOptionsFor(args, valueFor(args, '--id='), provider),
    matrixMode: args.includes('--matrix'),
    matrixGuardrails: {
      allowFullDataset: args.includes('--allow-full-dataset'),
      allowEstimatedCostOverride: args.includes('--allow-estimated-cost'),
      maxEstimatedCostUsd: optionalPositiveNumberFor(args, '--max-estimated-cost-usd=', 1),
      retryCount: optionalNonNegativeIntegerFor(args, '--retry-count=', 1),
      continueOnModelFailure: !args.includes('--fail-fast-model-failure'),
      providerConcurrency: {
        anthropic: optionalPositiveIntegerFor(args, '--anthropic-concurrency=', 1),
        openai: optionalPositiveIntegerFor(args, '--openai-concurrency=', 1),
      },
    },
    comparison: comparisonOptionsFor(args),
  };
}
