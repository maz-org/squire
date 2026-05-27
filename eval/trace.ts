import { TRACE_CONTRACT_VERSION, TRACE_REDACTION_DENYLIST } from './trace-contract.ts';
import { resolveSquireEnv } from '../src/squire-env.ts';

export const TRACE_REDACTION_PLACEHOLDER = '[REDACTED]' as const;

type JsonPrimitive = string | number | boolean | null;

export interface EvalTraceWriter {
  writeTrace: (input: EvalTraceInput) => Promise<void>;
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
  environment?: string;
  runLabel: string;
  datasetName: string;
  referenceExampleId?: string;
  caseId: string;
  game: string;
  suite: string;
  caseCategory: string;
  sourceAuthority?: string;
  gamePair?: string;
  agentRuntime: string;
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

export function traceEnvironment(input: Pick<EvalTraceInput, 'environment'>): string {
  const environment = input.environment?.trim();
  return environment ? resolveSquireEnv({ SQUIRE_ENV: environment }) : resolveSquireEnv();
}

export function evalTraceContractMetadata(input: EvalTraceInput): Record<string, unknown> {
  return {
    contractVersion: TRACE_CONTRACT_VERSION,
    environment: traceEnvironment(input),
    agentRuntime: input.agentRuntime,
    provider: input.provider,
    model: input.model,
    resolvedModel: input.resolvedModel,
    runLabel: input.runLabel,
    datasetName: input.datasetName,
    caseId: input.caseId,
    game: input.game,
    suite: input.suite,
    caseCategory: input.caseCategory,
    sourceAuthority: input.sourceAuthority,
    gamePair: input.gamePair,
    promptVersion: input.promptVersion,
    promptHash: input.promptHash,
    toolSurface: input.toolSurface,
    toolSchemaVersion: input.toolSchemaVersion,
    toolSchemaHash: input.toolSchemaHash,
    statusReason: input.statusReason,
  };
}

export function withEvalTraceEnvironment(
  writer: EvalTraceWriter,
  env: NodeJS.ProcessEnv = process.env,
): EvalTraceWriter {
  const environment = resolveSquireEnv(env);
  return {
    writeTrace: (input) => {
      const explicitEnvironment = input.environment?.trim();
      return writer.writeTrace({
        ...input,
        environment: explicitEnvironment || environment,
      });
    },
  };
}

export function compositeEvalTraceWriter(writers: EvalTraceWriter[]): EvalTraceWriter {
  return {
    async writeTrace(input) {
      const errors: unknown[] = [];
      for (const writer of writers) {
        try {
          await writer.writeTrace(input);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, 'One or more trace writers failed.');
      }
    },
  };
}
