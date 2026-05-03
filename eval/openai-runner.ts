import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  AGENT_SYSTEM_PROMPT,
  LEGACY_AGENT_SYSTEM_PROMPT,
  type ToolCallResult,
} from '../src/agent.ts';
import type { ToolTrajectoryStep, TokenUsage } from '../src/agent.ts';
import type { EvalProviderConfig, EvalToolSurface } from './cli.ts';
import { DATASET_NAME } from './dataset.ts';
import {
  OPENAI_TOOL_SCHEMA_VERSION,
  executeOpenAiToolCall,
  getOpenAiToolSchemaHash,
  openAiToolsForSurface,
  renderOpenAiStrictToolSchemas,
  type OpenAiStrictFunctionTool,
} from './openai-schema.ts';
import type { EvalCase } from './schema.ts';
import {
  type EvalTraceError,
  type EvalTraceInput,
  type EvalTraceScore,
  type EvalTraceToolCall,
  type LangfuseTraceIngestionClient,
} from './trace.ts';
import { TRACE_CONTRACT_VERSION } from './trace-contract.ts';
import { writeEvalTrace } from './trace.ts';

export type OpenAiEvalFailureClass =
  | 'none'
  | 'model_access'
  | 'api_status'
  | 'schema'
  | 'tool_execution'
  | 'timeout'
  | 'answer_quality'
  | 'loop_limit';

type OpenAiResponseInputItem = Record<string, unknown>;
type OpenAiResponseOutputItem = Record<string, unknown>;

export interface OpenAiResponsesCreateRequest {
  model: string;
  instructions: string;
  input: OpenAiResponseInputItem[];
  tools: OpenAiStrictFunctionTool[];
  store: false;
  parallel_tool_calls: false;
  include: string[];
  max_output_tokens?: number;
  reasoning?: { effort: string };
  metadata?: Record<string, string>;
}

export interface OpenAiResponsesResponse {
  id?: string;
  model?: string;
  status?: string;
  output?: OpenAiResponseOutputItem[];
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { message?: string; code?: string; type?: string };
  incomplete_details?: { reason?: string };
}

export interface OpenAiResponsesClient {
  responses: {
    create: (
      request: OpenAiResponsesCreateRequest,
      options?: { signal?: AbortSignal },
    ) => Promise<OpenAiResponsesResponse>;
  };
}

interface OpenAiTranscriptTurn {
  iteration: number;
  request: OpenAiResponsesCreateRequest;
  response: OpenAiResponsesResponse | null;
  outputItems: OpenAiResponseOutputItem[];
  functionCallOutputs: OpenAiResponseInputItem[];
  error?: EvalTraceError;
}

const FORCE_SYNTHESIS_PROMPT =
  'Use the retrieved rulebook context to answer now. Do not search again unless the existing tool results are empty or clearly unrelated.';

const DEFAULT_RULE_SEARCH_SYNTHESIS_THRESHOLD = 3;

const TOOL_BUDGET_SYNTHESIS_PROMPT =
  'The eval tool budget has been reached. Use the retrieved tool results to answer now. Do not call more tools.';

export interface OpenAiResponsesEvalResult {
  ok: boolean;
  answer: string;
  failureClass: OpenAiEvalFailureClass;
  failureMessage?: string;
  trajectory: {
    toolCalls: ToolTrajectoryStep[];
    finalAnswer: string;
    tokenUsage: TokenUsage;
    model: string;
    iterations: number;
    stopReason: string | null;
  };
  trace: EvalTraceInput;
}

export interface OpenAiResponsesScorableResult {
  ok: boolean;
  answer: string;
  failureClass: OpenAiEvalFailureClass;
  failureMessage?: string;
  trajectory: OpenAiResponsesEvalResult['trajectory'];
}

export interface RunOpenAiResponsesEvalCaseOptions {
  client?: OpenAiResponsesClient;
  evalCase: EvalCase;
  providerConfig: EvalProviderConfig;
  runLabel: string;
  toolSurface: EvalToolSurface;
  traceClient?: LangfuseTraceIngestionClient;
  traceId?: string;
  judgeScores?: EvalTraceScore[];
  scoreResult?: (result: OpenAiResponsesScorableResult) => Promise<EvalTraceScore[] | undefined>;
  executeTool?: (name: string, input: Record<string, unknown>) => Promise<ToolCallResult>;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
}

