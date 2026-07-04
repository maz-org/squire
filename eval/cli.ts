import { requireGameId } from '../src/game.ts';
import { EvalSplitSchema, type EvalSplit } from './schema.ts';

export type EvalToolSurface = 'redesigned' | 'legacy';
export type EvalAgentRuntime = 'claude-sdk' | 'deep-agents' | 'langgraph';
export type EvalProvider = 'anthropic' | 'openai';
export type EvalProviderModel =
  | 'claude-sonnet-4-6'
  | 'claude-opus-4-7'
  | 'claude-haiku-4-5'
  | 'gpt-5.5'
  | 'gpt-5.4'
  | 'gpt-5.4-mini'
  | 'gpt-5.4-nano';
export type EvalReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'max' | 'xhigh';

export const DEFAULT_EVAL_MODELS = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-5.5',
} as const satisfies Record<EvalProvider, EvalProviderModel>;

export const EVAL_MODELS_BY_PROVIDER = {
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5'],
  openai: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano'],
} as const satisfies Record<EvalProvider, readonly EvalProviderModel[]>;

export interface EvalProviderConfig {
  provider: EvalProvider;
  model: EvalProviderModel;
  reasoningEffort: EvalReasoningEffort | undefined;
  maxOutputTokens: number | undefined;
  timeoutMs: number | undefined;
  toolLoopLimit: number | undefined;
  broadSearchSynthesisThreshold?: number | undefined;
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
  gameFilter: string | undefined;
  suiteFilter: string | undefined;
  splitFilter: EvalSplit | undefined;
  categoryFilter: string | undefined;
  idFilter: string | undefined;
  runName: string;
  toolSurface: EvalToolSurface;
  localReportPath: string | undefined;
  providerConfig: EvalProviderConfig;
  agentRuntime: EvalAgentRuntime;
  matrixAgentRuntimes: EvalAgentRuntime[];
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

function assertAgentRuntime(value: string): EvalAgentRuntime {
  if (value === 'deep-agents' || value === 'langgraph') return value;

  throw new Error(
    `Invalid --agent-runtime: ${value}. Expected "langgraph", "deep-agents", or "both".`,
  );
}

function assertGameFilter(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return requireGameId(value);
  } catch {
    throw new Error(`Invalid --game: ${value}. Expected "frosthaven" or "gloomhaven-2e".`);
  }
}

function assertSplitFilter(value: string | undefined): EvalSplit | undefined {
  if (!value) return undefined;
  try {
    return EvalSplitSchema.parse(value);
  } catch {
    throw new Error(`Invalid --split: ${value}. Expected "dev" or "holdout".`);
  }
}

function matrixAgentRuntimesFor(args: string[], env: NodeJS.ProcessEnv): EvalAgentRuntime[] {
  const raw = settingFor(args, '--agent-runtime=', env, 'SQUIRE_EVAL_AGENT_RUNTIME') ?? 'langgraph';
  if (raw === 'both') return ['langgraph', 'deep-agents'];
  const runtimes = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(assertAgentRuntime);
  if (runtimes.length === 0) {
    throw new Error('Invalid --agent-runtime: expected at least one runtime.');
  }
  return [...new Set(runtimes)];
}

export function defaultEvalModelForProvider(provider: EvalProvider): EvalProviderModel {
  return DEFAULT_EVAL_MODELS[provider];
}

function assertModel(provider: EvalProvider, value: string): EvalProviderModel {
  if ((EVAL_MODELS_BY_PROVIDER[provider] as readonly string[]).includes(value)) {
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
  const removedReplayFlags = [
    '--replay',
    '--trace-id=',
    '--diff-trace-id=',
    '--diff-provider=',
    '--diff-model=',
    '--diff-run-label=',
  ];
  if (args.some((arg) => removedReplayFlags.some((flag) => arg === flag || arg.startsWith(flag)))) {
    throw new Error('Eval trace replay is not implemented for LangSmith; use matrix reports.');
  }

  const surface = valueFor(args, '--tool-surface=') ?? 'redesigned';
  if (surface !== 'redesigned') {
    throw new Error(`Invalid --tool-surface: ${surface}. Expected "redesigned".`);
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
  const matrixAgentRuntimes = matrixAgentRuntimesFor(args, env);

  return {
    shouldSeed: args.includes('--seed'),
    gameFilter: assertGameFilter(valueFor(args, '--game=')),
    suiteFilter: valueFor(args, '--suite='),
    splitFilter: assertSplitFilter(settingFor(args, '--split=', env, 'SQUIRE_EVAL_SPLIT')),
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
    agentRuntime: matrixAgentRuntimes[0],
    matrixAgentRuntimes,
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
