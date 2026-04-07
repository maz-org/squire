import { describe, it, expect } from 'vitest';
import { formatActions, convertMonster } from '../src/import-monster-stats.ts';
import type { LabelData } from '../src/ghs-utils.ts';

const emptyLabels: LabelData = {};

describe('formatActions', () => {
  it('returns null for undefined actions', () => {
    expect(formatActions(undefined, emptyLabels)).toBeNull();
  });

  it('returns null for empty actions', () => {
    expect(formatActions([], emptyLabels)).toBeNull();
  });

  it('formats shield action', () => {
    expect(formatActions([{ type: 'shield', value: 3 }], emptyLabels)).toBe('Shield 3');
  });

  it('formats retaliate action', () => {
    expect(formatActions([{ type: 'retaliate', value: 2 }], emptyLabels)).toBe('Retaliate 2');
  });

  it('formats condition action', () => {
    expect(formatActions([{ type: 'condition', value: 'muddle' }], emptyLabels)).toBe('muddle');
  });

  it('formats target action', () => {
    expect(formatActions([{ type: 'target', value: 2 }], emptyLabels)).toBe('Target 2');
  });

  it('formats unknown action type', () => {
    expect(formatActions([{ type: 'pierce', value: 3 }], emptyLabels)).toBe('pierce 3');
  });

  it('joins multiple actions', () => {
    const actions = [
      { type: 'shield', value: 2 },
      { type: 'condition', value: 'muddle' },
    ];
    expect(formatActions(actions, emptyLabels)).toBe('Shield 2, muddle');
  });

  it('resolves custom data labels', () => {
    const labels: LabelData = { custom: { fh: { 'test-monster': { '1': 'Retaliate 2' } } } };
    expect(
      formatActions([{ type: 'custom', value: '%data.custom.fh.test-monster.1%' }], labels),
    ).toBe('Retaliate 2');
  });

  it('resolves custom game tokens', () => {
    expect(formatActions([{ type: 'custom', value: '%game.condition.wound%' }], emptyLabels)).toBe(
      'Wound',
    );
  });
});

