import type { SeverityLevel } from '@sentry/node';

import { resolveSquireEnv } from './squire-env.ts';
import { addTelemetryBreadcrumb, captureTelemetryMessage } from './telemetry.ts';

type SecurityLogLevel = 'info' | 'warn' | 'error';
type SecurityLogFieldValue = string | number | boolean | null;
type SecurityLogFields = Record<string, SecurityLogFieldValue>;
type SecurityTelemetryMode = 'breadcrumb' | 'message';

interface SecurityLogBase {
  event: string;
  level?: SecurityLogLevel;
  fields?: SecurityLogFields;
}

const SECURITY_TELEMETRY_EVENTS = {
  campaign_client_token_rejected: 'breadcrumb',
  llm_budget_warning: 'breadcrumb',
  rate_limit_rejected: 'breadcrumb',
  llm_budget_accounting_failed: 'message',
  rate_limit_redis_error: 'message',
  rate_limit_unavailable: 'message',
} as const satisfies Record<string, SecurityTelemetryMode>;

const SECURITY_TELEMETRY_FIELD_KEYS = new Set<string>([
  'budget_day',
  'budget_usd_micros',
  'client_id',
  'error_code',
  'error_type',
  'has_user_id',
  'identity_hash',
  'identity_kind',
  'limit',
  'method',
  'model',
  'policy',
  'reset_after_seconds',
  'retry_after_seconds',
  'route',
  'spent_usd_micros',
  'threshold_percent',
  'window_ms',
]);

const SAFE_ERROR_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const SAFE_ERROR_CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

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

function toTelemetryLevel(level: SecurityLogLevel): SeverityLevel {
  return level === 'warn' ? 'warning' : level;
}

function safeSecurityTelemetryFields(fields: SecurityLogFields): SecurityLogFields {
  const safeFields: SecurityLogFields = {};

  for (const [key, value] of Object.entries(fields)) {
    if (!SECURITY_TELEMETRY_FIELD_KEYS.has(key)) continue;

    if (key === 'route') {
      const route = safeRouteField(value);
      if (route !== null) safeFields.route = route;
      continue;
    }

    if (key === 'error_type') {
      safeFields.error_type = safeErrorType(value);
      continue;
    }

    if (key === 'error_code') {
      safeFields.error_code = safeErrorCode(value);
      continue;
    }

    safeFields[key] = value;
  }

  return safeFields;
}

function emitSecurityTelemetry(input: {
  event: string;
  level: SecurityLogLevel;
  squireEnv: string;
  fields: SecurityLogFields;
}): void {
  const mode = SECURITY_TELEMETRY_EVENTS[input.event as keyof typeof SECURITY_TELEMETRY_EVENTS];
  if (!mode) return;

  const fields = safeSecurityTelemetryFields(input.fields);
  const route = typeof fields.route === 'string' ? fields.route : undefined;
  const telemetryInput = {
    route,
    context: {
      event: input.event,
      level: input.level,
      squire_env: input.squireEnv,
      fields,
    },
  };

  try {
    if (mode === 'breadcrumb') {
      addTelemetryBreadcrumb({
        category: 'security_log',
        message: input.event,
        level: toTelemetryLevel(input.level),
        ...telemetryInput,
      });
      return;
    }

    captureTelemetryMessage(
      `security_log.${input.event}`,
      toTelemetryLevel(input.level),
      telemetryInput,
    );
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

  emitSecurityTelemetry({ event, level, squireEnv, fields });
}

export function errorLogFields(error: unknown): Record<string, string | null> {
  const withCode = error as { code?: unknown };
  return {
    error_type: error instanceof Error && error.name ? safeErrorType(error.name) : 'unknown',
    error_code: safeErrorCode(withCode.code),
  };
}
