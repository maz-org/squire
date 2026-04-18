/**
 * Atomic search tools for the Squire knowledge platform.
 * These are standalone data access primitives that agents compose to answer questions.
 */

import { embed } from './embedder.ts';
import { formatRetrievalSourceLabel } from './retrieval-source.ts';
import { search } from './vector-store.ts';
import type { ScoredEntry } from './vector-store.ts';
import { countsByType, load, loadOne, searchExtractedRanked, TYPES } from './extracted-data.ts';
import type { CardType } from './schemas.ts';
import {
  findScenarios,
  getScenario as loadScenario,
  getSection as loadSection,
  followLinks as loadLinks,
} from './traversal-data.ts';
import type { TraversalKind, TraversalLinkType } from './traversal-schemas.ts';

// ─── Result types ────────────────────────────────────────────────────────────

export interface RuleResult {
  text: string;
  source: string;
  sourceLabel: string;
  score: number;
}

export interface CardResult {
  type: CardType;
  data: Record<string, unknown>;
  score: number;
}

export interface CardTypeInfo {
  type: CardType;
  count: number;
}

export interface TraversalScenarioResult {
  ref: string;
  scenarioGroup: string;
  scenarioIndex: string;
  name: string;
  complexity: number | null;
  flowChartGroup: string | null;
  initial: boolean;
  sourcePdf: string | null;
  sourcePage: number | null;
  rawText: string | null;
  metadata: Record<string, unknown>;
}

export interface TraversalSectionResult {
  ref: string;
  sectionNumber: number;
  sectionVariant: number;
  sourcePdf: string;
  sourcePage: number;
  text: string;
  metadata: Record<string, unknown>;
}

export interface TraversalLinkResult {
  fromKind: TraversalKind;
  fromRef: string;
  toKind: TraversalKind;
  toRef: string;
  linkType: TraversalLinkType;
  rawLabel: string | null;
  rawContext: string | null;
  sequence: number;
}

interface ToolOpts {
  /** Campaign variant. Defaults to 'frosthaven'. Reserved for Phase 2. */
  game?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Strip internal `_*` marker keys from a card record. */
function stripInternalKeys(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!key.startsWith('_')) out[key] = value;
  }
  return out;
}

// ─── Tools ───────────────────────────────────────────────────────────────────

/**
 * Search the indexed Frosthaven book corpus for passages relevant to a query.
 * Returns structured results with text, raw source, display label, and
 * similarity score.
 *
 * `opts.game` is threaded through to `vector-store.search`, which filters
 * on the `game` column of the embeddings table. Defaults to `'frosthaven'`
 * when omitted.
 */
export async function searchRules(query: string, topK = 6, opts?: ToolOpts): Promise<RuleResult[]> {
  const queryEmbedding = await embed(query);
  const hits: ScoredEntry[] = await search(queryEmbedding, topK, { game: opts?.game });

  return hits.map((h) => ({
    text: h.text,
    source: h.source,
    sourceLabel: formatRetrievalSourceLabel(h.source),
    score: h.score,
  }));
}

/**
 * Search extracted card data using Postgres FTS.
 * Returns structured results with card type, data, and `ts_rank` score.
 */
export async function searchCards(query: string, topK = 6, opts?: ToolOpts): Promise<CardResult[]> {
  const ranked = await searchExtractedRanked(query, topK, opts);
  return ranked.map(({ record, score }) => {
    const { _type, ...rest } = record;
    return {
      type: _type,
      data: stripInternalKeys(rest),
      score,
    };
  });
}

// ─── Discovery tools ─────────────────────────────────────────────────────────

/**
 * List all available card types with record counts.
 * Agents use this for runtime capability discovery.
 */
export async function listCardTypes(opts?: ToolOpts): Promise<CardTypeInfo[]> {
  // Single UNION ALL of `count(*)` per type instead of N full-table scans.
  const counts = await countsByType(opts);
  return TYPES.map((type) => ({ type, count: counts[type] }));
}

/**
 * List cards of a given type, optionally filtered by field values.
 * Filter uses AND logic — all specified fields must match.
 */
export async function listCards(
  type: CardType,
  filter?: Record<string, unknown>,
  opts?: ToolOpts,
): Promise<Record<string, unknown>[]> {
  let records = await load(type, opts);

  if (filter) {
    records = records.filter((record) =>
      Object.entries(filter).every(([key, value]) => key in record && record[key] === value),
    );
  }

  return records.map(stripInternalKeys);
}

/**
 * Look up a single card by type and `sourceId`.
 *
 * Per the storage-migration tech spec §"natural key verification", we resolve
 * against the canonical `sourceId` rather than per-type natural key fields:
 * four per-type natural keys had collisions in the real data, and using
 * `sourceId` everywhere sidesteps the ambiguity entirely. Match is
 * case-sensitive — `sourceId` is a canonical GHS identifier like
 * `gloomhavensecretariat:battle-goal/1301`, not a human-entered string.
 */
export async function getCard(
  type: CardType,
  id: string,
  opts?: ToolOpts,
): Promise<Record<string, unknown> | null> {
  // Indexed single-row lookup via `loadOne` — hits the `(game, source_id)`
  // unique index instead of loading every row and scanning client-side.
  const match = await loadOne(type, id, opts);
  if (!match) return null;
  return stripInternalKeys(match);
}

export async function findScenario(
  query: string,
  opts?: ToolOpts,
): Promise<TraversalScenarioResult[]> {
  return findScenarios(query, 6, opts);
}

export async function getScenario(
  ref: string,
  opts?: ToolOpts,
): Promise<TraversalScenarioResult | null> {
  return loadScenario(ref, opts);
}

export async function getSection(
  ref: string,
  opts?: ToolOpts,
): Promise<TraversalSectionResult | null> {
  return loadSection(ref, opts);
}

export async function followLinks(
  fromKind: TraversalKind,
  fromRef: string,
  linkType?: TraversalLinkType,
  opts?: ToolOpts,
): Promise<TraversalLinkResult[]> {
  return loadLinks(fromKind, fromRef, linkType, opts);
}
