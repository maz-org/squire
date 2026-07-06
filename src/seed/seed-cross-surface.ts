/**
 * Seed cross-surface edges (ADR 0027, SQR-404).
 *
 * Deterministic ingest — no model calls. The first cross-surface family
 * links scenarios to the monsters they field: each scenario's seeded
 * monster list (GHS metadata) matches `card_monster_stats` rows by exact
 * case-insensitive name, writing `features_monster` edges with provenance
 * `cross_surface` (one edge per stat card, so every level-range card of a
 * monster can discover its scenarios through reverse traversal). Monster
 * names with no stat card land in the quality report.
 *
 * Card→concept and item→condition references already exist as `references`
 * edges from the concepts ingest (SQR-402).
 */

import { and, eq } from 'drizzle-orm';

import type { Db } from '../db.ts';
import { DEFAULT_GAME_ID, requireGameId, type GameId } from '../game.ts';
import { knowledgeEdges } from '../db/schema/knowledge-edges.ts';
import { cardMonsterStats } from '../db/schema/cards.ts';
import { scenarioBookScenarios } from '../db/schema/scenario-section-books.ts';

export interface CrossSurfaceQualityRow {
  scenarioRef: string;
  edges: number;
  unmatchedMonsters: string[];
}

export interface SeedCrossSurfaceResult {
  game: GameId;
  edges: number;
  report: CrossSurfaceQualityRow[];
}

export interface SeedCrossSurfaceOptions {
  game?: string;
}

export async function seedCrossSurface(
  db: Db,
  opts: SeedCrossSurfaceOptions = {},
): Promise<SeedCrossSurfaceResult> {
  const game = requireGameId(opts.game ?? DEFAULT_GAME_ID);

  const statCardsByName = new Map<string, string[]>();
  for (const stat of await db
    .select({ sourceId: cardMonsterStats.sourceId, name: cardMonsterStats.name })
    .from(cardMonsterStats)
    .where(eq(cardMonsterStats.game, game))) {
    const key = String(stat.name ?? '').toLowerCase();
    if (!key) continue;
    statCardsByName.set(key, [...(statCardsByName.get(key) ?? []), stat.sourceId]);
  }

  const scenarios = await db
    .select({ ref: scenarioBookScenarios.ref, metadata: scenarioBookScenarios.metadata })
    .from(scenarioBookScenarios)
    .where(eq(scenarioBookScenarios.game, game));

  const edgeRows: Array<typeof knowledgeEdges.$inferInsert> = [];
  const report: CrossSurfaceQualityRow[] = [];

  for (const scenario of scenarios) {
    const metadata = (scenario.metadata ?? {}) as { monsters?: unknown };
    const monsters = Array.isArray(metadata.monsters)
      ? metadata.monsters.filter((name): name is string => typeof name === 'string')
      : [];
    if (monsters.length === 0) continue;

    const scenarioId = scenario.ref.replace(/^gloomhavensecretariat:scenario\//, '');
    const scenarioRef = `scenario:${game}/${scenarioId}`;
    const row: CrossSurfaceQualityRow = { scenarioRef, edges: 0, unmatchedMonsters: [] };

    for (const monster of monsters) {
      const sourceIds = statCardsByName.get(monster.toLowerCase());
      if (!sourceIds) {
        row.unmatchedMonsters.push(monster);
        continue;
      }
      for (const sourceId of sourceIds) {
        row.edges += 1;
        edgeRows.push({
          game,
          fromKind: 'scenario',
          fromRef: scenarioRef,
          edgeType: 'features_monster',
          toKind: 'card',
          toRef: `card:${game}/monster-stats/${sourceId}`,
          provenance: 'cross_surface',
          metadata: { rawLabel: `Scenario monster list: ${monster}` },
        });
      }
    }

    if (row.edges > 0 || row.unmatchedMonsters.length > 0) report.push(row);
  }

  const seen = new Set<string>();
  const deduped = edgeRows.filter((edge) => {
    const key = `${edge.game}|${edge.fromRef}|${edge.edgeType}|${edge.toRef}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  await db.transaction(async (tx) => {
    await tx
      .delete(knowledgeEdges)
      .where(and(eq(knowledgeEdges.game, game), eq(knowledgeEdges.provenance, 'cross_surface')));
    if (deduped.length > 0) {
      await tx.insert(knowledgeEdges).values(deduped);
    }
  });

  return { game, edges: deduped.length, report };
}
