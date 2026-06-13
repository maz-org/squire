/**
 * Campaign write tools (SQR-280) — the mutation layer the agent and MCP
 * channels use. A SEPARATE family from the read contract (eng E5).
 *
 * Every entry point takes the caller's user id from RUNTIME context only
 * (model input never carries identity), consumes the campaign-write rate
 * budget in the SERVICE layer (constraint 9 — in-process web tools never
 * traverse /mcp middleware), and returns JSON-able results in the
 * knowledge-tool style: typed error codes, never thrown surprises.
 *
 * Non-destructive single writes apply directly (audited, CAS); the
 * destructive set comes back as `proposal_required` and flows through
 * propose→confirm (SQR-279). Replay safety: direct writes carry full
 * array/scalar values (same payload twice = same state), and proposals
 * accept scoped idempotency keys checked inside the propose transaction.
 */
import { z } from 'zod';
import { writeSecurityLog } from '../security-log.ts';
import { CAMPAIGN_WRITE_RATE_LIMIT_POLICY, getDefaultRateLimiter } from '../rate-limit.ts';
import { VersionConflictError } from '../db/repositories/types.ts';
import { characterPatchSummary, stagedMutationLines } from '../web-ui/proposal-block.ts';
import { availabilityShiftLines } from './availability.ts';
import { checkClassName, knownClassNames } from './class-validation.ts';
import { levelXpLedgerLine, levelXpWarnings } from './write-validation.ts';
import * as CampaignService from './campaign-service.ts';
import * as CharacterService from './character-service.ts';
import { identityFromSessionUser, type CallerIdentity } from './identity.ts';
import * as PendingMutations from './pending-mutations.ts';
import type { StagedMutation } from './pending-mutations.ts';
import { loadModuleGraphs } from './unlock-graph-loader.ts';

export interface WriteToolError {
  ok: false;
  error: { code: string; message: string; hint?: string };
}

export type WriteToolResult<T> = ({ ok: true } & T) | WriteToolError;

function failure(code: string, message: string, hint?: string): WriteToolError {
  return { ok: false, error: { code, message, ...(hint ? { hint } : {}) } };
}

function mapError(error: unknown): WriteToolError {
  if (error instanceof CampaignService.ProposalRequiredError) {
    return failure(
      error.code,
      error.message,
      'Stage it with propose_state_change, show the user the preview, and confirm only after they agree.',
    );
  }
  if (error instanceof CampaignService.CampaignNotFoundError) {
    return failure('not_found', 'Not found');
  }
  if (error instanceof CampaignService.CampaignForbiddenError) {
    return failure(error.code, error.message);
  }
  if (error instanceof VersionConflictError) {
    return failure('version_conflict', 'State changed concurrently — re-read and retry');
  }
  if (error instanceof PendingMutations.ProposalStateError) {
    return failure(error.code, error.message);
  }
  if (error instanceof PendingMutations.IdempotencyConflictError) {
    return failure(error.code, error.message);
  }
  if (error instanceof CharacterService.PlaceholderPrivateFieldsError) {
    return failure(error.code, error.message);
  }
  if (error instanceof CampaignService.UnsupportedGameError) {
    return failure(error.code, error.message, 'Squire supports frosthaven and gloomhaven-2e');
  }
  if (error instanceof CampaignService.NotAllowlistedError) {
    return failure(error.code, error.message);
  }
  if (error instanceof CampaignService.AlreadyInvitedError) {
    return failure(error.code, error.message);
  }
  throw error;
}

/**
 * Constraint 9: the write budget is consumed here in the service layer —
 * every channel pays it, including in-process web tools.
 */
async function consumeWriteBudget(userId: string): Promise<WriteToolError | null> {
  const decision = await getDefaultRateLimiter().consume({
    policy: CAMPAIGN_WRITE_RATE_LIMIT_POLICY,
    identity: `user:${userId}`,
  });
  if (decision.allowed) return null;
  writeSecurityLog({
    event: 'rate_limit_rejected',
    fields: {
      route: 'write-tools',
      policy: decision.policy.name,
      limit: decision.policy.limit,
      window_ms: decision.policy.windowMs,
      identity_hash: decision.identityHash,
      retry_after_seconds: decision.retryAfterSeconds,
    },
  });
  return failure(
    'rate_limited',
    `Write budget exhausted — retry in ${Math.max(1, decision.retryAfterSeconds)}s`,
  );
}

