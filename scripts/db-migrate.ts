/**
 * Apply pending Drizzle migrations against the database in `DATABASE_URL`
 * (defaults to the local docker-compose Postgres). Used by `npm run db:migrate`
 * and by CI before integration tests run.
 */
import 'dotenv/config';

import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import {
  createStandaloneDb,
  getDatabaseNameFromUrl,
  isManagedLocalDatabaseUrl,
  resolveDatabaseUrl,
} from '../src/db.ts';

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
    await handle.db.execute(sql.raw('CREATE EXTENSION IF NOT EXISTS vector'));
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

function redact(url: string): string {
  return url.replace(/\/\/[^@]*@/, '//***:***@');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
