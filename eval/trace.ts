import { TRACE_CONTRACT_VERSION, TRACE_REDACTION_DENYLIST } from './trace-contract.ts';

export const TRACE_REDACTION_PLACEHOLDER = '[REDACTED]' as const;

type JsonPrimitive = string | number | boolean | null;

type TraceEventType = 'trace-create' | 'generation-create' | 'span-create' | 'score-create';

interface LangfuseEvent<Body extends Record<string, unknown>> {
  type: TraceEventType;
  id: string;
  timestamp: string;
  body: Body;
}

export interface EvalTraceIngestionBatch {
  batch: LangfuseEvent<Record<string, unknown>>[];
  metadata: {
    contractVersion: typeof TRACE_CONTRACT_VERSION;
  };
}

export interface LangfuseTraceIngestionClient {
  api: {
    ingestion: {
      batch: (payload: EvalTraceIngestionBatch) => unknown;
    };
  };
}

export interface EvalTraceScore {
  name: string;
  value: number | string;
  comment?: string;
  metadata?: unknown;
}

export interface EvalTraceError {
  type: string;
  message: string;
  retryable?: boolean;
  metadata?: unknown;
}

export interface EvalTraceRetry {
  operation: string;
  attempt: number;
  reason: string;
  delayMs?: number;
  final: boolean;
  errorType?: string;
  errorMessage?: string;
}

export interface EvalTraceToolCall {
  id?: string;
  toolName: string;
  toolCallId?: string;
  providerToolCallId?: string;
  callIndex: number;
  arguments: unknown;
  result: unknown;
  ok: boolean;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  sourceLabels?: string[];
  canonicalRefs?: string[];
  errors?: EvalTraceError[];
  retries?: EvalTraceRetry[];
}

export interface EvalTraceInput {
  traceId: string;
  generationId?: string;
  runLabel: string;
  datasetName: string;
  caseId: string;
  caseCategory: string;
  provider: 'anthropic' | 'openai';
  model: string;
  resolvedModel: string;
  promptVersion: string;
  promptHash: string;
  toolSurface: string;
  toolSchemaVersion: string;
  toolSchemaHash: string;
  modelSettings: Record<string, JsonPrimitive | undefined>;
  inputQuestion: string;
  finalAnswer: string | null;
  statusReason: string;
  stopReason: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  completionStartedAt?: string;
  providerRequest: unknown;
  providerResponse: unknown;
  providerNativeTranscript: unknown;
  tokenUsage: Record<string, number>;
  costEstimate: Record<string, number>;
  errors: EvalTraceError[];
  retries: EvalTraceRetry[];
  toolCalls: EvalTraceToolCall[];
  judgeScores: EvalTraceScore[];
}

const REDACTED_KEY_NAMES = new Set(
  TRACE_REDACTION_DENYLIST.map((name) => normalizedRedactionKey(name)),
);

const SECRET_STRING_PATTERNS = [
  /\bbearer\s+[a-z0-9._~+/=-]{8,}\b/i,
  /\b(?:sk|pk|ak|api)[-_]?(?:live|test|proj)?[-_][a-z0-9._-]{20,}\b/i,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|session)=["']?[^"'\s;]+/i,
];

function normalizedRedactionKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function shouldRedactKey(key: string): boolean {
  return REDACTED_KEY_NAMES.has(normalizedRedactionKey(key));
}

function shouldRedactString(value: string): boolean {
  return SECRET_STRING_PATTERNS.some((pattern) => pattern.test(value));
}

export function redactTracePayload<T>(payload: T): T {
  return redactValue(payload) as T;
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return shouldRedactString(value) ? TRACE_REDACTION_PLACEHOLDER : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (value && typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();

    const redacted: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (nestedValue === undefined) continue;
      redacted[key] = shouldRedactKey(key) ? TRACE_REDACTION_PLACEHOLDER : redactValue(nestedValue);
    }
    return redacted;
  }

  return value;
}

function requiredTraceMetadata(input: EvalTraceInput): Record<string, unknown> {
  return {
    contractVersion: TRACE_CONTRACT_VERSION,
    provider: input.provider,
    model: input.model,
    resolvedModel: input.resolvedModel,
    runLabel: input.runLabel,
    datasetName: input.datasetName,
    caseId: input.caseId,
    caseCategory: input.caseCategory,
    promptVersion: input.promptVersion,
    promptHash: input.promptHash,
    toolSurface: input.toolSurface,
    toolSchemaVersion: input.toolSchemaVersion,
    toolSchemaHash: input.toolSchemaHash,
    statusReason: input.statusReason,
  };
}

