import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAddTelemetryBreadcrumb, mockCaptureTelemetryMessage } = vi.hoisted(() => ({
  mockAddTelemetryBreadcrumb: vi.fn(),
  mockCaptureTelemetryMessage: vi.fn(),
}));

vi.mock('../src/telemetry.ts', () => ({
  addTelemetryBreadcrumb: mockAddTelemetryBreadcrumb,
  captureTelemetryMessage: mockCaptureTelemetryMessage,
}));

import { errorLogFields, writeSecurityLog } from '../src/security-log.ts';

const ORIGINAL_SQUIRE_ENV = process.env.SQUIRE_ENV;

beforeEach(() => {
  mockAddTelemetryBreadcrumb.mockReset();
  mockCaptureTelemetryMessage.mockReset();
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

  it('mirrors rate-limit rejections as safe Sentry breadcrumbs', () => {
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
        retry_after_seconds: 3,
        reset_after_seconds: 12,
        authorization: 'Bearer secret-token',
        cookie: 'session=value',
        raw_prompt: 'What is in the hidden prompt?',
        email: 'alice@example.com',
      },
    });

    expect(mockAddTelemetryBreadcrumb).toHaveBeenCalledTimes(1);
    expect(mockAddTelemetryBreadcrumb).toHaveBeenCalledWith({
      category: 'security_log',
      message: 'rate_limit_rejected',
      level: 'warning',
      route: '/api/ask',
      context: {
        event: 'rate_limit_rejected',
        level: 'warn',
        squire_env: 'production',
        fields: {
          route: '/api/ask',
          method: 'POST',
          policy: 'api_ask',
          limit: 20,
          window_ms: 60_000,
          identity_hash: 'identity-hash',
          retry_after_seconds: 3,
          reset_after_seconds: 12,
        },
      },
    });
    expect(mockCaptureTelemetryMessage).not.toHaveBeenCalled();
  });

  it('captures important app failures as safe Sentry messages', () => {
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

    expect(mockCaptureTelemetryMessage).toHaveBeenCalledTimes(1);
    expect(mockCaptureTelemetryMessage).toHaveBeenCalledWith(
      'security_log.rate_limit_unavailable',
      'error',
      {
        route: '/register',
        context: {
          event: 'rate_limit_unavailable',
          level: 'error',
          squire_env: 'production',
          fields: {
            route: '/register',
            method: 'POST',
            policy: 'register_client',
            error_type: 'RedisConnectionError',
            error_code: 'ECONNREFUSED',
          },
        },
      },
    );
    expect(mockAddTelemetryBreadcrumb).not.toHaveBeenCalled();
  });

  it('does not mirror unrecognized security log events to Sentry', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    writeSecurityLog({
      event: 'unclassified_debug_event',
      fields: {
        route: '/debug',
        detail: 'still written to stdout',
      },
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(mockAddTelemetryBreadcrumb).not.toHaveBeenCalled();
    expect(mockCaptureTelemetryMessage).not.toHaveBeenCalled();
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
