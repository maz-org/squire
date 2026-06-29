/**
 * Structured character-state catalogs.
 *
 * Card data defines what exists. Campaign catalog rows define what this table
 * has made available, and character rows derive assignment state from the
 * selected source ids.
 */
import { and, eq, inArray } from 'drizzle-orm';

import type { DbOrTx } from '../auth/audit.ts';
import { getDb } from '../db.ts';
import * as CatalogRepository from '../db/repositories/character-catalog-repository.ts';
import type { CampaignCatalogEntry, CampaignCatalogStatus } from '../db/repositories/types.ts';
import {
  cardCharacterAbilities,
  cardCharacterMats,
  cardItems,
  cardPersonalQuests,
} from '../db/schema/cards.ts';
import { characters } from '../db/schema/campaigns.ts';

export class CharacterCatalogError extends Error {
  readonly code = 'invalid_character_catalog';

  constructor(message: string) {
    super(message);
    this.name = 'CharacterCatalogError';
  }
}

export const CATALOG_STATUSES = ['available', 'locked', 'unavailable'] as const;

export function isCatalogStatus(value: string): value is CampaignCatalogStatus {
  return (CATALOG_STATUSES as readonly string[]).includes(value);
}

export interface ItemCatalogOption {
  sourceId: string;
  number: string;
  name: string;
  status: CampaignCatalogStatus;
}

export interface PersonalQuestCatalogOption {
  sourceId: string;
  cardId: string;
  altId: string;
  name: string;
  status: CampaignCatalogStatus;
  assignedCharacterId: string | null;
}

function catalogMap(rows: CampaignCatalogEntry[]): Map<string, CampaignCatalogStatus> {
  return new Map(rows.map((row) => [row.sourceId, row.status]));
}

function unlockedItemStatus(
  unlockedItems: readonly string[],
  sourceId: string,
  number: string,
): CampaignCatalogStatus {
  return unlockedItems.includes(sourceId) || unlockedItems.includes(number)
    ? 'available'
    : 'locked';
}

export async function listItemCatalogOptions(input: {
  campaignId: string;
  game: string;
  unlockedItems: readonly string[];
}): Promise<ItemCatalogOption[]> {
  const { db } = getDb('server');
  const [items, catalog] = await Promise.all([
    db
      .select({ sourceId: cardItems.sourceId, number: cardItems.number, name: cardItems.name })
      .from(cardItems)
      .where(eq(cardItems.game, input.game))
      .orderBy(cardItems.number),
    CatalogRepository.listItemCatalog(db, input.campaignId),
  ]);
  const explicit = catalogMap(catalog);
  return items.map((item) => ({
    ...item,
    status:
      explicit.get(item.sourceId) ??
      unlockedItemStatus(input.unlockedItems, item.sourceId, item.number),
  }));
}

export async function listPersonalQuestCatalogOptions(input: {
  campaignId: string;
  game: string;
}): Promise<PersonalQuestCatalogOption[]> {
  const { db } = getDb('server');
  const [quests, catalog, assignments] = await Promise.all([
    db
      .select({
        sourceId: cardPersonalQuests.sourceId,
        cardId: cardPersonalQuests.cardId,
        altId: cardPersonalQuests.altId,
        name: cardPersonalQuests.name,
      })
      .from(cardPersonalQuests)
      .where(eq(cardPersonalQuests.game, input.game))
      .orderBy(cardPersonalQuests.cardId),
    CatalogRepository.listPersonalQuestCatalog(db, input.campaignId),
    db
      .select({ characterId: characters.id, sourceId: characters.personalQuestSourceId })
      .from(characters)
      .where(eq(characters.campaignId, input.campaignId)),
  ]);
  const explicit = catalogMap(catalog);
  const assigned = new Map(
    assignments
      .filter((row): row is { characterId: string; sourceId: string } => row.sourceId !== null)
      .map((row) => [row.sourceId, row.characterId]),
  );
  return quests.map((quest) => ({
    ...quest,
    status: explicit.get(quest.sourceId) ?? 'available',
    assignedCharacterId: assigned.get(quest.sourceId) ?? null,
  }));
}

export async function listAbilityCardSourceIds(input: {
  game: string;
  className: string;
}): Promise<Set<string>> {
  const { db } = getDb('server');
  const rows = await db
    .select({ sourceId: cardCharacterAbilities.sourceId })
    .from(cardCharacterAbilities)
    .where(
      and(
        eq(cardCharacterAbilities.game, input.game),
        eq(cardCharacterAbilities.characterClass, input.className),
      ),
    );
  return new Set(rows.map((row) => row.sourceId));
}

export async function perkCountForClass(input: {
  game: string;
  className: string;
}): Promise<number | null> {
  const { db } = getDb('server');
  const rows = await db
    .select({ perks: cardCharacterMats.perks })
    .from(cardCharacterMats)
    .where(and(eq(cardCharacterMats.game, input.game), eq(cardCharacterMats.name, input.className)))
    .limit(1);
  return rows[0]?.perks.length ?? null;
}

export async function masteryCountForClass(input: {
  game: string;
  className: string;
}): Promise<number | null> {
  const { db } = getDb('server');
  const rows = await db
    .select({ masteries: cardCharacterMats.masteries })
    .from(cardCharacterMats)
    .where(and(eq(cardCharacterMats.game, input.game), eq(cardCharacterMats.name, input.className)))
    .limit(1);
  return rows[0]?.masteries.length ?? null;
}

