/**
 * Import character ability cards from Gloomhaven Secretariat (GHS) reference data.
 * GHS deck data has correct class assignment and structured actions — far better
 * than OCR, which fails to extract characterClass on 95% of cards.
 *
 * Run with: npx tsx src/import-character-abilities.ts
 *
 * Requires: data/gloomhavensecretariat/ (clone from https://github.com/Lurkars/gloomhavensecretariat)
 * Output: data/extracted/character-abilities.json
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { kebabToTitle } from './import-monster-stats.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GHS_DECK_DIR = join(
  __dirname,
  '..',
  'data',
  'gloomhavensecretariat',
  'data',
  'fh',
  'character',
  'deck',
);
const GHS_LABEL_PATH = join(
  __dirname,
  '..',
  'data',
  'gloomhavensecretariat',
  'data',
  'fh',
  'label',
  'en.json',
);
const GHS_SPOILER_LABEL_PATH = join(
  __dirname,
  '..',
  'data',
  'gloomhavensecretariat',
  'data',
  'fh',
  'label',
  'spoiler',
  'en.json',
);
const OUTPUT_PATH = join(__dirname, '..', 'data', 'extracted', 'character-abilities.json');

// ─── GHS types ───────────────────────────────────────────────────────────────

interface GhsSubAction {
  type: string;
  value: string | number;
  small?: boolean;
  subActions?: GhsSubAction[];
}

interface GhsAction {
  type: string;
  value: string | number;
  small?: boolean;
  subActions?: GhsSubAction[];
  enhancementTypes?: string[];
  valueObject?: Record<string, unknown>;
}

interface GhsAbility {
  name: string;
  cardId: number;
  level: number;
  initiative: number;
  actions?: GhsAction[];
  bottomActions?: GhsAction[];
  xp?: number;
  bottomXp?: number;
  bottomLost?: boolean;
  topLost?: boolean;
  bottomPersistent?: boolean;
  topPersistent?: boolean;
}

interface GhsDeck {
  name: string;
  edition: string;
  character?: string;
  abilities: GhsAbility[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LabelData = Record<string, any>;

// ─── Our extracted format ────────────────────────────────────────────────────

interface ExtractedCharacterAbility {
  cardName: string;
  characterClass: string;
  level: number;
  initiative: number;
  top: { action: string; effects: string[] };
  bottom: { action: string; effects: string[] };
  lost: boolean;
  _source: string;
}

// ─── Game token resolution ───────────────────────────────────────────────────

/**
 * Replace GHS template tokens like %game.action.attack% or %game.condition.wound%
 * with human-readable text.
 */
export function resolveGameTokens(text: string): string {
  const resolved = text.replace(/%game\.([^%]+)%/g, (_match, path: string) => {
    const parts = path.split(/[.:]/);
    const lastPart = parts[parts.length - 1];
    const isNumeric = /^\d+$/.test(lastPart);

    if (isNumeric) {
      const name = parts[parts.length - 2];
      return ` ${capitalize(name)} ${lastPart}`;
    }

    if (lastPart === 'onehand') return ' One Hand';
    if (lastPart === 'twohand') return ' Two Hands';
    return ` ${capitalize(lastPart)}`;
  });
  // Clean up any double spaces and trim leading space from replacements at string start
  return resolved.replace(/  +/g, ' ').trim();
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Label resolution ────────────────────────────────────────────────────────

/**
 * Resolve a %data.X.Y.Z% reference using the merged label data.
 * Returns the resolved text (with game tokens also resolved), or the
 * original string if the path can't be found.
 */
export function resolveLabel(ref: string, labels: LabelData): string {
  if (!ref.startsWith('%data.')) return ref;

  const path = ref.slice(6, -1); // strip %data. and trailing %
  const parts = path.split('.');

  let current: unknown = labels;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return ref;
    current = (current as Record<string, unknown>)[part];
  }

  if (typeof current !== 'string') return ref;
  return resolveGameTokens(current);
}

/**
 * Deep-merge two label objects. Values from `b` override `a`.
 */
