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
    captureFeedback: vi.fn(),
    captureMessage: vi.fn(),
    logger: {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    },
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
  captureTelemetryFeedback,
  captureTelemetryLog,
  captureTelemetryMessage,
  flushTelemetry,
  initTelemetry,
  redactTelemetryValue,
  resetTelemetryForTests,
  sanitizeTelemetryPayload,
  sentryTraceSampleRateFromEnv,
} from '../src/telemetry.ts';

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  SENTRY_DSN: process.env.SENTRY_DSN,
  SENTRY_RELEASE: process.env.SENTRY_RELEASE,
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
    captureTelemetryLog('info', 'job completed', { requestId: 'req-1' });
    addTelemetryBreadcrumb({ category: 'auth', message: 'rate limit rejected' });
    captureTelemetryFeedback({ feedbackKind: 'ui_broken' });

    await expect(flushTelemetry()).resolves.toBe(false);

    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.withScope).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.captureFeedback).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
    expect(sentry.logger.info).not.toHaveBeenCalled();
    expect(sentry.addBreadcrumb).not.toHaveBeenCalled();
    expect(sentry.flush).not.toHaveBeenCalled();
  });

  it('initializes Sentry once with environment, release, and redaction hooks', () => {
    process.env.SENTRY_DSN = 'https://public@example.sentry.io/123';
    process.env.SENTRY_RELEASE = 'abc123';
    process.env.SQUIRE_ENV = 'production';
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0.25';

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
        tracesSampleRate: 0.25,
        skipOpenTelemetrySetup: true,
        enableLogs: true,
        dataCollection: {
          userInfo: false,
          cookies: false,
          httpHeaders: { request: false, response: false },
          httpBodies: [],
          queryParams: false,
          genAI: { inputs: false, outputs: false },
          stackFrameVariables: false,
          frameContextLines: 0,
        },
        beforeSend: expect.any(Function),
        beforeBreadcrumb: expect.any(Function),
        beforeSendLog: expect.any(Function),
        beforeSendTransaction: expect.any(Function),
        beforeSendSpan: expect.any(Function),
      }),
    );
  });

  it('parses Sentry trace sampling from environment only when valid', () => {
    expect(sentryTraceSampleRateFromEnv({ SENTRY_TRACES_SAMPLE_RATE: undefined })).toBeUndefined();
    expect(sentryTraceSampleRateFromEnv({ SENTRY_TRACES_SAMPLE_RATE: '0' })).toBe(0);
    expect(sentryTraceSampleRateFromEnv({ SENTRY_TRACES_SAMPLE_RATE: '0.5' })).toBe(0.5);
    expect(sentryTraceSampleRateFromEnv({ SENTRY_TRACES_SAMPLE_RATE: '1' })).toBe(1);
    expect(sentryTraceSampleRateFromEnv({ SENTRY_TRACES_SAMPLE_RATE: '-0.1' })).toBeUndefined();
    expect(sentryTraceSampleRateFromEnv({ SENTRY_TRACES_SAMPLE_RATE: '1.1' })).toBeUndefined();
    expect(
      sentryTraceSampleRateFromEnv({ SENTRY_TRACES_SAMPLE_RATE: 'not-a-number' }),
    ).toBeUndefined();
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
      'sentryTraceId',
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
      sentryTraceId: TELEMETRY_UNAVAILABLE,
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
        sentryTraceId: '0123456789abcdef0123456789abcdef',
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
      sentry_trace_id: '0123456789abcdef0123456789abcdef',
      user_id: 'user-1',
    });
  });

  it('adds safe low-cardinality context tags for alert filters only', () => {
    process.env.SQUIRE_ENV = 'production';
    process.env.SENTRY_RELEASE = 'abc123';

    expect(
      buildSafeTelemetryTags({
        route: '/chat/conv-1/messages/msg-1/stream',
        context: {
          surface: 'chat_sse',
          failureKind: 'assistant_turn',
          eventType: 'browser_error',
          scriptName: 'sweep-expired-sessions',
          scriptKind: 'cron',
          event: 'rate_limit_rejected',
          unsafe: 'Bearer secret-token',
          rawPrompt: 'What is my hidden prompt?',
        },
      }),
    ).toEqual({
      environment: 'production',
      release: 'abc123',
      route: '/chat/conv-1/messages/msg-1/stream',
      surface: 'chat_sse',
      failure_kind: 'assistant_turn',
      event_type: 'browser_error',
      job_name: 'sweep-expired-sessions',
      job_kind: 'cron',
      security_event: 'rate_limit_rejected',
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

  it('redacts structured PII keys and sensitive value patterns without dropping safe ids', () => {
    const redacted = redactTelemetryValue({
      request_id: 'req-1',
      sentry_trace_id: '0123456789abcdef0123456789abcdef',
      conversation_id: 'conv-1',
      conversationUuid: '11111111-1111-4111-8111-111111111111',
      customerName: 'Alice Example',
      first_name: 'Alice',
      lastName: 'Example',
      display_name: 'Alice E.',
      user_email: 'alice@example.com',
      phoneNumber: '+1 415 555 1212',
      mailingAddress: '1 Market St, San Francisco, CA',
      ipAddress: '203.0.113.10',
      card: '4111 1111 1111 1111',
      ssn: '123-45-6789',
      callbackUrl: 'https://alice:secret@example.com/callback',
      pem: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
      safeCount: 3,
    });

    expect(redacted).toEqual({
      request_id: 'req-1',
      sentry_trace_id: '0123456789abcdef0123456789abcdef',
      conversation_id: 'conv-1',
      conversationUuid: '11111111-1111-4111-8111-111111111111',
      customerName: TELEMETRY_REDACTED,
      first_name: TELEMETRY_REDACTED,
      lastName: TELEMETRY_REDACTED,
      display_name: TELEMETRY_REDACTED,
      user_email: TELEMETRY_REDACTED,
      phoneNumber: TELEMETRY_REDACTED,
      mailingAddress: TELEMETRY_REDACTED,
      ipAddress: TELEMETRY_REDACTED,
      card: TELEMETRY_REDACTED,
      ssn: TELEMETRY_REDACTED,
      callbackUrl: TELEMETRY_REDACTED,
      pem: TELEMETRY_REDACTED,
      safeCount: 3,
    });
  });

  it('handles circular telemetry structures without throwing', () => {
    const payload: Record<string, unknown> = { requestId: 'req-1' };
    payload.self = payload;

    expect(redactTelemetryValue(payload)).toEqual({
      requestId: 'req-1',
      self: TELEMETRY_UNAVAILABLE,
    });
  });

  it('sanitizes future log, transaction, and span payloads with the same boundary', () => {
    expect(
      sanitizeTelemetryPayload('log', {
        message: 'user alice@example.com submitted feedback',
        attributes: {
          request_id: 'req-1',
          userMessageId: 'msg-user-1',
          rawFeedback: 'my transcript should stay out',
        },
      }),
    ).toEqual({
      message: TELEMETRY_REDACTED,
      attributes: {
        request_id: 'req-1',
        userMessageId: 'msg-user-1',
        rawFeedback: TELEMETRY_REDACTED,
      },
    });

    expect(
      sanitizeTelemetryPayload('transaction', {
        transaction: '/chat/conv-1?token=secret',
        request: {
          headers: { cookie: 'session=value' },
          data: { prompt: 'raw prompt' },
        },
      }),
    ).toEqual({
      transaction: TELEMETRY_REDACTED,
      request: {
        headers: { cookie: TELEMETRY_REDACTED },
        data: TELEMETRY_REDACTED,
      },
    });

    expect(
      sanitizeTelemetryPayload('span', {
        description: "select * from users where email = 'alice@example.com'",
        data: {
          request_id: 'req-1',
          retrieved_passages: ['rule text'],
        },
      }),
    ).toEqual({
      description: TELEMETRY_REDACTED,
      data: {
        request_id: 'req-1',
        retrieved_passages: TELEMETRY_REDACTED,
      },
    });
  });

  it('redacts Sentry logs with the shared beforeSendLog boundary', () => {
    process.env.SENTRY_DSN = 'https://public@example.sentry.io/123';
    process.env.SENTRY_RELEASE = 'abc123';
    process.env.SQUIRE_ENV = 'production';
    initTelemetry(process.env);

    const initOptions = sentry.init.mock.calls[0]?.[0];
    const sanitized = initOptions.beforeSendLog({
      level: 'info',
      message: 'browser error from alice@example.com',
      attributes: {
        request_id: 'req-1',
        route: '/chat/conv-1',
        rawPrompt: 'raw prompt',
        modelOutput: 'full answer',
        retrievedPassages: ['source passage'],
        request: {
          body: { prompt: 'hidden prompt' },
        },
        user: {
          id: 'user-1',
          email: 'alice@example.com',
        },
      },
    });

    expect(sanitized).toEqual({
      level: 'info',
      message: TELEMETRY_REDACTED,
      attributes: {
        request_id: 'req-1',
        route: '/chat/conv-1',
        rawPrompt: TELEMETRY_REDACTED,
        modelOutput: TELEMETRY_REDACTED,
        retrievedPassages: TELEMETRY_REDACTED,
        request: {
          body: TELEMETRY_REDACTED,
        },
        user: {
          id: 'user-1',
          email: TELEMETRY_REDACTED,
        },
      },
    });
  });

  it('redacts Sentry app trace payloads before transactions and spans are sent', () => {
    process.env.SENTRY_DSN = 'https://public@example.sentry.io/123';
    process.env.SENTRY_TRACES_SAMPLE_RATE = '1';
    process.env.SQUIRE_ENV = 'production';
    initTelemetry(process.env);

    const initOptions = sentry.init.mock.calls[0]?.[0];
    const sanitizedSpan = initOptions.beforeSendSpan({
      trace_id: '0123456789abcdef0123456789abcdef',
      span_id: '0123456789abcdef',
      start_timestamp: 1,
      data: {
        'squire.request_id': 'req-1',
        'squire.conversation_id': 'conv-1',
        'langsmith.metadata.thread_id': 'conv-1',
        'gen_ai.prompt': 'raw prompt',
        'gen_ai.completion': 'full model answer',
        providerPayload: { body: 'raw provider payload' },
        retrievedPassages: ['source passage'],
        transcript: 'raw transcript',
      },
      description: 'squire.agent.run',
    });
    const sanitizedTransaction = initOptions.beforeSendTransaction(
      {
        type: 'transaction',
        transaction: '/chat/conv-1',
        contexts: {
          trace: {
            trace_id: '0123456789abcdef0123456789abcdef',
            span_id: '0123456789abcdef',
          },
        },
        request: {
          data: { prompt: 'hidden prompt' },
          headers: { authorization: 'Bearer secret-token' },
        },
        spans: [
          {
            data: {
              'squire.request_id': 'req-1',
              'gen_ai.prompt': 'raw prompt',
              modelOutput: 'raw model output',
            },
          },
        ],
      },
      {},
    );

    expect(sanitizedSpan).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          'squire.request_id': 'req-1',
          'squire.conversation_id': 'conv-1',
          'langsmith.metadata.thread_id': 'conv-1',
          'gen_ai.prompt': TELEMETRY_REDACTED,
          'gen_ai.completion': TELEMETRY_REDACTED,
          providerPayload: TELEMETRY_REDACTED,
          retrievedPassages: TELEMETRY_REDACTED,
          transcript: TELEMETRY_REDACTED,
        }),
      }),
    );
    expect(sanitizedTransaction).toEqual(
      expect.objectContaining({
        transaction: '/chat/conv-1',
        request: {
          data: TELEMETRY_REDACTED,
          headers: { authorization: TELEMETRY_REDACTED },
        },
        spans: [
          {
            data: {
              'squire.request_id': 'req-1',
              'gen_ai.prompt': TELEMETRY_REDACTED,
              modelOutput: TELEMETRY_REDACTED,
            },
          },
        ],
      }),
    );
  });

  it('captures Sentry logs with stable safe attributes and arbitrary sanitized attributes', () => {
    process.env.SENTRY_DSN = 'https://public@example.sentry.io/123';
    process.env.SENTRY_RELEASE = 'abc123';
    process.env.SQUIRE_ENV = 'production';
    initTelemetry(process.env);

    expect(
      captureTelemetryLog('info', 'chat stream completed', {
        route: '/chat/conv-1/messages/msg-1/stream?token=secret',
        requestId: 'req-1',
        conversationId: 'conv-1',
        userMessageId: 'msg-user-1',
        assistantMessageId: 'msg-assistant-1',
        sentryTraceId: '0123456789abcdef0123456789abcdef',
        langsmithThreadUrl: 'https://smith.langchain.com/o/org/projects/p/threads/thread-1',
        langsmithRunUrl: 'https://smith.langchain.com/o/org/projects/p/r/run-1',
        user: { hash: 'user-hash-1', email: 'person@example.com' },
        context: {
          surface: 'chat_sse',
          failureKind: 'assistant_turn',
          providerPayload: { body: 'raw provider payload' },
        },
        attributes: {
          duration_ms: 123,
          retry_count: 2,
          nested: { safe_flag: true },
          emailAddress: 'alice@example.com',
          rawPrompt: 'raw prompt',
          request: {
            body: { prompt: 'hidden prompt' },
          },
        },
      }),
    ).toBe(true);

    expect(sentry.scope.setTags).toHaveBeenCalledWith({
      environment: 'production',
      release: 'abc123',
      route: '/chat/conv-1/messages/msg-1/stream',
      request_id: 'req-1',
      conversation_id: 'conv-1',
      user_message_id: 'msg-user-1',
      assistant_message_id: 'msg-assistant-1',
      sentry_trace_id: '0123456789abcdef0123456789abcdef',
      user_hash: 'user-hash-1',
      surface: 'chat_sse',
      failure_kind: 'assistant_turn',
    });
    expect(sentry.scope.setContext).toHaveBeenCalledWith(
      'squire',
      expect.objectContaining({
        context: {
          surface: 'chat_sse',
          failureKind: 'assistant_turn',
          providerPayload: TELEMETRY_REDACTED,
        },
      }),
    );
    expect(sentry.scope.setUser).toHaveBeenCalledWith({ id: 'user-hash-1' });
    expect(sentry.logger.info).toHaveBeenCalledWith('chat stream completed', {
      duration_ms: 123,
      retry_count: 2,
      nested: { safe_flag: true },
      emailAddress: TELEMETRY_REDACTED,
      rawPrompt: TELEMETRY_REDACTED,
      request: {
        body: TELEMETRY_REDACTED,
      },
      context: {
        surface: 'chat_sse',
        failureKind: 'assistant_turn',
        providerPayload: TELEMETRY_REDACTED,
      },
      surface: 'chat_sse',
      failure_kind: 'assistant_turn',
      environment: 'production',
      release: 'abc123',
      route: '/chat/conv-1/messages/msg-1/stream',
      request_id: 'req-1',
      conversation_id: 'conv-1',
      user_message_id: 'msg-user-1',
      assistant_message_id: 'msg-assistant-1',
      sentry_trace_id: '0123456789abcdef0123456789abcdef',
      langsmith_thread_url: 'https://smith.langchain.com/o/org/projects/p/threads/thread-1',
      langsmith_run_url: 'https://smith.langchain.com/o/org/projects/p/r/run-1',
      user_hash: 'user-hash-1',
    });
  });

  it('supports every Sentry log level through the telemetry boundary', () => {
    process.env.SENTRY_DSN = 'https://public@example.sentry.io/123';
    process.env.SQUIRE_ENV = 'production';
    initTelemetry(process.env);

    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
      expect(captureTelemetryLog(level, `${level} operational event`)).toBe(true);
      expect(sentry.logger[level]).toHaveBeenCalledWith(`${level} operational event`, {
        environment: 'production',
      });
    }
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

  it('captures categorical user feedback linked to the browser event without free text', () => {
    process.env.SENTRY_DSN = 'https://public@example.sentry.io/123';
    process.env.SENTRY_RELEASE = 'abc123';
    process.env.SQUIRE_ENV = 'production';
    sentry.captureFeedback.mockReturnValue('feedback-event-1');
    initTelemetry(process.env);

    const eventId = captureTelemetryFeedback({
      feedbackKind: 'stream_failed',
      associatedEventId: '0123456789abcdef0123456789abcdef',
      route: '/chat/conv-1?token=secret',
      requestId: 'req-1',
      conversationId: 'conv-1',
      userMessageId: 'msg-user-1',
      user: { id: 'user-1', email: 'person@example.com' },
      context: {
        surface: 'browser',
        rawFeedback: 'my prompt and answer should stay out',
        maskedReplay: {
          textMasked: true,
          turns: { assistantTurnCount: 1 },
        },
      },
    });

    expect(eventId).toBe('feedback-event-1');
    expect(sentry.scope.setTags).toHaveBeenCalledWith({
      environment: 'production',
      release: 'abc123',
      route: '/chat/conv-1',
      request_id: 'req-1',
      conversation_id: 'conv-1',
      user_message_id: 'msg-user-1',
      user_id: 'user-1',
      surface: 'browser',
      feedback_kind: 'stream_failed',
    });
    expect(sentry.scope.setContext).toHaveBeenCalledWith(
      'squire',
      expect.objectContaining({
        context: {
          surface: 'browser',
          rawFeedback: TELEMETRY_REDACTED,
          maskedReplay: {
            textMasked: true,
            turns: { assistantTurnCount: 1 },
          },
        },
      }),
    );
    expect(sentry.captureFeedback).toHaveBeenCalledWith(
      {
        message: 'Squire browser feedback: stream_failed',
        source: 'squire-browser',
        associatedEventId: '0123456789abcdef0123456789abcdef',
        url: '/chat/conv-1',
        tags: {
          environment: 'production',
          release: 'abc123',
          route: '/chat/conv-1',
          request_id: 'req-1',
          conversation_id: 'conv-1',
          user_message_id: 'msg-user-1',
          user_id: 'user-1',
          surface: 'browser',
          feedback_kind: 'stream_failed',
        },
      },
      { includeReplay: true },
    );
    expect(JSON.stringify(sentry.captureFeedback.mock.calls[0])).not.toContain('my prompt');
    expect(JSON.stringify(sentry.captureFeedback.mock.calls[0])).not.toContain('token=secret');
  });
});