function requireWriteIdentity(userId: string | undefined): CallerIdentity | WriteToolError {
  if (!userId) {
    return failure(
      'user_identity_required',
      'Campaign writes need a user-bound identity on this channel',
    );
  }
  return identityFromSessionUser(userId);
}

async function guard(userId: string | undefined): Promise<CallerIdentity | WriteToolError> {
  const identity = requireWriteIdentity(userId);
  if ('ok' in identity) return identity;
  const limited = await consumeWriteBudget(identity.userId);
  return limited ?? identity;
}

// ─── Input boundaries ────────────────────────────────────────────────────────
// Tool input arrives from the MODEL, not a typed caller — the services trust
// their TypeScript contracts (the HTTP layer has its own zod schemas), so the
// tool layer is a validation boundary too. Constraints mirror server.ts.

const stateKeyArraySchema = z.array(z.string().trim().min(1).max(200)).max(1000);
const privateFieldSchema = z.string().trim().min(1).max(5000).nullable();

const WriteCampaignStateInputSchema = z.object({
  campaignId: z.string().uuid(),
  patch: z
    .object({
      name: z.string().trim().min(1).max(200).optional(),
      prosperity: z.number().int().min(0).max(100).optional(),
      activeScenario: z.string().trim().min(1).max(200).nullable().optional(),
      playedScenarios: stateKeyArraySchema.optional(),
      drawnScenarios: stateKeyArraySchema.optional(),
      unlockedClasses: stateKeyArraySchema.optional(),
      unlockedItems: stateKeyArraySchema.optional(),
      unlockedBuildings: stateKeyArraySchema.optional(),
    })
    .refine((patch) => Object.keys(patch).length > 0, {
      message: 'At least one field to update is required',
    }),
});

const WriteCharacterStateInputSchema = z.object({
  characterId: z.string().uuid(),
  patch: z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      className: z.string().trim().min(1).max(100).optional(),
      level: z.number().int().min(1).max(20).optional(),
      xp: z.number().int().min(0).optional(),
      gold: z.number().int().min(0).optional(),
      perks: z.array(z.number().int().min(0)).max(100).optional(),
      personalQuest: privateFieldSchema.optional(),
      battleGoals: privateFieldSchema.optional(),
      privateNotes: privateFieldSchema.optional(),
    })
    .refine((patch) => Object.keys(patch).length > 0, {
      message: 'At least one field to update is required',
    }),
});

const ProposeStateChangeInputSchema = z.object({
  campaignId: z.string().uuid(),
  mutation: PendingMutations.StagedMutationSchema,
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

const ProposalIdInputSchema = z.object({
  proposalId: z.string().uuid(),
});

function invalidInput(parseError: z.ZodError): WriteToolError {
  const issue = parseError.issues[0];
  const path = issue?.path.join('.') || 'input';
  return failure('invalid_input', `Invalid ${path}: ${issue?.message ?? 'malformed input'}`);
}

// ─── Direct (non-destructive) writes ─────────────────────────────────────────

export async function writeCampaignState(
  userId: string | undefined,
  rawInput: unknown,
): Promise<WriteToolResult<{ campaign: unknown }>> {
  const identity = await guard(userId);
  if ('ok' in identity) return identity;
  const parsed = WriteCampaignStateInputSchema.safeParse(rawInput);
  if (!parsed.success) return invalidInput(parsed.error);
  const input = parsed.data;
  try {
    // Fresh read → CAS write: a genuine concurrent writer surfaces as
    // version_conflict (no lost updates, constraint 7).
    const detail = await CampaignService.getCampaignDetail(identity, input.campaignId);
    const campaign = await CampaignService.updateSharedState(identity, input.campaignId, {
      expectedVersion: detail.campaign.version,
      ...input.patch,
    });
    return { ok: true, campaign };
  } catch (error) {
    return mapError(error);
  }
}

export async function writeCharacterState(
  userId: string | undefined,
  rawInput: unknown,
): Promise<WriteToolResult<{ character: unknown; warnings?: string[] }>> {
  const identity = await guard(userId);
  if ('ok' in identity) return identity;
  const parsed = WriteCharacterStateInputSchema.safeParse(rawInput);
  if (!parsed.success) return invalidInput(parsed.error);
  const input = parsed.data;
  try {
    const detail = await CharacterService.getCharacterDetail(identity, input.characterId);
    const character = await CharacterService.updateCharacter(identity, input.characterId, {
      expectedVersion: detail.character.version,
      ...input.patch,
    });
    // Soft rules-legality warnings (SQR-285): the write already applied —
    // relay the warning to the user, house rules always win.
    const warnings = levelXpWarnings(input.patch, character);
    return { ok: true, character, ...(warnings.length > 0 ? { warnings } : {}) };
  } catch (error) {
    return mapError(error);
  }
}

// ─── Onboarding creates (SQR-284) ────────────────────────────────────────────
// Creation is NOT in the destructive set: a campaign or character the user
// just asked for is reversible (deletion flows through propose→confirm), so
// the interview applies creates directly. Every create still shows in the
// work log — no silent writes.

const CreateCampaignInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  game: z.string().trim().min(1).max(100),
  modules: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
});

