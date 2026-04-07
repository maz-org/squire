/**
 * Import item cards from Gloomhaven Secretariat (GHS) reference data.
 * GHS has structured item data with crafting resources, building requirements,
 * and effect text via label references — more reliable than OCR extraction.
 *
 * Run with: GHS_DATA_DIR=~/data/ghs npx tsx src/import-items.ts
 *
 * Requires: GHS data (set GHS_DATA_DIR env var, or clone into data/gloomhavensecretariat/)
 * Output: data/extracted/items.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GHS_DATA_DIR,
  capitalize,
  kebabToTitle,
  resolveLabel,
  formatAction,
  loadLabels,
  type GhsAction,
  type LabelData,
} from './ghs-utils.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GHS_ITEMS_PATH = join(GHS_DATA_DIR, 'items.json');
const OUTPUT_PATH = join(__dirname, '..', 'data', 'extracted', 'items.json');

// ─── GHS item type ──────────────────────────────────────────────────────────

export interface GhsItem {
  id: number;
  name: string;
  count: number;
  edition: string;
  slot?: string;
  cost?: number;
  spent?: boolean;
  consumed?: boolean;
  loss?: boolean;
  round?: boolean;
  persistent?: boolean;
  actions?: GhsAction[];
  actionsBack?: GhsAction[];
  resources?: Record<string, number>;
  resourcesAny?: number;
  requiredBuilding?: string;
  requiredBuildingLevel?: number;
  requiredItems?: number[];
  slots?: number;
  solo?: string;
  blueprint?: boolean;
  random?: boolean;
  minusOne?: number;
  effects?: GhsAction[];
  unlockProsperity?: number;
}

// ─── Our extracted format ───────────────────────────────────────────────────

interface ExtractedItem {
  number: string;
  name: string;
  slot: 'head' | 'body' | 'legs' | 'one hand' | 'two hands' | 'small item';
  cost: number | null;
  effect: string;
  uses: number | null;
  spent: boolean;
  lost: boolean;
  sourceId: string;
}

// ─── Slot mapping ───────────────────────────────────────────────────────────

const SLOT_MAP: Record<string, ExtractedItem['slot']> = {
  head: 'head',
  body: 'body',
  legs: 'legs',
  onehand: 'one hand',
  twohand: 'two hands',
  small: 'small item',
};

// ─── Label resolution with fallbacks ────────────────────────────────────────

/**
 * Resolve remaining %data.*% references in text that weren't caught by
 * formatAction's initial resolution pass. Some item labels contain nested
 * %data.*% refs (e.g. %data.action.custom.fh-hourglass%) that resolve to
 * icon-only tokens in the GHS app — we provide readable text fallbacks.
 */
export function resolveNestedDataRefs(text: string, labels: LabelData): string {
  return text.replace(/%data\.([^%]+)%/g, (match) => {
    // Try standard label resolution
    const resolved = resolveLabel(match, labels);
    if (resolved !== match) return resolved;

    // Fallback: %data.action.custom.fh-hourglass% → "Hourglass"
    const path = match.slice(6, -1); // strip %data. and %
    if (path.startsWith('action.custom.')) {
      const name = path.replace('action.custom.', '').replace(/^fh-/, '');
      return kebabToTitle(name);
    }

    // Fallback: %data.characterToken.blinkblade.time% → "Time token"
    if (path.startsWith('characterToken.')) {
      const parts = path.split('.');
      const tokenName = parts[parts.length - 1];
      return `${capitalize(tokenName)} token`;
    }

    return match;
  });
}

// ─── Conversion ─────────────────────────────────────────────────────────────

/**
 * Convert a single GHS item object into our Item format.
 */
export function convertItem(ghs: GhsItem, labels: LabelData): ExtractedItem {
  const slot = SLOT_MAP[ghs.slot ?? ''] ?? 'small item';

  // Build effect text from actions
  const actionParts = (ghs.actions ?? [])
    .map((a) => formatAction(a, labels))
    .filter((s): s is string => s !== null);

  const effect = resolveNestedDataRefs(actionParts.join('; '), labels);

  return {
    number: String(ghs.id).padStart(3, '0'),
    name: ghs.name,
    slot,
    cost: ghs.cost ?? null,
    effect,
    uses: null,
    spent: ghs.spent ?? false,
    lost: ghs.loss ?? false,
    sourceId: `gloomhavensecretariat:item/${ghs.id}`,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

export function importItems(): ExtractedItem[] {
  if (!existsSync(GHS_ITEMS_PATH)) {
    throw new Error(
      `GHS items data not found at ${GHS_ITEMS_PATH}. Set GHS_DATA_DIR or clone GHS into data/gloomhavensecretariat/`,
    );
  }

  const labels = loadLabels();
  const items: GhsItem[] = JSON.parse(readFileSync(GHS_ITEMS_PATH, 'utf-8'));
  const results: ExtractedItem[] = [];

  for (const item of items) {
    const converted = convertItem(item, labels);

    // Fail if any data/game tokens survived resolution
    if (/%(?:data|game)\./.test(converted.effect)) {
      throw new Error(
        `Unresolved label/token in item ${item.id} (${item.name}): ${converted.effect}`,
      );
    }

    results.push(converted);
  }

  return results;
}

if (process.argv[1]?.endsWith('import-items.ts')) {
  const results = importItems();
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Wrote ${results.length} records to ${OUTPUT_PATH}`);
}
