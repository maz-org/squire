import { resolveSquireEnv } from './squire-env.ts';
import { captureTelemetryLog } from './telemetry.ts';

type SecurityLogLevel = 'info' | 'warn' | 'error';
type SecurityLogFieldValue = string | number | boolean | null;
type SecurityLogFields = Record<string, SecurityLogFieldValue>;

interface SecurityLogBase {
  event: string;
  level?: SecurityLogLevel;
  fields?: SecurityLogFields;
}

const SAFE_ERROR_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const SAFE_ERROR_CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const SAFE_DIAGNOSTIC_TOKEN_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;

function safeSquireEnv(): string {
  try {
    return resolveSquireEnv();
  } catch {
    return 'unknown';
  }
}

function safeRouteField(value: SecurityLogFieldValue): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  let route = trimmed;
  try {
    if (/^https?:\/\//i.test(trimmed)) route = new URL(trimmed).pathname || '/';
  } catch {
    return null;
  }

  return route.split('?')[0]?.split('#')[0] || '/';
}

function safeDiagnosticToken(value: SecurityLogFieldValue): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return SAFE_DIAGNOSTIC_TOKEN_PATTERN.test(trimmed) ? trimmed : undefined;
}

function safeLangSmithUrl(value: SecurityLogFieldValue): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' || url.hostname !== 'smith.langchain.com') return undefined;
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

function safeErrorType(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const trimmed = value.trim();
  return SAFE_ERROR_TYPE_PATTERN.test(trimmed) ? trimmed : 'unknown';
}

function safeErrorCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return SAFE_ERROR_CODE_PATTERN.test(trimmed) ? trimmed : null;
}

function buildSecurityLogAttributes(input: {
  event: string;
  level: SecurityLogLevel;
  squireEnv: string;
  fields: SecurityLogFields;
}): SecurityLogFields {
  const attributes: SecurityLogFields = {};

  for (const [key, value] of Object.entries(input.fields)) {
    if (key === 'route') {
      const route = safeRouteField(value);
      if (route !== null) attributes.route = route;
      continue;
    }

    if (key === 'error_type') {
      attributes.error_type = safeErrorType(value);
      continue;
    }

    if (key === 'error_code') {
      attributes.error_code = safeErrorCode(value);
      continue;
    }

    attributes[key] = value;
  }

  return {
    ...attributes,
    event: input.event,
    level: input.level,
    squire_env: input.squireEnv,
    log_kind: 'security',
  };
}

function emitSecurityTelemetryLog(input: {
  event: string;
  level: SecurityLogLevel;
  squireEnv: string;
  fields: SecurityLogFields;
}): void {
  const route = safeRouteField(input.fields.route);
  const requestId = safeDiagnosticToken(input.fields.request_id);
  const userId = safeDiagnosticToken(input.fields.user_id);
  const userHash = safeDiagnosticToken(input.fields.user_hash);

  try {
    captureTelemetryLog(input.level, `security_log.${input.event}`, {
      route: route ?? undefined,
      requestId,
      conversationId: safeDiagnosticToken(input.fields.conversation_id),
      userMessageId: safeDiagnosticToken(input.fields.user_message_id),
      assistantMessageId: safeDiagnosticToken(input.fields.assistant_message_id),
      sentryTraceId: safeDiagnosticToken(input.fields.sentry_trace_id),
      langsmithThreadUrl: safeLangSmithUrl(input.fields.langsmith_thread_url),
      langsmithRunUrl: safeLangSmithUrl(input.fields.langsmith_run_url),
      user: userId || userHash ? { id: userId, hash: userHash } : undefined,
      context: {
        event: input.event,
        level: input.level,
        squire_env: input.squireEnv,
        surface: 'security_log',
      },
      attributes: buildSecurityLogAttributes(input),
    });
  } catch {
    // Logging must never fail because telemetry did.
  }
}

export function writeSecurityLog({ event, level = 'warn', fields = {} }: SecurityLogBase): void {
  const squireEnv = safeSquireEnv();
  console.warn(
    JSON.stringify({
      ...fields,
      ts: new Date().toISOString(),
      level,
      event,
      squire_env: squireEnv,
    }),
  );

  emitSecurityTelemetryLog({ event, level, squireEnv, fields });
}

export function errorLogFields(error: unknown): Record<string, string | null> {
  const withCode = error as { code?: unknown };
  return {
    error_type: error instanceof Error && error.name ? safeErrorType(error.name) : 'unknown',
    error_code: safeErrorCode(withCode.code),
  };
}
