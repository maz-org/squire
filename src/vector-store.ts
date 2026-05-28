/**
 * Retrieval layer: rule-source vector store backed by Postgres + pgvector.
 *
 * Replaces the previous flat-file `data/index.json` implementation. Everything
 * this module exports — including `EMBEDDING_VERSION` and the drift guard —
 * belongs to the retrieval layer, not the service layer, so `service.ts` stays
 * a thin orchestrator.
 *
 * See `docs/plans/storage-migration-tech-spec.md` §"pgvector operator sign-flip"
 * for the critical detail: pgvector's `<=>` operator returns cosine *distance*
 * (low = more similar), but the existing `ScoredEntry` contract is "high score
 * = more similar". `search()` preserves the old contract by converting distance
 * to similarity in the SELECT clause while still letting the ORDER BY use the
 * raw operator so the HNSW index can serve the query.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';

import { getDb } from './db.ts';
import { embeddings as embeddingsTable } from './db/schema/core.ts';
import { DEFAULT_GAME_ID, requireGameId } from './game.ts';
import type { GameId } from './game.ts';
import { searchVoyageExperiment, usesVoyageExperimentEmbeddings } from './retrieval-experiment.ts';

export interface IndexEntry {
  id: string;
  text: string;
  embedding: number[];
  source: string;
  chunkIndex: number;
  contentHash?: string;
  /**
   * Optional on input — defaults to `'frosthaven'` at insert time via the
   * column default. Phase 2 starts populating this per-row from the PDF
   * filename prefix in `index-docs.ts`.
   */
  game?: GameId;
}

export interface ScoredEntry {
  id: string;
  text: string;
  source: string;
  chunkIndex: number;
  game: GameId;
  score: number;
  scoreKind?: 'vector' | 'rerank';
}

export interface SearchOptions {
  /** Game filter. Defaults to `'frosthaven'`. */
  game?: GameId | string;
}

/**
 * Bumped whenever chunking logic in `index-docs.ts` or the embedder model
 * changes. Stamped onto every row inserted via `addEntries()` and checked
 * on server startup by `checkEmbeddingVersion()` as a drift guard.
 */
export const EMBEDDING_VERSION = 'xenova-minilm-l6-v2.v1';

const DEFAULT_GAME = DEFAULT_GAME_ID;

function resolveGame(game?: GameId | string): GameId {
  if (game === undefined) return DEFAULT_GAME;
  return requireGameId(game);
}

/**
 * Ensure the HNSW cosine index exists on `embeddings.embedding`.
 *
 * Called by `index-docs.ts` after the bulk insert completes. HNSW is much
 * cheaper to build once against a populated table than to maintain during
 * row-by-row inserts — building post-insert keeps a fresh `npm run index`
 * fast on an empty database. If the index already exists (reindex on top of
 * an existing corpus), this is a no-op and the existing index continues to
 * serve queries.
 */
