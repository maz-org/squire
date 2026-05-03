/**
 * Search and format extracted card data for use as RAG context.
 *
 * Backed by Postgres — the `card_*` tables seeded via `scripts/seed-cards.ts`.
 * Full-text search runs against the per-table `search_vector` stored generated
 * columns (see `src/db/migrations/0002_card_fts.sql`), ranked with `ts_rank`
 * over `websearch_to_tsquery('english', ...)`.
 *
 * There is NO flat-file fallback — per Decision 9 of the storage-migration
 * tech spec, if the DB is unreachable we throw a clear error rather than
 * silently serving stale JSON.
 */

import { getTableColumns, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

import { getDb } from './db.ts';
import {
  cardBattleGoals,
  cardBuildings,
  cardCharacterAbilities,
  cardCharacterMats,
  cardEvents,
  cardItems,
  cardMonsterAbilities,
  cardMonsterStats,
  cardPersonalQuests,
  cardScenarios,
} from './db/schema/cards.ts';
import type { CardType } from './schemas.ts';

export const TYPES: CardType[] = [
  'monster-stats',
  'monster-abilities',
  'character-abilities',
  'character-mats',
  'items',
  'events',
  'battle-goals',
  'buildings',
  'scenarios',
  'personal-quests',
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface ExtractedRecord extends Record<string, unknown> {
  _type: CardType;
}

interface LoadOpts {
  /** Campaign variant. Defaults to 'frosthaven'. Reserved for Phase 2. */
  game?: string;
}

// ─── Table registry ──────────────────────────────────────────────────────────

const TYPE_TO_TABLE: Record<CardType, PgTable> = {
  'monster-stats': cardMonsterStats,
  'monster-abilities': cardMonsterAbilities,
  'character-abilities': cardCharacterAbilities,
  'character-mats': cardCharacterMats,
  items: cardItems,
  events: cardEvents,
  'battle-goals': cardBattleGoals,
  buildings: cardBuildings,
  scenarios: cardScenarios,
  'personal-quests': cardPersonalQuests,
};

/** Columns excluded from the returned record shape. */
const HIDDEN_COLUMNS = new Set(['id', 'game', 'searchVector']);

/**
 * Given a Drizzle table, emit the SQL columns we want to expose in an
 * `ExtractedRecord` — everything except the hidden internals.
 */
function visibleColumns(table: PgTable): Array<{ tsKey: string; sqlName: string }> {
  const cols = getTableColumns(table);
  return Object.entries(cols)
    .filter(([tsKey]) => !HIDDEN_COLUMNS.has(tsKey))
    .map(([tsKey, col]) => ({ tsKey, sqlName: (col as { name: string }).name }));
}

/**
 * Build a `jsonb_build_object('tsKey', col, ...)` SQL fragment for a table's
 * visible columns. Used by the FTS UNION so the driver hands us a fully
 * reshaped record per row.
 */
function tableToJsonbObject(table: PgTable): ReturnType<typeof sql> {
  const cols = visibleColumns(table);
  const parts = cols.map(
    ({ tsKey, sqlName }) => sql`${sql.raw(`'${tsKey}'`)}, ${sql.identifier(sqlName)}`,
  );
  // Manual join — drizzle's sql.join is available but we need interleaved commas.
  let body = sql`${parts[0]}`;
  for (let i = 1; i < parts.length; i++) body = sql`${body}, ${parts[i]}`;
  return sql`jsonb_build_object(${body})`;
}

// ─── Loading ─────────────────────────────────────────────────────────────────

/**
 * Load every record of a given card type from the DB. Results are ordered
 * by `source_id` so they align with the pre-migration parity snapshots.
 *
 * Throws if the DB is unreachable — no JSON fallback.
 */
/**
 * Build the `col1 AS "tsKey1", col2 AS "tsKey2", ...` projection for a
 * table, preserving camelCase aliases so the pg driver hands us rows with
 * TS-shaped keys. Shared between `load` and `loadOne`.
 */
function visibleSelectList(table: PgTable): ReturnType<typeof sql> {
  const cols = visibleColumns(table);
  const parts = cols.map(
    ({ tsKey, sqlName }) => sql`${sql.identifier(sqlName)} AS ${sql.identifier(tsKey)}`,
  );
  let out = sql`${parts[0]}`;
  for (let i = 1; i < parts.length; i++) out = sql`${out}, ${parts[i]}`;
  return out;
}

/**
 * Per-type row normalizers. The DB stores every value in a column, and some
 * columns lose type information (e.g. `card_character_abilities.level` is
 * `text` so it can hold both numeric levels and the `"X"` sentinel for
 * lost/no-level cards). Normalizers restore the original type so the
 * `load()` output matches the shape of `data/extracted/<type>.json`
 * (modulo null/undefined normalization; the parity test in
 * `test/extracted-data.test.ts` enforces this end-to-end).
 */
const ROW_NORMALIZERS: Partial<Record<CardType, (row: Record<string, unknown>) => void>> = {
  'character-abilities': (row) => {
    // `level` is stored as text so "X" can round-trip; numeric levels come
    // back as strings like "1". Restore the number where possible.
    const lvl = row.level;
    if (typeof lvl === 'string' && lvl !== 'X' && /^-?\d+$/.test(lvl)) {
      row.level = Number(lvl);
    }
  },
};

function normalizeRow(type: CardType, row: Record<string, unknown>): Record<string, unknown> {
  ROW_NORMALIZERS[type]?.(row);
  return row;
}

const RELAXED_CONDITION_SEARCH_TERMS = new Set([
  'bane',
  'bless',
  'brittle',
  'condition',
  'conditions',
  'curse',
  'disarm',
  'immobilize',
  'immune',
  'immunity',
  'immunities',
  'impair',
  'invisible',
  'muddle',
  'poison',
  'regenerate',
  'strengthen',
  'stun',
  'ward',
  'wound',
]);

function relaxedConditionSearchQuery(query: string): string | null {
  const tokens = query.match(/[a-zA-Z0-9]+(?:[-'][a-zA-Z0-9]+)*/g) ?? [];
  if (tokens.length < 2) return null;

  const relaxed = tokens.filter(
    (token) => !RELAXED_CONDITION_SEARCH_TERMS.has(token.toLowerCase()),
  );
  if (relaxed.length === tokens.length || relaxed.length < 2) return null;
  return relaxed.join(' ');
}

export async function load(type: CardType, opts: LoadOpts = {}): Promise<ExtractedRecord[]> {
  const { db } = getDb();
  const table = TYPE_TO_TABLE[type];
  const game = opts.game ?? 'frosthaven';

  const rows = await db.execute<Record<string, unknown>>(
    sql`SELECT ${visibleSelectList(table)} FROM ${table} WHERE game = ${game} ORDER BY source_id`,
  );

  return rows.rows.map((r) => ({ ...normalizeRow(type, r), _type: type }));
}

/**
 * Fetch a single record by its canonical `source_id`. Uses the
 * `(game, source_id)` unique index for an O(1) lookup instead of scanning
 * the full table client-side the way the MVP version of `tools.getCard`
 * used to. Returns `null` if no row matches.
 */
export async function loadOne(
  type: CardType,
  sourceId: string,
  opts: LoadOpts = {},
): Promise<ExtractedRecord | null> {
  const { db } = getDb();
  const table = TYPE_TO_TABLE[type];
  const game = opts.game ?? 'frosthaven';

  const rows = await db.execute<Record<string, unknown>>(
    sql`SELECT ${visibleSelectList(table)} FROM ${table}
        WHERE game = ${game} AND source_id = ${sourceId}
        LIMIT 1`,
  );

  const row = rows.rows[0];
  return row ? { ...normalizeRow(type, row), _type: type } : null;
}

/**
 * Record counts for every card type in a single round-trip. Used by
 * `tools.listCardTypes` and `extractedStats` to avoid the N full-table
 * scans the naive "load every row and count" implementation would do.
 *
 * Returns a `Record<CardType, number>` with every key populated (0 for
 * types that have no rows), so callers can iterate `TYPES` without
 * defensive fallbacks.
 */
export async function countsByType(opts: LoadOpts = {}): Promise<Record<CardType, number>> {
  const { db } = getDb();
  const game = opts.game ?? 'frosthaven';

  const branches = TYPES.map(
    (type) => sql`
      SELECT ${sql.raw(`'${type}'`)} AS type, count(*)::int AS n
      FROM ${TYPE_TO_TABLE[type]}
      WHERE game = ${game}
    `,
  );
  let unioned = sql`${branches[0]}`;
  for (let i = 1; i < branches.length; i++) unioned = sql`${unioned} UNION ALL ${branches[i]}`;

  const rows = await db.execute<{ type: CardType; n: number }>(unioned);
  const counts: Record<string, number> = {};
  for (const type of TYPES) counts[type] = 0;
  for (const r of rows.rows) counts[r.type] = r.n;
  return counts as Record<CardType, number>;
}

// ─── Search ──────────────────────────────────────────────────────────────────

/**
 * FTS-ranked search across all 10 card tables. Each branch of the UNION ALL
 * builds a `jsonb_build_object(...)` payload from that table's visible
 * columns, filters on `search_vector @@ websearch_to_tsquery('english', $q)`,
 * and ranks with `ts_rank`. The outer wrapper orders and limits globally.
 */
export async function searchExtractedRanked(
  query: string,
  k = 6,
  opts: LoadOpts = {},
): Promise<Array<{ record: ExtractedRecord; score: number }>> {
  const { db } = getDb();
  const game = opts.game ?? 'frosthaven';
  const relaxedQuery = relaxedConditionSearchQuery(query);
  const queries = relaxedQuery ? [query, relaxedQuery] : [query];

  // `ts_rank`'s weight vector maps to {D, C, B, A} — this gives a direct
  // name-field match (weight 'A') ~10x the score of a cross-reference
  // array hit (weight 'D'). Without this, a scenario that lists "Algox
  // Archer" in its monsters array outranks the actual monster-stats row
  // for Algox Archer. The weight labels themselves are assigned in the
  // generated-column expressions in `src/db/migrations/0002_card_fts.sql`.
  const weightVec = sql`'{0.1, 0.2, 0.4, 1.0}'::float4[]`;
  for (const searchQuery of queries) {
    const branches = TYPES.map((type) => {
      const table = TYPE_TO_TABLE[type];
      const payload = tableToJsonbObject(table);
      return sql`
        SELECT
          ${sql.raw(`'${type}'`)} AS card_type,
          ${payload} AS payload,
          ts_rank(${weightVec}, search_vector, websearch_to_tsquery('english', ${searchQuery})) AS score
        FROM ${table}
        WHERE game = ${game} AND search_vector @@ websearch_to_tsquery('english', ${searchQuery})
      `;
    });

    let unioned = sql`${branches[0]}`;
    for (let i = 1; i < branches.length; i++) unioned = sql`${unioned} UNION ALL ${branches[i]}`;

    const rows = await db.execute<{
      card_type: CardType;
      payload: Record<string, unknown>;
      score: number;
    }>(sql`SELECT card_type, payload, score FROM (${unioned}) s ORDER BY score DESC LIMIT ${k}`);

    if (rows.rows.length > 0 || searchQuery === queries[queries.length - 1]) {
      return rows.rows.map((r) => ({
        record: {
          ...normalizeRow(r.card_type, r.payload as Record<string, unknown>),
          _type: r.card_type,
        } as ExtractedRecord,
        score: Number(r.score),
      }));
    }
  }

  return [];
}

/**
 * Top-k relevant extracted records for a query. Thin wrapper over
 * `searchExtractedRanked` that drops the score.
 */
export async function searchExtracted(
  query: string,
  k = 6,
  opts: LoadOpts = {},
): Promise<ExtractedRecord[]> {
  const ranked = await searchExtractedRanked(query, k, opts);
  return ranked.map((r) => r.record);
}

// ─── Text representation ─────────────────────────────────────────────────────
// Unchanged from the JSON-backed version — pure functions over a record.

function formatResourceEntries(resources: Record<string, unknown>): string[] {
  return Object.entries(resources)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .map(([resource, amount]) => `${amount} ${resource}`);
}

function formatItemCraftCost(craftCost: unknown): string | null {
  if (!craftCost || typeof craftCost !== 'object' || Array.isArray(craftCost)) return null;
  const cost = craftCost as { resources?: unknown; resourcesAny?: unknown };
  const parts =
    cost.resources && typeof cost.resources === 'object' && !Array.isArray(cost.resources)
      ? formatResourceEntries(cost.resources as Record<string, unknown>)
      : [];

  if (Array.isArray(cost.resourcesAny)) {
    for (const choice of cost.resourcesAny) {
      if (!choice || typeof choice !== 'object' || Array.isArray(choice)) continue;
      const entries = formatResourceEntries(choice as Record<string, unknown>);
      if (entries.length > 0) parts.push(`any ${entries.join(', ')}`);
    }
  }

  return parts.length > 0 ? `Craft cost: ${parts.join(', ')}` : null;
}

function formatBuildingCost(cost: unknown): string {
  if (!cost || typeof cost !== 'object' || Array.isArray(cost)) return 'unknown';
  const values = Object.values(cost as Record<string, unknown>);
  const knownCosts = values.filter((v): v is number => typeof v === 'number');
  const hasUnknownCosts = values.some((v) => v === null);
  const costEntries = Object.entries(cost as Record<string, unknown>).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] !== 0,
  );
  if (costEntries.length > 0) return costEntries.map(([k, v]) => `${v} ${k}`).join(', ');
  if (!hasUnknownCosts && knownCosts.length > 0 && knownCosts.every((v) => v === 0)) {
    return 'no cost';
  }
  return 'unknown';
}

function recordToText(record: ExtractedRecord): string {
  const t = record._type;

  if (t === 'monster-stats') {
    const r = record as ExtractedRecord;
    const normal = r.normal as Record<string, Record<string, number | null>> | undefined;
    const elite = r.elite as Record<string, Record<string, number | null>> | undefined;
    const levels = Object.entries(normal || {})
      .map(([l, s]) => `Level ${l}: Normal(HP ${s?.hp}, Move ${s?.move}, Attack ${s?.attack})`)
      .join('; ');
    const eliteLevels = Object.entries(elite || {})
      .map(([l, s]) => `Level ${l}: Elite(HP ${s?.hp}, Move ${s?.move}, Attack ${s?.attack})`)
      .join('; ');
    const immunityValues = Array.isArray(r.immunities) ? (r.immunities as string[]) : null;
    const immunities = immunityValues
      ? `Immunities: ${immunityValues.length > 0 ? immunityValues.join(', ') : 'none'}. `
      : '';
    const notes = r.notes ? `Notes: ${r.notes}` : '';
    return `Monster: ${r.name} (levels ${r.levelRange}). ${levels}. ${eliteLevels}. ${immunities}${notes}`;
  }

  if (t === 'monster-abilities') {
    const r = record as ExtractedRecord;
    const abilities = ((r.abilities as string[]) || []).join('; ');
    return `Monster Ability Card — ${r.monsterType}: "${r.cardName}" (initiative ${r.initiative}). Abilities: ${abilities}`;
  }

  if (t === 'character-abilities') {
    const r = record as ExtractedRecord;
    const top = r.top as { action: string; effects?: string[] } | undefined;
    const bottom = r.bottom as { action: string; effects?: string[] } | undefined;
    const topStr = top
      ? `Top: ${top.action}${top.effects?.length ? ' — ' + top.effects.join(', ') : ''}`
      : '';
    const botStr = bottom
      ? `Bottom: ${bottom.action}${bottom.effects?.length ? ' — ' + bottom.effects.join(', ') : ''}`
      : '';
    const lost = r.lost ? ' [LOST]' : '';
    return `Character Ability — ${(r.characterClass as string) || 'Unknown'} Level ${r.level ?? '?'}: "${r.cardName}" (initiative ${r.initiative}). ${topStr}. ${botStr}.${lost}`;
  }

  if (t === 'character-mats') {
    const r = record as ExtractedRecord;
    const hp = r.hp as Record<string, number> | undefined;
    const hpStr = Object.entries(hp || {})
      .map(([l, v]) => `L${l}=${v}`)
      .join(', ');
    const traits = (r.traits as string[])?.length
      ? `Traits: ${(r.traits as string[]).join(', ')}. `
      : '';
    const perks = (r.perks as string[])?.length
      ? `Perks: ${(r.perks as string[]).join('; ')}. `
      : '';
    const masteries = (r.masteries as string[])?.length
      ? `Masteries: ${(r.masteries as string[]).join('; ')}.`
      : '';
    // Split mats (e.g. Geminate) arrive as a `[form1, form2]` tuple; render
    // as "7 / 7 (split)" so the agent/FTS can distinguish them from scalar
    // hand sizes. See SQR-63 and src/schemas.ts#CharacterMatSchema.
    const handSize = Array.isArray(r.handSize)
      ? `${(r.handSize as number[]).join(' / ')} (split)`
      : r.handSize;
    return `Character Mat — ${r.name} (${r.characterClass}). Hand size: ${handSize}. ${traits}HP: ${hpStr}. ${perks}${masteries}`;
  }

  if (t === 'items') {
    const r = record as ExtractedRecord;
    const uses = r.uses ? ` (${r.uses} uses)` : '';
    const spent = r.spent ? ' [spent]' : '';
    const lost = r.lost ? ' [lost]' : '';
    const craftCostText = formatItemCraftCost(r.craftCost);
    const costParts = [
      typeof r.cost === 'number' ? `Cost: ${r.cost}g` : null,
      craftCostText,
    ].filter((part): part is string => part !== null);
    const costText = costParts.length > 0 ? costParts.join('. ') : 'Cost: not shown';
    return `Item #${r.number}: ${r.name}. Slot: ${r.slot}. ${costText}. Effect: ${r.effect}${uses}${spent}${lost}`;
  }

  if (t === 'events') {
    const r = record as ExtractedRecord;
    const season = r.season ? `${r.season} ` : '';
    const optA = r.optionA as { text: string; outcome: string } | undefined;
    const optB = r.optionB as { text: string; outcome: string } | null | undefined;
    const a = optA ? `Option A: "${optA.text}" → ${optA.outcome}` : '';
    const b = optB ? `Option B: "${optB.text}" → ${optB.outcome}` : '';
    return `${season}${r.eventType} event #${r.number}: ${r.flavorText} ${a} ${b}`.trim();
  }

  if (t === 'battle-goals') {
    const r = record as ExtractedRecord;
    return `Battle Goal: "${r.name}". Condition: ${r.condition}. Checkmarks: ${r.checkmarks}.`;
  }

  if (t === 'personal-quests') {
    const r = record as ExtractedRecord;
    const reqs =
      (r.requirements as Array<{
        description: string;
        target: number | string;
        options: string[] | null;
        dependsOn: number[] | null;
      }>) || [];
    const reqText = reqs
      .map((req, i) => {
        let line = `${i + 1}. ${req.description} (target: ${req.target})`;
        if (req.options) line += ` [${req.options.join(', ')}]`;
        if (req.dependsOn) line += ` (requires step ${req.dependsOn.join(', ')})`;
        return line;
      })
      .join('; ');
    return `Personal Quest #${r.cardId}: "${r.name}". Requirements: ${reqText}. Completion: open envelope ${r.openEnvelope}.`;
  }

  if (t === 'buildings') {
    const r = record as ExtractedRecord;
    if ('initialBuildCost' in r || 'upgradeCost' in r || 'campaignStartBuilt' in r) {
      const level = typeof r.level === 'number' ? r.level : Number(r.level);
      const upgradeCost = r.upgradeCost
        ? `Level ${Number.isFinite(level) ? level : r.level} upgrade cost: ${formatBuildingCost(r.upgradeCost)}. `
        : '';
      return `Building #${r.buildingNumber} — ${r.name} Level ${r.level}. Starts built at campaign start: ${r.campaignStartBuilt ? 'yes' : 'no'}. Initial build cost: ${formatBuildingCost(r.initialBuildCost)}. ${upgradeCost}Effect: ${r.effect}. ${(r.notes as string) || ''}`.trim();
    }
    return `Building #${r.buildingNumber} — ${r.name} Level ${r.level}. Cost: ${formatBuildingCost(r.buildCost)}. Effect: ${r.effect}. ${(r.notes as string) || ''}`.trim();
  }

  if (t === 'scenarios') {
    const r = record as ExtractedRecord;
    const monsters = (r.monsters as string[])?.length
      ? `Monsters: ${(r.monsters as string[]).join(', ')}.`
      : '';
    const allies = (r.allies as string[])?.length
      ? ` Allies: ${(r.allies as string[]).join(', ')}.`
      : '';
    const unlocks = (r.unlocks as string[])?.length
      ? ` Unlocks: ${(r.unlocks as string[]).join(', ')}.`
      : '';
    const rewards = r.rewards ? ` Rewards: ${r.rewards}.` : '';
    const loot = r.lootDeckConfig as Record<string, number> | undefined;
    const lootStr = loot
      ? ` Loot: ${Object.entries(loot)
          .map(([k, v]) => `${v} ${k}`)
          .join(', ')}.`
      : '';
    const initial = r.initial ? ' [Starting scenario]' : '';
    const complexity = r.complexity == null ? '' : ` (Complexity ${r.complexity as number})`;
    return `Scenario #${r.index}: ${r.name}${complexity}.${initial} ${monsters}${allies}${unlocks}${rewards}${lootStr}`.trim();
  }

  return JSON.stringify(record);
}

/**
 * Format extracted records as a readable string for LLM context.
 */
export function formatExtracted(records: ExtractedRecord[]): string {
  if (records.length === 0) return '';
  return records.map((r) => recordToText(r)).join('\n');
}

// ─── Stats ───────────────────────────────────────────────────────────────────

/**
 * Record counts across all 10 card tables. Single round-trip via a CTE.
 */
export async function extractedStats(): Promise<string> {
  const counts = await countsByType();
  return TYPES.map((t) => `${t}: ${counts[t]}`).join(', ');
}
