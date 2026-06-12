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
import { getDb } from '../db.ts';
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
  // Key presence, not value: even an explicit null is an attempt to record
  // a private-tier field on a placeholder (ADR 0021).
  return 'personalQuest' in input || 'battleGoals' in input || 'privateNotes' in input;
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
  const member = await requireActiveMember(campaignId, identity.userId);
  const { db } = getDb('server');

  if (input.placeholderForEmail !== undefined) {
    if (member.role !== 'owner') {
      throw new CampaignForbiddenError('Only the owner can create placeholder characters');
    }
    if (hasPrivateFields(input)) throw new PlaceholderPrivateFieldsError();
    const email = input.placeholderForEmail.trim().toLowerCase();
    const members = await CampaignMemberRepository.listMembers(campaignId);
    const invitee = members.find(
      (m) => m.inviteEmail.toLowerCase() === email && m.status === 'invited',
    );
    if (!invitee) {
      throw new CampaignForbiddenError('Placeholders need a pending invite for that email');
    }
    return CharacterRepository.create(db, {
      ...input,
      campaignId,
      ownerUserId: identity.userId,
      placeholderForEmail: email,
    });
  }

  return CharacterRepository.create(db, {
    ...input,
    campaignId,
    ownerUserId: identity.userId,
    placeholderForEmail: null,
  });
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
  let own = visible.ownerUserId === identity.userId;
  let character: Character | MemberVisibleCharacter | null = own
    ? await CharacterRepository.findOwnedById(characterId, identity.userId)
    : visible;
  if (!character) {
    // Ownership moved between the two reads (a placeholder claim won the
    // race). The character is still visible — downgrade to the shared
    // projection instead of a false 404.
    character = await CharacterRepository.findMemberVisibleById(characterId);
    own = false;
  }
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
  const character = await requireOwnedCharacter(identity, characterId);
  if (character.placeholderForEmail !== null && hasPrivateFields(input)) {
    throw new PlaceholderPrivateFieldsError();
  }
  const { db } = getDb('server');
  return CharacterRepository.update(db, characterId, input);
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
  await requireOwnedCharacter(identity, characterId);
  const { db } = getDb('server');
  await CharacterRepository.remove(db, characterId);
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
  await requireVisibleCharacter(identity, characterId);
  const user = await requireUser(identity.userId);
  const { db } = getDb('server');
  const claimed = await CharacterRepository.claimPlaceholder(db, characterId, {
    claimantUserId: user.id,
    claimantEmail: user.email.toLowerCase(),
  });
  if (!claimed) throw new CampaignNotFoundError();
  return claimed;
}

// ─── Items / cards (owner-scoped writes; reads ride the detail view) ────────

/** Items/cards are tagged with the campaign's game for GHS joins (E4). */
async function campaignGameFor(campaignId: string): Promise<string> {
  const campaign = await CampaignRepository.findById(campaignId);
  if (!campaign) throw new CampaignNotFoundError();
  return campaign.game;
}

export async function addItem(
  identity: CallerIdentity,
  characterId: string,
  sourceId: string,
): Promise<CharacterItem> {
  const character = await requireOwnedCharacter(identity, characterId);
  const { db } = getDb('server');
  return CharacterRepository.addItem(db, {
    characterId,
    game: await campaignGameFor(character.campaignId),
    sourceId,
  });
}

export async function removeItem(
  identity: CallerIdentity,
  characterId: string,
  itemId: string,
): Promise<void> {
  await requireOwnedCharacter(identity, characterId);
  const { db } = getDb('server');
  const removed = await CharacterRepository.removeItem(db, characterId, itemId);
  if (!removed) throw new CampaignNotFoundError();
}

export async function addCard(
  identity: CallerIdentity,
  characterId: string,
  input: { sourceId: string; role?: CharacterCardRole },
): Promise<CharacterCard> {
  const character = await requireOwnedCharacter(identity, characterId);
  const { db } = getDb('server');
  return CharacterRepository.addCard(db, {
    characterId,
    game: await campaignGameFor(character.campaignId),
    sourceId: input.sourceId,
    role: input.role,
  });
}

export async function setCardRole(
  identity: CallerIdentity,
  characterId: string,
  cardId: string,
  role: CharacterCardRole,
): Promise<void> {
  await requireOwnedCharacter(identity, characterId);
  const { db } = getDb('server');
  const updated = await CharacterRepository.setCardRole(db, characterId, cardId, role);
  if (!updated) throw new CampaignNotFoundError();
}

export async function removeCard(
  identity: CallerIdentity,
  characterId: string,
  cardId: string,
): Promise<void> {
  await requireOwnedCharacter(identity, characterId);
  const { db } = getDb('server');
  const removed = await CharacterRepository.removeCard(db, characterId, cardId);
  if (!removed) throw new CampaignNotFoundError();
}
