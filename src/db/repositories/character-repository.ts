/**
 * Character repository (Phase 4, SQR-18).
 *
 * The visibility tiers from ADR 0021 are enforced at the type level here:
 * owner-facing reads return `Character` (private tier included); everything
 * member-facing goes through `toMemberVisible`, whose return type simply has
 * no private fields. There is deliberately NO function that returns another
 * member's private tier — context assembly (SQR-19) and API serializers
 * (SQR-22) build on these projections rather than filtering after the fact.
 */
import { and, eq, sql } from 'drizzle-orm';

import { getDb } from '../../db.ts';
import type { DbOrTx } from '../../auth/audit.ts';
import { deriveCharacterLevel } from '../../campaign/character-level.ts';
import {
  campaignMembers,
  characterCards,
  characterItems,
  characters,
} from '../schema/campaigns.ts';
import {
  VersionConflictError,
  type Character,
  type CharacterCard,
  type CharacterCardRole,
  type CharacterItem,
  type CharacterStatus,
  type CreateCharacterInput,
  type MemberVisibleCharacter,
  type UpdateCharacterInput,
} from './types.ts';

type CharacterRow = typeof characters.$inferSelect;
type ItemRow = typeof characterItems.$inferSelect;
type CardRow = typeof characterCards.$inferSelect;

