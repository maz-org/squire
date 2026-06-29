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
  ProposalRequiredError,
  requireActiveMember,
  requireUser,
  type ConfirmedExecution,
} from './campaign-service.ts';
import {
  CharacterCatalogError,
  assertAbilityCardSourceForClass,
  assertItemSourceAvailable,
  assertMasterySelectionsValid,
  assertPerkSelectionsValid,
  assertPersonalQuestAvailable,
} from './character-catalog.ts';
import { maxPerkMarksForGame } from './character-progression.ts';
import { checkClassName, knownClassNames } from './class-validation.ts';
import type { CallerIdentity } from './identity.ts';

/** Private-tier fields cannot be recorded on a placeholder (ADR 0021). */
export class PlaceholderPrivateFieldsError extends Error {
  readonly code = 'placeholder_private_fields';

  constructor() {
    super('Placeholder characters cannot carry private fields until claimed');
    this.name = 'PlaceholderPrivateFieldsError';
  }
}

export class CharacterStateValidationError extends Error {
  readonly code = 'invalid_character_state';

  constructor(message: string) {
    super(message);
    this.name = 'CharacterStateValidationError';
  }
}

export interface CreateCharacterRequest {
  name: string;
  className: string;
  allowHomebrewClass?: boolean;
  xp?: number;
  gold?: number;
  perks?: number[];
  perkMarks?: number;
  masteries?: number[];
  personalQuestSourceId?: string | null;
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
  personalQuestSourceId?: string | null;
  privateNotes?: string | null;
}): boolean {
  // Explicit null and any defined private-tier value are attempts to record a
  // private field on a placeholder; undefined is equivalent to omission.
  return input.personalQuestSourceId !== undefined || input.privateNotes !== undefined;
}

function stateValidation(error: CharacterCatalogError): CharacterStateValidationError {
  return new CharacterStateValidationError(error.message);
}

function isPersonalQuestAssignmentConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505' &&
    'constraint' in error &&
    (error as { constraint?: unknown }).constraint ===
      'characters_campaign_personal_quest_source_idx'
  );
}

function mapCharacterWriteError(error: unknown): never {
  if (isPersonalQuestAssignmentConflict(error)) {
    throw new CharacterStateValidationError('Personal quest is already assigned.');
  }
  throw error;
}

function assertPerkMarksValid(game: string, perkMarks: number): void {
  if (!Number.isInteger(perkMarks) || perkMarks < 0) {
    throw new CharacterStateValidationError('Perk marks must be a whole number.');
  }
  const max = maxPerkMarksForGame(game);
  if (perkMarks > max) {
    throw new CharacterStateValidationError(`Perk marks cannot exceed ${max} for this game.`);
  }
}

function assertXpValid(xp: number): void {
  if (!Number.isInteger(xp) || xp < 0 || xp > 999) {
    throw new CharacterStateValidationError('XP must be a whole number from 0 to 999.');
  }
}

function assertGoldValid(gold: number): void {
  if (!Number.isInteger(gold) || gold < 0) {
    throw new CharacterStateValidationError('Gold must be a whole number.');
  }
}

async function campaignFor(campaignId: string) {
  const campaign = await CampaignRepository.findById(campaignId);
  if (!campaign) throw new CampaignNotFoundError();
  return campaign;
}

function invalidClassNameMessage(input: string, check: ReturnType<typeof checkClassName>): string {
  if (check.ok) return '';
  return check.suggestion
    ? `Unknown class "${input}". Did you mean ${check.suggestion}?`
    : `"${input}" is not a class in this game.`;
}

