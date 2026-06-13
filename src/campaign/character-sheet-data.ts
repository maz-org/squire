/**
 * GHS-data lookups for the accordion character sheet (SQR-277): autocomplete
 * option lists and sourceId resolution for the items/cards sections. Reads
 * the existing card tables — game-scoped, class-scoped for abilities.
 */
import { and, eq, inArray } from 'drizzle-orm';

import { getDb } from '../db.ts';
import { cardCharacterAbilities, cardItems } from '../db/schema/cards.ts';

export interface ItemOption {
  sourceId: string;
  number: string;
  name: string;
}

export interface CardOption {
  sourceId: string;
  name: string;
  level: string | null;
}

export async function listItemOptions(game: string): Promise<ItemOption[]> {
  const { db } = getDb('server');
  const rows = await db
    .select({ sourceId: cardItems.sourceId, number: cardItems.number, name: cardItems.name })
    .from(cardItems)
    .where(eq(cardItems.game, game))
    .orderBy(cardItems.number);
  return rows;
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

/** Resolve an item-add form value (the printed item number) to its card. */
export async function findItemByNumber(game: string, number: string): Promise<ItemOption | null> {
  const { db } = getDb('server');
  const trimmed = number.trim();
  // GHS numbers are zero-padded text ('099'); accept both '99' and '099'.
  const padded = trimmed.padStart(3, '0');
  const rows = await db
    .select({ sourceId: cardItems.sourceId, number: cardItems.number, name: cardItems.name })
    .from(cardItems)
    .where(and(eq(cardItems.game, game), inArray(cardItems.number, [trimmed, padded])))
    .limit(1);
  return rows[0] ?? null;
}

/** Resolve a card-add form value (the card name) within the class pool. */
export async function findCardByName(
  game: string,
  className: string,
  name: string,
): Promise<CardOption | null> {
  const options = await listCardOptionsForClass(game, className);
  const trimmed = name.trim().toLowerCase();
  return options.find((option) => option.name.toLowerCase() === trimmed) ?? null;
}

/** Display names for stored sourceIds — items and ability cards. */
export async function resolveCardDisplayNames(input: {
  game: string;
  itemSourceIds: string[];
  cardSourceIds: string[];
}): Promise<{
  items: Map<string, ItemOption>;
  cards: Map<string, CardOption>;
}> {
  const { db } = getDb('server');
  const items = new Map<string, ItemOption>();
  const cards = new Map<string, CardOption>();
  if (input.itemSourceIds.length > 0) {
    const rows = await db
      .select({ sourceId: cardItems.sourceId, number: cardItems.number, name: cardItems.name })
      .from(cardItems)
      .where(and(eq(cardItems.game, input.game), inArray(cardItems.sourceId, input.itemSourceIds)));
    for (const row of rows) items.set(row.sourceId, row);
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
  return { items, cards };
}
