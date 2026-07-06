/**
 * Seed concept nodes and their knowledge_edges (ADR 0027, SQR-402).
 *
 * Deterministic ingest — no model calls. Per game, inside one transaction:
 * replace `knowledge_concepts` rows from the curated list, delete edges with
 * provenance `concepts`, then re-derive:
 *
 * - `defines`: the single best rulebook chunk per concept (word-boundary
 *   occurrence count, early-position bonus, lowest chunk index tie-break).
 * - `clarifies`: every FAQ/errata chunk that mentions the concept.
 * - `references`: cards whose printed text mentions the concept
 *   (character-ability top/bottom, item effect, monster-ability abilities).
 *
 * The returned quality report lists per-concept counts and any concept with
 * no `defines` match, so curation gaps are visible instead of silent.
 */

import { and, eq } from 'drizzle-orm';

import type { Db } from '../db.ts';
import { DEFAULT_GAME_ID, requireGameId, type GameId } from '../game.ts';
import { knowledgeConcepts } from '../db/schema/knowledge-concepts.ts';
import { knowledgeEdges } from '../db/schema/knowledge-edges.ts';
import { cardCharacterAbilities, cardItems, cardMonsterAbilities } from '../db/schema/cards.ts';
import { ruleSourceEmbeddings } from '../db/schema/core.ts';
import { ruleSourceProvenance } from '../rule-source-provenance.ts';
import { CONCEPT_SEEDS, type ConceptSeed } from './concepts-data.ts';

export interface ConceptQualityRow {
  slug: string;
  defines: number;
  clarifies: number;
  references: number;
}

export interface SeedConceptsResult {
  game: GameId;
  concepts: number;
  edges: number;
  report: ConceptQualityRow[];
  /** Concepts with no rulebook definition chunk — curation gaps. */
  undefinedConcepts: string[];
}

/** Word-boundary, case-insensitive matcher over the concept's surface forms. */
export function conceptPattern(concept: Pick<ConceptSeed, 'name' | 'aliases'>): RegExp {
  const escaped = [concept.name, ...concept.aliases].map((term) =>
    term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'),
  );
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'gi');
}

/**
 * Score a chunk as a definition candidate: total occurrences, plus a strong
 * bonus when the term appears early (definitions lead with the term; passing
 * mentions do not).
 */
export function definitionScore(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  let count = 0;
  let firstIndex = -1;
  for (const match of text.matchAll(pattern)) {
    count += 1;
    if (firstIndex === -1) firstIndex = match.index;
  }
  if (count === 0) return 0;
  return count + (firstIndex >= 0 && firstIndex < 200 ? 10 : 0);
}

interface ChunkRow {
  source: string;
  chunkIndex: number;
  text: string;
}

/**
 * Pick the single best defining chunk, deterministically: highest score,
 * then lowest chunk index, then source name.
 */
export function findDefiningChunk(chunks: ChunkRow[], pattern: RegExp): ChunkRow | null {
  let best: { chunk: ChunkRow; score: number } | null = null;
  for (const chunk of chunks) {
    const score = definitionScore(chunk.text, pattern);
    if (score === 0) continue;
    if (
      !best ||
      score > best.score ||
      (score === best.score &&
        (chunk.chunkIndex < best.chunk.chunkIndex ||
          (chunk.chunkIndex === best.chunk.chunkIndex && chunk.source < best.chunk.source)))
    ) {
      best = { chunk, score };
    }
  }
  return best?.chunk ?? null;
}

function matches(text: string | null | undefined, pattern: RegExp): boolean {
  if (!text) return false;
  pattern.lastIndex = 0;
  return pattern.test(text);
}

export interface SeedConceptsOptions {
  game?: string;
}

