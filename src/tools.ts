/**
 * Atomic search tools for the Squire knowledge platform.
 * These are standalone data access primitives that agents compose to answer questions.
 */

import { embed } from './embedder.ts';
import { loadIndex, search } from './vector-store.ts';
import type { ScoredEntry } from './vector-store.ts';
import { searchExtracted } from './extracted-data.ts';
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

// ─── Tools ───────────────────────────────────────────────────────────────────

/**
 * Search the rulebook vector index for passages relevant to a query.
 * Returns structured results with text, source, and similarity score.
 */
export async function searchRules(query: string, topK = 6): Promise<RuleResult[]> {
  const index = loadIndex();
  if (index.length === 0) return [];

  const queryEmbedding = await embed(query);
  const hits: ScoredEntry[] = search(index, queryEmbedding, topK);

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
