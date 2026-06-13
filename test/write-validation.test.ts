/**
 * Rules-legality warning checks (SQR-285). Pure level/XP logic — the
 * DB-backed item-cost check and the surfaced warnings live in
 * test/campaign-write-tools.test.ts.
 */
import { describe, expect, it } from 'vitest';

import {
  LEVEL_XP_THRESHOLDS,
  WARNING_SCOPE_NOTE,
  levelXpLedgerLine,
  levelXpWarnings,
} from '../src/campaign/write-validation.ts';

describe('levelXpWarnings', () => {
  it('warns when recorded XP is below the threshold for the recorded level', () => {
    const warnings = levelXpWarnings({ level: 5, xp: 150 }, { level: 5, xp: 150 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Level 5 normally requires 210 XP');
    expect(warnings[0]).toContain('records 150');
    // Warning copy states its limited scope (acceptance criterion).
    expect(warnings[0]).toContain(WARNING_SCOPE_NOTE);
    expect(warnings[0]).toContain('house rules');
  });

  it('stays silent for legal sheets, untouched fields, and surplus XP', () => {
    expect(levelXpWarnings({ level: 5, xp: 210 }, { level: 5, xp: 210 })).toEqual([]);
    expect(levelXpWarnings({ level: 1, xp: 0 }, { level: 1, xp: 0 })).toEqual([]);
    // Surplus XP is normal play — leveling is a choice.
    expect(levelXpWarnings({ xp: 400 }, { level: 2, xp: 400 })).toEqual([]);
    // A write that never touched level/xp does not dredge up old mismatches.
    expect(levelXpWarnings({}, { level: 9, xp: 0 })).toEqual([]);
  });

  it('uses the rulebook threshold table', () => {
    expect(LEVEL_XP_THRESHOLDS).toEqual([0, 45, 95, 150, 210, 275, 345, 420, 500]);
  });
});

describe('levelXpLedgerLine', () => {
  it('renders the staged-preview warning row', () => {
    expect(levelXpLedgerLine({ level: 5 }, { level: 5, xp: 150 })).toBe(
      'WARN · L5 NEEDS 210 XP (RECORDED 150)',
    );
    expect(levelXpLedgerLine({ level: 5 }, { level: 5, xp: 210 })).toBeNull();
  });
});
