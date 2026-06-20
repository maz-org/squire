/**
 * Campaign entity kinds for the knowledge tool contract (SQR-269, E5).
 *
 * Implements the campaign/character/party branches that tools.ts delegates
 * to. Reads only — writes stay a separate tool family (E5). Every function
 * takes the caller's identity (or null when the channel carried none) and
 * rides the ADR 0021 service layer, so a non-member ref resolves to the
 * same not_found as an absent one and other members' private-tier fields
 * are structurally absent from every payload.
 *
 * `party` is campaign-scoped in v1 (one party per campaign): its ref reuses
 * the campaign id and projects the roster + member-visible characters.
 */
import type {
  EntityCandidate,
  KnowledgeLink,
  KnowledgeNeighborsResult,
  KnowledgeOpenResult,
  SourceInfo,
} from '../tools.ts';
import { deriveAvailability } from './availability.ts';
import * as CampaignService from './campaign-service.ts';
import { CampaignNotFoundError } from './campaign-service.ts';
import * as CharacterService from './character-service.ts';
import type { CallerIdentity } from './identity.ts';
import { listJournal } from './journal.ts';
import { loadModuleGraphs } from './unlock-graph-loader.ts';
import * as CharacterRepository from '../db/repositories/character-repository.ts';
import type { Campaign } from '../db/repositories/types.ts';

export const CAMPAIGN_ENTITY_KINDS = ['campaign', 'character', 'party'] as const;
export type CampaignEntityKind = (typeof CAMPAIGN_ENTITY_KINDS)[number];

export const CAMPAIGN_RELATIONS = ['has_character', 'has_party', 'in_campaign'] as const;
export type CampaignRelation = (typeof CAMPAIGN_RELATIONS)[number];

const CAMPAIGN_SOURCE_LABEL = 'Campaign State';

/**
 * Pre-filter window for character name matching: we scan more roster rows
 * than the final `limit` because `nameMatchConfidence` drops non-matches,
 * so a small multiple keeps enough high-confidence hits in reach before the
 * caller's limit applies. Parties are tiny, so 4× is generous, not costly.
 */
const CHARACTER_PRESEARCH_MULTIPLIER = 4;

/**
 * Tool-layer reads construct identity from the channel's resolved userId.
 * The channel tag only matters for audit writes, which never happen on the
 * read-only contract surface.
 */
function toolIdentity(userId: string): CallerIdentity {
  return { userId, channel: 'system' };
}

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CAMPAIGN_REF_RE = new RegExp(
  `^(campaign|character|party):([a-z0-9-]+)/(${UUID_PATTERN})$`,
  'i',
);

export interface ParsedCampaignRef {
  kind: CampaignEntityKind;
  game: string;
  id: string;
}

/** A ref is campaign-shaped if it uses one of the three kind prefixes. */
export function isCampaignShapedRef(ref: string): boolean {
  return /^(campaign|character|party):/i.test(ref.trim());
}

export function parseCampaignRef(ref: string): ParsedCampaignRef | null {
  const match = ref.trim().match(CAMPAIGN_REF_RE);
  if (!match) return null;
  return {
    kind: match[1].toLowerCase() as CampaignEntityKind,
    game: match[2].toLowerCase(),
    id: match[3].toLowerCase(),
  };
}

function notFound(ref: string): KnowledgeOpenResult {
  // Mirrors the knowledge-kind not_found shape; absent, non-member, and
  // malformed-id refs are deliberately indistinguishable (ADR 0021).
  return { ok: false, error: { code: 'not_found', message: `Entity not found: ${ref}` } };
}

function campaignRef(campaign: Campaign): string {
  return `campaign:${campaign.game}/${campaign.id}`;
}

/** The membership-scoped source entry for inspect_sources. */
export async function campaignSourceInfo(
  userId: string | undefined,
  game: string,
): Promise<SourceInfo | null> {
  if (!userId) return null;
  const campaigns = await CampaignService.listMyCampaigns(toolIdentity(userId));
  const mine = campaigns.filter((campaign) => campaign.game === game);
  return {
    ref: `source:${game}/campaign-state`,
    label: CAMPAIGN_SOURCE_LABEL,
    kinds: [...CAMPAIGN_ENTITY_KINDS],
    searchable: false,
    openable: true,
    relations: [...CAMPAIGN_RELATIONS],
    counts: { campaign: mine.length },
  };
}

function nameMatchConfidence(query: string, name: string): number | null {
  const q = query.trim().toLowerCase();
  const n = name.trim().toLowerCase();
  if (!q || !n) return null;
  if (n === q) return 0.97;
  if (n.includes(q) || q.includes(n)) return 0.86;
  return null;
}