export async function seedConcepts(
  db: Db,
  opts: SeedConceptsOptions = {},
): Promise<SeedConceptsResult> {
  const game = requireGameId(opts.game ?? DEFAULT_GAME_ID);
  const seeds = CONCEPT_SEEDS[game] ?? [];

  const chunks = await db
    .select({
      source: ruleSourceEmbeddings.source,
      chunkIndex: ruleSourceEmbeddings.chunkIndex,
      text: ruleSourceEmbeddings.text,
    })
    .from(ruleSourceEmbeddings)
    .where(eq(ruleSourceEmbeddings.game, game));

  const rulebookChunks: ChunkRow[] = [];
  const clarifyingChunks: ChunkRow[] = [];
  for (const chunk of chunks) {
    const { sourceType } = ruleSourceProvenance(chunk.source, game);
    if (sourceType === 'rulebook') rulebookChunks.push(chunk);
    else if (sourceType === 'faq' || sourceType === 'errata') clarifyingChunks.push(chunk);
  }

  const cardRows: Array<{ ref: string; text: string }> = [];
  for (const ability of await db
    .select({
      sourceId: cardCharacterAbilities.sourceId,
      top: cardCharacterAbilities.top,
      bottom: cardCharacterAbilities.bottom,
    })
    .from(cardCharacterAbilities)
    .where(eq(cardCharacterAbilities.game, game))) {
    cardRows.push({
      ref: `card:${game}/character-abilities/${ability.sourceId}`,
      text: [ability.top, ability.bottom].filter(Boolean).join('\n'),
    });
  }
  for (const item of await db
    .select({ sourceId: cardItems.sourceId, effect: cardItems.effect })
    .from(cardItems)
    .where(eq(cardItems.game, game))) {
    cardRows.push({ ref: `card:${game}/items/${item.sourceId}`, text: item.effect ?? '' });
  }
  for (const monster of await db
    .select({
      sourceId: cardMonsterAbilities.sourceId,
      abilities: cardMonsterAbilities.abilities,
    })
    .from(cardMonsterAbilities)
    .where(eq(cardMonsterAbilities.game, game))) {
    cardRows.push({
      ref: `card:${game}/monster-abilities/${monster.sourceId}`,
      text:
        typeof monster.abilities === 'string'
          ? monster.abilities
          : JSON.stringify(monster.abilities ?? ''),
    });
  }

  const conceptRows = seeds.map((seed) => ({
    game,
    slug: seed.slug,
    name: seed.name,
    category: seed.category,
    aliases: seed.aliases,
  }));

  const edgeRows: Array<typeof knowledgeEdges.$inferInsert> = [];
  const report: ConceptQualityRow[] = [];
  const undefinedConcepts: string[] = [];

  for (const seed of seeds) {
    const conceptRef = `concept:${game}/${seed.slug}`;
    const pattern = conceptPattern(seed);
    const row: ConceptQualityRow = { slug: seed.slug, defines: 0, clarifies: 0, references: 0 };

    const defining = findDefiningChunk(rulebookChunks, pattern);
    if (defining) {
      row.defines = 1;
      edgeRows.push({
        game,
        fromKind: 'rules_passage',
        fromRef: `rules:${game}/${defining.source}#chunk=${defining.chunkIndex}`,
        edgeType: 'defines',
        toKind: 'concept',
        toRef: conceptRef,
        provenance: 'concepts',
        metadata: { rawLabel: `Rulebook definition of ${seed.name}` },
      });
    } else {
      undefinedConcepts.push(seed.slug);
    }

    for (const chunk of clarifyingChunks) {
      if (!matches(chunk.text, pattern)) continue;
      row.clarifies += 1;
      edgeRows.push({
        game,
        fromKind: 'rules_passage',
        fromRef: `rules:${game}/${chunk.source}#chunk=${chunk.chunkIndex}`,
        edgeType: 'clarifies',
        toKind: 'concept',
        toRef: conceptRef,
        provenance: 'concepts',
        metadata: { rawLabel: `FAQ/errata clarification of ${seed.name}` },
      });
    }

    for (const card of cardRows) {
      if (!matches(card.text, pattern)) continue;
      row.references += 1;
      edgeRows.push({
        game,
        fromKind: 'card',
        fromRef: card.ref,
        edgeType: 'references',
        toKind: 'concept',
        toRef: conceptRef,
        provenance: 'concepts',
        metadata: { rawLabel: `Card text mentions ${seed.name}` },
      });
    }

    report.push(row);
  }

  await db.transaction(async (tx) => {
    await tx.delete(knowledgeConcepts).where(eq(knowledgeConcepts.game, game));
    await tx
      .delete(knowledgeEdges)
      .where(and(eq(knowledgeEdges.game, game), eq(knowledgeEdges.provenance, 'concepts')));
    if (conceptRows.length > 0) {
      await tx.insert(knowledgeConcepts).values(conceptRows);
    }
    if (edgeRows.length > 0) {
      await tx.insert(knowledgeEdges).values(edgeRows);
    }
  });

  return { game, concepts: conceptRows.length, edges: edgeRows.length, report, undefinedConcepts };
}
