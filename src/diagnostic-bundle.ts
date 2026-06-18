import { z } from 'zod';

import * as ConversationRepository from './db/repositories/conversation-repository.ts';
import * as MessageRepository from './db/repositories/message-repository.ts';
import * as MessageStreamEventRepository from './db/repositories/message-stream-event-repository.ts';
import type {
  Conversation,
  ConversationMessage,
  ConversationMessagePublicWorkEventName,
} from './db/repositories/types.ts';
import {
  buildDiagnosticMetadata,
  redactTelemetryValue,
  TELEMETRY_UNAVAILABLE,
  type TelemetryUserIdentity,
} from './telemetry.ts';
import { langSmithRunUrlFromRunId } from './langsmith-links.ts';
import { EMBEDDING_VERSION } from './vector-store.ts';

type DiagnosticPrimitive = string | number | boolean | null;
type DiagnosticJson = DiagnosticPrimitive | DiagnosticJson[] | { [key: string]: DiagnosticJson };

export type DiagnosticField<T> =
  | { status: 'available'; value: T }
  | { status: 'unavailable'; reason: string };

export interface DiagnosticBrowserMetadata {
  url?: string;
  userAgent?: string;
  viewport?: { width: number; height: number };
  replaySnapshotId?: string;
  timezone?: string;
}

export interface DiagnosticBundleLinkInput {
  sentryIssueUrl?: string;
  sentryEventUrl?: string;
  sentryEventId?: string;
  sentryReplayUrl?: string;
  sentryTraceUrl?: string;
  sentryLogsUrl?: string;
  sentryTraceId?: string;
  langsmithTraceUrl?: string;
  langsmithThreadUrl?: string;
  langsmithThreadId?: string;
  langsmithRunUrl?: string;
  langsmithRunId?: string;
}

export interface DiagnosticBundleInput extends DiagnosticBundleLinkInput {
  now?: Date;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  route?: string;
  browserUrl?: string;
  conversationUrl?: string;
  requestId?: string;
  conversationId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  user?: TelemetryUserIdentity;
  browser?: DiagnosticBrowserMetadata;
  conversation?: Conversation | null;
  messages?: ConversationMessage[] | null;
  streamEvents?: MessageStreamEventRepository.MessageStreamEvent[] | null;
}

export interface CollectDiagnosticBundleInput extends DiagnosticBundleInput {
  dataSource?: DiagnosticBundleDataSource;
}

export interface DiagnosticBundleDataSource {
  findOwnedConversation(userId: string, conversationId: string): Promise<Conversation | null>;
  findMessageById(messageId: string): Promise<ConversationMessage | null>;
  listMessagesByConversationId(conversationId: string): Promise<ConversationMessage[]>;
  listStreamEventsByUserMessageId(
    userMessageId: string,
  ): Promise<MessageStreamEventRepository.MessageStreamEvent[]>;
}

export interface DiagnosticWorkLogRow {
  sequence: number;
  event: ConversationMessagePublicWorkEventName;
  createdAt: string;
  sourceLabels: string[];
  ok?: boolean;
  ref?: string;
}

export interface DiagnosticUnavailableField {
  path: string;
  reason: string;
}

const DiagnosticJsonSchema: z.ZodType<DiagnosticJson> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(DiagnosticJsonSchema),
    z.record(z.string(), DiagnosticJsonSchema),
  ]),
);

export const DiagnosticFieldSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('available'), value: DiagnosticJsonSchema }).strict(),
  z.object({ status: z.literal('unavailable'), reason: z.string().min(1) }).strict(),
]);

export const DiagnosticWorkLogRowSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    event: z.enum(['tool-plan', 'tool-progress', 'tool-result', 'answer-artifact']),
    createdAt: z.string().datetime(),
    sourceLabels: z.array(z.string().min(1)).max(12),
    ok: z.boolean().optional(),
    ref: z.string().min(1).optional(),
  })
  .strict();

