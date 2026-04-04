import { describe, it, expect } from 'vitest';
import {
  resolveLabel,
  resolveGameTokens,
  formatAction,
  convertAbility,
} from '../src/import-character-abilities.ts';

// ─── resolveGameTokens ──────────────────────────────────────────────────────

describe('resolveGameTokens', () => {
  it('replaces %game.action.X% with title-cased action name', () => {
    expect(resolveGameTokens('+2%game.action.attack%')).toBe('+2 Attack');
  });

  it('replaces %game.action.X:N% with action name and value', () => {
    expect(resolveGameTokens('%game.action.pierce:3%')).toBe('Pierce 3');
  });

  it('replaces %game.condition.X% with condition name', () => {
    expect(resolveGameTokens('%game.condition.immobilize%')).toBe('Immobilize');
  });

  it('handles multiple tokens in one string', () => {
    expect(resolveGameTokens('add +1%game.action.attack% and %game.condition.wound%')).toBe(
      'add +1 Attack and Wound',
    );
  });

  it('returns string unchanged when no tokens present', () => {
    expect(resolveGameTokens('Move 3')).toBe('Move 3');
  });

  it('handles %game.action.move:N% format', () => {
    expect(resolveGameTokens('%game.action.move:3%')).toBe('Move 3');
  });

  it('handles %game.card.recover% token', () => {
    expect(resolveGameTokens('%game.card.recover%')).toBe('Recover');
  });

  it('handles %game.items.slots.X% token', () => {
    expect(resolveGameTokens('%game.items.slots.onehand%')).toBe('One Hand');
  });
});

// ─── resolveLabel ────────────────────────────────────────────────────────────

describe('resolveLabel', () => {
  const labels = {
    custom: {
      fh: {
        drifter: {
          abilities: {
            '1': {
              '1': 'On your next six melee attacks, add +2%game.action.attack%.',
            },
          },
        },
      },
    },
  };

  it('resolves a %data.custom.fh...% reference', () => {
    const result = resolveLabel('%data.custom.fh.drifter.abilities.1.1%', labels);
    expect(result).toBe('On your next six melee attacks, add +2 Attack.');
  });

  it('returns the original string when path is not found', () => {
    const result = resolveLabel('%data.custom.fh.unknown.1%', labels);
    expect(result).toBe('%data.custom.fh.unknown.1%');
  });

  it('returns the original string when not a %data% reference', () => {
    const result = resolveLabel('plain text', labels);
    expect(result).toBe('plain text');
  });
});

// ─── formatAction ────────────────────────────────────────────────────────────

describe('formatAction', () => {
  const labels = {};

  it('formats an attack action', () => {
    expect(formatAction({ type: 'attack', value: 3 }, labels)).toBe('Attack 3');
  });

  it('formats a move action', () => {
    expect(formatAction({ type: 'move', value: 4 }, labels)).toBe('Move 4');
  });

  it('formats a heal action', () => {
    expect(formatAction({ type: 'heal', value: 2 }, labels)).toBe('Heal 2');
  });

  it('formats a shield action', () => {
    expect(formatAction({ type: 'shield', value: 1 }, labels)).toBe('Shield 1');
  });

  it('formats a retaliate action', () => {
    expect(formatAction({ type: 'retaliate', value: 2 }, labels)).toBe('Retaliate 2');
  });

  it('formats a loot action', () => {
    expect(formatAction({ type: 'loot', value: 1 }, labels)).toBe('Loot 1');
  });

  it('formats a condition action', () => {
    expect(formatAction({ type: 'condition', value: 'wound' }, labels)).toBe('Wound');
  });

  it('formats a push action', () => {
    expect(formatAction({ type: 'push', value: 2 }, labels)).toBe('Push 2');
  });

  it('formats a pull action', () => {
    expect(formatAction({ type: 'pull', value: 1 }, labels)).toBe('Pull 1');
  });

  it('formats a custom action with label reference', () => {
    const labelsWithData = {
      custom: {
        fh: {
          drifter: {
            abilities: { '1': { '1': 'Special ability text' } },
          },
        },
      },
    };
    expect(
      formatAction(
        { type: 'custom', value: '%data.custom.fh.drifter.abilities.1.1%' },
        labelsWithData,
      ),
    ).toBe('Special ability text');
  });

  it('formats a custom action with plain text value', () => {
    expect(formatAction({ type: 'custom', value: 'Some special text' }, labels)).toBe(
      'Some special text',
    );
  });

  it('includes subAction range', () => {
    expect(
      formatAction(
        {
          type: 'attack',
          value: 3,
          subActions: [{ type: 'range', value: 4, small: true }],
        },
        labels,
      ),
    ).toBe('Attack 3, Range 4');
  });

  it('includes subAction target', () => {
    expect(
      formatAction(
        {
          type: 'attack',
          value: 2,
          subActions: [{ type: 'target', value: 3, small: true }],
        },
        labels,
      ),
    ).toBe('Attack 2, Target 3');
  });

  it('includes subAction condition', () => {
    expect(
      formatAction(
        {
          type: 'attack',
          value: 3,
          subActions: [{ type: 'condition', value: 'disarm' }],
        },
        labels,
      ),
    ).toBe('Attack 3, Disarm');
  });

  it('includes subAction specialTarget self', () => {
    expect(
      formatAction(
        {
          type: 'heal',
          value: 3,
          subActions: [{ type: 'specialTarget', value: 'self', small: true }],
        },
        labels,
      ),
    ).toBe('Heal 3, Self');
  });

  it('skips area and enhancement subActions', () => {
    expect(
      formatAction(
        {
          type: 'attack',
          value: 3,
          subActions: [
            {
              type: 'area',
              value: '(0,0,target)|(1,0,target)',
            },
          ],
        },
        labels,
      ),
    ).toBe('Attack 3');
  });

  it('returns null for concatenation actions', () => {
    expect(formatAction({ type: 'concatenation', value: '' }, labels)).toBeNull();
  });

  it('returns null for forceBox actions', () => {
    expect(formatAction({ type: 'forceBox', value: '' }, labels)).toBeNull();
  });
});

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
