/**
 * Atomic search tools for the Squire knowledge platform.
 * These are standalone data access primitives that agents compose to answer questions.
 */

import { embed } from './embedder.ts';
import { formatRetrievalSourceLabel } from './retrieval-source.ts';
import { search } from './vector-store.ts';
import type { ScoredEntry } from './vector-store.ts';
import { countsByType, load, loadOne, searchExtractedRanked, TYPES } from './extracted-data.ts';
import type { CardType } from './schemas.ts';
import {
  findScenarios,
  getScenarioSectionBooksBootstrapStatus,
  getScenario as loadScenario,
  getSection as loadSection,
  followReferences as loadReferences,
} from './scenario-section-data.ts';
import {
  BOOK_REFERENCE_TYPES,
  type BookRecordKind,
  type BookReferenceType,
} from './scenario-section-schemas.ts';

// ─── Result types ────────────────────────────────────────────────────────────

export interface RuleResult {
  text: string;
  source: string;
  sourceLabel: string;
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
  counts?: Record<string, number>;
  freshness?: Record<string, string | number>;
}

export type KnowledgeKind = 'rules_passage' | 'scenario' | 'section' | 'card_type' | 'card';

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

interface ToolOpts {
  /** Campaign variant. Defaults to 'frosthaven'. Reserved for Phase 2. */
  game?: string;
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

const DEFAULT_GAME = 'frosthaven';
const GAME_INFO = { id: DEFAULT_GAME, label: 'Frosthaven', default: true };

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
};

const KIND_ALIASES: Record<string, KnowledgeKind> = {
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
  ...Object.fromEntries(Object.keys(CARD_KIND_ALIASES).map((alias) => [alias, 'card'])),
};

const ACTIVE_KINDS: KnowledgeKind[] = ['rules_passage', 'scenario', 'section', 'card_type', 'card'];

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
    refPattern: 'scenario:<game>/<scenario-ref>',
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
        ref: 'scenario:frosthaven/gloomhavensecretariat:scenario/061',
      },
    ],
    aliases: ['scenario', 'scenarios'],
  },
  section: {
    ok: true,
    kind: 'section',
    refPattern: 'section:<game>/<section-number>.<variant>',
    fields: [
      { name: 'text', type: 'string', description: 'Section prose' },
      { name: 'sectionNumber', type: 'number', description: 'Section number before the dot' },
      { name: 'sectionVariant', type: 'number', description: 'Section variant after the dot' },
      { name: 'sourcePage', type: 'number', description: 'Printed PDF page' },
    ],
    filterFields: ['sectionNumber', 'sectionVariant'],
    relations: [...BOOK_REFERENCE_TYPES],
    examples: [{ label: 'Open section 67.1', ref: 'section:frosthaven/67.1' }],
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
    refPattern: 'card:<game>/<card-type>/<source-id>',
    fields: [
      { name: 'sourceId', type: 'string', description: 'GHS source identifier' },
      { name: 'name', type: 'string', description: 'Display name when present' },
      { name: 'cardName', type: 'string', description: 'Ability card name when present' },
      { name: 'type', type: 'string', description: 'Card type/table key' },
    ],
    filterFields: ['type', 'name', 'cardName', 'level', 'class', 'number'],
    relations: ['belongs_to_type'],
    examples: [{ label: 'Open item 1', ref: 'card:frosthaven/items/gloomhavensecretariat:item/1' }],
    aliases: Object.keys(CARD_KIND_ALIASES),
  },
};

function normalizeKind(kind: string): KnowledgeKind | null {
  return KIND_ALIASES[kind.trim().toLowerCase()] ?? null;
}

