/**
 * Search and format extracted card data for use as RAG context.
 * Loads from data/extracted/<type>.json files produced by extract-card-data.js.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTRACTED_DIR = join(__dirname, '..', 'data', 'extracted');

const TYPES = [
  'monster-stats',
  'monster-abilities',
  'character-abilities',
  'items',
  'events',
  'battle-goals',
  'buildings',
];

// ─── Loading ──────────────────────────────────────────────────────────────────

const _cache = {};

function load(type) {
  if (_cache[type]) return _cache[type];
  const path = join(EXTRACTED_DIR, `${type}.json`);
  if (!existsSync(path)) {
    _cache[type] = [];
    return [];
  }
  const all = JSON.parse(readFileSync(path, 'utf-8'));
  // Use records that have data — validation warnings are acceptable, hard errors are not
  _cache[type] = all.filter((r) => !r._error && !r._parseError);
  return _cache[type];
}

function loadAll() {
  return TYPES.flatMap((t) => load(t).map((r) => ({ ...r, _type: t })));
}

// ─── Text representation ──────────────────────────────────────────────────────

function recordToText(record) {
  const t = record._type;

  if (t === 'monster-stats') {
    const levels = Object.entries(record.normal || {})
      .map(
        ([l, s]) =>
          `Level ${l}: Normal(HP ${s?.hp}, Move ${s?.move}, Attack ${s?.attack}${s?.range ? `, Range ${s.range}` : ''})`,
      )
      .join('; ');
    const eliteLevels = Object.entries(record.elite || {})
      .map(
        ([l, s]) =>
          `Level ${l}: Elite(HP ${s?.hp}, Move ${s?.move}, Attack ${s?.attack}${s?.range ? `, Range ${s.range}` : ''})`,
      )
      .join('; ');
    const immunities = record.immunities?.length
      ? `Immunities: ${record.immunities.join(', ')}. `
      : '';
    const notes = record.notes ? `Notes: ${record.notes}` : '';
    return `Monster: ${record.name} (levels ${record.levelRange}). ${levels}. ${eliteLevels}. ${immunities}${notes}`;
  }

  if (t === 'monster-abilities') {
    const abilities = (record.abilities || []).join('; ');
    return `Monster Ability Card — ${record.monsterType}: "${record.cardName}" (initiative ${record.initiative}). Abilities: ${abilities}`;
  }

  if (t === 'character-abilities') {
    const top = record.top
      ? `Top: ${record.top.action}${record.top.effects?.length ? ' — ' + record.top.effects.join(', ') : ''}`
      : '';
    const bot = record.bottom
      ? `Bottom: ${record.bottom.action}${record.bottom.effects?.length ? ' — ' + record.bottom.effects.join(', ') : ''}`
      : '';
    const lost = record.lost ? ' [LOST]' : '';
    return `Character Ability — ${record.characterClass || 'Unknown'} Level ${record.level ?? '?'}: "${record.cardName}" (initiative ${record.initiative}). ${top}. ${bot}.${lost}`;
  }

  if (t === 'items') {
    const uses = record.uses ? ` (${record.uses} uses)` : '';
    const spent = record.spent ? ' [spent]' : '';
    const lost = record.lost ? ' [lost]' : '';
    return `Item #${record.number}: ${record.name}. Slot: ${record.slot}. Cost: ${record.cost}g. Effect: ${record.effect}${uses}${spent}${lost}`;
  }

  if (t === 'events') {
    const season = record.season ? `${record.season} ` : '';
    const a = record.optionA
      ? `Option A: "${record.optionA.text}" → ${record.optionA.outcome}`
      : '';
    const b = record.optionB
      ? `Option B: "${record.optionB.text}" → ${record.optionB.outcome}`
      : '';
    return `${season}${record.eventType} event #${record.number}: ${record.flavorText} ${a} ${b}`.trim();
  }

  if (t === 'battle-goals') {
    return `Battle Goal: "${record.name}". Condition: ${record.condition}. Checkmarks: ${record.checkmarks}.`;
  }

  if (t === 'buildings') {
    const cost = record.buildCost
      ? Object.entries(record.buildCost)
          .filter(([, v]) => v)
          .map(([k, v]) => `${v} ${k}`)
          .join(', ')
      : 'unknown';
    return `Building #${record.buildingNumber} — ${record.name} Level ${record.level}. Cost: ${cost}. Effect: ${record.effect}. ${record.notes || ''}`.trim();
  }

  return JSON.stringify(record);
}

// ─── Search ───────────────────────────────────────────────────────────────────

/**
 * Score a record against a query using keyword overlap.
 * Higher = more relevant.
 */
function score(record, queryTokens) {
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
export function searchExtracted(query, k = 6) {
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
export function formatExtracted(records) {
  if (records.length === 0) return '';
  return records.map((r) => recordToText(r)).join('\n');
}

/**
 * How many records are loaded across all types.
 */
export function extractedStats() {
  return TYPES.map((t) => {
    const records = load(t);
    return `${t}: ${records.length}`;
  }).join(', ');
}
