import { createHash } from 'node:crypto';
import { Client } from 'langsmith';
import { convertToDottedOrderFormat } from 'langsmith/run_trees';
import { resolveSquireEnv } from '../src/squire-env.ts';
import { TRACE_CONTRACT_VERSION } from './trace-contract.ts';
import {
  redactTracePayload,
  type EvalTraceInput,
  type EvalTraceScore,
  type EvalTraceWriter,
} from './trace.ts';

type LangSmithRunType = 'chain' | 'llm' | 'tool';

interface LangSmithRunCreate {
  id: string;
  name: string;
  run_type: LangSmithRunType;
  project_name: string;
  trace_id: string;
  parent_run_id?: string;
  start_time?: string;
  end_time?: string;
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  error?: string;
  extra?: Record<string, unknown>;
  tags?: string[];
  dotted_order?: string;
}

interface LangSmithFeedbackCreate {
  runId: string;
  key: string;
  options: {
    score?: number;
    value?: string;
    comment?: string;
    sourceInfo?: object;
    feedbackSourceType: 'app';
    startTime?: string;
  };
}

export interface LangSmithTraceConfig {
  apiKey: string;
  projectName: string;
  apiUrl?: string;
  workspaceId?: string;
}

export interface LangSmithTraceClient {
  createRun: (run: LangSmithRunCreate) => Promise<unknown>;
  createFeedback: (
    runId: string,
    key: string,
    options: LangSmithFeedbackCreate['options'],
  ) => Promise<unknown>;
  flush?: () => Promise<void>;
  awaitPendingTraceBatches?: () => Promise<void>;
}

export interface LangSmithTracePayload {
  rootRunId: string;
  modelRunId: string;
  runs: LangSmithRunCreate[];
  feedback: LangSmithFeedbackCreate[];
}

