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

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

import {
  kebabToTitle,
  formatAction,
  loadLabels,
  resolveGhsImporterConfig,
  type GhsAbility,
  type GhsDeck,
  type GhsImporterConfigInput,
  type LabelData,
} from './ghs-utils.ts';
import { writeExtractedRecords } from './extracted-paths.ts';

// ─── Our extracted format ────────────────────────────────────────────────────

interface ExtractedCharacterAbility {
  cardName: string;
  characterClass: string;
  level: number | 'X' | 'M';
  initiative: number;
  top: { action: string; effects: string[] };
  bottom: { action: string; effects: string[] };
  lost: boolean;
  sourceId: string;
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
    sourceId: `gloomhavensecretariat:character-ability/${characterName}/${ghs.cardId}`,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function importCharacterAbilities(
  configInput: GhsImporterConfigInput = {},
): ExtractedCharacterAbility[] {
  const config = resolveGhsImporterConfig(configInput);
  const ghsDeckDir = join(config.dataDir, 'character', 'deck');

  if (!existsSync(ghsDeckDir)) {
    throw new Error(
      `GHS data not found at ${ghsDeckDir}. Set GHS_DATA_DIR or clone GHS into data/gloomhavensecretariat/`,
    );
  }

  const labels = loadLabels(config);
  const allResults: ExtractedCharacterAbility[] = [];

  for (const file of readdirSync(ghsDeckDir).sort()) {
    if (!file.endsWith('.json')) continue;

    const characterName = basename(file, '.json');
    const deck: GhsDeck = JSON.parse(readFileSync(join(ghsDeckDir, file), 'utf-8'));
    const sourceIdCounts = new Map<string, number>();

    for (const ability of deck.abilities) {
      const converted = convertAbility(ability, characterName, labels);
      const duplicateCount = sourceIdCounts.get(converted.sourceId) ?? 0;
      sourceIdCounts.set(converted.sourceId, duplicateCount + 1);
      if (duplicateCount > 0) {
        converted.sourceId = `${converted.sourceId}/duplicate-${duplicateCount + 1}`;
      }
      const replaceMissingLabel = (text: string) =>
        /%data\./.test(text) ? '(ability text not yet available)' : text;
      converted.top.action = replaceMissingLabel(converted.top.action);
      converted.top.effects = converted.top.effects.map(replaceMissingLabel);
      converted.bottom.action = replaceMissingLabel(converted.bottom.action);
      converted.bottom.effects = converted.bottom.effects.map(replaceMissingLabel);

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
  const config = resolveGhsImporterConfig();
  const results = importCharacterAbilities(config);
  const outputPath = writeExtractedRecords('character-abilities', config.game, results);
  console.log(`Wrote ${results.length} records to ${outputPath}`);
}
