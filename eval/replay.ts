import { redactTracePayload } from './trace.ts';
import type { EvalProvider, EvalProviderModel } from './cli.ts';

export interface LangfuseEvalObservation {
  id: string;
  type: string;
  name: string | null;
  model?: string | null;
  input?: unknown;
  output?: unknown;
  metadata?: unknown;
  usageDetails?: Record<string, number>;
  costDetails?: Record<string, number>;
  statusMessage?: string | null;
  startTime?: string;
  endTime?: string | null;
}

export interface LangfuseEvalScore {
  id?: string;
  traceId?: string;
  name: string;
  dataType?: string;
  value?: number | string;
  stringValue?: string;
  comment?: string | null;
  metadata?: unknown;
}

export interface LangfuseEvalTrace {
  id: string;
  name?: string | null;
  input?: unknown;
  output?: unknown;
  metadata?: unknown;
  observations?: LangfuseEvalObservation[];
  scores?: LangfuseEvalScore[];
  htmlPath?: string;
}

export interface LangfuseEvalTraceReadClient {
  api: {
    trace: {
      get: (traceId: string, request?: { fields?: string }) => Promise<LangfuseEvalTrace>;
    };
  };
  getTraceUrl?: (traceId: string) => Promise<string> | string;
}

export interface EvalReplayTraceSelector {
  traceId?: string;
  runLabel: string;
  caseId: string;
  provider: EvalProvider;
  model: EvalProviderModel;
}

export interface EvalReplayResult {
  trace: LangfuseEvalTrace;
  transcript: string;
  traceUrl: string | undefined;
}

export interface EvalTraceDiff {
  left: TraceSummary;
  right: TraceSummary;
  findings: string[];
}

