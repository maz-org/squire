/**
 * Import battle goal cards from Gloomhaven Secretariat (GHS) reference data.
 * GHS has structured cardId/name/checks data, with condition text in label files.
 *
 * Run with: npx tsx src/import-battle-goals.ts
 *
 * Requires: GHS data (set GHS_DATA_DIR env var, or clone into data/gloomhavensecretariat/)
 * Output: data/extracted/battle-goals.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GHS_DATA_DIR, loadLabels, resolveGameTokens, type LabelData } from './ghs-utils.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GHS_BATTLE_GOALS_PATH = join(GHS_DATA_DIR, 'battle-goals.json');
const OUTPUT_PATH = join(__dirname, '..', 'data', 'extracted', 'battle-goals.json');

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
  _source: string;
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
    _source: `gloomhavensecretariat:battle-goal/${ghs.cardId}`,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

export function importBattleGoals(): ExtractedBattleGoal[] {
  if (!existsSync(GHS_BATTLE_GOALS_PATH)) {
    throw new Error(
      `GHS data not found at ${GHS_BATTLE_GOALS_PATH}. Set GHS_DATA_DIR or clone GHS into data/gloomhavensecretariat/`,
    );
  }

  const labels = loadLabels();
  const ghsData: GhsBattleGoal[] = JSON.parse(readFileSync(GHS_BATTLE_GOALS_PATH, 'utf-8'));

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
  const results = importBattleGoals();
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Wrote ${results.length} records to ${OUTPUT_PATH}`);
}
