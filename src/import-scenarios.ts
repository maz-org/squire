/**
 * Import scenario metadata from Gloomhaven Secretariat (GHS) reference data.
 * Extracts rules-relevant fields: monsters, unlocks, rewards, loot, etc.
 * Skips room layout, map coordinates, and round-by-round spawn rules.
 *
 * Run with: npx tsx src/import-scenarios.ts
 *
 * Requires: GHS data (set GHS_DATA_DIR env var, or clone into data/gloomhavensecretariat/)
 * Output: data/extracted/scenarios.json
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GHS_DATA_DIR,
  kebabToTitle,
  loadLabels,
  resolveLabel,
  resolveGameTokens,
  type LabelData,
} from './ghs-utils.ts';

import { resolveSectionRefs } from './import-buildings.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GHS_SCENARIO_DIR = join(GHS_DATA_DIR, 'scenarios');
const OUTPUT_PATH = join(__dirname, '..', 'data', 'extracted', 'scenarios.json');

// ─── GHS types (scenario-relevant subset) ───────────────────────────────────

interface GhsCollectiveResource {
  type: string;
  value: number;
}

interface GhsRewards {
  custom?: string;
  morale?: string | number;
  prosperity?: number;
  inspiration?: number;
  experience?: number;
  gold?: number;
  collectiveResources?: GhsCollectiveResource[];
  campaignSticker?: string[];
  // Other fields exist but are not rules-relevant
  [key: string]: unknown;
}

interface GhsObjective {
  name: string;
  escort?: boolean;
  health?: string;
}

interface GhsRequirement {
  buildings?: string[];
  campaignSticker?: string[];
  scenarios?: string[];
}

interface GhsScenario {
  index: string;
  name: string;
  flowChartGroup?: string;
  edition: string;
  // Solo class scenarios and the random dungeon ship without a printed
  // complexity value.
  complexity?: number;
  initial?: boolean;
  unlocks?: string[];
  rewards?: GhsRewards;
  monsters?: string[];
  allies?: string[];
  objectives?: GhsObjective[];
  requirements?: GhsRequirement[];
  lootDeckConfig?: Record<string, number>;
  // Skipped fields: coordinates, rooms, rules, recaps, eventType, forcedLinks
  [key: string]: unknown;
}

// ─── Our extracted format ───────────────────────────────────────────────────

interface ExtractedScenario {
  // 'main' | 'solo' | 'random' — required to disambiguate `index`, which is
  // reused across namespaces (e.g. main 20 "Temple of Liberation" and solo
  // 20 "Wonder of Nature" both exist).
  scenarioGroup: 'main' | 'solo' | 'random';
  index: string;
  name: string;
  complexity: number | null;
  monsters: string[];
  allies: string[];
  unlocks: string[];
  requirements: GhsRequirement[];
  objectives: { name: string; escort?: boolean }[];
  rewards: string | null;
  lootDeckConfig: Record<string, number>;
  flowChartGroup: string | null;
  initial: boolean;
  sourceId: string;
}

/**
 * Derive the scenario namespace from the GHS filename basename. GHS uses
 * filename patterns to distinguish solos and the random scenario from the
 * main campaign — there's no in-file marker.
 */
function deriveScenarioGroup(filenameBasename: string): 'main' | 'solo' | 'random' {
  if (/^solo/i.test(filenameBasename)) return 'solo';
  if (filenameBasename === 'random') return 'random';
  return 'main';
}

// ─── Reward formatting ──────────────────────────────────────────────────────

/**
 * Build a human-readable reward string from structured GHS reward data.
 * Returns null if no meaningful reward data exists.
 */
