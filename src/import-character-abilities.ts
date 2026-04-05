/**
 * Import character ability cards from Gloomhaven Secretariat (GHS) reference data.
 * GHS deck data has correct class assignment and structured actions — far better
 * than OCR, which fails to extract characterClass on 95% of cards.
 *
 * Run with: npx tsx src/import-character-abilities.ts
 *
 * Requires: GHS data (set GHS_DATA_DIR env var, or clone into data/gloomhavensecretariat/)
 * Output: data/extracted/character-abilities.json
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
const GHS_DECK_DIR = join(GHS_DATA_DIR, 'character', 'deck');
const OUTPUT_PATH = join(__dirname, '..', 'data', 'extracted', 'character-abilities.json');

// ─── Our extracted format ────────────────────────────────────────────────────

interface ExtractedCharacterAbility {
  cardName: string;
  characterClass: string;
  level: number | 'X';
  initiative: number;
  top: { action: string; effects: string[] };
  bottom: { action: string; effects: string[] };
  lost: boolean;
  _source: string;
}

// ─── Conversion ──────────────────────────────────────────────────────────────

/**
 * Convert a single GHS ability object into our CharacterAbility format.
 */
export function convertAbility(
  ghs: GhsAbility,
  characterName: string,
  labels: LabelData,
): ExtractedCharacterAbility {
  const topParts = (ghs.actions ?? [])
    .map((a) => formatAction(a, labels))
    .filter((s): s is string => s !== null);

  const bottomParts = (ghs.bottomActions ?? [])
    .map((a) => formatAction(a, labels))
    .filter((s): s is string => s !== null);

  return {
    cardName: ghs.name,
    characterClass: kebabToTitle(characterName),
    level: ghs.level,
    initiative: ghs.initiative,
    top: {
      action: topParts[0] ?? '',
      effects: topParts.slice(1),
    },
    bottom: {
      action: bottomParts[0] ?? '',
      effects: bottomParts.slice(1),
    },
    lost: !!(ghs.bottomLost || ghs.topLost),
    _source: `gloomhavensecretariat:${characterName}/${ghs.cardId}`,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function importCharacterAbilities(): ExtractedCharacterAbility[] {
  if (!existsSync(GHS_DECK_DIR)) {
    throw new Error(
      `GHS data not found at ${GHS_DECK_DIR}. Set GHS_DATA_DIR or clone GHS into data/gloomhavensecretariat/`,
    );
  }

  const labels = loadLabels();
  const allResults: ExtractedCharacterAbility[] = [];

  for (const file of readdirSync(GHS_DECK_DIR).sort()) {
    if (!file.endsWith('.json')) continue;

    const characterName = basename(file, '.json');
    const deck: GhsDeck = JSON.parse(readFileSync(join(GHS_DECK_DIR, file), 'utf-8'));

    for (const ability of deck.abilities) {
      const converted = convertAbility(ability, characterName, labels);

      // Fail if any data/game tokens survived resolution (but not WIP placeholders,
      // which are legitimately incomplete in upstream GHS data)
      const allText = [
        converted.top.action,
        ...converted.top.effects,
        converted.bottom.action,
        ...converted.bottom.effects,
      ];
      const unresolved = allText.find(
        (t) => /%(?:data|game)\./.test(t) && !t.includes('%character.abilities.wip%'),
      );
      if (unresolved) {
        throw new Error(
          `Unresolved label/token in ${characterName}/${ability.cardId}: ${unresolved}`,
        );
      }

      allResults.push(converted);
    }
  }

  return allResults;
}

if (process.argv[1]?.endsWith('import-character-abilities.ts')) {
  const results = importCharacterAbilities();
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Wrote ${results.length} records to ${OUTPUT_PATH}`);
}
