import { describe, it, expect } from 'vitest';
import { convertAbility } from '../src/import-character-abilities.ts';

// ─── convertAbility ──────────────────────────────────────────────────────────

describe('convertAbility', () => {
  const labels = {
    custom: {
      fh: {
        drifter: {
          abilities: {
            '1': {
              '1': 'On your next six melee attacks, add +2%game.action.attack%.',
              '2': 'Move the token backwards one slot.',
            },
          },
        },
      },
    },
  };

  it('converts a basic GHS ability to CharacterAbility format', () => {
    const ghsAbility = {
      name: 'Crushing Weight',
      cardId: 1,
      level: 1,
      initiative: 83,
      actions: [{ type: 'attack', value: 3 }],
      bottomActions: [{ type: 'move', value: 4 }],
    };

    const result = convertAbility(ghsAbility, 'drifter', labels);

    expect(result).toEqual({
      cardName: 'Crushing Weight',
      characterClass: 'Drifter',
      level: 1,
      initiative: 83,
      top: {
        action: 'Attack 3',
        effects: [],
      },
      bottom: {
        action: 'Move 4',
        effects: [],
      },
      lost: false,
      _source: 'gloomhavensecretariat:drifter/1',
    });
  });

  it('sets lost flag from bottomLost', () => {
    const ghsAbility = {
      name: 'Big Hit',
      cardId: 2,
      level: 1,
      initiative: 50,
      actions: [{ type: 'attack', value: 5 }],
      bottomLost: true,
      bottomActions: [{ type: 'move', value: 2 }],
    };

    const result = convertAbility(ghsAbility, 'drifter', labels);
    expect(result.lost).toBe(true);
  });

  it('sets lost flag from topLost', () => {
    const ghsAbility = {
      name: 'Sacrifice',
      cardId: 3,
      level: 1,
      initiative: 50,
      topLost: true,
      actions: [{ type: 'heal', value: 10 }],
      bottomActions: [{ type: 'move', value: 2 }],
    };

    const result = convertAbility(ghsAbility, 'drifter', labels);
    expect(result.lost).toBe(true);
  });

  it('converts characterClass from kebab-case filename', () => {
    const ghsAbility = {
      name: 'Shield Bash',
      cardId: 61,
      level: 1,
      initiative: 60,
      actions: [{ type: 'attack', value: 2 }],
      bottomActions: [{ type: 'shield', value: 1 }],
    };

    const result = convertAbility(ghsAbility, 'banner-spear', labels);
    expect(result.characterClass).toBe('Banner Spear');
  });

  it('puts multiple top actions as primary + effects', () => {
    const ghsAbility = {
      name: 'Multi Action',
      cardId: 10,
      level: 1,
      initiative: 40,
      actions: [
        { type: 'attack', value: 2 },
        { type: 'move', value: 3 },
        { type: 'condition', value: 'poison' },
      ],
      bottomActions: [{ type: 'move', value: 4 }],
    };

    const result = convertAbility(ghsAbility, 'drifter', labels);
    expect(result.top.action).toBe('Attack 2');
    expect(result.top.effects).toEqual(['Move 3', 'Poison']);
  });

  it('handles abilities with custom label references', () => {
    const ghsAbility = {
      name: 'Token Slider',
      cardId: 1,
      level: 1,
      initiative: 50,
      actions: [
        { type: 'attack', value: 2 },
        { type: 'custom', value: '%data.custom.fh.drifter.abilities.1.1%', small: true },
      ],
      bottomActions: [
        { type: 'move', value: 3 },
        { type: 'custom', value: '%data.custom.fh.drifter.abilities.1.2%', small: true },
      ],
    };

    const result = convertAbility(ghsAbility, 'drifter', labels);
    expect(result.top.effects).toContain('On your next six melee attacks, add +2 Attack.');
    expect(result.bottom.effects).toContain('Move the token backwards one slot.');
  });

  it('handles empty actions gracefully', () => {
    const ghsAbility = {
      name: 'Empty Card',
      cardId: 99,
      level: 1,
      initiative: 50,
      actions: [],
      bottomActions: [],
    };

    const result = convertAbility(ghsAbility, 'drifter', labels);
    expect(result.top.action).toBe('');
    expect(result.top.effects).toEqual([]);
    expect(result.bottom.action).toBe('');
    expect(result.bottom.effects).toEqual([]);
  });

  it('handles missing bottomActions', () => {
    const ghsAbility = {
      name: 'Top Only',
      cardId: 50,
      level: 1,
      initiative: 30,
      actions: [{ type: 'attack', value: 3 }],
    };

    const result = convertAbility(ghsAbility, 'drifter', labels);
    expect(result.bottom.action).toBe('');
    expect(result.bottom.effects).toEqual([]);
  });

  it('preserves level "X" for cards with no numeric level', () => {
    const ghsAbility = {
      name: 'Special Card',
      cardId: 99,
      level: 'X' as const,
      initiative: 50,
      actions: [{ type: 'attack', value: 2 }],
      bottomActions: [{ type: 'move', value: 3 }],
    };

    const result = convertAbility(ghsAbility, 'drifter', labels);
    expect(result.level).toBe('X');
  });

  it('skips non-formattable actions (concatenation, forceBox)', () => {
    const ghsAbility = {
      name: 'Complex Card',
      cardId: 20,
      level: 1,
      initiative: 60,
      actions: [
        { type: 'attack', value: 3 },
        { type: 'forceBox', value: '' },
        { type: 'concatenation', value: '', subActions: [] },
      ],
      bottomActions: [{ type: 'move', value: 2 }],
    };

    const result = convertAbility(ghsAbility, 'drifter', labels);
    expect(result.top.action).toBe('Attack 3');
    expect(result.top.effects).toEqual([]);
  });
});
