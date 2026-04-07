import { describe, it, expect } from 'vitest';
import { convertEvent, formatOutcomes, formatEffect } from '../src/import-events.ts';

describe('formatEffect', () => {
  it('formats morale gain', () => {
    expect(formatEffect({ type: 'morale', values: [1] })).toBe('Gain 1 morale');
  });

  it('formats morale loss', () => {
    expect(formatEffect({ type: 'loseMorale', values: [2] })).toBe('Lose 2 morale');
  });

  it('formats prosperity gain', () => {
    expect(formatEffect({ type: 'prosperity', values: [1] })).toBe('Gain 1 prosperity');
  });

  it('formats experience gain', () => {
    expect(formatEffect({ type: 'experience', values: [10] })).toBe('Gain 10 experience');
  });

  it('formats gold gain', () => {
    expect(formatEffect({ type: 'gold', values: [5] })).toBe('Gain 5 gold');
  });

  it('formats inspiration gain', () => {
    expect(formatEffect({ type: 'inspiration', values: [1] })).toBe('Gain 1 inspiration');
  });

  it('formats scenario condition effects', () => {
    expect(formatEffect({ type: 'scenarioCondition', alt: 'fh', values: ['wound'] })).toBe(
      'All characters start the next scenario with Wound',
    );
  });

  it('formats multiple scenario conditions', () => {
    expect(
      formatEffect({ type: 'scenarioCondition', alt: 'fh', values: ['poison', 'impair'] }),
    ).toBe('All characters start the next scenario with Poison, Impair');
  });

  it('formats unlock scenario', () => {
    expect(formatEffect({ type: 'unlockScenario', alt: 'fh', values: ['122'] })).toBe(
      'Unlock scenario 122',
    );
  });

  it('formats collective resource', () => {
    expect(formatEffect({ type: 'collectiveResource', values: ['lumber', 2] })).toBe(
      'Gain 2 collective lumber',
    );
  });

  it('formats lose collective resource', () => {
    expect(formatEffect({ type: 'loseCollectiveResource', values: ['hide', 1] })).toBe(
      'Lose 1 collective hide',
    );
  });

  it('formats draw another event', () => {
    expect(formatEffect({ type: 'drawAnotherEvent', alt: 'fh', values: ['boat'] })).toBe(
      'Draw another boat event',
    );
  });

  it('formats noEffect', () => {
    expect(formatEffect({ type: 'noEffect' })).toBe('No effect');
  });

  it('formats remove event', () => {
    expect(formatEffect({ type: 'removeEvent' })).toBe('Remove this event from the deck');
  });

  it('formats soldier gain', () => {
    expect(formatEffect({ type: 'soldier', values: [1] })).toBe('Gain 1 soldier');
  });

  it('formats campaign sticker', () => {
    expect(formatEffect({ type: 'campaignSticker', values: ['firepepper'] })).toBe(
      'Add campaign sticker: firepepper',
    );
  });

  it('formats string effects with game tokens', () => {
    expect(
      formatEffect('Return one collective %game.itemSlot:small% to the available supply.'),
    ).toBe('Return one collective Small to the available supply.');
  });

  it('formats discard effect', () => {
    expect(formatEffect({ type: 'discard', alt: 'fh', values: [2, 'brittle'] })).toBe(
      'Discard 2 cards; gain Brittle',
    );
  });

  it('formats scenario damage', () => {
    expect(formatEffect({ type: 'scenarioDamage', values: [2] })).toBe(
      'All characters suffer 2 damage at the start of the next scenario',
    );
  });

  it('formats random item', () => {
    expect(formatEffect({ type: 'randomItem' })).toBe('Gain a random item');
  });

  it('formats random item blueprint', () => {
    expect(formatEffect({ type: 'randomItemBlueprint' })).toBe('Gain a random item blueprint');
  });

  it('formats item effect', () => {
    expect(formatEffect({ type: 'item', values: ['044'] })).toBe('Gain item 044');
  });

  it('formats resource gain', () => {
    expect(formatEffect({ type: 'resource', values: ['hide', 1] })).toBe('Gain 1 hide');
  });

  it('formats lose resource', () => {
    expect(formatEffect({ type: 'loseResource', values: ['lumber', 2] })).toBe('Lose 2 lumber');
  });

  it('formats lose gold', () => {
    expect(formatEffect({ type: 'loseGold', values: [5] })).toBe('Lose 5 gold');
  });

  it('returns null for outcome references', () => {
    expect(formatEffect({ type: 'outcome', values: ['C'] })).toBeNull();
  });

  it('returns null for unknown effect types', () => {
    expect(formatEffect({ type: 'someUnknownType', values: [] })).toBeNull();
  });
});

