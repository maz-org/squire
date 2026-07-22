import * as Sentry from '@sentry/node';
import type { SpanAttributeValue, SpanAttributes } from '@opentelemetry/api';
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base';
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
   * Optional low-cardinality Sentry grouping key. Values are sanitized before
   * they reach Sentry; never pass raw user text here.
   */
  fingerprint?: readonly string[];
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
  'wrong_answer' | 'stream_failed' | 'ui_broken' | 'source_problem' | 'other';

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

type TelemetryReadableSpan = ReadableSpan & {
  readonly name: string;
  readonly attributes?: SpanAttributes;
  readonly events?: unknown[];
  readonly status?: unknown;
};

export type TelemetrySpanProcessor = SpanProcessor;

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

function isTelemetryRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
const SAFE_APP_OPERATION_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/;
const SAFE_DB_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const SQL_TEXT_ATTRIBUTE_KEYS = new Set([
  'dbstatement',
  'dbquerytext',
  'dbsqltext',
  'sqlstatement',
  'sqltext',
  'querytext',
]);
const ROUTE_ATTRIBUTE_KEYS = new Set(['httproute', 'route', 'squireroute']);
const SAFE_FINGERPRINT_VALUES = new Set([
  'squire-safe-test',
  'backend',
  'chat',
  'browser',
  'cron',
  'uptime',
  'deploy-regression',
  'scrub-canary',
]);

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
    ['safe_test', safeContextTag(context.safeTest)],
    ['safe_test_kind', safeContextTag(context.safeTestKind)],
    ['synthetic', safeContextTag(context.synthetic)],
  ];

  return pairs.filter((pair): pair is [string, string] => pair[1] !== undefined);
}

function buildSafeFingerprint(fingerprint: readonly string[] | undefined): string[] | undefined {
  if (!fingerprint || fingerprint.length === 0) return undefined;

  const safeFingerprint = fingerprint
    .map((value) => safeString(value))
    .filter((value): value is string => value !== undefined)
    .filter((value) => SAFE_FINGERPRINT_VALUES.has(value))
    .map((value) => truncateTag(redactSensitiveString(value)));

  return safeFingerprint.length > 0 ? safeFingerprint : undefined;
}

function redactSensitiveString(value: string): string {
  return SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value))
    ? TELEMETRY_REDACTED
    : value;
}

function sanitizedDbIdentifier(value: string | undefined): string | undefined {
  const raw = safeString(value);
  if (!raw) return undefined;

  const parts = raw
    .split('.')
    .map((part) => part.trim().replace(/^"(.+)"$/, '$1'))
    .filter(Boolean);
  if (parts.length === 0 || parts.some((part) => !SAFE_DB_IDENTIFIER_PATTERN.test(part))) {
    return undefined;
  }
  return parts.join('.');
}

function firstSqlTable(sql: string, operation: string): string | undefined {
  const patterns: Record<string, RegExp> = {
    SELECT: /\bfrom\s+("?[\w$]+"?(?:\."?[\w$]+"?)?)/i,
    INSERT: /\binsert\s+into\s+("?[\w$]+"?(?:\."?[\w$]+"?)?)/i,
    UPDATE: /\bupdate\s+("?[\w$]+"?(?:\."?[\w$]+"?)?)/i,
    DELETE: /\bdelete\s+from\s+("?[\w$]+"?(?:\."?[\w$]+"?)?)/i,
    TRUNCATE: /\btruncate(?:\s+table)?\s+("?[\w$]+"?(?:\."?[\w$]+"?)?)/i,
  };
  return sanitizedDbIdentifier(patterns[operation]?.exec(sql)?.[1]);
}

function normalizeSqlStatement(value: unknown): string {
  if (typeof value !== 'string') return TELEMETRY_REDACTED;
  const sql = safeString(value)
    ?.replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ');
  if (!sql) return TELEMETRY_UNAVAILABLE;

  const collapsed = sql.replace(/\s+/g, ' ').trim();
  const operation = /^(select|insert|update|delete|truncate|begin|commit|rollback)\b/i
    .exec(collapsed)?.[1]
    ?.toUpperCase();
  if (!operation) return TELEMETRY_REDACTED;

  const table = firstSqlTable(collapsed, operation);
  return table ? `${operation} ${table}` : operation;
}

function isSqlTextAttributeKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SQL_TEXT_ATTRIBUTE_KEYS.has(normalized);
}

function isRouteAttributeKey(key: string): boolean {
  return ROUTE_ATTRIBUTE_KEYS.has(normalizeKey(key));
}

