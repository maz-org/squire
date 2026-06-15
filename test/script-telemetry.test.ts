import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCaptureTelemetryError,
  mockCaptureTelemetryLog,
  mockFlushTelemetry,
  mockInitTelemetry,
  mockStartActiveSpan,
  startedSpans,
} = vi.hoisted(() => {
  const startedSpans: Array<{
    name: string;
    options: { attributes?: Record<string, unknown> };
    span: {
      setAttributes: ReturnType<typeof vi.fn>;
      setStatus: ReturnType<typeof vi.fn>;
      recordException: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    };
  }> = [];

  return {
    mockCaptureTelemetryError: vi.fn(),
    mockCaptureTelemetryLog: vi.fn(),
    mockFlushTelemetry: vi.fn().mockResolvedValue(true),
    mockInitTelemetry: vi.fn(() => ({ enabled: false, reason: 'missing_dsn' })),
    startedSpans,
    mockStartActiveSpan: vi.fn(
      async (
        name: string,
        options: { attributes?: Record<string, unknown> },
        callback: (span: (typeof startedSpans)[number]['span']) => Promise<unknown>,
      ) => {
        const span = {
          setAttributes: vi.fn(),
          setStatus: vi.fn(),
          recordException: vi.fn(),
          end: vi.fn(),
        };
        startedSpans.push({ name, options, span });
        return callback(span);
      },
    ),
  };
});

vi.mock('@opentelemetry/api', () => ({
  SpanStatusCode: { ERROR: 2 },
  trace: {
    getTracer: () => ({
      startActiveSpan: mockStartActiveSpan,
    }),
  },
}));

vi.mock('../src/telemetry.ts', () => ({
  captureTelemetryError: mockCaptureTelemetryError,
  captureTelemetryLog: mockCaptureTelemetryLog,
  flushTelemetry: mockFlushTelemetry,
  initTelemetry: mockInitTelemetry,
}));

import { runScriptWithTelemetry } from '../src/script-telemetry.ts';

describe('script telemetry lifecycle wrapper', () => {
  beforeEach(() => {
    mockCaptureTelemetryError.mockReset();
    mockCaptureTelemetryLog.mockReset();
    mockFlushTelemetry.mockReset();
    mockFlushTelemetry.mockResolvedValue(true);
    mockInitTelemetry.mockReset();
    mockInitTelemetry.mockReturnValue({ enabled: false, reason: 'missing_dsn' });
    mockStartActiveSpan.mockClear();
    startedSpans.length = 0;
  });

  it('logs start and success, flushes, and captures no error events', async () => {
    const result = await runScriptWithTelemetry(async () => 'done', {
      scriptName: 'sync-security-alerts',
      scriptKind: 'script',
      requestId: 'req-script-1',
      correlationId: 'corr-1',
      flushTimeoutMs: 123,
    });

    expect(result).toBe('done');
    expect(mockInitTelemetry).toHaveBeenCalledTimes(1);
    expect(mockCaptureTelemetryLog).toHaveBeenCalledWith(
      'info',
      'script.started',
      expect.objectContaining({
        route: '/scripts/sync-security-alerts',
        requestId: 'req-script-1',
        context: expect.objectContaining({
          eventType: 'script.lifecycle',
          scriptName: 'sync-security-alerts',
          scriptKind: 'script',
          status: 'started',
          correlationId: 'corr-1',
        }),
        attributes: expect.objectContaining({
          event_type: 'script.lifecycle',
          script_name: 'sync-security-alerts',
          script_kind: 'script',
          status: 'started',
          correlation_id: 'corr-1',
        }),
      }),
    );
    expect(mockCaptureTelemetryLog).toHaveBeenCalledWith(
      'info',
      'script.completed',
      expect.objectContaining({
        route: '/scripts/sync-security-alerts',
        requestId: 'req-script-1',
        context: expect.objectContaining({
          status: 'ok',
        }),
        attributes: expect.objectContaining({
          status: 'ok',
          duration_ms: expect.any(Number),
        }),
      }),
    );
    expect(mockCaptureTelemetryError).not.toHaveBeenCalled();
    expect(mockFlushTelemetry).toHaveBeenCalledWith(123);
  });

  it('captures failures, flushes, marks the span, and rethrows the original error', async () => {
    const failure = new TypeError('database url postgres://secret:token@example.com/db failed');

    await expect(
      runScriptWithTelemetry(
        async () => {
          throw failure;
        },
        {
          scriptName: 'db-migrate',
          scriptKind: 'release_command',
          flushTimeoutMs: 456,
        },
      ),
    ).rejects.toThrow(failure);

    expect(mockCaptureTelemetryLog).toHaveBeenCalledWith(
      'error',
      'script.completed',
      expect.objectContaining({
        route: '/scripts/db-migrate',
        context: expect.objectContaining({
          scriptName: 'db-migrate',
          scriptKind: 'release_command',
          status: 'error',
          failureKind: 'script_error',
          errorName: 'TypeError',
        }),
        attributes: expect.objectContaining({
          script_name: 'db-migrate',
          script_kind: 'release_command',
          status: 'error',
          failure_kind: 'script_error',
          error_name: 'TypeError',
        }),
      }),
    );
    const capturedError = mockCaptureTelemetryError.mock.calls[0]?.[0];
    expect(capturedError).toBeInstanceOf(Error);
    expect(capturedError).toMatchObject({
      name: 'ScriptFailure:TypeError',
      message: 'Squire script failure',
    });
    expect(capturedError).not.toBe(failure);
    expect(mockCaptureTelemetryError).toHaveBeenCalledWith(capturedError, {
      route: '/scripts/db-migrate',
      requestId: undefined,
      context: {
        scriptName: 'db-migrate',
        scriptKind: 'release_command',
        failureKind: 'script_error',
        errorName: 'TypeError',
      },
    });
    expect(mockFlushTelemetry).toHaveBeenCalledWith(456);
    expect(startedSpans[0]).toEqual(
      expect.objectContaining({
        name: 'squire.script.run',
        options: {
          attributes: expect.objectContaining({
            'squire.route': '/scripts/db-migrate',
            'squire.script_name': 'db-migrate',
            'squire.script_kind': 'release_command',
            'squire.status': 'started',
          }),
        },
      }),
    );
    const span = startedSpans[0]!.span;
    expect(span.recordException).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ScriptFailure:TypeError',
        message: 'Squire script failure',
      }),
    );
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2, message: 'script_error' });
    expect(span.end).toHaveBeenCalledTimes(1);
    const telemetryCalls = JSON.stringify([
      mockCaptureTelemetryLog.mock.calls,
      mockCaptureTelemetryError.mock.calls,
    ]);
    expect(telemetryCalls).not.toContain('secret:token');
    expect(telemetryCalls).not.toContain('database url');
  });

  it('stays non-fatal when Sentry is not configured', async () => {
    mockInitTelemetry.mockReturnValueOnce({ enabled: false, reason: 'missing_dsn' });

    await expect(
      runScriptWithTelemetry(async () => 7, {
        scriptName: 'local-script',
        scriptKind: 'script',
      }),
    ).resolves.toBe(7);

    expect(mockCaptureTelemetryError).not.toHaveBeenCalled();
    expect(mockFlushTelemetry).toHaveBeenCalledWith(2_000);
  });
});
