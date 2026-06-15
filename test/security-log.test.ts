import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCaptureTelemetryLog } = vi.hoisted(() => ({
  mockCaptureTelemetryLog: vi.fn(),
}));

vi.mock('../src/telemetry.ts', () => ({
  captureTelemetryLog: mockCaptureTelemetryLog,
}));

import { errorLogFields, writeSecurityLog } from '../src/security-log.ts';

const ORIGINAL_SQUIRE_ENV = process.env.SQUIRE_ENV;

beforeEach(() => {
  mockCaptureTelemetryLog.mockReset();
});

afterEach(() => {
  if (ORIGINAL_SQUIRE_ENV === undefined) {
    delete process.env.SQUIRE_ENV;
  } else {
    process.env.SQUIRE_ENV = ORIGINAL_SQUIRE_ENV;
  }
  vi.restoreAllMocks();
});

describe('writeSecurityLog', () => {
  it('does not allow caller fields to override canonical log fields', () => {
    process.env.SQUIRE_ENV = 'production';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    writeSecurityLog({
      event: 'rate_limit_rejected',
      level: 'warn',
      fields: {
        event: 'spoofed_event',
        level: 'info',
        ts: 'spoofed_timestamp',
        squire_env: 'spoofed_env',
        detail: 'preserved_field',
      },
    });

    expect(warn).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(warn.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(payload).toMatchObject({
      event: 'rate_limit_rejected',
      level: 'warn',
      squire_env: 'production',
      detail: 'preserved_field',
    });
    expect(payload.ts).not.toBe('spoofed_timestamp');
  });

  it('emits rate-limit rejections as broad structured Sentry logs', () => {
    process.env.SQUIRE_ENV = 'production';
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    writeSecurityLog({
      event: 'rate_limit_rejected',
      fields: {
        route: '/api/ask?token=secret',
        method: 'POST',
        policy: 'api_ask',
        limit: 20,
        window_ms: 60_000,
        identity_hash: 'identity-hash',
        request_id: 'req-1',
        retry_after_seconds: 3,
        reset_after_seconds: 12,
        authorization: 'Bearer secret-token',
        cookie: 'session=value',
        raw_prompt: 'What is in the hidden prompt?',
        email: 'alice@example.com',
      },
    });

    expect(mockCaptureTelemetryLog).toHaveBeenCalledTimes(1);
    expect(mockCaptureTelemetryLog).toHaveBeenCalledWith(
      'warn',
      'security_log.rate_limit_rejected',
      {
        route: '/api/ask',
        requestId: 'req-1',
        context: {
          event: 'rate_limit_rejected',
          level: 'warn',
          squire_env: 'production',
          surface: 'security_log',
        },
        attributes: {
          event: 'rate_limit_rejected',
          level: 'warn',
          squire_env: 'production',
          log_kind: 'security',
          route: '/api/ask',
          method: 'POST',
          policy: 'api_ask',
          limit: 20,
          window_ms: 60_000,
          identity_hash: 'identity-hash',
          request_id: 'req-1',
          retry_after_seconds: 3,
          reset_after_seconds: 12,
          authorization: 'Bearer secret-token',
          cookie: 'session=value',
          raw_prompt: 'What is in the hidden prompt?',
          email: 'alice@example.com',
        },
      },
    );
  });

  it('emits important app failures as error Sentry logs', () => {
    process.env.SQUIRE_ENV = 'production';
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    writeSecurityLog({
      event: 'rate_limit_unavailable',
      level: 'error',
      fields: {
        route: 'https://squire.maz.org/register?cookie=session',
        method: 'POST',
        policy: 'register_client',
        error_type: 'RedisConnectionError',
        error_code: 'ECONNREFUSED',
        token: 'secret-token',
        answer: 'raw model output',
      },
    });

    expect(mockCaptureTelemetryLog).toHaveBeenCalledTimes(1);
    expect(mockCaptureTelemetryLog).toHaveBeenCalledWith(
      'error',
      'security_log.rate_limit_unavailable',
      {
        route: '/register',
        context: {
          event: 'rate_limit_unavailable',
          level: 'error',
          squire_env: 'production',
          surface: 'security_log',
        },
        attributes: {
          event: 'rate_limit_unavailable',
          level: 'error',
          squire_env: 'production',
          log_kind: 'security',
          route: '/register',
          method: 'POST',
          policy: 'register_client',
          error_type: 'RedisConnectionError',
          error_code: 'ECONNREFUSED',
          token: 'secret-token',
          answer: 'raw model output',
        },
      },
    );
  });

  it('emits unrecognized security log events to Sentry logs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    writeSecurityLog({
      event: 'unclassified_debug_event',
      fields: {
        route: '/debug',
        request_id: 'req-debug-1',
        detail: 'still written to stdout',
      },
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(mockCaptureTelemetryLog).toHaveBeenCalledTimes(1);
    expect(mockCaptureTelemetryLog).toHaveBeenCalledWith(
      'warn',
      'security_log.unclassified_debug_event',
      {
        route: '/debug',
        requestId: 'req-debug-1',
        context: {
          event: 'unclassified_debug_event',
          level: 'warn',
          squire_env: 'test',
          surface: 'security_log',
        },
        attributes: {
          event: 'unclassified_debug_event',
          level: 'warn',
          squire_env: 'test',
          log_kind: 'security',
          route: '/debug',
          request_id: 'req-debug-1',
          detail: 'still written to stdout',
        },
      },
    );
  });

  it('maps available snake_case diagnostic fields into telemetry metadata', () => {
    process.env.SQUIRE_ENV = 'production';
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    writeSecurityLog({
      event: 'diagnostic_security_event',
      level: 'info',
      fields: {
        route: '/chat/conv-1/messages/msg-1/stream?token=secret',
        request_id: 'req-1',
        conversation_id: 'conv-1',
        user_message_id: 'msg-user-1',
        assistant_message_id: 'msg-assistant-1',
        sentry_trace_id: '0123456789abcdef0123456789abcdef',
        langsmith_thread_url:
          'https://smith.langchain.com/o/org/projects/p/threads/thread-1?token=secret',
        langsmith_run_url: 'https://smith.langchain.com/o/org/projects/p/r/run-1#fragment',
        user_id: 'user-1',
        user_hash: 'user-hash-1',
      },
    });

    expect(mockCaptureTelemetryLog).toHaveBeenCalledWith(
      'info',
      'security_log.diagnostic_security_event',
      expect.objectContaining({
        route: '/chat/conv-1/messages/msg-1/stream',
        requestId: 'req-1',
        conversationId: 'conv-1',
        userMessageId: 'msg-user-1',
        assistantMessageId: 'msg-assistant-1',
        sentryTraceId: '0123456789abcdef0123456789abcdef',
        langsmithThreadUrl: 'https://smith.langchain.com/o/org/projects/p/threads/thread-1',
        langsmithRunUrl: 'https://smith.langchain.com/o/org/projects/p/r/run-1',
        user: { id: 'user-1', hash: 'user-hash-1' },
      }),
    );
  });

  it('does not promote unsafe diagnostic fields into telemetry metadata', () => {
    process.env.SQUIRE_ENV = 'production';
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    writeSecurityLog({
      event: 'unsafe_diagnostic_security_event',
      fields: {
        route: '/debug',
        request_id: 'alice@example.com',
        user_id: 'alice@example.com',
        user_hash: 'Bearer secret-token',
        langsmith_thread_url: 'https://evil.test/o/org/projects/p/threads/thread-1',
        langsmith_run_url: 'not a url',
      },
    });

    expect(mockCaptureTelemetryLog).toHaveBeenCalledWith(
      'warn',
      'security_log.unsafe_diagnostic_security_event',
      expect.objectContaining({
        route: '/debug',
        requestId: undefined,
        langsmithThreadUrl: undefined,
        langsmithRunUrl: undefined,
        user: undefined,
      }),
    );
  });

  it('preserves stdout JSON while the telemetry boundary sanitizes unsafe fields', () => {
    process.env.SQUIRE_ENV = 'production';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    writeSecurityLog({
      event: 'custom_security_event',
      fields: {
        route: '/debug?token=secret',
        request_id: 'req-debug-2',
        email: 'alice@example.com',
        raw_prompt: 'hidden prompt',
        name: 'Alice Example',
      },
    });

    const payload = JSON.parse(warn.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(payload).toMatchObject({
      event: 'custom_security_event',
      level: 'warn',
      squire_env: 'production',
      route: '/debug?token=secret',
      request_id: 'req-debug-2',
      email: 'alice@example.com',
      raw_prompt: 'hidden prompt',
      name: 'Alice Example',
    });
    expect(mockCaptureTelemetryLog).toHaveBeenCalledWith(
      'warn',
      'security_log.custom_security_event',
      {
        route: '/debug',
        requestId: 'req-debug-2',
        context: {
          event: 'custom_security_event',
          level: 'warn',
          squire_env: 'production',
          surface: 'security_log',
        },
        attributes: {
          event: 'custom_security_event',
          level: 'warn',
          squire_env: 'production',
          log_kind: 'security',
          route: '/debug',
          request_id: 'req-debug-2',
          email: 'alice@example.com',
          raw_prompt: 'hidden prompt',
          name: 'Alice Example',
        },
      },
    );
  });

  it('sanitizes error type and code fields', () => {
    const redisError = new Error('connect failed') as Error & { code?: string };
    redisError.name = 'RedisConnectionError';
    redisError.code = 'ECONNREFUSED';

    expect(errorLogFields(redisError)).toEqual({
      error_type: 'RedisConnectionError',
      error_code: 'ECONNREFUSED',
    });

    const unsafeError = new Error('token sk_secret should not leave logs') as Error & {
      code?: string;
    };
    unsafeError.name = 'Error With Spaces';
    unsafeError.code = 'ECONNRESET;DROP';

    expect(errorLogFields(unsafeError)).toEqual({
      error_type: 'unknown',
      error_code: null,
    });
  });
});
