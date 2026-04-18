/**
 * DB-backed traversal data access.
 *
 * This is the deterministic navigation layer for scenario/section research:
 * exact scenario lookup, exact section fetch, and explicit outbound links.
 */

import { sql } from 'drizzle-orm';

import { getDb } from './db.ts';
import { traversalLinks, traversalScenarios, traversalSections } from './db/schema/traversal.ts';
import type { TraversalKind, TraversalLinkType } from './traversal-schemas.ts';

export interface TraversalScenario extends Record<string, unknown> {
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

export interface TraversalSection extends Record<string, unknown> {
  ref: string;
  sectionNumber: number;
  sectionVariant: number;
  sourcePdf: string;
  sourcePage: number;
  text: string;
  metadata: Record<string, unknown>;
}

export interface TraversalLink extends Record<string, unknown> {
  fromKind: TraversalKind;
  fromRef: string;
  toKind: TraversalKind;
  toRef: string;
  linkType: TraversalLinkType;
  rawLabel: string | null;
  rawContext: string | null;
  sequence: number;
}

interface LoadOpts {
  game?: string;
}

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through
    }
  }
  return {};
}

function extractScenarioIndex(query: string): string | null {
  const scenarioMatch = query.match(/\bscenario\s*0*(\d{1,3})\b/i);
  if (scenarioMatch) return String(Number(scenarioMatch[1]));

  const anyNumber = query.match(/\b0*(\d{1,3})\b/);
  return anyNumber ? String(Number(anyNumber[1])) : null;
}

export async function findScenarios(
  query: string,
  limit = 6,
  opts: LoadOpts = {},
): Promise<TraversalScenario[]> {
  const { db } = getDb();
  const game = opts.game ?? 'frosthaven';
  const normalized = query.trim();
  const lowered = normalized.toLowerCase();
  const scenarioIndex = extractScenarioIndex(normalized);
  const indexCondition = scenarioIndex ? sql`scenario_index = ${scenarioIndex}` : sql`false`;
  const likePattern = `%${lowered}%`;

  const rows = await db.execute<TraversalScenario>(sql`
    SELECT
      ref,
      scenario_group AS "scenarioGroup",
      scenario_index AS "scenarioIndex",
      name,
      complexity,
      flow_chart_group AS "flowChartGroup",
      initial,
      source_pdf AS "sourcePdf",
      source_page AS "sourcePage",
      raw_text AS "rawText",
      metadata
    FROM ${traversalScenarios}
    WHERE game = ${game}
      AND (${indexCondition} OR lower(name) LIKE ${likePattern})
    ORDER BY
      CASE
        WHEN ${indexCondition} THEN 0
        WHEN lower(name) = ${lowered} THEN 1
        WHEN lower(name) LIKE ${`${lowered}%`} THEN 2
        ELSE 3
      END,
      scenario_index
    LIMIT ${limit}
  `);

  return rows.rows.map((row) => ({
    ...row,
    metadata: normalizeJsonObject(row.metadata),
  }));
}

export async function getScenario(
  ref: string,
  opts: LoadOpts = {},
): Promise<TraversalScenario | null> {
  const { db } = getDb();
  const game = opts.game ?? 'frosthaven';

  const rows = await db.execute<TraversalScenario>(sql`
    SELECT
      ref,
      scenario_group AS "scenarioGroup",
      scenario_index AS "scenarioIndex",
      name,
      complexity,
      flow_chart_group AS "flowChartGroup",
      initial,
      source_pdf AS "sourcePdf",
      source_page AS "sourcePage",
      raw_text AS "rawText",
      metadata
    FROM ${traversalScenarios}
    WHERE game = ${game} AND ref = ${ref}
    LIMIT 1
  `);

  const row = rows.rows[0];
  return row ? { ...row, metadata: normalizeJsonObject(row.metadata) } : null;
}

export async function getSection(
  ref: string,
  opts: LoadOpts = {},
): Promise<TraversalSection | null> {
  const { db } = getDb();
  const game = opts.game ?? 'frosthaven';

  const rows = await db.execute<TraversalSection>(sql`
    SELECT
      ref,
      section_number AS "sectionNumber",
      section_variant AS "sectionVariant",
      source_pdf AS "sourcePdf",
      source_page AS "sourcePage",
      text,
      metadata
    FROM ${traversalSections}
    WHERE game = ${game} AND ref = ${ref}
    LIMIT 1
  `);

  const row = rows.rows[0];
  return row ? { ...row, metadata: normalizeJsonObject(row.metadata) } : null;
}

export async function followLinks(
  fromKind: TraversalKind,
  fromRef: string,
  linkType?: TraversalLinkType,
  opts: LoadOpts = {},
): Promise<TraversalLink[]> {
  const { db } = getDb();
  const game = opts.game ?? 'frosthaven';
  const linkTypeClause = linkType ? sql`AND link_type = ${linkType}` : sql``;

  const rows = await db.execute<TraversalLink>(sql`
    SELECT
      from_kind AS "fromKind",
      from_ref AS "fromRef",
      to_kind AS "toKind",
      to_ref AS "toRef",
      link_type AS "linkType",
      raw_label AS "rawLabel",
      raw_context AS "rawContext",
      sequence
    FROM ${traversalLinks}
    WHERE game = ${game}
      AND from_kind = ${fromKind}
      AND from_ref = ${fromRef}
      ${linkTypeClause}
    ORDER BY sequence, to_ref
  `);

  return rows.rows;
}
