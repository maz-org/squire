/**
 * Atomic search tools for the Squire knowledge platform.
 * These are standalone data access primitives that agents compose to answer questions.
 */

import { embed } from './embedder.ts';
import { formatRetrievalSourceLabel } from './retrieval-source.ts';
import {
  ruleSourceLocator,
  ruleSourceProvenance,
  type RuleSourceFreshness,
  type RuleSourceType,
} from './rule-source-provenance.ts';
import { getEntryBySourceChunk, search } from './vector-store.ts';
import type { ScoredEntry } from './vector-store.ts';
import { rerankRuleSourceHits } from './voyage-retrieval.ts';
import {
  countsByType,
  formatExtracted,
  load,
  loadOne,
  searchExtractedRanked,
  TYPES,
} from './extracted-data.ts';
import type { CardType } from './schemas.ts';
import {
  findScenarios,
  getScenarioSectionBooksBootstrapStatus,
  getScenario as loadScenario,
  getSection as loadSection,
  searchSections as loadSections,
  followReferences as loadReferences,
  findIncomingReferences as loadIncomingReferences,
} from './scenario-section-data.ts';
import {
  BOOK_REFERENCE_TYPES,
  type BookRecordKind,
  type BookReferenceType,
} from './scenario-section-schemas.ts';
import {
  DEFAULT_GAME_ID,
  GLOOMHAVEN_2E_GAME_ID,
  SUPPORTED_GAMES,
  gameDefinitionFor,
  requireGameId,
} from './game.ts';
import type { GameId } from './game.ts';
import {
  campaignNeighbors,
  campaignSourceInfo,
  openCampaignEntity,
  resolveCampaignEntities,
} from './campaign/knowledge.ts';
import { and, eq, or } from 'drizzle-orm';
import { getDb } from './db.ts';
import { knowledgeEdges } from './db/schema/knowledge-edges.ts';

// ─── Result types ────────────────────────────────────────────────────────────

export interface RuleResult {
  text: string;
  game: GameId;
  source: string;
  sourceRef: string;
  sourceUrl?: string;
  sourceType: RuleSourceType;
  sourceLabel: string;
  sourceLocator: string;
  freshness?: RuleSourceFreshness;
  score: number;
}

export interface CardResult {
  type: CardType;
  data: Record<string, unknown>;
  score: number;
}

export interface CardTypeInfo {
  type: CardType;
  count: number;
}

export interface ScenarioResult {
  ref: string;
  scenarioGroup: string;
  scenarioIndex: string;
  name: string;
  complexity: number | null;
  flowChartGroup: string | null;
  initial: boolean;
  sourcePdf: string | null;
  sourcePage: number | null;
  rawText: string | null;
  metadata: Record<string, unknown>;
}

export interface SectionResult {
  ref: string;
  sectionNumber: number;
  sectionVariant: number;
  sourcePdf: string;
  sourcePage: number;
  text: string;
  metadata: Record<string, unknown>;
}

export interface ReferenceResult {
  fromKind: BookRecordKind;
  fromRef: string;
  toKind: BookRecordKind;
  toRef: string;
  linkType: BookReferenceType;
  rawLabel: string | null;
  rawContext: string | null;
  sequence: number;
}

export interface InspectSourcesResult {
  ok: true;
  games: Array<{ id: string; label: string; default: boolean }>;
  sources: SourceInfo[];
  defaultGame: string;
  warnings?: string[];
}

export interface SourceInfo {
  ref: string;
  label: string;
  kinds: KnowledgeKind[];
  searchable: boolean;
  openable: boolean;
  relations: string[];
  sourceType?: RuleSourceType;
  counts?: Record<string, number>;
  freshness?: RuleSourceFreshness;
}

export type KnowledgeKind =
  | 'rules_passage'
  | 'scenario'
  | 'section'
  | 'card_type'
  | 'card'
  | 'campaign'
  | 'character'
  | 'party';

export interface SchemaField {
  name: string;
  type: string;
  description: string;
}

export type SchemaResult =
  | {
      ok: true;
      kind: KnowledgeKind;
      refPattern: string;
      fields: SchemaField[];
      filterFields: string[];
      relations: string[];
      examples: Array<{ label: string; ref: string }>;
      aliases?: string[];
    }
  | {
      ok: false;
      error: 'unknown_kind';
      kind: string;
      hint: string;
    };

export interface EntityResolutionOptions extends ToolOpts {
  kinds?: string[];
  limit?: number;
}

export interface EntityCandidate {
  entity: {
    kind: KnowledgeKind;
    ref: string;
    title: string;
    source: string;
    sourceLabel: string;
    data?: Record<string, unknown>;
  };
  confidence: number;
  matchReason: string;
}

export type EntityResolutionResult =
  | {
      ok: true;
      query: string;
      candidates: EntityCandidate[];
    }
  | {
      ok: false;
      error: 'invalid_filter';
      query: string;
      hint: string;
      candidates: [];
    };

const LOOKUP_LOW_CONFIDENCE_THRESHOLD = 0.8;
const LOOKUP_TIE_MARGIN = 0.02;
const LOOKUP_LOW_CONFIDENCE_MARGIN = 0.08;

export type KnowledgeEntityKind =
  | 'rules_passage'
  | 'scenario'
  | 'section'
  | 'card'
  | 'campaign'
  | 'character'
  | 'party';

export interface KnowledgeEntitySummary {
  kind: KnowledgeEntityKind;
  ref: string;
  title: string;
  sourceLabel: string;
}

export interface KnowledgeCitation {
  sourceRef: string;
  sourceType?: RuleSourceType;
  sourceLabel: string;
  locator: string;
  sourceUrl?: string;
  freshness?: RuleSourceFreshness;
}

export interface KnowledgeLink {
  relation: string;
  target: KnowledgeEntitySummary;
  reason?: string;
}

export interface KnowledgeEntity extends KnowledgeEntitySummary {
  data: Record<string, unknown>;
}

interface RulePassageContext {
  ref: string;
  title: string;
  text: string;
  chunkIndex: number;
}

export interface KnowledgeError {
  code: 'invalid_ref' | 'not_found' | 'ambiguous' | 'invalid_filter' | 'unsupported_relation';
  message: string;
  hint?: string;
  candidates?: KnowledgeEntitySummary[];
}

export type KnowledgeOpenResult =
  | {
      ok: true;
      entity: KnowledgeEntity;
      citations: KnowledgeCitation[];
      links: KnowledgeLink[];
      related: KnowledgeLink[];
    }
  | { ok: false; error: KnowledgeError };

export interface KnowledgeSearchHit {
  entity: KnowledgeEntitySummary;
  score: number;
  scoreKind?: ScoredEntry['scoreKind'];
  snippet: string;
  citations: KnowledgeCitation[];
  nextRefs: KnowledgeEntitySummary[];
}

export type KnowledgeSearchResult =
  | {
      ok: true;
      query: string;
      results: KnowledgeSearchHit[];
      truncated?: boolean;
      truncatedScopes?: KnowledgeEntityKind[];
    }
  | { ok: false; error: KnowledgeError };

export type KnowledgeNeighborsResult =
  | {
      ok: true;
      from: KnowledgeEntitySummary;
      neighbors: KnowledgeLink[];
      truncated?: boolean;
    }
  | { ok: false; error: KnowledgeError };

export interface SearchKnowledgeOptions extends ToolOpts {
  scope?: KnowledgeEntityKind[];
  filters?: Record<string, unknown>;
  limit?: number;
}

export interface NeighborsOptions extends ToolOpts {
  relation?: string;
  limit?: number;
}

interface ToolOpts {
  /** Campaign variant. Defaults to 'frosthaven'. Reserved for Phase 2. */
  game?: string;
  /**
   * Resolved caller user id (SQR-20/269). When present, the campaign-state
   * kinds light up, scoped to this user's memberships. When absent, those
   * kinds behave as if the data did not exist; knowledge kinds are
   * unaffected either way.
   */
  userId?: string;
}

interface NormalizedToolOpts extends ToolOpts {
  game: GameId;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Strip internal `_*` marker keys from a card record. */
function stripInternalKeys(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!key.startsWith('_')) out[key] = value;
  }
  return out;
}

const DEFAULT_GAME = DEFAULT_GAME_ID;
const GAME_INFO = SUPPORTED_GAMES.map(({ id, label, default: isDefault }) => ({
  id,
  label,
  default: isDefault,
}));

function normalizeToolGame(game?: string): GameId {
  return requireGameId(game ?? DEFAULT_GAME);
}

function normalizeToolOpts(opts?: ToolOpts): NormalizedToolOpts {
  return { ...opts, game: normalizeToolGame(opts?.game) };
}

const CURRENT_RULE_SOURCE_SCORE_WINDOW = 0.08;
const CURRENT_RULE_SOURCE_EXTRA_CANDIDATES = 12;
const CONDITION_DEFINITION_CANDIDATE_LIMIT = 20;
const CONDITION_NAMES = [
  'bane',
  'bless',
  'brittle',
  'curse',
  'disarm',
  'immobilize',
  'impair',
  'invisible',
  'muddle',
  'poison',
  'regenerate',
  'strengthen',
  'stun',
  'ward',
  'wound',
] as const;
type ConditionName = (typeof CONDITION_NAMES)[number];