/**
 * Resolve campaign/character/party names within the caller's memberships
 * only. Without an identity there is nothing to resolve — campaign kinds
 * simply produce no candidates.
 */
export async function resolveCampaignEntities(
  userId: string | undefined,
  game: string,
  query: string,
  kinds: readonly string[],
  limit: number,
): Promise<EntityCandidate[]> {
  if (!userId) return [];
  const wanted = new Set(
    kinds.filter((k) => (CAMPAIGN_ENTITY_KINDS as readonly string[]).includes(k)),
  );
  if (wanted.size === 0) return [];

  const identity = toolIdentity(userId);
  const campaigns = (await CampaignService.listMyCampaigns(identity)).filter(
    (campaign) => campaign.game === game,
  );
  const candidates: EntityCandidate[] = [];

  for (const campaign of campaigns) {
    const confidence = nameMatchConfidence(query, campaign.name);
    if (wanted.has('campaign') && confidence !== null) {
      candidates.push({
        entity: {
          kind: 'campaign',
          ref: campaignRef(campaign),
          title: campaign.name,
          source: `source:${game}/campaign-state`,
          sourceLabel: CAMPAIGN_SOURCE_LABEL,
        },
        confidence,
        matchReason: confidence >= 0.97 ? 'Exact campaign name' : 'Campaign name match',
      });
    }
    if (wanted.has('party') && (confidence !== null || /\b(party|roster)\b/i.test(query))) {
      candidates.push({
        entity: {
          kind: 'party',
          ref: `party:${game}/${campaign.id}`,
          title: `${campaign.name} party`,
          source: `source:${game}/campaign-state`,
          sourceLabel: CAMPAIGN_SOURCE_LABEL,
        },
        confidence: confidence !== null ? Math.max(confidence - 0.05, 0.8) : 0.8,
        matchReason: 'Campaign party',
      });
    }
    if (wanted.has('character')) {
      const characters = await CharacterService.listCampaignCharacters(identity, campaign.id);
      for (const character of characters.slice(0, limit * CHARACTER_PRESEARCH_MULTIPLIER)) {
        const characterConfidence = nameMatchConfidence(query, character.name);
        if (characterConfidence === null) continue;
        candidates.push({
          entity: {
            kind: 'character',
            ref: `character:${game}/${character.id}`,
            title: character.name,
            source: `source:${game}/campaign-state`,
            sourceLabel: CAMPAIGN_SOURCE_LABEL,
          },
          confidence: characterConfidence,
          matchReason:
            characterConfidence >= 0.97 ? 'Exact character name' : 'Character name match',
        });
      }
    }
  }

  return candidates;
}

async function availabilitySummary(campaign: Campaign): Promise<Record<string, unknown>> {
  const graphs = await loadModuleGraphs(campaign.game, campaign.modules);
  const roster = await CharacterRepository.listActiveRosterByCampaign(campaign.id);
  const availability = deriveAvailability(
    graphs,
    new Set(campaign.playedScenarios),
    new Set(campaign.drawnScenarios),
    new Set(campaign.skippedScenarios),
    roster,
  );
  const counts: Record<string, number> = {};
  const unlockedKeys: string[] = [];
  for (const [key, status] of availability.statuses) {
    if (status === 'open' || status === 'drew-it') {
      counts.unlocked = (counts.unlocked ?? 0) + 1;
      unlockedKeys.push(key);
    } else if (status === 'via-event') {
      counts.manual = (counts.manual ?? 0) + 1;
    } else {
      counts[status] = (counts[status] ?? 0) + 1;
    }
  }
  return {
    counts,
    unlockedKeys: unlockedKeys.sort(),
    unknownKeys: availability.unknownKeys,
    hazardWarnings: availability.hazardWarnings,
  };
}

function characterLinks(
  game: string,
  campaignId: string,
  characters: Array<{ id: string; name: string }>,
): KnowledgeLink[] {
  return characters.map((character) => ({
    relation: 'has_character',
    target: {
      kind: 'character' as const,
      ref: `character:${game}/${character.id}`,
      title: character.name,
      sourceLabel: CAMPAIGN_SOURCE_LABEL,
    },
  }));
}

/**
 * Open a campaign-shaped ref. Returns null when the ref is not
 * campaign-shaped at all (caller continues down the knowledge path).
 */
