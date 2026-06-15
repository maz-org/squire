import * as Sentry from '@sentry/node';
import type {
  Breadcrumb,
  Event,
  EventHint,
  ErrorEvent,
  Log,
  LogSeverityLevel,
  SeverityLevel,
  User,
} from '@sentry/node';

import { resolveSquireEnv } from './squire-env.ts';

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

type SafePrimitive = string | number | boolean | null;
type SafeJson = SafePrimitive | SafeJson[] | { [key: string]: SafeJson };

export const TELEMETRY_REDACTED = '[redacted:sensitive]';
export const TELEMETRY_UNAVAILABLE = '[unavailable]';

/**
 * Stable diagnostic field names for Sentry context and later Linear evidence.
 * Additions here should be intentional and covered by telemetry contract tests.
 */
export const TELEMETRY_DIAGNOSTIC_FIELDS = [
  'environment',
  'release',
  'route',
  'requestId',
  'conversationId',
  'userMessageId',
  'assistantMessageId',
  'sentryTraceId',
  'langsmithThreadUrl',
  'langsmithRunUrl',
  'userId',
  'userHash',
] as const;

type TelemetryDiagnosticField = (typeof TELEMETRY_DIAGNOSTIC_FIELDS)[number];

export type TelemetryDiagnosticMetadata = Record<TelemetryDiagnosticField, string>;

export interface TelemetryUserIdentity {
  /** Safe opaque app user id only. Do not pass email, name, cookies, or tokens. */
  id?: string;
  /** Safe precomputed opaque user hash when a database id is unavailable. */
  hash?: string;
  /** Explicitly unsupported; present only so accidental callers get redacted/ignored. */
  email?: string;
}

export interface TelemetryDiagnosticInput {
  /** Route pattern or path only; query strings are stripped. */
  route?: string;
  requestId?: string;
  conversationId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  sentryTraceId?: string;
  langsmithThreadUrl?: string;
  langsmithRunUrl?: string;
  user?: TelemetryUserIdentity;
}

export interface TelemetryCaptureInput extends TelemetryDiagnosticInput {
  /**
   * Operational context only. Never pass raw prompts, model output, provider
   * payloads, cookies, auth headers, or retrieved passages; the boundary still
   * redacts known protected keys as a backstop.
   */
  context?: Record<string, unknown>;
}

export interface TelemetryBreadcrumbInput extends TelemetryCaptureInput {
  category: string;
  message: string;
  level?: SeverityLevel;
}

export type TelemetryLogLevel = LogSeverityLevel;

export interface TelemetryLogInput extends TelemetryCaptureInput {
  /**
   * Structured operational attributes for Sentry Logs. Unknown keys are allowed
   * after sanitization; stable diagnostic keys are added in snake_case below.
   */
  attributes?: Record<string, unknown>;
}

export type TelemetryFeedbackKind =
  | 'wrong_answer'
  | 'stream_failed'
  | 'ui_broken'
  | 'source_problem'
  | 'other';

export interface TelemetryFeedbackInput extends TelemetryCaptureInput {
  feedbackKind: TelemetryFeedbackKind;
  associatedEventId?: string;
}

export interface TelemetryInitResult {
  enabled: boolean;
  reason: 'initialized' | 'already_initialized' | 'missing_dsn' | 'init_failed';
}

type SentryTransactionEvent = Event & { type: 'transaction' };
type SentrySpanPayload = {
  data: Record<string, unknown>;
  description?: string;
};

const SENTRY_SAFE_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: false, response: false },
  httpBodies: [],
  queryParams: false,
  genAI: { inputs: false, outputs: false },
  stackFrameVariables: false,
  frameContextLines: 0,
};

const PROTECTED_KEY_PARTS = [
  'authorization',
  'proxyauthorization',
  'authheader',
  'cookie',
  'setcookie',
  'token',
  'oauth',
  'apikey',
  'secret',
  'password',
  'dsn',
  'email',
  'phone',
  'address',
  'ipaddress',
  'creditcard',
  'cardnumber',
  'ssn',
  'socialsecurity',
  'privatekey',
  'pem',
  'prompt',
  'fullanswer',
  'answer',
  'modeloutput',
  'completion',
  'providerpayload',
  'providerrequest',
  'providerresponse',
  'requestbody',
  'responsebody',
  'rawfeedback',
  'comment',
  'retrievedpassage',
  'retrievedsource',
  'sourcepassage',
  'sourcedocument',
  'rawsource',
  'documenttext',
  'transcript',
  'embedding',
] as const;