function formatRewards(rewards: GhsRewards | undefined, labels: LabelData): string | null {
  if (!rewards) return null;

  // If a custom label reference exists, resolve it — it's the authoritative text.
  // Return even if unresolved so the validator catches missing labels instead of
  // silently falling through to the structured builder.
  if (rewards.custom && typeof rewards.custom === 'string' && rewards.custom.startsWith('%data.')) {
    const resolved = resolveLabel(rewards.custom, labels);
    if (resolved !== rewards.custom) return resolveGameTokens(resolveSectionRefs(resolved));
    return rewards.custom;
  }

  // Otherwise build from structured fields
  const parts: string[] = [];

  if (rewards.experience != null) parts.push(`${rewards.experience} XP`);
  if (rewards.gold != null) parts.push(`${rewards.gold} gold`);
  if (rewards.prosperity != null) parts.push(`Prosperity ${rewards.prosperity}`);
  if (rewards.morale != null) parts.push(`Morale ${rewards.morale}`);
  if (rewards.inspiration != null) parts.push(`Inspiration ${rewards.inspiration}`);

  if (rewards.collectiveResources) {
    for (const r of rewards.collectiveResources) {
      parts.push(`${r.value} ${r.type}`);
    }
  }

  if (rewards.campaignSticker?.length) {
    parts.push(`Campaign sticker: ${rewards.campaignSticker.join(', ')}`);
  }

  return parts.length > 0 ? parts.join(', ') : null;
}

// ─── Conversion ─────────────────────────────────────────────────────────────

/**
 * Convert a single GHS scenario object into our extracted format.
 *
 * `filenameBasename` is the GHS source filename without the `.json` extension
 * (e.g. `020`, `solo20_drifter`, `random`). It drives both `scenarioGroup`
 * and `sourceId`, since the in-file `index` field collides across namespaces.
 */
export function convertScenario(
  ghs: GhsScenario,
  filenameBasename: string,
  labels: LabelData,
): ExtractedScenario {
  return {
    scenarioGroup: deriveScenarioGroup(filenameBasename),
    index: ghs.index,
    name: ghs.name,
    complexity: ghs.complexity ?? null,
    monsters: (ghs.monsters ?? []).map(kebabToTitle),
    allies: (ghs.allies ?? []).map(kebabToTitle),
    unlocks: ghs.unlocks ?? [],
    requirements: ghs.requirements ?? [],
    objectives: (ghs.objectives ?? []).map((o) => {
      const obj: { name: string; escort?: boolean } = { name: o.name };
      if (o.escort) obj.escort = true;
      return obj;
    }),
    rewards: formatRewards(ghs.rewards, labels),
    lootDeckConfig: ghs.lootDeckConfig ?? {},
    flowChartGroup: ghs.flowChartGroup ?? null,
    initial: ghs.initial ?? false,
    // Use the filename basename instead of `ghs.index` so cross-namespace
    // collisions (main 20 vs solo20_drifter) yield distinct sourceIds.
    sourceId: `gloomhavensecretariat:scenario/${filenameBasename}`,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

export function importScenarios(): ExtractedScenario[] {
  if (!existsSync(GHS_SCENARIO_DIR)) {
    throw new Error(
      `GHS scenario data not found at ${GHS_SCENARIO_DIR}. Set GHS_DATA_DIR or clone GHS into data/gloomhavensecretariat/`,
    );
  }

  const labels = loadLabels();
  const allResults: ExtractedScenario[] = [];

  for (const file of readdirSync(GHS_SCENARIO_DIR).sort()) {
    if (!file.endsWith('.json')) continue;

    const filenameBasename = file.slice(0, -'.json'.length);
    const scenario: GhsScenario = JSON.parse(readFileSync(join(GHS_SCENARIO_DIR, file), 'utf-8'));

    const converted = convertScenario(scenario, filenameBasename, labels);

    if (converted.rewards && /%(?:data|game)\./.test(converted.rewards)) {
      throw new Error(`Unresolved label/token in scenario ${scenario.index}: ${converted.rewards}`);
    }

    allResults.push(converted);
  }

  return allResults;
}

if (process.argv[1]?.endsWith('import-scenarios.ts')) {
  const results = importScenarios();
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Wrote ${results.length} records to ${OUTPUT_PATH}`);
}