function currentRuleSourceCandidateLimit(requestedLimit: number, game: GameId, query = ''): number {
  if (isConditionDefinitionQueryForAnyCondition(query)) {
    return Math.max(requestedLimit, CONDITION_DEFINITION_CANDIDATE_LIMIT);
  }

  if (game !== GLOOMHAVEN_2E_GAME_ID) return requestedLimit;
  // Pull a small surplus so GH2 FAQ/errata just below the raw vector cutoff can
  // still correct or clarify a printed-source hit with a similar score.
  return Math.max(
    requestedLimit,
    Math.min(requestedLimit + CURRENT_RULE_SOURCE_EXTRA_CANDIDATES, 20),
  );
}

function currentRuleSourceRank(sourceType: RuleSourceType): number {
  if (sourceType === 'errata') return 0;
  if (sourceType === 'faq') return 1;
  return 2;
}

function isConditionDefinitionText(
  query: string,
  text: string,
  sourceType: RuleSourceType,
): boolean {
  if (sourceType !== 'rulebook') return false;
  const queryText = query.toLowerCase();
  const hitText = text.toLowerCase();
  const conditions = CONDITION_NAMES.filter((name) => containsConditionWord(queryText, name));
  if (conditions.length === 0 || !isConditionDefinitionQuery(queryText, conditions)) return false;

  // Short glossary definitions are easy for vector search to bury below FAQ
  // edge cases. Keep the actual rulebook definition visible when the query asks
  // what a condition does.
  return conditions.some((condition) => hitText.includes(`${condition}:`));
}

function isConditionDefinitionQuery(queryText: string, conditions: ConditionName[]): boolean {
  if (
    conditions.length > 1 &&
    /\b(?:against|combine|during|interact|timing|versus|vs|while|with)\b/.test(queryText)
  ) {
    return false;
  }

  return conditions.some((condition) => {
    const escaped = condition.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (
      new RegExp(`\\bwhat\\s+(?:does|is)\\s+(?:the\\s+)?${escaped}\\b`).test(queryText) ||
      new RegExp(`\\bwhat\\s+does\\s+(?:the\\s+)?${escaped}\\s+condition\\s+do\\b`).test(
        queryText,
      ) ||
      new RegExp(`\\b${escaped}\\s+condition\\b`).test(queryText) ||
      new RegExp(`\\bdefine\\s+(?:the\\s+)?${escaped}\\b`).test(queryText) ||
      new RegExp(`\\b(?:definition|effect|rules?)\\s+(?:for|of)\\s+(?:the\\s+)?${escaped}\\b`).test(
        queryText,
      ) ||
      new RegExp(`\\b${escaped}\\s+(?:condition\\s+)?(?:definition|effect|rules?)\\b`).test(
        queryText,
      ) ||
      new RegExp(`\\b${escaped}\\s+condition\\s+(?:mean|do)\\b`).test(queryText)
    );
  });
}

function isConditionDefinitionQueryForAnyCondition(query: string): boolean {
  const queryText = query.toLowerCase();
  const conditions = CONDITION_NAMES.filter((name) => containsConditionWord(queryText, name));
  return isConditionDefinitionQuery(queryText, conditions);
}

