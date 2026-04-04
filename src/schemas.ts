/**
 * Zod schemas for each Frosthaven card type extracted via vision OCR.
 * Used for both prompt generation (via zod-to-json-schema) and runtime validation.
 */

import { z } from 'zod';

// ─── Shared primitives ────────────────────────────────────────────────────────

const nullableInt = z.number().int().nullable();
const nullableStr = z.string().nullable();

// ─── Card schemas ─────────────────────────────────────────────────────────────

const MonsterLevelStats = z.object({
  hp: z
    .number()
    .int()
    .min(1)
    .max(150)
    .nullable()
    .describe('Hit point value (1-150), or null if dash'),
  move: z
    .number()
    .int()
    .min(0)
    .max(12)
    .nullable()
    .describe('Movement value (0-12), or null if dash'),
  attack: z
    .number()
    .int()
    .min(0)
    .max(20)
    .nullable()
    .describe('Attack value (0-20), or null if dash'),
});

export const MonsterStatSchema = z.object({
  name: z.string().describe('Monster name as printed on the card'),
  levelRange: z.enum(['0-3', '4-7']).describe('Which half of levels this card shows'),
  normal: z
    .record(z.string(), MonsterLevelStats)
    .describe('Normal difficulty stats keyed by level number string'),
  elite: z
    .record(z.string(), MonsterLevelStats)
    .describe('Elite difficulty stats keyed by level number string'),
  immunities: z.array(z.string()).describe('List of conditions this monster is immune to'),
  notes: nullableStr.describe('Any special rules text on the card, or null'),
});

export const MonsterAbilitySchema = z.object({
  monsterType: z.string().describe('Monster deck name (e.g. "Algox Archer")'),
  cardName: z.string().describe('Name of the ability card'),
  initiative: z.number().int().describe('Initiative number'),
  abilities: z
    .array(z.string())
    .describe('Each ability line verbatim, describing icons as words (e.g. "Attack +1", "Muddle")'),
});

export const CharacterAbilitySchema = z.object({
  cardName: z.string().describe('Name of the card'),
  characterClass: z.string().describe('Character class name'),
  level: z
    .union([z.number().int(), z.literal('X')])
    .nullable()
    .describe('Card level number, "X" for lost cards with no level, or null'),
  initiative: nullableInt.describe('Initiative number, or null if not visible'),
  top: z
    .object({
      action: z.string().describe('Primary top action text (e.g. "Attack 3")'),
      effects: z.array(z.string()).describe('Additional effect lines for the top action'),
    })
    .describe('Top half of the card'),
  bottom: z
    .object({
      action: z.string().describe('Primary bottom action text'),
      effects: z.array(z.string()).describe('Additional effect lines for the bottom action'),
    })
    .describe('Bottom half of the card'),
  lost: z.boolean().describe('True if the card has a lost symbol'),
});

export const ItemSchema = z.object({
  number: z.string().describe('Item number as 3-digit string e.g. "099"'),
  name: z.string().describe('Item name'),
  slot: z
    .enum(['head', 'body', 'legs', 'one hand', 'two hands', 'small item'])
    .describe('Equipment slot'),
  cost: nullableInt.describe('Gold cost, or null if not shown'),
  effect: z.string().describe('Full effect text verbatim'),
  uses: nullableInt.describe('Number of use tokens, or null'),
  spent: z.boolean().describe('True if the card has a spent symbol (flip to use)'),
  lost: z.boolean().describe('True if the card has a lost symbol (remove from game)'),
});

export const EventSchema = z.object({
  eventType: z.enum(['road', 'outpost', 'boat']).describe('Type of event'),
  season: z.enum(['summer', 'winter']).nullable().describe('Season if shown, or null'),
  number: z.string().describe('Event number as string'),
  flavorText: z.string().describe('Story/flavor text on the card'),
  optionA: z
    .object({
      text: z.string().describe('Choice A text'),
      outcome: z.string().describe('Full outcome text for choice A'),
    })
    .describe('Option A'),
  optionB: z
    .object({
      text: z.string().describe('Choice B text'),
      outcome: z.string().describe('Full outcome text for choice B'),
    })
    .nullable()
    .describe('Option B, or null if there is no choice'),
});

export const BattleGoalSchema = z.object({
  name: z.string().describe('Battle goal name'),
  condition: z.string().describe('Full goal condition text'),
  checkmarks: z.number().int().describe('Number of checkmarks awarded'),
});

export const BuildingSchema = z.object({
  buildingNumber: z.string().describe('Building number as string'),
  name: z.string().describe('Building name'),
  level: z.number().int().describe('Building level'),
  buildCost: z
    .object({
      gold: nullableInt,
      lumber: nullableInt,
      metal: nullableInt,
      hide: nullableInt,
    })
    .describe('Resource costs, null for resources not required'),
  effect: z.string().describe('Full effect/ability text at this level'),
  notes: nullableStr.describe('Any other relevant text, or null'),
});

const PersonalQuestRequirementSchema = z.object({
  description: z.string().describe('Human-readable requirement text'),
  target: z
    .union([z.number().int(), z.string()])
    .describe('Counter target (number) or formula string (e.g. "80+20xP")'),
  options: z
    .array(z.string())
    .nullable()
    .describe('Checkbox options (e.g. herb names), or null if not applicable'),
  dependsOn: z
    .array(z.number().int())
    .nullable()
    .describe('1-based indices of prerequisite requirements, or null'),
});

export const PersonalQuestSchema = z.object({
  cardId: z.string().describe('Personal quest card ID'),
  name: z.string().describe('Quest title'),
  requirements: z.array(PersonalQuestRequirementSchema).describe('Completion requirements'),
  openEnvelope: z.string().describe('Envelope/section references to open on completion'),
});

export const SCHEMAS = {
  'monster-stats': MonsterStatSchema,
  'monster-abilities': MonsterAbilitySchema,
  'character-abilities': CharacterAbilitySchema,
  items: ItemSchema,
  events: EventSchema,
  'battle-goals': BattleGoalSchema,
  buildings: BuildingSchema,
  'personal-quests': PersonalQuestSchema,
} as const;

export type CardType = keyof typeof SCHEMAS;

// Inferred types from Zod schemas
export type MonsterStat = z.infer<typeof MonsterStatSchema>;
export type MonsterAbility = z.infer<typeof MonsterAbilitySchema>;
export type CharacterAbility = z.infer<typeof CharacterAbilitySchema>;
export type Item = z.infer<typeof ItemSchema>;
export type Event = z.infer<typeof EventSchema>;
export type BattleGoal = z.infer<typeof BattleGoalSchema>;
export type Building = z.infer<typeof BuildingSchema>;
export type PersonalQuest = z.infer<typeof PersonalQuestSchema>;
export type CardData =
  | MonsterStat
  | MonsterAbility
  | CharacterAbility
  | Item
  | Event
  | BattleGoal
  | Building
  | PersonalQuest;
