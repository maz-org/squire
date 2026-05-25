/**
 * Import battle goal cards from Gloomhaven Secretariat (GHS) reference data.
 * GHS has structured cardId/name/checks data, with condition text in label files.
 *
 * Run with: npx tsx src/import-battle-goals.ts
 *
 * Requires: GHS data (set GHS_DATA_DIR env var, or clone into data/gloomhavensecretariat/)
 * Output: data/extracted/battle-goals.json
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  loadLabels,
  resolveGameTokens,
  resolveGhsImporterConfig,
  type GhsImporterConfigInput,
  type LabelData,
} from './ghs-utils.ts';
import { writeExtractedRecords } from './extracted-paths.ts';

// ─── GHS source type ────────────────────────────────────────────────────────

interface GhsBattleGoal {
  cardId: string;
  name: string;
  checks: number;
}

// ─── Our extracted format ───────────────────────────────────────────────────

interface ExtractedBattleGoal {
  name: string;
  condition: string;
  checkmarks: number;
  sourceId: string;
}

// ─── Conversion ─────────────────────────────────────────────────────────────

/**
 * Convert a single GHS battle goal into our extracted format.
 * Condition text comes from the label data under battleGoals[cardId].text.
 */
export function convertBattleGoal(ghs: GhsBattleGoal, labels: LabelData): ExtractedBattleGoal {
  const labelEntry = labels.battleGoals?.[ghs.cardId];
  const rawCondition: string = labelEntry?.text ?? '';
  const condition = rawCondition ? resolveGameTokens(rawCondition) : '';

  return {
    name: ghs.name,
    condition,
    checkmarks: ghs.checks,
    sourceId: `gloomhavensecretariat:battle-goal/${ghs.cardId}`,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

export function importBattleGoals(configInput: GhsImporterConfigInput = {}): ExtractedBattleGoal[] {
  const config = resolveGhsImporterConfig(configInput);
  const ghsBattleGoalsPath = join(config.dataDir, 'battle-goals.json');

  if (!existsSync(ghsBattleGoalsPath)) {
    throw new Error(
      `GHS data not found at ${ghsBattleGoalsPath}. Set GHS_DATA_DIR or clone GHS into data/gloomhavensecretariat/`,
    );
  }

  const labels = loadLabels(config);
  const ghsData: GhsBattleGoal[] = JSON.parse(readFileSync(ghsBattleGoalsPath, 'utf-8'));

  const results: ExtractedBattleGoal[] = [];

  for (const goal of ghsData) {
    const converted = convertBattleGoal(goal, labels);

    if (!converted.condition) {
      throw new Error(`Missing condition text for battle goal ${goal.cardId} (${goal.name})`);
    }

    results.push(converted);
  }

  return results;
}

if (process.argv[1]?.endsWith('import-battle-goals.ts')) {
  const config = resolveGhsImporterConfig();
  const results = importBattleGoals(config);
  const outputPath = writeExtractedRecords('battle-goals', config.game, results);
  console.log(`Wrote ${results.length} records to ${outputPath}`);
}