function containsConditionWord(text: string, condition: ConditionName): boolean {
  const escaped = condition.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

function isConditionDefinitionHit(
  query: string,
  hit: ScoredEntry,
  sourceType: RuleSourceType,
): boolean {
  return isConditionDefinitionText(query, hit.text, sourceType);
}

function isGh2RuleCitation(citation: KnowledgeCitation | undefined): citation is KnowledgeCitation {
  return citation?.sourceRef.startsWith(`source:${GLOOMHAVEN_2E_GAME_ID}/`) ?? false;
}

function hasComparableVectorScores(
  a?: ScoredEntry['scoreKind'],
  b?: ScoredEntry['scoreKind'],
): boolean {
  return (a ?? 'vector') === 'vector' && (b ?? 'vector') === 'vector';
}

function rankRuleHitsForCurrentSources(
  hits: ScoredEntry[],
  game: GameId,
  query = '',
): ScoredEntry[] {
  return hits
    .map((hit, index) => ({
      hit,
      index,
      provenance: ruleSourceProvenance(hit.source, normalizeToolGame(hit.game ?? game)),
    }))
    .sort((a, b) => {
      const aDefinition = isConditionDefinitionHit(query, a.hit, a.provenance.sourceType);
      const bDefinition = isConditionDefinitionHit(query, b.hit, b.provenance.sourceType);
      if (aDefinition !== bDefinition) return aDefinition ? -1 : 1;

      const scoreDelta = b.hit.score - a.hit.score;
      const aCurrent = a.provenance.game === GLOOMHAVEN_2E_GAME_ID;
      const bCurrent = b.provenance.game === GLOOMHAVEN_2E_GAME_ID;
      const closeEnough =
        hasComparableVectorScores(a.hit.scoreKind, b.hit.scoreKind) &&
        Math.abs(scoreDelta) <= CURRENT_RULE_SOURCE_SCORE_WINDOW;

      if (aCurrent && bCurrent && closeEnough) {
        const sourceRankDelta =
          currentRuleSourceRank(a.provenance.sourceType) -
          currentRuleSourceRank(b.provenance.sourceType);
        if (sourceRankDelta !== 0) return sourceRankDelta;
      }

      if (scoreDelta !== 0) return scoreDelta;
      return a.index - b.index;
    })
    .map(({ hit }) => hit);
}

function compareKnowledgeHits(a: KnowledgeSearchHit, b: KnowledgeSearchHit, query = ''): number {
  const scoreDelta = b.score - a.score;
  const aCitation = a.citations[0];
  const bCitation = b.citations[0];

  if (
    a.entity.kind === 'rules_passage' &&
    b.entity.kind === 'rules_passage' &&
    aCitation?.sourceType &&
    bCitation?.sourceType &&
    query
  ) {
    const aDefinition = isConditionDefinitionText(query, a.snippet, aCitation.sourceType);
    const bDefinition = isConditionDefinitionText(query, b.snippet, bCitation.sourceType);
    if (aDefinition !== bDefinition) return aDefinition ? -1 : 1;
  }

  if (
    a.entity.kind === 'rules_passage' &&
    b.entity.kind === 'rules_passage' &&
    isGh2RuleCitation(aCitation) &&
    isGh2RuleCitation(bCitation) &&
    aCitation.sourceType &&
    bCitation.sourceType &&
    hasComparableVectorScores(a.scoreKind, b.scoreKind) &&
    Math.abs(scoreDelta) <= CURRENT_RULE_SOURCE_SCORE_WINDOW
  ) {
    const sourceRankDelta =
      currentRuleSourceRank(aCitation.sourceType) - currentRuleSourceRank(bCitation.sourceType);
    if (sourceRankDelta !== 0) return sourceRankDelta;
  }

  return scoreDelta;
}

const CARD_KIND_ALIASES: Record<string, CardType[]> = {
  item: ['items'],
  items: ['items'],
  monster: ['monster-stats', 'monster-abilities'],
  monsters: ['monster-stats', 'monster-abilities'],
  'monster-stat': ['monster-stats'],
  'monster-stats': ['monster-stats'],
  'monster-ability': ['monster-abilities'],
  'monster-abilities': ['monster-abilities'],
  ability: ['character-abilities'],
  abilities: ['character-abilities'],
  'character-ability': ['character-abilities'],
  'character-abilities': ['character-abilities'],
  building: ['buildings'],
  buildings: ['buildings'],
  event: ['events'],
  events: ['events'],
  'battle-goal': ['battle-goals'],
  'battle-goals': ['battle-goals'],
  'personal-quest': ['personal-quests'],
  'personal-quests': ['personal-quests'],
  'character-mat': ['character-mats'],
  'character-mats': ['character-mats'],
};

const CARD_TYPE_BY_SOURCE_PREFIX: Record<string, CardType> = {
  scenario: 'scenarios',
  item: 'items',
  'monster-stat': 'monster-stats',
  'monster-ability': 'monster-abilities',
  'character-ability': 'character-abilities',
  'character-mat': 'character-mats',
  building: 'buildings',
  event: 'events',
  'battle-goal': 'battle-goals',
  'personal-quest': 'personal-quests',
};

const KIND_ALIASES: Record<string, KnowledgeKind> = {
  rules_passage: 'rules_passage',
  'rules-passage': 'rules_passage',
  rule: 'rules_passage',
  rules: 'rules_passage',
  rulebook: 'rules_passage',
  passage: 'rules_passage',
  scenario: 'scenario',
  scenarios: 'scenario',
  section: 'section',
  sections: 'section',
  card_type: 'card_type',
  'card-type': 'card_type',
  cardtype: 'card_type',
  type: 'card_type',
  card: 'card',
  cards: 'card',
  campaign: 'campaign',
  campaigns: 'campaign',
  character: 'character',
  characters: 'character',
  party: 'party',
  parties: 'party',
  roster: 'party',
  ...Object.fromEntries(Object.keys(CARD_KIND_ALIASES).map((alias) => [alias, 'card'])),
};

const ACTIVE_KINDS: KnowledgeKind[] = [
  'rules_passage',
  'scenario',
  'section',
  'card_type',
  'card',
  'campaign',
  'character',
  'party',
];

const SCHEMAS: Record<KnowledgeKind, Extract<SchemaResult, { ok: true }>> = {
  rules_passage: {
    ok: true,
    kind: 'rules_passage',
    refPattern: 'rules_passage:<game>/<source>#<chunk>',
    fields: [
      { name: 'text', type: 'string', description: 'Indexed book passage text' },
      { name: 'sourceLabel', type: 'string', description: 'Human-readable book label' },
      { name: 'score', type: 'number', description: 'Similarity score from vector search' },
    ],
    filterFields: ['game', 'source'],
    relations: [],
    examples: [{ label: 'Search loot rules', ref: 'rules_passage:frosthaven/rulebook#0' }],
    aliases: ['rule', 'rules', 'rulebook', 'passage'],
  },
  scenario: {
    ok: true,
    kind: 'scenario',
    refPattern: '<scenario-ref>',
    fields: [
      { name: 'scenarioIndex', type: 'string', description: 'Printed scenario number or code' },
      { name: 'name', type: 'string', description: 'Scenario title' },
      { name: 'complexity', type: 'number|null', description: 'Printed complexity value' },
      { name: 'sourcePage', type: 'number|null', description: 'Printed PDF page' },
    ],
    filterFields: ['scenarioIndex', 'name', 'scenarioGroup', 'complexity'],
    relations: [...BOOK_REFERENCE_TYPES],
    examples: [
      {
        label: 'Open scenario 61',
        ref: 'gloomhavensecretariat:scenario/061',
      },
    ],
    aliases: ['scenario', 'scenarios'],
  },
  section: {
    ok: true,
    kind: 'section',
    refPattern: '<section-number>.<variant>',
    fields: [
      { name: 'text', type: 'string', description: 'Section prose' },
      { name: 'sectionNumber', type: 'number', description: 'Section number before the dot' },
      { name: 'sectionVariant', type: 'number', description: 'Section variant after the dot' },
      { name: 'sourcePage', type: 'number', description: 'Printed PDF page' },
    ],
    filterFields: ['sectionNumber', 'sectionVariant'],
    relations: [...BOOK_REFERENCE_TYPES],
    examples: [{ label: 'Open section 67.1', ref: '67.1' }],
    aliases: ['section', 'sections'],
  },
  card_type: {
    ok: true,
    kind: 'card_type',
    refPattern: 'card_type:<game>/<card-type>',
    fields: [
      { name: 'type', type: 'string', description: 'Card table/type key' },
      { name: 'count', type: 'number', description: 'Available record count' },
    ],
    filterFields: ['type'],
    relations: ['belongs_to_type'],
    examples: [{ label: 'Open item card type', ref: 'card_type:frosthaven/items' }],
    aliases: ['card-type', 'cardtype', 'type'],
  },
  card: {
    ok: true,
    kind: 'card',
    refPattern: '<source-id>',
    fields: [
      { name: 'sourceId', type: 'string', description: 'GHS source identifier' },
      { name: 'name', type: 'string', description: 'Display name when present' },
      { name: 'cardName', type: 'string', description: 'Ability card name when present' },
      { name: 'type', type: 'string', description: 'Card type/table key' },
    ],
    filterFields: ['type', 'name', 'cardName', 'level', 'class', 'number'],
    relations: ['belongs_to_type'],
    examples: [
      {
        label: 'Open item 1',
        ref: 'card:frosthaven/items/gloomhavensecretariat:item/1',
      },
    ],
    aliases: Object.keys(CARD_KIND_ALIASES),
  },
  campaign: {
    ok: true,
    kind: 'campaign',
    refPattern: 'campaign:<game>/<campaign-id>',
    fields: [
      { name: 'name', type: 'string', description: 'Campaign name' },
      { name: 'game', type: 'string', description: 'Game id the campaign plays' },
      { name: 'modules', type: 'string[]', description: 'Active scenario-set modules' },
      { name: 'prosperity', type: 'number', description: 'Current prosperity level' },
      { name: 'activeScenario', type: 'string|null', description: 'Current focus scenario key' },
      { name: 'playedScenarios', type: 'string[]', description: 'Module-qualified played keys' },
      { name: 'drawnScenarios', type: 'string[]', description: 'Module-qualified drawn keys' },
      { name: 'members', type: 'object[]', description: 'Roster (name, email, role, status)' },
      {
        name: 'availability',
        type: 'object',
        description: 'Derived scenario availability: status counts, unlocked keys, hazards',
      },
      {
        name: 'recentJournal',
        type: 'object[]',
        description: 'Redacted journal days (private fields never appear)',
      },
    ],
    filterFields: ['name', 'game'],
    relations: ['has_character', 'has_party'],
    examples: [
      { label: 'Open a campaign', ref: 'campaign:frosthaven/00000000-0000-4000-8000-000000000000' },
    ],
    aliases: ['campaigns'],
  },
  character: {
    ok: true,
    kind: 'character',
    refPattern: 'character:<game>/<character-id>',
    fields: [
      { name: 'name', type: 'string', description: 'Character name' },
      { name: 'className', type: 'string', description: 'GHS class identity' },
      { name: 'level', type: 'number', description: 'Current level derived from XP' },
      { name: 'xp', type: 'number', description: 'Experience points' },
      { name: 'gold', type: 'number', description: 'Gold on hand' },
      { name: 'perks', type: 'number[]', description: 'Perk sheet indices' },
      { name: 'perkMarks', type: 'number', description: 'Earned perk mark count' },
      { name: 'masteries', type: 'number[]', description: 'Mastery sheet indices' },
      { name: 'items', type: 'object[]', description: 'Owned items as (game, sourceId) refs' },
      { name: 'cards', type: 'object[]', description: 'Ability cards with owned/active role' },
      {
        name: 'personalQuestSourceId',
        type: 'string|null',
        description: 'Private tier source id — present only when the caller owns the character',
      },
    ],
    filterFields: ['name'],
    relations: ['in_campaign'],
    examples: [
      {
        label: 'Open a character',
        ref: 'character:frosthaven/00000000-0000-4000-8000-000000000000',
      },
    ],
    aliases: ['characters'],
  },
  party: {
    ok: true,
    kind: 'party',
    refPattern: 'party:<game>/<campaign-id>',
    fields: [
      { name: 'campaignName', type: 'string', description: 'Owning campaign name' },
      { name: 'members', type: 'object[]', description: 'Roster (name, email, role, status)' },
      {
        name: 'characters',
        type: 'object[]',
        description: 'Member-visible character projections (no private tier)',
      },
    ],
    filterFields: [],
    relations: ['in_campaign', 'has_character'],
    examples: [
      {
        label: 'Open the party (one per campaign in v1; ref reuses the campaign id)',
        ref: 'party:frosthaven/00000000-0000-4000-8000-000000000000',
      },
    ],
    aliases: ['parties', 'roster'],
  },
};

function normalizeKind(kind: string): KnowledgeKind | null {
  return KIND_ALIASES[kind.trim().toLowerCase().replaceAll('_', '-')] ?? null;
}

function cardTypesForKinds(kinds?: string[]): CardType[] {
  if (!kinds || kinds.length === 0) return [...TYPES];
  const out = new Set<CardType>();
  for (const kind of kinds) {
    const normalized = kind.trim().toLowerCase().replaceAll('_', '-');
    if (normalized === 'card' || normalized === 'cards') {
      for (const type of TYPES) out.add(type);
    }
    if ((TYPES as readonly string[]).includes(normalized)) out.add(normalized as CardType);
    for (const type of CARD_KIND_ALIASES[normalized] ?? []) out.add(type);
  }
  return [...out];
}

type CharacterMatFallbackReason = 'explicit-mat' | 'class-data';

function characterMatFallbackReason(query: string): CharacterMatFallbackReason | null {
  if (/\b(?:character\s+mat|mat)\b/i.test(query)) return 'explicit-mat';
  if (/\b(?:perks?|negative item effects?)\b/i.test(query)) return 'class-data';
  return null;
}

function displayTitleForCard(record: Record<string, unknown>, type: CardType): string {
  if (typeof record.name === 'string') return record.name;
  if (typeof record.cardName === 'string') return record.cardName;
  if (typeof record.monsterType === 'string') return record.monsterType;
  if (typeof record.sourceId === 'string') return record.sourceId;
  return type;
}

function resolutionTitleForCard(record: Record<string, unknown>, type: CardType): string {
  const title = displayTitleForCard(record, type);
  if (type === 'monster-stats' && typeof record.levelRange === 'string') {
    return `${title} (levels ${record.levelRange})`;
  }
  return title;
}

function cardMatchConfidence(
  query: string,
  record: Record<string, unknown>,
  type: CardType,
): number {
  const normalizedQuery = query.trim().toLowerCase();
  const displayTitle = displayTitleForCard(record, type).toLowerCase();
  if (displayTitle === normalizedQuery) return 0.98;
  const names = [record.name, record.cardName, record.monsterType, record.sourceId]
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.toLowerCase());
  if (names.some((name) => name === normalizedQuery)) return 0.9;
  if (names.some((name) => normalizedQuery.includes(name) || name.includes(normalizedQuery))) {
    return 0.86;
  }
  return 0.68;
}