export const DiagnosticBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    report: z
      .object({
        generatedAt: DiagnosticFieldSchema,
        environment: DiagnosticFieldSchema,
        release: DiagnosticFieldSchema,
      })
      .strict(),
    request: z
      .object({
        requestId: DiagnosticFieldSchema,
        route: DiagnosticFieldSchema,
      })
      .strict(),
    conversation: z
      .object({
        url: DiagnosticFieldSchema,
        id: DiagnosticFieldSchema,
        userId: DiagnosticFieldSchema,
        userHash: DiagnosticFieldSchema,
        userMessageId: DiagnosticFieldSchema,
        assistantMessageId: DiagnosticFieldSchema,
        game: DiagnosticFieldSchema,
        campaignId: DiagnosticFieldSchema,
        userMessageCreatedAt: DiagnosticFieldSchema,
        assistantMessageCreatedAt: DiagnosticFieldSchema,
        assistantIsError: DiagnosticFieldSchema,
      })
      .strict(),
    sentry: z
      .object({
        issueUrl: DiagnosticFieldSchema,
        eventUrl: DiagnosticFieldSchema,
        eventId: DiagnosticFieldSchema,
        replayUrl: DiagnosticFieldSchema,
        traceUrl: DiagnosticFieldSchema,
        logsUrl: DiagnosticFieldSchema,
        traceId: DiagnosticFieldSchema,
      })
      .strict(),
    langsmith: z
      .object({
        traceUrl: DiagnosticFieldSchema,
        threadUrl: DiagnosticFieldSchema,
        threadId: DiagnosticFieldSchema,
        runUrl: DiagnosticFieldSchema,
        runId: DiagnosticFieldSchema,
      })
      .strict(),
    browser: z
      .object({
        url: DiagnosticFieldSchema,
        userAgent: DiagnosticFieldSchema,
        viewport: DiagnosticFieldSchema,
        replaySnapshotId: DiagnosticFieldSchema,
        timezone: DiagnosticFieldSchema,
      })
      .strict(),
    stream: z
      .object({
        status: DiagnosticFieldSchema,
        terminalEvent: DiagnosticFieldSchema,
        eventCount: DiagnosticFieldSchema,
        workLogRows: z.union([
          z
            .object({ status: z.literal('available'), value: z.array(DiagnosticWorkLogRowSchema) })
            .strict(),
          z.object({ status: z.literal('unavailable'), reason: z.string().min(1) }).strict(),
        ]),
      })
      .strict(),
    sourceIndex: z
      .object({
        embeddingVersion: DiagnosticFieldSchema,
        consultedSourceLabels: DiagnosticFieldSchema,
        workLogSourceLabels: DiagnosticFieldSchema,
      })
      .strict(),
    unavailable: z.array(z.object({ path: z.string().min(1), reason: z.string().min(1) }).strict()),
  })
  .strict();

export type DiagnosticBundle = z.infer<typeof DiagnosticBundleSchema>;

const DEFAULT_DATA_SOURCE: DiagnosticBundleDataSource = {
  findOwnedConversation: ConversationRepository.findOwnedById,
  findMessageById: MessageRepository.findById,
  listMessagesByConversationId: (conversationId) =>
    MessageRepository.listByConversationId(conversationId, { includeErrors: true }),
  listStreamEventsByUserMessageId: (userMessageId) =>
    MessageStreamEventRepository.listAfter({ userMessageId }),
};

