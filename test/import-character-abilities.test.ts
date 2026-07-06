import { describe, it, expect } from 'vitest';
import { GLOOMHAVEN_2E_GAME_ID } from '../src/game.ts';
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
      sourceId: 'gloomhavensecretariat:character-ability/drifter/1',
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

  it('uses GH2e spoiler labels instead of legacy class symbols', () => {
    const ghsAbility = {
      name: 'Booster Pack',
      cardId: 431,
      level: 1,
      initiative: 52,
      actions: [{ type: 'attack', value: 2 }],
      bottomActions: [{ type: 'move', value: 2 }],
    };
    const gh2Labels = {
      character: {
        gh2e: {
          'three-spears': { '': 'Quartermaster' },
        },
      },
    };

    const result = convertAbility(ghsAbility, 'three-spears', gh2Labels, GLOOMHAVEN_2E_GAME_ID);
    expect(result.characterClass).toBe('Quartermaster');
    expect(result.sourceId).toBe('gloomhavensecretariat:character-ability/three-spears/431');
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

  it('flattens nested sub-actions so bottom-action effects survive (SQR-396)', () => {
    // Mirrors GHS gh2e cragheart card 116 (Opposing Strike): the custom
    // bottom action carries heal 2 → range 3 in nested subActions, plus a
    // layout-only concatenation of enhancement slots that must not leak.
    const gh2Labels = {
      custom: {
        gh2e: {
          cragheart: {
            abilities: { '116': { '1': 'At the end of this and your next four turns, perform:' } },
          },
        },
      },
    };
    const ghsAbility = {
      name: 'Opposing Strike',
      cardId: 116,
      level: 1,
      initiative: 46,
      actions: [
        {
          type: 'attack',
          value: 3,
          subActions: [
            { type: 'area', value: '(0,0,enhance)|(1,0,target)' },
            {
              type: 'element',
              value: 'earth',
              valueType: 'minus',
              small: true,
              subActions: [
                { type: 'attack', value: 1, valueType: 'add' },
                { type: 'condition', value: 'muddle' },
                { type: 'card', value: 'experience:1' },
              ],
            },
          ],
        },
      ],
      bottomLost: true,
      bottomActions: [
        {
          type: 'custom',
          value: '%data.custom.gh2e.cragheart.abilities.116.1%',
          small: true,
          subActions: [
            {
              type: 'heal',
              value: 2,
              subActions: [{ type: 'range', value: 3, small: true }],
            },
            {
              type: 'concatenation',
              value: '',
              subActions: [
                { type: 'card', value: 'slotStartXp:1' },
                { type: 'card', value: 'slot' },
              ],
            },
          ],
        },
      ],
    };

    const result = convertAbility(ghsAbility, 'cragheart', gh2Labels, GLOOMHAVEN_2E_GAME_ID);
    expect(result.bottom.action).toContain('perform:');
    expect(result.bottom.action).toContain('Heal 2');
    expect(result.bottom.action).toContain('Range 3');
    expect(result.bottom.action).not.toContain('slot');
    expect(result.top.action).toContain('Attack 3');
    expect(result.top.action).toContain('Consume Earth');
    expect(result.top.action).toContain('Attack +1');
    expect(result.top.action).toContain('Muddle');
    expect(result.top.action).toContain('XP 1');
  });

  it('decodes two-speed initiative into fast and slow values (SQR-396)', () => {
    // Blinkblade-style cards encode both speeds in one number: 2050 means
    // initiative 20 when played fast and 50 when played slow (Brian's ruling
    // from calibration batch 4 — never a "tiebreaker").
    const ghsAbility = {
      name: 'Blurry Jab',
      cardId: 32,
      level: 1,
      initiative: 2050,
      actions: [{ type: 'custom', value: '%character.abilities.wip%' }],
      bottomActions: [{ type: 'custom', value: '%character.abilities.wip%' }],
    };

    const result = convertAbility(ghsAbility, 'blinkblade', labels);
    expect(result.initiative).toBe(2050);
    expect(result.initiativeFast).toBe(20);
    expect(result.initiativeSlow).toBe(50);
    expect(result.top.action).toBe('(ability text not yet available)');

    const normal = convertAbility(
      {
        name: 'Crushing Weight',
        cardId: 1,
        level: 1,
        initiative: 83,
        actions: [{ type: 'attack', value: 3 }],
        bottomActions: [{ type: 'move', value: 4 }],
      },
      'drifter',
      labels,
    );
    expect(normal.initiativeFast).toBeUndefined();
    expect(normal.initiativeSlow).toBeUndefined();
  });

  it('renders valueless sub-action markers as bare keywords (SQR-396)', () => {
    // GHS bruiser Trample: bottom Move 4 with a valueless { type: 'jump' }
    // rider — must render "Move 4, Jump", never "Jump undefined".
    const ghsAbility = {
      name: 'Trample',
      cardId: 72,
      level: 1,
      initiative: 72,
      actions: [{ type: 'attack', value: 3, subActions: [{ type: 'pierce', value: 3 }] }],
      bottomActions: [
        { type: 'move', value: 4, subActions: [{ type: 'jump', value: undefined as never }] },
      ],
    };

    const result = convertAbility(ghsAbility, 'bruiser', labels);
    expect(result.bottom.action).toBe('Move 4, Jump');
    expect(result.bottom.action).not.toContain('undefined');
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