export class OpenAiEvalRunnerError extends Error {
  failureClass: Exclude<OpenAiEvalFailureClass, 'none'>;
  status: number | undefined;

  constructor(
    failureClass: Exclude<OpenAiEvalFailureClass, 'none'>,
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = 'OpenAiEvalRunnerError';
    this.failureClass = failureClass;
    this.status = status;
  }
}

export function classifyOpenAiResponsesFailure(
  error: unknown,
): Exclude<OpenAiEvalFailureClass, 'none'> {
  if (error instanceof OpenAiEvalRunnerError) return error.failureClass;

  const candidate = error as { name?: unknown; status?: unknown; message?: unknown };
  if (candidate?.name === 'AbortError') return 'timeout';

  const message = typeof candidate?.message === 'string' ? candidate.message : '';
  if (/timeout|timed out|aborted/i.test(message)) return 'timeout';

  if (candidate && typeof candidate.status === 'number') {
    if (candidate.status === 401 || candidate.status === 403 || candidate.status === 404) {
      return 'model_access';
    }
    return 'api_status';
  }

  return 'api_status';
}

export function createOpenAiResponsesClient(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): OpenAiResponsesClient {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new OpenAiEvalRunnerError('model_access', 'OPENAI_API_KEY is required for OpenAI evals.');
  }

  return {
    responses: {
      create: async (request, options) => {
        const response = await fetchImpl('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(request),
          signal: options?.signal,
        });
        const text = await response.text();
        const parsed = parseOpenAiResponseBody(text, response.status);
        if (!response.ok) {
          const message =
            parsed.error?.message ?? `OpenAI Responses API returned ${response.status}.`;
          throw new OpenAiEvalRunnerError(
            classifyStatus(response.status),
            message,
            response.status,
          );
        }
        return parsed;
      },
    },
  };
}

function parseOpenAiResponseBody(text: string, status: number): OpenAiResponsesResponse {
  if (!text) return {};
  try {
    return JSON.parse(text) as OpenAiResponsesResponse;
  } catch {
    throw new OpenAiEvalRunnerError(
      'api_status',
      `OpenAI Responses API returned non-JSON body with status ${status}.`,
      status,
    );
  }
}

function classifyStatus(status: number): Exclude<OpenAiEvalFailureClass, 'none'> {
  return status === 401 || status === 403 || status === 404 ? 'model_access' : 'api_status';
}

function promptFor(toolSurface: EvalToolSurface): string {
  return toolSurface === 'legacy' ? LEGACY_AGENT_SYSTEM_PROMPT : AGENT_SYSTEM_PROMPT;
}

