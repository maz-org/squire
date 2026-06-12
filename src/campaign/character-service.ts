/**
 * Character service (Phase 4, SQR-22).
 *
 * Per-member character management under the ADR 0021 contract: any active
 * campaign member may SEE every character (member-visible projection — the
 * private tier is absent at the type level, never nulled), but only the
 * owning member mutates one. Placeholders (characters created for an
 * invitee) are owned by their creator until the named member joins and
 * claims them; they can never carry private-tier fields.
 *
 * Reuses the campaign service's typed errors: a character id the caller
 * cannot see (wrong campaign, no membership, absent) is the same
 * indistinguishable `CampaignNotFoundError`; a visible character the caller
 * cannot mutate is `CampaignForbiddenError`.
 */
import type { DbOrTx } from '../auth/audit.ts';
import * as CampaignRepository from '../db/repositories/campaign-repository.ts';
import * as CampaignMemberRepository from '../db/repositories/campaign-member-repository.ts';
import * as CharacterRepository from '../db/repositories/character-repository.ts';
import type {
  Character,
  CharacterCard,
  CharacterCardRole,
  CharacterItem,
  MemberVisibleCharacter,
  UpdateCharacterInput,
} from '../db/repositories/types.ts';
import { auditedMutation } from './audit.ts';
import {
  CampaignForbiddenError,
  CampaignNotFoundError,
  requireActiveMember,
  requireUser,
} from './campaign-service.ts';
import type { CallerIdentity } from './identity.ts';

/** Private-tier fields cannot be recorded on a placeholder (ADR 0021). */
export class PlaceholderPrivateFieldsError extends Error {
  readonly code = 'placeholder_private_fields';

  constructor() {
    super('Placeholder characters cannot carry private fields until claimed');
    this.name = 'PlaceholderPrivateFieldsError';
  }
}

export interface CreateCharacterRequest {
  name: string;
  className: string;
  level?: number;
  xp?: number;
  gold?: number;
  perks?: number[];
  personalQuest?: string | null;
  battleGoals?: string | null;
  privateNotes?: string | null;
  /** Owner-only: create a claimable placeholder for a pending invitee. */
  placeholderForEmail?: string;
}

export interface CharacterDetail {
  /** Full `Character` for the owner; the projection for everyone else. */
  character: Character | MemberVisibleCharacter;
  items: CharacterItem[];
  cards: CharacterCard[];
  own: boolean;
}

function hasPrivateFields(input: {
  personalQuest?: string | null;
  battleGoals?: string | null;
  privateNotes?: string | null;
}): boolean {
  return input.personalQuest != null || input.battleGoals != null || input.privateNotes != null;
}

/**
 * Visibility gate: the character must exist AND the caller must be an
 * active member of its campaign — otherwise the indistinguishable 404.
 * Returns the member-visible projection; owner-facing paths re-read with
 * the private tier afterwards.
 */
async function requireVisibleCharacter(
  identity: CallerIdentity,
  characterId: string,
): Promise<MemberVisibleCharacter> {
  const character = await CharacterRepository.findMemberVisibleById(characterId);
  if (!character) throw new CampaignNotFoundError();
  await requireActiveMember(character.campaignId, identity.userId);
  return character;
}

async function requireOwnedCharacter(
  identity: CallerIdentity,
  characterId: string,
): Promise<MemberVisibleCharacter> {
  const character = await requireVisibleCharacter(identity, characterId);
  if (character.ownerUserId !== identity.userId) {
    throw new CampaignForbiddenError('Only the owning member can modify a character');
  }
  return character;
}

export async function createCharacter(
  identity: CallerIdentity,
  campaignId: string,
  input: CreateCharacterRequest,
): Promise<Character> {
  return auditedMutation(
    identity,
    { campaignId, mutationType: 'character.create', entityType: 'character' },
    async (tx) => {
      const member = await requireActiveMember(campaignId, identity.userId);

      let placeholderForEmail: string | null = null;
      if (input.placeholderForEmail !== undefined) {
        if (member.role !== 'owner') {
          throw new CampaignForbiddenError('Only the owner can create placeholder characters');
        }
        if (hasPrivateFields(input)) throw new PlaceholderPrivateFieldsError();
        placeholderForEmail = input.placeholderForEmail.trim().toLowerCase();
        const members = await CampaignMemberRepository.listMembers(campaignId);
        const invitee = members.find(
          (m) => m.inviteEmail.toLowerCase() === placeholderForEmail && m.status === 'invited',
        );
        if (!invitee) {
          throw new CampaignForbiddenError('Placeholders need a pending invite for that email');
        }
      }

      const character = await CharacterRepository.create(tx, {
        ...input,
        campaignId,
        ownerUserId: identity.userId,
        placeholderForEmail,
      });
      return {
        result: character,
        entityId: character.id,
        payloadAfter: {
          name: character.name,
          className: character.className,
          level: character.level,
          placeholderForEmail: character.placeholderForEmail,
        },
      };
    },
  );
}

