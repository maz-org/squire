/**
 * Character level derivation.
 *
 * Gloomhaven-family sheets record XP; level is a derived read model. The legacy
 * `characters.level` column remains as a compatibility mirror, but app code
 * should derive from XP before exposing character state.
 */

export const LEVEL_XP_THRESHOLDS = [0, 45, 95, 150, 210, 275, 345, 420, 500] as const;

export function deriveCharacterLevel(_game: string, xp: number): number {
  const safeXp = Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0;
  let level = 1;
  for (let index = 0; index < LEVEL_XP_THRESHOLDS.length; index += 1) {
    if (safeXp >= LEVEL_XP_THRESHOLDS[index]) level = index + 1;
  }
  return level;
}
