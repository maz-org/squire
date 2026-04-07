import { describe, it, expect } from 'vitest';
import { convertMonsterAbility } from '../src/import-monster-abilities.ts';

// ─── convertMonsterAbility ──────────────────────────────────────────────────

describe('convertMonsterAbility', () => {
  const labels = {
    custom: {
      fh: {
        'abael-herder': {
          '1': 'Grant the closest Piranha Pig within %game.action.range% 4:',
        },
      },
    },
  };

  it('converts a basic GHS monster ability to MonsterAbility format', () => {
    const ghsAbility = {
      name: 'Forceful Strike',
      cardId: 100,
      initiative: 45,
      level: 0 as number | 'X',
      actions: [
        { type: 'move', value: 1 },
        { type: 'attack', value: 2 },
      ],
    };

    const result = convertMonsterAbility(ghsAbility, 'algox-archer', labels);

    expect(result).toEqual({
      monsterType: 'Algox Archer',
      cardName: 'Forceful Strike',
      initiative: 45,
      abilities: ['Move 1', 'Attack 2'],
      sourceId: 'gloomhavensecretariat:monster-ability/algox-archer/100',
    });
  });

  it('converts monsterType from kebab-case filename to title case', () => {
    const ghsAbility = {
      name: 'Charge',
      cardId: 200,
      initiative: 30,
      level: 0 as number | 'X',
      actions: [{ type: 'move', value: 3 }],
    };

    const result = convertMonsterAbility(ghsAbility, 'burrowing-blade', labels);
    expect(result.monsterType).toBe('Burrowing Blade');
  });

  it('handles empty actions gracefully', () => {
    const ghsAbility = {
      name: 'Empty Card',
      cardId: 999,
      initiative: 50,
      level: 0 as number | 'X',
      actions: [],
    };

    const result = convertMonsterAbility(ghsAbility, 'archer', labels);
    expect(result.abilities).toEqual([]);
  });

  it('handles missing actions array', () => {
    const ghsAbility = {
      name: 'No Actions',
      cardId: 888,
      initiative: 50,
      level: 0 as number | 'X',
    };

    const result = convertMonsterAbility(ghsAbility, 'archer', labels);
    expect(result.abilities).toEqual([]);
  });

  it('resolves custom label references', () => {
    const ghsAbility = {
      name: 'Briny Bristles',
      cardId: 778,
      initiative: 18,
      level: 0 as number | 'X',
      actions: [
        { type: 'move', value: 1 },
        { type: 'custom', value: '%data.custom.fh.abael-herder.1%', small: true },
      ],
    };

    const result = convertMonsterAbility(ghsAbility, 'abael-herder', labels);
    expect(result.abilities).toContain('Grant the closest Piranha Pig within Range 4:');
  });

  it('formats conditions as capitalized names', () => {
    const ghsAbility = {
      name: 'Poison Strike',
      cardId: 300,
      initiative: 55,
      level: 0 as number | 'X',
      actions: [
        { type: 'attack', value: 2 },
        { type: 'condition', value: 'poison' },
      ],
    };

    const result = convertMonsterAbility(ghsAbility, 'archer', labels);
    expect(result.abilities).toEqual(['Attack 2', 'Poison']);
  });

  it('skips layout-only action types', () => {
    const ghsAbility = {
      name: 'Complex Card',
      cardId: 400,
      initiative: 60,
      level: 0 as number | 'X',
      actions: [
        { type: 'attack', value: 3 },
        { type: 'forceBox', value: '' },
        { type: 'concatenation', value: '', subActions: [] },
        { type: 'move', value: 2 },
      ],
    };

    const result = convertMonsterAbility(ghsAbility, 'archer', labels);
    expect(result.abilities).toEqual(['Attack 3', 'Move 2']);
  });

  it('includes sub-action details', () => {
    const ghsAbility = {
      name: 'Piercing Shot',
      cardId: 500,
      initiative: 40,
      level: 0 as number | 'X',
      actions: [
        {
          type: 'attack',
          value: 3,
          subActions: [
            { type: 'range', value: 4 },
            { type: 'pierce', value: 2 },
          ],
        },
      ],
    };

    const result = convertMonsterAbility(ghsAbility, 'archer', labels);
    expect(result.abilities).toEqual(['Attack 3, Range 4, Pierce 2']);
  });
});
