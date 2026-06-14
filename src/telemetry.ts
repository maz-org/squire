import * as Sentry from '@sentry/node';
import type { Breadcrumb, ErrorEvent, SeverityLevel, User } from '@sentry/node';

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

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isProtectedKey(key: string): boolean {
  const normalized = normalizeKey(key);
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

function redactSensitiveString(value: string): string {
  if (/\bBearer\s+[A-Za-z0-9._~+/=-]+/i.test(value)) return TELEMETRY_REDACTED;
  if (/\b(?:sk|rk|pk|xox[baprs]|gh[pousr])_[A-Za-z0-9_=-]{12,}\b/.test(value)) {
    return TELEMETRY_REDACTED;
  }
  return value;
}

function redactInternal(value: unknown, seen: WeakSet<object>): SafeJson {
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
  if (Array.isArray(value)) return value.map((item) => redactInternal(item, seen));

  if (typeof value === 'object') {
    if (seen.has(value)) return TELEMETRY_UNAVAILABLE;
    seen.add(value);

    const output: { [key: string]: SafeJson } = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = isProtectedKey(key) ? TELEMETRY_REDACTED : redactInternal(child, seen);
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
  return redactInternal(value, new WeakSet());
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
  input: TelemetryDiagnosticInput = {},
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
    ['user_id', metadata.userId],
    ['user_hash', metadata.userHash],
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
  return redactTelemetryValue(event) as unknown as ErrorEvent;
}

function sanitizeSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return redactTelemetryValue(breadcrumb) as unknown as Breadcrumb;
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
    Sentry.init({
      dsn,
      environment: safeSquireEnv(env),
      release: safeString(env.SENTRY_RELEASE),
      defaultIntegrations: false,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend: sanitizeSentryEvent,
      beforeBreadcrumb: sanitizeSentryBreadcrumb,
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
