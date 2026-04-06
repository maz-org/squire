/**
 * Import event cards from Gloomhaven Secretariat (GHS) reference data.
 * GHS events have complete narrative text and structured outcomes — far better
 * than OCR, which stores front/back separately and often has empty outcomes.
 *
 * Run with: npx tsx src/import-events.ts
 *
 * Requires: GHS data (set GHS_DATA_DIR env var, or clone into data/gloomhavensecretariat/)
 * Output: data/extracted/events.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GHS_DATA_DIR, resolveGameTokens } from './ghs-utils.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GHS_EVENTS_PATH = join(GHS_DATA_DIR, 'events.json');
const OUTPUT_PATH = join(__dirname, '..', 'data', 'extracted', 'events.json');

// ─── GHS types (event-relevant subset) ──────────────────────────────────────

interface GhsEffectObject {
  type: string;
  alt?: string;
  values?: (string | number | GhsEffectObject)[];
  condition?: GhsCondition;
}

type GhsEffect = string | GhsEffectObject;

type GhsCondition = string | { type: string; values?: string[] };

interface GhsOutcome {
  narrative?: string;
  effects?: GhsEffect[];
  condition?: GhsCondition;
  returnToDeck?: boolean;
}

interface GhsOption {
  label?: string;
  narrative?: string;
  outcomes?: GhsOutcome[];
}

interface GhsEvent {
  cardId: string;
  edition: string;
  type: string;
  narrative: string;
  options: GhsOption[];
}

// ─── Our extracted format ───────────────────────────────────────────────────

interface ExtractedEvent {
  eventType: 'road' | 'outpost' | 'boat';
  season: 'summer' | 'winter' | null;
  number: string;
  flavorText: string;
  optionA: { text: string; outcome: string };
  optionB: { text: string; outcome: string } | null;
  optionC: { text: string; outcome: string } | null;
  _source: string;
}

// ─── HTML stripping ─────────────────────────────────────────────────────────

function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/  +/g, ' ')
    .trim();
}

// ─── Type mapping ───────────────────────────────────────────────────────────

function parseEventType(ghsType: string): {
  eventType: 'road' | 'outpost' | 'boat';
  season: 'summer' | 'winter' | null;
} {
  switch (ghsType) {
    case 'boat':
      return { eventType: 'boat', season: null };
    case 'summer-road':
      return { eventType: 'road', season: 'summer' };
    case 'winter-road':
      return { eventType: 'road', season: 'winter' };
    case 'summer-outpost':
      return { eventType: 'outpost', season: 'summer' };
    case 'winter-outpost':
      return { eventType: 'outpost', season: 'winter' };
    default:
      throw new Error(`Unknown GHS event type: ${ghsType}`);
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Effect formatting ──────────────────────────────────────────────────────

/**
 * Convert a single GHS effect into human-readable text.
 * Returns null for effects that don't produce readable text (like outcome references).
 */
