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
import { SCHEMAS } from '../src/schemas.ts';

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
  // Three alignment requirements for SQR-57's parity test:
  //
  // 1. Records are filtered through the same Zod schema that `seedCards` uses,
  //    so the snapshot matches what the seeded `card_*` tables actually
  //    contain. Otherwise the 18 scenarios / 1 monster ability / 1 character
  //    mat that fail Zod validation would be in the snapshot but not the DB.
  //
  // 2. We sort by raw byte order (not `localeCompare`) so the snapshot lines
  //    up with Postgres `ORDER BY source_id` under the default `C`-equivalent
  //    collation. JS `Intl.Collator` and Postgres ICU sort can disagree on
  //    punctuation/digit boundaries, which would silently break parity.
  //
  // 3. The set of valid sourceIds is captured here and reused below to filter
  //    `searchExtracted` results, so cards.json measures the same population
  //    that the seeded DB will measure post-migration.
  const validSourceIds = new Set<string>();
  for (const type of TYPES) {
    const schema = SCHEMAS[type];
    const records = load(type)
      .filter((r) => schema.safeParse(r).success)
      .slice()
      .sort((a, b) => {
        const sa = String(a.sourceId);
        const sb = String(b.sourceId);
        return sa < sb ? -1 : sa > sb ? 1 : 0;
      });
    for (const record of records) {
      validSourceIds.add(String(record.sourceId));
    }
    const out = join(SNAPSHOT_DIR, `${type}.json`);
    writeFileSync(out, JSON.stringify(records, null, 2) + '\n');
    console.log(`✓ ${type}: ${records.length} records → ${out}`);
  }

  // ─── searchExtracted() top-6 ─────────────────────────────────────────────
  // Pull a wide window from `searchExtracted`, drop hits that point at records
  // the seed would skip, then take the top 6. This keeps the cards.json
  // baseline measuring the same corpus as the seeded DB.
  //
  // Empty results are a hard failure: they're useless to SQR-57's parity test
  // and would silently mask query-list rot.
  const cardQueries: Array<{ query: string; expectedTopSourceIds: string[] }> = [];
  for (const query of SEED_QUERIES) {
    const hits = searchExtracted(query, 200)
      .filter((r) => validSourceIds.has(String(r.sourceId)))
      .slice(0, 6);
    if (hits.length === 0) {
      throw new Error(
        `Query "${query}" returned zero seeded hits; replace it before committing cards.json`,
      );
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
