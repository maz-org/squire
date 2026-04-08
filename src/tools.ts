/**
 * Atomic search tools for the Squire knowledge platform.
 * These are standalone data access primitives that agents compose to answer questions.
 */

import { embed } from './embedder.ts';
import { search } from './vector-store.ts';
import type { ScoredEntry } from './vector-store.ts';
import { searchExtractedRanked, TYPES, load } from './extracted-data.ts';
import type { CardType } from './schemas.ts';

// ─── Result types ────────────────────────────────────────────────────────────

export interface RuleResult {
  text: string;
  source: string;
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
 * Search the rulebook vector index for passages relevant to a query.
 * Returns structured results with text, source, and similarity score.
 *
 * `opts.game` is accepted for API symmetry with the card tools; the vector
 * store does not yet filter on game, so it's currently a no-op. Phase 2
 * will add a game-tagged rulebook index.
 */
export async function searchRules(
  query: string,
  topK = 6,
  _opts?: ToolOpts,
): Promise<RuleResult[]> {
  const queryEmbedding = await embed(query);
  const hits: ScoredEntry[] = await search(queryEmbedding, topK);

  return hits.map((h) => ({
    text: h.text,
    source: h.source,
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
  return Promise.all(
    TYPES.map(async (type) => ({
      type,
      count: (await load(type, opts)).length,
    })),
  );
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
  const records = await load(type, opts);
  const match = records.find((record) => record.sourceId === id);
  if (!match) return null;
  return stripInternalKeys(match);
}
