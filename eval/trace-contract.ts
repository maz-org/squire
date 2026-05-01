export const TRACE_CONTRACT_VERSION = 'sqr-125.trace-contract.v1' as const;

export type LangfuseTarget =
  | 'trace.metadata'
  | 'trace.input'
  | 'trace.output'
  | 'generation'
  | 'generation.input'
  | 'generation.output'
  | 'generation.metadata'
  | 'generation.modelParameters'
  | 'generation.usageDetails'
  | 'generation.costDetails'
  | 'span'
  | 'span.input'
  | 'span.output'
  | 'span.metadata'
  | 'score'
  | 'optional_export';

export type TraceDebugCategory =
  | 'filter'
  | 'provider'
  | 'prompt'
  | 'tooling'
  | 'transcript'
  | 'result'
  | 'failure'
  | 'timing'
  | 'usage'
  | 'cost'
  | 'redaction'
  | 'report';

interface TraceFieldShape<Name extends string = string> {
  name: Name;
  required: boolean;
  langfuseTarget: LangfuseTarget;
  debugCategory: TraceDebugCategory;
  includeInAppConversationHistory: boolean;
  description: string;
}

const TRACE_FIELD_DEFINITIONS = [
  {
    name: 'contractVersion',
    required: true,
    langfuseTarget: 'trace.metadata',
    debugCategory: 'filter',
    includeInAppConversationHistory: false,
    description: 'Trace contract version used to reject incompatible run comparisons.',
  },
  {
    name: 'provider',
    required: true,
    langfuseTarget: 'trace.metadata',
    debugCategory: 'filter',
    includeInAppConversationHistory: false,
    description: 'Provider key, such as anthropic or openai.',
  },
  {
    name: 'model',
    required: true,
    langfuseTarget: 'trace.metadata',
    debugCategory: 'filter',
    includeInAppConversationHistory: false,
    description: 'Requested model ID or alias from eval config.',
  },
  {
    name: 'resolvedModel',
    required: true,
    langfuseTarget: 'trace.metadata',
    debugCategory: 'filter',
    includeInAppConversationHistory: false,
    description: 'Provider-returned concrete model ID when available.',
  },
  {
    name: 'runLabel',
    required: true,
    langfuseTarget: 'trace.metadata',
    debugCategory: 'filter',
    includeInAppConversationHistory: false,
    description: 'Human run label from eval CLI/config.',
  },
  {
    name: 'datasetName',
    required: true,
    langfuseTarget: 'trace.metadata',
    debugCategory: 'filter',
    includeInAppConversationHistory: false,
    description: 'Langfuse dataset name used for the case.',
  },
  {
    name: 'caseId',
    required: true,
    langfuseTarget: 'trace.metadata',
    debugCategory: 'filter',
    includeInAppConversationHistory: false,
    description: 'Eval case identifier from eval/dataset.json.',
  },
  {
    name: 'caseCategory',
    required: true,
    langfuseTarget: 'trace.metadata',
    debugCategory: 'filter',
    includeInAppConversationHistory: false,
    description: 'Eval case category for grouped reports.',
  },
  {
    name: 'promptVersion',
    required: true,
    langfuseTarget: 'trace.metadata',
    debugCategory: 'prompt',
    includeInAppConversationHistory: false,
    description: 'Stable prompt contract name or semantic version.',
  },
  {
    name: 'promptHash',
    required: true,
    langfuseTarget: 'trace.metadata',
    debugCategory: 'prompt',
    includeInAppConversationHistory: false,
    description: 'Hash of the effective system prompt and prompt wrapper.',
  },
  {
    name: 'toolSurface',
    required: true,
    langfuseTarget: 'trace.metadata',
    debugCategory: 'tooling',
    includeInAppConversationHistory: false,
    description: 'Squire tool surface selected for the eval run.',
  },
  {
    name: 'toolSchemaVersion',
    required: true,
    langfuseTarget: 'trace.metadata',
    debugCategory: 'tooling',
    includeInAppConversationHistory: false,
    description: 'Stable Squire tool schema version used for compatibility checks.',
  },
  {
    name: 'toolSchemaHash',
    required: true,
    langfuseTarget: 'trace.metadata',
    debugCategory: 'tooling',
    includeInAppConversationHistory: false,
    description: 'Hash of provider-rendered tool definitions.',
  },
  {
    name: 'modelSettings',
    required: true,
    langfuseTarget: 'generation.modelParameters',
    debugCategory: 'provider',
    includeInAppConversationHistory: false,
    description: 'Temperature, max output, reasoning effort, timeout, and loop limits.',
  },
  {
    name: 'inputQuestion',
    required: true,
    langfuseTarget: 'trace.input',
    debugCategory: 'report',
    includeInAppConversationHistory: false,
    description: 'Eval question text sent to the runner after redaction.',
  },
  {
    name: 'providerNativeTranscript',
    required: true,
    langfuseTarget: 'generation.metadata',
    debugCategory: 'transcript',
    includeInAppConversationHistory: false,
    description:
      'Redacted provider-native messages, response items, tool-call items, and continuation items.',
  },
  {
    name: 'toolCalls',
    required: true,
    langfuseTarget: 'span',
    debugCategory: 'tooling',
    includeInAppConversationHistory: false,
    description: 'One child span per Squire tool call with call index, name, timing, and status.',
  },
  {
    name: 'toolArguments',
    required: true,
    langfuseTarget: 'span.input',
    debugCategory: 'tooling',
    includeInAppConversationHistory: false,
    description: 'Redacted provider-emitted tool arguments for each tool span.',
  },
  {
    name: 'toolResults',
    required: true,
    langfuseTarget: 'span.output',
    debugCategory: 'tooling',
    includeInAppConversationHistory: false,
    description: 'Redacted Squire tool results or summarized oversized results for each tool span.',
  },
  {
    name: 'errors',
    required: true,
    langfuseTarget: 'span.metadata',
    debugCategory: 'failure',
    includeInAppConversationHistory: false,
    description: 'Provider, schema, timeout, tool, judge, trace-write, and unknown errors.',
  },
  {
    name: 'retries',
    required: true,
    langfuseTarget: 'span.metadata',
    debugCategory: 'failure',
    includeInAppConversationHistory: false,
    description: 'Retry attempts, retry reason, delay, and final status for retryable operations.',
  },
  {
    name: 'timings',
    required: true,
    langfuseTarget: 'span.metadata',
    debugCategory: 'timing',
    includeInAppConversationHistory: false,
    description:
      'Start/end timestamps and duration for run, model calls, tools, judge, and trace write.',
  },
  {
    name: 'tokenUsage',
    required: true,
    langfuseTarget: 'generation.usageDetails',
    debugCategory: 'usage',
    includeInAppConversationHistory: false,
    description: 'Input, output, reasoning, cached, and total token counts when available.',
  },
  {
    name: 'costEstimate',
    required: true,
    langfuseTarget: 'generation.costDetails',
    debugCategory: 'cost',
    includeInAppConversationHistory: false,
    description: 'Estimated prompt, completion, reasoning, and total cost in USD.',
  },
  {
    name: 'stopReason',
    required: true,
    langfuseTarget: 'generation.metadata',
    debugCategory: 'result',
    includeInAppConversationHistory: false,
    description:
      'Provider stop reason such as end_turn, tool_use, stop, length, or content_filter.',
  },
  {
    name: 'statusReason',
    required: true,
    langfuseTarget: 'trace.metadata',
    debugCategory: 'failure',
    includeInAppConversationHistory: false,
    description: 'Normalized status or failure class for filtering failed runs.',
  },
  {
    name: 'finalAnswer',
    required: true,
    langfuseTarget: 'generation.output',
    debugCategory: 'result',
    includeInAppConversationHistory: false,
    description: 'Final assistant answer used by eval scoring after redaction.',
  },
  {
    name: 'judgeScores',
    required: true,
    langfuseTarget: 'score',
    debugCategory: 'report',
    includeInAppConversationHistory: false,
    description: 'Correctness, pass/fail, trajectory, and other evaluator scores.',
  },
  {
    name: 'summaryExport',
    required: false,
    langfuseTarget: 'optional_export',
    debugCategory: 'report',
    includeInAppConversationHistory: false,
    description: 'Local convenience export derived from Langfuse data, not the source of truth.',
  },
] as const satisfies readonly TraceFieldShape[];

export type TraceFieldName = (typeof TRACE_FIELD_DEFINITIONS)[number]['name'];
export type TraceField = TraceFieldShape<TraceFieldName>;

function assertUniqueTraceFieldNames(fields: readonly TraceFieldShape[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { name } of fields) {
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
  }
  if (duplicates.size > 0) {
    throw new Error(`Duplicate trace field name(s): ${[...duplicates].join(', ')}`);
  }
}

assertUniqueTraceFieldNames(TRACE_FIELD_DEFINITIONS);

export const TRACE_FIELDS: ReadonlyArray<Readonly<TraceField>> = Object.freeze(
  TRACE_FIELD_DEFINITIONS.map((field) => Object.freeze(field)),
);

export const TRACE_REDACTION_DENYLIST = [
  'apiKey',
  'authorization',
  'bearer',
  'cookie',
  'setCookie',
  'session',
  'sessionId',
  'csrf',
  'oauth',
  'accessToken',
  'refreshToken',
  'userId',
  'userEmail',
  'campaignId',
  'characterId',
  'playerId',
] as const;
