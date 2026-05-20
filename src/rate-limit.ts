import { createHmac } from 'node:crypto';

import { createClient as createRedisClient, type RedisClientType } from '@redis/client';
import {
  RateLimiterMemory as FlexibleMemoryRateLimiter,
  RateLimiterRedis as FlexibleRedisRateLimiter,
} from 'rate-limiter-flexible';

import { errorLogFields, writeSecurityLog } from './security-log.ts';

export interface RateLimitPolicy {
  name: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitConsumeInput {
  policy: RateLimitPolicy;
  identity: string;
}

export interface RateLimitDecision {
  allowed: boolean;
  policy: RateLimitPolicy;
  identityHash: string;
  remaining: number;
  retryAfterSeconds: number;
  resetAfterSeconds: number;
}

interface TokenBucketInput {
  key: string;
  capacity: number;
  refillTokens: number;
  refillIntervalMs: number;
  cost: number;
  nowMs: number;
}

interface TokenBucketDecision {
  allowed: boolean;
  tokensRemaining: number;
  retryAfterMs: number;
  resetAfterMs: number;
}

interface TokenBucketStore {
  consume(input: TokenBucketInput): Promise<TokenBucketDecision>;
}

interface RateLimiterOptions {
  keyPrefix?: string;
  identitySecret?: string;
  nowMs?: () => number;
}

const DEFAULT_KEY_PREFIX = 'squire:rate-limit';
const TEST_IDENTITY_SECRET = 'squire-test-rate-limit-identity-secret';
const DEV_IDENTITY_SECRET = 'squire-development-rate-limit-identity-secret';
const REDIS_OPERATION_TIMEOUT_MS = 2_000;

export const REGISTER_CLIENT_RATE_LIMIT_POLICY: RateLimitPolicy = {
  name: 'oauth_register_ip',
  limit: 10,
  windowMs: 60 * 60 * 1000,
};

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function identitySecretFromEnv(env: NodeJS.ProcessEnv): string {
  if (hasText(env.SESSION_SECRET)) return env.SESSION_SECRET;
  return env.VITEST === 'true' || env.NODE_ENV === 'test'
    ? TEST_IDENTITY_SECRET
    : DEV_IDENTITY_SECRET;
}

export function hashRateLimitIdentity(identity: string, secret: string): string {
  return createHmac('sha256', secret).update(identity).digest('base64url').slice(0, 32);
}

function parseFlexibleNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return Number.NaN;
}

