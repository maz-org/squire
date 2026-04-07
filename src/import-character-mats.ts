/**
 * Import character mat data from Gloomhaven Secretariat (GHS) reference data.
 * Extracts HP progression, hand size, traits, perks, and masteries for each
 * Frosthaven character class.
 *
 * Run with: npx tsx src/import-character-mats.ts
 *
 * Requires: GHS data (set GHS_DATA_DIR env var, or clone into data/gloomhavensecretariat/)
 * Output: data/extracted/character-mats.json
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GHS_DATA_DIR,
  kebabToTitle,
  capitalize,
  loadLabels,
  resolveLabel,
  resolveGameTokens,
  type LabelData,
} from './ghs-utils.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GHS_CHARACTER_DIR = join(GHS_DATA_DIR, 'character');
const OUTPUT_PATH = join(__dirname, '..', 'data', 'extracted', 'character-mats.json');

// ─── GHS types ───────────────────────────────────────────────────────────────

interface GhsAttackModifier {
  type: string;
  rolling?: boolean;
  effects?: Array<{
    type: string;
    value?: string | number;
    effects?: Array<{ type: string; value: string }>;
  }>;
}

interface GhsPerkCard {
  count: number;
  attackModifier: GhsAttackModifier;
}

interface GhsPerk {
  type: string;
  count: number;
  cards?: GhsPerkCard[];
  custom?: string;
  immunity?: string;
}

interface GhsCharacter {
  name: string;
  characterClass: string;
  edition: string;
  handSize: number;
  traits: string[];
  stats: Array<{ level: number; health: number }>;
  perks: GhsPerk[];
  masteries: string[];
  color?: string;
  identities?: string[];
  tokens?: string[];
  specialActions?: Array<{ name: string }>;
}

// ─── Our extracted format ────────────────────────────────────────────────────

interface ExtractedCharacterMat {
  name: string;
  characterClass: string;
  handSize: number;
  traits: string[];
  hp: Record<string, number>;
  perks: string[];
  masteries: string[];
  sourceId: string;
}

// ─── Perk formatting ────────────────────────────────────────────────────────

// GHS game tokens that appear in perk/mastery text but aren't in label files.
// These are rendered as icons in the GHS app — we provide readable text.
const GAME_PERK_TOKENS: Record<string, string> = {
  '%game.custom.perks.ignoreNegativeItemFh%':
    'You may ignore negative item effects and the appearance of a cursed item',
  '%game.custom.perks.ignoreScenario%': 'You may ignore negative scenario effects',
};

/**
 * Resolve a %data.*% reference with perk-specific fallbacks.
 * GHS perk text references some paths (action.custom.fh-shadow,
 * characterToken.*) that don't exist in label files — they're
 * rendered as icons in the GHS app. We provide readable fallbacks.
 */
function resolvePerkLabel(ref: string, labels: LabelData): string {
  // Try standard label resolution first
  const resolved = resolveLabel(ref, labels);
  if (resolved !== ref) return resolved;

  // Fallback: extract a readable name from the reference path
  const path = ref.slice(6, -1); // strip %data. and %

  // %data.action.custom.fh-shadow% → "Shadow"
  if (path.startsWith('action.custom.')) {
    const name = path.replace('action.custom.', '').replace(/^fh-/, '');
    return kebabToTitle(name);
  }

  // %data.characterToken.blinkblade.time% → "Time token"
  if (path.startsWith('characterToken.')) {
    const parts = path.split('.');
    const tokenName = parts[parts.length - 1];
    return `${capitalize(tokenName)} token`;
  }

  return ref;
}

/**
 * Resolve all template references in a perk/mastery text string.
 * Handles %data.*%, %game.*%, known GAME_PERK_TOKENS, and <br> tags.
 */
function resolvePerkText(text: string, labels: LabelData): string {
  let result = text;

  // Replace known game perk tokens first
  for (const [token, replacement] of Object.entries(GAME_PERK_TOKENS)) {
    result = result.replaceAll(token, replacement);
  }

  // Replace <br> tags with ". " for readability
  result = result.replace(/<br\s*\/?>/g, '. ');

  // Resolve %data.*% references (may need multiple passes since resolved
  // text can itself contain %data.*% references, e.g. deathwalker shadow tokens)
  let prev = '';
  while (prev !== result && /%data\.[^%]+%/.test(result)) {
    prev = result;
    result = result.replace(/%data\.[^%]+%/g, (match) => resolvePerkLabel(match, labels));
  }

  // Resolve remaining %game.*% references
  result = resolveGameTokens(result);

  return result.trim();
}

const MODIFIER_DISPLAY: Record<string, string> = {
  minus2: '-2',
  minus1: '-1',
  plus0: '+0',
  plus1: '+1',
  plus2: '+2',
  plus3: '+3',
  plus4: '+4',
};

