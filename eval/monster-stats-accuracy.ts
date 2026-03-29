/**
 * Deterministic eval: compare extracted monster stats against Gloomhaven Secretariat reference data.
 * Reports per-field accuracy (HP, Move, Attack) and overall accuracy.
 *
 * Reference: https://github.com/Lurkars/gloomhavensecretariat/tree/main/data/fh/monster
 *
 * Run with: npx tsx eval/monster-stats-accuracy.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTRACTED_PATH = join(__dirname, '..', 'data', 'extracted', 'monster-stats.json');
const REFERENCE_DIR = join(
  __dirname,
  '..',
  'data',
  'gloomhavensecretariat',
  'data',
  'fh',
  'monster',
);

// ─── Types ───────────────────────────────────────────────────────────────────

interface ExtractedStats {
  hp: number | null;
  move: number | null;
  attack: number | null;
}

interface ExtractedMonster {
  name: string;
  levelRange: string;
  normal: Record<string, ExtractedStats>;
  elite: Record<string, ExtractedStats>;
  _file?: string;
  _source?: string;
  _error?: string;
}

interface GhsStat {
  type?: string;
  level: number;
  health?: number | string;
  movement?: number;
  attack?: number;
}

interface GhsMonster {
  name: string;
  baseStat?: { movement?: number };
  stats: GhsStat[];
}

interface FieldComparison {
  field: string;
  level: number;
  difficulty: string;
  expected: number;
  actual: number | null;
  monster: string;
}

// ─── Load data ───────────────────────────────────────────────────────────────

function loadExtracted(): ExtractedMonster[] {
  return JSON.parse(readFileSync(EXTRACTED_PATH, 'utf-8'));
}

function loadReference(): Map<string, GhsMonster> {
  const map = new Map<string, GhsMonster>();
  for (const file of readdirSync(REFERENCE_DIR)) {
    if (!file.endsWith('.json')) continue;
    // Skip scenario-specific and solo variants
    if (file.includes('scenario') || file.includes('solo')) continue;
    const data: GhsMonster = JSON.parse(readFileSync(join(REFERENCE_DIR, file), 'utf-8'));
    map.set(data.name, data);
  }
  return map;
}

function extractedNameToRefName(filename: string): string {
  return filename.replace(/^fh-/, '').replace(/-\d+\.png$/, '');
}

// ─── Comparison ──────────────────────────────────────────────────────────────

function compareMonster(
  extracted: ExtractedMonster,
  reference: GhsMonster,
): { correct: FieldComparison[]; wrong: FieldComparison[] } {
  const correct: FieldComparison[] = [];
  const wrong: FieldComparison[] = [];

  // Build reference lookup: { "normal-0": { health, movement, attack }, ... }
  const refLookup = new Map<string, { health: number; movement: number; attack: number }>();
  for (const stat of reference.stats) {
    // Skip entries with string health (boss formulas like "Cx20")
    if (typeof stat.health === 'string') continue;

    const diff = stat.type === 'elite' ? 'elite' : 'normal';
    // GHS omits fields when value is 0 — use same ?? 0 convention as the importer
    refLookup.set(`${diff}-${stat.level}`, {
      health: stat.health ?? 0,
      movement: stat.movement ?? reference.baseStat?.movement ?? 0,
      attack: stat.attack ?? 0,
    });
  }

  // Compare each extracted level
  for (const [diff, stats] of [
    ['normal', extracted.normal],
    ['elite', extracted.elite],
  ] as const) {
    if (!stats) continue;
    for (const [levelStr, extractedStats] of Object.entries(stats)) {
      const level = parseInt(levelStr);
      const ref = refLookup.get(`${diff}-${level}`);
      // Only compares levels present in extracted data. Since we import from
      // GHS (always complete), missing levels don't occur in practice.
      if (!ref) continue;

      const comparisons: [string, number | null, number][] = [
        ['hp', extractedStats.hp, ref.health],
        ['move', extractedStats.move, ref.movement],
        ['attack', extractedStats.attack, ref.attack],
      ];

      for (const [field, actual, expected] of comparisons) {
        const entry: FieldComparison = {
          field,
          level,
          difficulty: diff,
          expected,
          actual,
          monster: extracted.name || reference.name,
        };
        if (actual === expected) {
          correct.push(entry);
        } else {
          wrong.push(entry);
        }
      }
    }
  }

  return { correct, wrong };
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function runAccuracyEval(): {
  totalFields: number;
  correctFields: number;
  accuracy: number;
  byField: Record<string, { correct: number; total: number; accuracy: number }>;
  mismatches: FieldComparison[];
  matchedMonsters: number;
} {
  const extracted = loadExtracted();
  const reference = loadReference();

  let allCorrect: FieldComparison[] = [];
  let allWrong: FieldComparison[] = [];
  let matchedMonsters = 0;

  for (const monster of extracted) {
    if (monster._error) continue;

    // Match by _source (GHS import) or _file (OCR extraction)
    let refName: string | null = null;
    if (monster._source) {
      refName = monster._source.replace('gloomhavensecretariat:', '');
    } else if (monster._file) {
      refName = extractedNameToRefName(monster._file);
    }
    if (!refName) continue;

    const ref = reference.get(refName);
    if (!ref) continue;

    matchedMonsters++;
    const { correct, wrong } = compareMonster(monster, ref);
    allCorrect = allCorrect.concat(correct);
    allWrong = allWrong.concat(wrong);
  }

  const totalFields = allCorrect.length + allWrong.length;
  const accuracy = totalFields > 0 ? allCorrect.length / totalFields : 0;

  // Per-field breakdown
  const byField: Record<string, { correct: number; total: number; accuracy: number }> = {};
  for (const field of ['hp', 'move', 'attack']) {
    const fieldCorrect = allCorrect.filter((c) => c.field === field).length;
    const fieldWrong = allWrong.filter((c) => c.field === field).length;
    const fieldTotal = fieldCorrect + fieldWrong;
    byField[field] = {
      correct: fieldCorrect,
      total: fieldTotal,
      accuracy: fieldTotal > 0 ? fieldCorrect / fieldTotal : 0,
    };
  }

  return {
    totalFields,
    correctFields: allCorrect.length,
    accuracy,
    byField,
    mismatches: allWrong,
    matchedMonsters,
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('monster-stats-accuracy.ts')) {
  const result = runAccuracyEval();

  console.log(`\n=== Monster Stats Accuracy Eval ===\n`);
  console.log(`Matched monsters: ${result.matchedMonsters}`);
  console.log(
    `Overall: ${result.correctFields}/${result.totalFields} fields correct (${(result.accuracy * 100).toFixed(1)}%)\n`,
  );

  console.log('Per-field accuracy:');
  for (const [field, stats] of Object.entries(result.byField)) {
    console.log(
      `  ${field.padEnd(8)} ${stats.correct}/${stats.total} (${(stats.accuracy * 100).toFixed(1)}%)`,
    );
  }

  if (result.mismatches.length > 0) {
    console.log(`\nMismatches (${result.mismatches.length}):`);
    for (const m of result.mismatches.slice(0, 50)) {
      console.log(
        `  ${m.monster} ${m.difficulty} L${m.level} ${m.field}: got ${m.actual}, expected ${m.expected}`,
      );
    }
    if (result.mismatches.length > 50) {
      console.log(`  ... and ${result.mismatches.length - 50} more`);
    }
  }
}