let initializedDsn: string | null = null;

const PROTECTED_EXACT_KEYS = new Set([
  'name',
  'username',
  'firstname',
  'lastname',
  'fullname',
  'displayname',
  'customername',
  'clientname',
  'card',
  'mailingaddress',
  'streetaddress',
  'postaladdress',
  'phonenumber',
  'mobilenumber',
  'emailaddress',
  'useremail',
]);

const REQUEST_OR_RESPONSE_PATH_PARTS = new Set([
  'request',
  'response',
  'http',
  'httpcontext',
  'requestcontext',
  'responsecontext',
]);

const SENSITIVE_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
  /\b(?:sk|rk|pk|xox[baprs]|gh[pousr])_[A-Za-z0-9_=-]{12,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /(?:^|[^A-Fa-f0-9-])(?:\d{13,19}|\d{4}[ -]\d{4}[ -]\d{4}(?:[ -]\d{1,7})?)(?![A-Fa-f0-9-])/,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
  /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i,
  /[?&](?:access_token|auth|authorization|code|cookie|email|key|password|secret|session|state|token)=/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})/,
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizedPathHasRequestOrResponse(path: string[]): boolean {
  return path
    .slice(0, -1)
    .map(normalizeKey)
    .some((part) => REQUEST_OR_RESPONSE_PATH_PARTS.has(part));
}

function isProtectedKey(key: string, path: string[]): boolean {
  const normalized = normalizeKey(key);
  if (PROTECTED_EXACT_KEYS.has(normalized)) return true;
  if (
    (normalized === 'data' || normalized === 'body') &&
    normalizedPathHasRequestOrResponse(path)
  ) {
    return true;
  }
  return PROTECTED_KEY_PARTS.some((part) => normalized.includes(part));
}

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function safeSquireEnv(env: Env = process.env): string {
  try {
    return resolveSquireEnv(env);
  } catch {
    return 'unknown';
  }
}

function safeString(value: string | undefined): string | undefined {
  if (!hasText(value)) return undefined;
  return value.trim();
}

export function sentryTraceSampleRateFromEnv(env: Env = process.env): number | undefined {
  const raw = safeString(env.SENTRY_TRACES_SAMPLE_RATE);
  if (!raw) return undefined;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) return undefined;
  return value;
}

function markerOr(value: string | undefined): string {
  return safeString(value) ?? TELEMETRY_UNAVAILABLE;
}

function normalizeRoute(route: string | undefined): string | undefined {
  const value = safeString(route);
  if (!value) return undefined;

  try {
    if (/^https?:\/\//i.test(value)) return new URL(value).pathname || '/';
  } catch {
    return TELEMETRY_REDACTED;
  }

  return value.split('?')[0]?.split('#')[0] || '/';
}

function truncateTag(value: string): string {
  return value.length > 200 ? `${value.slice(0, 197)}...` : value;
}

const TAG_TOKEN_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;

function safeContextTag(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!TAG_TOKEN_PATTERN.test(trimmed)) return undefined;
  return truncateTag(trimmed);
}

function contextTagPairs(input: { context?: Record<string, unknown> }): Array<[string, string]> {
  const context = input.context;
  if (!context) return [];

  const pairs: Array<[string, string | undefined]> = [
    ['surface', safeContextTag(context.surface)],
    ['failure_kind', safeContextTag(context.failureKind)],
    ['event_type', safeContextTag(context.eventType)],
    ['job_name', safeContextTag(context.scriptName)],
    ['job_kind', safeContextTag(context.scriptKind)],
    ['security_event', safeContextTag(context.event)],
  ];

  return pairs.filter((pair): pair is [string, string] => pair[1] !== undefined);
}

function redactSensitiveString(value: string): string {
  return SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value))
    ? TELEMETRY_REDACTED
    : value;
}