function formatModifier(mod: GhsAttackModifier, labels: LabelData): string {
  const base = MODIFIER_DISPLAY[mod.type] ?? mod.type;
  const prefix = mod.rolling ? 'Rolling ' : '';

  const effectParts: string[] = [];
  for (const effect of mod.effects ?? []) {
    if (effect.type === 'condition' || effect.type === 'specialTarget') {
      effectParts.push(capitalize(String(effect.value ?? '')));
      // Nested effects (e.g., condition with specialTarget)
      for (const sub of effect.effects ?? []) {
        if (sub.type === 'specialTarget' || sub.type === 'condition') {
          effectParts.push(capitalize(String(sub.value)));
        }
      }
    } else if (effect.type === 'custom') {
      const val = String(effect.value ?? '');
      effectParts.push(resolvePerkText(val, labels));
    } else if (effect.type === 'pierce' || effect.type === 'push' || effect.type === 'pull') {
      effectParts.push(`${capitalize(effect.type)} ${effect.value}`);
    } else if (effect.type === 'heal' || effect.type === 'shield' || effect.type === 'retaliate') {
      effectParts.push(`${capitalize(effect.type)} ${effect.value}`);
    }
  }

  const effectStr = effectParts.length > 0 ? ' ' + effectParts.join(' ') : '';
  return `${prefix}${base}${effectStr}`;
}

function formatCardGroup(card: GhsPerkCard, labels: LabelData): string {
  const desc = formatModifier(card.attackModifier, labels);
  if (card.count === 1) return desc;
  const countWord = card.count === 2 ? 'two' : card.count === 3 ? 'three' : String(card.count);
  return `${countWord} ${desc}`;
}

function pluralizeCard(count: number): string {
  return count === 1 ? 'card' : 'cards';
}

export function formatPerk(perk: GhsPerk, characterName: string, labels: LabelData): string {
  if (perk.type === 'custom' && perk.custom) {
    return resolvePerkText(perk.custom, labels);
  }

  const cards = perk.cards ?? [];
  if (cards.length === 0) return `${capitalize(perk.type)} ${perk.count} cards`;

  if (perk.type === 'remove' || perk.type === 'add') {
    const groups = cards.map((c) => {
      const desc = formatCardGroup(c, labels);
      const total = perk.count * c.count;
      return `${desc} ${pluralizeCard(total)}`;
    });
    const verb = perk.type === 'remove' ? 'Remove' : 'Add';
    return `${verb} ${perk.count} ${groups.join(' and ')}`;
  }

  if (perk.type === 'replace' && cards.length >= 2) {
    const oldCard = formatCardGroup(cards[0], labels);
    const oldTotal = perk.count * cards[0].count;
    const newGroups = cards.slice(1).map((c) => {
      const desc = formatCardGroup(c, labels);
      const total = perk.count * c.count;
      return `${desc} ${pluralizeCard(total)}`;
    });
    return `Replace ${perk.count} ${oldCard} ${pluralizeCard(oldTotal)} with ${newGroups.join(' and ')}`;
  }

  return `${capitalize(perk.type)} ${perk.count} cards`;
}

// ─── Conversion ──────────────────────────────────────────────────────────────

export function convertCharacterMat(ghs: GhsCharacter, labels: LabelData): ExtractedCharacterMat {
  const hp: Record<string, number> = {};
  for (const stat of ghs.stats) {
    hp[String(stat.level)] = stat.health;
  }

  const perks = ghs.perks.map((p) => formatPerk(p, ghs.name, labels));

  const masteries = ghs.masteries.map((m) => resolvePerkText(m, labels));

  return {
    name: kebabToTitle(ghs.name),
    characterClass: kebabToTitle(ghs.characterClass),
    handSize: ghs.handSize,
    traits: ghs.traits,
    hp,
    perks,
    masteries,
    sourceId: `gloomhavensecretariat:character-mat/${ghs.name}`,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function importCharacterMats(): ExtractedCharacterMat[] {
  if (!existsSync(GHS_CHARACTER_DIR)) {
    throw new Error(
      `GHS data not found at ${GHS_CHARACTER_DIR}. Set GHS_DATA_DIR or clone GHS into data/gloomhavensecretariat/`,
    );
  }

  const labels = loadLabels();
  const allResults: ExtractedCharacterMat[] = [];

  for (const file of readdirSync(GHS_CHARACTER_DIR).sort()) {
    if (!file.endsWith('.json')) continue;

    const ghs: GhsCharacter = JSON.parse(readFileSync(join(GHS_CHARACTER_DIR, file), 'utf-8'));
    const record = convertCharacterMat(ghs, labels);

    const allText = [...record.perks, ...record.masteries];
    const unresolved = allText.find((t) => /%(?:data|game)\./.test(t));
    if (unresolved) {
      throw new Error(`Unresolved label/token in character ${ghs.name}: ${unresolved}`);
    }

    allResults.push(record);
  }

  return allResults;
}

if (process.argv[1]?.endsWith('import-character-mats.ts')) {
  const results = importCharacterMats();
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Wrote ${results.length} records to ${OUTPUT_PATH}`);
}