const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/;
const URL_TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/;
const SAFE_REF_PATTERN =
  /^(?:rules|scenario|section|card|source):[A-Za-z0-9._:-]+(?:\/[A-Za-z0-9._:-]+)+(?:#chunk=\d+)?$/;
const SAFE_SENTRY_LOG_QUERY_KEYS = new Set([
  'environment',
  'field',
  'project',
  'query',
  'referrer',
  'sort',
  'statsPeriod',
]);
const SAFE_SENTRY_LOG_FILTER_KEYS = new Set([
  'assistant_message_id',
  'conversation_id',
  'environment',
  'event_type',
  'failure_kind',
  'level',
  'release',
  'request_id',
  'route',
  'span_id',
  'squire.assistant_message_id',
  'squire.conversation_id',
  'squire.request_id',
  'squire.user_message_id',
  'status',
  'surface',
  'trace',
  'trace_id',
  'user_message_id',
]);
const SAFE_SENTRY_LOG_QUERY_VALUE_PATTERN = /^[A-Za-z0-9_ .:/="'%+-]{1,512}$/;
const SAFE_SENTRY_LOG_FILTER_VALUE_PATTERN =
  /^(?:"[A-Za-z0-9._:/-]{1,254}"|[A-Za-z0-9._:/-]{1,256})$/;
const UNSAFE_QUERY_VALUE_PARTS = [
  'authorization',
  'cookie',
  'email',
  'oauth',
  'password',
  'secret',
  'session',
  'token',
];
const DEFAULT_SENTRY_ORG_SLUG = 'brian-moseley';
const DEFAULT_SENTRY_PROJECT_ID = '4511564194643969';
const SENTRY_BUG_REPORT_REFERRER = 'squire-bug-report';
const PUBLIC_WORK_EVENTS = new Set<string>([
  'tool-plan',
  'tool-progress',
  'tool-result',
  'answer-artifact',
]);

function available<T>(value: T): DiagnosticField<T> {
  return { status: 'available', value: redactTelemetryValue(value) as T };
}

function unavailable<T>(reason: string): DiagnosticField<T> {
  return { status: 'unavailable', reason };
}

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function safeToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !TOKEN_PATTERN.test(trimmed)) return undefined;
  return trimmed;
}

function safeUrlToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !URL_TOKEN_PATTERN.test(trimmed)) return undefined;
  return trimmed;
}

function safeTimezone(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 64) return undefined;
  if (trimmed === 'UTC') return trimmed;
  const parts = trimmed.split('/');
  if (parts.length < 2) return undefined;
  return parts.every((part) => /^[A-Za-z][A-Za-z0-9._+-]*$/.test(part)) ? trimmed : undefined;
}

function safeSourceLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) return null;
  return /^[A-Z][A-Z0-9 _-]*$/.test(trimmed) ? trimmed : null;
}

function safeRef(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return SAFE_REF_PATTERN.test(trimmed) ? trimmed : undefined;
}

function safePathOrUrl(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;

  try {
    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw);
      return `${url.origin}${url.pathname || '/'}`;
    }
  } catch {
    return undefined;
  }

  if (!raw.startsWith('/')) return undefined;
  return raw.split('?')[0]?.split('#')[0] || '/';
}

function safeExternalUrl(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return `${url.origin}${url.pathname || '/'}`;
  } catch {
    return undefined;
  }
}

function safeSentryLogsUrl(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    const safeParams = new URLSearchParams();
    for (const [key, paramValue] of url.searchParams.entries()) {
      if (!SAFE_SENTRY_LOG_QUERY_KEYS.has(key)) continue;
      if (key === 'query') {
        const safeQuery = safeSentryLogsQuery(paramValue);
        if (safeQuery) safeParams.append(key, safeQuery);
        continue;
      }
      const valueLower = paramValue.toLowerCase();
      if (UNSAFE_QUERY_VALUE_PARTS.some((part) => valueLower.includes(part))) continue;
      if (!SAFE_SENTRY_LOG_QUERY_VALUE_PATTERN.test(paramValue)) continue;
      safeParams.append(key, paramValue);
    }
    const query = safeParams.toString();
    return `${url.origin}${url.pathname}${query ? `?${query}` : ''}`;
  } catch {
    return undefined;
  }
}