function withTimeout<T>(promise: Promise<T>, operation: string, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${operation} timed out`));
    }, timeoutMs);
  });

  return Promise.race([promise, timer]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

interface RedisRateLimitStoreOptions {
  operationTimeoutMs?: number;
  clientFactory?: () => RedisClientType;
}

interface FlexibleRateLimiterResult {
  remainingPoints?: number;
  msBeforeNext?: number;
}

interface FlexibleRateLimiter {
  consume(key: string, points?: number): Promise<FlexibleRateLimiterResult>;
}

interface FlexibleRateLimitStoreOptions {
  createLimiter: (input: { points: number; durationSeconds: number }) => FlexibleRateLimiter;
  beforeConsume?: () => Promise<void>;
  operationTimeoutMs?: number;
}

function rateLimiterConfigKey(input: TokenBucketInput): string {
  return `${input.capacity}:${input.refillIntervalMs}`;
}

function durationSeconds(windowMs: number): number {
  return Math.max(1, Math.ceil(windowMs / 1000));
}

function isFlexibleRateLimiterResult(error: unknown): error is FlexibleRateLimiterResult {
  if (typeof error !== 'object' || error === null) return false;
  const value = error as Partial<FlexibleRateLimiterResult>;
  return (
    value.remainingPoints !== undefined &&
    value.msBeforeNext !== undefined &&
    Number.isFinite(parseFlexibleNumber(value.remainingPoints)) &&
    Number.isFinite(parseFlexibleNumber(value.msBeforeNext))
  );
}

function flexibleDecision(
  allowed: boolean,
  result: FlexibleRateLimiterResult,
): TokenBucketDecision {
  const tokensRemaining = Math.max(0, parseFlexibleNumber(result.remainingPoints));
  const resetAfterMs = Math.max(0, parseFlexibleNumber(result.msBeforeNext));

  return {
    allowed,
    tokensRemaining,
    retryAfterMs: allowed ? 0 : resetAfterMs,
    resetAfterMs,
  };
}

async function consumeTokenBucket(
  state: { tokens?: number; updatedAt?: number },
  input: TokenBucketInput,
): Promise<TokenBucketDecision> {
  const updatedAt = state.updatedAt ?? input.nowMs;
  const elapsedMs = Math.max(0, input.nowMs - updatedAt);
  const refill = (elapsedMs / input.refillIntervalMs) * input.refillTokens;
  const tokens = Math.min(input.capacity, (state.tokens ?? input.capacity) + refill);

  let nextTokens = tokens;
  let allowed = false;
  let retryAfterMs = 0;

  if (tokens >= input.cost) {
    allowed = true;
    nextTokens = tokens - input.cost;
  } else {
    retryAfterMs = Math.ceil(((input.cost - tokens) / input.refillTokens) * input.refillIntervalMs);
  }

  state.tokens = nextTokens;
  state.updatedAt = input.nowMs;

  return {
    allowed,
    tokensRemaining: nextTokens,
    retryAfterMs,
    resetAfterMs: Math.ceil(
      ((input.capacity - nextTokens) / input.refillTokens) * input.refillIntervalMs,
    ),
  };
}

export class InMemoryTokenBucketStore implements TokenBucketStore {
  private readonly buckets = new Map<string, { tokens?: number; updatedAt?: number }>();

  async consume(input: TokenBucketInput): Promise<TokenBucketDecision> {
    const state = this.buckets.get(input.key) ?? {};
    this.buckets.set(input.key, state);
    return consumeTokenBucket(state, input);
  }

  clear(): void {
    this.buckets.clear();
  }
}

class NoopTokenBucketStore implements TokenBucketStore {
  async consume(input: TokenBucketInput): Promise<TokenBucketDecision> {
    return {
      allowed: true,
      tokensRemaining: input.capacity,
      retryAfterMs: 0,
      resetAfterMs: 0,
    };
  }
}

export class FlexibleRateLimitStore implements TokenBucketStore {
  private readonly createLimiter: FlexibleRateLimitStoreOptions['createLimiter'];
  private readonly beforeConsume: (() => Promise<void>) | undefined;
  private readonly operationTimeoutMs: number | undefined;
  private readonly limiters = new Map<string, FlexibleRateLimiter>();

  constructor(options: FlexibleRateLimitStoreOptions) {
    this.createLimiter = options.createLimiter;
    this.beforeConsume = options.beforeConsume;
    this.operationTimeoutMs = options.operationTimeoutMs;
  }

  async consume(input: TokenBucketInput): Promise<TokenBucketDecision> {
    if (this.beforeConsume) {
      await this.beforeConsume();
    }

    const limiter = this.getLimiter(input);
    try {
      const promise = limiter.consume(input.key, input.cost);
      const result = this.operationTimeoutMs
        ? await withTimeout(promise, 'rate-limit consume', this.operationTimeoutMs)
        : await promise;
      return flexibleDecision(true, result);
    } catch (error) {
      if (isFlexibleRateLimiterResult(error)) {
        return flexibleDecision(false, error);
      }
      throw error;
    }
  }

  protected clearLimiters(): void {
    this.limiters.clear();
  }

  private getLimiter(input: TokenBucketInput): FlexibleRateLimiter {
    const key = rateLimiterConfigKey(input);
    let limiter = this.limiters.get(key);
    if (!limiter) {
      limiter = this.createLimiter({
        points: input.capacity,
        durationSeconds: durationSeconds(input.refillIntervalMs),
      });
      this.limiters.set(key, limiter);
    }
    return limiter;
  }
}

export class MemoryRateLimitStore extends FlexibleRateLimitStore {
  constructor() {
    super({
      createLimiter: ({ points, durationSeconds }) =>
        new FlexibleMemoryRateLimiter({
          duration: durationSeconds,
          points,
        }),
    });
  }
}

export class RedisRateLimitStore extends FlexibleRateLimitStore {
  private client: RedisClientType;
  private readonly clientFactory: () => RedisClientType;
  private readonly redisOperationTimeoutMs: number;
  private connectPromise: Promise<void> | undefined;

  constructor(url: string, client?: RedisClientType, options: RedisRateLimitStoreOptions = {}) {
    let connect: () => Promise<void> = async () => {};
    const operationTimeoutMs = options.operationTimeoutMs ?? REDIS_OPERATION_TIMEOUT_MS;
    const clientFactory =
      options.clientFactory ??
      (() =>
        createRedisClient({
          url,
          socket: {
            connectTimeout: operationTimeoutMs,
          },
        }));
    const redisClient = client ?? clientFactory();

    super({
      beforeConsume: () => connect(),
      createLimiter: ({ points, durationSeconds }) =>
        new FlexibleRedisRateLimiter({
          duration: durationSeconds,
          keyPrefix: '',
          points,
          rejectIfRedisNotReady: true,
          storeClient: this.client,
          useRedisPackage: true,
        }),
      operationTimeoutMs,
    });

    this.clientFactory = clientFactory;
    this.client = this.prepareClient(redisClient);
    this.redisOperationTimeoutMs = operationTimeoutMs;
    connect = () => this.connect();
  }

  private createClient(): RedisClientType {
    return this.prepareClient(this.clientFactory());
  }

  private resetClient(client: RedisClientType): void {
    if (this.client !== client) return;
    this.connectPromise = undefined;
    this.client = this.createClient();
    this.clearLimiters();

    try {
      client.destroy();
    } catch {
      // Closing a stale limiter client is best-effort. The next request uses a
      // fresh client and still fails closed if Redis remains unavailable.
    }
  }

  private async connect(): Promise<void> {
    let client = this.client;
    if (client.isReady) return;

    if (this.connectPromise) {
      try {
        await withTimeout(
          this.connectPromise,
          'redis rate-limit connect',
          this.redisOperationTimeoutMs,
        );
      } catch (error) {
        this.resetClient(client);
        throw error;
      }
      return;
    }

    if (client.isOpen) {
      this.resetClient(client);
      client = this.client;
    }

    this.connectPromise = client
      .connect()
      .then(() => undefined)
      .catch((error: unknown) => {
        this.resetClient(client);
        throw error;
      });
    try {
      await withTimeout(
        this.connectPromise,
        'redis rate-limit connect',
        this.redisOperationTimeoutMs,
      );
    } catch (error) {
      this.resetClient(client);
      throw error;
    } finally {
      if (this.client === client) {
        this.connectPromise = undefined;
      }
    }
  }

  private prepareClient(client: RedisClientType): RedisClientType {
    client.on('error', (error: Error) => {
      writeSecurityLog({
        event: 'rate_limit_redis_error',
        level: 'error',
        fields: errorLogFields(error),
      });
      this.resetClient(client);
    });
    return client;
  }
}

export class RateLimiter {
  private readonly store: TokenBucketStore;
  private readonly keyPrefix: string;
  private readonly identitySecret: string;
  private readonly nowMs: () => number;

  constructor(store: TokenBucketStore, options: RateLimiterOptions = {}) {
    this.store = store;
    this.keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.identitySecret = options.identitySecret ?? DEV_IDENTITY_SECRET;
    this.nowMs = options.nowMs ?? Date.now;
  }

  async consume(input: RateLimitConsumeInput): Promise<RateLimitDecision> {
    const identityHash = hashRateLimitIdentity(input.identity, this.identitySecret);
    const policy = input.policy;
    const decision = await this.store.consume({
      key: `${this.keyPrefix}:${policy.name}:${identityHash}`,
      capacity: policy.limit,
      refillTokens: policy.limit,
      refillIntervalMs: policy.windowMs,
      cost: 1,
      nowMs: this.nowMs(),
    });

    return {
      allowed: decision.allowed,
      policy,
      identityHash,
      remaining: Math.max(0, Math.floor(decision.tokensRemaining)),
      retryAfterSeconds: Math.max(0, Math.ceil(decision.retryAfterMs / 1000)),
      resetAfterSeconds: Math.max(0, Math.ceil(decision.resetAfterMs / 1000)),
    };
  }
}

let defaultRateLimiter: RateLimiter | undefined;
let rateLimiterForTesting: RateLimiter | undefined;

export function createRateLimiterFromEnv(env: NodeJS.ProcessEnv = process.env): RateLimiter {
  if (env.VITEST === 'true' || env.NODE_ENV === 'test') {
    return new RateLimiter(new NoopTokenBucketStore(), {
      identitySecret: identitySecretFromEnv(env),
    });
  }

  const redisUrl = env.REDIS_URL?.trim();
  if (redisUrl) {
    return new RateLimiter(new RedisRateLimitStore(redisUrl), {
      identitySecret: identitySecretFromEnv(env),
    });
  }

  if (env.NODE_ENV === 'production') {
    throw new Error('REDIS_URL must be set in production to enable app rate limiting');
  }

  return new RateLimiter(new MemoryRateLimitStore(), {
    identitySecret: identitySecretFromEnv(env),
  });
}

export function getDefaultRateLimiter(): RateLimiter {
  if (rateLimiterForTesting) return rateLimiterForTesting;
  defaultRateLimiter ??= createRateLimiterFromEnv();
  return defaultRateLimiter;
}

export function setRateLimiterForTesting(rateLimiter: RateLimiter): void {
  rateLimiterForTesting = rateLimiter;
}

export function resetRateLimiterForTesting(): void {
  rateLimiterForTesting = undefined;
  defaultRateLimiter = undefined;
}