export function formatEffect(effect: GhsEffect): string | null {
  if (typeof effect === 'string') {
    return resolveGameTokens(effect);
  }

  const { type, values = [] } = effect;

  switch (type) {
    // Gain resources/stats
    case 'morale':
      return `Gain ${values[0]} morale`;
    case 'prosperity':
      return `Gain ${values[0]} prosperity`;
    case 'experience':
      return `Gain ${values[0]} experience`;
    case 'gold':
      return `Gain ${values[0]} gold`;
    case 'inspiration':
      return `Gain ${values[0]} inspiration`;
    case 'soldier':
    case 'soldiers':
      return `Gain ${values[0]} soldier${(values[0] as number) !== 1 ? 's' : ''}`;
    case 'collectiveGold':
      return `Gain ${values[0]} collective gold`;
    case 'collectiveResource':
      return `Gain ${values[1]} collective ${values[0]}`;
    case 'collectiveResourceType':
      return `Gain ${values[1]} collective ${values[0]}`;
    case 'resource':
      return `Gain ${values[1]} ${values[0]}`;
    case 'resourceType':
      return `Gain ${values[1]} ${values[0]}`;

    // Lose resources/stats
    case 'loseMorale':
      return `Lose ${values[0]} morale`;
    case 'loseProsperity':
      return `Lose ${values[0]} prosperity`;
    case 'loseExperience':
      return `Lose ${values[0]} experience`;
    case 'loseGold':
      return `Lose ${values[0]} gold`;
    case 'loseCollectiveGold':
      return `Lose ${values[0]} collective gold`;
    case 'loseCollectiveResource':
      return `Lose ${values[1]} collective ${values[0]}`;
    case 'loseCollectiveResourceAny':
      return `Lose ${values[0]} collective resources (any type)`;
    case 'loseCollectiveResourceType':
      return `Lose ${values[1]} collective ${values[0]}`;
    case 'loseCollectiveExperience':
      return `Lose ${values[0]} collective experience`;
    case 'loseResource':
      return `Lose ${values[1]} ${values[0]}`;

    // Conditions
    case 'scenarioCondition':
      return `All characters start the next scenario with ${(values as string[]).map(capitalize).join(', ')}`;
    case 'scenarioDamage':
      return `All characters suffer ${values[0]} damage at the start of the next scenario`;

    // Scenario/event management
    case 'unlockScenario':
      return `Unlock scenario ${values[0]}`;
    case 'drawAnotherEvent':
      return `Draw another ${values[0]} event`;
    case 'removeEvent':
      return 'Remove this event from the deck';
    case 'event':
      return `Add event ${values[1]} to the ${values[0]} deck`;
    case 'eventReturn':
      return 'Return this event to the deck';

    // Items
    case 'randomItem':
      return 'Gain a random item';
    case 'randomItemBlueprint':
      return 'Gain a random item blueprint';
    case 'item':
      return `Gain item ${values[0]}`;
    case 'randomScenario':
      return 'Unlock a random scenario';

    // Campaign stickers
    case 'campaignSticker':
      return `Add campaign sticker: ${values[0]}`;
    case 'campaignStickerMap':
      return `Add campaign sticker to map: ${values[0]}`;
    case 'campaignStickerReplace':
      return `Replace campaign sticker: ${values[0]}`;

    // Discard/card effects
    case 'discard':
      return `Discard ${values[0]} cards; gain ${capitalize(String(values[1]))}`;
    case 'discardOne':
      return 'Discard 1 card';

    // Battle goals, checkboxes
    case 'battleGoal':
      return 'Gain a battle goal check';
    case 'checkbox':
      return `Gain ${values[0]} perk check${(values[0] as number) !== 1 ? 's' : ''}`;

    // Buildings
    case 'upgradeBuilding':
      return `Upgrade building: ${values[0]}`;
    case 'wreckBuilding':
      return `Wreck building: ${values[0]}`;

    // Town guard
    case 'townGuardDeckCard':
      return 'Add a town guard card';
    case 'townGuardDeckCards':
      return `Add ${values[0]} town guard cards`;
    case 'townGuardDeckCardRemove':
      return 'Remove a town guard card';
    case 'townGuardDeckCardRemovePermanently':
      return 'Permanently remove a town guard card';

    // Outpost attacks
    case 'outpostAttack':
      return 'Trigger an outpost attack';
    case 'outpostAttackTarget':
      return `Outpost attack targets: ${values.join(', ')}`;
    case 'outpostTarget':
      return `Outpost target: ${values[0]}`;

    // Misc
    case 'noEffect':
      return 'No effect';
    case 'skipThreat':
      return 'Skip the next threat increase';
    case 'eventsToTop':
      return `Move events to top of deck: ${values.join(', ')}`;

    // Compound effects — flatten
    case 'and':
    case 'additionally':
    case 'outcomes': {
      const parts = (values as GhsEffect[])
        .map((v) => formatEffect(v))
        .filter((s): s is string => s !== null);
      return parts.length > 0 ? parts.join('. ') : null;
    }

    // Trait-conditional compound effects
    case 'traitExperience':
      return `Gain ${values[1]} experience (requires ${values[0]})`;
    case 'traitScenarioCondition':
      return `${capitalize(String(values[0]))}: All characters start the next scenario with ${capitalize(String(values[1]))}`;
    case 'traitScenarioDamage':
      return `${capitalize(String(values[0]))}: All characters suffer ${values[1]} damage`;

    // Section references
    case 'sectionOrWeek':
    case 'sectionWeek':
    case 'sectionWeeks':
    case 'sectionWeeksSeason':
      return `See section/week: ${values.join(', ')}`;

    // Select between outcomes
    case 'outcomeSelect':
      return `Select one outcome: ${values.join(', ')}`;

    // Envelope unlock
    case 'unlockEnvelope':
      return `Unlock envelope: ${values[0]}`;

    // Custom text
    case 'custom':
      return resolveGameTokens(String(values[0] ?? ''));

    // References to other outcomes — these don't produce standalone text
    case 'outcome':
      return null;

    default:
      return null;
  }
}

// ─── Condition formatting ───────────────────────────────────────────────────