function safeSentrySearchUrl(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    if (!/\/(?:issues|explore\/traces)\//.test(url.pathname)) return undefined;
    const safeParams = new URLSearchParams();
    for (const [key, paramValue] of url.searchParams.entries()) {
      if (!SAFE_SENTRY_LOG_QUERY_KEYS.has(key)) continue;
      if (key === 'query') {
        const safeQuery = safeSentryLogsQuery(paramValue);
        if (safeQuery) safeParams.append(key, safeQuery);
        continue;
      }
      const valueLower = paramValue.toLowerCase();
      if (UNSAFE_QUERY_VALUE_PARTS.some((part) => valueLower.includes(part))) continue;
      if (!SAFE_SENTRY_LOG_QUERY_VALUE_PATTERN.test(paramValue)) continue;
      safeParams.append(key, paramValue);
    }
    const query = safeParams.toString();
    return `${url.origin}${url.pathname}${query ? `?${query}` : ''}`;
  } catch {
    return undefined;
  }
}

function safeSentryLogsQuery(value: string): string | undefined {
  const query = value.trim();
  if (!query) return undefined;
  const queryLower = query.toLowerCase();
  if (UNSAFE_QUERY_VALUE_PARTS.some((part) => queryLower.includes(part))) return undefined;
  if (!SAFE_SENTRY_LOG_QUERY_VALUE_PATTERN.test(query)) return undefined;

  const terms = query.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return undefined;
  for (const term of terms) {
    const separator = term.indexOf(':');
    if (separator <= 0 || separator === term.length - 1) return undefined;
    const key = term.slice(0, separator);
    const filterValue = term.slice(separator + 1);
    if (!SAFE_SENTRY_LOG_FILTER_KEYS.has(key)) return undefined;
    if (!SAFE_SENTRY_LOG_FILTER_VALUE_PATTERN.test(filterValue)) return undefined;
  }
  return terms.join(' ');
}

function envValue(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> | undefined,
  key: string,
): string | undefined {
  const raw = (env ?? process.env)[key];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : undefined;
}

function sentryOrgSlug(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> | undefined,
): string | undefined {
  return (
    safeUrlToken(envValue(env, 'SENTRY_ORG_SLUG') ?? envValue(env, 'SENTRY_ORG')) ??
    DEFAULT_SENTRY_ORG_SLUG
  );
}

function sentryProjectId(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> | undefined,
): string | undefined {
  return safeUrlToken(envValue(env, 'SENTRY_PROJECT_ID')) ?? DEFAULT_SENTRY_PROJECT_ID;
}

function sentryEnvironment(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> | undefined,
  metadataEnvironment: string,
): string | undefined {
  const configured = safeUrlToken(envValue(env, 'SENTRY_ENVIRONMENT'));
  if (configured) return configured;
  return metadataEnvironment === TELEMETRY_UNAVAILABLE
    ? undefined
    : safeUrlToken(metadataEnvironment);
}

function sentrySearchUrl(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> | undefined,
  metadataEnvironment: string,
  path: string,
  query: string,
): string | undefined {
  const org = sentryOrgSlug(env);
  const project = sentryProjectId(env);
  const environment = sentryEnvironment(env, metadataEnvironment);
  if (!org || !project || !environment) return undefined;
  const params = new URLSearchParams({
    project,
    environment,
    query,
    referrer: SENTRY_BUG_REPORT_REFERRER,
  });
  return `https://${org}.sentry.io/${path}?${params.toString()}`;
}

function sentryQueryTerms(input: {
  requestId?: string;
  conversationId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
}): string {
  return [
    ['request_id', safeToken(input.requestId)],
    ['conversation_id', safeToken(input.conversationId)],
    ['user_message_id', safeToken(input.userMessageId)],
    ['assistant_message_id', safeToken(input.assistantMessageId)],
  ]
    .flatMap(([key, value]) => (value ? [`${key}:${value}`] : []))
    .join(' ');
}

function isoDate(value: Date | undefined): string | undefined {
  if (!value || Number.isNaN(value.getTime())) return undefined;
  return value.toISOString();
}

function field<T>(value: T | undefined | null, unavailableReason: string): DiagnosticField<T> {
  if (value === undefined || value === null) return unavailable(unavailableReason);
  if (typeof value === 'string' && value.trim().length === 0) return unavailable(unavailableReason);
  return available(value);
}

