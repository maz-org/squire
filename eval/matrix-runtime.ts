import Anthropic from '@anthropic-ai/sdk';
import { EVAL_MODELS_BY_PROVIDER, type EvalProviderConfig } from './cli.ts';
import { runAnthropicEvalCase, type AnthropicEvalCaseResult } from './anthropic-runner.ts';
import { runDeepAgentsEvalCase } from './deep-agents-runner.ts';
import {
  createOpenAiResponsesClient,
  runOpenAiResponsesEvalCase,
  type OpenAiResponsesClient,
  type OpenAiResponsesEvalResult,
} from './openai-runner.ts';
import { createLangSmithTraceWriterFromEnv } from './langsmith-trace.ts';
import {
  ESTIMATED_COST_PER_CASE_MODEL_USD,
  type EvalMatrixRunner,
  type EvalMatrixRunnerInput,
  type EvalMatrixRunnerOutput,
} from './matrix.ts';
import { passFromTraceScores, scoreFromTraceScores, traceScoresForEvalResult } from './scoring.ts';
import { withEvalTraceEnvironment, type EvalTraceInput, type EvalTraceWriter } from './trace.ts';

type AnthropicMatrixConfig = EvalProviderConfig & {
  provider: 'anthropic';
  model: (typeof EVAL_MODELS_BY_PROVIDER)['anthropic'][number];
};

function assertAnthropicMatrixConfig(config: EvalProviderConfig): AnthropicMatrixConfig {
  if (
    config.provider === 'anthropic' &&
    (EVAL_MODELS_BY_PROVIDER.anthropic as readonly string[]).includes(config.model)
  ) {
    return config as AnthropicMatrixConfig;
  }
  throw new Error(`Matrix runner does not support ${config.provider}:${config.model}.`);
}

function scoreValue(trace: EvalTraceInput): number | null {
  return scoreFromTraceScores(trace.judgeScores);
}

function passValue(trace: EvalTraceInput): boolean | null {
  return passFromTraceScores(trace.judgeScores);
}

function scoreNamed(trace: EvalTraceInput, name: string): number | null {
  const score = trace.judgeScores.find((candidate) => candidate.name === name);
  return typeof score?.value === 'number' ? score.value : null;
}

function failureClassFromTrace(trace: EvalTraceInput): string {
  const score = trace.judgeScores.find((candidate) => candidate.name === 'failure_class');
  return typeof score?.value === 'string' ? score.value : trace.statusReason;
}

function tokenUsage(trace: EvalTraceInput): EvalMatrixRunnerOutput['tokenUsage'] {
  return {
    input: trace.tokenUsage.input ?? 0,
    cachedInput: trace.tokenUsage.cached,
    output: trace.tokenUsage.output ?? 0,
    total: trace.tokenUsage.total ?? 0,
  };
}

function outputFromTrace(
  trace: EvalTraceInput,
  answer: string,
  ok: boolean,
  traceUrl: string,
): EvalMatrixRunnerOutput {
  return {
    ok,
    answer,
    traceId: trace.traceId,
    traceUrl,
    score: scoreValue(trace),
    pass: ok ? passValue(trace) : false,
    latencyMs: trace.durationMs ?? scoreNamed(trace, 'model_latency_ms') ?? 0,
    tokenUsage: tokenUsage(trace),
    estimatedCostUsd:
      nonZeroCost(trace.costEstimate.totalUsd) ??
      nonZeroCost(scoreNamed(trace, 'model_cost_usd')) ??
      ESTIMATED_COST_PER_CASE_MODEL_USD,
    toolCallCount: trace.toolCalls.length,
    loopIterations: scoreNamed(trace, 'loop_iterations') ?? 0,
    failureClass: failureClassFromTrace(trace),
    modelSettings: trace.modelSettings,
  };
}

function nonZeroCost(value: number | null | undefined): number | undefined {
  return value && value > 0 ? value : undefined;
}

function isRateLimitResult(result: OpenAiResponsesEvalResult): boolean {
  return (
    !result.ok &&
    result.failureClass === 'api_status' &&
    /rate.?limit|429/i.test(result.failureMessage ?? '')
  );
}

