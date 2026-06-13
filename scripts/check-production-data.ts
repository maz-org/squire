import 'dotenv/config';

import { pathToFileURL } from 'node:url';

import { sql } from 'drizzle-orm';

import { createStandaloneDb, shutdownServerPool, type Db } from '../src/db.ts';
import { requireGameId, SUPPORTED_GAME_IDS } from '../src/game.ts';
import type { GameId } from '../src/game.ts';
import { getCard, searchRules } from '../src/tools.ts';

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

type CheckCommand = 'cards' | 'scenario-section-books' | 'unlock-graphs' | 'embeddings' | 'all';
type ProductionDataCommand = CheckCommand | 'smoke' | 'verify-url' | 'truncate-embeddings';

export interface ProductionDataOptions {
  command: ProductionDataCommand;
  games: GameId[];
}

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
  const connectionUrl = env.DATABASE_URL?.trim();
  if (!connectionUrl || connectionUrl === targetUrl) return connectionUrl || targetUrl;

  let parsed: URL;
  try {
    parsed = new URL(connectionUrl);
  } catch (error) {
    throw new Error('DATABASE_URL must be a valid Postgres connection URL.', { cause: error });
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must use the postgres:// or postgresql:// protocol.');
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocalProxy = ['localhost', '127.0.0.1', '[::1]', '::1', 'host.docker.internal'].includes(
    hostname,
  );
  if (!isLocalProxy) {
    throw new Error(
      'DATABASE_URL may only override PRODUCTION_DATABASE_URL with a local Fly proxy URL.',
    );
  }

  return connectionUrl;
}

export function assertProductionRuntimeEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') {
    throw new Error('NODE_ENV must be production for production data workflows.');
  }
  if (env.SQUIRE_ENV !== 'production') {
    throw new Error('SQUIRE_ENV must be production for production data workflows.');
  }
}

