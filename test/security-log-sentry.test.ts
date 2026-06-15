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

import { writeSecurityLog } from '../src/security-log.ts';
import { TELEMETRY_REDACTED, initTelemetry, resetTelemetryForTests } from '../src/telemetry.ts';

const ORIGINAL_ENV = {
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

describe('writeSecurityLog Sentry log integration', () => {
  beforeEach(() => {
    restoreEnv();
    resetTelemetryForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    restoreEnv();
    resetTelemetryForTests();
    vi.restoreAllMocks();
  });

  it('sends broad security logs through the Sentry sanitizer without changing stdout JSON', () => {
    process.env.SENTRY_DSN = 'https://public@example.sentry.io/123';
    process.env.SENTRY_RELEASE = 'abc123';
    process.env.SQUIRE_ENV = 'production';
    initTelemetry(process.env);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    writeSecurityLog({
      event: 'custom_security_event',
      fields: {
        route: '/api/ask?token=secret',
        request_id: 'req-1',
        policy: 'api_ask',
        safe_count: 2,
        authorization: 'Bearer secret-token',
        cookie: 'session=value',
        token: 'secret-token',
        email: 'alice@example.com',
        name: 'Alice Example',
        first_name: 'Alice',
        raw_prompt: 'hidden prompt',
        answer: 'raw model output',
        transcript: 'raw chat transcript',
      },
    });

    expect(warn).toHaveBeenCalledTimes(1);
    const stdoutPayload = JSON.parse(warn.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(stdoutPayload).toMatchObject({
      event: 'custom_security_event',
      level: 'warn',
      squire_env: 'production',
      route: '/api/ask?token=secret',
      request_id: 'req-1',
      policy: 'api_ask',
      authorization: 'Bearer secret-token',
      cookie: 'session=value',
      token: 'secret-token',
      email: 'alice@example.com',
      name: 'Alice Example',
      first_name: 'Alice',
      raw_prompt: 'hidden prompt',
      answer: 'raw model output',
      transcript: 'raw chat transcript',
    });

    expect(sentry.scope.setTags).toHaveBeenCalledWith({
      environment: 'production',
      release: 'abc123',
      route: '/api/ask',
      request_id: 'req-1',
      surface: 'security_log',
      security_event: 'custom_security_event',
    });
    expect(sentry.logger.warn).toHaveBeenCalledWith('security_log.custom_security_event', {
      event: 'custom_security_event',
      level: 'warn',
      squire_env: 'production',
      log_kind: 'security',
      route: '/api/ask',
      request_id: 'req-1',
      policy: 'api_ask',
      safe_count: 2,
      authorization: TELEMETRY_REDACTED,
      cookie: TELEMETRY_REDACTED,
      token: TELEMETRY_REDACTED,
      email: TELEMETRY_REDACTED,
      name: TELEMETRY_REDACTED,
      first_name: TELEMETRY_REDACTED,
      raw_prompt: TELEMETRY_REDACTED,
      answer: TELEMETRY_REDACTED,
      transcript: TELEMETRY_REDACTED,
      context: {
        event: 'custom_security_event',
        level: 'warn',
        squire_env: 'production',
        surface: 'security_log',
      },
      surface: 'security_log',
      security_event: 'custom_security_event',
      environment: 'production',
      release: 'abc123',
    });
  });
});