function redactInternal(value: unknown, seen: WeakSet<object>, path: string[]): SafeJson {
  if (value === null) return null;
  if (value === undefined) return TELEMETRY_UNAVAILABLE;
  if (typeof value === 'string') return redactSensitiveString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol' || typeof value === 'function') return TELEMETRY_UNAVAILABLE;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? TELEMETRY_UNAVAILABLE : value.toISOString();
  }
  if (value instanceof Error) {
    return {
      name: value.name || 'Error',
      message: redactSensitiveString(value.message),
    };
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => redactInternal(item, seen, [...path, String(index)]));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return TELEMETRY_UNAVAILABLE;
    seen.add(value);

    const output: { [key: string]: SafeJson } = {};
    for (const [key, child] of Object.entries(value)) {
      const childPath = [...path, key];
      output[key] = isProtectedKey(key, childPath)
        ? TELEMETRY_REDACTED
        : redactInternal(child, seen, childPath);
    }
    return output;
  }

  return TELEMETRY_UNAVAILABLE;
}

/**
 * Redact caller-provided telemetry context before it can reach Sentry.
 * Safe inputs are low-cardinality ids, route patterns, and operational flags.
 */
export function redactTelemetryValue(value: unknown): SafeJson {
  return redactInternal(value, new WeakSet(), []);
}

export type TelemetryPayloadKind = 'event' | 'breadcrumb' | 'log' | 'transaction' | 'span';

/**
 * Single Sentry privacy boundary for every payload family. New Sentry logs,
 * transactions, and spans should route through this function before leaving
 * the process.
 */
export function sanitizeTelemetryPayload(_kind: TelemetryPayloadKind, value: unknown): SafeJson {
  return redactTelemetryValue(value);
}

/**
 * Build the stable diagnostic metadata contract shared by Sentry and bug reports.
 * Missing safe fields are explicit so later ticket generation can distinguish
 * unavailable data from accidentally omitted data.
 */
export function buildDiagnosticMetadata(
  input: TelemetryDiagnosticInput = {},
  env: Env = process.env,
): TelemetryDiagnosticMetadata {
  return {
    environment: safeSquireEnv(env),
    release: markerOr(env.SENTRY_RELEASE),
    route: markerOr(normalizeRoute(input.route)),
    requestId: markerOr(input.requestId),
    conversationId: markerOr(input.conversationId),
    userMessageId: markerOr(input.userMessageId),
    assistantMessageId: markerOr(input.assistantMessageId),
    sentryTraceId: markerOr(input.sentryTraceId),
    langsmithThreadUrl: markerOr(input.langsmithThreadUrl),
    langsmithRunUrl: markerOr(input.langsmithRunUrl),
    userId: markerOr(input.user?.id),
    userHash: markerOr(input.user?.hash),
  };
}

/**
 * Build Sentry tags from the allowlist only. Do not add ad hoc caller keys here;
 * extend this function intentionally when a new diagnostic tag is approved.
 */
export function buildSafeTelemetryTags(
  input: TelemetryDiagnosticInput & { context?: Record<string, unknown> } = {},
  env: Env = process.env,
): Record<string, string> {
  const metadata = buildDiagnosticMetadata(input, env);
  const pairs: Array<[string, string]> = [
    ['environment', metadata.environment],
    ['release', metadata.release],
    ['route', metadata.route],
    ['request_id', metadata.requestId],
    ['conversation_id', metadata.conversationId],
    ['user_message_id', metadata.userMessageId],
    ['assistant_message_id', metadata.assistantMessageId],
    ['sentry_trace_id', metadata.sentryTraceId],
    ['user_id', metadata.userId],
    ['user_hash', metadata.userHash],
    ...contextTagPairs(input),
  ];

  return Object.fromEntries(
    pairs
      .filter(([, value]) => value !== TELEMETRY_UNAVAILABLE)
      .map(([key, value]) => [key, truncateTag(value)]),
  );
}

function buildSafeUser(input: TelemetryDiagnosticInput): User | undefined {
  const id = safeString(input.user?.id);
  if (id) return { id };

  const hash = safeString(input.user?.hash);
  return hash ? { id: hash } : undefined;
}

function buildSafeFeedbackTags(
  input: TelemetryFeedbackInput,
  env: Env = process.env,
): Record<string, string> {
  return {
    ...buildSafeTelemetryTags(input, env),
    feedback_kind: input.feedbackKind,
  };
}

function buildSentryContext(input: TelemetryCaptureInput, env: Env): Record<string, SafeJson> {
  return {
    diagnostic: buildDiagnosticMetadata(input, env),
    context: redactTelemetryValue(input.context ?? {}),
  };
}

function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  return sanitizeTelemetryPayload('event', event) as unknown as ErrorEvent;
}

function sanitizeSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return sanitizeTelemetryPayload('breadcrumb', breadcrumb) as unknown as Breadcrumb;
}

function sanitizeSentryLog(log: Log): Log {
  return sanitizeTelemetryPayload('log', log) as unknown as Log;
}

function sanitizeSentryTransaction<T extends SentryTransactionEvent>(
  event: T,
  _hint: EventHint,
): T {
  return sanitizeTelemetryPayload('transaction', event) as unknown as T;
}

function sanitizeSentrySpan<T extends SentrySpanPayload>(span: T): T {
  return sanitizeTelemetryPayload('span', span) as unknown as T;
}

function safeJsonRecord(value: SafeJson): Record<string, SafeJson> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return {};
}

function buildAvailableLogAttributes(
  input: TelemetryDiagnosticInput,
  env: Env,
): Record<string, SafeJson> {
  const metadata = buildDiagnosticMetadata(input, env);
  const pairs: Array<[string, string]> = [
    ['environment', metadata.environment],
    ['release', metadata.release],
    ['route', metadata.route],
    ['request_id', metadata.requestId],
    ['conversation_id', metadata.conversationId],
    ['user_message_id', metadata.userMessageId],
    ['assistant_message_id', metadata.assistantMessageId],
    ['sentry_trace_id', metadata.sentryTraceId],
    ['langsmith_thread_url', metadata.langsmithThreadUrl],
    ['langsmith_run_url', metadata.langsmithRunUrl],
    ['user_id', metadata.userId],
    ['user_hash', metadata.userHash],
  ];

  return Object.fromEntries(pairs.filter(([, value]) => value !== TELEMETRY_UNAVAILABLE));
}

function buildSentryLogAttributes(input: TelemetryLogInput, env: Env): Record<string, SafeJson> {
  const attributes = safeJsonRecord(sanitizeTelemetryPayload('log', input.attributes ?? {}));
  const context = safeJsonRecord(redactTelemetryValue(input.context ?? {}));
  const contextAttributes: Record<string, SafeJson> =
    Object.keys(context).length > 0 ? { context } : {};
  const contextTagAttributes = Object.fromEntries(contextTagPairs(input));

  return {
    ...attributes,
    ...contextAttributes,
    ...contextTagAttributes,
    ...buildAvailableLogAttributes(input, env),
  };
}

/**
 * Initialize Sentry once. Missing or invalid Sentry configuration is never
 * boot-critical; callers get a disabled result instead of an exception.
 */
export function initTelemetry(env: Env = process.env): TelemetryInitResult {
  const dsn = safeString(env.SENTRY_DSN);
  if (!dsn) return { enabled: false, reason: 'missing_dsn' };
  if (initializedDsn === dsn) return { enabled: true, reason: 'already_initialized' };

  try {
    const tracesSampleRate = sentryTraceSampleRateFromEnv(env);
    Sentry.init({
      dsn,
      environment: safeSquireEnv(env),
      release: safeString(env.SENTRY_RELEASE),
      defaultIntegrations: false,
      sendDefaultPii: false,
      dataCollection: SENTRY_SAFE_DATA_COLLECTION,
      tracesSampleRate,
      skipOpenTelemetrySetup: true,
      enableLogs: true,
      beforeSend: sanitizeSentryEvent,
      beforeBreadcrumb: sanitizeSentryBreadcrumb,
      beforeSendLog: sanitizeSentryLog,
      beforeSendTransaction: sanitizeSentryTransaction,
      beforeSendSpan: sanitizeSentrySpan,
    });
    initializedDsn = dsn;
    return { enabled: true, reason: 'initialized' };
  } catch {
    return { enabled: false, reason: 'init_failed' };
  }
}

/**
 * Report whether this process has initialized Sentry through the Squire boundary.
 * This does not inspect SDK internals and stays false for local no-DSN runs.
 */
export function isTelemetryEnabled(): boolean {
  return initializedDsn !== null;
}

export function getTelemetryClient(): ReturnType<typeof Sentry.getClient> | undefined {
  return isTelemetryEnabled() ? Sentry.getClient() : undefined;
}

/**
 * Capture an operational exception with only Squire-approved tags and redacted
 * context. Raw prompts, model output, provider payloads, and retrieved text must
 * stay in LangSmith or source systems, never in this input.
 */