/** Uniform roster surface: member-visible projections for everyone. */
export async function listCampaignCharacters(
  identity: CallerIdentity,
  campaignId: string,
): Promise<MemberVisibleCharacter[]> {
  await requireActiveMember(campaignId, identity.userId);
  return CharacterRepository.listMemberVisibleByCampaign(campaignId);
}

export async function getCharacterDetail(
  identity: CallerIdentity,
  characterId: string,
): Promise<CharacterDetail> {
  const visible = await requireVisibleCharacter(identity, characterId);
  const own = visible.ownerUserId === identity.userId;
  const character = own
    ? await CharacterRepository.findOwnedById(characterId, identity.userId)
    : visible;
  if (!character) throw new CampaignNotFoundError();
  return {
    character,
    items: await CharacterRepository.listItems(characterId),
    cards: await CharacterRepository.listCards(characterId),
    own,
  };
}

/**
 * Owner-scoped CAS update (E3). Retirement (`status`/`successorId`) is
 * modeled here per the matrix; the guided retirement flow is deferred
 * (SQR-289) and the destructive gating arrives with the proposal mechanism.
 * TODO(SQR-279): route retirement through propose→confirm.
 */
export async function updateCharacter(
  identity: CallerIdentity,
  characterId: string,
  input: UpdateCharacterInput,
): Promise<Character> {
  // The visibility gate runs once outside the audit wrapper to resolve the
  // campaign id for rejected-row attribution; the wrapper re-runs the
  // ownership check inside the transaction.
  const visible = await requireVisibleCharacter(identity, characterId);
  return auditedMutation(
    identity,
    {
      campaignId: visible.campaignId,
      mutationType: 'character.update',
      entityType: 'character',
      entityId: characterId,
    },
    async (tx) => {
      await requireOwnedCharacter(identity, characterId);
      // Owner-facing read for the before payload: private-field changes
      // need their previous values in the audit row (journal redacts).
      const before = await CharacterRepository.findOwnedById(characterId, identity.userId);
      if (!before) throw new CampaignNotFoundError();
      if (before.placeholderForEmail !== null && hasPrivateFields(input)) {
        throw new PlaceholderPrivateFieldsError();
      }
      const updated = await CharacterRepository.update(tx, characterId, input);

      const changedKeys = Object.keys(input).filter((key) => key !== 'expectedVersion');
      const pick = (source: Record<string, unknown>) =>
        Object.fromEntries(changedKeys.map((key) => [key, source[key]]));
      return {
        result: updated,
        payloadBefore: pick(before as unknown as Record<string, unknown>),
        payloadAfter: pick(updated as unknown as Record<string, unknown>),
      };
    },
  );
}

/**
 * Owner-scoped delete. Unclaimed placeholders are scratch data; deleting a
 * real character is destructive per the matrix.
 * TODO(SQR-279): route non-placeholder deletes through propose→confirm.
 */
export async function deleteCharacter(
  identity: CallerIdentity,
  characterId: string,
): Promise<void> {
  const visible = await requireVisibleCharacter(identity, characterId);
  await auditedMutation(
    identity,
    {
      campaignId: visible.campaignId,
      mutationType: 'character.delete',
      entityType: 'character',
      entityId: characterId,
    },
    async (tx) => {
      const character = await requireOwnedCharacter(identity, characterId);
      await CharacterRepository.remove(tx, characterId);
      return {
        result: undefined,
        payloadBefore: {
          name: character.name,
          className: character.className,
          level: character.level,
          placeholderForEmail: character.placeholderForEmail,
        },
      };
    },
  );
}

/**
 * Claim a placeholder after joining: ownership transfers and the private
 * tier unlocks for the new owner. The repository guards the write on the
 * placeholder's named email, so a wrong claimant sees the same 404 as an
 * absent character.
 */
