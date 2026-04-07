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

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { DEFAULT_DATABASE_URL } from '../src/db.ts';

const { Pool } = pg;

const ALLOWED_DB_NAMES = new Set(['squire', 'squire_test']);

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const dbName = new URL(url).pathname.replace(/^\//, '');

  if (!ALLOWED_DB_NAMES.has(dbName)) {
    console.error(
      `refusing to reset database "${dbName}" — db:reset only targets ` +
        `${[...ALLOWED_DB_NAMES].join(', ')}. Set DATABASE_URL to a dev DB.`,
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
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: './src/db/migrations' });
    console.log(`✓ reset "${dbName}" and applied migrations`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
