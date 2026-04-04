import { describe, it, expect } from 'vitest';
import { kebabToTitle, resolveLabel, resolveGameTokens, formatAction } from '../src/ghs-utils.ts';

// ─── kebabToTitle ────────────────────────────────────────────────────────────

describe('kebabToTitle', () => {
  it('converts kebab-case to title case', () => {
    expect(kebabToTitle('earth-demon')).toBe('Earth Demon');
  });

  it('handles single word', () => {
    expect(kebabToTitle('ooze')).toBe('Ooze');
  });

  it('handles multi-segment names', () => {
    expect(kebabToTitle('fracture-of-the-deep')).toBe('Fracture Of The Deep');
  });
});

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
