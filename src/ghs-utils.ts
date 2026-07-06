/**
 * Shared utilities for importing Gloomhaven Secretariat (GHS) reference data.
 *
 * Provides label resolution, game token resolution, action formatting, and
 * common path constants used by all GHS import scripts.
 *
 * ## `sourceId` convention
 *
 * Every extracted record includes a `sourceId` field for provenance tracking
 * and as the canonical natural key for the Postgres `card_*` tables (unique
 * on `(game, source_id)`). Format: `gloomhavensecretariat:<entity-type>/<entity-id>`.
 *
 * Examples:
 *   - `gloomhavensecretariat:battle-goal/1301`
 *   - `gloomhavensecretariat:monster-stat/bandit-guard`
 *   - `gloomhavensecretariat:character-mat/blinkblade`
 *   - `gloomhavensecretariat:item/001`
 *
 * `sourceId` is a real Zod schema field on every card type (see `src/schemas.ts`).
 * It was promoted from import-only `_source` metadata to a first-class field
 * during SQR-31 — see `docs/plans/storage-migration-tech-spec.md`
 * §"Natural key verification".
 */

import { readFileSync, existsSync } from 'node:fs';
import { basename, join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import {
  DEFAULT_GAME_ID,
  FROSTHAVEN_GAME_ID,
  GLOOMHAVEN_2E_GAME_ID,
  requireGameId,
  type GameId,
} from './game.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── GHS data paths ─────────────────────────────────────────────────────────

const DEFAULT_GHS_GAME_DATA_SUBDIR = 'fh';
const DEFAULT_GHS_SOURCE_DIR = join(__dirname, '..', 'data', 'gloomhavensecretariat');
const GHS_GAME_DATA_SUBDIR_BY_GAME: Record<GameId, string> = {
  [FROSTHAVEN_GAME_ID]: 'fh',
  [GLOOMHAVEN_2E_GAME_ID]: 'gh2e',
};
const GHS_GAME_DATA_SUBDIRS = new Set(Object.values(GHS_GAME_DATA_SUBDIR_BY_GAME));

interface ResolveGhsDataDirOptions {
  gameDataSubdir?: string;
  exists?: (path: string) => boolean;
}

export interface GhsImporterConfigInput {
  game?: string;
  sourceDir?: string;
  exists?: (path: string) => boolean;
}

export interface GhsImporterConfig {
  game: GameId;
  sourceDir: string;
  dataDir: string;
  labelPath: string;
  spoilerLabelPath: string;
}

function normalizeGhsGameDataSubdir(subdir: string): string {
  return subdir.replace(/^data[\\/]/, '');
}

function ghsGameDataSubdirFor(game: GameId): string {
  return GHS_GAME_DATA_SUBDIR_BY_GAME[game];
}

function resolveGhsGame(value: string | undefined): GameId {
  if (value === undefined) return DEFAULT_GAME_ID;
  return requireGameId(normalizeGhsGameDataSubdir(value));
}

function directGhsGameDataSubdir(baseDir: string): string | null {
  const normalizedBaseDir = normalize(baseDir);
  const subdir = basename(normalizedBaseDir);
  if (!GHS_GAME_DATA_SUBDIRS.has(subdir)) return null;
  return basename(dirname(normalizedBaseDir)) === 'data' ? subdir : null;
}

function isDirectGhsGameDataDir(baseDir: string, gameDataSubdir: string): boolean {
  return directGhsGameDataSubdir(baseDir) === gameDataSubdir;
}

/**
 * Resolve either a GHS checkout root (`.../gloomhavensecretariat`) or a direct
 * game data directory (`.../data/fh`, `.../data/gh2e`) to the importable folder.
 */
export function resolveGhsDataDir(baseDir: string, options: ResolveGhsDataDirOptions = {}): string {
  const gameDataSubdir = normalizeGhsGameDataSubdir(
    options.gameDataSubdir ?? DEFAULT_GHS_GAME_DATA_SUBDIR,
  );

  if (isDirectGhsGameDataDir(baseDir, gameDataSubdir)) return baseDir;

  const candidate = join(baseDir, 'data', gameDataSubdir);
  const exists = options.exists ?? existsSync;
  if (exists(candidate)) return candidate;
  if (exists(join(baseDir, 'label', 'en.json')) || exists(join(baseDir, 'items.json'))) {
    return baseDir;
  }
  return candidate;
}

export function resolveGhsImporterConfig(input: GhsImporterConfigInput = {}): GhsImporterConfig {
  const game = resolveGhsGame(input.game ?? process.env.GHS_DATA_GAME);
  const gameDataSubdir = ghsGameDataSubdirFor(game);
  const sourceDir = input.sourceDir ?? process.env.GHS_DATA_DIR ?? DEFAULT_GHS_SOURCE_DIR;
  const directSubdir = directGhsGameDataSubdir(sourceDir);

  if (directSubdir && directSubdir !== gameDataSubdir) {
    throw new Error(
      `GHS source directory ${sourceDir} uses data/${directSubdir}, which does not match requested game ${game} (expected data/${gameDataSubdir}).`,
    );
  }

  const dataDir = resolveGhsDataDir(sourceDir, {
    gameDataSubdir,
    exists: input.exists,
  });

  return {
    game,
    sourceDir,
    dataDir,
    labelPath: join(dataDir, 'label', 'en.json'),
    spoilerLabelPath: join(dataDir, 'label', 'spoiler', 'en.json'),
  };
}

const DEFAULT_GHS_IMPORTER_CONFIG = resolveGhsImporterConfig();

export const GHS_DATA_GAME = ghsGameDataSubdirFor(DEFAULT_GHS_IMPORTER_CONFIG.game);

export const GHS_DATA_DIR = DEFAULT_GHS_IMPORTER_CONFIG.dataDir;

export const GHS_LABEL_PATH = DEFAULT_GHS_IMPORTER_CONFIG.labelPath;

export const GHS_SPOILER_LABEL_PATH = DEFAULT_GHS_IMPORTER_CONFIG.spoilerLabelPath;

// ─── GHS types ───────────────────────────────────────────────────────────────

export interface GhsSubAction {
  type: string;
  value: string | number;
  valueType?: string;
  small?: boolean;
  subActions?: GhsSubAction[];
}

export interface GhsAction {
  type: string;
  value: string | number;
  valueType?: string;
  small?: boolean;
  subActions?: GhsSubAction[];
  enhancementTypes?: string[];
  valueObject?: Record<string, unknown>;
}

export interface GhsAbility {
  name: string;
  cardId: number;
  level: number | 'X' | 'M';
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

export function resolveCharacterDisplayName(
  name: string,
  labels: LabelData,
  game: GameId = DEFAULT_GAME_ID,
): string {
  const ref = `%data.character.${ghsGameDataSubdirFor(game)}.${name}%`;
  const resolved = resolveLabel(ref, labels);
  return resolved === ref ? kebabToTitle(name) : resolved;
}

function titleToken(name: string): string {
  const cleaned = name.replace(/^(?:fh|gh2e)-/, '');
  if (cleaned === 'onehand') return 'One Hand';
  if (cleaned === 'twohand') return 'Two Hands';
  return kebabToTitle(cleaned);
}

// ─── HTML stripping ─────────────────────────────────────────────────────────

/**
 * Extract plain text from GHS label HTML fragments. GHS uses simple markup as
 * data, so parse the fragment instead of trying to maintain tag-scanner rules.
 */
export function stripHtml(text: string): string {
  const fragment = parseFragment(text);
  const parts: string[] = [];

  function appendText(node: DefaultTreeAdapterMap['node']): void {
    if (node.nodeName === '#text' && 'value' in node) {
      parts.push(node.value);
      return;
    }

    if (node.nodeName === 'br') {
      parts.push(' ');
      return;
    }

    if (node.nodeName === 'script' || node.nodeName === 'style') return;

    if ('content' in node) appendChildren(node.content.childNodes);
    if ('childNodes' in node) appendChildren(node.childNodes);
  }

  function appendChildren(nodes: DefaultTreeAdapterMap['childNode'][]): void {
    for (const node of nodes) appendText(node);
  }

  appendChildren(fragment.childNodes);

  return parts.join('').replace(/\s+/g, ' ').trim();
}

// ─── Game token resolution ───────────────────────────────────────────────────

/**
 * Replace GHS template tokens like %game.action.attack% or %game.condition.wound%
 * with human-readable text.
 */
export function resolveGameTokens(text: string): string {
  const resolved = text.replace(/%game\.([^%]+)%/g, (_match, path: string) => {
    const [family, rawValue] = path.split(':');
    if (family === 'section' && rawValue) return ` Section ${rawValue}`;
    if (family === 'itemFh' && rawValue) return ` Item ${rawValue}`;
    if (family === 'customAction' && rawValue) return ` ${titleToken(rawValue)}`;
    if (family === 'custom' && rawValue) return ` ${titleToken(rawValue)}`;

    const parts = path.split(/[.:]/);
    if (parts[0] === 'action' && parts[2] === 'valueSign') {
      const sign = Number(parts[3]) >= 0 && !String(parts[3]).startsWith('+') ? '+' : '';
      return ` ${capitalize(parts[1])} ${sign}${parts[3]}`;
    }
    if (parts[0] === 'action' && parts.length >= 3 && /^-?\d+$/.test(parts.at(-1) ?? '')) {
      return ` ${capitalize(parts[1])} ${parts.at(-1)}`;
    }
    if (parts[0] === 'itemFh' && parts[1]) return ` Item ${parts[1]}`;
    if (parts[0] === 'action' && parts[1]) return ` ${capitalize(parts[1])}`;
    if (parts[0] === 'card' && parts[1]) {
      if (/^-?\d+$/.test(parts[2] ?? '')) return ` ${capitalize(parts[1])} ${parts[2]}`;
      return ` ${capitalize(parts[1])}`;
    }
    if (parts[0] === 'condition' && parts[1]) return ` ${capitalize(parts[1])}`;
    if (parts[0] === 'element' && parts[1]) return ` ${capitalize(parts[1])}`;
    if (parts[0] === 'itemSlot' && parts[1]) return ` ${titleToken(parts[1])}`;
    if (parts[0] === 'items' && parts[1] === 'slots' && parts[2]) return ` ${titleToken(parts[2])}`;
    if (parts[0] === 'attackmodifier' && parts[1]) return ` ${titleToken(parts[1])}`;
    if (parts[0] === 'enhancement' && parts[1]) return ` ${titleToken(parts[1])}`;
    if (parts[0] === 'characterIcon' && parts[1]) return ` ${titleToken(parts[1])}`;

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
  if (path.startsWith('customAction:')) {
    return titleToken(path.slice('customAction:'.length));
  }
  if (path.startsWith('characterColored.')) {
    const coloredName = path.split(':').at(-1);
    if (coloredName) return titleToken(coloredName);
  }
  if (path.startsWith('action.custom.')) {
    return titleToken(path.slice('action.custom.'.length));
  }

  const parts = path.split('.');

  function lookup(pathParts: string[]): unknown {
    let current: unknown = labels;
    for (const part of pathParts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  let current = lookup(parts);
  if (current == null && parts[0] === 'custom' && parts[1]?.startsWith('gh')) {
    current = lookup(['custom', ...parts.slice(2)]);
  }
  if (current != null && typeof current === 'object') {
    current = (current as Record<string, unknown>)[''];
  }
  if (typeof current !== 'string') return ref;
  let resolved = resolveGameTokens(stripHtml(current));
  for (let i = 0; i < 6; i++) {
    const next = resolved.replace(/%data\.[^%]+%/g, (match) => {
      const nested = resolveLabel(match, labels);
      return nested === match ? match : nested;
    });
    if (next === resolved) break;
    resolved = resolveGameTokens(next);
  }
  return resolved;
}

export function resolveTemplateText(text: string, labels: LabelData): string {
  let resolved = text.replace(/%data\.[^%]+%/g, (match) => {
    const label = resolveLabel(match, labels);
    return label === match ? match : label;
  });
  resolved = resolveGameTokens(resolved);
  return resolved;
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
export function loadLabels(config: GhsImporterConfig = DEFAULT_GHS_IMPORTER_CONFIG): LabelData {
  if (!existsSync(config.labelPath) || !existsSync(config.spoilerLabelPath)) {
    throw new Error('Missing GHS label data. Expected both base and spoiler English label files.');
  }
  const baseLabels: LabelData = JSON.parse(readFileSync(config.labelPath, 'utf-8'));
  const spoilerLabels: LabelData = JSON.parse(readFileSync(config.spoilerLabelPath, 'utf-8'));
  return mergeLabels(baseLabels, spoilerLabels);
}

// ─── Action formatting ───────────────────────────────────────────────────────

// Action types that we skip — they're layout/rendering-only
const SKIP_TYPES = new Set([
  'concatenation',
  'forceBox',
  'concatenationSpacer',
  'card',
  'area',
  'boxFhSubActions',
  'grid',
]);

// Sub-action types that are pure layout and never produce text. concatenation
// is transparent instead: its children are visited so enhancement-slot rows
// can't hide real effects (SQR-396).
const LAYOUT_SUBACTION_TYPES = new Set([
  'area',
  'grid',
  'forceBox',
  'boxFhSubActions',
  'concatenationSpacer',
]);

// Recursion guard for pathological nesting; real GHS cards nest 2-3 levels.
const MAX_SUBACTION_DEPTH = 4;

function formatValueWithSign(
  type: string,
  value: string | number | undefined,
  valueType?: string,
): string {
  // Valueless markers like { type: 'jump' } render as the bare keyword.
  if (value === undefined || value === null || value === '') return capitalize(type);
  const rendered = resolveGameTokens(String(value));
  if (valueType === 'add') return `${capitalize(type)} +${rendered}`;
  if (valueType === 'minus') return `${capitalize(type)} -${rendered}`;
  return `${capitalize(type)} ${rendered}`.trimEnd();
}

/**
 * Render one GHS sub-action (recursively) into readable fragments.
 * Returns [] for layout-only nodes. SQR-396: the previous implementation
 * visited one level with a narrow allowlist, silently dropping heal/attack/
 * element riders — the Opposing Strike "Heal 2, Range 3" class of data loss.
 */
function formatSubActionParts(sub: GhsSubAction, labels: LabelData, depth: number): string[] {
  if (depth > MAX_SUBACTION_DEPTH) return [];
  if (LAYOUT_SUBACTION_TYPES.has(sub.type)) return [];

  const children = (sub.subActions ?? []).flatMap((nested) =>
    formatSubActionParts(nested, labels, depth + 1),
  );

  // Transparent container: surface children only.
  if (sub.type === 'concatenation') return children;

  if (sub.type === 'card') {
    const val = String(sub.value);
    // Enhancement/XP slot markers are layout, not effects.
    if (val === 'slot' || val.startsWith('slot')) return children;
    const experience = val.match(/^experience:(\d+)$/);
    if (experience) return [`XP ${experience[1]}`, ...children];
    return children;
  }

  if (sub.type === 'element') {
    const element = capitalize(String(sub.value));
    if (sub.valueType === 'minus') {
      // Consumption rider: nested parts are what the consumption grants.
      return children.length > 0
        ? [`Consume ${element}: ${children.join(', ')}`]
        : [`Consume ${element}`];
    }
    return [`Infuse ${element}`, ...children];
  }

  let text: string;
  if (sub.type === 'condition' || sub.type === 'specialTarget') {
    text = capitalize(String(sub.value));
  } else if (sub.type === 'custom') {
    const val = String(sub.value);
    text = /%(?:data|game)\./.test(val) ? resolveTemplateText(val, labels) : resolveGameTokens(val);
  } else if (typeof sub.value === 'string' && /%(?:data|game)\./.test(sub.value)) {
    text = resolveTemplateText(sub.value, labels);
  } else {
    text = formatValueWithSign(sub.type, sub.value, sub.valueType);
  }

  return [text, ...children];
}

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
    } else if (/%(?:data|game)\./.test(val)) {
      text = resolveTemplateText(val, labels);
    } else {
      text = resolveGameTokens(val);
    }
  } else if (action.type === 'element') {
    // Same consume/infuse semantics as nested element riders (SQR-396).
    const element = capitalize(String(action.value));
    text = action.valueType === 'minus' ? `Consume ${element}` : `Infuse ${element}`;
  } else if (action.type === 'condition') {
    text = capitalize(String(action.value));
  } else if (action.type === 'summon') {
    const name = action.valueObject?.name;
    text = name ? `Summon ${kebabToTitle(String(name))}` : 'Summon';
  } else {
    const val = String(action.value);
    if (/%(?:data|game)\./.test(val)) {
      // When the value is label-backed text, resolve it directly —
      // prepending the type name would duplicate words already in the label.
      text = resolveTemplateText(val, labels);
    } else {
      text = `${capitalize(action.type)} ${resolveGameTokens(val)}`;
    }
  }

  // Append sub-actions recursively (SQR-396): nested effects like
  // heal → range or element-consumption riders are real card content.
  const subParts = (action.subActions ?? []).flatMap((sub) => formatSubActionParts(sub, labels, 1));

  if (subParts.length > 0) {
    // Text ending in ':' introduces its sub-effects directly ("perform:
    // Heal 2, Range 3"), not with a comma splice.
    const base = text.trimEnd();
    text = base.endsWith(':')
      ? `${base} ${subParts.join(', ')}`
      : `${base}, ${subParts.join(', ')}`;
  }

  return text;
}
