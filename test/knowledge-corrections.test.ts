/**
 * Tests for correction edges from FAQ/errata chunks (ADR 0027, SQR-403).
 *
 * Uses gloomhaven-2e fixtures (the concepts tests use frosthaven) so the two
 * DB suites cannot cross-talk through the shared test database.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GLOOMHAVEN_2E_GAME_ID } from '../src/game.ts';
import { parseCorrectionRefs, seedCorrections } from '../src/seed/seed-corrections.ts';
import { openEntity } from '../src/tools.ts';

import { setupTestDb, teardownTestDb } from './helpers/db.ts';

const ZERO_VECTOR = `[${new Array(1024).fill(0).join(',')}]`;
const ERRATA_TEXT =
  'Section 10.1 (Merchant conclusion to Scenario 27) This should add Event R-37, ' +
  'in addition to Event R-38. Also see Rulebook p27 for the old wording.';

beforeAll(async () => {
  const db = await setupTestDb();
  await db.execute(sql`
    INSERT INTO rule_source_embeddings (id, source, chunk_index, text, embedding, game, embedding_version)
    VALUES (
      'test-gh2-errata-900', 'gh2-errata.html', 900, ${ERRATA_TEXT},
      ${ZERO_VECTOR}::vector, ${GLOOMHAVEN_2E_GAME_ID}, 'test'
    )
    ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text
  `);
  await seedCorrections(await setupTestDb(), { game: GLOOMHAVEN_2E_GAME_ID });
});

afterAll(async () => {
  const db = await setupTestDb();
  await db.execute(sql`DELETE FROM rule_source_embeddings WHERE id = 'test-gh2-errata-900'`);
  await db.execute(
    sql`DELETE FROM knowledge_edges WHERE provenance = 'corrections' AND game = ${GLOOMHAVEN_2E_GAME_ID}`,
  );
  await teardownTestDb();
});

describe('parseCorrectionRefs', () => {
  it('extracts sections, scenarios, slash-separated items, and page refs', () => {
    const refs = parseCorrectionRefs(
      'Section 21.1 and Section 21.1 again; Scenario 26 setup; Items 129/130 swapped; Rulebook p27, and pg30 too.',
    );
    expect(refs.sections).toEqual(['21.1']);
    expect(refs.scenarios).toEqual(['26']);
    expect(refs.items).toEqual(['129', '130']);
    expect(refs.pages).toEqual(['27', '30']);
  });

  it('finds nothing in plain rules text', () => {
    const refs = parseCorrectionRefs('A muddled figure gains disadvantage on its attacks.');
    expect(refs).toEqual({ sections: [], scenarios: [], items: [], pages: [] });
  });
});

describe('corrections ingest (fixture errata chunk)', () => {
  it('writes supersedes edges for resolvable targets and reports the rest', async () => {
    const db = await setupTestDb();
    const edges = (
      await db.execute<{ edge_type: string; to_ref: string }>(sql`
        SELECT edge_type, to_ref FROM knowledge_edges
        WHERE provenance = 'corrections'
          AND from_ref = 'rules:gloomhaven-2e/gh2-errata.html#chunk=900'
        ORDER BY to_ref
      `)
    ).rows;
    expect(edges).toEqual([
      { edge_type: 'supersedes', to_ref: 'scenario:gloomhaven-2e/027' },
      { edge_type: 'supersedes', to_ref: 'section:gloomhaven-2e/10.1' },
    ]);
  });

  it('reports unmatched page refs instead of writing dangling edges', async () => {
    const db = await setupTestDb();
    const result = await seedCorrections(db, { game: GLOOMHAVEN_2E_GAME_ID });
    const fixtureRow = result.report.find(
      (row) => row.source === 'gh2-errata.html' && row.chunkIndex === 900,
    );
    expect(fixtureRow?.edges).toBe(2);
    expect(fixtureRow?.unmatched.some((entry) => entry.startsWith('page 27'))).toBe(true);
  });
});

describe('open_entity carries corrections', () => {
  it('attaches the errata excerpt and related edge to the corrected section', async () => {
    const result = await openEntity('section:gloomhaven-2e/10.1', {
      game: GLOOMHAVEN_2E_GAME_ID,
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      const corrections = result.entity.data.corrections as Array<{
        ref: string;
        type: string;
        excerpt: string;
      }>;
      expect(
        corrections.some(
          (correction) =>
            correction.ref === 'rules:gloomhaven-2e/gh2-errata.html#chunk=900' &&
            correction.type === 'supersedes' &&
            correction.excerpt.includes('Event R-37'),
        ),
      ).toBe(true);
      expect(
        result.related.some(
          (link) =>
            link.relation === 'supersedes' &&
            link.target.ref === 'rules:gloomhaven-2e/gh2-errata.html#chunk=900',
        ),
      ).toBe(true);
    }
  });

  it('leaves uncorrected records clean', async () => {
    const result = await openEntity('section:gloomhaven-2e/101.1', {
      game: GLOOMHAVEN_2E_GAME_ID,
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.entity.data.corrections).toBeUndefined();
    }
  });
});
