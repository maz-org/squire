import type { DiagnosticBundle, DiagnosticField } from './diagnostic-bundle.ts';
import { redactTelemetryValue } from './telemetry.ts';

export type LinearBugReportKind = 'app_runtime' | 'answer_quality';

export interface LinearBugReportTemplateInput {
  bundle: DiagnosticBundle;
  kind: LinearBugReportKind;
  reportTypeLabel?: string;
  observed?: string;
  expected?: string;
  likelyFailingArea?: string;
  firstFilesToInspect?: string[];
  reproSteps?: string[];
  acceptanceCriteria?: string[];
}

const DEFAULT_REPORT_TYPE: Record<LinearBugReportKind, string> = {
  app_runtime: 'App/runtime bug',
  answer_quality: 'Answer-quality bug',
};

const DIAGNOSTIC_STARTING_POINT: Record<LinearBugReportKind, string> = {
  app_runtime:
    'Start in Sentry for app errors, logs, traces, or replay. Use LangSmith only if the failure involves answer generation.',
  answer_quality:
    'Start in LangSmith for the answer trace. Use Sentry only if the app also reported an error, failed stream, replay, or log event.',
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
    `- Event ID: ${fieldText(bundle.sentry.eventId)}`,
    `- Replay: ${fieldText(bundle.sentry.replayUrl)}`,
    `- Trace: ${fieldText(bundle.sentry.traceUrl)}`,
    `- Logs: ${fieldText(bundle.sentry.logsUrl)}`,
    `- Trace ID: ${fieldText(bundle.sentry.traceId)}`,
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
    `- Run URL: ${fieldText(bundle.langsmith.runUrl)}`,
  ].join('\n');
}

function reportTypeLabel(input: LinearBugReportTemplateInput): string {
  const text = toSafeText(input.reportTypeLabel ?? '').trim();
  return text.length > 0 ? text : DEFAULT_REPORT_TYPE[input.kind];
}

function renderDiagnosticEvidence(input: LinearBugReportTemplateInput): string {
  const coreEvidence = [
    `Conversation: ${fieldText(input.bundle.conversation.url)}`,
    `Turn: userMessageId=${fieldText(input.bundle.conversation.userMessageId)}, assistantMessageId=${fieldText(
      input.bundle.conversation.assistantMessageId,
    )}`,
    `Request: ${fieldText(input.bundle.request.requestId)}`,
    `Suggested diagnostic starting point: ${DIAGNOSTIC_STARTING_POINT[input.kind]}`,
  ].join('\n');
  const orderedToolEvidence =
    input.kind === 'answer_quality'
      ? [renderLangSmithEvidence(input.bundle), renderSentryEvidence(input.bundle)]
      : [renderSentryEvidence(input.bundle), renderLangSmithEvidence(input.bundle)];

  return ['## Diagnostic Evidence', '', coreEvidence, '', ...orderedToolEvidence].join('\n\n');
}

export function createLinearBugReportBody(input: LinearBugReportTemplateInput): string {
  return [
    '## User Report',
    '',
    `Type: ${reportTypeLabel(input)}`,
    '',
    'Observed:',
    optionalText(input.observed, 'observed behavior was not provided'),
    '',
    'Expected:',
    optionalText(input.expected, 'expected behavior was not provided'),
    '',
    '## Triage Notes',
    '',
    'Likely failing area:',
    optionalText(input.likelyFailingArea, 'likely failing area was not provided'),
    '',
    'First files to inspect:',
    bulletList(input.firstFilesToInspect, 'first files to inspect were not provided'),
    '',
    '## Repro Steps',
    '',
    bulletList(input.reproSteps, 'repro steps were not provided'),
    '',
    '## Acceptance Criteria',
    '',
    bulletList(input.acceptanceCriteria, 'acceptance criteria were not provided'),
    '',
    renderDiagnosticEvidence(input),
  ].join('\n');
}
