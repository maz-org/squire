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

import { deriveAvailability, type ModuleGraph } from '../src/campaign/availability.ts';
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
