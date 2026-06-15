import { SpanStatusCode, trace, type Attributes, type Span } from '@opentelemetry/api';

import {
  captureTelemetryError,
  captureTelemetryLog,
  flushTelemetry,
  initTelemetry,
} from './telemetry.ts';

export type ScriptTelemetryKind = 'cron' | 'release_command' | 'manual_migration' | 'script';

interface ScriptTelemetryOptions {
  scriptName: string;
  scriptKind: ScriptTelemetryKind;
  route?: string;
  requestId?: string;
  correlationId?: string;
  flushTimeoutMs?: number;
}

type ScriptTelemetryStatus = 'started' | 'ok' | 'error';

const scriptTracer = trace.getTracer('squire.script');

function scriptRoute(options: ScriptTelemetryOptions): string {
  return options.route ?? `/scripts/${options.scriptName}`;
}

function safeErrorName(error: unknown): string {
  if (!(error instanceof Error)) return 'Error';
  const name = error.name.trim();
  return /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(name) ? name : 'Error';
}

function safeScriptFailureError(error: unknown): Error {
  const safe = new Error('Squire script failure');
  safe.name = `ScriptFailure:${safeErrorName(error)}`;
  return safe;
}

function scriptAttributes(input: {
  options: ScriptTelemetryOptions;
  status: ScriptTelemetryStatus;
  durationMs?: number;
  error?: unknown;
}): Record<string, string | number> {
  return {
    event_type: 'script.lifecycle',
    script_name: input.options.scriptName,
    script_kind: input.options.scriptKind,
    status: input.status,
    ...(input.durationMs === undefined ? {} : { duration_ms: input.durationMs }),
    ...(input.options.correlationId ? { correlation_id: input.options.correlationId } : {}),
    ...(input.error
      ? { failure_kind: 'script_error', error_name: safeErrorName(input.error) }
      : {}),
  };
}

function scriptContext(input: {
  options: ScriptTelemetryOptions;
  status: ScriptTelemetryStatus;
  error?: unknown;
}) {
  return {
    eventType: 'script.lifecycle',
    scriptName: input.options.scriptName,
    scriptKind: input.options.scriptKind,
    status: input.status,
    ...(input.options.correlationId ? { correlationId: input.options.correlationId } : {}),
    ...(input.error ? { failureKind: 'script_error', errorName: safeErrorName(input.error) } : {}),
  };
}

function spanAttributes(input: {
  options: ScriptTelemetryOptions;
  status?: ScriptTelemetryStatus;
  durationMs?: number;
  error?: unknown;
}): Attributes {
  return {
    'squire.route': scriptRoute(input.options),
    'squire.script_name': input.options.scriptName,
    'squire.script_kind': input.options.scriptKind,
    ...(input.options.requestId ? { 'squire.request_id': input.options.requestId } : {}),
    ...(input.options.correlationId
      ? { 'squire.correlation_id': input.options.correlationId }
      : {}),
    ...(input.status ? { 'squire.status': input.status } : {}),
    ...(input.durationMs === undefined ? {} : { 'squire.duration_ms': input.durationMs }),
    ...(input.error ? { 'squire.failure_kind': 'script_error' } : {}),
  };
}

function recordScriptLifecycle(
  event: 'started' | 'completed',
  input: {
    options: ScriptTelemetryOptions;
    status: ScriptTelemetryStatus;
    durationMs?: number;
    error?: unknown;
  },
): void {
  captureTelemetryLog(input.status === 'error' ? 'error' : 'info', `script.${event}`, {
    route: scriptRoute(input.options),
    requestId: input.options.requestId,
    context: scriptContext(input),
    attributes: scriptAttributes(input),
  });
}

function finishScriptSpan(
  span: Span,
  input: {
    options: ScriptTelemetryOptions;
    status: ScriptTelemetryStatus;
    durationMs: number;
    error?: unknown;
  },
): void {
  span.setAttributes(spanAttributes(input));
  if (input.error) {
    span.recordException(safeScriptFailureError(input.error));
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'script_error' });
  }
  span.end();
}

/**
 * Initialize Sentry for non-Hono entrypoints, log lifecycle records, capture
 * failures only, and flush before short-lived processes exit.
 */
export async function runScriptWithTelemetry<T>(
  operation: () => Promise<T>,
  options: ScriptTelemetryOptions,
): Promise<T> {
  initTelemetry();

  return scriptTracer.startActiveSpan(
    'squire.script.run',
    { attributes: spanAttributes({ options, status: 'started' }) },
    async (span) => {
      const startedAt = Date.now();
      recordScriptLifecycle('started', { options, status: 'started' });
      try {
        const result = await operation();
        const durationMs = Date.now() - startedAt;
        recordScriptLifecycle('completed', { options, status: 'ok', durationMs });
        finishScriptSpan(span, { options, status: 'ok', durationMs });
        await flushTelemetry(options.flushTimeoutMs ?? 2_000);
        return result;
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        recordScriptLifecycle('completed', {
          options,
          status: 'error',
          durationMs,
          error,
        });
        finishScriptSpan(span, { options, status: 'error', durationMs, error });
        captureTelemetryError(safeScriptFailureError(error), {
          route: scriptRoute(options),
          requestId: options.requestId,
          context: {
            scriptName: options.scriptName,
            scriptKind: options.scriptKind,
            failureKind: 'script_error',
            errorName: safeErrorName(error),
            ...(options.correlationId ? { correlationId: options.correlationId } : {}),
          },
        });
        await flushTelemetry(options.flushTimeoutMs ?? 2_000);
        throw error;
      }
    },
  );
}
