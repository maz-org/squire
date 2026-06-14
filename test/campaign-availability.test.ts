/**
 * Availability derivation tests (SQR-268).
 *
 * The golden test replays Brian's real GH2e campaign (captured from the
 * live prototype on 2026-06-12) against the checked-in extracts and asserts
 * our derivation matches the statuses the prototype's own algorithm
 * produced for the same state — computed independently at capture time,
 * not by this implementation.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  availabilityShiftLines,
  deriveAvailability,
  type ModuleGraph,
} from '../src/campaign/availability.ts';
import { readUnlockGraphExtracts } from '../src/seed/seed-unlock-graphs.ts';

function graph(
  partial: Partial<ModuleGraph> & { scenarios: ModuleGraph['scenarios'] },
): ModuleGraph {
  return { game: 'gloomhaven-2e', module: 'test', threads: [], ...partial };
}

function scenario(
  key: string,
  overrides: Partial<ModuleGraph['scenarios'][number]> = {},
): ModuleGraph['scenarios'][number] {
  return {
    key,
    name: `Scenario ${key}`,
    prereqsAll: [],
    prereqsAny: [],
    mutex: [],
    lockedIf: [],
    manual: false,
    cond: null,
    hazard: false,
    skippable: false,
    unlockClass: null,
    unlockMinLevel: null,
    ...overrides,
  };
}

describe('deriveAvailability', () => {
  it('opens prereq-free scenarios and locks gated ones', () => {
    const g = graph({ scenarios: [scenario('1'), scenario('2', { prereqsAll: ['1'] })] });
    const { statuses } = deriveAvailability([g], new Set(), new Set());
    expect(statuses.get('test:1')).toBe('open');
    expect(statuses.get('test:2')).toBe('locked');
  });

  it('requires every prereqsAll AND at least one prereqsAny', () => {
    const g = graph({
      scenarios: [
        scenario('1'),
        scenario('2'),
        scenario('3'),
        scenario('4', { prereqsAll: ['1', '2'], prereqsAny: ['3'] }),
      ],
    });
    expect(
      deriveAvailability([g], new Set(['test:1', 'test:2']), new Set()).statuses.get('test:4'),
    ).toBe('locked');
    expect(
      deriveAvailability([g], new Set(['test:1', 'test:3']), new Set()).statuses.get('test:4'),
    ).toBe('locked');
    expect(
      deriveAvailability([g], new Set(['test:1', 'test:2', 'test:3']), new Set()).statuses.get(
        'test:4',
      ),
    ).toBe('open');
  });

  it('blocks scenarios whose mutex or lockedIf partner was played', () => {
    const g = graph({
      scenarios: [
        scenario('a', { mutex: ['b'] }),
        scenario('b', { mutex: ['a'] }),
        scenario('victim', { lockedIf: ['a'] }),
      ],
    });
    const { statuses } = deriveAvailability([g], new Set(['test:a']), new Set());
    expect(statuses.get('test:a')).toBe('played');
    expect(statuses.get('test:b')).toBe('blocked');
    expect(statuses.get('test:victim')).toBe('blocked');
  });

  it('cycles manual scenarios via-event → drew-it → played', () => {
    const g = graph({ scenarios: [scenario('e', { manual: true, cond: 'Unlock via event' })] });
    expect(deriveAvailability([g], new Set(), new Set()).statuses.get('test:e')).toBe('via-event');
    expect(deriveAvailability([g], new Set(), new Set(['test:e'])).statuses.get('test:e')).toBe(
      'drew-it',
    );
    expect(deriveAvailability([g], new Set(['test:e']), new Set()).statuses.get('test:e')).toBe(
      'played',
    );
  });

  it('keeps manual forced continuations locked until the parent is played', () => {
    const g = graph({
      scenarios: [
        scenario('26', { manual: true }),
        scenario('23', { manual: true, prereqsAll: ['26'] }),
      ],
    });
    expect(deriveAvailability([g], new Set(), new Set()).statuses.get('test:23')).toBe('locked');
    expect(deriveAvailability([g], new Set(['test:26']), new Set()).statuses.get('test:23')).toBe(
      'via-event',
    );
  });

  it('scopes derivation to loaded modules and reports unknown keys', () => {
    const g = graph({ module: 'gh2e', scenarios: [scenario('1')] });
    const { statuses, unknownKeys } = deriveAvailability(
      [g],
      new Set(['gh2e:1', 'fh:99']),
      new Set(['solo2e:bruiser']),
    );
    expect(statuses.get('gh2e:1')).toBe('played');
    expect(statuses.has('fh:99')).toBe(false);
    expect(unknownKeys).toEqual(['fh:99', 'solo2e:bruiser']);
  });

  it('projects hazard warnings only for still-reachable closures', () => {
    const g = graph({
      scenarios: [
        scenario('27', { hazard: true }),
        scenario('10', { lockedIf: ['27'] }),
        scenario('21', { lockedIf: ['27'] }),
      ],
    });
    const fresh = deriveAvailability([g], new Set(), new Set());
    expect(fresh.hazardWarnings).toEqual([{ key: 'test:27', closes: ['test:10', 'test:21'] }]);

    // Once a victim is played it is no longer "closable" by the hazard.
    const after = deriveAvailability([g], new Set(['test:10']), new Set());
    expect(after.hazardWarnings).toEqual([{ key: 'test:27', closes: ['test:21'] }]);
  });

  it('warns on edge-derived closures even when the culprit has no hazard flag', () => {
    // The FH 2↔3 permanent-lockout shape: a plain mutex pair, neither side
    // flagged. The flag marks closures edges cannot see; warnings come from
    // the edges themselves, so this pair must still warn.
    const g = graph({
      scenarios: [scenario('2', { mutex: ['3'] }), scenario('3', { mutex: ['2'] })],
    });
    const { hazardWarnings } = deriveAvailability([g], new Set(), new Set());
    expect(hazardWarnings).toEqual([
      { key: 'test:2', closes: ['test:3'] },
      { key: 'test:3', closes: ['test:2'] },
    ]);
  });

  it('marks a skipped scenario SKIPPED and counts it as done for prereqs', () => {
    const g = graph({
      scenarios: [scenario('0', { skippable: true }), scenario('1', { prereqsAll: ['0'] })],
    });
    const { statuses } = deriveAvailability([g], new Set(), new Set(), new Set(['test:0']));
    expect(statuses.get('test:0')).toBe('skipped');
    // Skipping the intro opens scenario 1 immediately, exactly like playing it.
    expect(statuses.get('test:1')).toBe('open');
  });

  describe('character-gated (solo) scenarios', () => {
    const g = graph({
      module: 'solo2e',
      scenarios: [scenario('bruiser', { unlockClass: 'Bruiser', unlockMinLevel: 5 })],
    });
    const statusFor = (characters: { className: string; level: number }[]) =>
      deriveAvailability([g], new Set(), new Set(), new Set(), characters).statuses.get(
        'solo2e:bruiser',
      );

    it('locks without a qualifying active character — never via-event/drew-it', () => {
      // Empty roster (or a retired/departed character) re-locks it live.
      expect(statusFor([])).toBe('locked');
      expect(statusFor([{ className: 'Bruiser', level: 4 }])).toBe('locked');
      // Even marked drawn, a character-gated solo never becomes via-event/drew-it
      // — the roster gate fully replaces the manual/event branch.
      expect(
        deriveAvailability([g], new Set(), new Set(['solo2e:bruiser']), new Set(), []).statuses.get(
          'solo2e:bruiser',
        ),
      ).toBe('locked');
    });

    it('opens when an active character of the class is at the threshold level', () => {
      expect(statusFor([{ className: 'Bruiser', level: 5 }])).toBe('open');
      expect(statusFor([{ className: 'Bruiser', level: 9 }])).toBe('open');
    });

    it('matches the class case-insensitively and ignores other classes', () => {
      expect(statusFor([{ className: 'bruiser', level: 6 }])).toBe('open');
      expect(statusFor([{ className: 'Spellweaver', level: 9 }])).toBe('locked');
    });
  });

  it('GOLDEN: reproduces the live prototype campaign exactly', () => {
    const fixture = JSON.parse(
      readFileSync(
        join(process.cwd(), 'test/fixtures/unlock-graphs/gh2e-live-campaign.json'),
        'utf8',
      ),
    ) as {
      modules: string[];
      played: string[];
      drawn: string[];
      expectedStatuses: Record<string, string>;
    };
    const graphs = readUnlockGraphExtracts().filter((extract) =>
      fixture.modules.includes(extract.module),
    );
    expect(graphs).toHaveLength(2);

    const { statuses, unknownKeys } = deriveAvailability(
      graphs,
      new Set(fixture.played),
      new Set(fixture.drawn),
    );
    expect(unknownKeys).toEqual([]);
    expect(Object.fromEntries([...statuses.entries()].sort())).toEqual(fixture.expectedStatuses);
  });
});

describe('availabilityShiftLines (SQR-283 preview narration)', () => {
  const g = graph({
    scenarios: [
      scenario('1'),
      scenario('19', { prereqsAll: ['14'] }),
      scenario('43', { prereqsAll: ['14'] }),
      scenario('14'),
      scenario('27'),
      scenario('10', { mutex: ['27'] }),
      scenario('21', { lockedIf: ['27'] }),
    ],
  });

  it('narrates opens and permanent closes for a play', () => {
    const lines = availabilityShiftLines(
      [g],
      { playedScenarios: ['test:1'], drawnScenarios: [] },
      { playedScenarios: ['test:1', 'test:14', 'test:27'] },
    );
    expect(lines).toEqual(['OPENS → 19, 43', 'CLOSES PERMANENTLY → 10, 21']);
  });

  it('narrates reopens and re-locks for an un-play', () => {
    const lines = availabilityShiftLines(
      [g],
      { playedScenarios: ['test:14', 'test:27'], drawnScenarios: [] },
      { playedScenarios: ['test:14'] },
    );
    expect(lines).toEqual(['REOPENS → 10, 21']);
    const relock = availabilityShiftLines(
      [g],
      { playedScenarios: ['test:14'], drawnScenarios: [] },
      { playedScenarios: [] },
    );
    expect(relock).toEqual(['LOCKS AGAIN → 19, 43']);
  });

  it('stays silent without graphs or scenario-state changes', () => {
    expect(
      availabilityShiftLines(
        [],
        { playedScenarios: ['test:1'], drawnScenarios: [] },
        {
          playedScenarios: [],
        },
      ),
    ).toEqual([]);
    expect(
      availabilityShiftLines([g], { playedScenarios: ['test:1'], drawnScenarios: [] }, {}),
    ).toEqual([]);
  });
});