function mergeLabels(a: LabelData, b: LabelData): LabelData {
  const result = { ...a };
  for (const key of Object.keys(b)) {
    if (
      typeof result[key] === 'object' &&
      result[key] !== null &&
      typeof b[key] === 'object' &&
      b[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = mergeLabels(result[key] as LabelData, b[key] as LabelData);
    } else {
      result[key] = b[key];
    }
  }
  return result;
}

// ─── Action formatting ───────────────────────────────────────────────────────

// Action types that we skip — they're layout/rendering-only
const SKIP_TYPES = new Set(['concatenation', 'forceBox', 'concatenationSpacer', 'card', 'area']);

// Sub-action types that produce useful text
const USEFUL_SUBACTION_TYPES = new Set([
  'range',
  'target',
  'condition',
  'push',
  'pull',
  'pierce',
  'specialTarget',
  'shield',
  'retaliate',
  'custom',
]);

/**
 * Convert a GHS action object into a human-readable string.
 * Returns null for layout-only actions that don't produce readable text.
 */
export function formatAction(action: GhsAction, labels: LabelData): string | null {
  if (SKIP_TYPES.has(action.type)) return null;

  let text: string;

  if (action.type === 'custom') {
    const val = String(action.value);
    text = val.startsWith('%data.') ? resolveLabel(val, labels) : resolveGameTokens(val);
  } else if (action.type === 'condition') {
    text = capitalize(String(action.value));
  } else if (action.type === 'summon') {
    const name = action.valueObject?.name;
    text = name ? `Summon ${kebabToTitle(String(name))}` : 'Summon';
  } else {
    text = `${capitalize(action.type)} ${action.value}`;
  }

  // Append useful sub-actions
  const subParts: string[] = [];
  for (const sub of action.subActions ?? []) {
    if (!USEFUL_SUBACTION_TYPES.has(sub.type)) continue;
    if (sub.type === 'condition' || sub.type === 'specialTarget') {
      subParts.push(capitalize(String(sub.value)));
    } else if (sub.type === 'custom') {
      const val = String(sub.value);
      const resolved = val.startsWith('%data.')
        ? resolveLabel(val, labels)
        : resolveGameTokens(val);
      subParts.push(resolved);
    } else {
      subParts.push(`${capitalize(sub.type)} ${sub.value}`);
    }
  }

  if (subParts.length > 0) {
    text = `${text}, ${subParts.join(', ')}`;
  }

  return text;
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
    _source: `gloomhavensecretariat:${characterName}/${ghs.cardId}`,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function importCharacterAbilities(): ExtractedCharacterAbility[] {
  if (!existsSync(GHS_DECK_DIR)) {
    throw new Error(
      `GHS data not found at ${GHS_DECK_DIR}. Clone https://github.com/Lurkars/gloomhavensecretariat into data/gloomhavensecretariat/`,
    );
  }

  // Load and merge label files
  const baseLabels: LabelData = existsSync(GHS_LABEL_PATH)
    ? JSON.parse(readFileSync(GHS_LABEL_PATH, 'utf-8'))
    : {};
  const spoilerLabels: LabelData = existsSync(GHS_SPOILER_LABEL_PATH)
    ? JSON.parse(readFileSync(GHS_SPOILER_LABEL_PATH, 'utf-8'))
    : {};
  const labels = mergeLabels(baseLabels, spoilerLabels);

  const allResults: ExtractedCharacterAbility[] = [];

  for (const file of readdirSync(GHS_DECK_DIR).sort()) {
    if (!file.endsWith('.json')) continue;

    const characterName = basename(file, '.json');
    const deck: GhsDeck = JSON.parse(readFileSync(join(GHS_DECK_DIR, file), 'utf-8'));

    for (const ability of deck.abilities) {
      allResults.push(convertAbility(ability, characterName, labels));
    }
  }

  return allResults;
}

if (process.argv[1]?.endsWith('import-character-abilities.ts')) {
  const results = importCharacterAbilities();
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Wrote ${results.length} records to ${OUTPUT_PATH}`);
}