function generationIdFor(input: EvalTraceInput): string {
  return input.generationId ?? `${input.traceId}:generation`;
}

function timestampFor(input: EvalTraceInput): string {
  return input.startedAt;
}

function event(
  type: TraceEventType,
  id: string,
  timestamp: string,
  body: Record<string, unknown>,
): LangfuseEvent<Record<string, unknown>> {
  return { type, id, timestamp, body };
}

export function buildEvalTraceIngestionBatch(input: EvalTraceInput): EvalTraceIngestionBatch {
  const generationId = generationIdFor(input);
  const timestamp = timestampFor(input);
  const traceMetadata = requiredTraceMetadata(input);

  const traceEvent = event('trace-create', `${input.traceId}:trace-create`, timestamp, {
    id: input.traceId,
    timestamp: input.startedAt,
    name: 'eval.case',
    input: redactTracePayload({ question: input.inputQuestion }),
    output: redactTracePayload({
      finalAnswer: input.finalAnswer,
      statusReason: input.statusReason,
    }),
    metadata: redactTracePayload(traceMetadata),
    tags: ['eval', input.provider, input.model, input.runLabel],
  });

  const generationEvent = event(
    'generation-create',
    `${generationId}:generation-create`,
    timestamp,
    {
      id: generationId,
      traceId: input.traceId,
      name: 'eval.model_call',
      startTime: input.startedAt,
      endTime: input.endedAt,
      completionStartTime: input.completionStartedAt,
      model: input.model,
      input: redactTracePayload({ request: input.providerRequest }),
      output: redactTracePayload({
        finalAnswer: input.finalAnswer,
        response: input.providerResponse,
      }),
      modelParameters: redactTracePayload(input.modelSettings),
      usageDetails: redactTracePayload(input.tokenUsage),
      costDetails: redactTracePayload(input.costEstimate),
      metadata: redactTracePayload({
        provider: input.provider,
        resolvedModel: input.resolvedModel,
        stopReason: input.stopReason,
        statusReason: input.statusReason,
        providerNativeTranscript: input.providerNativeTranscript,
        errors: input.errors,
        retries: input.retries,
        timings: {
          startedAt: input.startedAt,
          endedAt: input.endedAt,
          durationMs: input.durationMs,
        },
      }),
    },
  );

  const toolEvents = input.toolCalls.map((toolCall) => {
    const spanId = toolCall.id ?? `${input.traceId}:tool:${toolCall.callIndex}`;
    return event('span-create', `${spanId}:span-create`, toolCall.startedAt ?? timestamp, {
      id: spanId,
      traceId: input.traceId,
      parentObservationId: generationId,
      name: `eval.tool_call.${toolCall.toolName}`,
      startTime: toolCall.startedAt,
      endTime: toolCall.endedAt,
      input: redactTracePayload(toolCall.arguments),
      output: redactTracePayload(toolCall.result),
      metadata: redactTracePayload({
        toolName: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        providerToolCallId: toolCall.providerToolCallId,
        callIndex: toolCall.callIndex,
        ok: toolCall.ok,
        durationMs: toolCall.durationMs,
        startedAt: toolCall.startedAt,
        endedAt: toolCall.endedAt,
        sourceLabels: toolCall.sourceLabels ?? [],
        canonicalRefs: toolCall.canonicalRefs ?? [],
        errors: toolCall.errors ?? [],
        retries: toolCall.retries ?? [],
      }),
    });
  });

  const scoreEvents = input.judgeScores.map((score) =>
    event('score-create', `${input.traceId}:score:${score.name}`, timestamp, {
      id: `${input.traceId}:score:${score.name}`,
      traceId: input.traceId,
      name: score.name,
      value: score.value,
      comment: score.comment,
      metadata: redactTracePayload(score.metadata ?? {}),
    }),
  );

  return {
    batch: [traceEvent, generationEvent, ...toolEvents, ...scoreEvents],
    metadata: {
      contractVersion: TRACE_CONTRACT_VERSION,
    },
  };
}

export async function writeEvalTrace(
  client: LangfuseTraceIngestionClient,
  input: EvalTraceInput,
): Promise<void> {
  await client.api.ingestion.batch(buildEvalTraceIngestionBatch(input));
}
