export type EvalToolSurface = 'redesigned' | 'legacy';
export type EvalProvider = 'anthropic' | 'openai';
export type EvalProviderModel = 'claude-sonnet-4-6' | 'claude-opus-4-7' | 'gpt-5.5';
export type EvalReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'max' | 'xhigh';

export interface EvalProviderConfig {
  provider: EvalProvider;
  model: EvalProviderModel;
  reasoningEffort: EvalReasoningEffort | undefined;
  maxOutputTokens: number | undefined;
  timeoutMs: number | undefined;
  toolLoopLimit: number | undefined;
}

export interface EvalCliOptions {
  shouldSeed: boolean;
  categoryFilter: string | undefined;
  idFilter: string | undefined;
  runName: string;
  toolSurface: EvalToolSurface;
  localReportPath: string | undefined;
  providerConfig: EvalProviderConfig;
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
  const defaultModel = provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-5.5';
  const model = assertModel(
    provider,
    settingFor(args, '--model=', env, 'SQUIRE_EVAL_MODEL') ?? defaultModel,
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
    },
  };
}