function urlField(
  value: string | undefined | null,
  unavailableReason: string,
): DiagnosticField<string> {
  if (value === undefined || value === null || value.trim().length === 0) {
    return unavailable(unavailableReason);
  }
  return { status: 'available', value };
}

function parseLocator(input: DiagnosticBundleInput): {
  conversationId?: string;
  userMessageId?: string;
  conversationUrl?: string;
  route?: string;
  browserUrl?: string;
} {
  const conversationUrl = safePathOrUrl(input.conversationUrl);
  const browserUrl = safePathOrUrl(input.browserUrl ?? input.browser?.url);
  const route = safePathOrUrl(input.route ?? conversationUrl ?? browserUrl);
  const path = route ? safePathOrUrl(route) : undefined;
  const chatMatch = path?.match(/^\/chat\/([^/]+)$/);
  const streamMatch = path?.match(/^\/chat\/([^/]+)\/messages\/([^/]+)\/stream$/);

  return {
    conversationId:
      safeToken(input.conversationId) ?? safeToken(streamMatch?.[1]) ?? safeToken(chatMatch?.[1]),
    userMessageId: safeToken(input.userMessageId) ?? safeToken(streamMatch?.[2]),
    conversationUrl,
    route,
    browserUrl,
  };
}

function findUserMessage(
  messages: ConversationMessage[],
  userMessageId: string | undefined,
  assistantMessage: ConversationMessage | undefined,
): ConversationMessage | undefined {
  if (userMessageId) return messages.find((message) => message.id === userMessageId);
  if (assistantMessage?.responseToMessageId) {
    return messages.find((message) => message.id === assistantMessage.responseToMessageId);
  }
  return [...messages].reverse().find((message) => message.role === 'user');
}

function findAssistantMessage(
  messages: ConversationMessage[],
  assistantMessageId: string | undefined,
  userMessage: ConversationMessage | undefined,
): ConversationMessage | undefined {
  if (assistantMessageId) return messages.find((message) => message.id === assistantMessageId);
  if (userMessage) {
    const response = messages.find(
      (message) => message.role === 'assistant' && message.responseToMessageId === userMessage.id,
    );
    if (response) return response;
  }
  return [...messages].reverse().find((message) => message.role === 'assistant');
}

function sourceLabelsFromPayload(payload: Record<string, unknown>): string[] {
  const labels = new Set<string>();
  const add = (value: unknown) => {
    const label = safeSourceLabel(value);
    if (label) labels.add(label);
  };

  add(payload.label);
  add(payload.sourceLabel);
  if (Array.isArray(payload.labels)) {
    for (const label of payload.labels) add(label);
  }
  return [...labels].slice(0, 12);
}

function buildWorkLogRows(
  streamEvents: MessageStreamEventRepository.MessageStreamEvent[] | undefined,
): DiagnosticField<DiagnosticWorkLogRow[]> {
  if (!streamEvents) return unavailable('stream events were not loaded');

  const rows: DiagnosticWorkLogRow[] = [];
  for (const event of streamEvents) {
    if (!PUBLIC_WORK_EVENTS.has(event.event)) continue;
    const publicEvent = event.event as ConversationMessagePublicWorkEventName;
    const payload = event.payload ?? {};
    const row: DiagnosticWorkLogRow = {
      sequence: event.sequence,
      event: publicEvent,
      createdAt: event.createdAt.toISOString(),
      sourceLabels: sourceLabelsFromPayload(payload),
    };
    if (typeof payload.ok === 'boolean') row.ok = payload.ok;
    const ref = safeRef(payload.ref);
    if (ref) row.ref = ref;
    rows.push(row);
  }
  return available(rows);
}

function streamStatus(
  streamEvents: MessageStreamEventRepository.MessageStreamEvent[] | undefined,
): {
  status: DiagnosticField<string>;
  terminalEvent: DiagnosticField<string>;
  eventCount: DiagnosticField<number>;
} {
  if (!streamEvents) {
    return {
      status: unavailable('stream events were not loaded'),
      terminalEvent: unavailable('stream events were not loaded'),
      eventCount: unavailable('stream events were not loaded'),
    };
  }

  const terminal = streamEvents.findLast(
    (event) => event.event === 'done' || event.event === 'error',
  );
  return {
    status: available(
      terminal?.event === 'done'
        ? 'complete'
        : terminal?.event === 'error'
          ? 'error'
          : 'incomplete',
    ),
    terminalEvent: terminal
      ? available(terminal.event)
      : unavailable('no terminal stream event recorded'),
    eventCount: available(streamEvents.length),
  };
}

