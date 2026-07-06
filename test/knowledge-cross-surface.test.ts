/**
 * Tests for cross-surface edges (ADR 0027, SQR-404).
 *
 * Runs the real ingest against the test DB's seeded scenario metadata and
 * monster stat cards, then checks reverse traversal from a monster card.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FROSTHAVEN_GAME_ID } from '../src/game.ts';
import { seedCrossSurface } from '../src/seed/seed-cross-surface.ts';
import { neighbors } from '../src/tools.ts';

import { setupTestDb, teardownTestDb } from './helpers/db.ts';

let edgesSeeded = 0;

beforeAll(async () => {
  const result = await seedCrossSurface(await setupTestDb(), { game: FROSTHAVEN_GAME_ID });
  edgesSeeded = result.edges;
});

afterAll(async () => {
  const db = await setupTestDb();
  await db.execute(
    sql`DELETE FROM knowledge_edges WHERE provenance = 'cross_surface' AND game = ${FROSTHAVEN_GAME_ID}`,
  );
  await teardownTestDb();
});

describe('cross-surface ingest', () => {
  it('derives scenario→monster-stat edges from seeded scenario metadata', async () => {
    expect(edgesSeeded).toBeGreaterThan(100);
    const db = await setupTestDb();
    const [row] = (
      await db.execute<{ from_ref: string; to_ref: string }>(sql`
        SELECT from_ref, to_ref FROM knowledge_edges
        WHERE provenance = 'cross_surface' AND game = ${FROSTHAVEN_GAME_ID}
          AND edge_type = 'features_monster'
        LIMIT 1
      `)
    ).rows;
    expect(row?.from_ref).toMatch(/^scenario:frosthaven\/\d/);
    expect(row?.to_ref).toMatch(
      /^card:frosthaven\/monster-stats\/gloomhavensecretariat:monster-stat\//,
    );
  });

  it('lets a monster stat card discover its scenarios through reverse traversal', async () => {
    const db = await setupTestDb();
    const [edge] = (
      await db.execute<{ to_ref: string }>(sql`
        SELECT to_ref FROM knowledge_edges
        WHERE provenance = 'cross_surface' AND game = ${FROSTHAVEN_GAME_ID}
        LIMIT 1
      `)
    ).rows;
    expect(edge).toBeDefined();
    const result = await neighbors(edge!.to_ref, {
      game: FROSTHAVEN_GAME_ID,
      relation: 'features_monster',
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.neighbors.length).toBeGreaterThan(0);
      expect(result.neighbors[0]?.target.ref).toMatch(/^scenario:frosthaven\//);
    }
  });
});
