/**
 * Capture pre-migration parity snapshots for SQR-55.
 *
 * Two artifacts:
 *
 * 1. `test/fixtures/parity-snapshots/<type>.json` — full `load(type)` output
 *    for all 10 card types, sorted by `sourceId` so it lines up with the
 *    post-migration `ORDER BY source_id` (Decision 2 in
 *    `docs/plans/sqr-34-execution.md`).
 *
 * 2. `test/fixtures/search-queries/cards.json` — for each seed query, the
 *    top-6 `sourceId`s returned by the **current** keyword scorer in
 *    `src/extracted-data.ts`. SQR-57 will replace this file with the
 *    post-FTS rankings, but the baseline lets us reason about the delta.
 *
 * This script imports the JSON-backed `load` / `searchExtracted` directly.
 * It MUST run before `extracted-data.ts` is rewritten in SQR-56 — once that
 * happens, the source of truth for these snapshots is gone.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load, searchExtracted, TYPES } from '../src/extracted-data.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SNAPSHOT_DIR = join(REPO_ROOT, 'test', 'fixtures', 'parity-snapshots');
const SEARCH_QUERIES_DIR = join(REPO_ROOT, 'test', 'fixtures', 'search-queries');

// ~20 queries chosen to exercise all 10 card types. Any that return zero hits
// against the current scorer get reported on stderr — adjust the list rather
// than committing empty entries.
const SEED_QUERIES = [
  'algox archer hp',
  'drifter level 3 abilities',
  'prosperity 3 items',
  'minor healing potion',
  'winter outpost event',
  'wall building cost',
  'scenario temple liberation',
  'personal quest envelope',
  'battle goal assassin',
  'monster initiative low',
  'fire elemental immunity',
  'shield boots small item',
  'boss monster stats',
  'wood gathering camp',
  'starting scenario',
  'two-handed weapon',
  'level 0 monster move',
  'summer road event',
  'character mat hand size',
  'loot deck herbs',
];

function main(): void {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  mkdirSync(SEARCH_QUERIES_DIR, { recursive: true });

  // ─── load() snapshots ────────────────────────────────────────────────────
  for (const type of TYPES) {
    const records = [...load(type)].sort((a, b) =>
      String(a.sourceId).localeCompare(String(b.sourceId)),
    );
    const out = join(SNAPSHOT_DIR, `${type}.json`);
    writeFileSync(out, JSON.stringify(records, null, 2) + '\n');
    console.log(`✓ ${type}: ${records.length} records → ${out}`);
  }

  // ─── searchExtracted() top-6 ─────────────────────────────────────────────
  const cardQueries: Array<{ query: string; expectedTopSourceIds: string[] }> = [];
  for (const query of SEED_QUERIES) {
    const hits = searchExtracted(query, 6);
    if (hits.length === 0) {
      console.warn(`! query "${query}" returned zero hits — consider replacing it`);
    }
    cardQueries.push({
      query,
      expectedTopSourceIds: hits.map((r) => String(r.sourceId)),
    });
  }
  const cardsOut = join(SEARCH_QUERIES_DIR, 'cards.json');
  writeFileSync(cardsOut, JSON.stringify(cardQueries, null, 2) + '\n');
  console.log(`✓ ${cardQueries.length} queries → ${cardsOut}`);
}

main();