export async function createCampaign(
  userId: string | undefined,
  rawInput: unknown,
): Promise<WriteToolResult<{ campaign: unknown }>> {
  const identity = await guard(userId);
  if ('ok' in identity) return identity;
  const parsed = CreateCampaignInputSchema.safeParse(rawInput);
  if (!parsed.success) return invalidInput(parsed.error);
  try {
    const campaign = await CampaignService.createCampaign(identity, parsed.data);
    return { ok: true, campaign };
  } catch (error) {
    return mapError(error);
  }
}

const CreateCharacterInputSchema = z.object({
  campaignId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  className: z.string().trim().min(1).max(100),
  level: z.number().int().min(1).max(20).optional(),
  xp: z.number().int().min(0).optional(),
  gold: z.number().int().min(0).optional(),
  placeholderForEmail: z.string().trim().email().max(320).optional(),
  force: z.boolean().optional(),
});

export async function createCharacter(
  userId: string | undefined,
  rawInput: unknown,
): Promise<WriteToolResult<{ character: unknown }>> {
  const identity = await guard(userId);
  if ('ok' in identity) return identity;
  const parsed = CreateCharacterInputSchema.safeParse(rawInput);
  if (!parsed.success) return invalidInput(parsed.error);
  const { campaignId, force, ...input } = parsed.data;
  try {
    // GHS-validated class names, soft correction (SQR-284): a near-miss
    // earns a clarifying question, not a guess; force admits homebrew.
    const detail = await CampaignService.getCampaignDetail(identity, campaignId);
    if (!force) {
      const check = checkClassName(input.className, await knownClassNames(detail.campaign.game));
      if (!check.ok) {
        return failure(
          'unknown_class',
          `"${input.className}" is not a known ${detail.campaign.game} class`,
          check.suggestion
            ? `Ask the user: did you mean ${check.suggestion}? Retry with force:true only if they insist on a custom class.`
            : `Known classes: ${check.known.join(', ')}. Retry with force:true only if the user insists on a custom class.`,
        );
      }
      input.className = check.canonical;
    }
    const character = await CharacterService.createCharacter(identity, campaignId, input);
    return { ok: true, character };
  } catch (error) {
    return mapError(error);
  }
}

const InviteMemberInputSchema = z.object({
  campaignId: z.string().uuid(),
  email: z.string().trim().email().max(320),
});

export async function inviteMember(
  userId: string | undefined,
  rawInput: unknown,
): Promise<WriteToolResult<{ member: unknown }>> {
  const identity = await guard(userId);
  if ('ok' in identity) return identity;
  const parsed = InviteMemberInputSchema.safeParse(rawInput);
  if (!parsed.success) return invalidInput(parsed.error);
  try {
    const member = await CampaignService.inviteMember(
      identity,
      parsed.data.campaignId,
      parsed.data.email,
    );
    return { ok: true, member };
  } catch (error) {
    return mapError(error);
  }
}

// ─── Propose→confirm (the destructive path) ──────────────────────────────────

function proposalView(proposal: PendingMutations.PendingProposal) {
  return {
    id: proposal.id,
    mutation: proposal.mutation,
    status: proposal.status,
    expiresAt: proposal.expiresAt.toISOString(),
  };
}

