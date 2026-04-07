/**
 * drizzle-kit configuration.
 *
 * Schema lives in `src/db/schema/` (split into core/auth/cards so the
 * Storage & Data Migration project's parallel lanes can edit different
 * files without conflicts). Migrations are committed under
 * `src/db/migrations/` and run by `npm run db:migrate`.
 */
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://squire:squire@localhost:5432/squire',
  },
  strict: true,
  verbose: true,
});
