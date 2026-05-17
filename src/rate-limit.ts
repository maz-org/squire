import { createHmac } from 'node:crypto';

import { createClient, type RedisClientType } from '@redis/client';

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
const REDIS_SOCKET_TIMEOUT_MS = 10_000;

const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local now_ms = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refill_interval_ms = tonumber(ARGV[3])
local refill_tokens = tonumber(ARGV[4])
local cost = tonumber(ARGV[5])
local ttl_ms = tonumber(ARGV[6])

local state = redis.call('HMGET', key, 'tokens', 'updated_at')
local tokens = tonumber(state[1])
local updated_at = tonumber(state[2])

if tokens == nil then
  tokens = capacity
  updated_at = now_ms
end

if updated_at == nil then
  updated_at = now_ms
end

local elapsed_ms = math.max(0, now_ms - updated_at)
local refill = (elapsed_ms / refill_interval_ms) * refill_tokens
tokens = math.min(capacity, tokens + refill)

local allowed = 0
local retry_after_ms = 0
if tokens >= cost then
  allowed = 1
  tokens = tokens - cost
else
  retry_after_ms = math.ceil(((cost - tokens) / refill_tokens) * refill_interval_ms)
end

redis.call('HSET', key, 'tokens', tostring(tokens), 'updated_at', tostring(now_ms))
redis.call('PEXPIRE', key, ttl_ms)

local reset_after_ms = math.ceil(((capacity - tokens) / refill_tokens) * refill_interval_ms)
return { allowed, tostring(tokens), retry_after_ms, reset_after_ms }
`;

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

function parseRedisNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return Number.NaN;
}

function parseRedisDecision(value: unknown): TokenBucketDecision {
  if (!Array.isArray(value) || value.length < 4) {
    throw new Error('Redis rate limit script returned an invalid response');
  }

  const allowed = parseRedisNumber(value[0]);
  const tokensRemaining = parseRedisNumber(value[1]);
  const retryAfterMs = parseRedisNumber(value[2]);
  const resetAfterMs = parseRedisNumber(value[3]);
  if (
    !Number.isFinite(allowed) ||
    !Number.isFinite(tokensRemaining) ||
    !Number.isFinite(retryAfterMs) ||
    !Number.isFinite(resetAfterMs)
  ) {
    throw new Error('Redis rate limit script returned non-numeric values');
  }

  return {
    allowed: allowed === 1,
    tokensRemaining,
    retryAfterMs,
    resetAfterMs,
  };
}

function withRedisTimeout<T>(
  promise: Promise<T>,
  operation: string,
  timeoutMs: number,
): Promise<T> {
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

interface RedisTokenBucketStoreOptions {
  operationTimeoutMs?: number;
}

function tokenBucketTtlMs(input: TokenBucketInput): number {
  return Math.max(
    input.refillIntervalMs,
    Math.ceil((input.capacity / input.refillTokens) * input.refillIntervalMs * 2),
  );
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

export class RedisTokenBucketStore implements TokenBucketStore {
  private readonly client: RedisClientType;
  private readonly operationTimeoutMs: number;
  private connectPromise: Promise<RedisClientType> | undefined;

  constructor(url: string, client?: RedisClientType, options: RedisTokenBucketStoreOptions = {}) {
    this.client =
      client ??
      createClient({
        url,
        socket: {
          connectTimeout: REDIS_OPERATION_TIMEOUT_MS,
          socketTimeout: REDIS_SOCKET_TIMEOUT_MS,
        },
      });
    this.operationTimeoutMs = options.operationTimeoutMs ?? REDIS_OPERATION_TIMEOUT_MS;
    this.client.on('error', (error: Error) => {
      writeSecurityLog({
        event: 'rate_limit_redis_error',
        level: 'error',
        fields: errorLogFields(error),
      });
    });
  }

  async consume(input: TokenBucketInput): Promise<TokenBucketDecision> {
    await this.connect();
    const raw = await withRedisTimeout(
      this.client.eval(TOKEN_BUCKET_SCRIPT, {
        keys: [input.key],
        arguments: [
          String(input.nowMs),
          String(input.capacity),
          String(input.refillIntervalMs),
          String(input.refillTokens),
          String(input.cost),
          String(tokenBucketTtlMs(input)),
        ],
      }),
      'redis rate-limit eval',
      this.operationTimeoutMs,
    );
    return parseRedisDecision(raw);
  }

  private async connect(): Promise<void> {
    if (this.client.isOpen) return;
    this.connectPromise ??= this.client.connect().catch((error: unknown) => {
      this.connectPromise = undefined;
      throw error;
    });
    await withRedisTimeout(
      this.connectPromise,
      'redis rate-limit connect',
      this.operationTimeoutMs,
    );
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
    return new RateLimiter(new RedisTokenBucketStore(redisUrl), {
      identitySecret: identitySecretFromEnv(env),
    });
  }

  if (env.NODE_ENV === 'production') {
    throw new Error('REDIS_URL must be set in production to enable app rate limiting');
  }

  return new RateLimiter(new InMemoryTokenBucketStore(), {
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
