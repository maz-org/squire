import { describe, expect, it } from 'vitest';

import { applySquireEnv, resolveSquireEnv } from '../src/squire-env.ts';

describe('SQUIRE_ENV', () => {
  it('uses SQUIRE_ENV as the canonical environment name', () => {
    expect(resolveSquireEnv({ SQUIRE_ENV: 'Production', NODE_ENV: 'development' })).toBe(
      'production',
    );
  });

  it('falls back to NODE_ENV and then development', () => {
    expect(resolveSquireEnv({ NODE_ENV: 'test' })).toBe('test');
    expect(resolveSquireEnv({})).toBe('development');
  });

  it('rejects values Langfuse cannot accept as environment names', () => {
    expect(() => resolveSquireEnv({ SQUIRE_ENV: 'langfuse-prod' })).toThrow(/SQUIRE_ENV/);
    expect(() => resolveSquireEnv({ SQUIRE_ENV: 'review/app' })).toThrow(/SQUIRE_ENV/);
  });

  it('normalizes SQUIRE_ENV in-place for runtime instrumentation', () => {
    const env: Record<string, string | undefined> = {
      SQUIRE_ENV: 'Staging',
    };

    expect(applySquireEnv(env)).toBe('staging');

    expect(env).toMatchObject({
      SQUIRE_ENV: 'staging',
    });
  });
});
