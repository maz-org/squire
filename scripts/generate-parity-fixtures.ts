/**
 * One-time (committed) script that captures a top-k parity snapshot from the
 * pre-migration flat-file vector store at `data/index.json`.
 *
 * Run against the pre-migration code on commit 35f6e7a to produce:
 *   - test/fixtures/search-queries.json   — 20 fixed queries + expected top-6 IDs
 *   - test/fixtures/vector-parity-fixture.json — the union of entries covering
 *     the top-20 of each query (kept small instead of committing the full 11MB
 *     index as a test fixture). Enough data for the parity test to seed Postgres
 *     and assert the same top-6 IDs come back.
 *
 * Running this script is a one-time operation; the produced fixtures are
 * committed and the parity test reads them without ever needing `data/index.json`.
 *
 * Usage (pre-migration only, as a sanity-refresher):
 *   npx tsx scripts/generate-parity-fixtures.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { embed } from '../src/embedder.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INDEX_PATH = join(ROOT, 'data', 'index.json');
const FIXTURES_DIR = join(ROOT, 'test', 'fixtures');

const QUERIES: string[] = [
  'how does the poison condition work',
  'loot action rules',
  'movement and difficult terrain',
  'retaliate timing',
  'stamina potion',
  'long rest vs short rest',
  'elemental infusion use',
  'advantage and disadvantage',
  'shield value stacks',
  'exhaustion rules',
  'scenario level and gold conversion',
  'opening doors in a scenario',
  'monster focus rules',
  'boss immunities',
  'flying movement over obstacles',
  'jump action specifics',
  'enhancements sticker rules',
  'city events resolution',
  'outpost phase order',
  'battle goals scoring',
];

interface Entry {
  id: string;
  text: string;
  embedding: number[];
  source: string;
  chunkIndex: number;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function topK(index: Entry[], q: number[], k: number): Entry[] {
  return index
    .map((e) => ({ e, s: cosineSimilarity(e.embedding, q) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.e);
}

async function main(): Promise<void> {
  const index: Entry[] = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
  console.log(`loaded ${index.length} entries from ${INDEX_PATH}`);

  const queriesOut: Array<{ query: string; expectedTopIds: string[] }> = [];
  const keepIds = new Set<string>();

  for (const q of QUERIES) {
    const v = await embed(q);
    const top20 = topK(index, v, 20);
    const top6 = top20.slice(0, 6);
    queriesOut.push({ query: q, expectedTopIds: top6.map((e) => e.id) });
    for (const e of top20) keepIds.add(e.id);
    console.log(`  ${q} → ${top6.map((e) => e.id).join(', ')}`);
  }

  const fixtureEntries = index.filter((e) => keepIds.has(e.id));
  console.log(`fixture contains ${fixtureEntries.length} entries (union of top-20 per query)`);

  writeFileSync(
    join(FIXTURES_DIR, 'search-queries.json'),
    JSON.stringify(queriesOut, null, 2) + '\n',
    'utf-8',
  );
  writeFileSync(
    join(FIXTURES_DIR, 'vector-parity-fixture.json'),
    JSON.stringify(fixtureEntries),
    'utf-8',
  );
  console.log('wrote test/fixtures/search-queries.json');
  console.log('wrote test/fixtures/vector-parity-fixture.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
