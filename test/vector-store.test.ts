/**
 * Integration tests for `src/vector-store.ts` against a real Postgres test DB.
 *
 * Per tech spec Decision 10: full integration, no mocking of Drizzle.
 *
 * Covers:
 *  - `addEntries` inserts the right columns with the right `embedding_version`
 *  - `addEntries` is idempotent (ON CONFLICT DO NOTHING on (source, chunk_index))
 *  - `search()` preserves the old "high score = more similar" contract
 *    (pgvector operator sign-flip)
 *  - `search()` honours the optional `game` filter (default 'frosthaven')
 *  - `getIndexedSources()` returns what `addEntries` wrote
 *  - Parity regression against the pre-migration flat-file top-6 snapshot
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';

import { embeddings as embeddingsTable } from '../src/db/schema/core.ts';
import { EMBEDDING_VERSION, addEntries, getIndexedSources, search } from '../src/vector-store.ts';
import type { IndexEntry } from '../src/vector-store.ts';

import { setupTestDb, resetTestDb, teardownTestDb } from './helpers/db.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

// Helper: deterministic normalized vector pointing along a chosen axis.
function axisVector(axis: number, dim = 384): number[] {
  const v = new Array<number>(dim).fill(0);
  v[axis] = 1;
  return v;
}

let db: Awaited<ReturnType<typeof setupTestDb>>;

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

// ─── addEntries ──────────────────────────────────────────────────────────────

describe('addEntries', () => {
  it('inserts entries with the current EMBEDDING_VERSION stamped', async () => {
    const entry: IndexEntry = {
      id: 'fake.pdf::0',
      text: 'hello world',
      embedding: axisVector(0),
      source: 'fake.pdf',
      chunkIndex: 0,
    };
    await addEntries([entry]);

    const rows = await db.select().from(embeddingsTable);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('fake.pdf::0');
    expect(rows[0].source).toBe('fake.pdf');
    expect(rows[0].chunkIndex).toBe(0);
    expect(rows[0].text).toBe('hello world');
    expect(rows[0].game).toBe('frosthaven');
    expect(rows[0].embeddingVersion).toBe(EMBEDDING_VERSION);
  });

  it('is idempotent on (source, chunk_index) — second insert is a no-op', async () => {
    const entry: IndexEntry = {
      id: 'fake.pdf::0',
      text: 'v1',
      embedding: axisVector(0),
      source: 'fake.pdf',
      chunkIndex: 0,
    };
    await addEntries([entry]);
    // Second call with same (source, chunkIndex) but different text: should not duplicate.
    await addEntries([{ ...entry, text: 'v2' }]);

    const rows = await db.select().from(embeddingsTable);
    expect(rows).toHaveLength(1);
    // ON CONFLICT DO NOTHING keeps the original row.
    expect(rows[0].text).toBe('v1');
  });

  it('respects an explicit game override', async () => {
    await addEntries([
      {
        id: 'gh2.pdf::0',
        text: 'gh2 content',
        embedding: axisVector(0),
        source: 'gh2.pdf',
        chunkIndex: 0,
        game: 'gloomhaven-2',
      },
    ]);
    const rows = await db.select().from(embeddingsTable);
    expect(rows[0].game).toBe('gloomhaven-2');
  });

  it('handles an empty batch as a no-op', async () => {
    await addEntries([]);
    const result = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count FROM embeddings`,
    );
    expect(Number(result.rows[0].count)).toBe(0);
  });
});

// ─── getIndexedSources ───────────────────────────────────────────────────────

describe('getIndexedSources', () => {
  it('returns the distinct set of sources for the default game', async () => {
    await addEntries([
      { id: 'a.pdf::0', text: 't', embedding: axisVector(0), source: 'a.pdf', chunkIndex: 0 },
      { id: 'a.pdf::1', text: 't', embedding: axisVector(1), source: 'a.pdf', chunkIndex: 1 },
      { id: 'b.pdf::0', text: 't', embedding: axisVector(2), source: 'b.pdf', chunkIndex: 0 },
    ]);
    const sources = await getIndexedSources();
    expect(sources).toEqual(new Set(['a.pdf', 'b.pdf']));
  });

  it('filters by game', async () => {
    await addEntries([
      { id: 'fh.pdf::0', text: 't', embedding: axisVector(0), source: 'fh.pdf', chunkIndex: 0 },
      {
        id: 'gh2.pdf::0',
        text: 't',
        embedding: axisVector(1),
        source: 'gh2.pdf',
        chunkIndex: 0,
        game: 'gloomhaven-2',
      },
    ]);
    expect(await getIndexedSources('frosthaven')).toEqual(new Set(['fh.pdf']));
    expect(await getIndexedSources('gloomhaven-2')).toEqual(new Set(['gh2.pdf']));
  });
});

// ─── search: contract + sign-flip ────────────────────────────────────────────

describe('search', () => {
  it('returns high-score-first results (sign-flip preserved)', async () => {
    await addEntries([
      { id: 'a::0', text: 'a', embedding: axisVector(0), source: 'a', chunkIndex: 0 },
      { id: 'b::0', text: 'b', embedding: axisVector(1), source: 'b', chunkIndex: 0 },
      { id: 'c::0', text: 'c', embedding: axisVector(2), source: 'c', chunkIndex: 0 },
    ]);
    // Query along axis 0 — identical to entry 'a'.
    const results = await search(axisVector(0), 3);
    expect(results[0].id).toBe('a::0');
    // Cosine similarity = dot product of normalized vectors = 1 for identical.
    expect(results[0].score).toBeCloseTo(1, 5);
    // Orthogonal vectors have similarity 0.
    expect(results[1].score).toBeCloseTo(0, 5);
    expect(results[2].score).toBeCloseTo(0, 5);
    // Descending order.
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    expect(results[1].score).toBeGreaterThanOrEqual(results[2].score);
  });

  it('respects the topK parameter', async () => {
    await addEntries([
      { id: 'a::0', text: 'a', embedding: axisVector(0), source: 'a', chunkIndex: 0 },
      { id: 'b::0', text: 'b', embedding: axisVector(1), source: 'b', chunkIndex: 0 },
    ]);
    const results = await search(axisVector(0), 1);
    expect(results).toHaveLength(1);
  });

  it('returns an empty array when the table is empty', async () => {
    const results = await search(axisVector(0), 5);
    expect(results).toEqual([]);
  });

  it('defaults to game=frosthaven and filters out other games', async () => {
    await addEntries([
      {
        id: 'fh::0',
        text: 'fh',
        embedding: axisVector(0),
        source: 'fh',
        chunkIndex: 0,
      },
      {
        id: 'gh2::0',
        text: 'gh2',
        embedding: axisVector(0),
        source: 'gh2',
        chunkIndex: 0,
        game: 'gloomhaven-2',
      },
    ]);
    const defaultHits = await search(axisVector(0), 10);
    expect(defaultHits.map((h) => h.id)).toEqual(['fh::0']);

    const gh2Hits = await search(axisVector(0), 10, { game: 'gloomhaven-2' });
    expect(gh2Hits.map((h) => h.id)).toEqual(['gh2::0']);
  });

  it('can retrieve scenario-book and section-book sources as nearest matches', async () => {
    await addEntries([
      {
        id: 'fh-rule-book.pdf::0',
        text: 'Rulebook entry',
        embedding: axisVector(0),
        source: 'fh-rule-book.pdf',
        chunkIndex: 0,
      },
      {
        id: 'fh-scenario-book-42-61.pdf::0',
        text: 'Scenario book entry',
        embedding: axisVector(1),
        source: 'fh-scenario-book-42-61.pdf',
        chunkIndex: 0,
      },
      {
        id: 'fh-section-book-62-81.pdf::0',
        text: 'Section book entry',
        embedding: axisVector(2),
        source: 'fh-section-book-62-81.pdf',
        chunkIndex: 0,
      },
    ]);

    const scenarioHits = await search(axisVector(1), 1);
    expect(scenarioHits).toHaveLength(1);
    expect(scenarioHits[0].source).toBe('fh-scenario-book-42-61.pdf');

    const sectionHits = await search(axisVector(2), 1);
    expect(sectionHits).toHaveLength(1);
    expect(sectionHits[0].source).toBe('fh-section-book-62-81.pdf');
  });
});

// ─── Parity regression (IRON RULE) ───────────────────────────────────────────

describe('parity regression vs flat-file vector store', () => {
  interface ParityEntry {
    id: string;
    text: string;
    embedding: number[];
    source: string;
    chunkIndex: number;
  }
  interface QueryCase {
    query: string;
    expectedTopIds: string[];
  }

  // Lazy imports so vitest's file-level module graph doesn't pay the cost of
  // the embedder cold start for test files that don't need it.
  it('returns the same top-6 IDs as the pre-migration flat file', async () => {
    const { embed } = await import('../src/embedder.ts');

    const entries: ParityEntry[] = JSON.parse(
      readFileSync(join(FIXTURES, 'vector-parity-fixture.json'), 'utf-8'),
    );
    const queries: QueryCase[] = JSON.parse(
      readFileSync(join(FIXTURES, 'search-queries', 'rules.json'), 'utf-8'),
    );

    await addEntries(
      entries.map((e) => ({
        id: e.id,
        text: e.text,
        embedding: e.embedding,
        source: e.source,
        chunkIndex: e.chunkIndex,
      })),
    );

    for (const { query, expectedTopIds } of queries) {
      const v = await embed(query);
      const hits = await search(v, 6);
      // Compare as sets: pgvector and the old flat-file implementation can
      // tie-break near-identical cosine scores in different orders, so the
      // faithful parity assertion is "same 6 IDs retrieved," not "same order."
      const gotIds = hits.map((h) => h.id).sort();
      expect(gotIds, `query="${query}"`).toEqual([...expectedTopIds].sort());
    }
  }, 240_000);

  it('surfaces section-book passages for the scenario 61 unlock question', async () => {
    const { embed } = await import('../src/embedder.ts');

    const entries: ParityEntry[] = JSON.parse(
      readFileSync(join(FIXTURES, 'vector-parity-fixture.json'), 'utf-8'),
    );

    await addEntries(
      entries.map((e) => ({
        id: e.id,
        text: e.text,
        embedding: e.embedding,
        source: e.source,
        chunkIndex: e.chunkIndex,
      })),
    );

    const hits = await search(
      await embed('What section text unlocks scenario 61 (Life and Death) in Frosthaven?'),
      6,
    );

    expect(hits.some((hit) => hit.source === 'fh-section-book-62-81.pdf')).toBe(true);
  }, 240_000);
});