function cardMatchReason(query: string, record: Record<string, unknown>, type: CardType): string {
  const normalizedQuery = query.trim().toLowerCase();
  const displayTitle = displayTitleForCard(record, type).toLowerCase();
  if (displayTitle === normalizedQuery) return 'Exact card name';
  const names = [record.name, record.cardName, record.monsterType, record.sourceId]
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.toLowerCase());
  return names.some((name) => name === normalizedQuery)
    ? 'Related card deck match'
    : 'Card text match';
}

function extractLevelQuery(query: string): number | null {
  const match = query.match(/\b(?:level|lvl)\s+(\d+)\b|\bl\s*(\d+)\b/i);
  return match ? Number(match[1] ?? match[2]) : null;
}

function levelRangeIncludes(levelRange: unknown, level: number): boolean {
  if (typeof levelRange !== 'string') return false;
  const match = levelRange.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (!match) return false;
  const min = Number(match[1]);
  const max = Number(match[2]);
  return Number.isFinite(min) && Number.isFinite(max) && level >= min && level <= max;
}

function recordLevelMatches(
  type: CardType,
  record: Record<string, unknown>,
  level: number,
): boolean {
  if (type === 'monster-stats') return levelRangeIncludes(record.levelRange, level);

  const value = record.level;
  if (typeof value === 'number') return value === level;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value) === level;

  return false;
}

function normalizeScenarioCardIndex(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const match = String(value)
    .trim()
    .match(/^0*(\d{1,3}[A-Z]?)$/i);
  return match ? match[1].toUpperCase() : null;
}