describe('formatOutcomes', () => {
  it('formats a simple outcome with narrative and effects', () => {
    const outcomes = [
      {
        narrative: 'You find some gold.',
        effects: [{ type: 'gold', values: [10] }],
      },
    ];
    expect(formatOutcomes(outcomes)).toBe('You find some gold. Gain 10 gold.');
  });

  it('formats outcome with condition', () => {
    const outcomes = [
      {
        condition: { type: 'season', values: ['winter'] },
        narrative: 'The ice is thick.',
        effects: [{ type: 'noEffect' }],
      },
      {
        condition: { type: 'season', values: ['summer'] },
        narrative: 'The ice has melted.',
        effects: [{ type: 'morale', values: [1] }],
      },
    ];
    expect(formatOutcomes(outcomes)).toBe(
      'WINTER: The ice is thick. No effect. SUMMER: The ice has melted. Gain 1 morale.',
    );
  });

  it('formats outcome with otherwise condition', () => {
    const outcomes = [
      {
        condition: { type: 'building', values: ['climbing-gear'] },
        narrative: 'You climb easily.',
        effects: [{ type: 'morale', values: [1] }],
      },
      {
        condition: { type: 'otherwise' },
        narrative: 'You struggle.',
        effects: [{ type: 'scenarioCondition', alt: 'fh', values: ['wound'] }],
      },
    ];
    expect(formatOutcomes(outcomes)).toBe(
      'CLIMBING-GEAR: You climb easily. Gain 1 morale. OTHERWISE: You struggle. All characters start the next scenario with Wound.',
    );
  });

  it('formats outcome with traits condition', () => {
    const outcomes = [
      {
        condition: { type: 'traits', values: ['strong'] },
        narrative: 'Your strength helps.',
        effects: [{ type: 'experience', values: [5] }],
      },
    ];
    expect(formatOutcomes(outcomes)).toBe('STRONG: Your strength helps. Gain 5 experience.');
  });

  it('formats outcome with string condition', () => {
    const outcomes = [
      {
        condition: 'RESULT > 6',
        narrative: 'You hit the target.',
        effects: [{ type: 'morale', values: [2] }],
      },
    ];
    expect(formatOutcomes(outcomes)).toBe('RESULT > 6: You hit the target. Gain 2 morale.');
  });

  it('handles outcomes with no narrative', () => {
    const outcomes = [
      {
        effects: [{ type: 'morale', values: [2] }],
      },
    ];
    expect(formatOutcomes(outcomes)).toBe('Gain 2 morale.');
  });

  it('handles outcomes with string effects', () => {
    const outcomes = [
      {
        narrative: 'A strange thing happens.',
        effects: ['All characters lose 1 %game.resource.hide%.'],
      },
    ];
    expect(formatOutcomes(outcomes)).toBe('A strange thing happens. All characters lose 1 Hide.');
  });

  it('skips outcome-reference effects and keeps other effects', () => {
    const outcomes = [
      {
        effects: [
          {
            condition: { type: 'building', values: ['sled', 'climbing-gear'] },
            type: 'outcome',
            values: ['C'],
          },
        ],
      },
      {
        condition: { type: 'building', values: ['climbing-gear'] },
        narrative: 'You climb easily.',
        effects: [{ type: 'morale', values: [1] }],
      },
    ];
    // The first outcome is purely an outcome reference, so it's skipped
    expect(formatOutcomes(outcomes)).toBe('CLIMBING-GEAR: You climb easily. Gain 1 morale.');
  });

  it('strips HTML tags from narratives', () => {
    const outcomes = [
      {
        narrative: 'Blood in the snow.<br><br>You draw closer.',
        effects: [{ type: 'noEffect' }],
      },
    ];
    expect(formatOutcomes(outcomes)).toBe('Blood in the snow. You draw closer. No effect.');
  });
});