function collectSourceLabels(
  assistantMessage: ConversationMessage | undefined,
  workLogRows: DiagnosticField<DiagnosticWorkLogRow[]>,
): {
  consultedSourceLabels: DiagnosticField<string[]>;
  workLogSourceLabels: DiagnosticField<string[]>;
} {
  const consulted = (assistantMessage?.consultedSources ?? [])
    .map((label) => safeSourceLabel(label) ?? safeToken(label))
    .filter((label): label is string => Boolean(label));

  const workLogLabels =
    workLogRows.status === 'available'
      ? [...new Set(workLogRows.value.flatMap((row) => row.sourceLabels))]
      : undefined;

  return {
    consultedSourceLabels:
      consulted.length > 0
        ? available([...new Set(consulted)].slice(0, 24))
        : unavailable('assistant message has no consulted source labels'),
    workLogSourceLabels:
      workLogLabels && workLogLabels.length > 0
        ? available(workLogLabels.slice(0, 24))
        : unavailable('work log has no source labels'),
  };
}

function unavailableFields(value: unknown, path: string[] = []): DiagnosticUnavailableField[] {
  if (typeof value !== 'object' || value === null) return [];
  if ('status' in value && (value as { status?: unknown }).status === 'unavailable') {
    return [
      {
        path: path.join('.'),
        reason: String((value as { reason?: unknown }).reason ?? 'unavailable'),
      },
    ];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => unavailableFields(item, [...path, String(index)]));
  }
  return Object.entries(value)
    .filter(([key]) => key !== 'unavailable')
    .flatMap(([key, child]) => unavailableFields(child, [...path, key]));
}