export async function openCampaignEntity(
  userId: string | undefined,
  ref: string,
): Promise<KnowledgeOpenResult | null> {
  if (!isCampaignShapedRef(ref)) return null;
  const parsed = parseCampaignRef(ref);
  // Malformed campaign refs and missing identity are both not_found —
  // a channel without identity sees no campaign state at all.
  if (!parsed || !userId) return notFound(ref);
  const identity = toolIdentity(userId);

  try {
    if (parsed.kind === 'character') {
      const detail = await CharacterService.getCharacterDetail(identity, parsed.id);
      const campaign = await CampaignService.getCampaignDetail(
        identity,
        detail.character.campaignId,
      );
      if (campaign.campaign.game !== parsed.game) return notFound(ref);
      return {
        ok: true,
        entity: {
          kind: 'character',
          ref,
          title: detail.character.name,
          sourceLabel: CAMPAIGN_SOURCE_LABEL,
          data: {
            ...detail.character,
            own: detail.own,
            items: detail.items,
            cards: detail.cards,
          },
        },
        citations: [],
        links: [
          {
            relation: 'in_campaign',
            target: {
              kind: 'campaign',
              ref: campaignRef(campaign.campaign),
              title: campaign.campaign.name,
              sourceLabel: CAMPAIGN_SOURCE_LABEL,
            },
          },
        ],
        related: [],
      };
    }

    const detail = await CampaignService.getCampaignDetail(identity, parsed.id);
    if (detail.campaign.game !== parsed.game) return notFound(ref);
    const characters = await CharacterService.listCampaignCharacters(identity, parsed.id);
    const members = detail.members.map((member) => ({
      name: member.name,
      email: member.email,
      role: member.role,
      status: member.status,
    }));

    if (parsed.kind === 'party') {
      return {
        ok: true,
        entity: {
          kind: 'party',
          ref,
          title: `${detail.campaign.name} party`,
          sourceLabel: CAMPAIGN_SOURCE_LABEL,
          data: { campaignName: detail.campaign.name, members, characters },
        },
        citations: [],
        links: [
          {
            relation: 'in_campaign',
            target: {
              kind: 'campaign',
              ref: campaignRef(detail.campaign),
              title: detail.campaign.name,
              sourceLabel: CAMPAIGN_SOURCE_LABEL,
            },
          },
          ...characterLinks(parsed.game, parsed.id, characters),
        ],
        related: [],
      };
    }

    const { campaign } = detail;
    return {
      ok: true,
      entity: {
        kind: 'campaign',
        ref,
        title: campaign.name,
        sourceLabel: CAMPAIGN_SOURCE_LABEL,
        data: {
          name: campaign.name,
          game: campaign.game,
          modules: campaign.modules,
          prosperity: campaign.prosperity,
          activeScenario: campaign.activeScenario,
          playedScenarios: campaign.playedScenarios,
          drawnScenarios: campaign.drawnScenarios,
          unlockedClasses: campaign.unlockedClasses,
          unlockedItems: campaign.unlockedItems,
          unlockedBuildings: campaign.unlockedBuildings,
          version: campaign.version,
          members,
          availability: await availabilitySummary(campaign),
          recentJournal: await listJournal(identity, parsed.id, { limit: 50 }),
        },
      },
      citations: [],
      links: [
        {
          relation: 'has_party',
          target: {
            kind: 'party',
            ref: `party:${parsed.game}/${parsed.id}`,
            title: `${campaign.name} party`,
            sourceLabel: CAMPAIGN_SOURCE_LABEL,
          },
        },
        ...characterLinks(parsed.game, parsed.id, characters),
      ],
      related: [],
    };
  } catch (error) {
    if (error instanceof CampaignNotFoundError) return notFound(ref);
    throw error;
  }
}

/**
 * Traverse from a campaign-shaped ref. Returns null when the ref is not
 * campaign-shaped (caller continues down the knowledge path).
 */
export async function campaignNeighbors(
  userId: string | undefined,
  ref: string,
  relation: string | undefined,
): Promise<KnowledgeNeighborsResult | null> {
  if (!isCampaignShapedRef(ref)) return null;
  if (relation && !(CAMPAIGN_RELATIONS as readonly string[]).includes(relation)) {
    return {
      ok: false,
      error: { code: 'unsupported_relation', message: `Unsupported relation: ${relation}` },
    };
  }
  const opened = await openCampaignEntity(userId, ref);
  if (!opened || !opened.ok) {
    return (
      opened ?? { ok: false, error: { code: 'not_found', message: `Entity not found: ${ref}` } }
    );
  }
  const links = relation ? opened.links.filter((link) => link.relation === relation) : opened.links;
  return {
    ok: true,
    from: opened.entity,
    neighbors: links.map((link) => ({ relation: link.relation, target: link.target })),
  };
}
