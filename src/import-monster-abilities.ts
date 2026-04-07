/**
 * Import monster ability cards from Gloomhaven Secretariat (GHS) reference data.
 * GHS monster deck data uses the same GhsDeck/GhsAbility format as character decks
 * but is simpler — no top/bottom split, no levels, no lost flags.
 *
 * Run with: npx tsx src/import-monster-abilities.ts
 *
 * Requires: GHS data (set GHS_DATA_DIR env var, or clone into data/gloomhavensecretariat/)
 * Output: data/extracted/monster-abilities.json
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GHS_DATA_DIR,
  kebabToTitle,
  formatAction,
  loadLabels,
  type GhsAbility,
  type GhsDeck,
  type LabelData,
} from './ghs-utils.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GHS_DECK_DIR = join(GHS_DATA_DIR, 'monster', 'deck');
const OUTPUT_PATH = join(__dirname, '..', 'data', 'extracted', 'monster-abilities.json');

// ─── Our extracted format ────────────────────────────────────────────────────

interface ExtractedMonsterAbility {
  monsterType: string;
  cardName: string;
  initiative: number;
  abilities: string[];
  sourceId: string;
}

// ─── Conversion ──────────────────────────────────────────────────────────────

/**
 * Convert a single GHS ability object into our MonsterAbility format.
 */
export function convertMonsterAbility(
  ghs: GhsAbility,
  deckName: string,
  labels: LabelData,
): ExtractedMonsterAbility {
  const abilities = (ghs.actions ?? [])
    .map((a) => formatAction(a, labels))
    .filter((s): s is string => s !== null);

  return {
    monsterType: kebabToTitle(deckName),
    cardName: ghs.name,
    initiative: ghs.initiative,
    abilities,
    sourceId: `gloomhavensecretariat:monster-ability/${deckName}/${ghs.cardId}`,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function importMonsterAbilities(): ExtractedMonsterAbility[] {
  if (!existsSync(GHS_DECK_DIR)) {
    throw new Error(
      `GHS data not found at ${GHS_DECK_DIR}. Set GHS_DATA_DIR or clone GHS into data/gloomhavensecretariat/`,
    );
  }

  const labels = loadLabels();
  const allResults: ExtractedMonsterAbility[] = [];

  for (const file of readdirSync(GHS_DECK_DIR).sort()) {
    if (!file.endsWith('.json')) continue;

    const deckName = basename(file, '.json');
    const deck: GhsDeck = JSON.parse(readFileSync(join(GHS_DECK_DIR, file), 'utf-8'));

    // Sort by cardId so dedupe is deterministic — keep the lowest-ID copy.
    const sortedAbilities = [...deck.abilities].sort((a, b) => a.cardId - b.cardId);

    // Dedupe within a deck by content equivalence. Upstream GHS data contains
    // genuine duplicates (e.g. ancient-artillery cards 627 and 628 both
    // "Exploding Ammunition" with byte-identical actions). Keep the first
    // occurrence and drop subsequent rows whose (name, initiative, abilities)
    // tuple matches a row already kept. Log dropped sourceIds to stderr so
    // reviewers can spot the upstream dupes.
    const seen = new Set<string>();

    for (const ability of sortedAbilities) {
      const converted = convertMonsterAbility(ability, deckName, labels);

      // Replace any unresolved label references with a placeholder — some solo
      // scenario trap decks have labels that are legitimately missing upstream
      converted.abilities = converted.abilities.map((text) =>
        /%data\./.test(text) ? '(ability text not yet available)' : text,
      );

      // Fail if any game tokens survived resolution (these should always resolve)
      const unresolvedGame = converted.abilities.find((t) => /%game\./.test(t));
      if (unresolvedGame) {
        throw new Error(
          `Unresolved game token in ${deckName}/${ability.cardId}: ${unresolvedGame}`,
        );
      }

      const dedupeKey = `${converted.cardName}|${converted.initiative}|${JSON.stringify(converted.abilities)}`;
      if (seen.has(dedupeKey)) {
        console.warn(
          `[import-monster-abilities] dropping upstream duplicate: ${converted.sourceId} (matches an earlier row in ${deckName})`,
        );
        continue;
      }
      seen.add(dedupeKey);

      allResults.push(converted);
    }
  }

  return allResults;
}

if (process.argv[1]?.endsWith('import-monster-abilities.ts')) {
  const results = importMonsterAbilities();
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Wrote ${results.length} records to ${OUTPUT_PATH}`);
}
