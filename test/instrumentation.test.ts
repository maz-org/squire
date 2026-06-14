import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class MockNodeSDK {
    static instances: MockNodeSDK[] = [];
    config: Record<string, unknown>;
    start = vi.fn();

    constructor(config: Record<string, unknown>) {
      this.config = config;
      MockNodeSDK.instances.push(this);
    }
  }

  class MockLangSmithOTLPSpanProcessor {
    exporter: unknown;

    constructor(exporter: unknown) {
      this.exporter = exporter;
    }
  }

  class MockLangSmithOTLPTraceExporter {
    config: Record<string, unknown>;

    constructor(config: Record<string, unknown>) {
      this.config = config;
    }
  }

  class MockPgInstrumentation {}
  class MockSentrySpanProcessor {}
  class MockSentrySampler {
    client: unknown;

    constructor(client: unknown) {
      this.client = client;
    }
  }
  class MockSentryPropagator {}
  class MockSentryContextManager {}

  return {
    MockNodeSDK,
    MockLangSmithOTLPSpanProcessor,
    MockLangSmithOTLPTraceExporter,
    MockPgInstrumentation,
    MockSentrySpanProcessor,
    MockSentrySampler,
    MockSentryPropagator,
    MockSentryContextManager,
    initTelemetry: vi.fn(() => ({ enabled: false, reason: 'missing_dsn' })),
    getTelemetryClient: vi.fn(() => undefined as unknown),
    sentryTraceSampleRateFromEnv: vi.fn(() => undefined as number | undefined),
    langsmithOtelHeaders: vi.fn(() => ({ 'x-api-key': 'langsmith-key' })),
  };
});

vi.mock('@opentelemetry/sdk-node', () => ({ NodeSDK: mocks.MockNodeSDK }));
vi.mock('langsmith/experimental/otel/processor', () => ({
  LangSmithOTLPSpanProcessor: mocks.MockLangSmithOTLPSpanProcessor,
}));
vi.mock('langsmith/experimental/otel/exporter', () => ({
  LangSmithOTLPTraceExporter: mocks.MockLangSmithOTLPTraceExporter,
}));
vi.mock('@opentelemetry/instrumentation-pg', () => ({
  PgInstrumentation: mocks.MockPgInstrumentation,
}));
vi.mock('@sentry/opentelemetry', () => ({
  SentryPropagator: mocks.MockSentryPropagator,
  SentrySampler: mocks.MockSentrySampler,
  SentrySpanProcessor: mocks.MockSentrySpanProcessor,
}));
vi.mock('@sentry/node', () => ({
  SentryContextManager: mocks.MockSentryContextManager,
}));
vi.mock('../src/telemetry.ts', () => ({
  getTelemetryClient: mocks.getTelemetryClient,
  initTelemetry: mocks.initTelemetry,
  sentryTraceSampleRateFromEnv: mocks.sentryTraceSampleRateFromEnv,
}));
vi.mock('../src/langsmith-otel.ts', () => ({
  langsmithOtelHeaders: mocks.langsmithOtelHeaders,
}));

