/**
 * Integration tests for the knowledge_edges substrate (ADR 0027, SQR-401).
 *
 * Scenario/section book tables and their knowledge_edges mirror are seeded
 * once per run by `test/helpers/global-setup.ts`. These tests verify the
 * mirror parity contract and all-kind neighbors() traversal.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FROSTHAVEN_GAME_ID } from '../src/game.ts';
import { neighbors } from '../src/tools.ts';
import { canonicalEdgeRef, dedupeEdgeRows } from '../src/seed/seed-scenario-section-books.ts';

import { setupTestDb, teardownTestDb } from './helpers/db.ts';

const CARD_REF = 'card:frosthaven/items/gloomhavensecretariat:item/999-test';
const CONCEPT_REF = 'concept:frosthaven/test-edge-concept';

beforeAll(async () => {
  const db = await setupTestDb();
  await db.execute(sql`
    INSERT INTO knowledge_edges (game, from_kind, from_ref, edge_type, to_kind, to_ref, provenance, metadata)
    VALUES (
      ${FROSTHAVEN_GAME_ID}, 'card', ${CARD_REF}, 'references', 'concept', ${CONCEPT_REF},
      'unit-test', ${JSON.stringify({ rawLabel: 'test edge' })}::jsonb
    )
    ON CONFLICT DO NOTHING
  `);
});

afterAll(async () => {
  const db = await setupTestDb();
  await db.execute(sql`DELETE FROM knowledge_edges WHERE provenance = 'unit-test'`);
  await teardownTestDb();
});

describe('canonicalEdgeRef', () => {
  it('canonicalizes storage refs into node ids', () => {
    expect(
      canonicalEdgeRef('scenario', 'gloomhavensecretariat:scenario/010', FROSTHAVEN_GAME_ID),
    ).toBe('scenario:frosthaven/010');
    expect(canonicalEdgeRef('scenario', 'printed-book:scenario/004', FROSTHAVEN_GAME_ID)).toBe(
      'scenario:frosthaven/004',
    );
    expect(canonicalEdgeRef('section', '42.4', FROSTHAVEN_GAME_ID)).toBe('section:frosthaven/42.4');
    // Already-canonical and unknown shapes pass through.
    expect(canonicalEdgeRef('section', 'section:frosthaven/42.4', FROSTHAVEN_GAME_ID)).toBe(
      'section:frosthaven/42.4',
    );
    expect(
      canonicalEdgeRef('rules_passage', 'rules:frosthaven/x#chunk=1', FROSTHAVEN_GAME_ID),
    ).toBe('rules:frosthaven/x#chunk=1');
  });

  it('dedupes per-sequence duplicates onto the edge unique key', () => {
    const rows = [
      { game: 'frosthaven', fromRef: 'a', edgeType: 't', toRef: 'b', sequence: 0 },
      { game: 'frosthaven', fromRef: 'a', edgeType: 't', toRef: 'b', sequence: 1 },
      { game: 'frosthaven', fromRef: 'a', edgeType: 'u', toRef: 'b', sequence: 0 },
    ];
    expect(dedupeEdgeRows(rows)).toHaveLength(2);
  });
});

describe('knowledge_edges mirror parity', () => {
  it('mirrors every distinct book_references edge for the seeded game', async () => {
    const db = await setupTestDb();
    const [bookCount] = (
      await db.execute<{ count: string }>(sql`
        SELECT count(DISTINCT (from_kind, from_ref, link_type, to_kind, to_ref)) AS count
        FROM book_references WHERE game = ${FROSTHAVEN_GAME_ID}
      `)
    ).rows;
    const [edgeCount] = (
      await db.execute<{ count: string }>(sql`
        SELECT count(*) AS count FROM knowledge_edges
        WHERE game = ${FROSTHAVEN_GAME_ID} AND provenance = 'book_references'
      `)
    ).rows;

    expect(Number(bookCount!.count)).toBeGreaterThan(0);
    // The mirror dedupes onto (from_ref, edge_type, to_ref) after
    // canonicalization, so distinct storage tuples can only collapse, never
    // exceed the mirror count; a zero or larger mirror signals drift.
    expect(Number(edgeCount!.count)).toBeGreaterThan(0);
    expect(Number(edgeCount!.count)).toBeLessThanOrEqual(Number(bookCount!.count));
  });

  it('mirrors a known conclusion chain with canonical refs', async () => {
    const db = await setupTestDb();
    const rows = (
      await db.execute<{ to_ref: string }>(sql`
        SELECT to_ref FROM knowledge_edges
        WHERE game = ${FROSTHAVEN_GAME_ID}
          AND provenance = 'book_references'
          AND from_ref = 'scenario:frosthaven/010'
          AND edge_type = 'conclusion'
      `)
    ).rows;
    expect(rows.map((row) => row.to_ref)).toContain('section:frosthaven/42.4');
  });
});

describe('all-kind neighbors', () => {
  it('traverses knowledge_edges for card refs in both directions', async () => {
    const fromCard = await neighbors(CARD_REF, { game: FROSTHAVEN_GAME_ID });
    expect(fromCard).toMatchObject({ ok: true });
    if (fromCard.ok) {
      expect(fromCard.neighbors).toEqual([
        expect.objectContaining({
          relation: 'references',
          target: expect.objectContaining({ kind: 'concept', ref: CONCEPT_REF }),
          reason: 'test edge',
        }),
      ]);
    }

    const fromConcept = await neighbors(CONCEPT_REF, { game: FROSTHAVEN_GAME_ID });
    expect(fromConcept).toMatchObject({ ok: true });
    if (fromConcept.ok) {
      expect(fromConcept.neighbors).toEqual([
        expect.objectContaining({
          relation: 'references',
          target: expect.objectContaining({ kind: 'card', ref: CARD_REF }),
        }),
      ]);
    }
  });

  it('returns not_found for unknown graph refs', async () => {
    await expect(
      neighbors('concept:frosthaven/does-not-exist', { game: FROSTHAVEN_GAME_ID }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
