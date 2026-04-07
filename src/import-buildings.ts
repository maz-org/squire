/**
 * Import building cards from Gloomhaven Secretariat (GHS) reference data.
 * GHS has structured building data with per-level upgrade/repair/rebuild costs,
 * prosperity rewards, and effect text via label references — replacing OCR
 * extraction which had garbled notes and missing build costs.
 *
 * Run with: GHS_DATA_DIR=~/data/ghs npx tsx src/import-buildings.ts
 *
 * Requires: GHS data (set GHS_DATA_DIR env var, or clone into data/gloomhavensecretariat/)
 * Output: data/extracted/buildings.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GHS_DATA_DIR,
  kebabToTitle,
  resolveLabel,
  loadLabels,
  type LabelData,
} from './ghs-utils.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GHS_BUILDINGS_PATH = join(GHS_DATA_DIR, 'buildings.json');
const OUTPUT_PATH = join(__dirname, '..', 'data', 'extracted', 'buildings.json');

// ─── GHS building type ─────────────────────────────────────────────────────

export interface GhsBuilding {
  // Walls (e.g. wall-j, wall-k) genuinely have no `id` field in GHS — they're
  // identified only by `name`. Optional here so the importer can handle both.
  id?: string;
  name: string;
  costs: {
    prosperity: number;
    lumber: number;
    metal: number;
    hide: number;
    gold: number;
  };
  upgrades: Array<{
    prosperity: number;
    lumber: number;
    metal: number;
    hide: number;
  }>;
  repair: number[];
  rebuild: Array<{ lumber: number; metal: number; hide: number }>;
  effectNormal?: string[];
  effectWrecked?: string[];
  rewards: Array<Record<string, unknown>>;
}

// ─── Our extracted format ──────────────────────────────────────────────────

interface ExtractedBuilding {
  // Nullable: walls have no building number in the GHS domain.
  buildingNumber: string | null;
  name: string;
  level: number;
  buildCost: {
    gold: number | null;
    lumber: number | null;
    metal: number | null;
    hide: number | null;
  };
  effect: string;
  notes: string | null;
  sourceId: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Convert a number to null if it's zero or undefined (zero means "no cost"). */
function zeroToNull(n: number | undefined): number | null {
  return n === 0 || n === undefined ? null : n;
}

/**
 * Resolve `%data.section:X.Y%` tokens to "Section X.Y" text.
 * These appear in a few building effects that reference rulebook sections.
 */
export function resolveSectionRefs(text: string): string {
  return text.replace(/%data\.section:([^%]+)%/g, (_match, ref: string) => `Section ${ref}`);
}

/**
 * Resolve a label reference string like `%data.buildings.mining-camp.1%`
 * into human-readable text with game tokens and section refs resolved.
 */
function resolveEffectText(ref: string, labels: LabelData): string {
  const resolved = resolveLabel(ref, labels);
  return resolveSectionRefs(resolved);
}

// ─── Conversion ────────────────────────────────────────────────────────────

/**
 * Convert a single GHS building into flat per-level records matching
 * the BuildingSchema. Uses effectNormal if present, otherwise effectWrecked
 * (for buildings that start already built, like Craftsman and Alchemist).
 */
export function convertBuilding(ghs: GhsBuilding, labels: LabelData): ExtractedBuilding[] {
  const effectRefs = ghs.effectNormal ?? ghs.effectWrecked ?? [];
  if (effectRefs.length === 0) return [];

  const name = resolveLabel(`%data.buildings.${ghs.name}.%`, labels);
  // Fall back to kebab-to-title if label lookup returned the raw ref
  const displayName = name.startsWith('%data.') ? kebabToTitle(ghs.name) : name;

  const results: ExtractedBuilding[] = [];

  for (let i = 0; i < effectRefs.length; i++) {
    const level = i + 1;
    const ref = effectRefs[i];
    const effect = resolveEffectText(ref, labels);

    // Level 1 uses initial build costs; level 2+ uses upgrades[level-2]
    let buildCost: ExtractedBuilding['buildCost'];
    if (level === 1) {
      buildCost = {
        gold: zeroToNull(ghs.costs.gold),
        lumber: zeroToNull(ghs.costs.lumber),
        metal: zeroToNull(ghs.costs.metal),
        hide: zeroToNull(ghs.costs.hide),
      };
    } else {
      const upgrade = ghs.upgrades[level - 2];
      buildCost = {
        gold: upgrade ? zeroToNull((upgrade as Record<string, number>).gold) : null,
        lumber: upgrade ? zeroToNull(upgrade.lumber) : null,
        metal: upgrade ? zeroToNull(upgrade.metal) : null,
        hide: upgrade ? zeroToNull(upgrade.hide) : null,
      };
    }

    results.push({
      // Walls have no number in GHS — keep null rather than coercing to a string.
      buildingNumber: ghs.id ?? null,
      name: displayName,
      level,
      buildCost,
      effect,
      notes: null,
      // Fall back to `ghs.name` (e.g. "wall-j") so each wall gets a stable,
      // unique identifier even though they share `buildingNumber: null`.
      // Append `/L<level>` because each GHS building expands into one row
      // per level — without the level suffix every level of the same
      // building would collide on sourceId.
      sourceId: `gloomhavensecretariat:building/${ghs.id ?? ghs.name}/L${level}`,
    });
  }

  return results;
}

// ─── Main ──────────────────────────────────────────────────────────────────

export function importBuildings(): ExtractedBuilding[] {
  if (!existsSync(GHS_BUILDINGS_PATH)) {
    throw new Error(
      `GHS buildings data not found at ${GHS_BUILDINGS_PATH}. Set GHS_DATA_DIR or clone GHS into data/gloomhavensecretariat/`,
    );
  }

  const labels = loadLabels();
  const buildings: GhsBuilding[] = JSON.parse(readFileSync(GHS_BUILDINGS_PATH, 'utf-8'));
  const results: ExtractedBuilding[] = [];

  for (const building of buildings) {
    const converted = convertBuilding(building, labels);

    for (const record of converted) {
      // Fail if any data/game tokens survived resolution
      if (/%(?:data|game)\./.test(record.effect)) {
        throw new Error(
          `Unresolved label/token in building ${building.id} (${building.name}) level ${record.level}: ${record.effect}`,
        );
      }
      results.push(record);
    }
  }

  return results;
}

if (process.argv[1]?.endsWith('import-buildings.ts')) {
  const results = importBuildings();
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Wrote ${results.length} records to ${OUTPUT_PATH}`);
}