function extractExactScenarioCardIndexQuery(query: string): string | null {
  const match = query.match(/\bscenario\s*#?\s*0*(\d{1,3}[A-Z]?)\b/i);
  return match ? match[1].toUpperCase() : null;
}

function extractExactItemNumberQuery(query: string): number | null {
  const match = query.match(/\bitems?\s*#?\s*0*(\d{1,3})\b/i);
  return match ? Number(match[1]) : null;
}

function normalizedCardNumber(record: Record<string, unknown>): number | null {
  const value = record.number;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const match = String(value).match(/^0*(\d{1,3})$/);
  return match ? Number(match[1]) : null;
}

function naturalCardSearchScore(
  query: string,
  record: Record<string, unknown>,
  type: CardType,
): number {
  let score = cardMatchConfidence(query, record, type);
  if (
    type === 'monster-stats' &&
    /\b(?:hp|hit points?|level|elite|normal|monsters?|stats?|stat block)\b/i.test(query) &&
    !/\b(?:abilit(?:y|ies)|deck)\b/i.test(query)
  ) {
    score += 0.1;
  }
  return score;
}

async function resolveCards(
  query: string,
  cardTypes: CardType[],
  limit: number,
  opts: ToolOpts,
): Promise<EntityCandidate[]> {
  if (query.trim() === '') return [];

  const normalizedOpts = normalizeToolOpts(opts);
  const game = normalizedOpts.game;
  const level = extractLevelQuery(query);
  const lowered = query.toLowerCase();
  const candidates: EntityCandidate[] = [];
  const exactItemNumber = cardTypes.includes('items') ? extractExactItemNumberQuery(query) : null;
  const exactScenarioIndex = cardTypes.includes('scenarios')
    ? extractExactScenarioCardIndexQuery(query)
    : null;

  for (const type of cardTypes) {
    const records = await load(type, normalizedOpts);
    for (const rawRecord of records) {
      const record = stripInternalKeys(rawRecord);
      if (level !== null && !recordLevelMatches(type, record, level)) continue;

      const sourceId = record.sourceId;
      if (typeof sourceId !== 'string') continue;
      const title = resolutionTitleForCard(record, type);
      if (type === 'items' && exactItemNumber !== null) {
        if (normalizedCardNumber(record) !== exactItemNumber) continue;
        candidates.push({
          entity: {
            kind: 'card',
            ref: canonicalCardRef(type, sourceId, game),
            title,
            source: `source:${game}/cards`,
            sourceLabel: 'GHS Card Data',
          },
          confidence: 0.99,
          matchReason: 'Exact item number',
        });
        continue;
      }
      if (type === 'scenarios' && exactScenarioIndex !== null) {
        const index = normalizeScenarioCardIndex(record.index);
        if (index !== exactScenarioIndex) continue;
        candidates.push({
          entity: {
            kind: 'card',
            ref: canonicalCardRef(type, sourceId, game),
            title,
            source: `source:${game}/cards`,
            sourceLabel: 'GHS Card Data',
          },
          confidence: 0.99,
          matchReason: 'Exact scenario index',
        });
        continue;
      }

      const searchable = [
        record.name,
        record.cardName,
        record.monsterType,
        record.characterClass,
        record.number,
        record.index,
        record.scenarioIndex,
        record.sourceId,
      ]
        .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
        .map((v) => String(v).toLowerCase());
      const matches = searchable.some(
        (value) => lowered.includes(value) || value.includes(lowered) || lowered.includes(type),
      );
      if (!matches) continue;

      candidates.push({
        entity: {
          kind: 'card',
          ref: canonicalCardRef(type, sourceId, game),
          title,
          source: `source:${game}/cards`,
          sourceLabel: 'GHS Card Data',
        },
        confidence: naturalCardSearchScore(query, record, type),
        matchReason: cardMatchReason(query, record, type),
      });
    }
  }

  if (candidates.length === 0) {
    const ranked = await searchExtractedRanked(query, limit, normalizedOpts);
    for (const { record } of ranked) {
      if (!cardTypes.includes(record._type)) continue;
      const stripped = stripInternalKeys(record);
      if (level !== null && !recordLevelMatches(record._type, stripped, level)) continue;
      const sourceId = stripped.sourceId;
      if (typeof sourceId !== 'string') continue;
      candidates.push({
        entity: {
          kind: 'card',
          ref: canonicalCardRef(record._type, sourceId, game),
          title: resolutionTitleForCard(stripped, record._type),
          source: `source:${game}/cards`,
          sourceLabel: 'GHS Card Data',
        },
        confidence: 0.68,
        matchReason: 'Card text match',
      });
    }
  }

  return candidates
    .sort((a, b) => b.confidence - a.confidence || a.entity.title.localeCompare(b.entity.title))
    .slice(0, limit);
}

function validateKinds(
  kinds?: string[],
): { ok: true; kinds: KnowledgeKind[] } | { ok: false; bad: string } {
  if (!kinds || kinds.length === 0) return { ok: true, kinds: [...ACTIVE_KINDS] };
  const resolved: KnowledgeKind[] = [];
  for (const kind of kinds) {
    const active = normalizeKind(kind);
    if (!active) return { ok: false, bad: kind };
    if (!resolved.includes(active)) resolved.push(active);
  }
  return { ok: true, kinds: resolved };
}

function sourceRefForPdf(game: string, source: string): string {
  return `source:${normalizeToolGame(game)}/${source.replace(/\.pdf$/i, '')}`;
}

function canonicalScenarioRef(ref: string, game = DEFAULT_GAME): string {
  const match = ref.match(/(\d{1,3}[A-Z]?)$/i);
  const scenarioId = match ? match[1].padStart(3, '0') : ref;
  return `scenario:${normalizeToolGame(game)}/${scenarioId}`;
}

function scenarioStorageRef(ref: string): string {
  const match = ref.match(/^scenario:([^/]+)\/(.+)$/);
  if (!match) return ref;
  return `gloomhavensecretariat:scenario/${match[2].padStart(3, '0')}`;
}

function sectionStorageRef(ref: string): string {
  return ref.replace(/^section:[^/]+\//, '');
}

function gameQualifiedRef(
  ref: string,
  prefix: 'scenario' | 'section',
  fallbackGame = DEFAULT_GAME,
): { game: GameId; ref: string } {
  const match = ref.match(new RegExp(`^${prefix}:([^/]+)/(.+)$`));
  return match
    ? { game: normalizeToolGame(match[1]), ref: match[2] }
    : { game: normalizeToolGame(fallbackGame), ref };
}

function canonicalSectionRef(ref: string, game = DEFAULT_GAME): string {
  return `section:${normalizeToolGame(game)}/${sectionStorageRef(ref)}`;
}

function canonicalCardRef(type: CardType, sourceId: string, game = DEFAULT_GAME): string {
  return `card:${normalizeToolGame(game)}/${type}/${sourceId}`;
}

function summarizeScenario(scenario: ScenarioResult, game = DEFAULT_GAME): KnowledgeEntitySummary {
  return {
    kind: 'scenario',
    ref: canonicalScenarioRef(scenario.ref, game),
    title: scenario.name || `Scenario ${scenario.scenarioIndex}`,
    sourceLabel: scenario.sourcePdf
      ? formatRetrievalSourceLabel(scenario.sourcePdf)
      : 'Scenario Book',
  };
}

function summarizeSection(section: SectionResult, game = DEFAULT_GAME): KnowledgeEntitySummary {
  return {
    kind: 'section',
    ref: canonicalSectionRef(section.ref, game),
    title: `Section ${section.ref}`,
    sourceLabel: formatRetrievalSourceLabel(section.sourcePdf),
  };
}

function summarizeRule(hit: ScoredEntry, game = DEFAULT_GAME): KnowledgeEntitySummary {
  const provenance = ruleSourceProvenance(hit.source, normalizeToolGame(game));
  return {
    kind: 'rules_passage',
    ref: `rules:${game}/${hit.source}#chunk=${hit.chunkIndex}`,
    title: `${provenance.sourceLabel} ${ruleSourceLocator(hit.chunkIndex)}`,
    sourceLabel: provenance.sourceLabel,
  };
}

function summarizeCard(
  type: CardType,
  card: Record<string, unknown>,
  game = DEFAULT_GAME,
): KnowledgeEntitySummary {
  const sourceId = String(card.sourceId ?? '');
  return {
    kind: 'card',
    ref: canonicalCardRef(type, sourceId, game),
    title: displayTitleForCard(card, type),
    sourceLabel: 'Card Index',
  };
}

function citationForScenario(scenario: ScenarioResult, game = DEFAULT_GAME): KnowledgeCitation[] {
  if (!scenario.sourcePdf) return [];
  return [
    {
      sourceRef: sourceRefForPdf(game, scenario.sourcePdf),
      sourceLabel: formatRetrievalSourceLabel(scenario.sourcePdf),
      locator: `scenario ${scenario.scenarioIndex}`,
    },
  ];
}

function citationForSection(section: SectionResult, game = DEFAULT_GAME): KnowledgeCitation[] {
  return [
    {
      sourceRef: sourceRefForPdf(game, section.sourcePdf),
      sourceLabel: formatRetrievalSourceLabel(section.sourcePdf),
      locator: `section ${section.ref}`,
    },
  ];
}

function citationForRule(hit: ScoredEntry, game = DEFAULT_GAME): KnowledgeCitation[] {
  const provenance = ruleSourceProvenance(hit.source, normalizeToolGame(game));
  return [
    {
      sourceRef: provenance.sourceRef,
      sourceType: provenance.sourceType,
      sourceLabel: provenance.sourceLabel,
      locator: ruleSourceLocator(hit.chunkIndex),
      ...(provenance.sourceUrl ? { sourceUrl: provenance.sourceUrl } : {}),
      ...(provenance.freshness ? { freshness: provenance.freshness } : {}),
    },
  ];
}

function citationForCard(
  type: CardType,
  sourceId: string,
  game = DEFAULT_GAME,
): KnowledgeCitation[] {
  return [
    {
      sourceRef: `source:${game}/cards/${type}`,
      sourceLabel: 'Card Index',
      locator: sourceId,
    },
  ];
}

function parseRulesRef(
  ref: string,
): { ok: true; game: GameId; source: string; chunkIndex: number } | { ok: false } {
  const match = ref.match(/^rules:([^/]+)\/(.+)#chunk=(\d+)$/);
  if (!match) return { ok: false };
  return {
    ok: true,
    game: normalizeToolGame(match[1]),
    source: match[2],
    chunkIndex: Number(match[3]),
  };
}

function parseCardRef(
  ref: string,
): { ok: true; game: GameId; type: CardType; sourceId: string } | { ok: false } {
  const match = ref.match(/^card:([^/]+)\/([^/]+)\/(.+)$/);
  if (match && TYPES.includes(match[2] as CardType)) {
    return {
      ok: true,
      game: normalizeToolGame(match[1]),
      type: match[2] as CardType,
      sourceId: match[3],
    };
  }

  const sourceIdMatch = ref.match(/^gloomhavensecretariat:([^/]+)\/(.+)$/);
  if (!sourceIdMatch) return { ok: false };
  const type = CARD_TYPE_BY_SOURCE_PREFIX[sourceIdMatch[1]];
  if (!type) return { ok: false };
  return {
    ok: true,
    game: DEFAULT_GAME,
    type,
    sourceId: `gloomhavensecretariat:${sourceIdMatch[1]}/${sourceIdMatch[2]}`,
  };
}

async function targetSummary(
  kind: BookRecordKind,
  ref: string,
  game = DEFAULT_GAME,
): Promise<KnowledgeEntitySummary> {
  if (kind === 'scenario') {
    const scenario = await getScenario(canonicalScenarioRef(ref, game), { game });
    if (scenario) return summarizeScenario(scenario, game);
    return {
      kind: 'scenario',
      ref: canonicalScenarioRef(ref, game),
      title: `Scenario ${ref.match(/(\d{1,3}[A-Z]?)$/i)?.[1] ?? ref}`,
      sourceLabel: 'Scenario Book',
    };
  }

  const section = await getSection(canonicalSectionRef(ref, game), { game });
  if (section) return summarizeSection(section, game);
  return {
    kind: 'section',
    ref: canonicalSectionRef(ref, game),
    title: `Section ${sectionStorageRef(ref)}`,
    sourceLabel: 'Section Book',
  };
}

async function linksFor(
  kind: BookRecordKind,
  ref: string,
  opts?: ToolOpts,
): Promise<KnowledgeLink[]> {
  const normalizedOpts = normalizeToolOpts(opts);
  const game = normalizedOpts.game;
  const links = await followLinks(kind, ref, undefined, normalizedOpts);
  return Promise.all(
    links.map(async (link) => ({
      relation: link.linkType,
      target: await targetSummary(link.toKind, link.toRef, game),
      reason: link.rawLabel ?? link.rawContext ?? undefined,
    })),
  );
}

// ─── Tools ───────────────────────────────────────────────────────────────────

/**
 * Search the indexed rule-source corpus for passages relevant to a query.
 * Returns structured results with text, raw source, display label, and
 * similarity score.
 *
 * `opts.game` is threaded through to `vector-store.search`, which filters
 * on the `game` column of the rule-source embeddings table. Defaults to
 * `'frosthaven'` when omitted.
 */
export async function searchRules(query: string, topK = 6, opts?: ToolOpts): Promise<RuleResult[]> {
  const queryEmbedding = await embed(query);
  const { game } = normalizeToolOpts(opts);
  const candidateLimit = currentRuleSourceCandidateLimit(topK, game, query);
  const rerankCandidateLimit = Math.max(candidateLimit, 40);
  const hits: ScoredEntry[] = await rerankRuleSourceHits(
    query,
    await search(queryEmbedding, rerankCandidateLimit, { game }),
    topK,
  );

  return rankRuleHitsForCurrentSources(hits, game, query)
    .slice(0, topK)
    .map((h) => ({
      text: h.text,
      source: h.source,
      sourceLocator: ruleSourceLocator(h.chunkIndex),
      score: h.score,
      ...ruleSourceProvenance(h.source, h.game),
    }));
}

/**
 * Search extracted card data using Postgres FTS.
 * Returns structured results with card type, data, and `ts_rank` score.
 */
export async function searchCards(query: string, topK = 6, opts?: ToolOpts): Promise<CardResult[]> {
  const normalizedOpts = normalizeToolOpts(opts);
  const level = extractLevelQuery(query);
  const naturalLevelMatches =
    level === null ? [] : await searchCardsByNaturalFields(query, topK, normalizedOpts);
  if (naturalLevelMatches.length > 0) return naturalLevelMatches;

  const ranked = await searchExtractedRanked(query, topK, normalizedOpts);
  const rankedLevelMatches =
    level === null
      ? ranked
      : ranked.filter(({ record }) =>
          recordLevelMatches(record._type, stripInternalKeys(record), level),
        );
  if (rankedLevelMatches.length === 0) {
    return searchCardsByNaturalFields(query, topK, normalizedOpts);
  }
  return rankedLevelMatches.map(({ record, score }) => {
    const { _type, ...rest } = record;
    return {
      type: _type,
      data: stripInternalKeys(rest),
      score,
    };
  });
}

async function searchCardsByNaturalFields(
  query: string,
  topK: number,
  opts: ToolOpts,
): Promise<CardResult[]> {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery === '') return [];

  const level = extractLevelQuery(query);
  const matches: CardResult[] = [];
  for (const type of TYPES) {
    const records = await load(type, opts);
    for (const rawRecord of records) {
      const record = stripInternalKeys(rawRecord);
      if (level !== null && !recordLevelMatches(type, record, level)) continue;

      const searchable = [
        record.name,
        record.cardName,
        record.monsterType,
        record.characterClass,
        record.number,
        record.sourceId,
      ]
        .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
        .map((v) => String(v).toLowerCase());
      const matchesNaturalName = searchable.some(
        (value) => normalizedQuery.includes(value) || value.includes(normalizedQuery),
      );
      if (!matchesNaturalName) continue;

      matches.push({
        type,
        data: record,
        score: naturalCardSearchScore(query, record, type),
      });
    }
  }

  return matches
    .sort((a, b) => {
      const scoreDelta = b.score - a.score;
      if (scoreDelta !== 0) return scoreDelta;
      return displayTitleForCard(a.data, a.type).localeCompare(displayTitleForCard(b.data, b.type));
    })
    .slice(0, topK);
}

// ─── Discovery tools ─────────────────────────────────────────────────────────

/**
 * List all available card types with record counts.
 * Agents use this for runtime capability discovery.
 */
export async function listCardTypes(opts?: ToolOpts): Promise<CardTypeInfo[]> {
  // Single UNION ALL of `count(*)` per type instead of N full-table scans.
  const counts = await countsByType(normalizeToolOpts(opts));
  return TYPES.map((type) => ({ type, count: counts[type] }));
}

/**
 * List cards of a given type, optionally filtered by field values.
 * Filter uses AND logic — all specified fields must match.
 */
export async function listCards(
  type: CardType,
  filter?: Record<string, unknown>,
  opts?: ToolOpts,
): Promise<Record<string, unknown>[]> {
  let records = await load(type, normalizeToolOpts(opts));

  if (filter) {
    records = records.filter((record) =>
      Object.entries(filter).every(([key, value]) => key in record && record[key] === value),
    );
  }

  return records.map(stripInternalKeys);
}

export async function inspectSources(opts?: ToolOpts): Promise<InspectSourcesResult> {
  const game = normalizeToolGame(opts?.game);
  const gameDefinition = gameDefinitionFor(game);
  const rulebook = ruleSourceProvenance(`${gameDefinition.sourcePrefix}-rule-book.pdf`, game);
  const [cardCounts, scenarioSectionStatus] = await Promise.all([
    countsByType({ game }),
    getScenarioSectionBooksBootstrapStatus({ game }),
  ]);
  const sources: SourceInfo[] = [
    {
      ref: `source:${game}/rulebook`,
      label: `${gameDefinition.label} Rulebook`,
      kinds: ['rules_passage'],
      searchable: true,
      openable: false,
      relations: [],
      sourceType: rulebook.sourceType,
      ...(rulebook.freshness ? { freshness: rulebook.freshness } : {}),
    },
  ];

  if (game === GLOOMHAVEN_2E_GAME_ID) {
    const faq = ruleSourceProvenance('gh2-faq.html', game);
    const errata = ruleSourceProvenance('gh2-errata.html', game);
    sources.push(
      {
        ref: `source:${game}/faq`,
        label: `${gameDefinition.label} FAQ`,
        kinds: ['rules_passage'],
        searchable: true,
        openable: false,
        relations: [],
        sourceType: faq.sourceType,
        ...(faq.freshness ? { freshness: faq.freshness } : {}),
      },
      {
        ref: `source:${game}/errata`,
        label: `${gameDefinition.label} Errata`,
        kinds: ['rules_passage'],
        searchable: true,
        openable: false,
        relations: [],
        sourceType: errata.sourceType,
        ...(errata.freshness ? { freshness: errata.freshness } : {}),
      },
    );
  }

  sources.push(
    {
      ref: `source:${game}/scenario-section-books`,
      label: 'Scenario and Section Books',
      kinds: ['scenario', 'section'],
      searchable: true,
      openable: true,
      relations: [...BOOK_REFERENCE_TYPES],
      counts: {
        scenario: scenarioSectionStatus.scenarioCount,
        section: scenarioSectionStatus.sectionCount,
        relation: scenarioSectionStatus.linkCount,
      },
    },
    {
      ref: `source:${game}/cards`,
      label: 'GHS Card Data',
      kinds: ['card_type', 'card'],
      searchable: true,
      openable: true,
      relations: ['belongs_to_type'],
      counts: cardCounts,
    },
  );

  // Campaign state appears only for an identified caller, scoped to their
  // memberships (SQR-269, ADR 0021).
  const campaignSource = await campaignSourceInfo(opts?.userId, game);
  if (campaignSource) sources.push(campaignSource);

  return {
    ok: true,
    games: GAME_INFO,
    sources,
    defaultGame: DEFAULT_GAME,
    warnings: scenarioSectionStatus.ready
      ? undefined
      : [scenarioSectionStatus.error ?? 'Scenario/section book metadata is unavailable.'],
  };
}

export function getSchema(kind: string): SchemaResult {
  const normalized = normalizeKind(kind);
  if (!normalized) {
    return {
      ok: false,
      error: 'unknown_kind',
      kind,
      hint: 'Call inspect_sources first and pass one of the returned kinds.',
    };
  }
  return SCHEMAS[normalized];
}

export async function resolveEntity(
  query: string,
  options: EntityResolutionOptions = {},
): Promise<EntityResolutionResult> {
  const normalizedOptions = normalizeToolOpts(options);
  const validation = validateKinds(options.kinds);
  if (!validation.ok) {
    return {
      ok: false,
      error: 'invalid_filter',
      query,
      hint: `Unknown kind filter: ${validation.bad}. Call inspect_sources first.`,
      candidates: [],
    };
  }

  const game = normalizedOptions.game;
  const limit = Math.min(Math.max(options.limit ?? 6, 1), 20);
  const candidates: EntityCandidate[] = [];
  const kinds = validation.kinds;

  if (kinds.includes('scenario')) {
    const exactNumber = query.match(/\bscenario\s*0*(\d{1,3})\b/i)?.[1];
    const scenarioQuery = exactNumber ? String(Number(exactNumber)) : query;
    for (const scenario of await findScenarios(scenarioQuery, limit, { game })) {
      const confidence =
        exactNumber && String(Number(exactNumber)) === scenario.scenarioIndex ? 0.99 : 0.86;
      candidates.push({
        entity: {
          kind: 'scenario',
          ref: scenario.ref,
          title: scenario.name,
          source: `source:${game}/scenario-section-books`,
          sourceLabel: formatRetrievalSourceLabel(scenario.sourcePdf ?? 'fh-scenario-book.pdf'),
        },
        confidence,
        matchReason: confidence === 0.99 ? 'Exact scenario number' : 'Scenario name match',
      });
    }
  }

  if (kinds.includes('section')) {
    const sectionRef = query.match(/\b(?:section\s*)?(\d+\.\d+)\b/i)?.[1];
    if (sectionRef) {
      const section = await loadSection(sectionRef, { game });
      if (section) {
        candidates.push({
          entity: {
            kind: 'section',
            ref: section.ref,
            title: `Section ${section.ref}`,
            source: `source:${game}/scenario-section-books`,
            sourceLabel: formatRetrievalSourceLabel(section.sourcePdf),
          },
          confidence: 0.99,
          matchReason: 'Exact section ref',
        });
      }
    }
  }

  if (kinds.includes('card_type')) {
    const lowered = query.toLowerCase();
    for (const type of TYPES) {
      if (lowered.includes(type) || lowered.includes(type.replaceAll('-', ' '))) {
        candidates.push({
          entity: {
            kind: 'card_type',
            ref: `card_type:${game}/${type}`,
            title: type,
            source: `source:${game}/cards`,
            sourceLabel: 'GHS Card Data',
          },
          confidence: 0.95,
          matchReason: 'Exact card type',
        });
      }
    }
  }

  if (kinds.includes('card')) {
    candidates.push(
      ...(await resolveCards(query, cardTypesForKinds(options.kinds), limit, normalizedOptions)),
    );
  }

  // Campaign-state kinds resolve only within the caller's memberships; with
  // no identity they contribute nothing (SQR-269, ADR 0021).
  const campaignCandidates = await resolveCampaignEntities(
    options.userId,
    game,
    query,
    kinds,
    limit,
  );
  candidates.push(...campaignCandidates);

  const matFallbackReason = kinds.includes('character') ? characterMatFallbackReason(query) : null;
  if (
    matFallbackReason &&
    !kinds.includes('card') &&
    (matFallbackReason === 'explicit-mat' || campaignCandidates.length === 0)
  ) {
    const matCandidates = await resolveCards(query, ['character-mats'], limit, normalizedOptions);
    candidates.push(
      ...matCandidates.map((candidate) => ({
        ...candidate,
        confidence:
          matFallbackReason === 'explicit-mat'
            ? Math.max(candidate.confidence, 0.94)
            : candidate.confidence,
        matchReason:
          matFallbackReason === 'explicit-mat' ? 'Character mat match' : candidate.matchReason,
      })),
    );
  }

  return {
    ok: true,
    query,
    candidates: candidates
      .sort((a, b) => b.confidence - a.confidence || a.entity.title.localeCompare(b.entity.title))
      .slice(0, limit),
  };
}

function summaryFromResolutionCandidate(candidate: EntityCandidate): KnowledgeEntitySummary | null {
  if (candidate.entity.kind === 'card_type') return null;
  return {
    kind: candidate.entity.kind,
    ref: candidate.entity.ref,
    title: candidate.entity.title,
    sourceLabel: candidate.entity.sourceLabel,
  };
}

function ambiguousLookupCandidates(candidates: EntityCandidate[]): KnowledgeEntitySummary[] {
  return candidates
    .map(summaryFromResolutionCandidate)
    .filter((candidate): candidate is KnowledgeEntitySummary => candidate !== null);
}

function lookupNeedsClarification(candidates: EntityCandidate[]): boolean {
  const [top, second] = candidates;
  if (!top) return false;
  if (top.confidence < LOOKUP_LOW_CONFIDENCE_THRESHOLD) return true;
  if (!second) return false;

  const confidenceGap = top.confidence - second.confidence;
  return (
    confidenceGap <= LOOKUP_TIE_MARGIN ||
    (top.confidence < 0.9 && confidenceGap <= LOOKUP_LOW_CONFIDENCE_MARGIN)
  );
}

export async function lookupEntity(
  query: string,
  options: EntityResolutionOptions = {},
): Promise<KnowledgeOpenResult> {
  const resolution = await resolveEntity(query, options);
  if (!resolution.ok) {
    return {
      ok: false,
      error: {
        code: 'invalid_filter',
        message: resolution.hint,
        hint: resolution.hint,
        candidates: [],
      },
    };
  }

  const candidates = resolution.candidates;
  if (candidates.length === 0) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No entity found for: ${query}`,
        hint: 'Try a more specific scenario, section, item, monster, or card name.',
      },
    };
  }

  if (lookupNeedsClarification(candidates)) {
    return {
      ok: false,
      error: {
        code: 'ambiguous',
        message: `Multiple possible matches for: ${query}`,
        hint: 'Ask again with the exact scenario, section, item number, card name, monster level, or source type.',
        candidates: ambiguousLookupCandidates(candidates),
      },
    };
  }

  const top = candidates[0];
  if (!top || top.entity.kind === 'card_type') {
    return {
      ok: false,
      error: {
        code: 'invalid_ref',
        message: `The resolved entity is not directly openable: ${query}`,
        hint: 'Ask for a specific scenario, section, item, monster stat card, or other card record.',
        candidates: ambiguousLookupCandidates(candidates),
      },
    };
  }

  // Preserve the full resolution options — crucially `userId` — so a
  // membership-scoped campaign/character/party ref reopens under the same
  // identity that resolved it. Rebuilding with only `game` would reopen
  // anonymously and fall into the indistinguishable not_found path (SQR-269).
  return openEntity(top.entity.ref, normalizeToolOpts(options));
}

/**
 * Look up a single card by type and `sourceId`.
 *
 * Per the storage-migration tech spec §"natural key verification", we resolve
 * against the canonical `sourceId` rather than per-type natural key fields:
 * four per-type natural keys had collisions in the real data, and using
 * `sourceId` everywhere sidesteps the ambiguity entirely. Match is
 * case-sensitive — `sourceId` is a canonical GHS identifier like
 * `gloomhavensecretariat:battle-goal/1301`, not a human-entered string.
 */
export async function getCard(
  type: CardType,
  id: string,
  opts?: ToolOpts,
): Promise<Record<string, unknown> | null> {
  // Indexed single-row lookup via `loadOne` — hits the `(game, source_id)`
  // unique index instead of loading every row and scanning client-side.
  const match = await loadOne(type, id, normalizeToolOpts(opts));
  if (!match) return null;
  return stripInternalKeys(match);
}

export async function findScenario(query: string, opts?: ToolOpts): Promise<ScenarioResult[]> {
  return findScenarios(query, 6, normalizeToolOpts(opts));
}

export async function getScenario(ref: string, opts?: ToolOpts): Promise<ScenarioResult | null> {
  return loadScenario(scenarioStorageRef(ref), normalizeToolOpts(opts));
}

export async function getSection(ref: string, opts?: ToolOpts): Promise<SectionResult | null> {
  return loadSection(sectionStorageRef(ref), normalizeToolOpts(opts));
}

export async function searchSections(
  query: string,
  limit = 6,
  opts?: ToolOpts,
): Promise<SectionResult[]> {
  return loadSections(query, limit, normalizeToolOpts(opts));
}

export async function followLinks(
  fromKind: BookRecordKind,
  fromRef: string,
  linkType?: BookReferenceType,
  opts?: ToolOpts,
): Promise<ReferenceResult[]> {
  const normalizedRef =
    fromKind === 'scenario' ? scenarioStorageRef(fromRef) : sectionStorageRef(fromRef);
  return loadReferences(fromKind, normalizedRef, linkType, normalizeToolOpts(opts));
}

export async function incomingLinks(
  toKind: BookRecordKind,
  toRef: string,
  linkType?: BookReferenceType,
  opts?: ToolOpts,
): Promise<ReferenceResult[]> {
  const normalizedRef =
    toKind === 'scenario' ? scenarioStorageRef(toRef) : sectionStorageRef(toRef);
  return loadIncomingReferences(toKind, normalizedRef, linkType, normalizeToolOpts(opts));
}

async function adjacentRulePassageContext(hit: ScoredEntry): Promise<RulePassageContext[]> {
  const candidates = await Promise.all(
    [hit.chunkIndex - 1, hit.chunkIndex + 1]
      .filter((chunkIndex) => chunkIndex >= 0)
      .map((chunkIndex) => getEntryBySourceChunk(hit.source, chunkIndex, { game: hit.game })),
  );

  return candidates
    .filter((candidate): candidate is ScoredEntry => candidate !== null)
    .sort((a, b) => a.chunkIndex - b.chunkIndex)
    .map((candidate) => {
      const entity = summarizeRule(candidate, candidate.game);
      return {
        ref: entity.ref,
        title: entity.title,
        text: candidate.text,
        chunkIndex: candidate.chunkIndex,
      };
    });
}

export async function openEntity(ref: string, opts?: ToolOpts): Promise<KnowledgeOpenResult> {
  const game = normalizeToolGame(opts?.game);

  // Campaign-shaped refs short-circuit to the membership-scoped campaign
  // branch (SQR-269); absent identity and non-membership are the same
  // not_found as an absent id.
  const campaignResult = await openCampaignEntity(opts?.userId, ref);
  if (campaignResult) return campaignResult;

  if (/^\d+$/.test(ref.trim())) {
    return {
      ok: false,
      error: {
        code: 'ambiguous',
        message: `Ref "${ref}" is ambiguous.`,
        hint: 'Use scenario:frosthaven/061, section:frosthaven/61.1, or a card ref.',
      },
    };
  }

  const ruleRef = parseRulesRef(ref);
  if (ruleRef.ok) {
    const hit = await getEntryBySourceChunk(ruleRef.source, ruleRef.chunkIndex, {
      game: ruleRef.game,
    });
    if (!hit) {
      return { ok: false, error: { code: 'not_found', message: `Rule passage not found: ${ref}` } };
    }
    const adjacentPassages = await adjacentRulePassageContext(hit);
    const entity = summarizeRule(hit, ruleRef.game);
    const provenance = ruleSourceProvenance(hit.source, ruleRef.game);
    return {
      ok: true,
      entity: {
        ...entity,
        data: {
          text: hit.text,
          game: hit.game,
          source: hit.source,
          sourceType: provenance.sourceType,
          sourceLabel: provenance.sourceLabel,
          sourceLocator: ruleSourceLocator(hit.chunkIndex),
          chunkIndex: hit.chunkIndex,
          adjacentPassages,
          ...(provenance.freshness ? { freshness: provenance.freshness } : {}),
        },
      },
      citations: citationForRule(hit, ruleRef.game),
      links: [],
      related: adjacentPassages.map((passage) => ({
        relation: 'adjacent_passage',
        target: {
          kind: 'rules_passage',
          ref: passage.ref,
          title: passage.title,
          sourceLabel: provenance.sourceLabel,
        },
        reason:
          passage.chunkIndex < hit.chunkIndex
            ? 'Previous passage from the same source.'
            : 'Next passage from the same source.',
      })),
    };
  }

  if (ref.startsWith('scenario:') || ref.startsWith('gloomhavensecretariat:scenario/')) {
    const parsed = gameQualifiedRef(ref, 'scenario', game);
    const scenario = await getScenario(
      ref.startsWith('scenario:')
        ? canonicalScenarioRef(parsed.ref, parsed.game)
        : canonicalScenarioRef(ref, parsed.game),
      {
        game: parsed.game,
      },
    );
    if (!scenario) {
      return { ok: false, error: { code: 'not_found', message: `Scenario not found: ${ref}` } };
    }
    const entity = summarizeScenario(scenario, parsed.game);
    return {
      ok: true,
      entity: {
        ...entity,
        data: {
          scenarioGroup: scenario.scenarioGroup,
          scenarioIndex: scenario.scenarioIndex,
          name: scenario.name,
          complexity: scenario.complexity,
          flowChartGroup: scenario.flowChartGroup,
          initial: scenario.initial,
          sourcePdf: scenario.sourcePdf,
          sourcePage: scenario.sourcePage,
          rawText: scenario.rawText,
          metadata: scenario.metadata,
        },
      },
      citations: citationForScenario(scenario, parsed.game),
      links: await linksFor('scenario', scenario.ref, { game: parsed.game }),
      related: [],
    };
  }

  if (ref.startsWith('section:') || /^\d+\.\d+$/.test(ref)) {
    const parsed = gameQualifiedRef(ref, 'section', game);
    const section = await getSection(parsed.ref, { game: parsed.game });
    if (!section) {
      return { ok: false, error: { code: 'not_found', message: `Section not found: ${ref}` } };
    }
    const entity = summarizeSection(section, parsed.game);
    return {
      ok: true,
      entity: {
        ...entity,
        data: {
          sectionNumber: section.sectionNumber,
          sectionVariant: section.sectionVariant,
          sourcePdf: section.sourcePdf,
          sourcePage: section.sourcePage,
          text: section.text,
          metadata: section.metadata,
        },
      },
      citations: citationForSection(section, parsed.game),
      links: await linksFor('section', section.ref, { game: parsed.game }),
      related: [],
    };
  }

  const cardRef = parseCardRef(ref);
  if (cardRef.ok) {
    const card = await getCard(cardRef.type, cardRef.sourceId, { game: cardRef.game });
    if (!card)
      return { ok: false, error: { code: 'not_found', message: `Card not found: ${ref}` } };
    const entity = summarizeCard(cardRef.type, card, cardRef.game);
    const sourceId = String(card.sourceId ?? cardRef.sourceId);
    return {
      ok: true,
      entity: {
        ...entity,
        data: {
          ...card,
          canonicalRef: entity.ref,
          type: cardRef.type,
          sourceId,
          displayName: displayTitleForCard(card, cardRef.type),
        },
      },
      citations: citationForCard(cardRef.type, sourceId, cardRef.game),
      links: [],
      related: [],
    };
  }

  return {
    ok: false,
    error: {
      code: 'invalid_ref',
      message: `Ref is not inspectable: ${ref}`,
      hint: 'Expected rules:<game>/<source>#chunk=N, scenario:<game>/<id>, section:<game>/<id>, or card:<game>/<type>/<sourceId>.',
    },
  };
}

export async function searchKnowledge(
  query: string,
  options: SearchKnowledgeOptions = {},
): Promise<KnowledgeSearchResult> {
  const game = normalizeToolGame(options.game);
  const scope = options.scope ?? ['rules_passage', 'scenario', 'section', 'card'];
  const limit = Math.min(Math.max(options.limit ?? 6, 1), 20);
  const allowed = new Set<KnowledgeEntityKind>(['rules_passage', 'scenario', 'section', 'card']);
  const invalid = scope.find((kind) => !allowed.has(kind));
  if (invalid) {
    return {
      ok: false,
      error: {
        code: 'invalid_filter',
        message: `Unsupported search scope: ${invalid}`,
        ...(['campaign', 'character', 'party'].includes(invalid)
          ? { hint: 'Campaign state is not searchable; use resolve_entity or open_entity.' }
          : {}),
      },
    };
  }

  const perScope = Math.ceil(limit / scope.length) + 1;
  const hits: KnowledgeSearchHit[] = [];

  if (scope.includes('rules_passage')) {
    const queryEmbedding = await embed(query);
    const candidateLimit = currentRuleSourceCandidateLimit(perScope, game, query);
    const rerankCandidateLimit = Math.max(candidateLimit, 40);
    const rules = await rerankRuleSourceHits(
      query,
      await search(queryEmbedding, rerankCandidateLimit, { game }),
      perScope,
    );
    hits.push(
      ...rankRuleHitsForCurrentSources(rules, game, query)
        .slice(0, perScope)
        .map((rule) => {
          const entity = summarizeRule(rule, game);
          return {
            entity,
            score: rule.score,
            scoreKind: rule.scoreKind,
            snippet: rule.text,
            citations: citationForRule(rule, game),
            nextRefs: [entity],
          };
        }),
    );
  }

  if (scope.includes('scenario')) {
    const scenarios = await findScenario(query, { game });
    hits.push(
      ...scenarios.slice(0, perScope).map((scenario) => {
        const entity = summarizeScenario(scenario, game);
        return {
          entity,
          score: 0.85,
          snippet: scenario.rawText ?? scenario.name,
          citations: citationForScenario(scenario, game),
          nextRefs: [entity],
        };
      }),
    );
  }

  if (scope.includes('section')) {
    const sectionQuery = query.trim();
    if (/^\d+\.\d+$/.test(sectionQuery)) {
      const section = await getSection(sectionQuery, { game });
      if (section) {
        const entity = summarizeSection(section, game);
        hits.push({
          entity,
          score: 0.95,
          snippet: section.text,
          citations: citationForSection(section, game),
          nextRefs: [entity],
        });
      }
    } else {
      const sections = await searchSections(query, perScope, { game });
      hits.push(
        ...sections.map((section) => {
          const entity = summarizeSection(section, game);
          return {
            entity,
            score: 0.8,
            snippet: section.text,
            citations: citationForSection(section, game),
            nextRefs: [entity],
          };
        }),
      );
    }
  }

  if (scope.includes('card')) {
    const cards = await searchCards(query, perScope, { game });
    hits.push(
      ...cards.map((card) => {
        const sourceId = String(card.data.sourceId ?? '');
        const entity = summarizeCard(card.type, card.data, game);
        return {
          entity,
          score: card.score,
          snippet: formatExtracted([{ ...card.data, _type: card.type }]),
          citations: citationForCard(card.type, sourceId, game),
          nextRefs: [entity],
        };
      }),
    );
  }

  hits.sort((a, b) => compareKnowledgeHits(a, b, query));
  return {
    ok: true,
    query,
    results: hits.slice(0, limit),
    truncated: hits.length > limit || undefined,
  };
}

export async function neighbors(
  ref: string,
  options: NeighborsOptions = {},
): Promise<KnowledgeNeighborsResult> {
  const game = normalizeToolGame(options.game);
  const relation = options.relation;

  const campaignResult = await campaignNeighbors(options.userId, ref, relation);
  if (campaignResult) return campaignResult;

  // Non-book kinds traverse the knowledge_edges substrate (ADR 0027) and
  // accept any edge type their ingest families define.
  if (/^(?:card|concept|rules):/.test(ref)) {
    return knowledgeEdgeNeighbors(ref, game, relation, options.limit);
  }

  if (relation && !BOOK_REFERENCE_TYPES.includes(relation as BookReferenceType)) {
    return {
      ok: false,
      error: { code: 'unsupported_relation', message: `Unsupported relation: ${relation}` },
    };
  }
  // Validated against BOOK_REFERENCE_TYPES just above.
  const bookRelation = relation as BookReferenceType | undefined;

  let kind: BookRecordKind;
  let storageRef: string;
  if (ref.startsWith('scenario:') || ref.startsWith('gloomhavensecretariat:scenario/')) {
    kind = 'scenario';
    storageRef = scenarioStorageRef(ref);
  } else if (ref.startsWith('section:') || /^\d+\.\d+$/.test(ref)) {
    kind = 'section';
    storageRef = sectionStorageRef(ref);
  } else if (ref.includes(':')) {
    return { ok: false, error: { code: 'not_found', message: `No neighbors for ref: ${ref}` } };
  } else {
    return { ok: false, error: { code: 'invalid_ref', message: `Ref is not traversable: ${ref}` } };
  }

  const opened = await openEntity(ref, { game });
  if (!opened.ok) return opened;
  if (opened.entity.kind !== 'scenario' && opened.entity.kind !== 'section') {
    return { ok: false, error: { code: 'not_found', message: `No neighbors for ref: ${ref}` } };
  }

  let links = await followLinks(kind, storageRef, bookRelation, { game });
  if (kind === 'scenario') {
    const incoming = await incomingLinks(kind, storageRef, bookRelation, { game });
    const seen = new Set(
      links.map(
        (link) => `${link.linkType}:${link.fromKind}:${link.fromRef}:${link.toKind}:${link.toRef}`,
      ),
    );
    links = [
      ...links,
      ...incoming.filter((link) => {
        const key = `${link.linkType}:${link.fromKind}:${link.fromRef}:${link.toKind}:${link.toRef}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    ];
  }
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const mapped = await Promise.all(
    links.slice(0, limit).map(async (link) => ({
      relation: link.linkType,
      target:
        link.fromKind === kind && link.fromRef === storageRef
          ? await targetSummary(link.toKind, link.toRef, game)
          : await targetSummary(link.fromKind, link.fromRef, game),
      reason: link.rawLabel ?? link.rawContext ?? undefined,
    })),
  );

  return {
    ok: true,
    from: opened.entity,
    neighbors: mapped,
    truncated: links.length > limit || undefined,
  };
}

/**
 * Traverse the knowledge_edges substrate (ADR 0027) for non-book refs.
 * Both directions are returned; reversed edges surface the far node so a
 * card can discover the scenarios or concepts that point at it.
 */
async function knowledgeEdgeNeighbors(
  ref: string,
  game: GameId,
  relation: string | undefined,
  limitOption?: number,
): Promise<KnowledgeNeighborsResult> {
  const { db } = getDb();
  const limit = Math.min(Math.max(limitOption ?? 20, 1), 50);

  const direction = or(eq(knowledgeEdges.fromRef, ref), eq(knowledgeEdges.toRef, ref));
  const where = relation
    ? and(eq(knowledgeEdges.game, game), eq(knowledgeEdges.edgeType, relation), direction)
    : and(eq(knowledgeEdges.game, game), direction);

  const rows = await db
    .select()
    .from(knowledgeEdges)
    .where(where)
    .limit(limit + 1);

  if (rows.length === 0) {
    return { ok: false, error: { code: 'not_found', message: `No neighbors for ref: ${ref}` } };
  }

  const kind = ref.split(':', 1)[0] as KnowledgeEntitySummary['kind'];
  const from: KnowledgeEntitySummary = { kind, ref, title: ref, sourceLabel: 'Knowledge Graph' };
  const neighbors = rows.slice(0, limit).map((edge) => {
    const outgoing = edge.fromRef === ref;
    const metadata = (edge.metadata ?? {}) as { rawLabel?: string; rawContext?: string };
    return {
      relation: edge.edgeType,
      target: {
        kind: (outgoing ? edge.toKind : edge.fromKind) as KnowledgeEntitySummary['kind'],
        ref: outgoing ? edge.toRef : edge.fromRef,
        title: outgoing ? edge.toRef : edge.fromRef,
        sourceLabel: 'Knowledge Graph',
      },
      reason: metadata.rawLabel ?? metadata.rawContext ?? undefined,
    };
  });

  return {
    ok: true,
    from,
    neighbors,
    truncated: rows.length > limit || undefined,
  };
}
