import type { RedisClientType } from '@redis/client';
import { describe, expect, it, vi } from 'vitest';

import {
  hashRateLimitIdentity,
  InMemoryTokenBucketStore,
  RateLimiter,
  RedisTokenBucketStore,
} from '../src/rate-limit.ts';

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function createFakeRedisClient(options: {
  isOpen?: boolean;
  isReady?: boolean;
  connectPromise?: Promise<unknown>;
  evalResult?: unknown;
  evalError?: Error;
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
    eval: vi.fn(async () => {
      if (options.evalError) throw options.evalError;
      return options.evalResult ?? [1, '9', 0, 360_000];
    }),
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

  it('recovers from an open but unready Redis client', async () => {
    const staleClient = createFakeRedisClient({
      isOpen: true,
      isReady: false,
      evalError: new Error('client is not ready'),
    });
    const freshClient = createFakeRedisClient({
      evalResult: [1, '8', 0, 720_000],
    });
    const store = new RedisTokenBucketStore('redis://example.test:6379', staleClient, {
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
  });

  it('destroys pending Redis clients after a connect timeout', async () => {
    const pendingClient = createFakeRedisClient({
      connectPromise: new Promise(() => {}),
    });
    const store = new RedisTokenBucketStore('redis://example.test:6379', pendingClient, {
      operationTimeoutMs: 1,
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
    ).rejects.toThrow('redis rate-limit connect timed out');
    expect(pendingClient.destroy).toHaveBeenCalledTimes(1);
  });

  it('reuses an in-flight Redis connect promise for concurrent callers', async () => {
    const connect = createDeferred<unknown>();
    const pendingClient = createFakeRedisClient({
      connectPromise: connect.promise,
    });
    const store = new RedisTokenBucketStore('redis://example.test:6379', pendingClient);

    const first = store.consume({
      key: 'squire:rate-limit:first',
      capacity: 10,
      refillTokens: 10,
      refillIntervalMs: 3_600_000,
      cost: 1,
      nowMs: 0,
    });
    const second = store.consume({
      key: 'squire:rate-limit:second',
      capacity: 10,
      refillTokens: 10,
      refillIntervalMs: 3_600_000,
      cost: 1,
      nowMs: 0,
    });

    expect(pendingClient.connect).toHaveBeenCalledTimes(1);
    expect(pendingClient.destroy).not.toHaveBeenCalled();

    connect.resolve(undefined);

    await expect(first).resolves.toMatchObject({ allowed: true });
    await expect(second).resolves.toMatchObject({ allowed: true });
    expect(pendingClient.eval).toHaveBeenCalledTimes(2);
  });
});
