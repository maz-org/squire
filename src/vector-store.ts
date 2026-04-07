/**
 * Retrieval layer: rulebook vector store.
 *
 * Currently a flat JSON file (data/index.json); SQR-33 replaces the backend
 * with pgvector. Everything this module exports — including EMBEDDING_VERSION
 * and the drift guard — belongs to the retrieval layer, not the service
 * layer, so service.ts can stay a thin orchestrator.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';

import { getDb } from './db.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(__dirname, '..', 'data', 'index.json');

export interface IndexEntry {
  id: string;
  text: string;
  embedding: number[];
  source: string;
  chunkIndex: number;
}

export interface ScoredEntry extends IndexEntry {
  score: number;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are already normalized
}

export function loadIndex(): IndexEntry[] {
  if (!existsSync(INDEX_PATH)) return [];
  return JSON.parse(readFileSync(INDEX_PATH, 'utf-8')) as IndexEntry[];
}

export function saveIndex(entries: IndexEntry[]): void {
  writeFileSync(INDEX_PATH, JSON.stringify(entries), 'utf-8');
}

export function addEntries(existing: IndexEntry[], newEntries: IndexEntry[]): IndexEntry[] {
  const merged = [...existing, ...newEntries];
  saveIndex(merged);
  return merged;
}

export function search(index: IndexEntry[], queryEmbedding: number[], k = 8): ScoredEntry[] {
  const scored = index.map((entry) => ({
    ...entry,
    score: cosineSimilarity(entry.embedding, queryEmbedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/**
 * Bumped whenever chunking logic in `index-docs.ts` or the embedder model
 * changes. Used by `checkEmbeddingVersion()` as a code-vs-data drift guard
 * (storage migration tech spec §"Drift guard"). SQR-33 starts writing this
 * value into the `embeddings.embedding_version` column when it ports the
 * backend to pgvector.
 */
export const EMBEDDING_VERSION = 'xenova-minilm-l6-v2.v1';

/**
 * Bring the retrieval layer into a ready state: load the rulebook index,
 * warm the embedder, and run the embedding-version drift guard. The service
 * layer (`src/service.ts`) calls this during startup and owns nothing
 * retrieval-specific itself.
 *
 * Throws if the index is empty — that's an unrecoverable misconfiguration
 * (data not indexed yet) and the caller needs to surface it loudly.
 */
export async function initializeRetrieval(
  warmupEmbed: (text: string) => Promise<unknown>,
): Promise<void> {
  const index = loadIndex();
  if (index.length === 0) {
    throw new Error('Vector index is empty. Run `npm run index` first.');
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
 * No-ops if the embeddings table is empty (SQR-33 hasn't seeded it yet) or
 * doesn't exist (early dev before migrations have run).
 */
export async function checkEmbeddingVersion(): Promise<void> {
  try {
    const { db } = getDb('server');
    const result = await db.execute<{ embedding_version: string }>(
      sql`SELECT DISTINCT embedding_version FROM embeddings`,
    );
    const versions = result.rows.map((r) => r.embedding_version);
    if (versions.length === 0) return;
    if (!versions.includes(EMBEDDING_VERSION)) {
      console.warn(
        `⚠️  EMBEDDING VERSION DRIFT: code expects "${EMBEDDING_VERSION}" but ` +
          `embeddings table contains [${versions.join(', ')}]. ` +
          `Run \`npm run index\` to reindex.`,
      );
    }
  } catch (err) {
    console.warn('embedding_version sanity check skipped:', (err as Error).message);
  }
}