export function langSmithTracingEnabled(cliEnabled: boolean, env: NodeJS.ProcessEnv): boolean {
  if (cliEnabled) return true;
  const raw = env.SQUIRE_EVAL_LANGSMITH_TRACING?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function requiredEnv(name: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (trimmed) return trimmed;
  throw new Error(`LangSmith tracing requires ${name}.`);
}

function optionalEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function langSmithTraceConfigFromEnv(env: NodeJS.ProcessEnv): LangSmithTraceConfig {
  return {
    apiKey: requiredEnv('LANGSMITH_API_KEY', env.LANGSMITH_API_KEY),
    projectName: requiredEnv('LANGSMITH_PROJECT', env.LANGSMITH_PROJECT),
    apiUrl: optionalEnv(env.LANGSMITH_ENDPOINT),
    workspaceId: optionalEnv(env.LANGSMITH_WORKSPACE_ID),
  };
}

function deterministicUuid(seed: string): string {
  const bytes = Buffer.from(createHash('sha256').update(seed).digest()).subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function langSmithRootRunIdForTraceId(traceId: string): string {
  return deterministicUuid(`${traceId}:root`);
}

export function langSmithRunUrl(projectUrl: string, traceId: string): string {
  return `${projectUrl.replace(/\/$/, '')}/r/${langSmithRootRunIdForTraceId(traceId)}?poll=true`;
}

function scoreValue(trace: EvalTraceInput, name: string): number | string | undefined {
  return trace.judgeScores.find((score) => score.name === name)?.value;
}

function scoreNumber(trace: EvalTraceInput, name: string): number | undefined {
  const value = scoreValue(trace, name);
  return typeof value === 'number' ? value : undefined;
}

function primaryScore(trace: EvalTraceInput): number | undefined {
  return scoreNumber(trace, 'correctness') ?? scoreNumber(trace, 'trajectory');
}

function failureClass(trace: EvalTraceInput): string {
  const value = scoreValue(trace, 'failure_class');
  if (typeof value === 'string') return value;
  return trace.statusReason === 'completed' ? 'none' : trace.statusReason;
}

function passValue(trace: EvalTraceInput): boolean | undefined {
  const value = scoreValue(trace, 'pass') ?? scoreValue(trace, 'trajectory_pass');
  if (value === 'pass') return true;
  if (value === 'fail') return false;
  return undefined;
}

function traceEnvironment(trace: EvalTraceInput): string {
  return trace.environment?.trim()
    ? resolveSquireEnv({ SQUIRE_ENV: trace.environment })
    : resolveSquireEnv();
}

function commonMetadata(trace: EvalTraceInput): Record<string, unknown> {
  const environment = traceEnvironment(trace);

  return {
    contractVersion: TRACE_CONTRACT_VERSION,
    environment,
    squireTraceId: trace.traceId,
    runLabel: trace.runLabel,
    datasetName: trace.datasetName,
    caseId: trace.caseId,
    caseCategory: trace.caseCategory,
    agentRuntime: trace.agentRuntime,
    provider: trace.provider,
    model: trace.model,
    resolvedModel: trace.resolvedModel,
    promptVersion: trace.promptVersion,
    promptHash: trace.promptHash,
    toolSurface: trace.toolSurface,
    toolSchemaVersion: trace.toolSchemaVersion,
    toolSchemaHash: trace.toolSchemaHash,
    statusReason: trace.statusReason,
    failureClass: failureClass(trace),
    pass: passValue(trace),
    score: primaryScore(trace),
    trajectoryScore: scoreNumber(trace, 'trajectory'),
  };
}

function traceError(trace: EvalTraceInput): string | undefined {
  if (trace.statusReason === 'completed') return undefined;
  return (
    trace.errors.map((error) => `${error.type}: ${error.message}`).join('\n') || trace.statusReason
  );
}

function objectPayload(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function scoreFeedback(rootRunId: string, trace: EvalTraceInput): LangSmithFeedbackCreate[] {
  return trace.judgeScores.map((score) => {
    const redacted = redactTracePayload(score) as EvalTraceScore;
    return {
      runId: rootRunId,
      key: score.name,
      options: {
        ...(typeof redacted.value === 'number'
          ? { score: redacted.value }
          : { value: redacted.value }),
        comment: redacted.comment,
        sourceInfo:
          redacted.metadata && typeof redacted.metadata === 'object'
            ? (redacted.metadata as object)
            : undefined,
        feedbackSourceType: 'app',
        startTime: trace.endedAt ?? trace.startedAt,
      },
    };
  });
}

export function buildLangSmithRuns(
  traceInput: EvalTraceInput,
  config: Pick<LangSmithTraceConfig, 'projectName'>,
): LangSmithTracePayload {
  const trace = redactTracePayload(traceInput);
  const environment = traceEnvironment(trace);
  const rootRunId = langSmithRootRunIdForTraceId(trace.traceId);
  const modelRunId = deterministicUuid(`${trace.traceId}:model`);
  const rootOrder = convertToDottedOrderFormat(Date.parse(trace.startedAt), rootRunId, 1);
  const modelOrder = convertToDottedOrderFormat(Date.parse(trace.startedAt), modelRunId, 2);
  const tags = [
    'eval',
    trace.agentRuntime,
    trace.provider,
    trace.model,
    trace.runLabel,
    `env:${environment}`,
    `case:${trace.caseId}`,
    `category:${trace.caseCategory}`,
    `failure:${failureClass(trace)}`,
    `pass:${passValue(trace) === true ? 'true' : passValue(trace) === false ? 'false' : 'unknown'}`,
  ];
  const rootRun: LangSmithRunCreate = {
    id: rootRunId,
    name: 'eval.case',
    run_type: 'chain',
    project_name: config.projectName,
    trace_id: rootRunId,
    dotted_order: rootOrder.dottedOrder,
    start_time: trace.startedAt,
    end_time: trace.endedAt,
    inputs: { question: trace.inputQuestion },
    outputs: {
      finalAnswer: trace.finalAnswer,
      statusReason: trace.statusReason,
    },
    error: traceError(trace),
    tags,
    extra: {
      metadata: {
        ...commonMetadata(trace),
        squireTrace: trace,
      },
    },
  };
  const modelRun: LangSmithRunCreate = {
    id: modelRunId,
    name: 'eval.model_call',
    run_type: 'llm',
    project_name: config.projectName,
    trace_id: rootRunId,
    parent_run_id: rootRunId,
    dotted_order: `${rootOrder.dottedOrder}.${modelOrder.dottedOrder}`,
    start_time: trace.startedAt,
    end_time: trace.endedAt,
    inputs: { request: trace.providerRequest },
    outputs: {
      finalAnswer: trace.finalAnswer,
      response: trace.providerResponse,
    },
    error: traceError(trace),
    tags,
    extra: {
      metadata: {
        provider: trace.provider,
        resolvedModel: trace.resolvedModel,
        stopReason: trace.stopReason,
        statusReason: trace.statusReason,
        providerNativeTranscript: trace.providerNativeTranscript,
        tokenUsage: trace.tokenUsage,
        costEstimate: trace.costEstimate,
        modelSettings: trace.modelSettings,
        errors: trace.errors,
        retries: trace.retries,
        timings: {
          startedAt: trace.startedAt,
          endedAt: trace.endedAt,
          durationMs: trace.durationMs,
        },
      },
    },
  };
  const toolRuns = trace.toolCalls.map((toolCall) => {
    const runId = deterministicUuid(
      `${trace.traceId}:tool:${toolCall.callIndex}:${toolCall.toolName}`,
    );
    const order = convertToDottedOrderFormat(
      Date.parse(toolCall.startedAt ?? trace.startedAt),
      runId,
      toolCall.callIndex + 3,
    );
    return {
      id: runId,
      name: `eval.tool_call.${toolCall.toolName}`,
      run_type: 'tool' as const,
      project_name: config.projectName,
      trace_id: rootRunId,
      parent_run_id: modelRunId,
      dotted_order: `${rootOrder.dottedOrder}.${modelOrder.dottedOrder}.${order.dottedOrder}`,
      start_time: toolCall.startedAt,
      end_time: toolCall.endedAt,
      inputs: objectPayload(toolCall.arguments),
      outputs: objectPayload(toolCall.result),
      error: toolCall.ok
        ? undefined
        : toolCall.errors?.map((error) => `${error.type}: ${error.message}`).join('\n') ||
          'Tool execution failed',
      tags: [...tags, toolCall.toolName],
      extra: {
        metadata: {
          toolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          providerToolCallId: toolCall.providerToolCallId,
          callIndex: toolCall.callIndex,
          ok: toolCall.ok,
          durationMs: toolCall.durationMs,
          sourceLabels: toolCall.sourceLabels ?? [],
          canonicalRefs: toolCall.canonicalRefs ?? [],
          errors: toolCall.errors ?? [],
          retries: toolCall.retries ?? [],
        },
      },
    };
  });

  return {
    rootRunId,
    modelRunId,
    runs: [rootRun, modelRun, ...toolRuns],
    feedback: scoreFeedback(rootRunId, trace),
  };
}

export function createLangSmithTraceWriter(options: {
  client: LangSmithTraceClient;
  config: LangSmithTraceConfig;
}): EvalTraceWriter {
  return {
    async writeTrace(input) {
      const payload = buildLangSmithRuns(input, options.config);
      for (const run of payload.runs) await options.client.createRun(run);
      for (const feedback of payload.feedback) {
        await options.client.createFeedback(feedback.runId, feedback.key, feedback.options);
      }
      await options.client.flush?.();
      await options.client.awaitPendingTraceBatches?.();
    },
  };
}

export function createLangSmithTraceWriterFromEnv(env: NodeJS.ProcessEnv): EvalTraceWriter {
  const config = langSmithTraceConfigFromEnv(env);
  return createLangSmithTraceWriter({
    config,
    client: new Client({
      apiKey: config.apiKey,
      apiUrl: config.apiUrl,
      workspaceId: config.workspaceId,
    }),
  });
}

export async function langSmithProjectUrlFromEnv(env: NodeJS.ProcessEnv): Promise<string> {
  const config = langSmithTraceConfigFromEnv(env);
  const client = new Client({
    apiKey: config.apiKey,
    apiUrl: config.apiUrl,
    workspaceId: config.workspaceId,
  });
  return client.getProjectUrl({ projectName: config.projectName });
}
