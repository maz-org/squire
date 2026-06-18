import { z } from 'zod';

import type { DiagnosticBundle, DiagnosticField } from './diagnostic-bundle.ts';
import {
  createLinearBugReportBody,
  type LinearBugReportKind,
} from './linear-bug-report-template.ts';
import {
  createLinearClient,
  type LinearIssueRef,
  type SquireLinearClient,
} from './linear-client.ts';
import { redactTelemetryValue } from './telemetry.ts';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export const InChatBugReportKindSchema = z.enum([
  'bad_answer',
  'broken_stream',
  'visual_issue',
  'wrong_source',
  'other',
]);

export type InChatBugReportKind = z.infer<typeof InChatBugReportKindSchema>;

export interface LinearBugReportDraftInput {
  bundle: DiagnosticBundle;
  kind: InChatBugReportKind;
  observed?: string;
  expected?: string;
  likelyFailingArea?: string;
  firstFilesToInspect?: string[];
  reproSteps?: string[];
  acceptanceCriteria?: string[];
}

export interface LinearBugReportDraft {
  title: string;
  description: string;
  diagnosticCommentBody: string;
  marker: string;
  priority: number;
  labelName: string;
  templateKind: LinearBugReportKind;
}

export type SubmitLinearBugReportResult =
  | { status: 'disabled'; reason: string; marker: string }
  | { status: 'existing'; issue: LinearIssueRef; marker: string; warnings?: string[] }
  | { status: 'created'; issue: LinearIssueRef; marker: string; warnings?: string[] };

