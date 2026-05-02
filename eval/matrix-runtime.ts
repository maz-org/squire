import Anthropic from '@anthropic-ai/sdk';
import type { LangfuseClient } from '@langfuse/client';
import type { EvalProviderConfig } from './cli.ts';
import { runAnthropicEvalCase, type AnthropicEvalCaseResult } from './anthropic-runner.ts';
import {
  createOpenAiResponsesClient,
  runOpenAiResponsesEvalCase,
  type OpenAiResponsesClient,
  type OpenAiResponsesEvalResult,
} from './openai-runner.ts';
import {
  ESTIMATED_COST_PER_CASE_MODEL_USD,
  type EvalMatrixRunner,
  type EvalMatrixRunnerInput,
  type EvalMatrixRunnerOutput,
} from './matrix.ts';
import { passFromTraceScores, scoreFromTraceScores, traceScoresForEvalResult } from './scoring.ts';
import type { EvalTraceInput, LangfuseTraceIngestionClient } from './trace.ts';

type AnthropicMatrixConfig = EvalProviderConfig & {
  provider: 'anthropic';
  model: 'claude-sonnet-4-6' | 'claude-opus-4-7';
};

function traceClientFor(langfuse: LangfuseClient): LangfuseTraceIngestionClient {
  return langfuse as unknown as LangfuseTraceIngestionClient;
}

function assertAnthropicMatrixConfig(config: EvalProviderConfig): AnthropicMatrixConfig {
  if (
    config.provider === 'anthropic' &&
    (config.model === 'claude-sonnet-4-6' || config.model === 'claude-opus-4-7')
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
  traceClient: LangfuseTraceIngestionClient,
): Promise<EvalMatrixRunnerOutput> {
  const result: AnthropicEvalCaseResult = await runAnthropicEvalCase({
    case: input.evalCase,
    runLabel: input.runLabel,
    toolSurface: input.toolSurface,
    providerConfig: assertAnthropicMatrixConfig(input.providerConfig),
    traceClient,
    traceId: input.traceId,
    scoreResult: (runResult) =>
      traceScoresForEvalResult(anthropic, {
        evalCase: input.evalCase,
        answer: runResult.answer,
        toolCalls: runResult.trajectory.toolCalls,
      }),
  });

  return outputFromTrace(result.trace, result.answer, true, input.traceUrl);
}

async function runOpenAiMatrixCase(
  input: EvalMatrixRunnerInput,
  anthropic: Anthropic,
  traceClient: LangfuseTraceIngestionClient,
  client: OpenAiResponsesClient,
  env: NodeJS.ProcessEnv,
): Promise<EvalMatrixRunnerOutput> {
  const result = await runOpenAiResponsesEvalCase({
    client,
    evalCase: input.evalCase,
    providerConfig: input.providerConfig,
    runLabel: input.runLabel,
    toolSurface: input.toolSurface,
    traceClient,
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
  langfuse: LangfuseClient,
  env: NodeJS.ProcessEnv = process.env,
): EvalMatrixRunner {
  const anthropic = new Anthropic();
  const traceClient = traceClientFor(langfuse);
  const openAiClient = createOpenAiResponsesClient(env);

  return async (input) => {
    if (input.providerConfig.provider === 'anthropic') {
      return runAnthropicMatrixCase(input, anthropic, traceClient);
    }

    if (input.providerConfig.provider === 'openai') {
      return runOpenAiMatrixCase(input, anthropic, traceClient, openAiClient, env);
    }

    throw new Error(`Matrix runner does not support provider ${input.providerConfig.provider}.`);
  };
}
