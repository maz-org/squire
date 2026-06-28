/**
 * XP-derived level checks. Item-cost warnings live in
 * test/campaign-write-tools.test.ts.
 */
import { describe, expect, it } from 'vitest';

import { LEVEL_XP_THRESHOLDS, deriveCharacterLevel } from '../src/campaign/character-level.ts';

describe('deriveCharacterLevel', () => {
  it('uses the shared threshold table', () => {
    expect(LEVEL_XP_THRESHOLDS).toEqual([0, 45, 95, 150, 210, 275, 345, 420, 500]);
  });

  it('derives the current character level from XP', () => {
    expect(deriveCharacterLevel('frosthaven', 0)).toBe(1);
    expect(deriveCharacterLevel('frosthaven', 44)).toBe(1);
    expect(deriveCharacterLevel('frosthaven', 45)).toBe(2);
    expect(deriveCharacterLevel('gloomhaven-2e', 150)).toBe(4);
    expect(deriveCharacterLevel('gloomhaven-2e', 500)).toBe(9);
    expect(deriveCharacterLevel('gloomhaven-2e', 999)).toBe(9);
  });

  it('normalizes invalid XP inputs before deriving level', () => {
    expect(deriveCharacterLevel('frosthaven', -10)).toBe(1);
    expect(deriveCharacterLevel('frosthaven', Number.NaN)).toBe(1);
    expect(deriveCharacterLevel('frosthaven', 95.9)).toBe(3);
  });
});