describe('convertEvent', () => {
  it('converts a simple boat event', () => {
    const ghs = {
      cardId: 'B-01',
      edition: 'fh',
      type: 'boat',
      narrative: 'The ship has run aground.',
      options: [
        {
          label: 'A',
          narrative: 'Climb to the peak.',
          outcomes: [
            {
              narrative: 'You see a beautiful view.',
              effects: [{ type: 'morale', values: [1] }],
            },
          ],
        },
        {
          label: 'B',
          narrative: 'Explore the coastline.',
          outcomes: [
            {
              narrative: 'You find some supplies.',
              effects: [{ type: 'gold', values: [5] }],
            },
          ],
        },
      ],
    };

    const result = convertEvent(ghs);

    expect(result.eventType).toBe('boat');
    expect(result.season).toBeNull();
    expect(result.number).toBe('01');
    expect(result.flavorText).toBe('The ship has run aground.');
    expect(result.optionA).toEqual({
      text: 'Climb to the peak.',
      outcome: 'You see a beautiful view. Gain 1 morale.',
    });
    expect(result.optionB).toEqual({
      text: 'Explore the coastline.',
      outcome: 'You find some supplies. Gain 5 gold.',
    });
    expect(result.optionC).toBeNull();
    expect(result.sourceId).toBe('gloomhavensecretariat:event/B-01');
  });

  it('splits summer-road into eventType=road, season=summer', () => {
    const ghs = {
      cardId: 'SR-01',
      edition: 'fh',
      type: 'summer-road',
      narrative: 'A peaceful road.',
      options: [
        {
          label: 'A',
          narrative: 'Keep walking.',
          outcomes: [{ effects: [{ type: 'noEffect' }] }],
        },
      ],
    };

    const result = convertEvent(ghs);

    expect(result.eventType).toBe('road');
    expect(result.season).toBe('summer');
    expect(result.number).toBe('01');
  });

  it('splits winter-outpost into eventType=outpost, season=winter', () => {
    const ghs = {
      cardId: 'WO-05',
      edition: 'fh',
      type: 'winter-outpost',
      narrative: 'The outpost is cold.',
      options: [
        {
          label: 'A',
          narrative: 'Stay inside.',
          outcomes: [{ effects: [{ type: 'noEffect' }] }],
        },
      ],
    };

    const result = convertEvent(ghs);

    expect(result.eventType).toBe('outpost');
    expect(result.season).toBe('winter');
    expect(result.number).toBe('05');
  });

  it('converts event with option C', () => {
    const ghs = {
      cardId: 'B-01',
      edition: 'fh',
      type: 'boat',
      narrative: 'A fun event.',
      options: [
        {
          label: 'A',
          narrative: 'Choice A.',
          outcomes: [{ effects: [{ type: 'noEffect' }] }],
        },
        {
          label: 'B',
          narrative: 'Choice B.',
          outcomes: [{ effects: [{ type: 'noEffect' }] }],
        },
        {
          label: 'C',
          outcomes: [
            {
              narrative: 'You did the secret thing.',
              effects: [{ type: 'morale', values: [2] }],
            },
          ],
        },
      ],
    };

    const result = convertEvent(ghs);

    expect(result.optionC).toEqual({
      text: '',
      outcome: 'You did the secret thing. Gain 2 morale.',
    });
  });

  it('handles options without labels (unlabeled)', () => {
    // Some GHS events have options without explicit labels
    const ghs = {
      cardId: 'SO-10',
      edition: 'fh',
      type: 'summer-outpost',
      narrative: 'Something happens.',
      options: [
        {
          narrative: 'First choice.',
          outcomes: [{ effects: [{ type: 'noEffect' }] }],
        },
        {
          narrative: 'Second choice.',
          outcomes: [{ effects: [{ type: 'morale', values: [1] }] }],
        },
      ],
    };

    const result = convertEvent(ghs);

    // Unlabeled options assigned A, B in order
    expect(result.optionA).toEqual({
      text: 'First choice.',
      outcome: 'No effect.',
    });
    expect(result.optionB).toEqual({
      text: 'Second choice.',
      outcome: 'Gain 1 morale.',
    });
  });

  it('strips HTML from narrative text', () => {
    const ghs = {
      cardId: 'SR-01',
      edition: 'fh',
      type: 'summer-road',
      narrative: 'Blood in the snow.<br><br>You draw closer to the scene.',
      options: [
        {
          label: 'A',
          narrative: 'Follow the trail.',
          outcomes: [{ effects: [{ type: 'noEffect' }] }],
        },
      ],
    };

    const result = convertEvent(ghs);

    expect(result.flavorText).toBe('Blood in the snow. You draw closer to the scene.');
  });

  it('extracts event number from cardId prefix correctly', () => {
    const cases: Array<{ cardId: string; type: string; expectedNumber: string }> = [
      { cardId: 'B-01', type: 'boat', expectedNumber: '01' },
      { cardId: 'SR-42', type: 'summer-road', expectedNumber: '42' },
      { cardId: 'WO-100', type: 'winter-outpost', expectedNumber: '100' },
    ];

    for (const { cardId, type, expectedNumber } of cases) {
      const ghs = {
        cardId,
        edition: 'fh',
        type,
        narrative: 'Test.',
        options: [
          {
            label: 'A',
            narrative: 'Test.',
            outcomes: [{ effects: [{ type: 'noEffect' }] }],
          },
        ],
      };
      expect(convertEvent(ghs).number).toBe(expectedNumber);
    }
  });
});
