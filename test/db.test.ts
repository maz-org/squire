/**
 * Unit tests for src/db.ts. These cover the pool factory contract without
 * requiring a live Postgres — actual query integration tests run against the
 * CI service container in the issues that follow (SQR-33+).
 *
 * `pg` is mocked so no real Pool is ever constructed. Per the project coding
 * guidelines, unit tests mock every external service.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPoolCtor, mockEnd } = vi.hoisted(() => {
  const mockEnd = vi.fn().mockResolvedValue(undefined);
  // Must be a real constructor — src/db.ts uses `new Pool(...)`.
  function MockPool(this: { end: typeof mockEnd }) {
    this.end = mockEnd;
  }
  const mockPoolCtor = vi.fn(MockPool as unknown as new () => { end: typeof mockEnd });
  return { mockPoolCtor, mockEnd };
});

vi.mock('pg', () => ({
  default: { Pool: mockPoolCtor },
}));

import {
  DEFAULT_DATABASE_URL,
  DEFAULT_TEST_DATABASE_URL,
  getDb,
  shutdownServerPool,
} from '../src/db.ts';

describe('getDb', () => {
  beforeEach(() => {
    mockPoolCtor.mockClear();
    mockEnd.mockClear();
  });

  afterEach(async () => {
    await shutdownServerPool();
  });

  it('exposes a default DATABASE_URL pointing at the local docker-compose Postgres', () => {
    expect(DEFAULT_DATABASE_URL).toBe('postgres://squire:squire@localhost:5432/squire');
    expect(DEFAULT_TEST_DATABASE_URL).toBe('postgres://squire:squire@localhost:5432/squire_test');
  });

  it('returns a Drizzle client and a close() function in cli mode', async () => {
    const handle = getDb('cli');
    expect(handle.db).toBeDefined();
    expect(typeof handle.close).toBe('function');
    await expect(handle.close()).resolves.toBeUndefined();
    // cli mode owns its single-connection pool and must end it on close.
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  it('returns the same shared Drizzle instance across server-mode getDb calls', () => {
    const a = getDb('server');
    const b = getDb('server');
    // Contract: server mode memoizes the pool AND the drizzle wrapper, so
    // repeated calls return the identical db handle.
    expect(a.db).toBe(b.db);
    // And only one Pool was ever constructed.
    expect(mockPoolCtor).toHaveBeenCalledTimes(1);
  });

  it('server-mode close() is a no-op — shutdownServerPool owns the pool lifetime', async () => {
    const handle = getDb('server');
    await handle.close();
    expect(mockEnd).not.toHaveBeenCalled();
  });

  it('shutdownServerPool ends the shared pool and clears the cached db', async () => {
    getDb('server');
    await shutdownServerPool();
    expect(mockEnd).toHaveBeenCalledTimes(1);

    // After shutdown, a fresh getDb('server') call must build a new pool.
    getDb('server');
    expect(mockPoolCtor).toHaveBeenCalledTimes(2);
  });

  it('shutdownServerPool is idempotent', async () => {
    await shutdownServerPool();
    await expect(shutdownServerPool()).resolves.toBeUndefined();
  });
});
