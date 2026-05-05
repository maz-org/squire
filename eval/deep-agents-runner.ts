import { createHash } from 'node:crypto';
import { ChatAnthropic } from '@langchain/anthropic';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { createDeepAgent, StateBackend } from 'deepagents';
import {
  AGENT_SYSTEM_PROMPT,
  AGENT_TOOLS,
  LEGACY_AGENT_SYSTEM_PROMPT,
  LEGACY_AGENT_TOOLS,
  executeToolCall,
  summarizeToolOutput,
  type AgentRunResult,
  type ModelTrajectoryStep,
  type TokenUsage,
  type ToolCallResult,
  type ToolTrajectoryStep,
} from '../src/agent.ts';
import type { EvalProviderConfig, EvalToolSurface } from './cli.ts';
import { DATASET_NAME } from './dataset.ts';
import { ANTHROPIC_TOOL_SCHEMA_VERSION } from './run-metadata.ts';
import {
  writeEvalTrace,
  type EvalTraceInput,
  type EvalTraceScore,
  type EvalTraceToolCall,
  type LangfuseTraceIngestionClient,
} from './trace.ts';

type DeepAgentsAnthropicConfig = EvalProviderConfig & {
  provider: 'anthropic';
  model: 'claude-sonnet-4-6' | 'claude-opus-4-7' | 'claude-haiku-4-5';
};

interface DeepAgentEvalCase {
  id: string;
  category: string;
  question: string;
}

export interface RunDeepAgentsEvalCaseOptions {
  case: DeepAgentEvalCase;
  runLabel: string;
  toolSurface: EvalToolSurface;
  providerConfig: DeepAgentsAnthropicConfig;
  traceClient?: LangfuseTraceIngestionClient;
  traceId?: string;
  judgeScores?: EvalTraceScore[];
  scoreResult?: (result: AgentRunResult) => Promise<EvalTraceScore[] | undefined>;
  now?: () => Date;
}

export interface DeepAgentsEvalCaseResult extends AgentRunResult {
  durationMs: number;
  toolSurface: EvalToolSurface;
  traceId: string;
  trace: EvalTraceInput;
}

type JsonSchemaObject = {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

const AGENT_RUNTIME = 'deep-agents' as const;
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_TOOL_LOOP_LIMIT = 10;

function promptFor(toolSurface: EvalToolSurface): string {
  return toolSurface === 'legacy' ? LEGACY_AGENT_SYSTEM_PROMPT : AGENT_SYSTEM_PROMPT;
}

function toolsFor(toolSurface: EvalToolSurface) {
  return toolSurface === 'legacy' ? LEGACY_AGENT_TOOLS : AGENT_TOOLS;
}

function promptVersionFor(toolSurface: EvalToolSurface): string {
  return toolSurface === 'legacy'
    ? 'deep-agents-legacy-agent-v1'
    : 'deep-agents-redesigned-agent-v1';
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function toolSchemaHashFor(toolSurface: EvalToolSurface): string {
  return createHash('sha256')
    .update(JSON.stringify(toolsFor(toolSurface)))
    .digest('hex');
}

function emptyTokenUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: 0,
  };
}

function addUsage(total: TokenUsage, usage: AIMessage['usage_metadata'] | undefined): void {
  if (!usage) return;
  total.inputTokens += usage.input_tokens ?? 0;
  total.outputTokens += usage.output_tokens ?? 0;
  total.cacheCreationInputTokens += usage.input_token_details?.cache_creation ?? 0;
  total.cacheReadInputTokens += usage.input_token_details?.cache_read ?? 0;
  total.totalTokens += usage.total_tokens ?? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
}

function sourceLabelsFromResult(result: ToolCallResult): string[] {
  return result.sourceBooks ?? [];
}

