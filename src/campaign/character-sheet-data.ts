/**
 * GHS-data lookups for the structured character sheet: class mat summaries,
 * class-scoped ability cards, and campaign-scoped item / personal quest
 * catalogs.
 */
import { and, eq, inArray } from 'drizzle-orm';

import { getDb } from '../db.ts';
import { cardCharacterAbilities, cardCharacterMats, cardItems } from '../db/schema/cards.ts';
import {
  listItemCatalogOptions,
  listPersonalQuestCatalogOptions,
  resolvePersonalQuestNames,
  type PersonalQuestCatalogOption,
} from './character-catalog.ts';

export interface ItemOption {
  sourceId: string;
  number: string;
  name: string;
  status: 'available' | 'locked' | 'unavailable';
}

export interface CardOption {
  sourceId: string;
  name: string;
  level: string | null;
}

export type PersonalQuestOption = PersonalQuestCatalogOption;

export interface CharacterMatSummary {
  name: string;
  ancestry: string;
  handSize: string;
  traits: string[];
  hpByLevel: Record<string, number>;
  perks: string[];
  masteries: string[];
}

function formatHandSize(value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join(' / ');
  return String(value);
}

function normalizeHpByLevel(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized: Record<string, number> = {};
  for (const [level, hp] of Object.entries(value)) {
    if (typeof hp === 'number') normalized[level] = hp;
  }
  return normalized;
}

export async function getCharacterMatSummary(
  game: string,
  className: string,
): Promise<CharacterMatSummary | null> {
  const { db } = getDb('server');
  const rows = await db
    .select({
      name: cardCharacterMats.name,
      ancestry: cardCharacterMats.characterClass,
      handSize: cardCharacterMats.handSize,
      traits: cardCharacterMats.traits,
      hp: cardCharacterMats.hp,
      perks: cardCharacterMats.perks,
      masteries: cardCharacterMats.masteries,
    })
    .from(cardCharacterMats)
    .where(and(eq(cardCharacterMats.game, game), eq(cardCharacterMats.name, className)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    name: row.name,
    ancestry: row.ancestry,
    handSize: formatHandSize(row.handSize),
    traits: row.traits,
    hpByLevel: normalizeHpByLevel(row.hp),
    perks: row.perks,
    masteries: row.masteries,
  };
}

export async function listItemOptions(input: {
  campaignId: string;
  game: string;
  unlockedItems: readonly string[];
}): Promise<ItemOption[]> {
  return listItemCatalogOptions(input);
}

export async function listPersonalQuestOptions(input: {
  campaignId: string;
  game: string;
}): Promise<PersonalQuestOption[]> {
  return listPersonalQuestCatalogOptions(input);
}

export async function listCardOptionsForClass(
  game: string,
  className: string,
): Promise<CardOption[]> {
  const { db } = getDb('server');
  const rows = await db
    .select({
      sourceId: cardCharacterAbilities.sourceId,
      name: cardCharacterAbilities.cardName,
      level: cardCharacterAbilities.level,
    })
    .from(cardCharacterAbilities)
    .where(
      and(
        eq(cardCharacterAbilities.game, game),
        eq(cardCharacterAbilities.characterClass, className),
      ),
    )
    .orderBy(cardCharacterAbilities.cardName);
  return rows;
}

/** Display names for stored sourceIds — items and ability cards. */
export async function resolveCardDisplayNames(input: {
  game: string;
  itemSourceIds: string[];
  cardSourceIds: string[];
  personalQuestSourceIds?: string[];
}): Promise<{
  items: Map<string, ItemOption>;
  cards: Map<string, CardOption>;
  quests: Map<string, PersonalQuestOption>;
}> {
  const { db } = getDb('server');
  const items = new Map<string, ItemOption>();
  const cards = new Map<string, CardOption>();
  const quests = await resolvePersonalQuestNames({
    game: input.game,
    sourceIds: input.personalQuestSourceIds ?? [],
  });
  if (input.itemSourceIds.length > 0) {
    const rows = await db
      .select({ sourceId: cardItems.sourceId, number: cardItems.number, name: cardItems.name })
      .from(cardItems)
      .where(and(eq(cardItems.game, input.game), inArray(cardItems.sourceId, input.itemSourceIds)));
    for (const row of rows) items.set(row.sourceId, { ...row, status: 'available' });
  }
  if (input.cardSourceIds.length > 0) {
    const rows = await db
      .select({
        sourceId: cardCharacterAbilities.sourceId,
        name: cardCharacterAbilities.cardName,
        level: cardCharacterAbilities.level,
      })
      .from(cardCharacterAbilities)
      .where(
        and(
          eq(cardCharacterAbilities.game, input.game),
          inArray(cardCharacterAbilities.sourceId, input.cardSourceIds),
        ),
      );
    for (const row of rows) cards.set(row.sourceId, row);
  }
  return { items, cards, quests };
}