async function runAnthropicMatrixCase(
  input: EvalMatrixRunnerInput,
  anthropic: Anthropic,
  traceWriter: EvalTraceWriter | undefined,
): Promise<EvalMatrixRunnerOutput> {
  const result: AnthropicEvalCaseResult = await runAnthropicEvalCase({
    case: input.evalCase,
    runLabel: input.runLabel,
    toolSurface: input.toolSurface,
    providerConfig: assertAnthropicMatrixConfig(input.providerConfig),
    traceWriter,
    traceId: input.traceId,
    agentRuntime: input.agentRuntime === 'langgraph' ? 'langgraph' : 'claude-sdk',
    scoreResult: (runResult) =>
      traceScoresForEvalResult(anthropic, {
        evalCase: input.evalCase,
        answer: runResult.answer,
        toolCalls: runResult.trajectory.toolCalls,
      }),
  });

  return outputFromTrace(result.trace, result.answer, true, input.traceUrl);
}

async function runDeepAgentsMatrixCase(
  input: EvalMatrixRunnerInput,
  anthropic: Anthropic,
  traceWriter: EvalTraceWriter | undefined,
): Promise<EvalMatrixRunnerOutput> {
  if (input.providerConfig.provider !== 'anthropic') {
    throw new Error('Deep Agents eval runtime currently supports Anthropic provider configs only.');
  }
  const result = await runDeepAgentsEvalCase({
    case: input.evalCase,
    runLabel: input.runLabel,
    toolSurface: input.toolSurface,
    providerConfig: assertAnthropicMatrixConfig(input.providerConfig),
    traceWriter,
    traceId: input.traceId,
    scoreResult: (runResult) =>
      traceScoresForEvalResult(anthropic, {
        evalCase: input.evalCase,
        answer: runResult.answer,
        toolCalls: runResult.trajectory.toolCalls.filter(
          (toolCall) => !toolCall.name.startsWith('deep_agents.'),
        ),
      }),
  });

  return outputFromTrace(result.trace, result.answer, true, input.traceUrl);
}

async function runOpenAiMatrixCase(
  input: EvalMatrixRunnerInput,
  anthropic: Anthropic,
  traceWriter: EvalTraceWriter | undefined,
  client: OpenAiResponsesClient,
  env: NodeJS.ProcessEnv,
): Promise<EvalMatrixRunnerOutput> {
  const result = await runOpenAiResponsesEvalCase({
    client,
    evalCase: input.evalCase,
    providerConfig: input.providerConfig,
    agentRuntime: input.agentRuntime,
    runLabel: input.runLabel,
    toolSurface: input.toolSurface,
    traceWriter,
    traceId: input.traceId,
    env,
    scoreResult: async (runResult) =>
      runResult.ok
        ? traceScoresForEvalResult(anthropic, {
            evalCase: input.evalCase,
            answer: runResult.answer,
            toolCalls: runResult.trajectory.toolCalls,
          })
        : undefined,
  });

  if (isRateLimitResult(result)) {
    throw Object.assign(new Error(result.failureMessage ?? 'OpenAI rate limit'), { status: 429 });
  }

  return outputFromTrace(result.trace, result.answer, result.ok, input.traceUrl);
}

export function createEvalMatrixRunner(
  env: NodeJS.ProcessEnv = process.env,
  options: { langSmithTracing?: boolean } = {},
): EvalMatrixRunner {
  const anthropic = new Anthropic();
  const traceWriter =
    options.langSmithTracing === false
      ? undefined
      : withEvalTraceEnvironment(createLangSmithTraceWriterFromEnv(env), env);
  const openAiClient = createOpenAiResponsesClient(env);

  return async (input) => {
    if (input.agentRuntime === 'deep-agents') {
      return runDeepAgentsMatrixCase(input, anthropic, traceWriter);
    }

    if (input.providerConfig.provider === 'anthropic') {
      return runAnthropicMatrixCase(input, anthropic, traceWriter);
    }

    if (input.providerConfig.provider === 'openai') {
      return runOpenAiMatrixCase(input, anthropic, traceWriter, openAiClient, env);
    }

    throw new Error(`Matrix runner does not support provider ${input.providerConfig.provider}.`);
  };
}
