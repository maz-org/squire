import { describe, expect, it } from 'vitest';

import {
  formatServerConfigError,
  resolveGoogleOAuthEnv,
  validateServerEnv,
} from '../src/config.ts';

describe('validateServerEnv', () => {
  const validProductionEnv = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://squire:squire@localhost:5432/squire',
    ANTHROPIC_API_KEY: 'anthropic-key',
    SESSION_SECRET: 'x'.repeat(32),
    LANGSMITH_API_KEY: 'langsmith-key',
    LANGSMITH_PROJECT: 'squire-production',
    LANGSMITH_TRACING: 'true',
    GOOGLE_OAUTH_CLIENT_ID: 'google-client',
    GOOGLE_OAUTH_CLIENT_SECRET: 'google-secret',
    ORIGIN_SHARED_SECRET: 'origin-secret'.repeat(3),
    REDIS_URL: 'redis://localhost:6379',
  };

  it('rejects missing production secrets with the missing variable names', () => {
    const result = validateServerEnv({ NODE_ENV: 'production' });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected invalid env');
    expect(result.error.missing).toEqual([
      'DATABASE_URL',
      'ANTHROPIC_API_KEY',
      'SESSION_SECRET',
      'GOOGLE_OAUTH_CLIENT_ID',
      'GOOGLE_OAUTH_CLIENT_SECRET',
      'ORIGIN_SHARED_SECRET',
      'REDIS_URL',
    ]);
    expect(formatServerConfigError(result.error)).toContain(
      'Missing required environment variables',
    );
  });

  it('applies production port and host defaults at the config boundary', () => {
    const result = validateServerEnv(validProductionEnv);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected valid env');
    expect(result.data.port).toBe(8080);
    expect(result.data.host).toBe('0.0.0.0');
  });

  it('does not make LangSmith tracing credentials boot-critical in production', () => {
    const result = validateServerEnv({
      ...validProductionEnv,
      LANGSMITH_API_KEY: undefined,
      LANGSMITH_PROJECT: undefined,
      LANGSMITH_TRACING: undefined,
    });

    expect(result.success).toBe(true);
  });

  it('rejects production LangSmith credentials without tracing enabled', () => {
    const result = validateServerEnv({
      ...validProductionEnv,
      LANGSMITH_TRACING: undefined,
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected invalid env');
    expect(result.error.invalid).toContainEqual({
      name: 'LANGSMITH_TRACING',
      message: 'must be "true" when LANGSMITH_API_KEY or LANGSMITH_PROJECT is set',
    });
  });

  it('allows development to use the managed local database default', () => {
    const result = validateServerEnv({
      ...validProductionEnv,
      NODE_ENV: 'development',
      DATABASE_URL: undefined,
      ORIGIN_SHARED_SECRET: undefined,
      REDIS_URL: undefined,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected valid env');
    expect(result.data.port).toBeUndefined();
    expect(result.data.host).toBeUndefined();
  });

  it('rejects malformed port and too-short session secrets', () => {
    const result = validateServerEnv({
      ...validProductionEnv,
      PORT: 'not-a-port',
      SESSION_SECRET: 'short',
      ORIGIN_SHARED_SECRET: 'short',
      REDIS_URL: 'not a url',
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected invalid env');
    expect(result.error.invalid).toEqual(
      expect.arrayContaining([
        { name: 'PORT', message: 'must be an integer between 1 and 65535' },
        { name: 'SESSION_SECRET', message: 'must be at least 32 characters' },
        { name: 'ORIGIN_SHARED_SECRET', message: 'must be at least 32 characters' },
        { name: 'REDIS_URL', message: 'must be a valid URL' },
      ]),
    );
  });
});

describe('resolveGoogleOAuthEnv', () => {
  it('reads the GOOGLE_OAUTH names used by production and local development', () => {
    expect(
      resolveGoogleOAuthEnv({
        GOOGLE_OAUTH_CLIENT_ID: 'oauth-id',
        GOOGLE_OAUTH_CLIENT_SECRET: 'oauth-secret',
        GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
      }),
    ).toEqual({
      clientId: 'oauth-id',
      clientSecret: 'oauth-secret',
      redirectUri: 'http://localhost:3000/auth/google/callback',
    });
  });

  it('does not fall back to the removed legacy Google env names', () => {
    expect(
      resolveGoogleOAuthEnv({
        GOOGLE_CLIENT_ID: 'legacy-id',
        GOOGLE_CLIENT_SECRET: 'legacy-secret',
        GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
      }),
    ).toEqual({
      clientId: undefined,
      clientSecret: undefined,
      redirectUri: undefined,
    });
  });
});