function cardTypesForKinds(kinds?: string[]): CardType[] {
  if (!kinds || kinds.length === 0) return [...TYPES];
  const out = new Set<CardType>();
  for (const kind of kinds) {
    const normalized = kind.trim().toLowerCase();
    if (normalized === 'card' || normalized === 'cards') {
      for (const type of TYPES) out.add(type);
    }
    if ((TYPES as readonly string[]).includes(normalized)) out.add(normalized as CardType);
    for (const type of CARD_KIND_ALIASES[normalized] ?? []) out.add(type);
  }
  return [...out];
}

function canonicalScenarioRef(game: string, ref: string): string {
  return `scenario:${game}/${ref}`;
}

function canonicalSectionRef(game: string, ref: string): string {
  return `section:${game}/${ref}`;
}

function canonicalCardRef(game: string, type: CardType, sourceId: string): string {
  return `card:${game}/${type}/${sourceId}`;
}

function displayTitleForCard(record: Record<string, unknown>, type: CardType): string {
  if (typeof record.name === 'string') return record.name;
  if (typeof record.cardName === 'string') return record.cardName;
  if (typeof record.monsterType === 'string') return record.monsterType;
  if (typeof record.sourceId === 'string') return record.sourceId;
  return type;
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
  const match = query.match(/\blevel\s+(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

async function resolveCards(
  query: string,
  cardTypes: CardType[],
  limit: number,
  opts: ToolOpts,
): Promise<EntityCandidate[]> {
  if (query.trim() === '') return [];

  const game = opts.game ?? DEFAULT_GAME;
  const level = extractLevelQuery(query);
  const lowered = query.toLowerCase();
  const candidates: EntityCandidate[] = [];

  for (const type of cardTypes) {
    const records = await load(type, opts);
    for (const rawRecord of records) {
      const record = stripInternalKeys(rawRecord);
      if (level !== null && record.level !== level) continue;

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
      const matches = searchable.some(
        (value) => lowered.includes(value) || value.includes(lowered) || lowered.includes(type),
      );
      if (!matches) continue;

      const sourceId = record.sourceId;
      if (typeof sourceId !== 'string') continue;
      const title = displayTitleForCard(record, type);
      candidates.push({
        entity: {
          kind: 'card',
          ref: canonicalCardRef(game, type, sourceId),
          title,
          source: `source:${game}/cards`,
          sourceLabel: 'GHS Card Data',
          data: { ...record, cardType: type },
        },
        confidence: cardMatchConfidence(query, record, type),
        matchReason: cardMatchReason(query, record, type),
      });
    }
  }

  if (candidates.length === 0) {
    const ranked = await searchExtractedRanked(query, limit, opts);
    for (const { record } of ranked) {
      if (!cardTypes.includes(record._type)) continue;
      const stripped = stripInternalKeys(record);
      const sourceId = stripped.sourceId;
      if (typeof sourceId !== 'string') continue;
      candidates.push({
        entity: {
          kind: 'card',
          ref: canonicalCardRef(game, record._type, sourceId),
          title: displayTitleForCard(stripped, record._type),
          source: `source:${game}/cards`,
          sourceLabel: 'GHS Card Data',
          data: { ...stripped, cardType: record._type },
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

// ─── Tools ───────────────────────────────────────────────────────────────────

/**
 * Search the indexed Frosthaven book corpus for passages relevant to a query.
 * Returns structured results with text, raw source, display label, and
 * similarity score.
 *
 * `opts.game` is threaded through to `vector-store.search`, which filters
 * on the `game` column of the embeddings table. Defaults to `'frosthaven'`
 * when omitted.
 */
export async function searchRules(query: string, topK = 6, opts?: ToolOpts): Promise<RuleResult[]> {
  const queryEmbedding = await embed(query);
  const hits: ScoredEntry[] = await search(queryEmbedding, topK, { game: opts?.game });

  return hits.map((h) => ({
    text: h.text,
    source: h.source,
    sourceLabel: formatRetrievalSourceLabel(h.source),
    score: h.score,
  }));
}

/**
 * Search extracted card data using Postgres FTS.
 * Returns structured results with card type, data, and `ts_rank` score.
 */
export async function searchCards(query: string, topK = 6, opts?: ToolOpts): Promise<CardResult[]> {
  const ranked = await searchExtractedRanked(query, topK, opts);
  return ranked.map(({ record, score }) => {
    const { _type, ...rest } = record;
    return {
      type: _type,
      data: stripInternalKeys(rest),
      score,
    };
  });
}

// ─── Discovery tools ─────────────────────────────────────────────────────────

/**
 * List all available card types with record counts.
 * Agents use this for runtime capability discovery.
 */
export async function listCardTypes(opts?: ToolOpts): Promise<CardTypeInfo[]> {
  // Single UNION ALL of `count(*)` per type instead of N full-table scans.
  const counts = await countsByType(opts);
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
  let records = await load(type, opts);

  if (filter) {
    records = records.filter((record) =>
      Object.entries(filter).every(([key, value]) => key in record && record[key] === value),
    );
  }

  return records.map(stripInternalKeys);
}

export async function inspectSources(opts?: ToolOpts): Promise<InspectSourcesResult> {
  const game = opts?.game ?? DEFAULT_GAME;
  const [cardCounts, scenarioSectionStatus] = await Promise.all([
    countsByType({ game }),
    getScenarioSectionBooksBootstrapStatus({ game }),
  ]);

  return {
    ok: true,
    games: [GAME_INFO],
    sources: [
      {
        ref: `source:${game}/rulebook`,
        label: 'Frosthaven Rulebook',
        kinds: ['rules_passage'],
        searchable: true,
        openable: false,
        relations: [],
      },
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
    ],
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

  const game = options.game ?? DEFAULT_GAME;
  const limit = Math.min(Math.max(options.limit ?? 6, 1), 20);
  const candidates: EntityCandidate[] = [];
  const kinds = validation.kinds;

  if (kinds.includes('scenario')) {
    for (const scenario of await findScenarios(query, limit, { game })) {
      const exactNumber = query.match(/\bscenario\s*0*(\d{1,3})\b/i)?.[1];
      const confidence =
        exactNumber && String(Number(exactNumber)) === scenario.scenarioIndex ? 0.99 : 0.86;
      candidates.push({
        entity: {
          kind: 'scenario',
          ref: canonicalScenarioRef(game, scenario.ref),
          title: scenario.name,
          source: `source:${game}/scenario-section-books`,
          sourceLabel: formatRetrievalSourceLabel(scenario.sourcePdf ?? 'fh-scenario-book.pdf'),
          data: scenario,
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
            ref: canonicalSectionRef(game, section.ref),
            title: `Section ${section.ref}`,
            source: `source:${game}/scenario-section-books`,
            sourceLabel: formatRetrievalSourceLabel(section.sourcePdf),
            data: section,
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
            data: { cardType: type },
          },
          confidence: 0.95,
          matchReason: 'Exact card type',
        });
      }
    }
  }

  if (kinds.includes('card')) {
    candidates.push(
      ...(await resolveCards(query, cardTypesForKinds(options.kinds), limit, { game })),
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
  const match = await loadOne(type, id, opts);
  if (!match) return null;
  return stripInternalKeys(match);
}

export async function findScenario(query: string, opts?: ToolOpts): Promise<ScenarioResult[]> {
  return findScenarios(query, 6, opts);
}

export async function getScenario(ref: string, opts?: ToolOpts): Promise<ScenarioResult | null> {
  return loadScenario(ref, opts);
}

export async function getSection(ref: string, opts?: ToolOpts): Promise<SectionResult | null> {
  return loadSection(ref, opts);
}

export async function followLinks(
  fromKind: BookRecordKind,
  fromRef: string,
  linkType?: BookReferenceType,
  opts?: ToolOpts,
): Promise<ReferenceResult[]> {
  return loadReferences(fromKind, fromRef, linkType, opts);
}
