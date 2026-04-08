/**
 * Zod schemas for each Frosthaven card type.
 * Used for validation during GHS data imports and at runtime.
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
  sourceId: z
    .string()
    .describe('GHS source identifier (e.g. gloomhavensecretariat:monster-stat/bandit-guard)'),
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
  sourceId: z
    .string()
    .describe('GHS source identifier (e.g. gloomhavensecretariat:algox-archer/123)'),
  monsterType: z.string().describe('Monster deck name (e.g. "Algox Archer")'),
  cardName: z.string().describe('Name of the ability card'),
  initiative: z.number().int().describe('Initiative number'),
  abilities: z
    .array(z.string())
    .describe('Each ability line verbatim, describing icons as words (e.g. "Attack +1", "Muddle")'),
});

export const CharacterAbilitySchema = z.object({
  sourceId: z.string().describe('GHS source identifier (e.g. gloomhavensecretariat:drifter/456)'),
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

export const CharacterMatSchema = z.object({
  sourceId: z
    .string()
    .describe('GHS source identifier (e.g. gloomhavensecretariat:character-mat/drifter)'),
  name: z.string().describe('Character class name (e.g. "Drifter")'),
  characterClass: z.string().describe('Character race (e.g. "Inox")'),
  handSize: z
    .union([z.number().int(), z.tuple([z.number().int(), z.number().int()])])
    .describe(
      'Starting hand size. A single integer for normal mats, or a `[form1, form2]` tuple for split mats like Geminate where GHS encodes the hand size as the pipe-separated string "7|7". The importer parses the string into a tuple; see SQR-63.',
    ),
  traits: z.array(z.string()).describe('Character traits (e.g. outcast, resourceful, strong)'),
  hp: z
    .record(z.string(), z.number().int())
    .describe('HP by level, keyed by level number string ("1" through "9")'),
  perks: z.array(z.string()).describe('Human-readable perk descriptions'),
  masteries: z.array(z.string()).describe('Human-readable mastery conditions'),
});

export const ItemSchema = z.object({
  sourceId: z.string().describe('GHS source identifier (e.g. gloomhavensecretariat:item/099)'),
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
  sourceId: z.string().describe('GHS source identifier (e.g. gloomhavensecretariat:event/1234)'),
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
  optionC: z
    .object({
      text: z.string().describe('Choice C text'),
      outcome: z.string().describe('Full outcome text for choice C'),
    })
    .nullable()
    .describe('Option C, or null if there is no third choice'),
});

export const BattleGoalSchema = z.object({
  sourceId: z
    .string()
    .describe('GHS source identifier (e.g. gloomhavensecretariat:battle-goal/1301)'),
  name: z.string().describe('Battle goal name'),
  condition: z.string().describe('Full goal condition text'),
  checkmarks: z.number().int().describe('Number of checkmarks awarded'),
});

export const BuildingSchema = z.object({
  sourceId: z
    .string()
    .describe('GHS source identifier (e.g. gloomhavensecretariat:building/05 or .../wall-j)'),
  buildingNumber: z
    .string()
    .nullable()
    .describe('Building number as string, or null for walls (which have no number)'),
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

export const ScenarioSchema = z.object({
  sourceId: z.string().describe('GHS source identifier (e.g. gloomhavensecretariat:scenario/020)'),
  scenarioGroup: z
    .enum(['main', 'solo', 'random'])
    .describe(
      'Scenario namespace — main campaign, solo class scenario, or random side scenario. Required because solo scenarios share `index` values with the main campaign (e.g. main 20 "Temple of Liberation" vs solo 20 "Wonder of Nature").',
    ),
  index: z.string().describe('Scenario number/identifier (e.g. "1", "4A")'),
  name: z.string().describe('Scenario name'),
  complexity: z
    .number()
    .int()
    .min(1)
    .max(3)
    .nullish()
    .describe(
      'Scenario complexity rating (1-3). Null/absent for solo class scenarios and the random dungeon, which ship without a printed complexity value.',
    ),
  monsters: z.array(z.string()).describe('Monster types present in this scenario'),
  allies: z.array(z.string()).describe('Allied monster types, if any'),
  unlocks: z.array(z.string()).describe('Scenario indices unlocked on completion'),
  requirements: z
    .array(
      // Each requirement is an AND-group of conditions. Real data has three
      // kinds: `buildings` (town has building X at level Y), `campaignSticker`
      // (a story sticker is placed on the campaign sheet), and `scenarios`
      // (a prior scenario is completed). All three are optional because any
      // given requirement row only uses the fields it needs.
      z.object({
        buildings: z.array(z.string()).optional(),
        campaignSticker: z.array(z.string()).optional(),
        // Nested: each inner array is an AND-group of scenario indices
        // that together satisfy one prerequisite branch. GHS source shape.
        scenarios: z.array(z.array(z.string())).optional(),
      }),
    )
    .describe('Prerequisites to play this scenario'),
  objectives: z
    .array(
      z.object({
        name: z.string(),
        escort: z.boolean().optional(),
      }),
    )
    .describe('Named objectives in the scenario'),
  rewards: nullableStr.describe('Human-readable completion rewards text'),
  lootDeckConfig: z
    .record(z.string(), z.number())
    .describe('Loot deck composition by resource type'),
  flowChartGroup: nullableStr.describe('Campaign flow chart group'),
  initial: z.boolean().describe('Whether this is a starting scenario'),
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
    .array(z.number().int().min(1))
    .nullable()
    .describe('1-based indices of prerequisite requirements, or null'),
});

export const PersonalQuestSchema = z.object({
  sourceId: z
    .string()
    .describe('GHS source identifier (e.g. gloomhavensecretariat:personal-quest/501)'),
  cardId: z.string().describe('Personal quest card ID'),
  altId: z.string().describe('Alternate personal quest ID from source data'),
  name: z.string().describe('Quest title'),
  requirements: z.array(PersonalQuestRequirementSchema).describe('Completion requirements'),
  openEnvelope: z.string().describe('Envelope/section references to open on completion'),
  errata: z.string().nullable().describe('Errata key/reference, or null'),
});

export const SCHEMAS = {
  'monster-stats': MonsterStatSchema,
  'monster-abilities': MonsterAbilitySchema,
  'character-abilities': CharacterAbilitySchema,
  'character-mats': CharacterMatSchema,
  items: ItemSchema,
  events: EventSchema,
  'battle-goals': BattleGoalSchema,
  buildings: BuildingSchema,
  scenarios: ScenarioSchema,
  'personal-quests': PersonalQuestSchema,
} as const;

export type CardType = keyof typeof SCHEMAS;

/** All card type keys as a runtime array. Single source of truth for MCP/agent enums. */
export const CARD_TYPES = Object.keys(SCHEMAS) as [CardType, ...CardType[]];

// Inferred types from Zod schemas
export type MonsterStat = z.infer<typeof MonsterStatSchema>;
export type MonsterAbility = z.infer<typeof MonsterAbilitySchema>;
export type CharacterAbility = z.infer<typeof CharacterAbilitySchema>;
export type CharacterMat = z.infer<typeof CharacterMatSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type Event = z.infer<typeof EventSchema>;
export type BattleGoal = z.infer<typeof BattleGoalSchema>;
export type Building = z.infer<typeof BuildingSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
export type PersonalQuest = z.infer<typeof PersonalQuestSchema>;
export type CardData =
  | MonsterStat
  | MonsterAbility
  | CharacterAbility
  | CharacterMat
  | Item
  | Event
  | BattleGoal
  | Building
  | Scenario
  | PersonalQuest;