describe('convertMonster', () => {
  it('converts a standard monster with levels 0-7', () => {
    const ghs = {
      name: 'test-monster',
      edition: 'fh',
      baseStat: { type: 'normal' },
      stats: [
        { level: 0, health: 5, movement: 2, attack: 3 },
        { level: 1, health: 7, movement: 2, attack: 3 },
        { level: 2, health: 9, movement: 3, attack: 3 },
        { level: 3, health: 11, movement: 3, attack: 4 },
        { level: 4, health: 13, movement: 3, attack: 4 },
        { level: 5, health: 15, movement: 4, attack: 4 },
        { level: 6, health: 18, movement: 4, attack: 5 },
        { level: 7, health: 22, movement: 4, attack: 5 },
        { type: 'elite', level: 0, health: 8, movement: 2, attack: 4 },
        { type: 'elite', level: 1, health: 10, movement: 3, attack: 4 },
        { type: 'elite', level: 2, health: 13, movement: 3, attack: 5 },
        { type: 'elite', level: 3, health: 15, movement: 3, attack: 5 },
        { type: 'elite', level: 4, health: 18, movement: 4, attack: 5 },
        { type: 'elite', level: 5, health: 22, movement: 4, attack: 6 },
        { type: 'elite', level: 6, health: 26, movement: 4, attack: 6 },
        { type: 'elite', level: 7, health: 30, movement: 5, attack: 7 },
      ],
    };

    const results = convertMonster(ghs, emptyLabels);
    expect(results).toHaveLength(2);

    const low = results[0];
    expect(low.name).toBe('Test Monster');
    expect(low.levelRange).toBe('0-3');
    expect(low.normal['0']).toEqual({ hp: 5, move: 2, attack: 3 });
    expect(low.normal['3']).toEqual({ hp: 11, move: 3, attack: 4 });
    expect(low.elite['0']).toEqual({ hp: 8, move: 2, attack: 4 });

    const high = results[1];
    expect(high.levelRange).toBe('4-7');
    expect(high.normal['7']).toEqual({ hp: 22, move: 4, attack: 5 });
    expect(high.elite['7']).toEqual({ hp: 30, move: 5, attack: 7 });
    // sourceId includes the level range to distinguish the 0-3 and 4-7 rows.
    expect(high.sourceId).toBe('gloomhavensecretariat:monster-stat/test-monster/4-7');
  });

  it('inherits movement from baseStat when absent', () => {
    const ghs = {
      name: 'static-thing',
      edition: 'fh',
      baseStat: { type: 'normal', movement: 1 },
      stats: [
        { level: 0, health: 4, attack: 2 },
        { type: 'elite', level: 0, health: 7, attack: 3 },
      ],
    };

    const results = convertMonster(ghs, emptyLabels);
    expect(results[0].normal['0']).toEqual({ hp: 4, move: 1, attack: 2 });
    expect(results[0].elite['0']).toEqual({ hp: 7, move: 1, attack: 3 });
  });

  it('defaults movement to 0 when no baseStat', () => {
    const ghs = {
      name: 'immobile',
      edition: 'fh',
      stats: [
        { level: 0, health: 10, attack: 5 },
        { type: 'elite', level: 0, health: 15, attack: 7 },
      ],
    };

    const results = convertMonster(ghs, emptyLabels);
    expect(results[0].normal['0'].move).toBe(0);
  });

  it('skips boss formula health entries', () => {
    const ghs = {
      name: 'boss',
      edition: 'fh',
      baseStat: { type: 'boss' },
      stats: [
        { level: 0, health: 'Cx20', movement: 3, attack: 5 },
        { type: 'elite', level: 0, health: 30, movement: 3, attack: 6 },
      ],
    };

    const results = convertMonster(ghs, emptyLabels);
    // Normal entry skipped (formula health), only elite present
    expect(results[0].normal).toEqual({});
    expect(results[0].elite['0']).toEqual({ hp: 30, move: 3, attack: 6 });
  });

  it('skips placeholder entries with no stats', () => {
    const ghs = {
      name: 'boss-only',
      edition: 'fh',
      baseStat: { type: 'boss' },
      stats: [
        { level: 0 }, // placeholder
        { type: 'elite', level: 0, health: 20, movement: 2, attack: 5 },
      ],
    };

    const results = convertMonster(ghs, emptyLabels);
    expect(results[0].normal).toEqual({});
    expect(results[0].elite['0']).toEqual({ hp: 20, move: 2, attack: 5 });
  });

  it('collects action notes', () => {
    const ghs = {
      name: 'shielded',
      edition: 'fh',
      stats: [
        {
          level: 0,
          health: 5,
          movement: 2,
          attack: 3,
          actions: [{ type: 'shield', value: 2 }],
        },
        { type: 'elite', level: 0, health: 8, movement: 2, attack: 4 },
      ],
    };

    const results = convertMonster(ghs, emptyLabels);
    expect(results[0].notes).toBe('normal L0: Shield 2');
  });

  it('collects base immunities', () => {
    const ghs = {
      name: 'immune',
      edition: 'fh',
      baseStat: { type: 'normal', immunities: ['poison', 'wound'] },
      stats: [
        { level: 0, health: 5, movement: 2, attack: 3 },
        { type: 'elite', level: 0, health: 8, movement: 2, attack: 4 },
      ],
    };

    const results = convertMonster(ghs, emptyLabels);
    expect(results[0].immunities).toEqual(['poison', 'wound']);
  });

  it('uses 0 for missing attack', () => {
    const ghs = {
      name: 'no-attack',
      edition: 'fh',
      stats: [
        { level: 0, health: 1 },
        { type: 'elite', level: 0, health: 2, attack: 1 },
      ],
    };

    const results = convertMonster(ghs, emptyLabels);
    expect(results[0].normal['0'].attack).toBe(0);
  });

  it('returns empty array for monster with no valid stats', () => {
    const ghs = {
      name: 'empty',
      edition: 'fh',
      baseStat: { type: 'boss' },
      stats: [{ level: 0 }, { level: 1 }, { level: 2 }, { level: 3 }],
    };

    const results = convertMonster(ghs, emptyLabels);
    expect(results).toHaveLength(0);
  });
});
