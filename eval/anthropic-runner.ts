import { createHash } from 'node:crypto';
import {
  AGENT_SYSTEM_PROMPT,
  AGENT_TOOLS,
  LEGACY_AGENT_SYSTEM_PROMPT,
  LEGACY_AGENT_TOOLS,
  type AgentRunResult,
  type AnthropicEvalModel,
} from '../src/agent.ts';
import { runLangGraphAgentLoopWithEvalConfig } from '../src/agent-langgraph.ts';
import { ensureCampaignFixture } from './campaign-fixture.ts';
import type { EvalAgentRuntime, EvalProviderConfig, EvalToolSurface } from './cli.ts';
import { gamePairForCase, langSmithDatasetNameForCase, sourceAuthorityForCase } from './dataset.ts';
import { assertRuleSourceRetrievalReady } from './retrieval-preflight.ts';
import { ANTHROPIC_TOOL_SCHEMA_VERSION } from './run-metadata.ts';
import type { EvalCase } from './schema.ts';
import {
  type EvalTraceWriter,
  type EvalTraceScore,
  type EvalTraceInput,
  type EvalTraceToolCall,
} from './trace.ts';

export type AnthropicEvalFailureClass = 'access' | 'api' | 'timeout' | 'tool' | 'quality';

type AnthropicEvalCase = EvalCase;

export interface AnthropicEvalCaseResult extends AgentRunResult {
  durationMs: number;
  toolSurface: EvalToolSurface;
  traceId: string;
  trace: EvalTraceInput;
}

export interface RunAnthropicEvalCaseOptions {
  case: AnthropicEvalCase;
  runLabel: string;
  toolSurface: EvalToolSurface;
  agentRuntime?: EvalAgentRuntime;
  providerConfig: EvalProviderConfig & {
    provider: 'anthropic';
    model: AnthropicEvalModel;
  };
  traceWriter?: EvalTraceWriter;
  traceId?: string;
  judgeScores?: EvalTraceScore[];
  scoreResult?: (result: AgentRunResult) => Promise<EvalTraceScore[] | undefined>;
  now?: () => Date;
}

async function writeTrace(options: RunAnthropicEvalCaseOptions, trace: EvalTraceInput) {
  if (options.traceWriter) await options.traceWriter.writeTrace(trace);
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
  if (
    input.judgeScores.some(
      (score) =>
        (score.name === 'pass' || score.name === 'trajectory_pass') && score.value === 'fail',
    )
  ) {
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
    options.agentRuntime ?? 'claude-sdk',
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

function mergeMetricScores(
  metricScores: EvalTraceScore[],
  judgeScores: EvalTraceScore[],
): EvalTraceScore[] {
  const judgeScoreNames = new Set(judgeScores.map((score) => score.name));
  return [
    ...metricScores.filter((metricScore) => !judgeScoreNames.has(metricScore.name)),
    ...judgeScores,
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
    cached: result.trajectory.tokenUsage.cacheReadInputTokens,
    cacheCreationInput: result.trajectory.tokenUsage.cacheCreationInputTokens,
    cacheReadInput: result.trajectory.tokenUsage.cacheReadInputTokens,
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
): Promise<EvalTraceInput> {
  const scores = resultScores ?? options.judgeScores ?? [];
  const statusReason = classifyAnthropicEvalStatus({
    toolCalls: result.trajectory.toolCalls,
    judgeScores: scores,
  });
  const judgeScores = mergeMetricScores(scoresForResult(result, statusReason), scores);

  const trace: EvalTraceInput = {
    traceId,
    generationId: `${traceId}:generation`,
    runLabel: options.runLabel,
    datasetName: langSmithDatasetNameForCase(options.case),
    referenceExampleId: options.case.langsmithExampleId,
    caseId: options.case.id,
    game: options.case.game,
    suite: options.case.suite,
    caseCategory: options.case.caseCategory,
    sourceAuthority: sourceAuthorityForCase(options.case),
    gamePair: gamePairForCase(options.case),
    agentRuntime: options.agentRuntime ?? 'claude-sdk',
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
      broadSearchSynthesisThreshold: options.providerConfig.broadSearchSynthesisThreshold,
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
  };

  await writeTrace(options, trace);
  return trace;
}

async function writeFailureTrace(
  options: RunAnthropicEvalCaseOptions,
  traceId: string,
  error: unknown,
  startedAt: string,
  endedAt: string,
  durationMs: number,
): Promise<void> {
  if (!options.traceWriter) return;

  const statusReason = classifyAnthropicEvalFailure(error);
  const message = error instanceof Error ? error.message : String(error);

  await writeTrace(options, {
    traceId,
    generationId: `${traceId}:generation`,
    runLabel: options.runLabel,
    datasetName: langSmithDatasetNameForCase(options.case),
    referenceExampleId: options.case.langsmithExampleId,
    caseId: options.case.id,
    game: options.case.game,
    suite: options.case.suite,
    caseCategory: options.case.caseCategory,
    sourceAuthority: sourceAuthorityForCase(options.case),
    gamePair: gamePairForCase(options.case),
    agentRuntime: options.agentRuntime ?? 'claude-sdk',
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
      broadSearchSynthesisThreshold: options.providerConfig.broadSearchSynthesisThreshold,
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
    tokenUsage: {
      input: 0,
      output: 0,
      cached: 0,
      cacheCreationInput: 0,
      cacheReadInput: 0,
      total: 0,
    },
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
    await assertRuleSourceRetrievalReady(options.case);
    // Campaign-bound cases seed their fixture and run with the owner's
    // identity, mirroring a real personalized request (SQR-272).
    const fixture = options.case.campaignFixture
      ? await ensureCampaignFixture(options.case.campaignFixture)
      : undefined;
    const result = await runLangGraphAgentLoopWithEvalConfig(options.case.question, {
      ...(fixture
        ? {
            userId: fixture.userId,
            // Onboarding fixtures supply no campaign: the run starts from
            // zero and the interview creates one.
            ...(fixture.campaignId ? { campaignId: fixture.campaignId } : {}),
            ...(fixture.activeCharacterId ? { activeCharacterId: fixture.activeCharacterId } : {}),
          }
        : {}),
      toolSurface: options.toolSurface,
      anthropicModel: options.providerConfig.model,
      maxOutputTokens: options.providerConfig.maxOutputTokens,
      timeoutMs: options.providerConfig.timeoutMs,
      toolLoopLimit: options.providerConfig.toolLoopLimit,
      broadSearchSynthesisThreshold: options.providerConfig.broadSearchSynthesisThreshold,
      game: options.case.game,
      requestId: traceId,
      evalCaseId: options.case.id,
      evalSuite: options.case.suite,
      evalCaseCategory: options.case.caseCategory,
    });
    const endedAtDate = now();
    const endedAt = endedAtDate.toISOString();
    const durationMs = endedAtDate.getTime() - startedAtDate.getTime();
    const resultScores = options.judgeScores ?? (await options.scoreResult?.(result));

    const trace = await writeSuccessTrace(
      options,
      traceId,
      result,
      startedAt,
      endedAt,
      durationMs,
      resultScores,
    );

    return {
      ...result,
      durationMs,
      toolSurface: options.toolSurface,
      traceId,
      trace,
    };
  } catch (error) {
    const endedAtDate = now();
    const endedAt = endedAtDate.toISOString();
    const durationMs = endedAtDate.getTime() - startedAtDate.getTime();
    await writeFailureTrace(options, traceId, error, startedAt, endedAt, durationMs);
    throw error;
  }
}