function safeSpanRoute(value: unknown): string {
  return typeof value === 'string' ? markerOr(normalizeRoute(value)) : TELEMETRY_REDACTED;
}

function toSpanAttributeValue(value: SafeJson): SpanAttributeValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value === null) return TELEMETRY_UNAVAILABLE;
  if (Array.isArray(value)) {
    if (value.every((item): item is string => typeof item === 'string')) return value;
    if (value.every((item): item is number => typeof item === 'number')) return value;
    if (value.every((item): item is boolean => typeof item === 'boolean')) return value;
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}

function sanitizeSentrySpanAttribute(key: string, value: unknown): SpanAttributeValue {
  if (isSqlTextAttributeKey(key)) return normalizeSqlStatement(value);
  if (isRouteAttributeKey(key)) return safeSpanRoute(value);
  const redacted = redactTelemetryValue({ [key]: value });
  if (redacted && typeof redacted === 'object' && !Array.isArray(redacted)) {
    return toSpanAttributeValue(redacted[key] ?? TELEMETRY_UNAVAILABLE);
  }
  return TELEMETRY_UNAVAILABLE;
}

function sanitizeSentrySpanAttributes(attributes: SpanAttributes | undefined): SpanAttributes {
  if (!attributes) return {};
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key,
      sanitizeSentrySpanAttribute(key, value),
    ]),
  );
}

function sanitizeSentryExceptionSpanAttributes(
  attributes: SpanAttributes | undefined,
): SpanAttributes {
  if (!attributes) return {};
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => {
      const normalized = normalizeKey(key);
      if (
        normalized === 'exceptionmessage' ||
        normalized === 'exceptionstacktrace' ||
        normalized === 'exceptionstack' ||
        normalized === 'errormessage' ||
        normalized === 'errorstack'
      ) {
        return [key, TELEMETRY_REDACTED];
      }
      return [key, sanitizeSentrySpanAttribute(key, value)];
    }),
  );
}

function safeHttpRouteName(value: string): string | undefined {
  const match = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[A-Za-z0-9_./:-]*)$/i.exec(value);
  if (!match) return undefined;
  const route = match[2];
  if (!route || route.includes('?') || route.includes('#')) return undefined;
  if (redactSensitiveString(route) === TELEMETRY_REDACTED) return undefined;
  const safeSegments = route
    .split('/')
    .filter(Boolean)
    .every((segment) => /^:[A-Za-z][A-Za-z0-9_]*$/.test(segment) || /^[a-z][a-z-]*$/.test(segment));
  if (!safeSegments) return undefined;
  return `${match[1]!.toUpperCase()} ${route}`;
}

function sanitizeSentrySpanName(name: unknown): string {
  if (typeof name !== 'string') return TELEMETRY_UNAVAILABLE;
  const value = safeString(name);
  if (!value) return TELEMETRY_UNAVAILABLE;

  const normalizedSql = normalizeSqlStatement(value);
  if (normalizedSql !== TELEMETRY_REDACTED && normalizedSql !== TELEMETRY_UNAVAILABLE) {
    return `db.query.${normalizedSql.toLowerCase()}`;
  }

  if (redactSensitiveString(value) === TELEMETRY_REDACTED) return TELEMETRY_REDACTED;
  if (value.includes('?') || value.includes('#') || value.includes('=')) return TELEMETRY_REDACTED;
  if (SAFE_APP_OPERATION_PATTERN.test(value.toLowerCase())) return value;

  return safeHttpRouteName(value) ?? TELEMETRY_REDACTED;
}

function sanitizeSpanStatus(status: unknown): unknown {
  if (!isTelemetryRecord(status)) return status;
  return {
    ...status,
    ...(typeof status.message === 'string' ? { message: TELEMETRY_REDACTED } : {}),
  };
}

function sanitizeSpanEvent(event: unknown): unknown {
  if (!event || typeof event !== 'object') return redactTelemetryValue(event);
  const record = event as Record<string, unknown>;
  const eventName = typeof record.name === 'string' ? record.name : TELEMETRY_UNAVAILABLE;
  const isExceptionEvent = normalizeKey(eventName).includes('exception');
  return {
    ...record,
    name: redactSensitiveString(eventName),
    attributes: isExceptionEvent
      ? sanitizeSentryExceptionSpanAttributes(record.attributes as SpanAttributes | undefined)
      : sanitizeSentrySpanAttributes(record.attributes as SpanAttributes | undefined),
  };
}