async function countTableForGame(db: Db, table: string, game: GameId): Promise<number> {
  const result = await db.execute<{ count: number }>(
    sql`SELECT COUNT(*)::int AS count FROM ${sql.raw(table)} WHERE game = ${game}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

const REQUIRED_CARD_TABLES_BY_GAME: Record<GameId, readonly (typeof CARD_TABLES)[number][]> = {
  frosthaven: CARD_TABLES,
  // Upstream GHS does not publish GH2 buildings yet. Treat that as expected
  // missing coverage while still requiring every supported GH2 card table.
  'gloomhaven-2e': CARD_TABLES.filter((table) => table !== 'card_buildings'),
};

async function checkCards(db: Db, games: readonly GameId[]): Promise<void> {
  const counts = new Map<string, number>();
  for (const game of games) {
    for (const table of REQUIRED_CARD_TABLES_BY_GAME[game]) {
      counts.set(`${game}/${table}`, await countTableForGame(db, table, game));
    }
  }

  const emptyTables = [...counts.entries()]
    .filter(([, count]) => count <= 0)
    .map(([table]) => table);

  if (emptyTables.length > 0) {
    throw new Error(`Card seed sanity check failed. Empty table(s): ${emptyTables.join(', ')}`);
  }

  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  console.log(
    `OK card data sanity check passed for ${games.join(', ')} across ${counts.size} game/table pair(s) (${total} rows).`,
  );
}

async function checkScenarioSectionBooks(db: Db, games: readonly GameId[]): Promise<void> {
  const counts = new Map<string, number>();
  for (const game of games) {
    for (const table of SCENARIO_SECTION_TABLES) {
      counts.set(`${game}/${table}`, await countTableForGame(db, table, game));
    }
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

async function checkUnlockGraphs(db: Db, games: readonly GameId[]): Promise<void> {
  // The dashboard's loadModuleGraphs() reads unlock_graph_scenarios; an empty
  // table for a campaign's game silently renders "No scenario data" rather than
  // erroring, so the seed gap is invisible without this check. Every supported
  // game has a curated graph (frosthaven=fh, gloomhaven-2e=gh2e+solo2e), so a
  // zero count is always a missing seed, never expected-empty coverage.
  const counts = new Map<GameId, number>();
  for (const game of games) {
    counts.set(game, await countTableForGame(db, 'unlock_graph_scenarios', game));
  }

  const emptyGames = [...counts.entries()].filter(([, count]) => count <= 0).map(([game]) => game);
  if (emptyGames.length > 0) {
    throw new Error(
      `Unlock-graph seed sanity check failed. No unlock_graph_scenarios rows for: ${emptyGames.join(', ')}`,
    );
  }

  console.log(
    `OK unlock-graph data sanity check passed: ${[...counts.entries()]
      .map(([game, count]) => `${game}=${count}`)
      .join(', ')}.`,
  );
}

async function checkEmbeddingsForGames(db: Db, games: readonly GameId[]): Promise<void> {
  for (const game of games) {
    await checkEmbeddingsForGame(db, game);
  }
}

async function checkEmbeddingsForGame(db: Db, game: GameId): Promise<void> {
  const result = await db.execute<{
    count: number;
    source_count: number;
    missing_hash_count: number;
  }>(sql`
    SELECT
      COUNT(*)::int AS count,
      COUNT(DISTINCT source)::int AS source_count,
      COUNT(*) FILTER (WHERE content_hash IS NULL OR content_hash = '')::int AS missing_hash_count
    FROM rule_source_embeddings
    WHERE game = ${game}
  `);

  const row = result.rows[0] ?? { count: 0, source_count: 0, missing_hash_count: 0 };
  if (row.count <= 0 || row.source_count <= 0) {
    throw new Error(
      `Embedding sanity check failed for ${game}. The rule_source_embeddings table has no rows for that game.`,
    );
  }
  if (row.missing_hash_count > 0) {
    throw new Error(
      `Embedding sanity check failed for ${game}. ${row.missing_hash_count} row(s) are missing content_hash.`,
    );
  }

  console.log(
    `OK embedding sanity check passed for ${game}: ${row.count} chunks across ${row.source_count} source(s).`,
  );
}

async function truncateEmbeddings(db: Db, games: readonly GameId[]): Promise<void> {
  if (games.length === SUPPORTED_GAME_IDS.length) {
    await db.execute(sql`TRUNCATE TABLE rule_source_embeddings`);
    console.log('OK truncated embeddings for every production game.');
    return;
  }

  for (const game of games) {
    await db.execute(sql`DELETE FROM rule_source_embeddings WHERE game = ${game}`);
  }
  console.log(`OK truncated embeddings for production game scope: ${games.join(', ')}.`);
}

const SMOKE_CARD_CHECKS: Record<GameId, { id: string; name: string }> = {
  frosthaven: { id: 'gloomhavensecretariat:item/1', name: 'Spyglass' },
  'gloomhaven-2e': { id: 'gloomhavensecretariat:item/1', name: 'Weathered Boots' },
};

function smokeGamesForScope(games: readonly GameId[]): GameId[] {
  const smokeGames = new Set<GameId>(games);
  if (smokeGames.has('gloomhaven-2e')) smokeGames.add('frosthaven');
  return [...SUPPORTED_GAME_IDS].filter((game) => smokeGames.has(game));
}

async function checkRulesSmoke(game: GameId): Promise<void> {
  const hits = await searchRules('advantage and disadvantage', 3, { game });
  if (hits.length <= 0) {
    throw new Error(`Production smoke failed for ${game}: rules search returned no hits.`);
  }
  const wrongGameHit = hits.find((hit) => hit.game !== game);
  if (wrongGameHit) {
    throw new Error(
      `Production smoke failed for ${game}: rules search returned ${wrongGameHit.game} source ${wrongGameHit.source}.`,
    );
  }
}

async function checkStructuredSmoke(game: GameId): Promise<void> {
  const expected = SMOKE_CARD_CHECKS[game];
  const card = await getCard('items', expected.id, { game });
  if (!card) {
    throw new Error(`Production smoke failed for ${game}: item ${expected.id} was not found.`);
  }
  if (card.name !== expected.name) {
    throw new Error(
      `Production smoke failed for ${game}: item ${expected.id} resolved to ${JSON.stringify(
        card.name,
      )}, expected ${JSON.stringify(expected.name)}.`,
    );
  }
}

async function runSmoke(games: readonly GameId[]): Promise<void> {
  const smokeGames = smokeGamesForScope(games);
  for (const game of smokeGames) {
    await checkRulesSmoke(game);
    await checkStructuredSmoke(game);
  }
  console.log(`OK production smoke checks passed for ${smokeGames.join(', ')}.`);
}

async function runCheck(db: Db, command: CheckCommand, games: readonly GameId[]): Promise<void> {
  if (command === 'cards' || command === 'all') await checkCards(db, games);
  if (command === 'scenario-section-books' || command === 'all') {
    await checkScenarioSectionBooks(db, games);
  }
  if (command === 'unlock-graphs' || command === 'all') await checkUnlockGraphs(db, games);
  if (command === 'embeddings' || command === 'all') await checkEmbeddingsForGames(db, games);
}

function parseCommand(rawCommand: string | undefined): ProductionDataCommand {
  const command = rawCommand ?? 'all';
  if (
    command === 'cards' ||
    command === 'scenario-section-books' ||
    command === 'unlock-graphs' ||
    command === 'embeddings' ||
    command === 'all' ||
    command === 'smoke' ||
    command === 'verify-url' ||
    command === 'truncate-embeddings'
  ) {
    return command;
  }
  throw new Error(
    `Unknown production data command "${command}". Expected cards, scenario-section-books, unlock-graphs, embeddings, all, smoke, verify-url, or truncate-embeddings.`,
  );
}

function resolveGameScope(rawGame: string | undefined): GameId[] {
  if (!rawGame || rawGame === 'all') return [...SUPPORTED_GAME_IDS];
  return [requireGameId(rawGame)];
}

export function parseProductionDataOptions(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): ProductionDataOptions {
  const args = [...argv];
  let commandArg: string | undefined;
  let rawGame: string | undefined;

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--game') {
      rawGame = args.shift();
      if (!rawGame) throw new Error('--game requires a value.');
      continue;
    }
    if (arg?.startsWith('--game=')) {
      rawGame = arg.slice('--game='.length);
      if (!rawGame) throw new Error('--game requires a value.');
      continue;
    }
    if (arg?.startsWith('-')) {
      throw new Error(`Unknown production data option "${arg}". Expected --game <game>.`);
    }
    if (commandArg !== undefined) {
      throw new Error(`Unexpected extra production data command "${arg}".`);
    }
    commandArg = arg;
  }

  const command = parseCommand(commandArg);
  return {
    command,
    games: resolveGameScope(rawGame ?? env.SQUIRE_DATA_GAME),
  };
}

async function main(): Promise<void> {
  const { command, games } = parseProductionDataOptions();
  assertProductionRuntimeEnv();
  getProductionDatabaseTargetUrl();

  if (command === 'verify-url') {
    console.log('OK production database URL guard passed.');
    return;
  }

  const url = getProductionDatabaseConnectionUrl();
  if (command === 'smoke') {
    try {
      await runSmoke(games);
    } finally {
      await shutdownServerPool();
    }
    return;
  }

  const handle = createStandaloneDb({ url, max: 1 });
  try {
    if (command === 'truncate-embeddings') {
      await truncateEmbeddings(handle.db, games);
    } else {
      await runCheck(handle.db, command, games);
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