export async function claimCharacter(
  identity: CallerIdentity,
  characterId: string,
): Promise<Character> {
  const visible = await requireVisibleCharacter(identity, characterId);
  const user = await requireUser(identity.userId);
  return auditedMutation(
    identity,
    {
      campaignId: visible.campaignId,
      mutationType: 'character.claim',
      entityType: 'character',
      entityId: characterId,
    },
    async (tx) => {
      const claimed = await CharacterRepository.claimPlaceholder(tx, characterId, {
        claimantUserId: user.id,
        claimantEmail: user.email.toLowerCase(),
      });
      if (!claimed) throw new CampaignNotFoundError();
      return {
        result: claimed,
        payloadBefore: {
          ownerUserId: visible.ownerUserId,
          placeholderForEmail: visible.placeholderForEmail,
        },
        payloadAfter: { ownerUserId: claimed.ownerUserId, placeholderForEmail: null },
      };
    },
  );
}

// ─── Items / cards (owner-scoped writes; reads ride the detail view) ────────

/** Items/cards are tagged with the campaign's game for GHS joins (E4). */
async function campaignGameFor(campaignId: string): Promise<string> {
  const campaign = await CampaignRepository.findById(campaignId);
  if (!campaign) throw new CampaignNotFoundError();
  return campaign.game;
}

/** Shared shape for the small owner-scoped item/card mutations. */
async function auditedChildMutation<T>(
  identity: CallerIdentity,
  characterId: string,
  meta: { mutationType: string; entityType: string },
  fn: (
    tx: DbOrTx,
    character: MemberVisibleCharacter,
  ) => Promise<{ result: T; payload: Record<string, unknown> }>,
): Promise<T> {
  const visible = await requireVisibleCharacter(identity, characterId);
  return auditedMutation(
    identity,
    { campaignId: visible.campaignId, ...meta, entityId: characterId },
    async (tx) => {
      const character = await requireOwnedCharacter(identity, characterId);
      const { result, payload } = await fn(tx, character);
      return { result, payloadAfter: payload };
    },
  );
}

export async function addItem(
  identity: CallerIdentity,
  characterId: string,
  sourceId: string,
): Promise<CharacterItem> {
  return auditedChildMutation(
    identity,
    characterId,
    { mutationType: 'character.add_item', entityType: 'character_item' },
    async (tx, character) => {
      const item = await CharacterRepository.addItem(tx, {
        characterId,
        game: await campaignGameFor(character.campaignId),
        sourceId,
      });
      return { result: item, payload: { sourceId: item.sourceId, game: item.game } };
    },
  );
}

export async function removeItem(
  identity: CallerIdentity,
  characterId: string,
  itemId: string,
): Promise<void> {
  await auditedChildMutation(
    identity,
    characterId,
    { mutationType: 'character.remove_item', entityType: 'character_item' },
    async (tx) => {
      const removed = await CharacterRepository.removeItem(tx, characterId, itemId);
      if (!removed) throw new CampaignNotFoundError();
      return { result: undefined, payload: { itemId } };
    },
  );
}

export async function addCard(
  identity: CallerIdentity,
  characterId: string,
  input: { sourceId: string; role?: CharacterCardRole },
): Promise<CharacterCard> {
  return auditedChildMutation(
    identity,
    characterId,
    { mutationType: 'character.add_card', entityType: 'character_card' },
    async (tx, character) => {
      const card = await CharacterRepository.addCard(tx, {
        characterId,
        game: await campaignGameFor(character.campaignId),
        sourceId: input.sourceId,
        role: input.role,
      });
      return {
        result: card,
        payload: { sourceId: card.sourceId, game: card.game, role: card.role },
      };
    },
  );
}

export async function setCardRole(
  identity: CallerIdentity,
  characterId: string,
  cardId: string,
  role: CharacterCardRole,
): Promise<void> {
  await auditedChildMutation(
    identity,
    characterId,
    { mutationType: 'character.set_card_role', entityType: 'character_card' },
    async (tx) => {
      const updated = await CharacterRepository.setCardRole(tx, characterId, cardId, role);
      if (!updated) throw new CampaignNotFoundError();
      return { result: undefined, payload: { cardId, role } };
    },
  );
}

export async function removeCard(
  identity: CallerIdentity,
  characterId: string,
  cardId: string,
): Promise<void> {
  await auditedChildMutation(
    identity,
    characterId,
    { mutationType: 'character.remove_card', entityType: 'character_card' },
    async (tx) => {
      const removed = await CharacterRepository.removeCard(tx, characterId, cardId);
      if (!removed) throw new CampaignNotFoundError();
      return { result: undefined, payload: { cardId } };
    },
  );
}