export async function assertItemSourceAvailable(input: {
  campaignId: string;
  game: string;
  unlockedItems: readonly string[];
  sourceId: string;
}): Promise<void> {
  const { db } = getDb('server');
  const rows = await db
    .select({ number: cardItems.number, name: cardItems.name })
    .from(cardItems)
    .where(and(eq(cardItems.game, input.game), eq(cardItems.sourceId, input.sourceId)))
    .limit(1);
  const item = rows[0];
  if (!item) throw new CharacterCatalogError('Item is not in this game catalog.');
  const explicit = await CatalogRepository.findItemStatus(db, input);
  const status = explicit ?? unlockedItemStatus(input.unlockedItems, input.sourceId, item.number);
  if (status !== 'available') {
    throw new CharacterCatalogError(`${item.name} is ${status} in this campaign item catalog.`);
  }
}

export async function assertAbilityCardSourceForClass(input: {
  game: string;
  className: string;
  sourceId: string;
}): Promise<void> {
  const allowed = await listAbilityCardSourceIds(input);
  if (!allowed.has(input.sourceId)) {
    throw new CharacterCatalogError('Ability card is not in this character class list.');
  }
}

export async function assertPersonalQuestAvailable(input: {
  handle?: DbOrTx;
  campaignId: string;
  game: string;
  sourceId: string;
  characterId: string;
}): Promise<void> {
  const db = input.handle ?? getDb('server').db;
  const rows = await db
    .select({ name: cardPersonalQuests.name })
    .from(cardPersonalQuests)
    .where(
      and(eq(cardPersonalQuests.game, input.game), eq(cardPersonalQuests.sourceId, input.sourceId)),
    )
    .limit(1);
  const quest = rows[0];
  if (!quest) throw new CharacterCatalogError('Personal quest is not in this game catalog.');
  const explicit = await CatalogRepository.findPersonalQuestStatus(db, input);
  const status = explicit ?? 'available';
  if (status !== 'available') {
    throw new CharacterCatalogError(`${quest.name} is ${status} in this campaign quest catalog.`);
  }
  const assigned = await db
    .select({ id: characters.id })
    .from(characters)
    .where(
      and(
        eq(characters.campaignId, input.campaignId),
        eq(characters.personalQuestSourceId, input.sourceId),
      ),
    );
  const owner = assigned.find((row) => row.id !== input.characterId);
  if (owner) throw new CharacterCatalogError(`${quest.name} is already assigned.`);
}

export async function assertPerkSelectionsValid(input: {
  game: string;
  className: string;
  perks: readonly number[];
}): Promise<void> {
  const count = await perkCountForClass(input);
  if (count === null) {
    if (input.perks.length > 0) {
      throw new CharacterCatalogError('Class perk list is not available for this character.');
    }
    return;
  }
  if (new Set(input.perks).size !== input.perks.length) {
    throw new CharacterCatalogError('Perk selections cannot contain duplicates.');
  }
  const invalid = input.perks.find((perk) => perk < 0 || perk >= count);
  if (invalid !== undefined) {
    throw new CharacterCatalogError(`Perk ${invalid + 1} is not on this class perk list.`);
  }
}

export async function assertMasterySelectionsValid(input: {
  game: string;
  className: string;
  masteries: readonly number[];
}): Promise<void> {
  const count = await masteryCountForClass(input);
  if (count === null) {
    if (input.masteries.length > 0) {
      throw new CharacterCatalogError('Class mastery list is not available for this character.');
    }
    return;
  }
  if (new Set(input.masteries).size !== input.masteries.length) {
    throw new CharacterCatalogError('Mastery selections cannot contain duplicates.');
  }
  const invalid = input.masteries.find((mastery) => mastery < 0 || mastery >= count);
  if (invalid !== undefined) {
    throw new CharacterCatalogError(`Mastery ${invalid + 1} is not on this class mastery list.`);
  }
}

export async function updateItemCatalogStatus(input: {
  campaignId: string;
  game: string;
  sourceId: string;
  status: CampaignCatalogStatus;
}): Promise<CampaignCatalogEntry> {
  const { db } = getDb('server');
  const rows = await db
    .select({ sourceId: cardItems.sourceId })
    .from(cardItems)
    .where(and(eq(cardItems.game, input.game), eq(cardItems.sourceId, input.sourceId)))
    .limit(1);
  if (!rows[0]) throw new CharacterCatalogError('Item is not in this game catalog.');
  return CatalogRepository.upsertItemStatus(db, input);
}

export async function updatePersonalQuestCatalogStatus(input: {
  campaignId: string;
  game: string;
  sourceId: string;
  status: CampaignCatalogStatus;
}): Promise<CampaignCatalogEntry> {
  const { db } = getDb('server');
  const rows = await db
    .select({ sourceId: cardPersonalQuests.sourceId })
    .from(cardPersonalQuests)
    .where(
      and(eq(cardPersonalQuests.game, input.game), eq(cardPersonalQuests.sourceId, input.sourceId)),
    )
    .limit(1);
  if (!rows[0]) throw new CharacterCatalogError('Personal quest is not in this game catalog.');
  return CatalogRepository.upsertPersonalQuestStatus(db, input);
}

export async function resolvePersonalQuestNames(input: {
  game: string;
  sourceIds: string[];
}): Promise<Map<string, PersonalQuestCatalogOption>> {
  const { db } = getDb('server');
  const names = new Map<string, PersonalQuestCatalogOption>();
  if (input.sourceIds.length === 0) return names;
  const rows = await db
    .select({
      sourceId: cardPersonalQuests.sourceId,
      cardId: cardPersonalQuests.cardId,
      altId: cardPersonalQuests.altId,
      name: cardPersonalQuests.name,
    })
    .from(cardPersonalQuests)
    .where(
      and(
        eq(cardPersonalQuests.game, input.game),
        inArray(cardPersonalQuests.sourceId, input.sourceIds),
      ),
    );
  for (const row of rows) {
    names.set(row.sourceId, { ...row, status: 'available', assignedCharacterId: null });
  }
  return names;
}