export interface SubmitLinearBugReportInput extends LinearBugReportDraftInput {
  attachments?: LinearBugReportAttachment[];
  linearApiKey?: string;
  linearTeamKey?: string;
  linearProjectName?: string;
  linearStateName?: string;
  fetch?: FetchLike;
  linearClient?: SquireLinearClient;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

export interface LinearBugReportAttachment {
  filename: string;
  contentType: 'image/jpeg' | 'image/png';
  base64Content: string;
  title?: string;
  subtitle?: string;
}

const DEFAULT_LINEAR_TEAM_KEY = 'SQR';
const DEFAULT_LINEAR_PROJECT_NAME = 'Squire · Bugs';
const DEFAULT_LINEAR_LABEL_NAME = 'Bug';
const DEFAULT_LINEAR_STATE_NAME = 'Todo';
const MAX_ATTACHMENT_BYTES = 1_500_000;
const ATTACHMENT_FILENAME_PATTERN = /^[A-Za-z0-9._-]{1,96}\.(?:jpe?g|png)$/i;
const ATTACHMENT_BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

const KIND_TITLE: Record<InChatBugReportKind, string> = {
  bad_answer: 'Bad answer',
  broken_stream: 'Broken stream',
  visual_issue: 'Visual issue',
  wrong_source: 'Wrong source',
  other: 'Conversation bug',
};

const LIKELY_FAILING_AREA: Record<InChatBugReportKind, string> = {
  bad_answer: 'Answer synthesis, retrieval selection, or tool/source interpretation.',
  broken_stream: 'SSE transport or conversation-service stream persistence.',
  visual_issue: 'Conversation UI layout, browser script, or CSS.',
  wrong_source: 'Source selection, consulted-source persistence, or final citation rendering.',
  other: 'Unknown from report; start from the evidence bundle and reported turn.',
};

const FIRST_FILES: Record<InChatBugReportKind, string[]> = {
  bad_answer: ['src/agent-langgraph.ts', 'src/vector-store.ts', 'src/chat/conversation-service.ts'],
  broken_stream: ['src/chat/conversation-service.ts', 'src/server.ts', 'src/web-ui/squire.js'],
  visual_issue: ['src/web-ui/layout.ts', 'src/web-ui/squire.js', 'src/web-ui/styles.css'],
  wrong_source: [
    'src/agent-langgraph.ts',
    'src/vector-store.ts',
    'src/chat/conversation-service.ts',
  ],
  other: ['src/server.ts', 'src/web-ui/squire.js', 'src/chat/conversation-service.ts'],
};

function fieldString(field: DiagnosticField<unknown>): string | undefined {
  if (field.status !== 'available') return undefined;
  if (typeof field.value === 'string') return field.value;
  if (typeof field.value === 'number' || typeof field.value === 'boolean') {
    return String(field.value);
  }
  return undefined;
}

export function bugReportDedupeMarker(bundle: DiagnosticBundle): string {
  const environment = fieldString(bundle.report.environment) ?? 'unknown';
  const conversationId = fieldString(bundle.conversation.id) ?? 'conversation-unavailable';
  const turnId =
    fieldString(bundle.conversation.userMessageId) ??
    fieldString(bundle.conversation.assistantMessageId) ??
    fieldString(bundle.request.requestId) ??
    'turn-unavailable';
  return `squire-bug:${environment}:${conversationId}:${turnId}`;
}

function templateKindForBug(kind: InChatBugReportKind): LinearBugReportKind {
  return kind === 'bad_answer' || kind === 'wrong_source' ? 'answer_quality' : 'app_runtime';
}

function priorityForBug(kind: InChatBugReportKind): number {
  if (kind === 'bad_answer' || kind === 'broken_stream' || kind === 'wrong_source') return 2;
  return 3;
}

function defaultReproSteps(bundle: DiagnosticBundle): string[] {
  const conversationUrl = fieldString(bundle.conversation.url);
  return [
    conversationUrl ? `Open ${conversationUrl}.` : 'Open the conversation URL from Evidence.',
    'Find the reported turn from the Evidence section.',
    'Compare the observed behavior with the expected behavior.',
  ];
}

function defaultAcceptanceCriteria(kind: InChatBugReportKind): string[] {
  const lane =
    kind === 'bad_answer' || kind === 'wrong_source'
      ? 'The corrected answer is backed by the right LangSmith trace and source evidence.'
      : 'The same repro path no longer produces the reported app/runtime failure.';
  return [
    lane,
    'The fix preserves the redaction contract for Sentry, LangSmith, and Linear evidence.',
  ];
}

export function buildLinearBugReportDraft(input: LinearBugReportDraftInput): LinearBugReportDraft {
  const marker = bugReportDedupeMarker(input.bundle);
  const templateKind = templateKindForBug(input.kind);
  const body = createLinearBugReportBody({
    bundle: input.bundle,
    kind: templateKind,
    reportTypeLabel: KIND_TITLE[input.kind],
    observed: input.observed,
    expected: input.expected,
    likelyFailingArea: input.likelyFailingArea ?? LIKELY_FAILING_AREA[input.kind],
    firstFilesToInspect: input.firstFilesToInspect ?? FIRST_FILES[input.kind],
    reproSteps: input.reproSteps ?? defaultReproSteps(input.bundle),
    acceptanceCriteria: input.acceptanceCriteria ?? defaultAcceptanceCriteria(input.kind),
  });
  const diagnosticPayload = redactTelemetryValue({
    kind: input.kind,
    marker,
    diagnosticBundle: input.bundle,
  });

  return {
    title: `[User submitted bug] ${KIND_TITLE[input.kind]}`,
    description: `${body}\n\n<!-- ${marker} -->`,
    diagnosticCommentBody: [
      '## Redacted Diagnostic JSON',
      '',
      '```json',
      JSON.stringify(diagnosticPayload, null, 2),
      '```',
    ].join('\n'),
    marker,
    priority: priorityForBug(input.kind),
    labelName: DEFAULT_LINEAR_LABEL_NAME,
    templateKind,
  };
}

async function addDiagnosticComment(
  linearClient: SquireLinearClient,
  issueId: string,
  body: string,
): Promise<void> {
  await linearClient.createComment(issueId, body);
}

function attachmentBytes(attachment: LinearBugReportAttachment): Buffer | undefined {
  if (!ATTACHMENT_FILENAME_PATTERN.test(attachment.filename)) return undefined;
  if (!ATTACHMENT_BASE64_PATTERN.test(attachment.base64Content)) return undefined;
  const bytes = Buffer.from(attachment.base64Content, 'base64');
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) return undefined;
  return bytes;
}

async function uploadAttachmentToLinear(
  fetch: FetchLike,
  linearClient: SquireLinearClient,
  attachment: LinearBugReportAttachment,
): Promise<string> {
  const bytes = attachmentBytes(attachment);
  if (!bytes) throw new Error(`Invalid attachment ${attachment.filename}`);

  const uploadFile = await linearClient.requestFileUpload({
    filename: attachment.filename,
    contentType: attachment.contentType,
    size: bytes.byteLength,
  });

  const headers = new Headers();
  headers.set('Content-Type', attachment.contentType);
  headers.set('Cache-Control', 'public, max-age=31536000');
  for (const header of uploadFile.headers) headers.set(header.key, header.value);
  const uploadBody = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(uploadBody).set(bytes);

  const response = await fetch(uploadFile.uploadUrl, {
    method: 'PUT',
    headers,
    body: uploadBody,
  });
  if (!response.ok) {
    throw new Error(`Linear attachment upload returned ${String(response.status)}`);
  }

  return uploadFile.assetUrl;
}

