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
import { relations } from './db/schema/relations.ts';
import { getWorktreeRuntime } from './worktree-runtime.ts';

export type DbMode = 'server' | 'cli';

export type Db = ReturnType<typeof drizzle<typeof relations>>;

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
let serverDb: ReturnType<typeof drizzle<typeof relations>> | null = null;

interface DbConnectionOptions {
  url?: string;
  max?: number;
  idleTimeoutMillis?: number;
}

function createDrizzleClient({
  url = resolveDatabaseUrl(),
  max = 1,
  idleTimeoutMillis,
}: DbConnectionOptions = {}): Db {
  const connection: pg.PoolConfig = {
    connectionString: url,
    max,
  };
  if (idleTimeoutMillis !== undefined) {
    connection.idleTimeoutMillis = idleTimeoutMillis;
  }
  return drizzle({ connection, relations });
}

export function createStandaloneDb(
  options: Omit<DbConnectionOptions, 'idleTimeoutMillis'> = {},
): DbHandle {
  const db = createDrizzleClient({
    url: options.url,
    max: options.max ?? 1,
  });
  return {
    db,
    close: async () => {
      await db.$client.end();
    },
  };
}

export function createPooledDb(options: DbConnectionOptions = {}): DbHandle {
  const db = createDrizzleClient({
    url: options.url,
    max: options.max ?? 10,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
  });
  return {
    db,
    close: async () => {
      await db.$client.end();
    },
  };
}

function buildLocalDatabaseUrl(dbName: string): string {
  return `postgres://squire:squire@localhost:5432/${dbName}`;
}

export function getManagedDatabaseNames(): {
  devDatabaseName: string;
  testDatabaseName: string;
} {
  const runtime = getWorktreeRuntime();
  return {
    devDatabaseName: runtime.devDatabaseName,
    testDatabaseName: runtime.testDatabaseName,
  };
}

export const DEFAULT_DATABASE_URL = buildLocalDatabaseUrl(
  getManagedDatabaseNames().devDatabaseName,
);
export const DEFAULT_TEST_DATABASE_URL = buildLocalDatabaseUrl(
  getManagedDatabaseNames().testDatabaseName,
);

export function getDefaultPort(): number {
  return getWorktreeRuntime().defaultPort;
}

/**
 * Resolve the connection string. Under vitest (`VITEST=true`) we default to
 * the test database so a stray `getDb()` in a test can never touch dev data.
 * Outside tests we default to the dev database. Either default can be
 * overridden via `DATABASE_URL` / `TEST_DATABASE_URL`.
 */
export function resolveDatabaseUrl(): string {
  const isTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
  if (isTest) {
    return process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  }
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

export function getDatabaseNameFromUrl(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

export function isManagedLocalDatabaseUrl(url: string): boolean {
  const parsed = new URL(url);
  const { devDatabaseName, testDatabaseName } = getManagedDatabaseNames();
  const dbName = getDatabaseNameFromUrl(url);
  return (
    ['localhost', '127.0.0.1'].includes(parsed.hostname) &&
    parsed.port === '5432' &&
    [devDatabaseName, testDatabaseName].includes(dbName)
  );
}

/**
 * Get a Drizzle client. See module docstring for mode semantics.
 */
export function getDb(mode: DbMode = 'server'): DbHandle {
  if (mode === 'server') {
    if (!serverPool) {
      const handle = createPooledDb();
      serverDb = handle.db;
      serverPool = handle.db.$client;
    }
    return {
      // Non-null assertion is safe: serverDb is set in lockstep with serverPool.
      db: serverDb!,
      // Server pool lives for the process lifetime — caller uses
      // shutdownServerPool() at SIGTERM time instead.
      close: async () => {},
    };
  }

  return createStandaloneDb();
}

/**
 * Close the shared server-mode pool. Idempotent — calling it without an
 * active pool is a no-op. Wired into `src/server.ts` SIGTERM/SIGINT handlers.
 */
export async function shutdownServerPool(): Promise<void> {
  if (serverPool) {
    const pool = serverPool;
    serverPool = null;
    serverDb = null;
    await pool.end();
  }
}

export { schema };
export { relations };
export { getWorktreeRuntime } from './worktree-runtime.ts';
