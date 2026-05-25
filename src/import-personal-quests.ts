/**
 * Import personal quest data from Gloomhaven Secretariat (GHS) reference data.
 *
 * Run with: npx tsx src/import-personal-quests.ts
 *
 * Requires: GHS data (set GHS_DATA_DIR env var, or clone into data/gloomhavensecretariat/)
 * Output: data/extracted/personal-quests.json
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { GLOOMHAVEN_2E_GAME_ID, gameDefinitionFor } from './game.ts';
import {
  resolveLabel,
  resolveGameTokens,
  resolveTemplateText,
  loadLabels,
  resolveGhsImporterConfig,
  type GhsImporterConfigInput,
  type LabelData,
} from './ghs-utils.ts';
import { writeExtractedRecords } from './extracted-paths.ts';

// ─── GHS types ──────────────────────────────────────────────────────────────

interface GhsRequirement {
  name: string;
  counter: number | string;
  checkbox?: string[];
  autotrack?: string;
  requires?: number[];
}

interface GhsPersonalQuest {
  cardId: string;
  altId: string;
  spoiler?: boolean;
  requirements: GhsRequirement[];
  openEnvelope?: string;
  unlockCharacter?: string;
  unlockPQ?: string;
  errata?: string;
}

// ─── Our extracted format ───────────────────────────────────────────────────

interface ExtractedRequirement {
  description: string;
  target: number | string;
  options: string[] | null;
  dependsOn: number[] | null;
}

interface ExtractedPersonalQuest {
  cardId: string;
  altId: string;
  name: string;
  requirements: ExtractedRequirement[];
  openEnvelope: string;
  errata: string | null;
  sourceId: string;
}

// ─── Conversion ─────────────────────────────────────────────────────────────

/**
 * Resolve %character.X.Y% tokens to human-readable text, using the same
 * last-segment approach as resolveGameTokens.
 */
function resolveCharacterTokens(text: string): string {
  return text.replace(/%character\.([^%]+)%/g, (_match, path: string) => {
    const parts = path.split('.');
    const lastPart = parts[parts.length - 1];
    return lastPart.charAt(0).toUpperCase() + lastPart.slice(1);
  });
}

/**
 * Resolve a requirement name to human-readable text.
 * Handles %data.% label references, %game.% tokens, and %character.% tokens.
 */
function resolveRequirementName(name: string, labels: LabelData): string {
  const base = /%(?:data|game)\./.test(name) ? resolveTemplateText(name, labels) : name;
  return resolveCharacterTokens(resolveGameTokens(base));
}

/**
 * Look up the quest title from labels. Falls back to "Personal Quest {cardId}"
 * if the label is missing.
 */
function resolveQuestTitle(
  cardId: string,
  labels: LabelData,
  gameLabelPrefix: string = 'fh',
): string {
  const ref = `%data.personalQuest.${gameLabelPrefix}.${cardId}.%`;
  const resolved = resolveLabel(ref, labels);
  if (resolved === ref) {
    return `Personal Quest ${cardId}`;
  }
  return resolved;
}

export function convertPersonalQuest(
  ghs: GhsPersonalQuest,
  labels: LabelData,
  gameLabelPrefix: string = 'fh',
): ExtractedPersonalQuest {
  const requirements: ExtractedRequirement[] = ghs.requirements.map((req) => {
    const description = resolveRequirementName(req.name, labels);

    const options = req.checkbox
      ? req.checkbox.map((opt) => resolveRequirementName(opt, labels))
      : null;

    return {
      description,
      target: req.counter,
      options,
      dependsOn: req.requires ?? null,
    };
  });

  return {
    cardId: ghs.cardId,
    altId: ghs.altId,
    name: resolveQuestTitle(ghs.cardId, labels, gameLabelPrefix),
    requirements,
    openEnvelope:
      ghs.openEnvelope ??
      [
        ghs.unlockCharacter ? `unlock class ${resolveCharacterTokens(ghs.unlockCharacter)}` : null,
        ghs.unlockPQ ? `unlock personal quest ${ghs.unlockPQ}` : null,
      ]
        .filter((part): part is string => part !== null)
        .join('; '),
    errata: ghs.errata ?? null,
    sourceId: `gloomhavensecretariat:personal-quest/${ghs.cardId}`,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

export function importPersonalQuests(
  configInput: GhsImporterConfigInput = {},
): ExtractedPersonalQuest[] {
  const config = resolveGhsImporterConfig(configInput);
  const ghsPersonalQuestsPath = join(config.dataDir, 'personal-quests.json');

  if (!existsSync(ghsPersonalQuestsPath)) {
    throw new Error(
      `GHS personal quest data not found at ${ghsPersonalQuestsPath}. Set GHS_DATA_DIR or clone GHS into data/gloomhavensecretariat/`,
    );
  }

  const labels = loadLabels(config);
  const gameLabelPrefix =
    config.game === GLOOMHAVEN_2E_GAME_ID ? 'gh2e' : gameDefinitionFor(config.game).sourcePrefix;
  const quests: GhsPersonalQuest[] = JSON.parse(readFileSync(ghsPersonalQuestsPath, 'utf-8'));

  const results: ExtractedPersonalQuest[] = [];

  for (const quest of quests) {
    const converted = convertPersonalQuest(quest, labels, gameLabelPrefix);

    // Verify all data/game tokens were resolved
    const allText = [
      converted.name,
      ...converted.requirements.map((r) => r.description),
      ...converted.requirements.flatMap((r) => r.options ?? []),
    ];
    const unresolved = allText.find((t) => /%(?:data|game|character)\./.test(t));
    if (unresolved) {
      throw new Error(`Unresolved label/token in personal quest ${quest.cardId}: ${unresolved}`);
    }

    results.push(converted);
  }

  return results;
}

if (process.argv[1]?.endsWith('import-personal-quests.ts')) {
  const config = resolveGhsImporterConfig();
  const results = importPersonalQuests(config);
  const outputPath = writeExtractedRecords('personal-quests', config.game, results);
  console.log(`Wrote ${results.length} records to ${outputPath}`);
}