function attachmentMarkdown(
  attachment: LinearBugReportAttachment,
  assetUrl: string | undefined,
  unavailableReason: string | undefined,
): string {
  const title = attachment.title?.trim() || attachment.filename;
  const subtitle = attachment.subtitle?.trim();
  if (!assetUrl) {
    return `- ${title}: Unavailable: ${unavailableReason ?? 'upload failed'}`;
  }
  return [`![${title}](${assetUrl})`, subtitle ? `_${subtitle}_` : undefined]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

async function addAttachmentComment(
  fetch: FetchLike,
  linearClient: SquireLinearClient,
  issueId: string,
  attachments: LinearBugReportAttachment[] | undefined,
): Promise<void> {
  const bounded = (attachments ?? []).slice(0, 1);
  if (bounded.length === 0) return;

  const lines: string[] = ['## User-Attached Evidence', ''];
  for (const attachment of bounded) {
    try {
      const assetUrl = await uploadAttachmentToLinear(fetch, linearClient, attachment);
      lines.push(attachmentMarkdown(attachment, assetUrl, undefined));
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'upload failed';
      lines.push(attachmentMarkdown(attachment, undefined, reason));
    }
    lines.push('');
  }

  await addDiagnosticComment(linearClient, issueId, lines.join('\n').trimEnd());
}

function warningForOptionalLinearStep(step: string, error: unknown): string {
  const message = error instanceof Error ? error.message : 'unknown error';
  return `${step}: ${message}`;
}

async function tryOptionalLinearStep(
  warnings: string[],
  step: string,
  action: () => Promise<void>,
): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (error) {
    warnings.push(warningForOptionalLinearStep(step, error));
    return false;
  }
}

function linearApiKeyFromInput(input: SubmitLinearBugReportInput): string | undefined {
  const env = input.env ?? process.env;
  return input.linearApiKey?.trim() || env.LINEAR_API_KEY?.trim() || undefined;
}

function linearClientFromInput(
  input: SubmitLinearBugReportInput,
  linearApiKey: string,
): SquireLinearClient {
  return input.linearClient ?? createLinearClient(linearApiKey);
}

export async function submitLinearBugReport(
  input: SubmitLinearBugReportInput,
): Promise<SubmitLinearBugReportResult> {
  const draft = buildLinearBugReportDraft(input);
  const linearApiKey = linearApiKeyFromInput(input);
  if (!linearApiKey) {
    return {
      status: 'disabled',
      reason: 'LINEAR_API_KEY is not configured',
      marker: draft.marker,
    };
  }

  const fetch = input.fetch ?? globalThis.fetch;
  const teamKey = input.linearTeamKey ?? DEFAULT_LINEAR_TEAM_KEY;
  const linearClient = linearClientFromInput(input, linearApiKey);
  const targets = await linearClient.resolveTargets({
    teamKey,
    projectName: input.linearProjectName ?? DEFAULT_LINEAR_PROJECT_NAME,
    labelName: DEFAULT_LINEAR_LABEL_NAME,
    stateName: input.linearStateName ?? DEFAULT_LINEAR_STATE_NAME,
    assignViewer: true,
  });
  const existing = await linearClient.findIssueByMarker(teamKey, draft.marker);
  if (existing) {
    const warnings: string[] = [];
    await tryOptionalLinearStep(warnings, 'Add user-attached evidence comment', () =>
      addAttachmentComment(fetch, linearClient, existing.id, input.attachments),
    );
    return {
      status: 'existing',
      issue: existing,
      marker: draft.marker,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  const issue = await linearClient.createIssue({
    teamId: targets.teamId,
    title: draft.title,
    description: draft.description,
    priority: draft.priority,
    projectId: targets.projectId,
    assigneeId: targets.assigneeId,
    stateId: targets.stateId,
    labelIds: targets.labelIds,
  });
  const warnings: string[] = [];
  const canComment = await tryOptionalLinearStep(warnings, 'Add redacted diagnostic comment', () =>
    addDiagnosticComment(linearClient, issue.id, draft.diagnosticCommentBody),
  );
  if (canComment) {
    await tryOptionalLinearStep(warnings, 'Add user-attached evidence comment', () =>
      addAttachmentComment(fetch, linearClient, issue.id, input.attachments),
    );
  } else if (input.attachments?.length) {
    warnings.push(
      'Add user-attached evidence comment: skipped because Linear comments are unavailable',
    );
  }
  return {
    status: 'created',
    issue,
    marker: draft.marker,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