export async function ensureHnswIndex(): Promise<void> {
  const { db } = getDb('server');
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS embeddings_hnsw_idx
      ON embeddings
      USING hnsw (embedding vector_cosine_ops)
  `);
}

async function insertEntries(
  entries: IndexEntry[],
  dbOrTx: Pick<ReturnType<typeof getDb>['db'], 'insert'>,
): Promise<void> {
  if (entries.length === 0) return;

  const CHUNK = 500;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const batch = entries.slice(i, i + CHUNK);
    await dbOrTx
      .insert(embeddingsTable)
      .values(
        batch.map((e) => ({
          id: e.id,
          source: e.source,
          chunkIndex: e.chunkIndex,
          text: e.text,
          embedding: e.embedding,
          game: resolveGame(e.game),
          embeddingVersion: EMBEDDING_VERSION,
          contentHash: e.contentHash,
        })),
      )
      .onConflictDoNothing({
        target: [embeddingsTable.game, embeddingsTable.source, embeddingsTable.chunkIndex],
      });
  }
}

/**
 * Upsert new rule-source chunk embeddings into the `embeddings` table.
 *
 * Idempotent: uses `ON CONFLICT (game, source, chunk_index) DO NOTHING`, so
 * indexing the same source twice is a no-op. Changed sources should use
 * `replaceEntriesForSources()` so stale chunks are removed in the same
 * transaction that inserts their replacements.
 *
 * Every row is stamped with the current `EMBEDDING_VERSION` as a drift guard.
 */
export async function addEntries(entries: IndexEntry[]): Promise<void> {
  if (entries.length === 0) return;

  const { db } = getDb('server');
  // Chunk the insert so we don't blow the Postgres parameter limit on
  // pathological PDFs. 500 rows × 7 cols = 3500 params, safely below 65535.
  // Wrap the whole batching loop in a single transaction so a crash mid-way
  // can't leave the table with a partial subset of chunks for a given source.
  await db.transaction(async (tx) => {
    await insertEntries(entries, tx);
  });
}

export async function replaceEntriesForSources(
  replacedSourcesByGame: Map<GameId, string[]>,
  entries: IndexEntry[],
): Promise<number> {
  const replacementCount = [...replacedSourcesByGame.values()].reduce(
    (count, sources) => count + sources.length,
    0,
  );
  if (replacementCount === 0) {
    await addEntries(entries);
    return 0;
  }

  const { db } = getDb('server');
  let deletedCount = 0;
  await db.transaction(async (tx) => {
    for (const [game, sources] of replacedSourcesByGame) {
      if (sources.length === 0) continue;
      const rows = await tx
        .delete(embeddingsTable)
        .where(and(eq(embeddingsTable.game, game), inArray(embeddingsTable.source, sources)))
        .returning({ id: embeddingsTable.id });
      deletedCount += rows.length;
    }

    await insertEntries(entries, tx);
  });

  return deletedCount;
}

/**
 * Return the set of `source` values already present in the embeddings table.
 * Used by `index-docs.ts` to skip PDFs that are already indexed.
 */
export async function getIndexedSources(
  game: GameId | string = DEFAULT_GAME,
): Promise<Set<string>> {
  const resolvedGame = resolveGame(game);
  try {
    const { db } = getDb('server');
    const rows = await db.execute<{ source: string }>(
      sql`SELECT DISTINCT source FROM embeddings WHERE game = ${resolvedGame}`,
    );
    return new Set(rows.rows.map((r) => r.source));
  } catch (err) {
    throw wrapDbError(err);
  }
}

/**
 * Return PDF source hashes already represented in the embeddings table.
 *
 * A null hash means the source exists only as pre-SQR-47 rows. The indexer
 * treats that as stale because it cannot prove the derived chunks match the
 * current checked-in PDF bytes.
 */
export async function getIndexedSourceHashes(
  game: GameId | string = DEFAULT_GAME,
): Promise<Map<string, string | null>> {
  const resolvedGame = resolveGame(game);
  try {
    const { db } = getDb('server');
    const rows = await db.execute<{ source: string; content_hash: string | null }>(sql`
      SELECT
        source,
        CASE
          WHEN COUNT(*) FILTER (WHERE content_hash IS NULL) > 0 THEN NULL
          WHEN COUNT(DISTINCT content_hash) = 1 THEN MIN(content_hash)
          ELSE NULL
        END AS content_hash
      FROM embeddings
      WHERE game = ${resolvedGame}
      GROUP BY source
    `);
    return new Map(rows.rows.map((r) => [r.source, r.content_hash]));
  } catch (err) {
    throw wrapDbError(err);
  }
}

export async function deleteEntriesForSources(
  sources: string[],
  game: GameId | string = DEFAULT_GAME,
): Promise<number> {
  if (sources.length === 0) return 0;

  const resolvedGame = resolveGame(game);
  try {
    const { db } = getDb('server');
    const rows = await db
      .delete(embeddingsTable)
      .where(and(eq(embeddingsTable.game, resolvedGame), inArray(embeddingsTable.source, sources)))
      .returning({ id: embeddingsTable.id });
    return rows.length;
  } catch (err) {
    throw wrapDbError(err);
  }
}

/**
 * Top-k nearest-neighbour search over the `embeddings` table.
 *
 * Returns a `ScoredEntry[]` with the existing contract: `score` is a cosine
 * similarity in `[0, 1]` (high = more similar). See the module-level comment
 * for the operator sign-flip explanation.
 */
export async function search(
  queryEmbedding: number[],
  k = 8,
  opts: SearchOptions = {},
): Promise<ScoredEntry[]> {
  const game = resolveGame(opts.game);
  if (usesVoyageExperimentEmbeddings()) {
    return searchVoyageExperiment(queryEmbedding, k, game);
  }
  const vectorLiteral = `[${queryEmbedding.join(',')}]`;

  try {
    const { db } = getDb('server');
    const result = await db.execute<{
      id: string;
      source: string;
      chunk_index: number;
      text: string;
      game: GameId;
      score: number;
    }>(sql`
      SELECT
        id,
        source,
        chunk_index,
        text,
        game,
        1 - (embedding <=> ${vectorLiteral}::vector) AS score
      FROM embeddings
      WHERE game = ${game}
      ORDER BY embedding <=> ${vectorLiteral}::vector
      LIMIT ${k}
    `);

    return result.rows.map((r) => ({
      id: r.id,
      source: r.source,
      chunkIndex: Number(r.chunk_index),
      text: r.text,
      game: r.game,
      // Postgres numeric arithmetic can return strings in edge cases; coerce.
      score: Number(r.score),
      scoreKind: 'vector',
    }));
  } catch (err) {
    throw wrapDbError(err);
  }
}

export async function getEntryBySourceChunk(
  source: string,
  chunkIndex: number,
  opts: SearchOptions = {},
): Promise<ScoredEntry | null> {
  const game = resolveGame(opts.game);

  try {
    const { db } = getDb('server');
    const result = await db.execute<{
      id: string;
      source: string;
      chunk_index: number;
      text: string;
      game: GameId;
    }>(sql`
      SELECT id, source, chunk_index, text, game
      FROM embeddings
      WHERE game = ${game}
        AND source = ${source}
        AND chunk_index = ${chunkIndex}
      LIMIT 1
    `);

    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      source: row.source,
      chunkIndex: Number(row.chunk_index),
      text: row.text,
      game: row.game,
      score: 1,
      scoreKind: 'vector',
    };
  } catch (err) {
    throw wrapDbError(err);
  }
}

function wrapDbError(err: unknown): Error {
  const msg = (err as Error).message ?? String(err);
  return new Error(
    `vector-store query failed: ${msg}. ` +
      'Is Postgres running? Try `docker compose up -d` and `npm run db:migrate`.',
  );
}

export const EMBEDDINGS_BOOTSTRAP_MESSAGE =
  'Embeddings table is empty. Run `npm run index` to populate the rule-source vector store.';

export interface RetrievalBootstrapStatus {
  ready: boolean;
  indexSize: number;
  error?: string;
  missingStep?: 'npm run index';
  reason?: 'missing_index' | 'dependency_unavailable';
}

export async function getRetrievalBootstrapStatus(): Promise<RetrievalBootstrapStatus> {
  try {
    const { db } = getDb('server');
    const result = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count FROM embeddings`,
    );
    const count = Number(result.rows[0]?.count ?? 0);
    if (count === 0) {
      return {
        ready: false,
        indexSize: 0,
        error: EMBEDDINGS_BOOTSTRAP_MESSAGE,
        missingStep: 'npm run index',
        reason: 'missing_index',
      };
    }
    return { ready: true, indexSize: count };
  } catch (err) {
    return {
      ready: false,
      indexSize: 0,
      error: wrapDbError(err).message,
      reason: 'dependency_unavailable',
    };
  }
}

