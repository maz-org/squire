import { describe, it, expect } from 'vitest';
import { convertBattleGoal } from '../src/import-battle-goals.ts';
import type { LabelData } from '../src/ghs-utils.ts';

const labels: LabelData = {
  battleGoals: {
    '1301': {
      '': 'Accountant',
      text: 'Have zero cards in your hand each time you rest.',
    },
    '1346': {
      '': 'Assassin',
      text: 'Kill an enemy before it takes its first turn.',
    },
    '1350': {
      '': 'Exterminator',
      text: 'Kill five or more enemies.',
    },
  },
};

describe('convertBattleGoal', () => {
  it('converts a basic battle goal with condition text from labels', () => {
    const ghs = { cardId: '1301', name: 'Accountant', checks: 1 };

    const result = convertBattleGoal(ghs, labels);

    expect(result).toEqual({
      name: 'Accountant',
      condition: 'Have zero cards in your hand each time you rest.',
      checkmarks: 1,
      _source: 'gloomhavensecretariat:battle-goal/1301',
    });
  });

  it('handles a 2-checkmark battle goal', () => {
    const ghs = { cardId: '1346', name: 'Assassin', checks: 2 };

    const result = convertBattleGoal(ghs, labels);

    expect(result.checkmarks).toBe(2);
    expect(result.condition).toBe('Kill an enemy before it takes its first turn.');
  });

  it('falls back to name when label text is missing', () => {
    const ghs = { cardId: '9999', name: 'Unknown Goal', checks: 1 };

    const result = convertBattleGoal(ghs, labels);

    expect(result.name).toBe('Unknown Goal');
    expect(result.condition).toBe('');
    expect(result._source).toBe('gloomhavensecretariat:battle-goal/9999');
  });

  it('resolves game tokens in condition text', () => {
    const labelsWithTokens: LabelData = {
      battleGoals: {
        '2000': {
          '': 'Token Goal',
          text: 'Deal %game.action.attack% 5 damage in a single %game.action.attack%.',
        },
      },
    };
    const ghs = { cardId: '2000', name: 'Token Goal', checks: 1 };

    const result = convertBattleGoal(ghs, labelsWithTokens);

    expect(result.condition).toBe('Deal Attack 5 damage in a single Attack.');
  });
});