export function buildDiagnosticBundle(input: DiagnosticBundleInput = {}): DiagnosticBundle {
  const locator = parseLocator(input);
  const metadata = buildDiagnosticMetadata(
    {
      route: locator.route ?? input.route,
      requestId: input.requestId,
      conversationId: locator.conversationId,
      userMessageId: locator.userMessageId,
      assistantMessageId: input.assistantMessageId,
      user: input.user,
      langsmithThreadUrl: input.langsmithThreadUrl,
      langsmithRunUrl: input.langsmithRunUrl,
    },
    input.env,
  );
  const messages = input.messages ?? [];
  const explicitAssistantId = safeToken(input.assistantMessageId);
  const preliminaryAssistant = explicitAssistantId
    ? messages.find((message) => message.id === explicitAssistantId)
    : undefined;
  const userMessage = findUserMessage(messages, locator.userMessageId, preliminaryAssistant);
  const assistantMessage = findAssistantMessage(messages, explicitAssistantId, userMessage);
  const workLogRows = buildWorkLogRows(input.streamEvents ?? undefined);
  const status = streamStatus(input.streamEvents ?? undefined);
  const sourceLabels = collectSourceLabels(assistantMessage, workLogRows);
  const conversationId =
    locator.conversationId ??
    input.conversation?.id ??
    userMessage?.conversationId ??
    assistantMessage?.conversationId;
  const derivedSentryQuery = sentryQueryTerms({
    requestId: metadata.requestId === TELEMETRY_UNAVAILABLE ? input.requestId : metadata.requestId,
    conversationId,
    userMessageId: userMessage?.id ?? locator.userMessageId,
    assistantMessageId: assistantMessage?.id ?? explicitAssistantId,
  });
  const derivedSentryIssueUrl =
    derivedSentryQuery.length > 0
      ? sentrySearchUrl(input.env, metadata.environment, 'issues/', derivedSentryQuery)
      : undefined;
  const derivedSentryLogsUrl =
    derivedSentryQuery.length > 0
      ? sentrySearchUrl(input.env, metadata.environment, 'explore/logs/', derivedSentryQuery)
      : undefined;
  const derivedSentryTraceUrl =
    derivedSentryQuery.length > 0
      ? sentrySearchUrl(
          input.env,
          metadata.environment,
          'explore/traces/',
          derivedSentryQuery
            .split(/\s+/)
            .filter(Boolean)
            .map((term) => {
              const separator = term.indexOf(':');
              return separator > 0
                ? `squire.${term.slice(0, separator)}:${term.slice(separator + 1)}`
                : term;
            })
            .join(' '),
        )
      : undefined;
  const langsmithThreadId = safeToken(input.langsmithThreadId);
  const langsmithRunId = safeToken(
    input.langsmithRunId ?? assistantMessage?.langsmithRunId ?? undefined,
  );
  const derivedLangSmithRunUrl = langSmithRunUrlFromRunId(langsmithRunId, input.env);
  const langsmithRunUrl =
    safeExternalUrl(input.langsmithRunUrl) ??
    safeExternalUrl(assistantMessage?.langsmithRunUrl ?? undefined) ??
    safeExternalUrl(derivedLangSmithRunUrl);
  const langsmithTraceUrl =
    safeExternalUrl(input.langsmithTraceUrl) ??
    safeExternalUrl(assistantMessage?.langsmithTraceUrl ?? undefined) ??
    langsmithRunUrl;

  const bundleWithoutUnavailable = {
    schemaVersion: 1 as const,
    report: {
      generatedAt: available((input.now ?? new Date()).toISOString()),
      environment:
        metadata.environment === TELEMETRY_UNAVAILABLE
          ? unavailable('environment is not configured')
          : available(metadata.environment),
      release:
        metadata.release === TELEMETRY_UNAVAILABLE
          ? unavailable('SENTRY_RELEASE is not configured')
          : available(metadata.release),
    },
    request: {
      requestId:
        metadata.requestId === TELEMETRY_UNAVAILABLE
          ? unavailable('request id was not provided')
          : available(metadata.requestId),
      route:
        metadata.route === TELEMETRY_UNAVAILABLE
          ? unavailable('route could not be derived')
          : available(metadata.route),
    },
    conversation: {
      url: field(locator.conversationUrl, 'conversation URL was not provided'),
      id: field(safeToken(conversationId), 'conversation id was not provided or loaded'),
      userId:
        metadata.userId === TELEMETRY_UNAVAILABLE
          ? unavailable('safe user id was not provided')
          : available(metadata.userId),
      userHash:
        metadata.userHash === TELEMETRY_UNAVAILABLE
          ? unavailable('safe user hash was not provided')
          : available(metadata.userHash),
      userMessageId: field(
        userMessage?.id ?? locator.userMessageId,
        'user message id was not provided or loaded',
      ),
      assistantMessageId: field(
        assistantMessage?.id ?? explicitAssistantId,
        'assistant message id was not provided or loaded',
      ),
      game: field(userMessage?.game ?? undefined, 'user message game was not loaded'),
      campaignId: field(userMessage?.campaignId ?? undefined, 'message has no campaign binding'),
      userMessageCreatedAt: field(isoDate(userMessage?.createdAt), 'user message was not loaded'),
      assistantMessageCreatedAt: field(
        isoDate(assistantMessage?.createdAt),
        'assistant message was not loaded',
      ),
      assistantIsError:
        assistantMessage === undefined
          ? unavailable('assistant message was not loaded')
          : available(assistantMessage.isError),
    },
    sentry: {
      issueUrl: urlField(
        safeExternalUrl(input.sentryIssueUrl) ?? safeSentrySearchUrl(derivedSentryIssueUrl),
        'Sentry issue URL was not provided or derivable',
      ),
      eventUrl: urlField(
        safeExternalUrl(input.sentryEventUrl),
        'Sentry event URL was not provided',
      ),
      eventId: field(safeToken(input.sentryEventId), 'Sentry event ID was not provided'),
      replayUrl: urlField(
        safeExternalUrl(input.sentryReplayUrl),
        'Sentry replay URL was not provided',
      ),
      traceUrl: urlField(
        safeExternalUrl(input.sentryTraceUrl) ?? safeSentrySearchUrl(derivedSentryTraceUrl),
        'Sentry trace URL was not provided or derivable',
      ),
      logsUrl: urlField(
        safeSentryLogsUrl(input.sentryLogsUrl) ?? safeSentryLogsUrl(derivedSentryLogsUrl),
        'Sentry logs query URL was not provided or derivable',
      ),
      traceId: field(safeToken(input.sentryTraceId), 'Sentry trace ID was not provided'),
    },
    langsmith: {
      traceUrl: urlField(langsmithTraceUrl, 'LangSmith trace URL was not provided'),
      threadUrl: urlField(
        safeExternalUrl(input.langsmithThreadUrl),
        'LangSmith thread URL was not provided',
      ),
      threadId: field(langsmithThreadId, 'LangSmith thread id was not provided'),
      runUrl: urlField(langsmithRunUrl, 'LangSmith run URL was not provided or derivable'),
      runId: field(langsmithRunId, 'LangSmith run id was not provided'),
    },
    browser: {
      url: field(locator.browserUrl, 'browser URL was not provided'),
      userAgent: field(
        hasText(input.browser?.userAgent) ? input.browser.userAgent.slice(0, 512) : undefined,
        'browser user agent was not provided',
      ),
      viewport: field(
        input.browser?.viewport
          ? {
              width: input.browser.viewport.width,
              height: input.browser.viewport.height,
            }
          : undefined,
        'browser viewport was not provided',
      ),
      replaySnapshotId: field(
        safeToken(input.browser?.replaySnapshotId),
        'browser replay snapshot id was not provided',
      ),
      timezone: field(safeTimezone(input.browser?.timezone), 'browser timezone was not provided'),
    },
    stream: {
      status: status.status,
      terminalEvent: status.terminalEvent,
      eventCount: status.eventCount,
      workLogRows,
    },
    sourceIndex: {
      embeddingVersion: available(EMBEDDING_VERSION),
      consultedSourceLabels: sourceLabels.consultedSourceLabels,
      workLogSourceLabels: sourceLabels.workLogSourceLabels,
    },
  };

  const bundle = {
    ...bundleWithoutUnavailable,
    unavailable: unavailableFields(bundleWithoutUnavailable),
  };
  return DiagnosticBundleSchema.parse(bundle);
}

