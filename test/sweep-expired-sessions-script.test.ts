import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDeleteExpired,
  mockShutdownServerPool,
  mockInitTelemetry,
  mockCaptureTelemetryError,
  mockFlushTelemetry,
} = vi.hoisted(() => ({
  mockDeleteExpired: vi.fn(),
  mockShutdownServerPool: vi.fn(),
  mockInitTelemetry: vi.fn(() => ({ enabled: false, reason: 'missing_dsn' })),
  mockCaptureTelemetryError: vi.fn(),
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
  flushTelemetry: mockFlushTelemetry,
}));

import { runExpiredSessionSweepCli } from '../scripts/sweep-expired-sessions.ts';

const ORIGINAL_EXIT_CODE = process.exitCode;

beforeEach(() => {
  process.exitCode = undefined;
  mockDeleteExpired.mockReset();
  mockShutdownServerPool.mockReset();
  mockInitTelemetry.mockClear();
  mockCaptureTelemetryError.mockReset();
  mockFlushTelemetry.mockReset();
  mockFlushTelemetry.mockResolvedValue(true);
});

afterEach(() => {
  process.exitCode = ORIGINAL_EXIT_CODE;
  vi.restoreAllMocks();
});

describe('expired session sweep script telemetry', () => {
  it('does not capture or flush telemetry for successful cron runs', async () => {
    mockDeleteExpired.mockResolvedValue(2);
    mockShutdownServerPool.mockResolvedValue(undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runExpiredSessionSweepCli();

    expect(log).toHaveBeenCalledWith('[session-gc] deleted 2 expired session(s)');
    expect(mockInitTelemetry).toHaveBeenCalledTimes(1);
    expect(mockCaptureTelemetryError).not.toHaveBeenCalled();
    expect(mockFlushTelemetry).not.toHaveBeenCalled();
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
    expect(mockCaptureTelemetryError).toHaveBeenCalledTimes(1);
    expect(mockCaptureTelemetryError).toHaveBeenCalledWith(failure, {
      route: '/scripts/sweep-expired-sessions',
      context: {
        scriptName: 'sweep-expired-sessions',
        scriptKind: 'cron',
      },
    });
    expect(mockFlushTelemetry).toHaveBeenCalledWith(2_000);
    expect(mockShutdownServerPool).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });
});
