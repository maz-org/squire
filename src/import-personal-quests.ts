/**
 * Import personal quest data from Gloomhaven Secretariat (GHS) reference data.
 *
 * Run with: npx tsx src/import-personal-quests.ts
 *
 * Requires: data/gloomhavensecretariat/ (git submodule)
 * Output: data/extracted/personal-quests.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GHS_DATA_DIR,
  resolveLabel,
  resolveGameTokens,
  loadLabels,
  type LabelData,
} from './ghs-utils.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GHS_PERSONAL_QUESTS_PATH = join(GHS_DATA_DIR, 'personal-quests.json');
const OUTPUT_PATH = join(__dirname, '..', 'data', 'extracted', 'personal-quests.json');

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
  openEnvelope: string;
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
  name: string;
  requirements: ExtractedRequirement[];
  openEnvelope: string;
  _source: string;
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
  if (name.startsWith('%data.')) {
    return resolveLabel(name, labels);
  }
  // For non-%data. refs, resolve both game and character tokens
  let result = resolveGameTokens(name);
  result = resolveCharacterTokens(result);
  return result;
}

/**
 * Look up the quest title from labels. Falls back to "Personal Quest {cardId}"
 * if the label is missing.
 */
function resolveQuestTitle(cardId: string, labels: LabelData): string {
  const ref = `%data.personalQuest.fh.${cardId}.%`;
  const resolved = resolveLabel(ref, labels);
  if (resolved === ref) {
    return `Personal Quest ${cardId}`;
  }
  return resolved;
}

export function convertPersonalQuest(
  ghs: GhsPersonalQuest,
  labels: LabelData,
): ExtractedPersonalQuest {
  const requirements: ExtractedRequirement[] = ghs.requirements.map((req) => {
    const description = resolveRequirementName(req.name, labels);

    const options = req.checkbox ? req.checkbox.map((opt) => resolveGameTokens(opt)) : null;

    return {
      description,
      target: req.counter,
      options,
      dependsOn: req.requires ?? null,
    };
  });

  return {
    cardId: ghs.cardId,
    name: resolveQuestTitle(ghs.cardId, labels),
    requirements,
    openEnvelope: ghs.openEnvelope,
    _source: `gloomhavensecretariat:personal-quest/${ghs.cardId}`,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

export function importPersonalQuests(): ExtractedPersonalQuest[] {
  const labels = loadLabels();
  const quests: GhsPersonalQuest[] = JSON.parse(readFileSync(GHS_PERSONAL_QUESTS_PATH, 'utf-8'));

  const results: ExtractedPersonalQuest[] = [];

  for (const quest of quests) {
    const converted = convertPersonalQuest(quest, labels);

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
  const results = importPersonalQuests();
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Wrote ${results.length} records to ${OUTPUT_PATH}`);
}