export async function collectDiagnosticBundle(
  input: CollectDiagnosticBundleInput = {},
): Promise<DiagnosticBundle> {
  const dataSource = input.dataSource ?? DEFAULT_DATA_SOURCE;
  const locator = parseLocator(input);
  const userId = safeToken(input.user?.id);
  let conversation = input.conversation ?? null;
  let messages = input.messages ?? null;
  let streamEvents = input.streamEvents ?? null;
  let conversationId = locator.conversationId;
  let userMessageId = locator.userMessageId;

  if (!conversationId && userMessageId && userId) {
    const message = await dataSource.findMessageById(userMessageId);
    if (message) conversationId = message.conversationId;
  }

  if (!conversation && conversationId && userId) {
    conversation = await dataSource.findOwnedConversation(userId, conversationId);
  }

  if (!messages && conversation) {
    messages = await dataSource.listMessagesByConversationId(conversation.id);
  }

  if (!userMessageId && messages) {
    userMessageId = findUserMessage(messages, undefined, undefined)?.id;
  }

  if (!streamEvents && userMessageId && conversation) {
    streamEvents = await dataSource.listStreamEventsByUserMessageId(userMessageId);
  }

  return buildDiagnosticBundle({
    ...input,
    conversationId: conversationId ?? input.conversationId,
    userMessageId: userMessageId ?? input.userMessageId,
    conversation,
    messages,
    streamEvents,
  });
}
