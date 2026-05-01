import { createHash } from 'node:crypto';
import {
  AGENT_SYSTEM_PROMPT,
  AGENT_TOOLS,
  LEGACY_AGENT_SYSTEM_PROMPT,
  LEGACY_AGENT_TOOLS,
  runAgentLoopWithEvalConfig,
  type AgentRunResult,
  type AnthropicEvalModel,
} from '../src/agent.ts';
import type { EvalProviderConfig, EvalToolSurface } from './cli.ts';
import { DATASET_NAME } from './dataset.ts';
import {
  writeEvalTrace,
  type EvalTraceScore,
  type EvalTraceToolCall,
  type LangfuseTraceIngestionClient,
} from './trace.ts';

export const ANTHROPIC_TOOL_SCHEMA_VERSION = 'squire-anthropic-tools-v1' as const;

export type AnthropicEvalFailureClass = 'access' | 'api' | 'timeout' | 'tool' | 'quality';

interface AnthropicEvalCase {
  id: string;
  category: string;
  source?: string;
  question: string;
}

export interface AnthropicEvalCaseResult extends AgentRunResult {
  durationMs: number;
  toolSurface: EvalToolSurface;
  traceId: string;
}

export interface RunAnthropicEvalCaseOptions {
  case: AnthropicEvalCase;
  runLabel: string;
  toolSurface: EvalToolSurface;
  providerConfig: EvalProviderConfig & {
    provider: 'anthropic';
    model: AnthropicEvalModel;
  };
  traceClient?: LangfuseTraceIngestionClient;
  traceId?: string;
  judgeScores?: EvalTraceScore[];
  scoreResult?: (result: AgentRunResult) => Promise<EvalTraceScore[] | undefined>;
  now?: () => Date;
}

interface StatusClassificationInput {
  toolCalls: Array<{ ok: boolean; error?: string }>;
  judgeScores: Array<{ name: string; value: number | string }>;
}

export function classifyAnthropicEvalFailure(error: unknown): AnthropicEvalFailureClass {
  const status =
    typeof error === 'object' && error && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  if (status === 401 || status === 403) return 'access';

  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|abort/i.test(message)) return 'timeout';
  if (/tool/i.test(message)) return 'tool';
  return 'api';
}

export function classifyAnthropicEvalStatus(input: StatusClassificationInput): string {
  if (input.toolCalls.some((call) => !call.ok)) return 'tool';
  if (input.judgeScores.some((score) => score.name === 'pass' && score.value === 'fail')) {
    return 'quality';
  }
  return 'completed';
}

function promptVersionFor(toolSurface: EvalToolSurface): string {
  return toolSurface === 'legacy' ? 'legacy-agent-v1' : 'redesigned-agent-v1';
}

function promptHashFor(toolSurface: EvalToolSurface): string {
  const prompt = toolSurface === 'legacy' ? LEGACY_AGENT_SYSTEM_PROMPT : AGENT_SYSTEM_PROMPT;
  return `sha256:${createHash('sha256').update(prompt).digest('hex')}`;
}

function toolSchemaHashFor(toolSurface: EvalToolSurface): string {
  const tools = toolSurface === 'legacy' ? LEGACY_AGENT_TOOLS : AGENT_TOOLS;
  return createHash('sha256').update(JSON.stringify(tools)).digest('hex');
}

function traceIdFor(options: RunAnthropicEvalCaseOptions): string {
  if (options.traceId) return options.traceId;
  return [
    'eval',
    options.runLabel,
    options.providerConfig.provider,
    options.providerConfig.model,
    options.case.id,
  ]
    .join(':')
    .replace(/[^a-zA-Z0-9:_.-]/g, '-');
}

function scoresForResult(result: AgentRunResult, statusReason: string): EvalTraceScore[] {
  return [
    { name: 'failure_class', value: statusReason === 'completed' ? 'none' : statusReason },
    { name: 'tool_call_count', value: result.trajectory.toolCalls.length },
    { name: 'retry_count', value: 0 },
    { name: 'loop_iterations', value: result.trajectory.iterations },
    { name: 'model_latency_ms', value: totalModelLatencyMs(result) },
    { name: 'model_cost_usd', value: 0 },
  ];
}

function totalModelLatencyMs(result: AgentRunResult): number {
  return result.trajectory.modelCalls.reduce((sum, call) => sum + call.durationMs, 0);
}

function toolCallsForTrace(result: AgentRunResult): EvalTraceToolCall[] {
  return result.trajectory.toolCalls.map((call, index) => ({
    id: `${call.id}:span`,
    toolName: call.name,
    toolCallId: call.id,
    providerToolCallId: call.id,
    callIndex: index,
    arguments: call.input,
    result: {
      outputSummary: call.outputSummary,
    },
    ok: call.ok,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    durationMs: call.durationMs,
    sourceLabels: call.sourceLabels,
    canonicalRefs: call.canonicalRefs,
    errors: call.error
      ? [
          {
            type: 'tool',
            message: call.error,
            retryable: false,
          },
        ]
      : [],
    retries: [],
  }));
}

function tokenUsageForTrace(result: AgentRunResult): Record<string, number> {
  return {
    input: result.trajectory.tokenUsage.inputTokens,
    output: result.trajectory.tokenUsage.outputTokens,
    total: result.trajectory.tokenUsage.totalTokens,
  };
}

