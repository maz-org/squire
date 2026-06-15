import type { DiagnosticBundle, DiagnosticField } from './diagnostic-bundle.ts';
import { redactTelemetryValue } from './telemetry.ts';

export type LinearBugReportKind = 'app_runtime' | 'answer_quality';

export interface LinearBugReportTemplateInput {
  bundle: DiagnosticBundle;
  kind: LinearBugReportKind;
  observed?: string;
  expected?: string;
  likelyFailingArea?: string;
  firstFilesToInspect?: string[];
  reproSteps?: string[];
  acceptanceCriteria?: string[];
}

const KIND_COPY: Record<LinearBugReportKind, string> = {
  app_runtime: 'App/runtime bug. Start in Sentry, then use LangSmith only for LLM trace context.',
  answer_quality:
    'Answer-quality bug. Start in LangSmith, then use Sentry only if there was an app/runtime error.',
};

function toSafeText(value: unknown): string {
  const redacted = redactTelemetryValue(value);
  if (typeof redacted === 'string') return redacted.trim();
  if (typeof redacted === 'number' || typeof redacted === 'boolean') return String(redacted);
  if (redacted === null) return 'null';
  return JSON.stringify(redacted);
}

function fieldText(field: DiagnosticField<unknown>): string {
  if (field.status === 'unavailable') return `Unavailable: ${field.reason}`;
  const text = toSafeText(field.value);
  return text.length > 0 ? text : 'Unavailable: value was empty after redaction';
}

function optionalText(value: string | undefined, reason: string): string {
  const text = toSafeText(value ?? '').trim();
  return text.length > 0 ? text : `Unavailable: ${reason}`;
}

function bulletList(values: string[] | undefined, reason: string): string {
  const safeValues = (values ?? [])
    .map((value) => toSafeText(value))
    .filter((value) => value.length > 0);
  if (safeValues.length === 0) return `- Unavailable: ${reason}`;
  return safeValues.map((value) => `- ${value}`).join('\n');
}

function renderSentryEvidence(bundle: DiagnosticBundle): string {
  return [
    'Sentry:',
    `- Issue: ${fieldText(bundle.sentry.issueUrl)}`,
    `- Event: ${fieldText(bundle.sentry.eventUrl)}`,
    `- Replay: ${fieldText(bundle.sentry.replayUrl)}`,
    `- Release: ${fieldText(bundle.report.release)}`,
    `- Environment: ${fieldText(bundle.report.environment)}`,
  ].join('\n');
}

function renderLangSmithEvidence(bundle: DiagnosticBundle): string {
  return [
    'LangSmith:',
    `- Trace: ${fieldText(bundle.langsmith.traceUrl)}`,
    `- Thread: ${fieldText(bundle.langsmith.threadId)}`,
    `- Thread URL: ${fieldText(bundle.langsmith.threadUrl)}`,
    `- Run ID: ${fieldText(bundle.langsmith.runId)}`,
  ].join('\n');
}

function renderEvidence(input: LinearBugReportTemplateInput): string {
  const coreEvidence = [
    `Debug lane: ${KIND_COPY[input.kind]}`,
    `Conversation: ${fieldText(input.bundle.conversation.url)}`,
    `Turn: userMessageId=${fieldText(input.bundle.conversation.userMessageId)}, assistantMessageId=${fieldText(
      input.bundle.conversation.assistantMessageId,
    )}`,
    `Request: ${fieldText(input.bundle.request.requestId)}`,
  ].join('\n');
  const orderedToolEvidence =
    input.kind === 'answer_quality'
      ? [renderLangSmithEvidence(input.bundle), renderSentryEvidence(input.bundle)]
      : [renderSentryEvidence(input.bundle), renderLangSmithEvidence(input.bundle)];

  return ['## Evidence', '', coreEvidence, '', ...orderedToolEvidence].join('\n\n');
}

export function createLinearBugReportBody(input: LinearBugReportTemplateInput): string {
  return [
    renderEvidence(input),
    '## Observed Behavior',
    '',
    optionalText(input.observed, 'observed behavior was not provided'),
    '',
    '## Expected Behavior',
    '',
    optionalText(input.expected, 'expected behavior was not provided'),
    '',
    '## Why This Is Likely Failing',
    '',
    optionalText(input.likelyFailingArea, 'likely failing area was not provided'),
    '',
    '## First Files To Inspect',
    '',
    bulletList(input.firstFilesToInspect, 'first files to inspect were not provided'),
    '',
    '## Repro Steps',
    '',
    bulletList(input.reproSteps, 'repro steps were not provided'),
    '',
    '## Acceptance Criteria',
    '',
    bulletList(input.acceptanceCriteria, 'acceptance criteria were not provided'),
  ].join('\n');
}