function formatCondition(condition: GhsCondition): string {
  if (typeof condition === 'string') return condition;

  const { type, values = [] } = condition;
  switch (type) {
    case 'otherwise':
      return 'OTHERWISE';
    case 'season':
      return values[0]?.toUpperCase() ?? 'SEASON';
    case 'building':
      return values.join(', ').toUpperCase();
    case 'traits':
      return values.join(', ').toUpperCase();
    case 'campaignSticker':
      return `STICKER: ${values.join(', ')}`.toUpperCase();
    case 'moraleGT':
      return `MORALE > ${values[0]}`;
    case 'moraleLT':
      return `MORALE < ${values[0]}`;
    case 'seasonLT':
      return `BEFORE ${values[0]?.toUpperCase()}`;
    case 'loseCollectiveGold':
      return `LOSE ${values[0]} COLLECTIVE GOLD`;
    case 'loseCollectiveResource':
      return `LOSE COLLECTIVE ${values.join(', ')}`.toUpperCase();
    case 'loseCollectiveResourceType':
      return `LOSE COLLECTIVE ${values.join(', ')}`.toUpperCase();
    case 'loseResource':
      return `LOSE ${values.join(', ')}`.toUpperCase();
    case 'loseResourceType':
      return `LOSE ${values.join(', ')}`.toUpperCase();
    case 'and':
      return values.join(' AND ').toUpperCase();
    default:
      return values.length > 0 ? values.join(', ').toUpperCase() : type.toUpperCase();
  }
}

// ─── Outcome formatting ─────────────────────────────────────────────────────

/**
 * Flatten structured GHS outcomes into a single readable text string.
 * Each outcome may have a condition (prefix), narrative, and effects.
 */
export function formatOutcomes(outcomes: GhsOutcome[]): string {
  const parts: string[] = [];

  for (const outcome of outcomes) {
    const effectTexts = (outcome.effects ?? [])
      .map((e) => {
        // Effects with their own conditions are nested outcome refs — handle inline
        if (typeof e === 'object' && 'condition' in e && e.condition) {
          // This is a conditional effect like { condition: ..., type: 'outcome', values: ['C'] }
          // If it's just an outcome ref, skip it
          if (e.type === 'outcome') return null;
          return formatEffect(e);
        }
        return formatEffect(e);
      })
      .filter((s): s is string => s !== null);

    // Skip outcome entries that are purely outcome references with no narrative
    if (effectTexts.length === 0 && !outcome.narrative) continue;

    let text = '';

    // Add condition prefix
    if (outcome.condition) {
      text += `${formatCondition(outcome.condition)}: `;
    }

    // Add narrative
    if (outcome.narrative) {
      text += stripHtml(outcome.narrative);
    }

    // Add effects
    if (effectTexts.length > 0) {
      if (text && !text.endsWith(': ')) text += ' ';
      const joined = effectTexts.join('. ');
      text += joined.endsWith('.') ? joined : joined + '.';
    } else if (text && !text.endsWith('.')) {
      text += '.';
    }

    if (text.trim()) {
      parts.push(text.trim());
    }
  }

  return parts.join(' ');
}

// ─── Conversion ─────────────────────────────────────────────────────────────

/**
 * Convert a single GHS event object into our extracted format.
 */
export function convertEvent(ghs: GhsEvent): ExtractedEvent {
  const { eventType, season } = parseEventType(ghs.type);

  // Extract event number from cardId (e.g., "B-01" → "01", "SR-42" → "42")
  const number = ghs.cardId.split('-').slice(1).join('-');

  // Assign labels: use explicit labels or fall back to A, B, C by position
  const optionsByLabel: Record<string, GhsOption> = {};
  const defaultLabels = ['A', 'B', 'C'];
  for (let i = 0; i < ghs.options.length; i++) {
    const opt = ghs.options[i];
    const label = opt.label ?? defaultLabels[i];
    if (label) optionsByLabel[label] = opt;
  }

  const buildOption = (label: string): { text: string; outcome: string } | null => {
    const opt = optionsByLabel[label];
    if (!opt) return null;
    return {
      text: opt.narrative ? stripHtml(opt.narrative) : '',
      outcome: formatOutcomes(opt.outcomes ?? []),
    };
  };

  const optionA = buildOption('A');

  return {
    eventType,
    season,
    number,
    flavorText: stripHtml(ghs.narrative),
    optionA: optionA ?? { text: '', outcome: '' },
    optionB: buildOption('B'),
    optionC: buildOption('C'),
    _source: `gloomhavensecretariat:event/${ghs.cardId}`,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

export function importEvents(): ExtractedEvent[] {
  if (!existsSync(GHS_EVENTS_PATH)) {
    throw new Error(
      `GHS event data not found at ${GHS_EVENTS_PATH}. Set GHS_DATA_DIR or clone GHS into data/gloomhavensecretariat/`,
    );
  }

  const events: GhsEvent[] = JSON.parse(readFileSync(GHS_EVENTS_PATH, 'utf-8'));
  return events.map((e) => convertEvent(e));
}

if (process.argv[1]?.endsWith('import-events.ts')) {
  const results = importEvents();
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Wrote ${results.length} records to ${OUTPUT_PATH}`);
}
