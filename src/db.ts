/**
 * Drizzle client + pool factory.
 *
 * Two modes:
 * - `server` — shared pool (~10 connections), lives for the process lifetime.
 *   `src/server.ts` calls `shutdownServerPool()` from its SIGTERM handler.
 * - `cli`    — single connection. The caller MUST `await close()` before
 *   process exit, otherwise the script hangs on the open socket.
 *
 * Contract documented in `docs/plans/storage-migration-tech-spec.md`
 * §`src/db.ts` contract — keep this file in sync with that section.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './db/schema/index.ts';

const { Pool } = pg;

export type DbMode = 'server' | 'cli';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface DbHandle {
  db: Db;
  /**
   * In `server` mode this is a no-op — the shared pool lives for the process
   * lifetime and is closed via `shutdownServerPool()`. In `cli` mode this
   * ends the underlying single-connection pool.
   */
  close: () => Promise<void>;
}

let serverPool: pg.Pool | null = null;

/**
 * Default to the local docker-compose Postgres. These URLs are constant
 * across dev machines (the docker-compose service binds to localhost:5432
 * with fixed credentials), so we don't force every contributor to copy them
 * into a `.env` file. Production hosts override `DATABASE_URL` via real env
 * vars; tests override `TEST_DATABASE_URL` the same way.
 */
export const DEFAULT_DATABASE_URL = 'postgres://squire:squire@localhost:5432/squire';
export const DEFAULT_TEST_DATABASE_URL = 'postgres://squire:squire@localhost:5432/squire_test';

/**
 * Resolve the connection string. Under vitest (`VITEST=true`) we default to
 * the test database so a stray `getDb()` in a test can never touch dev data.
 * Outside tests we default to the dev database. Either default can be
 * overridden via `DATABASE_URL` / `TEST_DATABASE_URL`.
 */
function resolveDatabaseUrl(): string {
  const isTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
  if (isTest) {
    return process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  }
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

/**
 * Get a Drizzle client. See module docstring for mode semantics.
 */
export function getDb(mode: DbMode = 'server'): DbHandle {
  if (mode === 'server') {
    serverPool ??= new Pool({
      connectionString: resolveDatabaseUrl(),
      max: 10,
      idleTimeoutMillis: 30_000,
    });
    return {
      db: drizzle(serverPool, { schema }),
      // Server pool lives for the process lifetime — caller uses
      // shutdownServerPool() at SIGTERM time instead.
      close: async () => {},
    };
  }

  const pool = new Pool({
    connectionString: resolveDatabaseUrl(),
    max: 1,
  });
  return {
    db: drizzle(pool, { schema }),
    close: async () => {
      await pool.end();
    },
  };
}

/**
 * Close the shared server-mode pool. Idempotent — calling it without an
 * active pool is a no-op. Wired into `src/server.ts` SIGTERM/SIGINT handlers.
 */
export async function shutdownServerPool(): Promise<void> {
  if (serverPool) {
    const pool = serverPool;
    serverPool = null;
    await pool.end();
  }
}

export { schema };