function toDomain(row: CharacterRow): Character {
  return {
    id: row.id,
    campaignId: row.campaignId,
    ownerUserId: row.ownerUserId,
    placeholderForEmail: row.placeholderForEmail,
    name: row.name,
    className: row.className,
    level: deriveCharacterLevel('squire', row.xp),
    xp: row.xp,
    gold: row.gold,
    perks: row.perks,
    personalQuestSourceId: row.personalQuestSourceId,
    privateNotes: row.privateNotes,
    status: row.status as CharacterStatus,
    successorId: row.successorId,
    version: row.version,
    externalRef: row.externalRef,
    sourceAuthority: row.sourceAuthority,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMemberVisible(row: CharacterRow): MemberVisibleCharacter {
  return {
    id: row.id,
    campaignId: row.campaignId,
    ownerUserId: row.ownerUserId,
    placeholderForEmail: row.placeholderForEmail,
    name: row.name,
    className: row.className,
    level: deriveCharacterLevel('squire', row.xp),
    xp: row.xp,
    gold: row.gold,
    perks: row.perks,
    status: row.status as CharacterStatus,
    successorId: row.successorId,
    version: row.version,
    externalRef: row.externalRef,
    sourceAuthority: row.sourceAuthority,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toItem(row: ItemRow): CharacterItem {
  return {
    id: row.id,
    characterId: row.characterId,
    game: row.game,
    sourceId: row.sourceId,
    createdAt: row.createdAt,
  };
}

function toCard(row: CardRow): CharacterCard {
  return {
    id: row.id,
    characterId: row.characterId,
    game: row.game,
    sourceId: row.sourceId,
    role: row.role as CharacterCardRole,
    createdAt: row.createdAt,
  };
}

/** Owner-facing read: private tier included only when the caller owns the row. */
export async function findOwnedById(
  characterId: string,
  ownerUserId: string,
): Promise<Character | null> {
  const { db } = getDb('server');
  const rows = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, characterId), eq(characters.ownerUserId, ownerUserId)))
    .limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

/** Member-facing read: the private tier is absent at the type level. */
export async function findMemberVisibleById(
  characterId: string,
): Promise<MemberVisibleCharacter | null> {
  const { db } = getDb('server');
  const rows = await db.select().from(characters).where(eq(characters.id, characterId)).limit(1);
  return rows[0] ? toMemberVisible(rows[0]) : null;
}

export async function listMemberVisibleByCampaign(
  campaignId: string,
): Promise<MemberVisibleCharacter[]> {
  const { db } = getDb('server');
  const rows = await db
    .select()
    .from(characters)
    .where(eq(characters.campaignId, campaignId))
    .orderBy(characters.createdAt);
  return rows.map(toMemberVisible);
}

/**
 * The active roster (class + level) for character-gated scenario availability
 * (GH2e solo). Only active characters count — a retired/departed character
 * re-locks its solo on the next recompute (live gating). "Drops out" covers
 * both retiring the character AND the owning member departing — a departed
 * member's still-`active` character row must not keep a solo unlocked, so we
 * join through `campaign_members` and require the owner to be active too.
 */
export async function listActiveRosterByCampaign(
  campaignId: string,
): Promise<{ className: string; level: number }[]> {
  const { db } = getDb('server');
  const rows = await db
    .select({ className: characters.className, xp: characters.xp })
    .from(characters)
    .innerJoin(
      campaignMembers,
      and(
        eq(campaignMembers.campaignId, characters.campaignId),
        eq(campaignMembers.userId, characters.ownerUserId),
      ),
    )
    .where(
      and(
        eq(characters.campaignId, campaignId),
        eq(characters.status, 'active'),
        eq(campaignMembers.status, 'active'),
      ),
    );
  return rows.map((row) => ({
    className: row.className,
    level: deriveCharacterLevel('squire', row.xp),
  }));
}

export async function listOwnedByCampaign(
  campaignId: string,
  ownerUserId: string,
): Promise<Character[]> {
  const { db } = getDb('server');
  const rows = await db
    .select()
    .from(characters)
    .where(and(eq(characters.campaignId, campaignId), eq(characters.ownerUserId, ownerUserId)))
    .orderBy(characters.createdAt);
  return rows.map(toDomain);
}

export async function create(handle: DbOrTx, input: CreateCharacterInput): Promise<Character> {
  const xp = input.xp ?? 0;
  const [row] = await handle
    .insert(characters)
    .values({
      campaignId: input.campaignId,
      ownerUserId: input.ownerUserId,
      placeholderForEmail: input.placeholderForEmail ?? null,
      name: input.name,
      className: input.className,
      level: deriveCharacterLevel('squire', xp),
      xp,
      gold: input.gold ?? 0,
      perks: input.perks ?? [],
      personalQuestSourceId: input.personalQuestSourceId ?? null,
      privateNotes: input.privateNotes ?? null,
    })
    .returning();
  return toDomain(row);
}

/** Optimistic CAS update (E3) — zero affected rows throws VersionConflictError. */
export async function update(
  handle: DbOrTx,
  characterId: string,
  input: UpdateCharacterInput,
): Promise<Character> {
  const { expectedVersion, ...patch } = input;
  const persistencePatch = {
    ...patch,
    ...(patch.xp !== undefined ? { level: deriveCharacterLevel('squire', patch.xp) } : {}),
  };
  const [row] = await handle
    .update(characters)
    .set({
      ...persistencePatch,
      version: sql`${characters.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(characters.id, characterId), eq(characters.version, expectedVersion)))
    .returning();
  if (!row) {
    throw new VersionConflictError(characterId);
  }
  return toDomain(row);
}

/**
 * Claim a placeholder: ownership transfers to the claimant and the
 * placeholder marker clears, unlocking the private tier for the new owner
 * (ADR 0021 §Placeholder characters). Guarded on the email the placeholder
 * names so only the invited member can claim it.
 */
export async function claimPlaceholder(
  handle: DbOrTx,
  characterId: string,
  input: { claimantUserId: string; claimantEmail: string },
): Promise<Character | null> {
  const [row] = await handle
    .update(characters)
    .set({
      ownerUserId: input.claimantUserId,
      placeholderForEmail: null,
      version: sql`${characters.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(eq(characters.id, characterId), eq(characters.placeholderForEmail, input.claimantEmail)),
    )
    .returning();
  return row ? toDomain(row) : null;
}

export async function remove(handle: DbOrTx, characterId: string): Promise<boolean> {
  const deleted = await handle
    .delete(characters)
    .where(eq(characters.id, characterId))
    .returning({ id: characters.id });
  return deleted.length > 0;
}

// ─── Items / cards (soft (game, source_id) references to GHS data) ──────────

export async function listItems(characterId: string): Promise<CharacterItem[]> {
  const { db } = getDb('server');
  const rows = await db
    .select()
    .from(characterItems)
    .where(eq(characterItems.characterId, characterId))
    .orderBy(characterItems.createdAt);
  return rows.map(toItem);
}

export async function addItem(
  handle: DbOrTx,
  input: { characterId: string; game: string; sourceId: string },
): Promise<CharacterItem> {
  const [row] = await handle.insert(characterItems).values(input).returning();
  return toItem(row);
}

export async function removeItem(
  handle: DbOrTx,
  characterId: string,
  itemId: string,
): Promise<boolean> {
  const deleted = await handle
    .delete(characterItems)
    .where(and(eq(characterItems.id, itemId), eq(characterItems.characterId, characterId)))
    .returning({ id: characterItems.id });
  return deleted.length > 0;
}

export async function listCards(characterId: string): Promise<CharacterCard[]> {
  const { db } = getDb('server');
  const rows = await db
    .select()
    .from(characterCards)
    .where(eq(characterCards.characterId, characterId))
    .orderBy(characterCards.createdAt);
  return rows.map(toCard);
}

export async function addCard(
  handle: DbOrTx,
  input: { characterId: string; game: string; sourceId: string; role?: CharacterCardRole },
): Promise<CharacterCard> {
  const [row] = await handle
    .insert(characterCards)
    .values({ ...input, role: input.role ?? 'owned' })
    .returning();
  return toCard(row);
}

export async function setCardRole(
  handle: DbOrTx,
  characterId: string,
  cardId: string,
  role: CharacterCardRole,
): Promise<boolean> {
  const updated = await handle
    .update(characterCards)
    .set({ role })
    .where(and(eq(characterCards.id, cardId), eq(characterCards.characterId, characterId)))
    .returning({ id: characterCards.id });
  return updated.length > 0;
}

export async function removeCard(
  handle: DbOrTx,
  characterId: string,
  cardId: string,
): Promise<boolean> {
  const deleted = await handle
    .delete(characterCards)
    .where(and(eq(characterCards.id, cardId), eq(characterCards.characterId, characterId)))
    .returning({ id: characterCards.id });
  return deleted.length > 0;
}
