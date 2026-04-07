/**
 * Apply pending Drizzle migrations against the database in `DATABASE_URL`
 * (defaults to the local docker-compose Postgres). Used by `npm run db:migrate`
 * and by CI before integration tests run.
 */
import 'dotenv/config';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { DEFAULT_DATABASE_URL } from '../src/db.ts';

const { Pool } = pg;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: './src/db/migrations' });
    console.log(`✓ migrations applied to ${redact(url)}`);
  } finally {
    await pool.end();
  }
}

function redact(url: string): string {
  return url.replace(/\/\/[^@]*@/, '//***:***@');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
