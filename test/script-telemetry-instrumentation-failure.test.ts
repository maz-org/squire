import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
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
    failInstrumentationImport: true,
    instrumentationImportAttempts: vi.fn(),
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
      startActiveSpan: mocks.mockStartActiveSpan,
    }),
  },
}));

vi.mock('../src/telemetry.ts', () => ({
  captureTelemetryError: mocks.mockCaptureTelemetryError,
  captureTelemetryLog: mocks.mockCaptureTelemetryLog,
  flushTelemetry: mocks.mockFlushTelemetry,
  initTelemetry: mocks.mockInitTelemetry,
}));

vi.mock('../src/instrumentation.ts', () => {
  mocks.instrumentationImportAttempts();
  if (mocks.failInstrumentationImport) {
    throw new Error('instrumentation module failed to load');
  }
  return { sdk: { shutdown: vi.fn() } };
});

describe('script telemetry instrumentation import failure handling', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.failInstrumentationImport = true;
    mocks.instrumentationImportAttempts.mockClear();
    mocks.mockCaptureTelemetryError.mockReset();
    mocks.mockCaptureTelemetryLog.mockReset();
    mocks.mockFlushTelemetry.mockReset();
    mocks.mockFlushTelemetry.mockResolvedValue(true);
    mocks.mockInitTelemetry.mockReset();
    mocks.mockInitTelemetry.mockReturnValue({ enabled: false, reason: 'missing_dsn' });
    mocks.mockStartActiveSpan.mockClear();
    mocks.startedSpans.length = 0;
  });

  it('does not cache a rejected instrumentation import or block script work', async () => {
    const { runScriptWithTelemetry } = await import('../src/script-telemetry.ts');

    await expect(
      runScriptWithTelemetry(async () => 'ran after import failure', {
        scriptName: 'import-failure-smoke',
        scriptKind: 'script',
      }),
    ).resolves.toBe('ran after import failure');

    expect(mocks.instrumentationImportAttempts).toHaveBeenCalledTimes(1);
    expect(mocks.mockStartActiveSpan).toHaveBeenCalledTimes(1);
    expect(mocks.mockCaptureTelemetryError).not.toHaveBeenCalled();

    mocks.failInstrumentationImport = false;

    await expect(
      runScriptWithTelemetry(async () => 'ran after retry', {
        scriptName: 'import-retry-smoke',
        scriptKind: 'script',
      }),
    ).resolves.toBe('ran after retry');

    expect(mocks.instrumentationImportAttempts).toHaveBeenCalledTimes(2);
    expect(mocks.mockStartActiveSpan).toHaveBeenCalledTimes(2);
    expect(mocks.mockCaptureTelemetryError).not.toHaveBeenCalled();
  });
});