export function captureTelemetryError(
  error: unknown,
  input: TelemetryCaptureInput = {},
): string | null {
  if (!isTelemetryEnabled()) return null;

  try {
    let eventId: string | null = null;
    Sentry.withScope((scope) => {
      scope.setTags(buildSafeTelemetryTags(input));
      scope.setContext('squire', buildSentryContext(input, process.env));
      const user = buildSafeUser(input);
      if (user) scope.setUser(user);
      eventId = Sentry.captureException(error);
    });
    return eventId;
  } catch {
    // Telemetry must never change app behavior.
    return null;
  }
}

/**
 * Capture a short operational message. The message must not contain user input,
 * prompt text, model output, provider payloads, or retrieved passages.
 */
export function captureTelemetryMessage(
  message: string,
  level: SeverityLevel = 'error',
  input: TelemetryCaptureInput = {},
): string | null {
  if (!isTelemetryEnabled()) return null;

  try {
    let eventId: string | null = null;
    Sentry.withScope((scope) => {
      scope.setTags(buildSafeTelemetryTags(input));
      scope.setContext('squire', buildSentryContext(input, process.env));
      const user = buildSafeUser(input);
      if (user) scope.setUser(user);
      eventId = Sentry.captureMessage(redactSensitiveString(message), level);
    });
    return eventId;
  } catch {
    // Telemetry must never change app behavior.
    return null;
  }
}

/**
 * Capture a structured operational Sentry log through the Squire boundary.
 * Messages are stable labels; caller attributes can be broad but are redacted.
 */
export function captureTelemetryLog(
  level: TelemetryLogLevel,
  message: string,
  input: TelemetryLogInput = {},
): boolean {
  if (!isTelemetryEnabled()) return false;

  try {
    Sentry.withScope((scope) => {
      scope.setTags(buildSafeTelemetryTags(input));
      scope.setContext('squire', buildSentryContext(input, process.env));
      const user = buildSafeUser(input);
      if (user) scope.setUser(user);
      Sentry.logger[level](
        redactSensitiveString(message) as Log['message'],
        buildSentryLogAttributes(input, process.env),
      );
    });
    return true;
  } catch {
    // Telemetry must never change app behavior.
    return false;
  }
}

/**
 * Capture categorical browser feedback without accepting free-form prose.
 * If an associated event id exists, Sentry links the feedback to that event.
 */
export function captureTelemetryFeedback(input: TelemetryFeedbackInput): string | null {
  if (!isTelemetryEnabled()) return null;

  try {
    let eventId: string | null = null;
    const route = buildDiagnosticMetadata(input).route;
    const tags = buildSafeFeedbackTags(input);
    Sentry.withScope((scope) => {
      scope.setTags(tags);
      scope.setContext('squire', buildSentryContext(input, process.env));
      const user = buildSafeUser(input);
      if (user) scope.setUser(user);
      eventId = Sentry.captureFeedback(
        {
          message: `Squire browser feedback: ${input.feedbackKind}`,
          source: 'squire-browser',
          associatedEventId: safeString(input.associatedEventId),
          url: route === TELEMETRY_UNAVAILABLE ? undefined : route,
          tags,
        },
        { includeReplay: true },
      );
    });
    return eventId;
  } catch {
    // Telemetry must never change app behavior.
    return null;
  }
}

/**
 * Add a breadcrumb with redacted data. Breadcrumb messages are operational
 * labels only; do not include raw request bodies, prompts, answers, or passages.
 */
export function addTelemetryBreadcrumb(input: TelemetryBreadcrumbInput): void {
  if (!isTelemetryEnabled()) return;

  try {
    Sentry.addBreadcrumb({
      category: input.category,
      message: redactSensitiveString(input.message),
      level: input.level,
      data: buildSentryContext(input, process.env),
    });
  } catch {
    // Telemetry must never change app behavior.
  }
}

/**
 * Flush pending telemetry during shutdown or script failure paths. Disabled
 * telemetry resolves false instead of throwing.
 */
export async function flushTelemetry(timeoutMs = 2000): Promise<boolean> {
  if (!isTelemetryEnabled()) return false;

  try {
    return await Sentry.flush(timeoutMs);
  } catch {
    return false;
  }
}

/**
 * Reset module-local telemetry state for isolated unit tests only.
 */
export function resetTelemetryForTests(): void {
  initializedDsn = null;
}