const ORIGINAL_ENV = {
  LANGSMITH_PROJECT: process.env.LANGSMITH_PROJECT,
  SENTRY_DSN: process.env.SENTRY_DSN,
  SENTRY_TRACES_SAMPLE_RATE: process.env.SENTRY_TRACES_SAMPLE_RATE,
  SQUIRE_ENV: process.env.SQUIRE_ENV,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function importInstrumentation() {
  await import('../src/instrumentation.ts');
  const instance = mocks.MockNodeSDK.instances[0];
  if (!instance) throw new Error('NodeSDK was not constructed');
  return instance;
}

describe('OpenTelemetry instrumentation setup', () => {
  beforeEach(() => {
    restoreEnv();
    vi.resetModules();
    vi.clearAllMocks();
    mocks.MockNodeSDK.instances = [];
    mocks.initTelemetry.mockReturnValue({ enabled: false, reason: 'missing_dsn' });
    mocks.getTelemetryClient.mockReturnValue(undefined);
    mocks.sentryTraceSampleRateFromEnv.mockReturnValue(undefined);
    mocks.langsmithOtelHeaders.mockReturnValue({ 'x-api-key': 'langsmith-key' });
  });

  afterEach(() => {
    restoreEnv();
  });

  it('starts LangSmith tracing and pg instrumentation without Sentry trace config', async () => {
    process.env.SQUIRE_ENV = 'production';
    process.env.LANGSMITH_PROJECT = 'squire-production';

    const sdk = await importInstrumentation();

    expect(mocks.initTelemetry).toHaveBeenCalledTimes(1);
    expect(sdk.start).toHaveBeenCalledTimes(1);
    expect(mocks.MockNodeSDK.instances).toHaveLength(1);
    expect(sdk.config).toMatchObject({
      spanProcessors: [expect.any(mocks.MockLangSmithOTLPSpanProcessor)],
      instrumentations: [expect.any(mocks.MockPgInstrumentation)],
    });
    expect(sdk.config).not.toHaveProperty('sampler');
    expect(sdk.config).not.toHaveProperty('textMapPropagator');
    expect(sdk.config).not.toHaveProperty('contextManager');

    const langsmithProcessor = (sdk.config.spanProcessors as unknown[])[0];
    const exporter = (langsmithProcessor as { exporter: unknown }).exporter as {
      config: { transformExportedSpan: (span: { attributes: Record<string, unknown> }) => unknown };
    };
    const span = { attributes: {} };
    expect(exporter.config.transformExportedSpan(span)).toBe(span);
    expect(span.attributes).toEqual({
      'langsmith.metadata.environment': 'production',
    });
  });

  it('configures Sentry and LangSmith span processors together exactly once', async () => {
    const sentryClient = { name: 'sentry-client' };
    mocks.initTelemetry.mockReturnValue({ enabled: true, reason: 'initialized' });
    mocks.getTelemetryClient.mockReturnValue(sentryClient);
    mocks.sentryTraceSampleRateFromEnv.mockReturnValue(0.25);

    const sdk = await importInstrumentation();

    expect(mocks.initTelemetry).toHaveBeenCalledTimes(1);
    expect(mocks.sentryTraceSampleRateFromEnv).toHaveBeenCalledTimes(1);
    expect(mocks.MockNodeSDK.instances).toHaveLength(1);
    expect(sdk.start).toHaveBeenCalledTimes(1);
    expect(sdk.config).toMatchObject({
      spanProcessors: [
        expect.any(mocks.MockLangSmithOTLPSpanProcessor),
        expect.any(mocks.MockSentrySpanProcessor),
      ],
      sampler: expect.any(mocks.MockSentrySampler),
      textMapPropagator: expect.any(mocks.MockSentryPropagator),
      contextManager: expect.any(mocks.MockSentryContextManager),
      instrumentations: [expect.any(mocks.MockPgInstrumentation)],
    });
    expect((sdk.config.sampler as { client: unknown }).client).toBe(sentryClient);
  });

  it('does not add Sentry trace components when the sample rate disables traces', async () => {
    mocks.initTelemetry.mockReturnValue({ enabled: true, reason: 'initialized' });
    mocks.getTelemetryClient.mockReturnValue({ name: 'sentry-client' });
    mocks.sentryTraceSampleRateFromEnv.mockReturnValue(0);

    const sdk = await importInstrumentation();

    expect(sdk.config).toMatchObject({
      spanProcessors: [expect.any(mocks.MockLangSmithOTLPSpanProcessor)],
    });
    expect(sdk.config).not.toHaveProperty('sampler');
    expect(sdk.config).not.toHaveProperty('textMapPropagator');
    expect(sdk.config).not.toHaveProperty('contextManager');
  });
});