function promptVersionFor(toolSurface: EvalToolSurface): string {
  return toolSurface === 'legacy' ? 'legacy-agent-v1' : 'redesigned-agent-v1';
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function modelSettingsFor(config: EvalProviderConfig): Record<string, string | number | undefined> {
  return {
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    maxOutputTokens: config.maxOutputTokens,
    timeoutMs: config.timeoutMs,
    toolLoopLimit: config.toolLoopLimit,
    broadSearchSynthesisThreshold: broadSearchSynthesisThresholdFor(config),
  };
}

function broadSearchSynthesisThresholdFor(config: EvalProviderConfig): number {
  return config.broadSearchSynthesisThreshold ?? DEFAULT_RULE_SEARCH_SYNTHESIS_THRESHOLD;
}

function trajectoryToolBudget(evalCase: EvalCase): number | undefined {
  const budget = evalCase.trajectory?.maxToolCalls;
  return typeof budget === 'number' && Number.isInteger(budget) && budget > 0 ? budget : undefined;
}

function createResponsesRequest(
  input: OpenAiResponseInputItem[],
  evalCase: EvalCase,
  providerConfig: EvalProviderConfig,
  toolSurface: EvalToolSurface,
  allowTools: boolean,
): OpenAiResponsesCreateRequest {
  const request: OpenAiResponsesCreateRequest = {
    model: providerConfig.model,
    instructions: promptFor(toolSurface),
    input: [...input],
    tools: allowTools ? renderOpenAiStrictToolSchemas(openAiToolsForSurface(toolSurface)) : [],
    store: false,
    parallel_tool_calls: false,
    include: ['reasoning.encrypted_content'],
    metadata: {
      dataset: DATASET_NAME,
      caseId: evalCase.id,
    },
  };
  if (providerConfig.maxOutputTokens) request.max_output_tokens = providerConfig.maxOutputTokens;
  if (providerConfig.reasoningEffort)
    request.reasoning = { effort: providerConfig.reasoningEffort };
  return request;
}

function isBroadRuleSearchTool(toolName: string, input: Record<string, unknown>): boolean {
  if (toolName === 'search_rules') return true;
  if (toolName !== 'search_knowledge') return false;

  const scope = input.scope;
  if (!Array.isArray(scope) || scope.length === 0) return false;
  return scope.every((kind) => kind === 'rules_passage');
}

function isNonRuleSearchTool(toolName: string, input: Record<string, unknown>): boolean {
  if (toolName === 'inspect_sources' || toolName === 'schema' || toolName === 'resolve_entity') {
    return false;
  }
  if (toolName === 'open_entity' && typeof input.ref === 'string') {
    return !input.ref.startsWith('rules:');
  }
  return !isBroadRuleSearchTool(toolName, input);
}

function functionCallItems(response: OpenAiResponsesResponse): Array<{
  id?: string;
  call_id: string;
  name: string;
  arguments: string;
}> {
  return (response.output ?? []).filter(
    (
      item,
    ): item is {
      id?: string;
      call_id: string;
      name: string;
      arguments: string;
    } => {
      return (
        item.type === 'function_call' &&
        typeof item.call_id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.arguments === 'string'
      );
    },
  );
}

function parseFunctionArguments(item: {
  name: string;
  arguments: string;
}): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = item.arguments ? JSON.parse(item.arguments) : {};
  } catch (error) {
    throw new OpenAiEvalRunnerError(
      'schema',
      `Invalid JSON arguments for ${item.name}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new OpenAiEvalRunnerError(
      'schema',
      `Invalid arguments for ${item.name}: expected a JSON object.`,
    );
  }
  return parsed as Record<string, unknown>;
}

function extractFinalAnswer(response: OpenAiResponsesResponse): string {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const texts: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const content of item.content as Array<Record<string, unknown>>) {
      if (
        (content.type === 'output_text' || content.type === 'text') &&
        typeof content.text === 'string' &&
        content.text.trim()
      ) {
        texts.push(content.text.trim());
      }
    }
  }
  return texts.join('\n\n');
}

function addUsage(
  total: {
    input: number;
    output: number;
    reasoning: number;
    cached: number;
    total: number;
  },
  response: OpenAiResponsesResponse,
): void {
  const usage = response.usage;
  if (!usage) return;
  total.input += usage.input_tokens ?? 0;
  total.output += usage.output_tokens ?? 0;
  total.reasoning += usage.output_tokens_details?.reasoning_tokens ?? 0;
  total.cached += usage.input_tokens_details?.cached_tokens ?? 0;
  total.total += usage.total_tokens ?? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
}

function tokenUsageForAgent(total: { input: number; output: number; total: number }): TokenUsage {
  return {
    inputTokens: total.input,
    outputTokens: total.output,
    totalTokens: total.total,
  };
}

function collectCanonicalRefs(value: unknown, refs = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return refs;
  if (Array.isArray(value)) {
    for (const item of value) collectCanonicalRefs(item, refs);
    return refs;
  }

  for (const [key, nested] of Object.entries(value)) {
    if ((key === 'ref' || key === 'sourceId') && typeof nested === 'string') {
      refs.add(nested);
    } else {
      collectCanonicalRefs(nested, refs);
    }
  }
  return refs;
}

function summarizeToolOutput(content: string): { summary: string; canonicalRefs: string[] } {
  try {
    const parsed = JSON.parse(content) as unknown;
    const canonicalRefs = [...collectCanonicalRefs(parsed)];
    if (Array.isArray(parsed)) {
      return {
        summary: `json array (${parsed.length} item${parsed.length === 1 ? '' : 's'})`,
        canonicalRefs,
      };
    }
    if (parsed && typeof parsed === 'object') {
      return {
        summary: `json object (${Object.keys(parsed).slice(0, 8).join(', ') || 'no keys'})`,
        canonicalRefs,
      };
    }
    return { summary: `json ${typeof parsed}`, canonicalRefs };
  } catch {
    return {
      summary: content.length > 240 ? `${content.slice(0, 237)}...` : content,
      canonicalRefs: [],
    };
  }
}

function errorTrace(
  type: Exclude<OpenAiEvalFailureClass, 'none'>,
  message: string,
): EvalTraceError {
  return { type, message, retryable: type === 'timeout' || type === 'api_status' };
}

function durationMsBetween(startIso: string, endIso: string): number {
  return Math.max(0, new Date(endIso).getTime() - new Date(startIso).getTime());
}

async function createResponseWithTimeout(
  client: OpenAiResponsesClient,
  request: OpenAiResponsesCreateRequest,
  timeoutMs: number | undefined,
): Promise<OpenAiResponsesResponse> {
  if (!timeoutMs) return client.responses.create(request);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await client.responses.create(request, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function runOpenAiResponsesEvalCase(
  options: RunOpenAiResponsesEvalCaseOptions,
): Promise<OpenAiResponsesEvalResult> {
  const client = options.client ?? createOpenAiResponsesClient(options.env);
  const executeTool = options.executeTool ?? executeOpenAiToolCall;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const input: OpenAiResponseInputItem[] = [
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: options.evalCase.question }],
    },
  ];
  const requests: OpenAiResponsesCreateRequest[] = [];
  const responses: OpenAiResponsesResponse[] = [];
  const transcriptTurns: OpenAiTranscriptTurn[] = [];
  const toolCalls: ToolTrajectoryStep[] = [];
  const traceToolCalls: EvalTraceToolCall[] = [];
  const errors: EvalTraceError[] = [];
  const tokenUsage = { input: 0, output: 0, reasoning: 0, cached: 0, total: 0 };
  let resolvedModel: string = options.providerConfig.model;
  let iterations = 0;
  let broadRuleSearches = 0;
  let hasUsedNonRuleSearchTool = false;
  let forceSynthesis = false;
  const broadSearchSynthesisThreshold = broadSearchSynthesisThresholdFor(options.providerConfig);
  const maxTrajectoryToolCalls = trajectoryToolBudget(options.evalCase);
  const toolLoopLimit = options.providerConfig.toolLoopLimit ?? 10;
  let allowForcedSynthesisTurn = false;

  const buildTrace = (
    statusReason: string,
    stopReason: string,
    finalAnswer: string | null,
    resultScores: EvalTraceScore[] | undefined,
  ): EvalTraceInput => {
    const endedAt = now().toISOString();
    const scores = resultScores ?? options.judgeScores ?? [];
    const metricScoreNames = new Set(scores.map((score) => score.name));
    return {
      traceId: options.traceId ?? `eval:${options.runLabel}:${options.evalCase.id}:openai`,
      runLabel: options.runLabel,
      datasetName: DATASET_NAME,
      caseId: options.evalCase.id,
      caseCategory: options.evalCase.category,
      provider: 'openai',
      model: options.providerConfig.model,
      resolvedModel,
      promptVersion: promptVersionFor(options.toolSurface),
      promptHash: sha256(promptFor(options.toolSurface)),
      toolSurface: options.toolSurface,
      toolSchemaVersion: OPENAI_TOOL_SCHEMA_VERSION,
      toolSchemaHash: getOpenAiToolSchemaHash(openAiToolsForSurface(options.toolSurface)),
      modelSettings: modelSettingsFor(options.providerConfig),
      inputQuestion: options.evalCase.question,
      finalAnswer,
      statusReason,
      stopReason,
      startedAt,
      endedAt,
      durationMs: durationMsBetween(startedAt, endedAt),
      providerRequest: requests,
      providerResponse: responses,
      providerNativeTranscript: {
        contractVersion: TRACE_CONTRACT_VERSION,
        mode: 'stateless-responses',
        usesPreviousResponseId: false,
        turns: transcriptTurns,
      },
      tokenUsage,
      costEstimate: {
        promptUsd: 0,
        completionUsd: 0,
        reasoningUsd: 0,
        totalUsd: 0,
      },
      errors,
      retries: [],
      toolCalls: traceToolCalls,
      judgeScores: [
        ...[
          { name: 'failure_class', value: statusReason === 'completed' ? 'none' : statusReason },
          { name: 'tool_call_count', value: toolCalls.length },
          { name: 'retry_count', value: 0 },
          { name: 'loop_iterations', value: iterations },
          { name: 'model_latency_ms', value: durationMsBetween(startedAt, endedAt) },
          { name: 'model_cost_usd', value: 0 },
        ].filter((score) => !metricScoreNames.has(score.name)),
        ...scores,
      ],
    };
  };

  const finish = async (
    ok: boolean,
    answer: string,
    failureClass: OpenAiEvalFailureClass,
    stopReason: string,
    failureMessage?: string,
  ): Promise<OpenAiResponsesEvalResult> => {
    const trajectory = {
      toolCalls,
      finalAnswer: answer,
      tokenUsage: tokenUsageForAgent(tokenUsage),
      model: resolvedModel,
      iterations,
      stopReason,
    };
    const resultScores =
      options.judgeScores ??
      (ok
        ? await options.scoreResult?.({
            ok,
            answer,
            failureClass,
            failureMessage,
            trajectory,
          })
        : undefined);
    const trace = buildTrace(
      ok ? 'completed' : failureClass,
      stopReason,
      ok ? answer : null,
      resultScores,
    );
    if (options.traceClient) await writeEvalTrace(options.traceClient, trace);
    return {
      ok,
      answer,
      failureClass,
      failureMessage,
      trajectory,
      trace,
    };
  };

  for (let i = 0; i < toolLoopLimit + (allowForcedSynthesisTurn ? 1 : 0); i++) {
    iterations = i + 1;
    const request = createResponsesRequest(
      input,
      options.evalCase,
      options.providerConfig,
      options.toolSurface,
      !forceSynthesis,
    );
    requests.push(request);
    const turn: OpenAiTranscriptTurn = {
      iteration: iterations,
      request,
      response: null,
      outputItems: [],
      functionCallOutputs: [],
    };
    transcriptTurns.push(turn);

    let response: OpenAiResponsesResponse;
    try {
      response = await createResponseWithTimeout(client, request, options.providerConfig.timeoutMs);
    } catch (error) {
      const failureClass = classifyOpenAiResponsesFailure(error);
      const message = error instanceof Error ? error.message : String(error);
      const traceError = errorTrace(failureClass, message);
      errors.push(traceError);
      turn.error = traceError;
      return finish(false, '', failureClass, failureClass, message);
    }

    responses.push(response);
    turn.response = response;
    turn.outputItems = response.output ?? [];
    input.push(...turn.outputItems);
    if (response.model) resolvedModel = response.model;
    addUsage(tokenUsage, response);

    if (response.status === 'failed' || response.status === 'cancelled') {
      const message =
        response.error?.message ??
        response.incomplete_details?.reason ??
        `OpenAI response ${response.status}`;
      const traceError = errorTrace('api_status', message);
      errors.push(traceError);
      turn.error = traceError;
      return finish(false, '', 'api_status', response.status, message);
    }

    const calls = functionCallItems(response);
    if (calls.length === 0) {
      const answer = extractFinalAnswer(response);
      if (!answer) {
        const message = 'OpenAI response completed with an empty final answer.';
        errors.push(errorTrace('answer_quality', message));
        return finish(false, '', 'answer_quality', 'empty_final_answer', message);
      }
      return finish(true, answer, 'none', response.status ?? 'completed');
    }

    for (const call of calls) {
      let parsedArguments: Record<string, unknown>;
      try {
        parsedArguments = parseFunctionArguments(call);
      } catch (error) {
        const failureClass = classifyOpenAiResponsesFailure(error);
        const message = error instanceof Error ? error.message : String(error);
        const traceError = errorTrace(failureClass, message);
        errors.push(traceError);
        turn.error = traceError;
        return finish(false, '', failureClass, failureClass, message);
      }

      if (isBroadRuleSearchTool(call.name, parsedArguments)) {
        broadRuleSearches += 1;
      } else if (isNonRuleSearchTool(call.name, parsedArguments)) {
        hasUsedNonRuleSearchTool = true;
      }

      const toolStartedAt = now().toISOString();
      let toolResult: ToolCallResult;
      let toolOk = true;
      let toolError: EvalTraceError | undefined;
      try {
        toolResult = await executeTool(call.name, parsedArguments);
      } catch (error) {
        toolOk = false;
        const message = error instanceof Error ? error.message : String(error);
        toolError = errorTrace('tool_execution', message);
        toolResult = { content: `Tool error: ${message}` };
      }
      const toolEndedAt = now().toISOString();
      const toolDurationMs = durationMsBetween(toolStartedAt, toolEndedAt);
      const summary = summarizeToolOutput(toolResult.content);

      toolCalls.push({
        iteration: iterations,
        id: call.id ?? call.call_id,
        name: call.name,
        input: parsedArguments,
        ok: toolOk,
        outputSummary: summary.summary,
        sourceLabels: toolResult.sourceBooks ?? [],
        canonicalRefs: summary.canonicalRefs,
        ...(toolError ? { error: toolError.message } : {}),
        startedAt: toolStartedAt,
        endedAt: toolEndedAt,
        durationMs: toolDurationMs,
      });
      traceToolCalls.push({
        id: `eval:${options.runLabel}:${options.evalCase.id}:tool:${traceToolCalls.length}`,
        toolName: call.name,
        toolCallId: call.id,
        providerToolCallId: call.call_id,
        callIndex: traceToolCalls.length,
        arguments: parsedArguments,
        result: toolResult.content,
        ok: toolOk,
        startedAt: toolStartedAt,
        endedAt: toolEndedAt,
        durationMs: toolDurationMs,
        sourceLabels: toolResult.sourceBooks ?? [],
        canonicalRefs: summary.canonicalRefs,
        errors: toolError ? [toolError] : [],
        retries: [],
      });

      if (toolError) {
        errors.push(toolError);
        turn.error = toolError;
        return finish(false, '', 'tool_execution', 'tool_execution', toolError.message);
      }

      const outputItem = {
        type: 'function_call_output',
        call_id: call.call_id,
        output: toolResult.content,
      };
      turn.functionCallOutputs.push(outputItem);
      input.push(outputItem);
    }

    if (broadRuleSearches >= broadSearchSynthesisThreshold && !hasUsedNonRuleSearchTool) {
      forceSynthesis = true;
      allowForcedSynthesisTurn = true;
      input.push({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: FORCE_SYNTHESIS_PROMPT }],
      });
    } else if (maxTrajectoryToolCalls && toolCalls.length >= maxTrajectoryToolCalls) {
      forceSynthesis = true;
      allowForcedSynthesisTurn = true;
      input.push({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: TOOL_BUDGET_SYNTHESIS_PROMPT }],
      });
    }
  }

  const message = `OpenAI Responses loop reached ${toolLoopLimit} iteration(s) without a final answer.`;
  errors.push(errorTrace('loop_limit', message));
  return finish(false, '', 'loop_limit', 'loop_limit', message);
}

export async function runOpenAiLocalReport(
  cases: EvalCase[],
  runLabel: string,
  providerConfig: EvalProviderConfig,
  toolSurface: EvalToolSurface,
  outputPath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const client = createOpenAiResponsesClient(env);
  const results = [];
  for (const evalCase of cases) {
    process.stdout.write(`  ${evalCase.id}... `);
    const result = await runOpenAiResponsesEvalCase({
      client,
      evalCase,
      providerConfig,
      runLabel,
      toolSurface,
      env,
    });
    console.log(result.ok ? '\u2713' : '\u2717');
    results.push({
      id: evalCase.id,
      category: evalCase.category,
      question: evalCase.question,
      answer: result.answer,
      ok: result.ok,
      failureClass: result.failureClass,
      failureMessage: result.failureMessage,
      trajectory: result.trajectory,
      trace: result.trace,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    runLabel,
    provider: 'openai',
    model: providerConfig.model,
    datasetName: DATASET_NAME,
    results,
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nWrote OpenAI eval report: ${outputPath}`);
}
