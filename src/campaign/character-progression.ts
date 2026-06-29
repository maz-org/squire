/**
 * Character-sheet progression counters that are owned by the character row.
 * Class-specific effect text still comes from the mat catalog.
 */

export const PERK_MARK_GROUP_SIZE = 3;

export function perkMarkGroupCountForGame(game: string): number {
  switch (game) {
    case 'frosthaven':
    case 'gloomhaven-2e':
      return 6;
    default:
      return 6;
  }
}

export function maxPerkMarksForGame(game: string): number {
  return perkMarkGroupCountForGame(game) * PERK_MARK_GROUP_SIZE;
}
