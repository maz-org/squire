/**
 * Import monster stats from Gloomhaven Secretariat (GHS) reference data
 * instead of OCR extraction. GHS data is community-maintained and accurate.
 *
 * Run with: npx tsx src/import-monster-stats.ts
 *
 * Requires: GHS data (set GHS_DATA_DIR env var, or clone into data/gloomhavensecretariat/)
 * Output: data/extracted/monster-stats.json
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const GHS_MONSTER_DIR = join(GHS_DATA_DIR, 'monster');
const OUTPUT_PATH = join(__dirname, '..', 'data', 'extracted', 'monster-stats.json');

// ─── GHS types ───────────────────────────────────────────────────────────────

interface GhsStat {
  type?: string;
  level: number;
  health?: number | string;
  movement?: number;
  attack?: number;
  actions?: Array<{ type: string; value: string | number }>;
  immunities?: string[];
}

interface GhsMonster {
  name: string;
  edition: string;
  baseStat?: { type?: string; movement?: number; immunities?: string[] };
  stats: GhsStat[];
}

// ─── Our extracted format ────────────────────────────────────────────────────

interface LevelStats {
  hp: number | null;
  move: number | null;
  attack: number | null;
}

interface ExtractedMonster {
  name: string;
  levelRange: '0-3' | '4-7';
  normal: Record<string, LevelStats>;
  elite: Record<string, LevelStats>;
  immunities: string[];
  notes: string | null;
  sourceId: string;
}

// ─── Conversion ──────────────────────────────────────────────────────────────

export function formatActions(
  actions: Array<{ type: string; value: string | number }> | undefined,
  labels: LabelData,
): string | null {
  if (!actions?.length) return null;
  return actions
    .map((a) => {
      if (a.type === 'shield') return `Shield ${a.value}`;
      if (a.type === 'retaliate') return `Retaliate ${a.value}`;
      if (a.type === 'condition') return String(a.value);
      if (a.type === 'target') return `Target ${a.value}`;
      if (a.type === 'custom') {
        const val = String(a.value);
        if (val.startsWith('%data.')) return resolveLabel(val, labels);
        return resolveGameTokens(val);
      }
      return `${a.type} ${a.value}`;
    })
    .join(', ');
}

export function convertMonster(ghs: GhsMonster, labels: LabelData): ExtractedMonster[] {
  const baseMove = ghs.baseStat?.movement ?? 0;
  const baseImmunities = ghs.baseStat?.immunities ?? [];
  const results: ExtractedMonster[] = [];

  // Group stats by level range (0-3 and 4-7)
  for (const [rangeLabel, levels] of [
    ['0-3', [0, 1, 2, 3]],
    ['4-7', [4, 5, 6, 7]],
  ] as const) {
    const normal: Record<string, LevelStats> = {};
    const elite: Record<string, LevelStats> = {};
    const noteParts: string[] = [];

    for (const level of levels) {
      for (const difficulty of ['normal', 'elite'] as const) {
        const stat = ghs.stats.find(
          (s) =>
            s.level === level && (difficulty === 'elite' ? s.type === 'elite' : s.type !== 'elite'),
        );
        if (!stat) continue;

        // Skip boss formula health (e.g., "Cx20")
        if (typeof stat.health === 'string') continue;

        // Skip placeholder entries (e.g., boss-type monsters with custom logic)
        if (stat.health === undefined && stat.movement === undefined && stat.attack === undefined)
          continue;

        // GHS omits fields when the value is 0 (e.g., immobile monsters omit
        // movement, Chaos Spark omits attack). These are real game values — a
        // monster with attack 0 still draws from the attack modifier deck.
        const levelStats: LevelStats = {
          hp: stat.health ?? 0,
          move: stat.movement ?? baseMove,
          attack: stat.attack ?? 0,
        };

        if (difficulty === 'normal') {
          normal[String(level)] = levelStats;
        } else {
          elite[String(level)] = levelStats;
        }

        // Collect action notes
        const actions = formatActions(stat.actions, labels);
        if (actions) {
          const key = `${difficulty} L${level}`;
          noteParts.push(`${key}: ${actions}`);
        }

        // Collect per-stat immunities
        if (stat.immunities?.length) {
          const key = `${difficulty} L${level}`;
          noteParts.push(`${key} immunities: ${stat.immunities.join(', ')}`);
        }
      }
    }

    // Only emit a record if we have stats for this level range
    if (Object.keys(normal).length === 0 && Object.keys(elite).length === 0) continue;

    results.push({
      name: kebabToTitle(ghs.name),
      levelRange: rangeLabel,
      normal,
      elite,
      immunities: baseImmunities,
      notes: noteParts.length > 0 ? noteParts.join('; ') : null,
      // Each GHS monster expands into one row per level range (0-3 and 4-7)
      // — append the range so the two rows have distinct sourceIds.
      sourceId: `gloomhavensecretariat:monster-stat/${ghs.name}/${rangeLabel}`,
    });
  }

  return results;
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function importMonsterStats(): ExtractedMonster[] {
  if (!existsSync(GHS_MONSTER_DIR)) {
    throw new Error(
      `GHS data not found at ${GHS_MONSTER_DIR}. Set GHS_DATA_DIR or clone GHS into data/gloomhavensecretariat/`,
    );
  }

  const labels = loadLabels();
  const allResults: ExtractedMonster[] = [];

  for (const file of readdirSync(GHS_MONSTER_DIR).sort()) {
    if (!file.endsWith('.json')) continue;
    // Skip scenario-specific and solo variants
    if (file.includes('scenario') || file.includes('solo')) continue;

    const ghs: GhsMonster = JSON.parse(readFileSync(join(GHS_MONSTER_DIR, file), 'utf-8'));
    const records = convertMonster(ghs, labels);

    for (const record of records) {
      if (record.notes && /%(?:data|game)\./.test(record.notes)) {
        throw new Error(
          `Unresolved label/token in monster ${ghs.name} ${record.levelRange}: ${record.notes}`,
        );
      }
    }

    allResults.push(...records);
  }

  return allResults;
}

if (process.argv[1]?.endsWith('import-monster-stats.ts')) {
  const results = importMonsterStats();
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Wrote ${results.length} records to ${OUTPUT_PATH}`);
}
