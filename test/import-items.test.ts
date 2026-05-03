import { describe, it, expect } from 'vitest';
import { convertItem, resolveNestedDataRefs } from '../src/import-items.ts';
import type { LabelData } from '../src/ghs-utils.ts';

// ─── convertItem ────────────────────────────────────────────────────────────

describe('convertItem', () => {
  const labels: LabelData = {
    items: {
      'fh-1': {
        '': 'Spyglass',
        '1': 'During your attack ability, gain advantage on one attack.',
      },
      'fh-84': {
        '': 'Stamina Potion',
        '1': 'During your turn, %game.card.recover% one card from your discard pile.',
      },
      'fh-120': {
        '': 'Amulet of Life',
        '1': 'After an ally within %game.action.range% 3 would become exhausted.',
      },
      'fh-245': {
        '': 'Ancient Coin',
      },
    },
  };

  it('converts a basic item with spent usage', () => {
    const ghsItem = {
      id: 1,
      name: 'Spyglass',
      count: 2,
      edition: 'fh',
      slot: 'head',
      spent: true,
      resources: { metal: 1 },
      actions: [{ type: 'custom', value: '%data.items.fh-1.1%', small: true }],
    };

    const result = convertItem(ghsItem, labels);

    expect(result).toEqual({
      number: '001',
      name: 'Spyglass',
      slot: 'head',
      cost: null,
      craftCost: { resources: { metal: 1 } },
      effect: 'During your attack ability, gain advantage on one attack.',
      uses: null,
      spent: true,
      lost: false,
      sourceId: 'gloomhavensecretariat:item/1',
    });
  });

  it('maps GHS slot names to schema slot names', () => {
    const makeItem = (slot: string) => ({
      id: 10,
      name: 'Test',
      count: 1,
      edition: 'fh',
      slot,
      actions: [],
    });

    expect(convertItem({ ...makeItem('onehand') }, labels).slot).toBe('one hand');
    expect(convertItem({ ...makeItem('twohand') }, labels).slot).toBe('two hands');
    expect(convertItem({ ...makeItem('small') }, labels).slot).toBe('small item');
    expect(convertItem({ ...makeItem('head') }, labels).slot).toBe('head');
    expect(convertItem({ ...makeItem('body') }, labels).slot).toBe('body');
    expect(convertItem({ ...makeItem('legs') }, labels).slot).toBe('legs');
  });

  it('pads item number to 3 digits', () => {
    const ghsItem = {
      id: 7,
      name: 'Test',
      count: 1,
      edition: 'fh',
      slot: 'head',
      actions: [],
    };

    expect(convertItem(ghsItem, labels).number).toBe('007');
  });

  it('includes cost when present', () => {
    const ghsItem = {
      id: 120,
      name: 'Amulet of Life',
      cost: 15,
      count: 2,
      edition: 'fh',
      slot: 'head',
      spent: true,
      actions: [{ type: 'custom', value: '%data.items.fh-120.1%', small: true }],
    };

    expect(convertItem(ghsItem, labels).cost).toBe(15);
  });

  it('includes craft resource costs when present', () => {
    const ghsItem = {
      id: 5,
      name: 'Crude Boots',
      count: 2,
      edition: 'fh',
      slot: 'legs',
      spent: true,
      resources: { hide: 2 },
      requiredBuilding: 'craftsman',
      requiredBuildingLevel: 1,
      actions: [{ type: 'custom', value: '%data.items.fh-5.1%', small: true }],
    };

    const result = convertItem(ghsItem, {
      items: {
        'fh-5': {
          '': 'Crude Boots',
          '1': 'During your move ability, add +1 %game.action.move%',
        },
      },
    });

    expect(result).toMatchObject({
      number: '005',
      name: 'Crude Boots',
      slot: 'legs',
      cost: null,
      craftCost: { resources: { hide: 2 } },
      effect: 'During your move ability, add +1 Move',
      spent: true,
      lost: false,
    });
  });

  it('includes resource-any craft costs when present', () => {
    const ghsItem = {
      id: 98,
      name: 'Unhealthy Mixture',
      count: 2,
      edition: 'fh',
      slot: 'small',
      resourcesAny: [{ herb_resources: 1 }, { herb_resources: 1 }],
      actions: [{ type: 'custom', value: '%data.items.fh-98.1%', small: true }],
    };

    const result = convertItem(ghsItem, {
      items: {
        'fh-98': {
          '': 'Unhealthy Mixture',
          '1': 'During your turn, perform %game.condition.wound%, %game.condition.poison% self',
        },
      },
    });

    expect(result).toMatchObject({
      number: '098',
      name: 'Unhealthy Mixture',
      slot: 'small item',
      cost: null,
      craftCost: { resourcesAny: [{ herb_resources: 1 }, { herb_resources: 1 }] },
      effect: 'During your turn, perform Wound, Poison self',
    });
  });

  it('normalizes empty craft-cost payloads to null', () => {
    const ghsItem = {
      id: 200,
      name: 'Empty Craft Cost',
      count: 1,
      edition: 'fh',
      slot: 'small',
      resources: {},
      resourcesAny: [],
      actions: [],
    };

    expect(convertItem(ghsItem, labels).craftCost).toBeNull();
  });

  it('sets lost from the loss field', () => {
    const ghsItem = {
      id: 84,
      name: 'Stamina Potion',
      count: 2,
      edition: 'fh',
      slot: 'small',
      consumed: true,
      loss: true,
      actions: [{ type: 'custom', value: '%data.items.fh-84.1%', small: true }],
    };

    const result = convertItem(ghsItem, labels);
    expect(result.lost).toBe(true);
  });

  it('resolves %game.*% tokens in effect text', () => {
    const ghsItem = {
      id: 84,
      name: 'Stamina Potion',
      count: 2,
      edition: 'fh',
      slot: 'small',
      consumed: true,
      actions: [{ type: 'custom', value: '%data.items.fh-84.1%', small: true }],
    };

    const result = convertItem(ghsItem, labels);
    // %game.card.recover% should be resolved to "Recover"
    expect(result.effect).toContain('Recover');
    expect(result.effect).not.toContain('%game.');
  });

  it('concatenates multiple action texts into effect', () => {
    const ghsItem = {
      id: 120,
      name: 'Amulet of Life',
      cost: 15,
      count: 2,
      edition: 'fh',
      slot: 'head',
      spent: true,
      actions: [
        { type: 'custom', value: '%data.items.fh-120.1%', small: true },
        {
          type: 'heal',
          value: 1,
          subActions: [{ type: 'specialTarget', value: 'self', small: true }],
        },
      ],
    };

    const result = convertItem(ghsItem, labels);
    // Should include both the custom label text and the heal action
    expect(result.effect).toContain('After an ally within');
    expect(result.effect).toContain('Heal 1');
  });

  it('handles items with no slot (defaults to small item)', () => {
    const ghsItem = {
      id: 245,
      name: 'Ancient Coin',
      cost: 0,
      count: 4,
      edition: 'fh',
      actions: [],
    };

    const result = convertItem(ghsItem, labels);
    expect(result.slot).toBe('small item');
  });

  it('handles items with no actions (empty effect)', () => {
    const ghsItem = {
      id: 245,
      name: 'Ancient Coin',
      cost: 0,
      count: 4,
      edition: 'fh',
      actions: [],
    };

    const result = convertItem(ghsItem, labels);
    expect(result.effect).toBe('');
  });

  it('defaults spent to false when not present', () => {
    const ghsItem = {
      id: 2,
      name: 'Crude Helmet',
      count: 2,
      edition: 'fh',
      slot: 'head',
      actions: [],
    };

    const result = convertItem(ghsItem, labels);
    expect(result.spent).toBe(false);
  });
});

// ─── resolveNestedDataRefs ──────────────────────────────────────────────────

describe('resolveNestedDataRefs', () => {
  const labels: LabelData = {
    items: {
      'fh-1': { '1': 'some text' },
    },
  };

  it('resolves action.custom.fh-* to title case', () => {
    const text = 'gain 3 %data.action.custom.fh-hourglass%.';
    expect(resolveNestedDataRefs(text, labels)).toBe('gain 3 Hourglass.');
  });

  it('resolves characterToken refs to readable token names', () => {
    const text = 'gain 1 %data.characterToken.blinkblade.time%';
    expect(resolveNestedDataRefs(text, labels)).toBe('gain 1 Time token');
  });

  it('resolves refs that exist in labels', () => {
    const text = 'effect: %data.items.fh-1.1%';
    expect(resolveNestedDataRefs(text, labels)).toBe('effect: some text');
  });

  it('leaves text without data refs unchanged', () => {
    const text = 'Attack 3, Range 2';
    expect(resolveNestedDataRefs(text, labels)).toBe('Attack 3, Range 2');
  });
});
