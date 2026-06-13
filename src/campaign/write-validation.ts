/**
 * Rules-legality validation warnings on writes (SQR-285, CEO D4.4,
 * constraint 12).
 *
 * SOFT warnings only — the write always applies; house rules win. The v1
 * check set is enumerated and closed: level-vs-XP thresholds and gold vs
 * item cost. Prosperity-gated item availability was scoped OUT after the
 * data-source check: `card_items` carries cost/craftCost but no prosperity
 * field (confirmed 2026-06-12 against src/db/schema/cards.ts), and
 * constraint 12 forbids guessing where the data is absent.
 *
 * Every warning states its limited scope so "no warnings" is never read as
 * "fully rules-legal" — silence means the v1 checks passed or lacked data,
 * nothing more.
 */
import { and, eq } from 'drizzle-orm';

import { getDb } from '../db.ts';
import { cardItems } from '../db/schema/cards.ts';

export const WARNING_SCOPE_NOTE =
  'Squire only checks level-vs-XP and item gold cost — no warning does not mean fully rules-legal.';

/**
 * Cumulative XP required to REACH each level (index = level - 1). The same
 * table in Frosthaven and Gloomhaven 2e rulebooks.
 */
export const LEVEL_XP_THRESHOLDS = [0, 45, 95, 150, 210, 275, 345, 420, 500] as const;

/**
 * Warn when the recorded XP is below the threshold for the recorded level,
 * evaluated against the RESOLVED (post-write) sheet and only when the write
 * touched level or xp — pre-existing mismatches stay quiet until the next
 * time those fields move. The inverse (more XP than the level needs) is
 * normal play — leveling is a choice — and stays silent.
 */
export function levelXpWarnings(
  touched: { level?: number; xp?: number },
  resolved: { level: number; xp: number },
): string[] {
  if (touched.level === undefined && touched.xp === undefined) return [];
  const threshold = LEVEL_XP_THRESHOLDS[resolved.level - 1];
  if (threshold === undefined || resolved.xp >= threshold) return [];
  return [
    `Level ${resolved.level} normally requires ${threshold} XP and the sheet records ${resolved.xp}. ` +
      `Saved anyway — house rules always win. (${WARNING_SCOPE_NOTE})`,
  ];
}

/** Ledger-voiced form of the level/XP warning for staged-preview rows. */
export function levelXpLedgerLine(
  touched: { level?: number; xp?: number },
  resolved: { level: number; xp: number },
): string | null {
  if (levelXpWarnings(touched, resolved).length === 0) return null;
  const threshold = LEVEL_XP_THRESHOLDS[resolved.level - 1];
  return `WARN · L${resolved.level} NEEDS ${threshold} XP (RECORDED ${resolved.xp})`;
}

/**
 * Warn when a character takes an item costing more gold than they have.
 * Items without structured cost data stay silent (constraint 12: never
 * guess where the data is absent).
 */
export async function itemCostWarnings(
  game: string,
  sourceId: string,
  characterGold: number,
): Promise<string[]> {
  const { db } = getDb('server');
  const rows = await db
    .select({ name: cardItems.name, number: cardItems.number, cost: cardItems.cost })
    .from(cardItems)
    .where(and(eq(cardItems.game, game), eq(cardItems.sourceId, sourceId)))
    .limit(1);
  const item = rows[0];
  if (!item || item.cost === null || characterGold >= item.cost) return [];
  return [
    `${item.name} (item ${item.number}) costs ${item.cost} gold and the character has ${characterGold}. ` +
      `Saved anyway — house rules always win. (${WARNING_SCOPE_NOTE})`,
  ];
}
