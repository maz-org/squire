import { describe, expect, it } from 'vitest';

import { hashRateLimitIdentity, InMemoryTokenBucketStore, RateLimiter } from '../src/rate-limit.ts';

describe('RateLimiter', () => {
  it('allows the configured burst, rejects the next request, then refills over time', async () => {
    let nowMs = 0;
    const limiter = new RateLimiter(new InMemoryTokenBucketStore(), {
      identitySecret: 'rate-limit-unit-test-secret',
      nowMs: () => nowMs,
    });
    const policy = { name: 'unit_test', limit: 2, windowMs: 1_000 };

    await expect(limiter.consume({ policy, identity: 'client-a' })).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
    });
    await expect(limiter.consume({ policy, identity: 'client-a' })).resolves.toMatchObject({
      allowed: true,
      remaining: 0,
    });
    await expect(limiter.consume({ policy, identity: 'client-a' })).resolves.toMatchObject({
      allowed: false,
      retryAfterSeconds: 1,
    });

    nowMs = 500;
    await expect(limiter.consume({ policy, identity: 'client-a' })).resolves.toMatchObject({
      allowed: true,
      remaining: 0,
    });
  });

  it('does not expose the raw identity in the limiter key hash', () => {
    const rawIp = '198.51.100.70';
    const hash = hashRateLimitIdentity(rawIp, 'rate-limit-unit-test-secret');

    expect(hash).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(hash).not.toContain(rawIp);
    expect(hash).toBe(hashRateLimitIdentity(rawIp, 'rate-limit-unit-test-secret'));
    expect(hash).not.toBe(hashRateLimitIdentity(rawIp, 'different-secret'));
  });
});
