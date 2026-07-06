/**
 * Seed correction edges from FAQ/errata chunks (ADR 0027, SQR-403).
 *
 * Deterministic ingest — no model calls. Errata and FAQ chunks that name a
 * printed target explicitly ("Section 21.1", "Scenario 26", "Items 129/130")
 * get an edge into `knowledge_edges` with provenance `corrections`:
 * errata-source chunks write `supersedes`, FAQ-source chunks write
 * `clarifies`. Targets are validated against the seeded record tables; a
 * named target that does not resolve (e.g. the erratum about the
 * nonexistent Section 29.5, or rulebook page references — chunks carry no
 * page metadata) lands in the quality report instead of a dangling edge.
 */

import { and, eq } from 'drizzle-orm';

import type { Db } from '../db.ts';
import { DEFAULT_GAME_ID, requireGameId, type GameId } from '../game.ts';
import { knowledgeEdges } from '../db/schema/knowledge-edges.ts';
import { cardItems } from '../db/schema/cards.ts';
import { scenarioBookScenarios, sectionBookSections } from '../db/schema/scenario-section-books.ts';
import { ruleSourceEmbeddings } from '../db/schema/core.ts';
import { ruleSourceProvenance } from '../rule-source-provenance.ts';

export interface ParsedCorrectionRefs {
  sections: string[];
  scenarios: string[];
  items: string[];
  /** Rulebook page references — not mappable to chunks (no page metadata). */
  pages: string[];
}

/** Extract explicitly named printed targets from a correction chunk. */
export function parseCorrectionRefs(text: string): ParsedCorrectionRefs {
  const unique = (values: string[]) => [...new Set(values)];
  return {
    sections: unique([...text.matchAll(/\bSections?\s+(\d+\.\d+)\b/gi)].map((m) => m[1])),
    scenarios: unique([...text.matchAll(/\bScenarios?\s+(\d+)\b/gi)].map((m) => m[1])),
    items: unique(
      [...text.matchAll(/\bItems?\s+(\d+(?:\/\d+)*)\b/gi)].flatMap((m) => m[1].split('/')),
    ),
    pages: unique(
      [...text.matchAll(/\b(?:Rulebook\s+)?p(?:g|age)?\.?\s?(\d+)\b/gi)].map((m) => m[1]),
    ),
  };
}

export interface CorrectionQualityRow {
  source: string;
  chunkIndex: number;
  edges: number;
  unmatched: string[];
}

export interface SeedCorrectionsResult {
  game: GameId;
  edges: number;
  report: CorrectionQualityRow[];
}

export interface SeedCorrectionsOptions {
  game?: string;
}

export async function seedCorrections(
  db: Db,
  opts: SeedCorrectionsOptions = {},
): Promise<SeedCorrectionsResult> {
  const game = requireGameId(opts.game ?? DEFAULT_GAME_ID);

  const chunks = await db
    .select({
      source: ruleSourceEmbeddings.source,
      chunkIndex: ruleSourceEmbeddings.chunkIndex,
      text: ruleSourceEmbeddings.text,
    })
    .from(ruleSourceEmbeddings)
    .where(eq(ruleSourceEmbeddings.game, game));

  const correctionChunks = chunks
    .map((chunk) => ({
      ...chunk,
      sourceType: ruleSourceProvenance(chunk.source, game).sourceType,
    }))
    .filter((chunk) => chunk.sourceType === 'faq' || chunk.sourceType === 'errata');

  const knownSections = new Set(
    (
      await db
        .select({ ref: sectionBookSections.ref })
        .from(sectionBookSections)
        .where(eq(sectionBookSections.game, game))
    ).map((row) => row.ref),
  );
  const knownScenarios = new Set(
    (
      await db
        .select({ ref: scenarioBookScenarios.ref })
        .from(scenarioBookScenarios)
        .where(eq(scenarioBookScenarios.game, game))
    ).map((row) => row.ref.replace(/^gloomhavensecretariat:scenario\//, '')),
  );
  const itemsByNumber = new Map(
    (
      await db
        .select({ number: cardItems.number, sourceId: cardItems.sourceId })
        .from(cardItems)
        .where(eq(cardItems.game, game))
    ).map((row) => [String(row.number), row.sourceId]),
  );

  const edgeRows: Array<typeof knowledgeEdges.$inferInsert> = [];
  const report: CorrectionQualityRow[] = [];

  for (const chunk of correctionChunks) {
    const refs = parseCorrectionRefs(chunk.text);
    const edgeType = chunk.sourceType === 'errata' ? 'supersedes' : 'clarifies';
    const rawLabel =
      chunk.sourceType === 'errata' ? 'Official errata correction' : 'Official FAQ clarification';
    const fromRef = `rules:${game}/${chunk.source}#chunk=${chunk.chunkIndex}`;
    const row: CorrectionQualityRow = {
      source: chunk.source,
      chunkIndex: chunk.chunkIndex,
      edges: 0,
      unmatched: [],
    };

    const push = (toKind: string, toRef: string) => {
      row.edges += 1;
      edgeRows.push({
        game,
        fromKind: 'rules_passage',
        fromRef,
        edgeType,
        toKind,
        toRef,
        provenance: 'corrections',
        metadata: { rawLabel },
      });
    };

    for (const section of refs.sections) {
      if (knownSections.has(section)) push('section', `section:${game}/${section}`);
      else row.unmatched.push(`Section ${section}`);
    }
    for (const scenario of refs.scenarios) {
      const padded = scenario.padStart(3, '0');
      if (knownScenarios.has(padded)) push('scenario', `scenario:${game}/${padded}`);
      else row.unmatched.push(`Scenario ${scenario}`);
    }
    for (const item of refs.items) {
      const sourceId = itemsByNumber.get(item);
      if (sourceId) push('card', `card:${game}/items/${sourceId}`);
      else row.unmatched.push(`Item ${item}`);
    }
    for (const page of refs.pages) {
      row.unmatched.push(`page ${page} (chunks carry no page metadata)`);
    }

    if (row.edges > 0 || row.unmatched.length > 0) report.push(row);
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
      .where(and(eq(knowledgeEdges.game, game), eq(knowledgeEdges.provenance, 'corrections')));
    if (deduped.length > 0) {
      await tx.insert(knowledgeEdges).values(deduped);
    }
  });

  return { game, edges: deduped.length, report };
}
