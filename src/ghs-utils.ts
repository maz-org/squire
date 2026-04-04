/**
 * Shared utilities for importing Gloomhaven Secretariat (GHS) reference data.
 *
 * Provides label resolution, game token resolution, action formatting, and
 * common path constants used by all GHS import scripts.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── GHS data paths ─────────────────────────────────────────────────────────

export const GHS_DATA_DIR = join(__dirname, '..', 'data', 'gloomhavensecretariat', 'data', 'fh');

export const GHS_LABEL_PATH = join(GHS_DATA_DIR, 'label', 'en.json');

export const GHS_SPOILER_LABEL_PATH = join(GHS_DATA_DIR, 'label', 'spoiler', 'en.json');

// ─── GHS types ───────────────────────────────────────────────────────────────

export interface GhsSubAction {
  type: string;
  value: string | number;
  small?: boolean;
  subActions?: GhsSubAction[];
}

export interface GhsAction {
  type: string;
  value: string | number;
  small?: boolean;
  subActions?: GhsSubAction[];
  enhancementTypes?: string[];
  valueObject?: Record<string, unknown>;
}

export interface GhsAbility {
  name: string;
  cardId: number;
  level: number | 'X';
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

export interface GhsDeck {
  name: string;
  edition: string;
  character?: string;
  abilities: GhsAbility[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LabelData = Record<string, any>;

// ─── String utilities ────────────────────────────────────────────────────────

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function kebabToTitle(name: string): string {
  return name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
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

/**
 * Load and merge the base and spoiler English label files from GHS data.
 * Throws if label files are missing.
 */
export function loadLabels(): LabelData {
  if (!existsSync(GHS_LABEL_PATH) || !existsSync(GHS_SPOILER_LABEL_PATH)) {
    throw new Error('Missing GHS label data. Expected both base and spoiler English label files.');
  }
  const baseLabels: LabelData = JSON.parse(readFileSync(GHS_LABEL_PATH, 'utf-8'));
  const spoilerLabels: LabelData = JSON.parse(readFileSync(GHS_SPOILER_LABEL_PATH, 'utf-8'));
  return mergeLabels(baseLabels, spoilerLabels);
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
    if (val === '%character.abilities.wip%') {
      text = '(ability text not yet available)';
    } else if (val.startsWith('%data.')) {
      text = resolveLabel(val, labels);
    } else {
      text = resolveGameTokens(val);
    }
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