function cloneSpanForSentry(
  span: TelemetryReadableSpan,
  clone: TelemetryReadableSpan = Object.create(
    Object.getPrototypeOf(span),
  ) as TelemetryReadableSpan,
): TelemetryReadableSpan {
  Object.defineProperties(clone, Object.getOwnPropertyDescriptors(span));
  Object.defineProperties(clone, {
    name: {
      configurable: true,
      enumerable: true,
      value: sanitizeSentrySpanName(span.name),
      writable: false,
    },
    attributes: {
      configurable: true,
      enumerable: true,
      value: sanitizeSentrySpanAttributes(span.attributes),
      writable: false,
    },
    ...(span.status !== undefined
      ? {
          status: {
            configurable: true,
            enumerable: true,
            value: sanitizeSpanStatus(span.status),
            writable: false,
          },
        }
      : {}),
    ...(Array.isArray(span.events)
      ? {
          events: {
            configurable: true,
            enumerable: true,
            value: span.events.map(sanitizeSpanEvent),
            writable: false,
          },
        }
      : {}),
  });
  return clone;
}

const SENTRY_SPAN_OVERLAY_FIELDS = ['name', 'attributes', 'status', 'events'] as const;

function withSanitizedSentrySpan<T>(span: unknown, useSpan: (span: TelemetryReadableSpan) => T): T {
  if (!span || typeof span !== 'object') {
    return useSpan(cloneSpanForSentry(span as TelemetryReadableSpan));
  }

  const target = span as TelemetryReadableSpan;
  const sanitized = cloneSpanForSentry(target);
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const overlay: PropertyDescriptorMap = {};

  for (const key of SENTRY_SPAN_OVERLAY_FIELDS) {
    originals.set(key, Object.getOwnPropertyDescriptor(target, key));
    const descriptor = Object.getOwnPropertyDescriptor(sanitized, key);
    if (descriptor) overlay[key] = descriptor;
  }

  try {
    Object.defineProperties(target, overlay);
    return useSpan(target);
  } finally {
    for (const key of SENTRY_SPAN_OVERLAY_FIELDS) {
      const original = originals.get(key);
      if (original) {
        Object.defineProperty(target, key, original);
      } else {
        delete (target as unknown as Record<string, unknown>)[key];
      }
    }
  }
}

/**
 * Produce stable low-cardinality span names for non-AI app work. User prompts,
 * URLs, and free-form prose collapse to a generic operation name.
 */
export function safeAppOperationSpanName(operation: string): string {
  const normalized = operation.trim().toLowerCase();
  if (
    normalized.length > 0 &&
    normalized.length <= 80 &&
    SAFE_APP_OPERATION_PATTERN.test(normalized) &&
    redactSensitiveString(normalized) !== TELEMETRY_REDACTED
  ) {
    return `app.${normalized}`;
  }
  return 'app.operation';
}

export function safeDatabaseSpanAttributes(sql: string | undefined): SpanAttributes {
  const normalized = normalizeSqlStatement(sql);
  if (normalized === TELEMETRY_REDACTED || normalized === TELEMETRY_UNAVAILABLE) return {};

  const [operation, table] = normalized.split(' ');
  return {
    'db.operation.name': operation,
    ...(table ? { 'db.collection.name': table } : {}),
  };
}

export function createSentrySanitizingSpanProcessor(
  delegate: TelemetrySpanProcessor,
): TelemetrySpanProcessor {
  return {
    forceFlush: () => delegate.forceFlush(),
    shutdown: () => delegate.shutdown(),
    onStart: (span, parentContext) =>
      withSanitizedSentrySpan(span, (sentrySpan) =>
        delegate.onStart(
          sentrySpan as Parameters<TelemetrySpanProcessor['onStart']>[0],
          parentContext,
        ),
      ),
    onEnding: delegate.onEnding
      ? (span) =>
          withSanitizedSentrySpan(span, (sentrySpan) =>
            delegate.onEnding?.(
              sentrySpan as Parameters<NonNullable<TelemetrySpanProcessor['onEnding']>>[0],
            ),
          )
      : undefined,
    onEnd: (span) => withSanitizedSentrySpan(span, (sentrySpan) => delegate.onEnd(sentrySpan)),
  };
}

export function sanitizeSentrySpanExportForTests(
  span: TelemetryReadableSpan,
): TelemetryReadableSpan {
  return cloneSpanForSentry(span);
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
      const fingerprint = buildSafeFingerprint(input.fingerprint);
      if (fingerprint) scope.setFingerprint(fingerprint);
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
      const fingerprint = buildSafeFingerprint(input.fingerprint);
      if (fingerprint) scope.setFingerprint(fingerprint);
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