interface TraceSummary {
  id: string;
  provider: string;
  model: string;
  caseId: string;
  statusReason: string;
  stopReason: string;
  toolNames: string[];
  canonicalRefs: string[];
  finalAnswer: string;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function metadataOf(value: { metadata?: unknown }): Record<string, unknown> {
  return isRecord(value.metadata) ? value.metadata : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function nestedRecord(value: unknown, key: string): Record<string, unknown> | undefined {
  return isRecord(value) && isRecord(value[key]) ? value[key] : undefined;
}

function outputRecord(trace: LangfuseEvalTrace): Record<string, unknown> {
  return isRecord(trace.output) ? trace.output : {};
}

function scoreDisplayValue(score: LangfuseEvalScore): string {
  if (score.stringValue !== undefined) return score.stringValue;
  if (score.value !== undefined) return String(score.value);
  return 'n/a';
}

function compactJson(value: unknown, maxLength = 500): string {
  const redacted = redactTracePayload(value);
  const text =
    typeof redacted === 'string'
      ? redacted
      : (JSON.stringify(redacted, null, 2) ?? String(redacted));
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function candidateTraceId(input: EvalReplayTraceSelector): string {
  return ['eval', input.runLabel, input.provider, input.model, input.caseId]
    .join(':')
    .replace(/[^a-zA-Z0-9:_.-]/g, '-');
}

function legacyOpenAiTraceId(input: EvalReplayTraceSelector): string | undefined {
  if (input.provider !== 'openai') return undefined;
  return ['eval', input.runLabel, input.caseId, input.provider]
    .join(':')
    .replace(/[^a-zA-Z0-9:_.-]/g, '-');
}

export function replayTraceIdCandidates(input: EvalReplayTraceSelector): string[] {
  const candidates = [input.traceId, candidateTraceId(input), legacyOpenAiTraceId(input)].filter(
    (candidate): candidate is string => !!candidate,
  );
  return [...new Set(candidates)];
}

function generation(trace: LangfuseEvalTrace): LangfuseEvalObservation | undefined {
  return (trace.observations ?? []).find(
    (observation) =>
      observation.type.toUpperCase() === 'GENERATION' || observation.name === 'eval.model_call',
  );
}

function toolObservations(trace: LangfuseEvalTrace): LangfuseEvalObservation[] {
  return (trace.observations ?? []).filter((observation) => {
    const metadata = metadataOf(observation);
    return (
      observation.type.toUpperCase() === 'SPAN' &&
      (observation.name?.startsWith('eval.tool_call.') ||
        typeof metadata.toolName === 'string' ||
        observation.name?.includes('tool'))
    );
  });
}

function toolName(observation: LangfuseEvalObservation): string {
  const metadata = metadataOf(observation);
  if (typeof metadata.toolName === 'string') return metadata.toolName;
  return observation.name?.replace(/^eval\.tool_call\./, '') ?? observation.id;
}

function canonicalRefs(observation: LangfuseEvalObservation): string[] {
  const refs = metadataOf(observation).canonicalRefs;
  return Array.isArray(refs) ? refs.filter((ref): ref is string => typeof ref === 'string') : [];
}

function statusReason(trace: LangfuseEvalTrace): string {
  const metadata = metadataOf(trace);
  const genMetadata = generation(trace) ? metadataOf(generation(trace)!) : {};
  return (
    stringValue(metadata.statusReason) ??
    stringValue(genMetadata.statusReason) ??
    stringValue(outputRecord(trace).statusReason) ??
    'unknown'
  );
}

function stopReason(trace: LangfuseEvalTrace): string {
  const gen = generation(trace);
  const genMetadata = gen ? metadataOf(gen) : {};
  return stringValue(genMetadata.stopReason) ?? stringValue(gen?.statusMessage) ?? 'unknown';
}

function finalAnswer(trace: LangfuseEvalTrace): string {
  const output = outputRecord(trace);
  const genOutput =
    nestedRecord(generation(trace)?.output, 'response') ?? generation(trace)?.output;
  return (
    stringValue(output.finalAnswer) ??
    stringValue(nestedRecord(trace.output, 'output')?.finalAnswer) ??
    (isRecord(genOutput) ? stringValue(genOutput.finalAnswer) : undefined) ??
    ''
  );
}

function traceMetaString(trace: LangfuseEvalTrace, key: string, fallback = 'unknown'): string {
  const value = metadataOf(trace)[key];
  return stringValue(value) ?? fallback;
}

function failureClass(trace: LangfuseEvalTrace): string | undefined {
  const score = (trace.scores ?? []).find((candidate) => candidate.name === 'failure_class');
  const value = score ? scoreDisplayValue(score) : undefined;
  if (value && value !== 'none') return value;
  const status = statusReason(trace);
  return status !== 'completed' ? status : undefined;
}

function errorsFor(trace: LangfuseEvalTrace): string[] {
  const errors: string[] = [];
  for (const observation of trace.observations ?? []) {
    const metadataErrors = metadataOf(observation).errors;
    if (!Array.isArray(metadataErrors)) continue;
    for (const error of metadataErrors) {
      if (isRecord(error)) {
        errors.push(
          [stringValue(error.type), stringValue(error.message)].filter(Boolean).join(': '),
        );
      }
    }
  }
  return errors.filter(Boolean);
}

function diagnosisFor(trace: LangfuseEvalTrace): string {
  const status = statusReason(trace);
  const stop = stopReason(trace);
  const errors = errorsFor(trace).join('\n');
  const failedClass = failureClass(trace);
  const tools = toolObservations(trace);
  const refs = tools.flatMap(canonicalRefs);

  if (/schema|api|access|timeout/i.test(`${status}\n${errors}`)) return 'api/schema failure';
  if (/loop|limit|iteration/i.test(stop)) return 'loop cutoff';
  if (tools.some((tool) => metadataOf(tool).ok === false)) return 'tool execution';
  if (tools.length > 0 && refs.length === 0) return 'retrieval';
  if (/quality|answer/i.test(`${status}\n${failedClass ?? ''}`)) return 'answer synthesis';
  if (failedClass) return failedClass;
  return 'completed';
}

function providerTranscriptSummary(
  generationObservation: LangfuseEvalObservation | undefined,
): string[] {
  const transcript = metadataOf(generationObservation ?? {}).providerNativeTranscript;
  if (!isRecord(transcript)) return [];

  if (Array.isArray(transcript.modelCalls)) {
    return transcript.modelCalls.map((call, index) => {
      const callRecord = isRecord(call) ? call : {};
      return `model call ${index + 1}: stop=${stringValue(callRecord.stopReason) ?? 'unknown'} durationMs=${callRecord.durationMs ?? 'unknown'}`;
    });
  }

  if (Array.isArray(transcript.turns)) {
    return transcript.turns.map((turn, index) => {
      const turnRecord = isRecord(turn) ? turn : {};
      const outputItems = Array.isArray(turnRecord.outputItems) ? turnRecord.outputItems.length : 0;
      return `turn ${index + 1}: outputItems=${outputItems}${turnRecord.error ? ' error=true' : ''}`;
    });
  }

  return [];
}

export function renderEvalTraceTranscript(trace: LangfuseEvalTrace): string {
  const gen = generation(trace);
  const metadata = metadataOf(trace);
  const runLabel = stringValue(metadata.runLabel) ?? 'unknown';
  const provider = stringValue(metadata.provider) ?? 'unknown';
  const model = stringValue(metadata.model) ?? stringValue(gen?.model) ?? 'unknown';
  const caseId = stringValue(metadata.caseId) ?? trace.id;
  const scores = trace.scores ?? [];
  const tools = toolObservations(trace);
  const lines = [
    `Eval replay: ${caseId}`,
    `trace: ${trace.id}`,
    `run: ${runLabel}`,
    `provider/model: ${provider} / ${model}`,
    `tool surface: ${stringValue(metadata.toolSurface) ?? 'unknown'}`,
    `status: ${statusReason(trace)}`,
    `stop reason: ${stopReason(trace)}`,
    `failure classification: ${failureClass(trace) ?? 'none'}`,
    `diagnosis: ${diagnosisFor(trace)}`,
    '',
    'Prompt',
    compactJson(trace.input ?? gen?.input ?? {}),
    '',
    'Model call',
    `model: ${stringValue(gen?.model) ?? model}`,
    `usage: ${compactJson(gen?.usageDetails ?? {})}`,
  ];

  const transcriptSummary = providerTranscriptSummary(gen);
  if (transcriptSummary.length > 0) {
    lines.push('provider transcript:', ...transcriptSummary.map((line) => `- ${line}`));
  }

  lines.push('', 'Tool calls');
  if (tools.length === 0) {
    lines.push('- none');
  } else {
    tools.forEach((tool, index) => {
      const metadata = metadataOf(tool);
      const refs = canonicalRefs(tool);
      const ok = metadata.ok === false ? 'failed' : 'ok';
      lines.push(
        `- ${index + 1}. ${toolName(tool)} ${ok}`,
        `  args: ${compactJson(tool.input ?? {})}`,
        `  result: ${compactJson(tool.output ?? {})}`,
        `  canonical refs: ${refs.length > 0 ? refs.join(', ') : 'none'}`,
      );
      const retries = metadata.retries;
      if (Array.isArray(retries) && retries.length > 0) {
        lines.push(`  retries: ${compactJson(retries)}`);
      }
      const errors = metadata.errors;
      if (Array.isArray(errors) && errors.length > 0) {
        lines.push(`  errors: ${compactJson(errors)}`);
      }
    });
  }

  lines.push('', 'Final answer', finalAnswer(trace) || '(empty)', '', 'Judge output');
  if (scores.length === 0) {
    lines.push('- none');
  } else {
    for (const score of scores) {
      const comment = score.comment ? ` (${score.comment})` : '';
      lines.push(`- ${score.name}: ${scoreDisplayValue(score)}${comment}`);
    }
  }

  const traceErrors = errorsFor(trace);
  if (traceErrors.length > 0) {
    lines.push('', 'Errors', ...traceErrors.map((error) => `- ${error}`));
  }

  return lines.join('\n');
}

async function fetchTrace(
  client: LangfuseEvalTraceReadClient,
  selector: EvalReplayTraceSelector,
): Promise<LangfuseEvalTrace> {
  const candidates = replayTraceIdCandidates(selector);
  const errors: string[] = [];
  for (const traceId of candidates) {
    try {
      return await client.api.trace.get(traceId, {
        fields: 'core,io,scores,observations,metrics',
      });
    } catch (error) {
      errors.push(`${traceId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Unable to fetch Langfuse eval trace. Tried: ${errors.join('; ')}`);
}

export async function replayEvalFailure(
  selector: EvalReplayTraceSelector & { client: LangfuseEvalTraceReadClient },
): Promise<EvalReplayResult> {
  const trace = await fetchTrace(selector.client, selector);
  const traceUrl = selector.client.getTraceUrl
    ? await selector.client.getTraceUrl(trace.id)
    : undefined;
  return {
    trace,
    transcript: renderEvalTraceTranscript(trace),
    traceUrl,
  };
}

function traceSummary(trace: LangfuseEvalTrace): TraceSummary {
  const tools = toolObservations(trace);
  return {
    id: trace.id,
    provider: traceMetaString(trace, 'provider'),
    model: traceMetaString(trace, 'model', stringValue(generation(trace)?.model) ?? 'unknown'),
    caseId: traceMetaString(trace, 'caseId', trace.id),
    statusReason: statusReason(trace),
    stopReason: stopReason(trace),
    toolNames: tools.map(toolName),
    canonicalRefs: [...new Set(tools.flatMap(canonicalRefs))],
    finalAnswer: finalAnswer(trace),
    errors: errorsFor(trace),
  };
}

function sameOrderedValues(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function diffEvalTraces(
  leftTrace: LangfuseEvalTrace,
  rightTrace: LangfuseEvalTrace,
): EvalTraceDiff {
  const left = traceSummary(leftTrace);
  const right = traceSummary(rightTrace);
  const findings: string[] = [];

  if (!sameOrderedValues(left.toolNames, right.toolNames)) {
    findings.push(
      `tool choice differs: ${left.provider} used ${left.toolNames.join(' -> ') || 'none'}; ${right.provider} used ${right.toolNames.join(' -> ') || 'none'}`,
    );
  }

  if (left.canonicalRefs.length === 0 || right.canonicalRefs.length === 0) {
    const missing = [
      left.canonicalRefs.length === 0 ? left.provider : undefined,
      right.canonicalRefs.length === 0 ? right.provider : undefined,
    ].filter(Boolean);
    findings.push(`missing retrieval: ${missing.join(', ')} returned no canonical refs`);
  } else if (!sameOrderedValues(left.canonicalRefs, right.canonicalRefs)) {
    findings.push(
      `retrieval differs: ${left.provider} refs ${left.canonicalRefs.join(', ')}; ${right.provider} refs ${right.canonicalRefs.join(', ')}`,
    );
  }

  const loopSide = [
    /loop|limit|iteration/i.test(left.stopReason) ? left.provider : undefined,
    /loop|limit|iteration/i.test(right.stopReason) ? right.provider : undefined,
  ].filter(Boolean);
  if (loopSide.length > 0) findings.push(`loop cutoff: ${loopSide.join(', ')}`);

  const apiSide = [
    /schema|api|access|timeout/i.test(`${left.statusReason}\n${left.errors.join('\n')}`)
      ? left.provider
      : undefined,
    /schema|api|access|timeout/i.test(`${right.statusReason}\n${right.errors.join('\n')}`)
      ? right.provider
      : undefined,
  ].filter(Boolean);
  if (apiSide.length > 0) findings.push(`api/schema failure: ${apiSide.join(', ')}`);

  if (left.finalAnswer.trim() !== right.finalAnswer.trim()) {
    findings.push('final answer differs');
  }

  if (findings.length === 0) findings.push('no material replay differences found');

  return { left, right, findings };
}

export function formatEvalTraceDiff(diff: EvalTraceDiff): string {
  return [
    `Eval trace diff: ${diff.left.caseId}`,
    `left: ${diff.left.provider} / ${diff.left.model} (${diff.left.id})`,
    `right: ${diff.right.provider} / ${diff.right.model} (${diff.right.id})`,
    '',
    'Findings',
    ...diff.findings.map((finding) => `- ${finding}`),
  ].join('\n');
}