/**
 * Bring the retrieval layer into a ready state: verify the embeddings table
 * is populated, warm the embedder, and run the embedding-version drift guard.
 *
 * Throws if the table is empty — that's an unrecoverable misconfiguration
 * (data not indexed yet) and the caller needs to surface it loudly.
 */
export async function initializeRetrieval(
  warmupEmbed: (text: string) => Promise<unknown>,
): Promise<void> {
  const status = await getRetrievalBootstrapStatus();
  if (!status.ready) {
    throw new Error(status.error ?? EMBEDDINGS_BOOTSTRAP_MESSAGE);
  }

  // Pay the embedder cold-start cost now so the first real query is fast.
  await warmupEmbed('warmup');
  // Code-vs-data drift guard (storage migration tech spec §"Drift guard").
  await checkEmbeddingVersion();
}

/**
 * Verify the embeddings persisted in Postgres were produced by the current
 * code's `EMBEDDING_VERSION`. Logs a loud warning on mismatch — does not
 * throw, because the server can still serve queries against stale embeddings,
 * the results just won't reflect any chunking/model changes.
 *
 * No-ops if the embeddings table is empty or doesn't exist (early dev before
 * migrations have run).
 */
export async function checkEmbeddingVersion(): Promise<void> {
  try {
    const { db } = getDb('server');
    const result = await db.execute<{ embedding_version: string }>(
      sql`SELECT DISTINCT embedding_version FROM embeddings`,
    );
    const versions = result.rows.map((r) => r.embedding_version);
    if (versions.length === 0) return;
    // Warn on either missing or mixed versions — after a version bump, a
    // partial reindex leaves the table with [old, new] rows and retrieval
    // silently mixes incompatible embeddings until a full reindex runs.
    if (versions.some((v) => v !== EMBEDDING_VERSION)) {
      const label = versions.length > 1 ? 'MIXED EMBEDDING VERSIONS' : 'EMBEDDING VERSION DRIFT';
      console.warn(
        `⚠️  ${label}: code expects "${EMBEDDING_VERSION}" but ` +
          `embeddings table contains [${versions.join(', ')}]. ` +
          `Run \`npm run index\` to reindex.`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('embedding_version sanity check skipped:', msg);
  }
}
