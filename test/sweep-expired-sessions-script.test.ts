import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDeleteExpired,
  mockShutdownServerPool,
  mockInitTelemetry,
  mockCaptureTelemetryError,
  mockCaptureTelemetryLog,
  mockFlushTelemetry,
} = vi.hoisted(() => ({
  mockDeleteExpired: vi.fn(),
  mockShutdownServerPool: vi.fn(),
  mockInitTelemetry: vi.fn(() => ({ enabled: false, reason: 'missing_dsn' })),
  mockCaptureTelemetryError: vi.fn(),
  mockCaptureTelemetryLog: vi.fn(),
  mockFlushTelemetry: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/db.ts', () => ({
  shutdownServerPool: mockShutdownServerPool,
}));

vi.mock('../src/db/repositories/session-repository.ts', () => ({
  deleteExpired: mockDeleteExpired,
}));

vi.mock('../src/telemetry.ts', () => ({
  initTelemetry: mockInitTelemetry,
  captureTelemetryError: mockCaptureTelemetryError,
  captureTelemetryLog: mockCaptureTelemetryLog,
  flushTelemetry: mockFlushTelemetry,
}));

vi.mock('../src/instrumentation.ts', () => ({
  sdk: { shutdown: vi.fn() },
}));

import { runExpiredSessionSweepCli } from '../scripts/sweep-expired-sessions.ts';

const ORIGINAL_EXIT_CODE = process.exitCode;

beforeEach(() => {
  process.exitCode = undefined;
  mockDeleteExpired.mockReset();
  mockShutdownServerPool.mockReset();
  mockInitTelemetry.mockClear();
  mockCaptureTelemetryError.mockReset();
  mockCaptureTelemetryLog.mockReset();
  mockFlushTelemetry.mockReset();
  mockFlushTelemetry.mockResolvedValue(true);
});

afterEach(() => {
  process.exitCode = ORIGINAL_EXIT_CODE;
  vi.restoreAllMocks();
});

describe('expired session sweep script telemetry', () => {
  it('logs, flushes, and does not capture errors for successful cron runs', async () => {
    mockDeleteExpired.mockResolvedValue(2);
    mockShutdownServerPool.mockResolvedValue(undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runExpiredSessionSweepCli();

    expect(log).toHaveBeenCalledWith('[session-gc] deleted 2 expired session(s)');
    expect(mockInitTelemetry).toHaveBeenCalledTimes(1);
    expect(mockCaptureTelemetryLog).toHaveBeenCalledWith(
      'info',
      'script.started',
      expect.objectContaining({
        route: '/scripts/sweep-expired-sessions',
        context: expect.objectContaining({
          eventType: 'script.lifecycle',
          scriptName: 'sweep-expired-sessions',
          scriptKind: 'cron',
          status: 'started',
        }),
        attributes: expect.objectContaining({
          event_type: 'script.lifecycle',
          script_name: 'sweep-expired-sessions',
          script_kind: 'cron',
          status: 'started',
        }),
      }),
    );
    expect(mockCaptureTelemetryLog).toHaveBeenCalledWith(
      'info',
      'script.completed',
      expect.objectContaining({
        route: '/scripts/sweep-expired-sessions',
        context: expect.objectContaining({
          eventType: 'script.lifecycle',
          scriptName: 'sweep-expired-sessions',
          scriptKind: 'cron',
          status: 'ok',
        }),
        attributes: expect.objectContaining({
          event_type: 'script.lifecycle',
          script_name: 'sweep-expired-sessions',
          script_kind: 'cron',
          status: 'ok',
          duration_ms: expect.any(Number),
        }),
      }),
    );
    expect(mockCaptureTelemetryError).not.toHaveBeenCalled();
    expect(mockFlushTelemetry).toHaveBeenCalledWith(2_000);
    expect(mockShutdownServerPool).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });

  it('captures, flushes, and preserves nonzero exit behavior for failing cron runs', async () => {
    const failure = new Error('database unavailable');
    mockDeleteExpired.mockRejectedValue(failure);
    mockShutdownServerPool.mockResolvedValue(undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runExpiredSessionSweepCli();

    expect(error).toHaveBeenCalledWith('[session-gc] failed to delete expired sessions:', failure);
    expect(mockCaptureTelemetryLog).toHaveBeenCalledWith(
      'error',
      'script.completed',
      expect.objectContaining({
        route: '/scripts/sweep-expired-sessions',
        context: expect.objectContaining({
          eventType: 'script.lifecycle',
          scriptName: 'sweep-expired-sessions',
          scriptKind: 'cron',
          status: 'error',
          failureKind: 'script_error',
          errorName: 'Error',
        }),
        attributes: expect.objectContaining({
          event_type: 'script.lifecycle',
          script_name: 'sweep-expired-sessions',
          script_kind: 'cron',
          status: 'error',
          failure_kind: 'script_error',
          error_name: 'Error',
          duration_ms: expect.any(Number),
        }),
      }),
    );
    expect(mockCaptureTelemetryError).toHaveBeenCalledTimes(1);
    const capturedError = mockCaptureTelemetryError.mock.calls[0]?.[0];
    expect(capturedError).toBeInstanceOf(Error);
    expect(capturedError).toMatchObject({
      name: 'ScriptFailure:Error',
      message: 'Squire script failure',
    });
    expect(capturedError).not.toBe(failure);
    expect(mockCaptureTelemetryError).toHaveBeenCalledWith(capturedError, {
      route: '/scripts/sweep-expired-sessions',
      context: {
        scriptName: 'sweep-expired-sessions',
        scriptKind: 'cron',
        failureKind: 'script_error',
        errorName: 'Error',
      },
    });
    expect(mockFlushTelemetry).toHaveBeenCalledWith(2_000);
    expect(mockShutdownServerPool).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });
});
