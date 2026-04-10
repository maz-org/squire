/**
 * Destructive: drop and recreate the dev database, then re-run migrations.
 * Requires explicit confirmation via stdin (or `--yes` for CI/script use).
 *
 * Never runs against a URL whose database name isn't one of the known dev
 * databases — guards against an accidental `DATABASE_URL=prod` reset.
 */
import 'dotenv/config';

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import {
  createStandaloneDb,
  getDatabaseNameFromUrl,
  getManagedDatabaseNames,
  isManagedLocalDatabaseUrl,
  resolveDatabaseUrl,
} from '../src/db.ts';

const { Pool } = pg;

async function main(): Promise<void> {
  // Shares URL resolution with the rest of the app — `NODE_ENV=test`
  // targets the test DB, otherwise the dev DB. `npm run db:reset:test`
  // is the test-DB entry point; no explicit `DATABASE_URL=...` needed.
  const url = resolveDatabaseUrl();
  const dbName = getDatabaseNameFromUrl(url);
  const allowedDbNames = new Set(Object.values(getManagedDatabaseNames()));

  if (!isManagedLocalDatabaseUrl(url) || !allowedDbNames.has(dbName)) {
    console.error(
      `refusing to reset database "${dbName}" — db:reset only targets ` +
        `${[...allowedDbNames].join(', ')} for this checkout.`,
    );
    process.exit(1);
  }

  const yes = process.argv.includes('--yes');
  if (!yes) {
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = await rl.question(
      `This will DROP ALL DATA in database "${dbName}". Type the db name to confirm: `,
    );
    rl.close();
    if (answer.trim() !== dbName) {
      console.error('aborted.');
      process.exit(1);
    }
  }

  // Connect to the `postgres` maintenance DB to drop/create the target DB.
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }

  // Reapply migrations against the fresh DB.
  const handle = createStandaloneDb({ url, max: 1 });
  try {
    await handle.db.execute(sql.raw('CREATE EXTENSION IF NOT EXISTS vector'));
    await migrate(handle.db, { migrationsFolder: './src/db/migrations' });
    console.log(`✓ reset "${dbName}" and applied migrations`);
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
