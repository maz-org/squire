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

import type { GameId } from './game.ts';
import {
  resolveCharacterDisplayName,
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
  /**
   * Two-speed cards (Blinkblade) encode both initiatives in one number:
   * 2050 = initiative 20 when played fast, 50 when played slow. Present on
   * two-speed cards only (SQR-396; ruling from the epoch-2 calibration).
   */
  initiativeFast?: number;
  initiativeSlow?: number;
  top: { action: string; effects: string[] };
  bottom: { action: string; effects: string[] };
  lost: boolean;
  sourceId: string;
}

// Classes whose cards encode two initiatives in one number (XXYY). Gating on
// the class keeps an unexpected >99 initiative on any other deck a loud
// import failure instead of a silent mis-decode (CodeRabbit, PR 664).
const TWO_SPEED_CHARACTERS = new Set(['blinkblade']);

/** Decode a GHS two-speed initiative (XXYY) into fast/slow halves. */
export function twoSpeedInitiative(
  initiative: number,
  characterName: string,
): { fast: number; slow: number } | undefined {
  if (!Number.isInteger(initiative) || initiative <= 99) return undefined;
  if (!TWO_SPEED_CHARACTERS.has(characterName) || initiative > 9999) {
    throw new Error(
      `Unexpected initiative ${initiative} on ${characterName}: only two-speed classes (${[...TWO_SPEED_CHARACTERS].join(', ')}) may exceed 99.`,
    );
  }
  return { fast: Math.floor(initiative / 100), slow: initiative % 100 };
}

// ─── Conversion ──────────────────────────────────────────────────────────────

/**
 * Convert a single GHS ability object into our CharacterAbility format.
 */
export function convertAbility(
  ghs: GhsAbility,
  characterName: string,
  labels: LabelData,
  game?: GameId,
): ExtractedCharacterAbility {
  const topParts = (ghs.actions ?? [])
    .map((a) => formatAction(a, labels))
    .filter((s): s is string => s !== null);

  const bottomParts = (ghs.bottomActions ?? [])
    .map((a) => formatAction(a, labels))
    .filter((s): s is string => s !== null);

  const twoSpeed = twoSpeedInitiative(ghs.initiative, characterName);

  return {
    cardName: ghs.name,
    characterClass: resolveCharacterDisplayName(characterName, labels, game),
    level: ghs.level,
    initiative: ghs.initiative,
    ...(twoSpeed ? { initiativeFast: twoSpeed.fast, initiativeSlow: twoSpeed.slow } : {}),
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
      const converted = convertAbility(ability, characterName, labels, config.game);
      const duplicateCount = sourceIdCounts.get(converted.sourceId) ?? 0;
      sourceIdCounts.set(converted.sourceId, duplicateCount + 1);
      if (duplicateCount > 0) {
        converted.sourceId = `${converted.sourceId}/duplicate-${duplicateCount + 1}`;
      }
      const replaceMissingLabel = (text: string) =>
        /%data\./.test(text) ? '(ability text not yet available)' : text;
      // Known upstream GHS typos (gh2e cragheart 116, doomstalker 367);
      // tracked for upstream fixes, normalized here so answers quote the
      // printed card text.
      const fixKnownTypos = (text: string) =>
        text
          .replace(/\b([Tt]his) an your\b/g, '$1 and your')
          .replace(/\b([Ww]hile) there os another\b/g, '$1 there is another');
      converted.top.action = fixKnownTypos(converted.top.action);
      converted.top.effects = converted.top.effects.map(fixKnownTypos);
      converted.bottom.action = fixKnownTypos(converted.bottom.action);
      converted.bottom.effects = converted.bottom.effects.map(fixKnownTypos);
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
