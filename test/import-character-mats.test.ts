import { describe, it, expect } from 'vitest';
import { convertCharacterMat, formatPerk } from '../src/import-character-mats.ts';

// ─── formatPerk ─────────────────────────────────────────────────────────────

describe('formatPerk', () => {
  const labels = {
    custom: {
      fh: {
        drifter: {
          '1': 'Move one of your character tokens backward one slot',
        },
        blinkblade: {
          '5': 'Gain Advantage on the next three attacks you perform',
        },
      },
    },
  };

  it('formats a remove perk', () => {
    const perk = {
      type: 'remove',
      count: 1,
      cards: [{ count: 1, attackModifier: { type: 'minus2' } }],
    };
    expect(formatPerk(perk, 'drifter', labels)).toBe('Remove 1 -2 card');
  });

  it('formats a replace perk with simple modifiers', () => {
    const perk = {
      type: 'replace',
      count: 3,
      cards: [
        { count: 1, attackModifier: { type: 'minus1' } },
        { count: 1, attackModifier: { type: 'plus1' } },
      ],
    };
    expect(formatPerk(perk, 'drifter', labels)).toBe('Replace 3 -1 cards with +1 cards');
  });

  it('formats an add perk', () => {
    const perk = {
      type: 'add',
      count: 2,
      cards: [
        {
          count: 1,
          attackModifier: {
            type: 'plus2',
            rolling: true,
            effects: [
              {
                type: 'condition',
                value: 'regenerate',
                effects: [{ type: 'specialTarget', value: 'self' }],
              },
            ],
          },
        },
      ],
    };
    expect(formatPerk(perk, 'drifter', labels)).toBe('Add 2 Rolling +2 Regenerate Self cards');
  });

  it('formats a perk with wound condition effect', () => {
    const perk = {
      type: 'replace',
      count: 2,
      cards: [
        { count: 1, attackModifier: { type: 'minus1' } },
        {
          count: 1,
          attackModifier: {
            type: 'plus0',
            effects: [{ type: 'condition', value: 'wound' }],
          },
        },
      ],
    };
    expect(formatPerk(perk, 'drifter', labels)).toBe('Replace 2 -1 cards with +0 Wound cards');
  });

  it('formats a custom perk by resolving label', () => {
    const perk = {
      type: 'custom',
      count: 1,
      custom: '%data.custom.fh.blinkblade.5%',
    };
    expect(formatPerk(perk, 'blinkblade', labels)).toBe(
      'Gain Advantage on the next three attacks you perform',
    );
  });

  it('formats a perk with custom effect on card (label reference)', () => {
    const perk = {
      type: 'replace',
      count: 2,
      cards: [
        { count: 1, attackModifier: { type: 'plus1' } },
        {
          count: 2,
          attackModifier: {
            type: 'plus0',
            effects: [{ type: 'custom', value: '%data.custom.fh.drifter.1%' }],
          },
        },
      ],
    };
    expect(formatPerk(perk, 'drifter', labels)).toBe(
      'Replace 2 +1 cards with two +0 Move one of your character tokens backward one slot cards',
    );
  });

  it('formats a perk with immunity', () => {
    const perk = {
      type: 'custom',
      count: 1,
      immunity: 'immobilize',
      custom: '%data.custom.fh.blinkblade.5%',
    };
    expect(formatPerk(perk, 'blinkblade', labels)).toBe(
      'Gain Advantage on the next three attacks you perform',
    );
  });

  it('formats replace perk with multiple-count cards', () => {
    const perk = {
      type: 'replace',
      count: 1,
      cards: [
        { count: 2, attackModifier: { type: 'plus1' } },
        { count: 2, attackModifier: { type: 'plus2' } },
      ],
    };
    expect(formatPerk(perk, 'drifter', labels)).toBe('Replace 1 two +1 cards with two +2 cards');
  });

  it('formats add perk with multiple card groups', () => {
    const perk = {
      type: 'add',
      count: 2,
      cards: [
        {
          count: 1,
          attackModifier: {
            type: 'plus0',
            rolling: true,
            effects: [{ type: 'condition', value: 'disarm' }],
          },
        },
        {
          count: 1,
          attackModifier: {
            type: 'plus0',
            rolling: true,
            effects: [{ type: 'condition', value: 'muddle' }],
          },
        },
      ],
    };
    expect(formatPerk(perk, 'drifter', labels)).toBe(
      'Add 2 Rolling +0 Disarm cards and Rolling +0 Muddle cards',
    );
  });

  it('formats replace perk with multiple new card groups', () => {
    const perk = {
      type: 'replace',
      count: 2,
      cards: [
        { count: 2, attackModifier: { type: 'plus0' } },
        {
          count: 1,
          attackModifier: {
            type: 'plus0',
            rolling: true,
            effects: [{ type: 'pierce', value: 3 }],
          },
        },
        {
          count: 1,
          attackModifier: {
            type: 'plus0',
            rolling: true,
            effects: [{ type: 'retaliate', value: 2 }],
          },
        },
      ],
    };
    expect(formatPerk(perk, 'drifter', labels)).toBe(
      'Replace 2 two +0 cards with Rolling +0 Pierce 3 cards and Rolling +0 Retaliate 2 cards',
    );
  });

  it('formats remove perk with multiple card groups', () => {
    const perk = {
      type: 'remove',
      count: 1,
      cards: [
        { count: 1, attackModifier: { type: 'minus2' } },
        { count: 1, attackModifier: { type: 'plus1' } },
      ],
    };
    expect(formatPerk(perk, 'drifter', labels)).toBe('Remove 1 -2 card and +1 card');
  });
});