async function writeSuccessTrace(
  options: RunAnthropicEvalCaseOptions,
  traceId: string,
  result: AgentRunResult,
  startedAt: string,
  endedAt: string,
  durationMs: number,
  resultScores: EvalTraceScore[] | undefined,
): Promise<void> {
  if (!options.traceClient) return;

  const scores = resultScores ?? options.judgeScores ?? [];
  const statusReason = classifyAnthropicEvalStatus({
    toolCalls: result.trajectory.toolCalls,
    judgeScores: scores,
  });
  const judgeScores = scores.length > 0 ? scores : scoresForResult(result, statusReason);

  await writeEvalTrace(options.traceClient, {
    traceId,
    generationId: `${traceId}:generation`,
    runLabel: options.runLabel,
    datasetName: DATASET_NAME,
    caseId: options.case.id,
    caseCategory: options.case.category,
    provider: 'anthropic',
    model: options.providerConfig.model,
    resolvedModel: result.trajectory.model,
    promptVersion: promptVersionFor(options.toolSurface),
    promptHash: promptHashFor(options.toolSurface),
    toolSurface: options.toolSurface,
    toolSchemaVersion: ANTHROPIC_TOOL_SCHEMA_VERSION,
    toolSchemaHash: toolSchemaHashFor(options.toolSurface),
    modelSettings: {
      model: options.providerConfig.model,
      maxOutputTokens: options.providerConfig.maxOutputTokens,
      reasoningEffort: options.providerConfig.reasoningEffort,
      timeoutMs: options.providerConfig.timeoutMs,
      toolLoopLimit: options.providerConfig.toolLoopLimit,
    },
    inputQuestion: options.case.question,
    finalAnswer: result.answer,
    statusReason,
    stopReason: result.trajectory.stopReason ?? 'unknown',
    startedAt,
    endedAt,
    durationMs,
    providerRequest: {
      question: options.case.question,
      toolSurface: options.toolSurface,
      model: options.providerConfig.model,
    },
    providerResponse: {
      finalAnswer: result.answer,
      stopReason: result.trajectory.stopReason,
      iterations: result.trajectory.iterations,
    },
    providerNativeTranscript: {
      modelCalls: result.trajectory.modelCalls,
    },
    tokenUsage: tokenUsageForTrace(result),
    costEstimate: {
      totalUsd: 0,
    },
    errors: result.trajectory.toolCalls
      .filter((call) => call.error)
      .map((call) => ({
        type: 'tool',
        message: call.error ?? 'Tool execution failed',
        retryable: false,
      })),
    retries: [],
    toolCalls: toolCallsForTrace(result),
    judgeScores,
  });
}

async function writeFailureTrace(
  options: RunAnthropicEvalCaseOptions,
  traceId: string,
  error: unknown,
  startedAt: string,
  endedAt: string,
  durationMs: number,
): Promise<void> {
  if (!options.traceClient) return;

  const statusReason = classifyAnthropicEvalFailure(error);
  const message = error instanceof Error ? error.message : String(error);

  await writeEvalTrace(options.traceClient, {
    traceId,
    generationId: `${traceId}:generation`,
    runLabel: options.runLabel,
    datasetName: DATASET_NAME,
    caseId: options.case.id,
    caseCategory: options.case.category,
    provider: 'anthropic',
    model: options.providerConfig.model,
    resolvedModel: options.providerConfig.model,
    promptVersion: promptVersionFor(options.toolSurface),
    promptHash: promptHashFor(options.toolSurface),
    toolSurface: options.toolSurface,
    toolSchemaVersion: ANTHROPIC_TOOL_SCHEMA_VERSION,
    toolSchemaHash: toolSchemaHashFor(options.toolSurface),
    modelSettings: {
      model: options.providerConfig.model,
      maxOutputTokens: options.providerConfig.maxOutputTokens,
      reasoningEffort: options.providerConfig.reasoningEffort,
      timeoutMs: options.providerConfig.timeoutMs,
      toolLoopLimit: options.providerConfig.toolLoopLimit,
    },
    inputQuestion: options.case.question,
    finalAnswer: null,
    statusReason,
    stopReason: 'error',
    startedAt,
    endedAt,
    durationMs,
    providerRequest: {
      question: options.case.question,
      toolSurface: options.toolSurface,
      model: options.providerConfig.model,
    },
    providerResponse: null,
    providerNativeTranscript: {
      modelCalls: [],
    },
    tokenUsage: { input: 0, output: 0, total: 0 },
    costEstimate: { totalUsd: 0 },
    errors: [{ type: statusReason, message, retryable: statusReason === 'timeout' }],
    retries: [],
    toolCalls: [],
    judgeScores: [{ name: 'failure_class', value: statusReason }],
  });
}

export async function runAnthropicEvalCase(
  options: RunAnthropicEvalCaseOptions,
): Promise<AnthropicEvalCaseResult> {
  const now = options.now ?? (() => new Date());
  const startedAtDate = now();
  const startedAt = startedAtDate.toISOString();
  const traceId = traceIdFor(options);

  try {
    const result = await runAgentLoopWithEvalConfig(options.case.question, {
      toolSurface: options.toolSurface,
      anthropicModel: options.providerConfig.model,
      maxOutputTokens: options.providerConfig.maxOutputTokens,
      timeoutMs: options.providerConfig.timeoutMs,
      toolLoopLimit: options.providerConfig.toolLoopLimit,
    });
    const endedAtDate = now();
    const endedAt = endedAtDate.toISOString();
    const durationMs = endedAtDate.getTime() - startedAtDate.getTime();
    const resultScores = options.judgeScores ?? (await options.scoreResult?.(result));

    await writeSuccessTrace(options, traceId, result, startedAt, endedAt, durationMs, resultScores);

    return {
      ...result,
      durationMs,
      toolSurface: options.toolSurface,
      traceId,
    };
  } catch (error) {
    const endedAtDate = now();
    const endedAt = endedAtDate.toISOString();
    const durationMs = endedAtDate.getTime() - startedAtDate.getTime();
    await writeFailureTrace(options, traceId, error, startedAt, endedAt, durationMs);
    throw error;
  }
}
