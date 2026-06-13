/**
 * GHS-backed class-name validation for the onboarding interview (SQR-284).
 *
 * Character mats are the canonical class list per game. Validation is SOFT:
 * a near-miss earns a "did you mean" suggestion the agent relays as a
 * clarifying question, and a game with no imported mats degrades to
 * accept-anything — the table is always allowed to win (homebrew classes
 * pass with force).
 */
import { eq } from 'drizzle-orm';

import { getDb } from '../db.ts';
import { cardCharacterMats } from '../db/schema/cards.ts';

export async function knownClassNames(game: string): Promise<string[]> {
  const { db } = getDb('server');
  const rows = await db
    .selectDistinct({ name: cardCharacterMats.name })
    .from(cardCharacterMats)
    .where(eq(cardCharacterMats.game, game));
  return rows.map((row) => row.name).sort((a, b) => a.localeCompare(b));
}

function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[] = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i += 1) {
    let prevDiagonal = d[0];
    d[0] = i;
    for (let j = 1; j < cols; j += 1) {
      const insertOrDelete = Math.min(d[j], d[j - 1]) + 1;
      const substitute = prevDiagonal + (a[i - 1] === b[j - 1] ? 0 : 1);
      prevDiagonal = d[j];
      d[j] = Math.min(insertOrDelete, substitute);
    }
  }
  return d[cols - 1];
}

export type ClassNameCheck =
  | { ok: true; canonical: string }
  | { ok: false; suggestion: string | null; known: string[] };

/**
 * Case-insensitive exact matches normalize to the canonical casing. A miss
 * within edit distance 3 yields the closest known class as a suggestion.
 */
export function checkClassName(input: string, known: string[]): ClassNameCheck {
  if (known.length === 0) return { ok: true, canonical: input };
  const trimmed = input.trim();
  const exact = known.find((name) => name.toLowerCase() === trimmed.toLowerCase());
  if (exact) return { ok: true, canonical: exact };

  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const name of known) {
    const distance = editDistance(trimmed.toLowerCase(), name.toLowerCase());
    if (distance < bestDistance) {
      best = name;
      bestDistance = distance;
    }
  }
  return { ok: false, suggestion: bestDistance <= 3 ? best : null, known };
}