function langChainToolsForSurface(
  toolSurface: EvalToolSurface,
  toolCalls: ToolTrajectoryStep[],
  now: () => Date,
) {
  return toolsFor(toolSurface).map((definition) =>
    tool(
      async (input: Record<string, unknown>) => {
        const started = now();
        const callId = `deep-agents:${definition.name}:${toolCalls.length}`;
        try {
          const result = await executeToolCall(definition.name, input);
          const ended = now();
          const { summary, canonicalRefs } = summarizeToolOutput(result.content);
          toolCalls.push({
            iteration: 0,
            id: callId,
            name: definition.name,
            input,
            ok: true,
            outputSummary: summary,
            sourceLabels: sourceLabelsFromResult(result),
            canonicalRefs,
            startedAt: started.toISOString(),
            endedAt: ended.toISOString(),
            durationMs: ended.getTime() - started.getTime(),
          });
          return result.content;
        } catch (error) {
          const ended = now();
          const message = error instanceof Error ? error.message : String(error);
          toolCalls.push({
            iteration: 0,
            id: callId,
            name: definition.name,
            input,
            ok: false,
            outputSummary: `Tool error: ${message}`,
            sourceLabels: [],
            canonicalRefs: [],
            error: message,
            startedAt: started.toISOString(),
            endedAt: ended.toISOString(),
            durationMs: ended.getTime() - started.getTime(),
          });
          throw error;
        }
      },
      {
        name: definition.name,
        description: definition.description,
        schema: definition.input_schema as unknown as JsonSchemaObject,
      },
    ),
  );
}

function extractFinalAnswer(messages: unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isAiMessage(message) && message.text.trim()) return message.text.trim();
  }
  return '';
}

function isAiMessage(message: unknown): message is AIMessage {
  return !!message && typeof message === 'object' && (message as { type?: unknown }).type === 'ai';
}

function isToolMessageValue(message: unknown): message is ToolMessage {
  return (
    !!message && typeof message === 'object' && (message as { type?: unknown }).type === 'tool'
  );
}

function aiMessages(messages: unknown[]): AIMessage[] {
  return messages.filter((message): message is AIMessage => isAiMessage(message));
}

function toolMessages(messages: unknown[]): ToolMessage[] {
  return messages.filter((message): message is ToolMessage => isToolMessageValue(message));
}

function modelCallsForMessages(
  messages: AIMessage[],
  fallbackModel: string,
  startedAt: string,
  endedAt: string,
  durationMs: number,
): ModelTrajectoryStep[] {
  return messages.map((message, index) => ({
    iteration: index + 1,
    model:
      typeof message.response_metadata.model_name === 'string'
        ? message.response_metadata.model_name
        : fallbackModel,
    stopReason:
      typeof message.response_metadata.stop_reason === 'string'
        ? (message.response_metadata.stop_reason as ModelTrajectoryStep['stopReason'])
        : null,
    inputTokens: message.usage_metadata?.input_tokens ?? 0,
    outputTokens: message.usage_metadata?.output_tokens ?? 0,
    cacheCreationInputTokens: message.usage_metadata?.input_token_details?.cache_creation ?? 0,
    cacheReadInputTokens: message.usage_metadata?.input_token_details?.cache_read ?? 0,
    content: message.content,
    startedAt,
    endedAt,
    durationMs: index === messages.length - 1 ? durationMs : 0,
  }));
}

function annotateToolIterations(
  toolCalls: ToolTrajectoryStep[],
  modelCalls: ModelTrajectoryStep[],
) {
  const iteration = Math.max(1, modelCalls.length);
  return toolCalls.map((call) => ({ ...call, iteration: call.iteration || iteration }));
}

function builtInToolCallsFromMessages(
  messages: unknown[],
  existingToolNames: Set<string>,
  startedAt: string,
  endedAt: string,
): ToolTrajectoryStep[] {
  const resultsById = new Map(
    toolMessages(messages).map((message) => [message.tool_call_id, message]),
  );
  return aiMessages(messages).flatMap((message, aiIndex) =>
    (message.tool_calls ?? [])
      .filter((call) => !existingToolNames.has(call.name))
      .map((call, callIndex) => {
        const toolResult = call.id ? resultsById.get(call.id) : undefined;
        const ok = toolResult?.status !== 'error';
        const content = toolResult?.text ?? '';
        const { summary, canonicalRefs } = summarizeToolOutput(content);
        return {
          iteration: aiIndex + 1,
          id: call.id ?? `deep-agents-runtime:${aiIndex}:${callIndex}`,
          name: `deep_agents.${call.name}`,
          input: call.args,
          ok,
          outputSummary: summary,
          sourceLabels: ['Deep Agents runtime'],
          canonicalRefs,
          ...(ok ? {} : { error: content || 'Deep Agents runtime tool failed' }),
          startedAt,
          endedAt,
          durationMs: 0,
        };
      }),
  );
}

