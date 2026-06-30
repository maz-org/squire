/**
 * Frosthaven unlock-graph spot checks (SQR-281).
 *
 * The graph is curated (not exfiltrated) — see
 * data/extracted/unlock-graphs/fh-curation-notes.md for sources and judgment
 * calls. These tests pin the curation's structural claims and walk a
 * plausible mid-campaign state through the availability derivation so a
 * regression in either the data or the derivation surfaces here.
 */
import { describe, expect, it } from 'vitest';

import { deriveAvailability } from '../src/campaign/availability.ts';
import { readUnlockGraphExtracts } from '../src/seed/seed-unlock-graphs.ts';

const fh = readUnlockGraphExtracts().find((extract) => extract.module === 'fh');
if (!fh) throw new Error('fh.json extract missing');
const fhsolo = readUnlockGraphExtracts().find((extract) => extract.module === 'fhsolo');
if (!fhsolo) throw new Error('fhsolo.json extract missing');

describe('Frosthaven unlock graph', () => {
  it('covers the full scenario set with curated unlock knowledge', () => {
    // Main graph: 138 numbered mains (incl. 0), 6 A/B variants, 1 random dungeon.
    expect(fh.game).toBe('frosthaven');
    expect(fh.scenarios).toHaveLength(145);
    // Optional solo module: 17 class-gated solo scenarios.
    expect(fhsolo.scenarios).toHaveLength(17);
    expect(fh.threads.length).toBeGreaterThan(0);

    // Every scenario is reachable through the curation: it either has prereq
    // edges, is a manual unlock with a human-readable condition, or is a
    // campaign-start/tutorial entry with a cond annotation.
    for (const s of fh.scenarios) {
      const curated =
        s.prereqsAll.length > 0 || s.prereqsAny.length > 0 || (s.manual && s.cond) || s.cond;
      expect(curated, `scenario ${s.key} has no curated unlock knowledge`).toBeTruthy();
    }
  });

  it('flags the hidden-permanent-choice scenarios as hazards', () => {
    // 4, 44, 51, 73 contain an in-scenario choice that permanently closes
    // content; edge-visible closures (mutex/lockedIf pairs) need no flag.
    expect(fh.scenarios.filter((s) => s.hazard).map((s) => s.key)).toEqual(['4', '44', '51', '73']);
  });

  it('marks the six not-yet-curated unlocks manual so they stay player-toggleable', () => {
    const unknown = fh.scenarios.filter((s) => s.cond?.includes('not yet curated'));
    expect(unknown.map((s) => s.key).sort()).toEqual(['132', '134', '84', '89', '90', '96']);
    for (const s of unknown) expect(s.manual).toBe(true);
  });

  it('derives a sensible mid-campaign state', () => {
    // A real opening line: start → Algox Scouting (2) → Heart of Ice (4),
    // whose in-scenario choice granted Frozen Crypt (5); the "Opening the
    // Pass" calendar section (114) has come up but is unplayed.
    const played = new Set(['fh:1', 'fh:2', 'fh:4', 'fh:5']);
    const drawn = new Set(['fh:114']);
    const { statuses, unknownKeys, hazardWarnings } = deriveAvailability([fh], played, drawn);

    expect(unknownKeys).toEqual([]);
    expect(statuses.get('fh:0')).toBe('open'); // tutorial, never gated
    expect(statuses.get('fh:3')).toBe('blocked'); // 2 vs 3 is a permanent choice
    expect(statuses.get('fh:4A')).toBe('locked'); // entrance variant for the 3-line
    expect(statuses.get('fh:4B')).toBe('open'); // entrance variant for the 2-line
    expect(statuses.get('fh:6')).toBe('blocked'); // 4's choice granted 5, closing 6
    expect(statuses.get('fh:7')).toBe('open'); // granted after 4 either way
    expect(statuses.get('fh:8')).toBe('open');
    expect(statuses.get('fh:114')).toBe('drew-it'); // drawn calendar unlock
    expect(statuses.get('fh:28')).toBe('locked'); // peace path needs 18 or 19
    expect(statuses.get('fh:rnd')).toBe('via-event'); // random dungeon deck

    // The war-vs-peace lockout is still ahead of this party: playing 28
    // closes both war scenarios, and either war scenario closes 28.
    expect(hazardWarnings).toContainEqual({ key: 'fh:28', closes: ['fh:29', 'fh:30'] });
    expect(hazardWarnings).toContainEqual({ key: 'fh:29', closes: ['fh:28'] });
  });

  it('opens Frosthaven solos from the optional module through character gates', () => {
    const { statuses, unknownKeys } = deriveAvailability(
      [fh, fhsolo],
      new Set(),
      new Set(),
      new Set(),
      [{ className: 'Drifter', level: 5 }],
    );

    expect(unknownKeys).toEqual([]);
    expect(statuses.get('fhsolo:drifter')).toBe('open');
    expect(statuses.get('fhsolo:blinkblade')).toBe('locked');
    expect(statuses.has('fh:solo-20')).toBe(false);
  });
});
