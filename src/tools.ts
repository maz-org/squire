/**
 * Atomic search tools for the Squire knowledge platform.
 * These are standalone data access primitives that agents compose to answer questions.
 */

import { embed } from './embedder.ts';
import { search } from './vector-store.ts';
import type { ScoredEntry } from './vector-store.ts';
import { searchExtracted, TYPES, load } from './extracted-data.ts';
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

// ─── Tools ───────────────────────────────────────────────────────────────────

/**
 * Search the rulebook vector index for passages relevant to a query.
 * Returns structured results with text, source, and similarity score.
 */
export async function searchRules(query: string, topK = 6): Promise<RuleResult[]> {
  const queryEmbedding = await embed(query);
  const hits: ScoredEntry[] = await search(queryEmbedding, topK);

  return hits.map((h) => ({
    text: h.text,
    source: h.source,
    score: h.score,
  }));
}

/**
 * Search extracted card data using keyword matching.
 * Returns structured results with card type, data, and relevance score.
 */
export function searchCards(query: string, topK = 6): CardResult[] {
  const hits = searchExtracted(query, topK);

  return hits.map((record) => {
    const { _type, ...data } = record;
    return {
      type: _type,
      data,
      score: scoreRecord(record, query),
    };
  });
}

// ─── Discovery tools ─────────────────────────────────────────────────────────

/**
 * List all available card types with record counts.
 * Agents use this for runtime capability discovery.
 */
export function listCardTypes(): CardTypeInfo[] {
  return TYPES.map((type) => ({
    type,
    count: load(type).length,
  }));
}

/**
 * List cards of a given type, optionally filtered by field values.
 * Filter uses AND logic — all specified fields must match.
 */
export function listCards(
  type: CardType,
  filter?: Record<string, unknown>,
): Record<string, unknown>[] {
  let records = load(type);

  if (filter) {
    records = records.filter((record) =>
      Object.entries(filter).every(([key, value]) => key in record && record[key] === value),
    );
  }

  return records.map((record) => {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (!key.startsWith('_')) data[key] = value;
    }
    return data;
  });
}

// ─── ID field mapping ────────────────────────────────────────────────────────

/** The natural identifier field for each card type. */
const ID_FIELDS: Record<CardType, string> = {
  'monster-stats': 'name',
  'monster-abilities': 'cardName',
  'character-abilities': 'cardName',
  'character-mats': 'name',
  items: 'number',
  events: 'number',
  'battle-goals': 'name',
  buildings: 'buildingNumber',
  scenarios: 'index',
  'personal-quests': 'cardId',
};

/**
 * Look up a single card by type and identifier.
 * Uses the natural ID field for each card type (e.g., name for monsters, number for items).
 * Case-insensitive for string identifiers.
 */
export function getCard(type: CardType, id: string): Record<string, unknown> | null {
  const field = ID_FIELDS[type];
  const records = load(type);
  const idLower = id.toLowerCase();

  const match = records.find((record) => {
    const value = record[field];
    if (typeof value === 'string') return value.toLowerCase() === idLower;
    return value === id;
  });

  if (!match) return null;

  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(match)) {
    if (!key.startsWith('_')) data[key] = value;
  }
  return data;
}

/**
 * Re-score a record for the structured result.
 * Uses the same keyword overlap logic as extracted-data.ts.
 */
function scoreRecord(record: Record<string, unknown>, query: string): number {
  const STOPWORDS = new Set([
    'the',
    'and',
    'for',
    'what',
    'how',
    'does',
    'with',
    'this',
    'that',
    'are',
    'can',
    'its',
    'which',
  ]);
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));

  if (tokens.length === 0) return 0;

  const text = JSON.stringify(record).toLowerCase();
  let hits = 0;
  for (const token of tokens) {
    if (text.includes(token)) hits++;
  }
  return hits;
}
