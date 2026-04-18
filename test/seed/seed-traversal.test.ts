import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  traversalScenarios,
  traversalSections,
  traversalLinks,
} from '../../src/db/schema/traversal.ts';
import { seedTraversal } from '../../src/seed/seed-traversal.ts';
import { TraversalExtractSchema } from '../../src/traversal-schemas.ts';

import { setupTestDb, teardownTestDb } from '../helpers/db.ts';

function readTraversalExtract() {
  const path = join(import.meta.dirname, '..', '..', 'data', 'extracted', 'traversal.json');
  return TraversalExtractSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

describe('seedTraversal', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    try {
      await db.execute(
        sql`TRUNCATE traversal_links, traversal_sections, traversal_scenarios RESTART IDENTITY CASCADE`,
      );
      await seedTraversal(db);
    } finally {
      await teardownTestDb();
    }
  });

  it('seeds row counts that match the traversal extract', async () => {
    const extract = readTraversalExtract();
    const scenarios = await db
      .select({ id: traversalScenarios.id })
      .from(traversalScenarios)
      .where(eq(traversalScenarios.game, 'frosthaven'));
    const sections = await db
      .select({ id: traversalSections.id })
      .from(traversalSections)
      .where(eq(traversalSections.game, 'frosthaven'));
    const links = await db
      .select({ id: traversalLinks.id })
      .from(traversalLinks)
      .where(eq(traversalLinks.game, 'frosthaven'));

    expect(scenarios).toHaveLength(extract.scenarios.length);
    expect(sections).toHaveLength(extract.sections.length);
    expect(links).toHaveLength(extract.links.length);
  });

  it('is idempotent when re-run against the same extract', async () => {
    const before = await db
      .select({ id: traversalLinks.id })
      .from(traversalLinks)
      .where(eq(traversalLinks.game, 'frosthaven'));

    await seedTraversal(db);

    const after = await db
      .select({ id: traversalLinks.id })
      .from(traversalLinks)
      .where(eq(traversalLinks.game, 'frosthaven'));
    expect(after).toHaveLength(before.length);
  });
});
