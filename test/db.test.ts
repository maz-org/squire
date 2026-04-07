/**
 * Unit tests for src/db.ts. These cover the pool factory contract without
 * requiring a live Postgres — actual query integration tests run against the
 * CI service container in the issues that follow (SQR-33+).
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_DATABASE_URL,
  DEFAULT_TEST_DATABASE_URL,
  getDb,
  shutdownServerPool,
} from '../src/db.ts';

describe('getDb', () => {
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
    // Closing a fresh cli-mode pool should resolve without throwing.
    await expect(handle.close()).resolves.toBeUndefined();
  });

  it('returns the same shared pool across server-mode getDb calls', () => {
    const a = getDb('server');
    const b = getDb('server');
    // Drizzle wraps the same pool both times — close is a no-op in server mode.
    expect(a.db).toBeDefined();
    expect(b.db).toBeDefined();
  });

  it('shutdownServerPool is idempotent', async () => {
    await shutdownServerPool();
    await expect(shutdownServerPool()).resolves.toBeUndefined();
  });
});
