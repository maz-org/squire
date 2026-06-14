import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => {
  const scope = {
    setTags: vi.fn(),
    setContext: vi.fn(),
    setUser: vi.fn(),
  };
  type Scope = {
    setTags: typeof scope.setTags;
    setContext: typeof scope.setContext;
    setUser: typeof scope.setUser;
  };

  return {
    scope,
    init: vi.fn(),
    withScope: vi.fn((callback: (scopeArg: Scope) => void) => callback(scope)),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    addBreadcrumb: vi.fn(),
    flush: vi.fn(),
  };
});

vi.mock('@sentry/node', () => sentry);

import {
  TELEMETRY_DIAGNOSTIC_FIELDS,
  TELEMETRY_REDACTED,
  TELEMETRY_UNAVAILABLE,
  addTelemetryBreadcrumb,
  buildDiagnosticMetadata,
  buildSafeTelemetryTags,
  captureTelemetryError,
  captureTelemetryMessage,
  flushTelemetry,
  initTelemetry,
  redactTelemetryValue,
  resetTelemetryForTests,
} from '../src/telemetry.ts';

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  SENTRY_DSN: process.env.SENTRY_DSN,
  SENTRY_RELEASE: process.env.SENTRY_RELEASE,
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

describe('telemetry boundary', () => {
  beforeEach(() => {
    restoreEnv();
    resetTelemetryForTests();
    vi.clearAllMocks();
    sentry.flush.mockResolvedValue(true);
  });

  afterEach(() => {
    restoreEnv();
    resetTelemetryForTests();
  });

  it('no-ops without a Sentry DSN', async () => {
    delete process.env.SENTRY_DSN;

    expect(initTelemetry(process.env)).toEqual({ enabled: false, reason: 'missing_dsn' });

    captureTelemetryError(new Error('boom'), { requestId: 'req-1' });
    captureTelemetryMessage('job failed');
    addTelemetryBreadcrumb({ category: 'auth', message: 'rate limit rejected' });

    await expect(flushTelemetry()).resolves.toBe(false);

    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.withScope).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
    expect(sentry.addBreadcrumb).not.toHaveBeenCalled();
    expect(sentry.flush).not.toHaveBeenCalled();
  });

  it('initializes Sentry once with environment, release, and redaction hooks', () => {
    process.env.SENTRY_DSN = 'https://public@example.sentry.io/123';
    process.env.SENTRY_RELEASE = 'abc123';
    process.env.SQUIRE_ENV = 'production';

    expect(initTelemetry(process.env)).toEqual({ enabled: true, reason: 'initialized' });
    expect(initTelemetry(process.env)).toEqual({ enabled: true, reason: 'already_initialized' });

    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://public@example.sentry.io/123',
        environment: 'production',
        release: 'abc123',
        defaultIntegrations: false,
        sendDefaultPii: false,
        tracesSampleRate: 0,
        beforeSend: expect.any(Function),
        beforeBreadcrumb: expect.any(Function),
      }),
    );
  });

  it('keeps the diagnostic field contract stable and explicit about unavailable fields', () => {
    process.env.SQUIRE_ENV = 'staging';
    delete process.env.SENTRY_RELEASE;

    expect(TELEMETRY_DIAGNOSTIC_FIELDS).toEqual([
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
    ]);

    const metadata = buildDiagnosticMetadata({
      route: 'https://squire.maz.org/chat/conv-1?token=secret',
      requestId: 'req-1',
      conversationId: 'conv-1',
      user: { id: 'user-1', email: 'person@example.com' },
    });

    expect(Object.keys(metadata)).toEqual(TELEMETRY_DIAGNOSTIC_FIELDS);
    expect(metadata).toEqual({
      environment: 'staging',
      release: TELEMETRY_UNAVAILABLE,
      route: '/chat/conv-1',
      requestId: 'req-1',
      conversationId: 'conv-1',
      userMessageId: TELEMETRY_UNAVAILABLE,
      assistantMessageId: TELEMETRY_UNAVAILABLE,
      langsmithThreadUrl: TELEMETRY_UNAVAILABLE,
      langsmithRunUrl: TELEMETRY_UNAVAILABLE,
      userId: 'user-1',
      userHash: TELEMETRY_UNAVAILABLE,
    });
  });

  it('builds tags from the approved allowlist only', () => {
    process.env.SQUIRE_ENV = 'production';
    process.env.SENTRY_RELEASE = 'abc123';

    expect(
      buildSafeTelemetryTags({
        route: '/chat/conv-1?historyQuery=loot',
        requestId: 'req-1',
        conversationId: 'conv-1',
        userMessageId: 'msg-user-1',
        assistantMessageId: 'msg-assistant-1',
        langsmithThreadUrl: 'https://smith.langchain.com/o/org/projects/p/threads/t',
        langsmithRunUrl: 'https://smith.langchain.com/o/org/projects/p/r/r1',
        user: {
          id: 'user-1',
          email: 'person@example.com',
        },
      }),
    ).toEqual({
      environment: 'production',
      release: 'abc123',
      route: '/chat/conv-1',
      request_id: 'req-1',
      conversation_id: 'conv-1',
      user_message_id: 'msg-user-1',
      assistant_message_id: 'msg-assistant-1',
      user_id: 'user-1',
    });
  });

  it('redacts protected fields recursively while preserving safe diagnostics', () => {
    const redacted = redactTelemetryValue({
      requestId: 'req-1',
      headers: {
        authorization: 'Bearer secret-token',
        cookie: 'session=value',
        'x-request-id': 'req-1',
      },
      oauthToken: 'oauth-secret',
      rawPrompt: 'What is my hidden prompt?',
      fullAnswer: 'Full model answer',
      providerResponse: { body: 'provider payload' },
      retrievedPassages: ['copyrighted passage'],
      sourceDocument: 'full document text',
      createdAt: new Date('2026-06-14T14:00:00.000Z'),
      invalidDate: new Date(Number.NaN),
      nested: {
        safeFlag: true,
        embedding: [0.1, 0.2],
      },
    });

    expect(redacted).toEqual({
      requestId: 'req-1',
      headers: {
        authorization: TELEMETRY_REDACTED,
        cookie: TELEMETRY_REDACTED,
        'x-request-id': 'req-1',
      },
      oauthToken: TELEMETRY_REDACTED,
      rawPrompt: TELEMETRY_REDACTED,
      fullAnswer: TELEMETRY_REDACTED,
      providerResponse: TELEMETRY_REDACTED,
      retrievedPassages: TELEMETRY_REDACTED,
      sourceDocument: TELEMETRY_REDACTED,
      createdAt: '2026-06-14T14:00:00.000Z',
      invalidDate: TELEMETRY_UNAVAILABLE,
      nested: {
        safeFlag: true,
        embedding: TELEMETRY_REDACTED,
      },
    });
  });

  it('captures errors with safe tags, redacted context, and no email identity', () => {
    process.env.SENTRY_DSN = 'https://public@example.sentry.io/123';
    process.env.SENTRY_RELEASE = 'abc123';
    process.env.SQUIRE_ENV = 'production';
    initTelemetry(process.env);

    const error = new Error('stream failed');
    captureTelemetryError(error, {
      route: '/chat/conv-1/messages/msg-1/stream?token=secret',
      requestId: 'req-1',
      conversationId: 'conv-1',
      userMessageId: 'msg-user-1',
      assistantMessageId: 'msg-assistant-1',
      langsmithRunUrl: 'https://smith.langchain.com/o/org/projects/p/r/run-1',
      user: { id: 'user-1', email: 'person@example.com' },
      context: {
        safeStatus: 500,
        answer: 'full assistant answer',
        providerRequest: { body: 'raw request' },
      },
    });

    expect(sentry.withScope).toHaveBeenCalledTimes(1);
    expect(sentry.scope.setTags).toHaveBeenCalledWith({
      environment: 'production',
      release: 'abc123',
      route: '/chat/conv-1/messages/msg-1/stream',
      request_id: 'req-1',
      conversation_id: 'conv-1',
      user_message_id: 'msg-user-1',
      assistant_message_id: 'msg-assistant-1',
      user_id: 'user-1',
    });
    expect(sentry.scope.setContext).toHaveBeenCalledWith(
      'squire',
      expect.objectContaining({
        diagnostic: expect.objectContaining({
          langsmithRunUrl: 'https://smith.langchain.com/o/org/projects/p/r/run-1',
        }),
        context: {
          safeStatus: 500,
          answer: TELEMETRY_REDACTED,
          providerRequest: TELEMETRY_REDACTED,
        },
      }),
    );
    expect(sentry.scope.setUser).toHaveBeenCalledWith({ id: 'user-1' });
    expect(sentry.captureException).toHaveBeenCalledWith(error);
  });

  it('redacts breadcrumb data and flushes when enabled', async () => {
    process.env.SENTRY_DSN = 'https://public@example.sentry.io/123';
    process.env.SQUIRE_ENV = 'production';
    initTelemetry(process.env);

    addTelemetryBreadcrumb({
      category: 'auth',
      message: 'Bearer secret-token',
      level: 'warning',
      requestId: 'req-1',
      context: {
        cookie: 'session=value',
        safeReason: 'rate_limited',
      },
    });

    expect(sentry.addBreadcrumb).toHaveBeenCalledWith({
      category: 'auth',
      message: TELEMETRY_REDACTED,
      level: 'warning',
      data: expect.objectContaining({
        context: {
          cookie: TELEMETRY_REDACTED,
          safeReason: 'rate_limited',
        },
      }),
    });
    await expect(flushTelemetry(100)).resolves.toBe(true);
    expect(sentry.flush).toHaveBeenCalledWith(100);
  });
});
