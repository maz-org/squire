/**
 * Apply pending Drizzle migrations against the database in `DATABASE_URL`
 * (defaults to the local docker-compose Postgres). Used by `npm run db:migrate`
 * and by CI before integration tests run.
 */
import 'dotenv/config';

import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import {
  createStandaloneDb,
  getDatabaseNameFromUrl,
  isManagedLocalDatabaseUrl,
  resolveDatabaseUrl,
} from '../src/db.ts';
import { runScriptWithTelemetry } from '../src/script-telemetry.ts';

const { Pool } = pg;

async function main(): Promise<void> {
  // `resolveDatabaseUrl()` picks the right default based on the environment:
  // - `NODE_ENV=test` (or `VITEST=true`) → test DB, overridable via TEST_DATABASE_URL
  // - anything else → dev DB, overridable via DATABASE_URL
  //
  // This keeps `npm run db:migrate` and `npm run db:migrate:test` in sync
  // with the rest of the app's URL resolution — no more explicit
  // `DATABASE_URL=...` incantations for the test database.
  const url = resolveDatabaseUrl();
  await ensureManagedLocalDatabaseExists(url);
  const handle = createStandaloneDb({ url, max: 1 });
  try {
    await ensureVectorExtension(handle);
    await migrate(handle.db, { migrationsFolder: './src/db/migrations' });
    console.log(`✓ migrations applied to ${redact(url)}`);
  } finally {
    await handle.close();
  }
}

async function ensureManagedLocalDatabaseExists(url: string): Promise<void> {
  if (!isManagedLocalDatabaseUrl(url)) return;

  const dbName = getDatabaseNameFromUrl(url);
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';

  const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
  try {
    const result = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (result.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${dbName}"`);
      console.log(`✓ created managed local database "${dbName}"`);
    }
  } finally {
    await admin.end();
  }
}

async function ensureVectorExtension(handle: Awaited<ReturnType<typeof createStandaloneDb>>) {
  try {
    await handle.db.execute(sql.raw('CREATE EXTENSION IF NOT EXISTS vector'));
  } catch (error) {
    if (!isPgVectorPermissionError(error)) throw error;
    if (await isVectorExtensionInstalled(handle.db.$client)) return;
    throw new Error(pgVectorExtensionSetupMessage(), { cause: error });
  }
}

async function isVectorExtensionInstalled(client: pg.Pool): Promise<boolean> {
  const result = await client.query(
    "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS installed",
  );
  return result.rows[0]?.installed === true;
}

export function isPgVectorPermissionError(error: unknown): boolean {
  const candidate = error as {
    query?: unknown;
    cause?: { code?: unknown; message?: unknown };
  };
  return (
    candidate?.cause?.code === '42501' &&
    typeof candidate.query === 'string' &&
    candidate.query.includes('CREATE EXTENSION') &&
    candidate.query.includes('vector')
  );
}

export function pgVectorExtensionSetupMessage(): string {
  return [
    'pgvector is not enabled for this database, and the app database role cannot create it.',
    'For Fly Managed Postgres, enable the vector extension in the dashboard Extensions page for database fly-db, schema public, then rerun the deploy.',
  ].join(' ');
}

function redact(url: string): string {
  return url.replace(/\/\/[^@]*@/, '//***:***@');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runScriptWithTelemetry(main, {
    scriptName: 'db-migrate',
    scriptKind: 'release_command',
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
