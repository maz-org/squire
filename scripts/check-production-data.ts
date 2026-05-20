import 'dotenv/config';

import { pathToFileURL } from 'node:url';

import { sql } from 'drizzle-orm';

import { createStandaloneDb, type Db } from '../src/db.ts';

const CARD_TABLES = [
  'card_monster_stats',
  'card_monster_abilities',
  'card_character_abilities',
  'card_character_mats',
  'card_items',
  'card_events',
  'card_battle_goals',
  'card_buildings',
  'card_personal_quests',
  'card_scenarios',
] as const;

const SCENARIO_SECTION_TABLES = [
  'scenario_book_scenarios',
  'section_book_sections',
  'book_references',
] as const;

type CheckCommand = 'cards' | 'scenario-section-books' | 'embeddings' | 'all';

export function assertProductionDatabaseUrl(rawUrl: string | undefined): string {
  const url = rawUrl?.trim();
  if (!url) {
    throw new Error(
      'DATABASE_URL is required. Set the GitHub production environment secret PRODUCTION_DATABASE_URL and map it to DATABASE_URL.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new Error('DATABASE_URL must be a valid Postgres connection URL.', { cause: error });
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must use the postgres:// or postgresql:// protocol.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (['localhost', '127.0.0.1', '[::1]', '::1', 'host.docker.internal'].includes(hostname)) {
    throw new Error('Refusing to run a production data workflow against a local database.');
  }

  const dbName = decodeURIComponent(parsed.pathname.replace(/^\/+/, '')).toLowerCase();
  if (!dbName) {
    throw new Error('DATABASE_URL must include an explicit database name.');
  }
  if (dbName === 'squire' || /(^|[_-])(dev|test)($|[_-])/.test(dbName)) {
    throw new Error(
      `Refusing to run a production data workflow against dev/test database "${dbName}".`,
    );
  }

  return url;
}

export function getProductionDatabaseTargetUrl(env: NodeJS.ProcessEnv = process.env): string {
  return assertProductionDatabaseUrl(env.PRODUCTION_DATABASE_URL ?? env.DATABASE_URL);
}

export function getProductionDatabaseConnectionUrl(env: NodeJS.ProcessEnv = process.env): string {
  const targetUrl = getProductionDatabaseTargetUrl(env);
  return env.DATABASE_URL?.trim() || targetUrl;
}

export function assertProductionRuntimeEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') {
    throw new Error('NODE_ENV must be production for production data workflows.');
  }
  if (env.SQUIRE_ENV !== 'production') {
    throw new Error('SQUIRE_ENV must be production for production data workflows.');
  }
}

async function countTable(db: Db, table: string): Promise<number> {
  const result = await db.execute<{ count: number }>(
    sql.raw(`SELECT COUNT(*)::int AS count FROM ${table}`),
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function checkCards(db: Db): Promise<void> {
  const counts = new Map<string, number>();
  for (const table of CARD_TABLES) {
    counts.set(table, await countTable(db, table));
  }

  const emptyTables = [...counts.entries()]
    .filter(([, count]) => count <= 0)
    .map(([table]) => table);

  if (emptyTables.length > 0) {
    throw new Error(`Card seed sanity check failed. Empty table(s): ${emptyTables.join(', ')}`);
  }

  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  console.log(
    `OK card data sanity check passed across ${CARD_TABLES.length} tables (${total} rows).`,
  );
}

async function checkScenarioSectionBooks(db: Db): Promise<void> {
  const counts = new Map<string, number>();
  for (const table of SCENARIO_SECTION_TABLES) {
    counts.set(table, await countTable(db, table));
  }

  const emptyTables = [...counts.entries()]
    .filter(([, count]) => count <= 0)
    .map(([table]) => table);

  if (emptyTables.length > 0) {
    throw new Error(
      `Scenario/section seed sanity check failed. Empty table(s): ${emptyTables.join(', ')}`,
    );
  }

  console.log(
    `OK scenario/section data sanity check passed: ${[...counts.entries()]
      .map(([table, count]) => `${table}=${count}`)
      .join(', ')}.`,
  );
}

async function checkEmbeddings(db: Db): Promise<void> {
  const result = await db.execute<{
    count: number;
    source_count: number;
    missing_hash_count: number;
  }>(sql`
    SELECT
      COUNT(*)::int AS count,
      COUNT(DISTINCT source)::int AS source_count,
      COUNT(*) FILTER (WHERE content_hash IS NULL OR content_hash = '')::int AS missing_hash_count
    FROM embeddings
  `);

  const row = result.rows[0] ?? { count: 0, source_count: 0, missing_hash_count: 0 };
  if (row.count <= 0 || row.source_count <= 0) {
    throw new Error('Embedding sanity check failed. The embeddings table is empty.');
  }
  if (row.missing_hash_count > 0) {
    throw new Error(
      `Embedding sanity check failed. ${row.missing_hash_count} row(s) are missing content_hash.`,
    );
  }

  console.log(
    `OK embedding sanity check passed: ${row.count} chunks across ${row.source_count} source(s).`,
  );
}

async function truncateEmbeddings(db: Db): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE embeddings`);
  console.log('OK truncated embeddings for a production rebuild.');
}

async function runCheck(db: Db, command: CheckCommand): Promise<void> {
  if (command === 'cards' || command === 'all') await checkCards(db);
  if (command === 'scenario-section-books' || command === 'all') {
    await checkScenarioSectionBooks(db);
  }
  if (command === 'embeddings' || command === 'all') await checkEmbeddings(db);
}

function parseCommand(
  rawCommand: string | undefined,
): CheckCommand | 'verify-url' | 'truncate-embeddings' {
  const command = rawCommand ?? 'all';
  if (
    command === 'cards' ||
    command === 'scenario-section-books' ||
    command === 'embeddings' ||
    command === 'all' ||
    command === 'verify-url' ||
    command === 'truncate-embeddings'
  ) {
    return command;
  }
  throw new Error(
    `Unknown production data command "${command}". Expected cards, scenario-section-books, embeddings, all, verify-url, or truncate-embeddings.`,
  );
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv[2]);
  assertProductionRuntimeEnv();
  getProductionDatabaseTargetUrl();

  if (command === 'verify-url') {
    console.log('OK production database URL guard passed.');
    return;
  }

  const url = getProductionDatabaseConnectionUrl();
  const handle = createStandaloneDb({ url, max: 1 });
  try {
    if (command === 'truncate-embeddings') {
      await truncateEmbeddings(handle.db);
    } else {
      await runCheck(handle.db, command);
    }
  } finally {
    await handle.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