function traceToolCallsFor(result: AgentRunResult): EvalTraceToolCall[] {
  return result.trajectory.toolCalls.map((call, index) => ({
    id: `${call.id}:span`,
    toolName: call.name,
    toolCallId: call.id,
    providerToolCallId: call.id,
    callIndex: index,
    arguments: call.input,
    result: { outputSummary: call.outputSummary },
    ok: call.ok,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    durationMs: call.durationMs,
    sourceLabels: call.sourceLabels,
    canonicalRefs: call.canonicalRefs,
    errors: call.error
      ? [
          {
            type: call.name.startsWith('deep_agents.') ? 'runtime_tool' : 'tool',
            message: call.error,
          },
        ]
      : [],
    retries: [],
  }));
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

function mergeMetricScores(metricScores: EvalTraceScore[], scores: EvalTraceScore[]) {
  const scoreNames = new Set(scores.map((score) => score.name));
  return [...metricScores.filter((score) => !scoreNames.has(score.name)), ...scores];
}

function classifyStatus(result: AgentRunResult, judgeScores: EvalTraceScore[]): string {
  if (result.trajectory.toolCalls.some((call) => !call.ok)) return 'tool';
  if (judgeScores.some((score) => score.name === 'pass' && score.value === 'fail'))
    return 'quality';
  return 'completed';
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

function modelSettingsFor(config: DeepAgentsAnthropicConfig) {
  return {
    model: config.model,
    maxOutputTokens: config.maxOutputTokens,
    reasoningEffort: config.reasoningEffort,
    timeoutMs: config.timeoutMs,
    toolLoopLimit: config.toolLoopLimit,
    broadSearchSynthesisThreshold: config.broadSearchSynthesisThreshold,
  };
}

function traceIdFor(options: RunDeepAgentsEvalCaseOptions): string {
  if (options.traceId) return options.traceId;
  return [
    'eval',
    options.runLabel,
    AGENT_RUNTIME,
    options.providerConfig.provider,
    options.providerConfig.model,
    options.case.id,
  ]
    .join(':')
    .replace(/[^a-zA-Z0-9:_.-]/g, '-');
}

function failureStatus(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|abort/i.test(message)) return 'timeout';
  if (/tool/i.test(message)) return 'tool';
  return 'api';
}

async function writeFailureTrace(
  options: RunDeepAgentsEvalCaseOptions,
  traceId: string,
  error: unknown,
  startedAt: string,
  endedAt: string,
  durationMs: number,
): Promise<void> {
  if (!options.traceClient) return;
  const statusReason = failureStatus(error);
  const message = error instanceof Error ? error.message : String(error);
  await writeEvalTrace(options.traceClient, {
    traceId,
    generationId: `${traceId}:generation`,
    runLabel: options.runLabel,
    datasetName: DATASET_NAME,
    caseId: options.case.id,
    caseCategory: options.case.category,
    agentRuntime: AGENT_RUNTIME,
    provider: 'anthropic',
    model: options.providerConfig.model,
    resolvedModel: options.providerConfig.model,
    promptVersion: promptVersionFor(options.toolSurface),
    promptHash: sha256(promptFor(options.toolSurface)),
    toolSurface: options.toolSurface,
    toolSchemaVersion: ANTHROPIC_TOOL_SCHEMA_VERSION,
    toolSchemaHash: toolSchemaHashFor(options.toolSurface),
    modelSettings: modelSettingsFor(options.providerConfig),
    inputQuestion: options.case.question,
    finalAnswer: null,
    statusReason,
    stopReason: 'error',
    startedAt,
    endedAt,
    durationMs,
    providerRequest: { question: options.case.question, toolSurface: options.toolSurface },
    providerResponse: null,
    providerNativeTranscript: { agentRuntime: AGENT_RUNTIME, messages: [] },
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

export async function runDeepAgentsEvalCase(
  options: RunDeepAgentsEvalCaseOptions,
): Promise<DeepAgentsEvalCaseResult> {
  const now = options.now ?? (() => new Date());
  const startedAtDate = now();
  const startedAt = startedAtDate.toISOString();
  const traceId = traceIdFor(options);
  const toolCalls: ToolTrajectoryStep[] = [];

  try {
    const model = new ChatAnthropic({
      model: options.providerConfig.model,
      maxTokens: options.providerConfig.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      clientOptions: options.providerConfig.timeoutMs
        ? { timeout: options.providerConfig.timeoutMs }
        : undefined,
    });
    const agent = createDeepAgent({
      model,
      tools: langChainToolsForSurface(options.toolSurface, toolCalls, now),
      systemPrompt: promptFor(options.toolSurface),
      backend: new StateBackend(),
      checkpointer: false,
    });
    const controller = options.providerConfig.timeoutMs ? new AbortController() : undefined;
    const timeout = controller
      ? setTimeout(() => controller.abort(), options.providerConfig.timeoutMs)
      : undefined;
    let state: unknown;
    try {
      state = await agent.invoke(
        { messages: [{ role: 'user', content: options.case.question }] },
        {
          signal: controller?.signal,
          recursionLimit: (options.providerConfig.toolLoopLimit ?? DEFAULT_TOOL_LOOP_LIMIT) * 4 + 4,
        },
      );
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    const endedAtDate = now();
    const endedAt = endedAtDate.toISOString();
    const durationMs = endedAtDate.getTime() - startedAtDate.getTime();
    const messages = Array.isArray((state as { messages?: unknown }).messages)
      ? (state as { messages: unknown[] }).messages
      : [];
    const modelMessages = aiMessages(messages);
    const tokenUsage = emptyTokenUsage();
    for (const message of modelMessages) addUsage(tokenUsage, message.usage_metadata);
    const modelCalls = modelCallsForMessages(
      modelMessages,
      options.providerConfig.model,
      startedAt,
      endedAt,
      durationMs,
    );
    const builtInToolCalls = builtInToolCallsFromMessages(
      messages,
      new Set(toolsFor(options.toolSurface).map((definition) => definition.name)),
      startedAt,
      endedAt,
    );
    const normalizedToolCalls = [
      ...annotateToolIterations(toolCalls, modelCalls),
      ...builtInToolCalls,
    ];
    const answer = extractFinalAnswer(messages);
    const result: AgentRunResult = {
      answer,
      trajectory: {
        toolCalls: normalizedToolCalls,
        modelCalls,
        finalAnswer: answer,
        tokenUsage,
        model: options.providerConfig.model,
        iterations: modelCalls.length,
        stopReason: 'end_turn',
      },
    };
    const resultScores = options.judgeScores ?? (await options.scoreResult?.(result)) ?? [];
    const statusReason = classifyStatus(result, resultScores);
    const judgeScores = mergeMetricScores(scoresForResult(result, statusReason), resultScores);
    const trace: EvalTraceInput = {
      traceId,
      generationId: `${traceId}:generation`,
      runLabel: options.runLabel,
      datasetName: DATASET_NAME,
      caseId: options.case.id,
      caseCategory: options.case.category,
      agentRuntime: AGENT_RUNTIME,
      provider: 'anthropic',
      model: options.providerConfig.model,
      resolvedModel: options.providerConfig.model,
      promptVersion: promptVersionFor(options.toolSurface),
      promptHash: sha256(promptFor(options.toolSurface)),
      toolSurface: options.toolSurface,
      toolSchemaVersion: ANTHROPIC_TOOL_SCHEMA_VERSION,
      toolSchemaHash: toolSchemaHashFor(options.toolSurface),
      modelSettings: modelSettingsFor(options.providerConfig),
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
        agentRuntime: AGENT_RUNTIME,
      },
      providerResponse: {
        finalAnswer: result.answer,
        iterations: result.trajectory.iterations,
      },
      providerNativeTranscript: {
        agentRuntime: AGENT_RUNTIME,
        messages: messages.map((message) =>
          typeof message === 'object' && message && 'toDict' in message
            ? (message as { toDict: () => unknown }).toDict()
            : message,
        ),
      },
      tokenUsage: tokenUsageForTrace(result),
      costEstimate: { totalUsd: 0 },
      errors: result.trajectory.toolCalls
        .filter((call) => call.error)
        .map((call) => ({
          type: call.name.startsWith('deep_agents.') ? 'runtime_tool' : 'tool',
          message: call.error ?? 'Tool execution failed',
          retryable: false,
        })),
      retries: [],
      toolCalls: traceToolCallsFor(result),
      judgeScores,
    };
    if (options.traceClient) await writeEvalTrace(options.traceClient, trace);
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
    await writeFailureTrace(
      options,
      traceId,
      error,
      startedAt,
      endedAt,
      endedAtDate.getTime() - startedAtDate.getTime(),
    );
    throw error;
  }
}