async function validateClassName(input: {
  game: string;
  className: string;
  allowHomebrewClass?: boolean;
}): Promise<string> {
  const check = checkClassName(input.className, await knownClassNames(input.game));
  if (check.ok) return check.canonical;
  if (input.allowHomebrewClass) return input.className.trim();
  throw new CharacterStateValidationError(invalidClassNameMessage(input.className, check));
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
      const campaign = await campaignFor(campaignId);
      const className = await validateClassName({
        game: campaign.game,
        className: input.className,
        allowHomebrewClass: input.allowHomebrewClass,
      });
      if (input.xp !== undefined) assertXpValid(input.xp);
      if (input.gold !== undefined) assertGoldValid(input.gold);
      try {
        if (input.perks !== undefined) {
          await assertPerkSelectionsValid({
            game: campaign.game,
            className,
            perks: input.perks,
          });
        }
        if (input.perkMarks !== undefined) {
          assertPerkMarksValid(campaign.game, input.perkMarks);
        }
        if (input.masteries !== undefined) {
          await assertMasterySelectionsValid({
            game: campaign.game,
            className,
            masteries: input.masteries,
          });
        }
        if (input.personalQuestSourceId) {
          // The row does not exist yet, so assignment exclusion can use a
          // never-matching UUID.
          await assertPersonalQuestAvailable({
            handle: tx,
            campaignId,
            game: campaign.game,
            sourceId: input.personalQuestSourceId,
            characterId: '00000000-0000-4000-8000-000000000000',
          });
        }
      } catch (error) {
        if (error instanceof CharacterCatalogError) throw stateValidation(error);
        throw error;
      }

      let character: Character;
      try {
        character = await CharacterRepository.create(tx, {
          campaignId,
          ownerUserId: identity.userId,
          placeholderForEmail,
          name: input.name,
          className,
          xp: input.xp,
          gold: input.gold,
          perks: input.perks,
          perkMarks: input.perkMarks,
          masteries: input.masteries,
          personalQuestSourceId: input.personalQuestSourceId,
          privateNotes: input.privateNotes,
        });
      } catch (error) {
        mapCharacterWriteError(error);
      }
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

async function validateCharacterPatch(
  tx: DbOrTx,
  characterId: string,
  before: Character,
  input: UpdateCharacterInput,
): Promise<UpdateCharacterInput> {
  const campaign = await campaignFor(before.campaignId);
  let className = before.className;
  let normalized = input;
  if (input.className !== undefined) {
    className = await validateClassName({ game: campaign.game, className: input.className });
    normalized = { ...input, className };
  }
  try {
    if (input.xp !== undefined) assertXpValid(input.xp);
    if (input.gold !== undefined) assertGoldValid(input.gold);
    if (input.perks !== undefined || input.className !== undefined) {
      await assertPerkSelectionsValid({
        game: campaign.game,
        className,
        perks: input.perks ?? before.perks,
      });
    }
    if (input.perkMarks !== undefined) {
      assertPerkMarksValid(campaign.game, input.perkMarks);
    }
    if (input.masteries !== undefined || input.className !== undefined) {
      await assertMasterySelectionsValid({
        game: campaign.game,
        className,
        masteries: input.masteries ?? before.masteries,
      });
    }
    if (input.className !== undefined && className !== before.className) {
      const cards = await CharacterRepository.listCards(characterId);
      for (const card of cards) {
        await assertAbilityCardSourceForClass({
          game: campaign.game,
          className,
          sourceId: card.sourceId,
        });
      }
    }
    if (input.personalQuestSourceId !== undefined && input.personalQuestSourceId !== null) {
      await assertPersonalQuestAvailable({
        handle: tx,
        campaignId: before.campaignId,
        game: campaign.game,
        sourceId: input.personalQuestSourceId,
        characterId,
      });
    }
  } catch (error) {
    if (error instanceof CharacterCatalogError) throw stateValidation(error);
    throw error;
  }
  return normalized;
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
  confirmed: ConfirmedExecution = {},
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
      const validatedInput = await validateCharacterPatch(tx, characterId, before, input);
      // Retirement reverses an active character — destructive per the
      // matrix (the guided flow itself stays deferred, SQR-289).
      if (
        !confirmed.confirmedProposalId &&
        input.status === 'retired' &&
        before.status === 'active'
      ) {
        throw new ProposalRequiredError('character.retire');
      }
      let updated: Character;
      try {
        updated = await CharacterRepository.update(tx, characterId, validatedInput);
      } catch (error) {
        mapCharacterWriteError(error);
      }

      const changedKeys = Object.keys(validatedInput).filter((key) => key !== 'expectedVersion');
      const pick = (source: Record<string, unknown>) =>
        Object.fromEntries(changedKeys.map((key) => [key, source[key]]));
      return {
        result: updated,
        payloadBefore: pick(before as unknown as Record<string, unknown>),
        payloadAfter: pick(updated as unknown as Record<string, unknown>),
      };
    },
    confirmed.tx,
  );
}

/**
 * Owner-scoped delete. Unclaimed placeholders are scratch data; deleting a
 * real character is destructive per the matrix and only executes through a
 * confirmed proposal (SQR-279).
 */
export async function deleteCharacter(
  identity: CallerIdentity,
  characterId: string,
  confirmed: ConfirmedExecution = {},
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
      // Unclaimed placeholders are scratch data; real characters are
      // destructive and need a confirmed proposal (ADR 0021).
      if (!confirmed.confirmedProposalId && character.placeholderForEmail === null) {
        throw new ProposalRequiredError('character.delete');
      }
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
    confirmed.tx,
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
  const campaign = await campaignFor(campaignId);
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
      const campaign = await campaignFor(character.campaignId);
      try {
        await assertItemSourceAvailable({
          campaignId: character.campaignId,
          game: campaign.game,
          unlockedItems: campaign.unlockedItems,
          sourceId,
        });
      } catch (error) {
        if (error instanceof CharacterCatalogError) throw stateValidation(error);
        throw error;
      }
      const item = await CharacterRepository.addItem(tx, {
        characterId,
        game: campaign.game,
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
      const game = await campaignGameFor(character.campaignId);
      try {
        await assertAbilityCardSourceForClass({
          game,
          className: character.className,
          sourceId: input.sourceId,
        });
      } catch (error) {
        if (error instanceof CharacterCatalogError) throw stateValidation(error);
        throw error;
      }
      const card = await CharacterRepository.addCard(tx, {
        characterId,
        game,
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
