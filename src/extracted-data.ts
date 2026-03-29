/**
 * Search and format extracted card data for use as RAG context.
 * Loads from data/extracted/<type>.json files produced by extract-card-data.ts.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CardType } from './schemas.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTRACTED_DIR = join(__dirname, '..', 'data', 'extracted');

export const TYPES: CardType[] = [
  'monster-stats',
  'monster-abilities',
  'character-abilities',
  'items',
  'events',
  'battle-goals',
  'buildings',
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface ExtractedRecord extends Record<string, unknown> {
  _type: CardType;
  _error?: string;
  _parseError?: string;
}

// ─── Loading ──────────────────────────────────────────────────────────────────

const _cache: Partial<Record<CardType, ExtractedRecord[]>> = {};

export function load(type: CardType): ExtractedRecord[] {
  if (_cache[type]) return _cache[type];
  const path = join(EXTRACTED_DIR, `${type}.json`);
  if (!existsSync(path)) {
    _cache[type] = [];
    return [];
  }
  const all: ExtractedRecord[] = JSON.parse(readFileSync(path, 'utf-8'));
  // Use records that have data — validation warnings are acceptable, hard errors are not
  _cache[type] = all.filter((r) => !r._error && !r._parseError);
  return _cache[type]!;
}

function loadAll(): ExtractedRecord[] {
  return TYPES.flatMap((t) => load(t).map((r) => ({ ...r, _type: t })));
}

// ─── Text representation ──────────────────────────────────────────────────────

function recordToText(record: ExtractedRecord): string {
  const t = record._type;

  if (t === 'monster-stats') {
    const r = record as ExtractedRecord;
    const normal = r.normal as Record<string, Record<string, number | null>> | undefined;
    const elite = r.elite as Record<string, Record<string, number | null>> | undefined;
    const levels = Object.entries(normal || {})
      .map(([l, s]) => `Level ${l}: Normal(HP ${s?.hp}, Move ${s?.move}, Attack ${s?.attack})`)
      .join('; ');
    const eliteLevels = Object.entries(elite || {})
      .map(([l, s]) => `Level ${l}: Elite(HP ${s?.hp}, Move ${s?.move}, Attack ${s?.attack})`)
      .join('; ');
    const immunities = (r.immunities as string[])?.length
      ? `Immunities: ${(r.immunities as string[]).join(', ')}. `
      : '';
    const notes = r.notes ? `Notes: ${r.notes}` : '';
    return `Monster: ${r.name} (levels ${r.levelRange}). ${levels}. ${eliteLevels}. ${immunities}${notes}`;
  }

  if (t === 'monster-abilities') {
    const r = record as ExtractedRecord;
    const abilities = ((r.abilities as string[]) || []).join('; ');
    return `Monster Ability Card — ${r.monsterType}: "${r.cardName}" (initiative ${r.initiative}). Abilities: ${abilities}`;
  }

  if (t === 'character-abilities') {
    const r = record as ExtractedRecord;
    const top = r.top as { action: string; effects?: string[] } | undefined;
    const bottom = r.bottom as { action: string; effects?: string[] } | undefined;
    const topStr = top
      ? `Top: ${top.action}${top.effects?.length ? ' — ' + top.effects.join(', ') : ''}`
      : '';
    const botStr = bottom
      ? `Bottom: ${bottom.action}${bottom.effects?.length ? ' — ' + bottom.effects.join(', ') : ''}`
      : '';
    const lost = r.lost ? ' [LOST]' : '';
    return `Character Ability — ${(r.characterClass as string) || 'Unknown'} Level ${r.level ?? '?'}: "${r.cardName}" (initiative ${r.initiative}). ${topStr}. ${botStr}.${lost}`;
  }

  if (t === 'items') {
    const r = record as ExtractedRecord;
    const uses = r.uses ? ` (${r.uses} uses)` : '';
    const spent = r.spent ? ' [spent]' : '';
    const lost = r.lost ? ' [lost]' : '';
    return `Item #${r.number}: ${r.name}. Slot: ${r.slot}. Cost: ${r.cost}g. Effect: ${r.effect}${uses}${spent}${lost}`;
  }

  if (t === 'events') {
    const r = record as ExtractedRecord;
    const season = r.season ? `${r.season} ` : '';
    const optA = r.optionA as { text: string; outcome: string } | undefined;
    const optB = r.optionB as { text: string; outcome: string } | null | undefined;
    const a = optA ? `Option A: "${optA.text}" → ${optA.outcome}` : '';
    const b = optB ? `Option B: "${optB.text}" → ${optB.outcome}` : '';
    return `${season}${r.eventType} event #${r.number}: ${r.flavorText} ${a} ${b}`.trim();
  }

  if (t === 'battle-goals') {
    const r = record as ExtractedRecord;
    return `Battle Goal: "${r.name}". Condition: ${r.condition}. Checkmarks: ${r.checkmarks}.`;
  }

  if (t === 'buildings') {
    const r = record as ExtractedRecord;
    const buildCost = r.buildCost as Record<string, number | null> | undefined;
    const cost = buildCost
      ? Object.entries(buildCost)
          .filter(([, v]) => v)
          .map(([k, v]) => `${v} ${k}`)
          .join(', ')
      : 'unknown';
    return `Building #${r.buildingNumber} — ${r.name} Level ${r.level}. Cost: ${cost}. Effect: ${r.effect}. ${(r.notes as string) || ''}`.trim();
  }

  return JSON.stringify(record);
}

// ─── Search ───────────────────────────────────────────────────────────────────

/**
 * Score a record against a query using keyword overlap.
 * Higher = more relevant.
 */
function score(record: ExtractedRecord, queryTokens: string[]): number {
  const text = recordToText(record).toLowerCase();
  let hits = 0;
  for (const token of queryTokens) {
    if (text.includes(token)) hits++;
  }
  return hits;
}

/**
 * Find the top-k most relevant extracted records for a query.
 */
export function searchExtracted(query: string, k = 6): ExtractedRecord[] {
  // Tokenize query: lowercase words ≥ 3 chars, skip common words
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

  if (tokens.length === 0) return [];

  const all = loadAll();
  const scored = all
    .map((r) => ({ record: r, score: score(r, tokens) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, k).map((s) => s.record);
}

/**
 * Format extracted records as a readable string for LLM context.
 */
export function formatExtracted(records: ExtractedRecord[]): string {
  if (records.length === 0) return '';
  return records.map((r) => recordToText(r)).join('\n');
}

/**
 * How many records are loaded across all types.
 */
export function extractedStats(): string {
  return TYPES.map((t) => {
    const records = load(t);
    return `${t}: ${records.length}`;
  }).join(', ');
}