/**
 * Ledger preview lines for a staged mutation (SQR-283): one line per batch
 * member with character names resolved, plus derived availability
 * consequences ("OPENS → 19, 43; CLOSES PERMANENTLY → ...") for scenario
 * state changes. Best-effort — a preview failure must never block staging,
 * so resolution errors fall back to the generic vocabulary.
 */
export async function proposalPreviewLines(
  identity: CallerIdentity,
  campaignId: string,
  mutation: StagedMutation,
): Promise<string[]> {
  const members = mutation.type === 'batch' ? mutation.mutations : [mutation];
  const lines: string[] = [];
  for (const member of members) {
    if (
      member.type === 'character.update' ||
      member.type === 'character.retire' ||
      member.type === 'character.delete'
    ) {
      try {
        const detail = await CharacterService.getCharacterDetail(identity, member.characterId);
        const name = detail.character.name.toUpperCase();
        if (member.type === 'character.update') {
          lines.push(`${name} → ${characterPatchSummary(member.patch)}`);
          // Soft rules-legality preview (SQR-285): warn on the staged
          // resolved sheet; confirm still applies it — house rules win.
          const resolved = {
            level: member.patch.level ?? detail.character.level,
            xp: member.patch.xp ?? detail.character.xp,
          };
          const warning = levelXpLedgerLine(member.patch, resolved);
          if (warning) lines.push(warning);
        } else if (member.type === 'character.retire') {
          lines.push(`${name} · RETIRE`);
        } else {
          lines.push(`${name} · DELETE`);
        }
        continue;
      } catch {
        // Name resolution is preview garnish — generic line below.
      }
    }
    lines.push(...stagedMutationLines(member));
  }

  const update = members.find(
    (member): member is Extract<typeof member, { type: 'campaign.update' }> =>
      member.type === 'campaign.update',
  );
  if (
    update &&
    (update.patch.playedScenarios !== undefined || update.patch.drawnScenarios !== undefined)
  ) {
    try {
      const detail = await CampaignService.getCampaignDetail(identity, campaignId);
      const graphs = await loadModuleGraphs(detail.campaign.game, detail.campaign.modules);
      lines.push(...availabilityShiftLines(graphs, detail.campaign, update.patch));
    } catch {
      // The graph is advisory (E9) — staging proceeds without consequences.
    }
  }
  return lines;
}

export async function proposeStateChange(
  userId: string | undefined,
  rawInput: unknown,
): Promise<WriteToolResult<{ proposal: unknown; preview: string[]; hint: string }>> {
  const identity = await guard(userId);
  if ('ok' in identity) return identity;
  const parsed = ProposeStateChangeInputSchema.safeParse(rawInput);
  if (!parsed.success) return invalidInput(parsed.error);
  const input = parsed.data;
  try {
    const proposal = await PendingMutations.propose(identity, input.campaignId, input.mutation, {
      idempotencyKey: input.idempotencyKey,
      toolFamily: 'write_tools',
    });
    return {
      ok: true,
      proposal: proposalView(proposal),
      preview: await proposalPreviewLines(identity, input.campaignId, proposal.mutation),
      hint: 'Show the user exactly what this changes; call confirm_state_change ONLY after they explicitly agree.',
    };
  } catch (error) {
    return mapError(error);
  }
}

export async function confirmStateChange(
  userId: string | undefined,
  rawInput: unknown,
): Promise<WriteToolResult<{ proposal: unknown }>> {
  const identity = await guard(userId);
  if ('ok' in identity) return identity;
  const parsed = ProposalIdInputSchema.safeParse(rawInput);
  if (!parsed.success) return invalidInput(parsed.error);
  try {
    const proposal = await PendingMutations.confirm(identity, parsed.data.proposalId);
    return { ok: true, proposal: proposalView(proposal) };
  } catch (error) {
    return mapError(error);
  }
}

export async function cancelStateChange(
  userId: string | undefined,
  rawInput: unknown,
): Promise<WriteToolResult<{ cancelled: true }>> {
  const identity = await guard(userId);
  if ('ok' in identity) return identity;
  const parsed = ProposalIdInputSchema.safeParse(rawInput);
  if (!parsed.success) return invalidInput(parsed.error);
  try {
    await PendingMutations.cancel(identity, parsed.data.proposalId);
    return { ok: true, cancelled: true };
  } catch (error) {
    return mapError(error);
  }
}
