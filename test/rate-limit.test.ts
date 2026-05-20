import type { RedisClientType } from '@redis/client';
import { describe, expect, it, vi } from 'vitest';

import {
  FlexibleRateLimitStore,
  hashRateLimitIdentity,
  InMemoryTokenBucketStore,
  RateLimiter,
  RedisRateLimitStore,
} from '../src/rate-limit.ts';

function createFakeRedisClient(options: {
  isOpen?: boolean;
  isReady?: boolean;
  connectPromise?: Promise<unknown>;
  evalResult?: unknown;
}): RedisClientType {
  let isOpen = options.isOpen ?? false;
  let isReady = options.isReady ?? false;
  const client = {
    get isOpen() {
      return isOpen;
    },
    get isReady() {
      return isReady;
    },
    on: vi.fn(),
    connect: vi.fn(() => {
      isOpen = true;
      if (options.connectPromise) {
        return options.connectPromise.then((value) => {
          isReady = true;
          return value;
        });
      }
      isReady = true;
      return Promise.resolve(client);
    }),
    destroy: vi.fn(() => {
      isOpen = false;
      isReady = false;
    }),
    multi: vi.fn(() => ({
      exec: vi.fn(async () => []),
      get: vi.fn().mockReturnThis(),
      incrBy: vi.fn().mockReturnThis(),
      pTTL: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    })),
    eval: vi.fn(async () => options.evalResult ?? [1, 360_000]),
  };

  return client as unknown as RedisClientType;
}

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

  it('maps successful rate-limiter-flexible consumes into Squire decisions', async () => {
    const consume = vi.fn(async () => ({
      remainingPoints: 8,
      msBeforeNext: 720_000,
    }));
    const store = new FlexibleRateLimitStore({
      createLimiter: () => ({ consume }),
    });

    await expect(
      store.consume({
        key: 'squire:rate-limit:test',
        capacity: 10,
        refillTokens: 10,
        refillIntervalMs: 3_600_000,
        cost: 1,
        nowMs: 0,
      }),
    ).resolves.toEqual({
      allowed: true,
      tokensRemaining: 8,
      retryAfterMs: 0,
      resetAfterMs: 720_000,
    });
    expect(consume).toHaveBeenCalledWith('squire:rate-limit:test', 1);
  });

  it('maps rate-limiter-flexible limit rejections into denied Squire decisions', async () => {
    const consume = vi.fn(async () => {
      throw {
        remainingPoints: 0,
        msBeforeNext: 180_000,
      };
    });
    const store = new FlexibleRateLimitStore({
      createLimiter: () => ({ consume }),
    });

    await expect(
      store.consume({
        key: 'squire:rate-limit:test',
        capacity: 10,
        refillTokens: 10,
        refillIntervalMs: 3_600_000,
        cost: 1,
        nowMs: 0,
      }),
    ).resolves.toEqual({
      allowed: false,
      tokensRemaining: 0,
      retryAfterMs: 180_000,
      resetAfterMs: 180_000,
    });
  });

  it('creates separate flexible limiters for distinct policy windows', async () => {
    const createLimiter = vi.fn(() => ({
      consume: vi.fn(async () => ({
        remainingPoints: 8,
        msBeforeNext: 720_000,
      })),
    }));
    const store = new FlexibleRateLimitStore({
      createLimiter,
    });

    await store.consume({
      key: 'squire:rate-limit:first',
      capacity: 10,
      refillTokens: 10,
      refillIntervalMs: 3_600_000,
      cost: 1,
      nowMs: 0,
    });
    await store.consume({
      key: 'squire:rate-limit:second',
      capacity: 5,
      refillTokens: 5,
      refillIntervalMs: 60_000,
      cost: 1,
      nowMs: 0,
    });

    expect(createLimiter).toHaveBeenCalledTimes(2);
  });

  it('recovers a stale node-redis client before using rate-limiter-flexible', async () => {
    const staleClient = createFakeRedisClient({
      isOpen: true,
      isReady: false,
    });
    const freshClient = createFakeRedisClient({
      evalResult: [2, 720_000],
    });
    const store = new RedisRateLimitStore('redis://example.test:6379', staleClient, {
      clientFactory: () => freshClient,
    });

    await expect(
      store.consume({
        key: 'squire:rate-limit:test',
        capacity: 10,
        refillTokens: 10,
        refillIntervalMs: 3_600_000,
        cost: 1,
        nowMs: 0,
      }),
    ).resolves.toEqual({
      allowed: true,
      tokensRemaining: 8,
      retryAfterMs: 0,
      resetAfterMs: 720_000,
    });
    expect(staleClient.destroy).toHaveBeenCalledTimes(1);
    expect(freshClient.connect).toHaveBeenCalledTimes(1);
  });
});
