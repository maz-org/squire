/**
 * Tests for concept nodes and edges (ADR 0027, SQR-402).
 *
 * DB tests insert fixture rulebook/FAQ chunks (zero vectors — the concept
 * ingest never touches embeddings), run the real `seedConcepts` job, and
 * assert the resolve → open → neighbors path over the derived graph.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FROSTHAVEN_GAME_ID, SUPPORTED_GAME_IDS } from '../src/game.ts';
import { CONCEPT_SEEDS } from '../src/seed/concepts-data.ts';
import {
  conceptPattern,
  definitionScore,
  findDefiningChunk,
  seedConcepts,
} from '../src/seed/seed-concepts.ts';
import { neighbors, openEntity, resolveEntity } from '../src/tools.ts';

import { setupTestDb, teardownTestDb } from './helpers/db.ts';

const ZERO_VECTOR = `[${new Array(1024).fill(0).join(',')}]`;
const DEFINITION_TEXT =
  'Muddle: A muddled figure gains disadvantage on all of its attacks. ' +
  'The muddle token is removed at the end of the figure’s next attack action.';
const FAQ_TEXT =
  'Q: Does muddle affect retaliate? A: No — retaliate is not an attack, ' +
  'so a muddled figure retaliates normally.';

async function insertChunk(source: string, chunkIndex: number, text: string): Promise<void> {
  const db = await setupTestDb();
  await db.execute(sql`
    INSERT INTO rule_source_embeddings (id, source, chunk_index, text, embedding, game, embedding_version)
    VALUES (
      ${`test-${source}-${chunkIndex}`}, ${source}, ${chunkIndex}, ${text},
      ${ZERO_VECTOR}::vector, ${FROSTHAVEN_GAME_ID}, 'test'
    )
    ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text
  `);
}

beforeAll(async () => {
  await setupTestDb();
  // A definition-shaped rulebook chunk, a passing mention later in the book,
  // and an FAQ chunk. The ingest must pick the definition, not the mention.
  await insertChunk('fh-rule-book.pdf', 10, DEFINITION_TEXT);
  await insertChunk('fh-rule-book.pdf', 90, 'Some monsters apply muddle when they attack.');
  await insertChunk('fh-faq.html', 0, FAQ_TEXT);
  await seedConcepts(await setupTestDb(), { game: FROSTHAVEN_GAME_ID });
});

afterAll(async () => {
  const db = await setupTestDb();
  await db.execute(sql`DELETE FROM rule_source_embeddings WHERE id LIKE 'test-%'`);
  await db.execute(sql`DELETE FROM knowledge_edges WHERE provenance = 'concepts'`);
  await db.execute(sql`DELETE FROM knowledge_concepts`);
  await teardownTestDb();
});

describe('curated concept lists', () => {
  it('keeps slugs unique and categories valid per game', () => {
    for (const game of SUPPORTED_GAME_IDS) {
      const seeds = CONCEPT_SEEDS[game];
      expect(seeds.length).toBeGreaterThan(20);
      expect(new Set(seeds.map((seed) => seed.slug)).size).toBe(seeds.length);
      for (const seed of seeds) {
        expect(['condition', 'keyword', 'mechanic']).toContain(seed.category);
        expect(seed.slug).toMatch(/^[a-z0-9-]+$/);
      }
    }
  });
});

describe('deterministic matching', () => {
  it('matches on word boundaries only', () => {
    const pattern = conceptPattern({ name: 'Push', aliases: [] });
    expect('Push 2 the target.').toMatch(pattern);
    expect('pushed around').not.toMatch(pattern);
  });

  it('scores early occurrences as definitions', () => {
    const pattern = conceptPattern({ name: 'Muddle', aliases: ['muddled'] });
    const definition = definitionScore(DEFINITION_TEXT, pattern);
    const mention = definitionScore(`${'x'.repeat(300)} the monster applies muddle here.`, pattern);
    expect(definition).toBeGreaterThan(mention);
  });

  it('picks the best chunk deterministically', () => {
    const pattern = conceptPattern({ name: 'Muddle', aliases: ['muddled'] });
    const chunks = [
      { source: 'b.pdf', chunkIndex: 5, text: 'muddle appears once late: muddle' },
      { source: 'a.pdf', chunkIndex: 1, text: DEFINITION_TEXT },
      { source: 'a.pdf', chunkIndex: 9, text: 'no match at all' },
    ];
    expect(findDefiningChunk(chunks, pattern)?.chunkIndex).toBe(1);
    expect(findDefiningChunk([], pattern)).toBeNull();
  });
});

describe('concept ingest (seeded against fixture corpus)', () => {
  it('derives defines and clarifies edges for muddle', async () => {
    const db = await setupTestDb();
    const edges = (
      await db.execute<{ from_ref: string; edge_type: string }>(sql`
        SELECT from_ref, edge_type FROM knowledge_edges
        WHERE provenance = 'concepts' AND to_ref = 'concept:frosthaven/muddle'
          AND edge_type IN ('defines', 'clarifies')
        ORDER BY edge_type
      `)
    ).rows;
    // The test DB also carries real card data, so `references` edges exist
    // alongside these; the fixture-driven contract is defines + clarifies.
    expect(edges).toEqual([
      { from_ref: 'rules:frosthaven/fh-faq.html#chunk=0', edge_type: 'clarifies' },
      { from_ref: 'rules:frosthaven/fh-rule-book.pdf#chunk=10', edge_type: 'defines' },
    ]);
  });
});

describe('resolve → open → neighbors over concepts', () => {
  it('resolve_entity returns the concept for a bare condition name', async () => {
    const result = await resolveEntity('muddle', { game: FROSTHAVEN_GAME_ID });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const top = result.candidates[0];
      expect(top?.entity).toMatchObject({
        kind: 'concept',
        ref: 'concept:frosthaven/muddle',
        title: 'Muddle',
      });
      expect(top?.confidence).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('open_entity returns the concept with its rulebook definition', async () => {
    const result = await openEntity('concept:frosthaven/muddle', { game: FROSTHAVEN_GAME_ID });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.entity.kind).toBe('concept');
      expect(result.entity.data).toMatchObject({
        category: 'condition',
        definition: DEFINITION_TEXT,
      });
      const relations = result.related.map((neighbor) => neighbor.relation);
      expect(relations).toContain('defines');
      expect(relations).toContain('clarifies');
      expect(result.related.length).toBeLessThanOrEqual(10);
    }
  });

  it('resolve_entity does not partial-match inside longer words', async () => {
    const result = await resolveEntity('they got pushed around the room', {
      game: FROSTHAVEN_GAME_ID,
      kinds: ['concept'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.candidates.find((candidate) => candidate.entity.ref === 'concept:frosthaven/push'),
      ).toBeUndefined();
    }
  });

  it('keeps the definition when other edges exceed the traversal cap', async () => {
    const db = await setupTestDb();
    const values = Array.from(
      { length: 60 },
      (_, i) =>
        sql`(${FROSTHAVEN_GAME_ID}, 'card', ${`card:frosthaven/items/cap-test/${i}`}, 'references', 'concept', 'concept:frosthaven/muddle', 'unit-test-cap', NULL)`,
    );
    await db.execute(sql`
      INSERT INTO knowledge_edges (game, from_kind, from_ref, edge_type, to_kind, to_ref, provenance, metadata)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT DO NOTHING
    `);
    try {
      const result = await openEntity('concept:frosthaven/muddle', { game: FROSTHAVEN_GAME_ID });
      expect(result).toMatchObject({ ok: true });
      if (result.ok) {
        expect(result.entity.data).toMatchObject({ definition: DEFINITION_TEXT });
        expect(result.related[0]?.relation).toBe('defines');
      }
    } finally {
      await db.execute(sql`DELETE FROM knowledge_edges WHERE provenance = 'unit-test-cap'`);
    }
  });

  it('open_entity returns not_found for an unknown concept slug', async () => {
    await expect(
      openEntity('concept:frosthaven/not-a-thing', { game: FROSTHAVEN_GAME_ID }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('neighbors filters concept edges by relation', async () => {
    const result = await neighbors('concept:frosthaven/muddle', {
      game: FROSTHAVEN_GAME_ID,
      relation: 'defines',
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.neighbors).toHaveLength(1);
      expect(result.neighbors[0]?.target.ref).toBe('rules:frosthaven/fh-rule-book.pdf#chunk=10');
    }
  });
});