// ─── convertCharacterMat ────────────────────────────────────────────────────

describe('convertCharacterMat', () => {
  const labels = {
    custom: {
      fh: {
        drifter: {
          '1': 'Move one of your character tokens backward one slot',
          '5': 'End a scenario with tokens on the last slots of four persistent abilities',
          '6': 'Never perform a move or attack with value less than 4',
        },
      },
    },
  };

  const ghsDrifter = {
    name: 'drifter',
    characterClass: 'inox',
    edition: 'fh',
    handSize: 12,
    traits: ['outcast', 'resourceful', 'strong'],
    color: '#a28b7c',
    stats: [
      { level: 1, health: 10 },
      { level: 2, health: 12 },
      { level: 3, health: 14 },
      { level: 4, health: 16 },
      { level: 5, health: 18 },
      { level: 6, health: 20 },
      { level: 7, health: 22 },
      { level: 8, health: 24 },
      { level: 9, health: 26 },
    ],
    perks: [
      {
        type: 'remove',
        count: 1,
        cards: [{ count: 1, attackModifier: { type: 'minus2' } }],
      },
    ],
    masteries: ['%data.custom.fh.drifter.5%', '%data.custom.fh.drifter.6%'],
  };

  it('converts name from kebab-case to title case', () => {
    const result = convertCharacterMat(ghsDrifter, labels);
    expect(result.name).toBe('Drifter');
  });

  it('converts characterClass to title case', () => {
    const result = convertCharacterMat(ghsDrifter, labels);
    expect(result.characterClass).toBe('Inox');
  });

  it('preserves hand size', () => {
    const result = convertCharacterMat(ghsDrifter, labels);
    expect(result.handSize).toBe(12);
  });

  it('preserves traits', () => {
    const result = convertCharacterMat(ghsDrifter, labels);
    expect(result.traits).toEqual(['outcast', 'resourceful', 'strong']);
  });

  it('converts stats array to HP record keyed by level string', () => {
    const result = convertCharacterMat(ghsDrifter, labels);
    expect(result.hp).toEqual({
      '1': 10,
      '2': 12,
      '3': 14,
      '4': 16,
      '5': 18,
      '6': 20,
      '7': 22,
      '8': 24,
      '9': 26,
    });
  });

  it('formats perks as human-readable strings', () => {
    const result = convertCharacterMat(ghsDrifter, labels);
    expect(result.perks).toEqual(['Remove 1 -2 card']);
  });

  it('resolves mastery label references', () => {
    const result = convertCharacterMat(ghsDrifter, labels);
    expect(result.masteries).toEqual([
      'End a scenario with tokens on the last slots of four persistent abilities',
      'Never perform a move or attack with value less than 4',
    ]);
  });

  it('sets sourceId field', () => {
    const result = convertCharacterMat(ghsDrifter, labels);
    expect(result.sourceId).toBe('gloomhavensecretariat:character-mat/drifter');
  });

  it('handles multi-word character names', () => {
    const ghs = {
      ...ghsDrifter,
      name: 'banner-spear',
      characterClass: 'valrath',
      stats: [{ level: 1, health: 10 }],
      perks: [],
      masteries: [],
    };
    const result = convertCharacterMat(ghs, labels);
    expect(result.name).toBe('Banner Spear');
    expect(result.characterClass).toBe('Valrath');
  });

  it('handles empty perks and masteries', () => {
    const ghs = {
      ...ghsDrifter,
      perks: [],
      masteries: [],
    };
    const result = convertCharacterMat(ghs, labels);
    expect(result.perks).toEqual([]);
    expect(result.masteries).toEqual([]);
  });

  it('handles missing optional fields gracefully', () => {
    const ghs = {
      name: 'test-char',
      characterClass: 'human',
      edition: 'fh',
      handSize: 10,
      traits: [],
      stats: [{ level: 1, health: 8 }],
      perks: [],
      masteries: [],
    };
    const result = convertCharacterMat(ghs, labels);
    expect(result.name).toBe('Test Char');
    expect(result.traits).toEqual([]);
    expect(result.hp).toEqual({ '1': 8 });
  });

  it('resolves game tokens in masteries', () => {
    const labelsWithGameTokens = {
      custom: {
        fh: {
          drifter: {
            '5': 'Perform %game.action.attack% 4 every round',
            '6': 'Some mastery',
          },
        },
      },
    };
    const ghs = {
      ...ghsDrifter,
      masteries: ['%data.custom.fh.drifter.5%'],
    };
    const result = convertCharacterMat(ghs, labelsWithGameTokens);
    expect(result.masteries).toEqual(['Perform Attack 4 every round']);
  });
});
