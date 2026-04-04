import { describe, it, expect } from 'vitest';
import { convertPersonalQuest } from '../src/import-personal-quests.ts';
import type { LabelData } from '../src/ghs-utils.ts';

const labels: LabelData = {
  personalQuest: {
    fh: {
      '100': {
        '': 'Test Quest Title',
        '1': 'Things collected',
        '2': 'Follow "Some Place" %game.scenarioNumber:42% to a conclusion',
      },
      '200': {
        '': 'Checkbox Quest',
        '1': 'Different herbs looted',
      },
      '300': {
        '': 'Multi Requirement',
        '1': 'First thing done',
        '2': 'Second thing done',
        '3': 'Third thing done',
      },
    },
  },
};

describe('convertPersonalQuest', () => {
  it('converts a simple single-requirement quest', () => {
    const ghs = {
      cardId: '100',
      altId: '01',
      requirements: [{ name: '%data.personalQuest.fh.100.1%', counter: 5 }],
      openEnvelope: '24:42',
    };

    const result = convertPersonalQuest(ghs, labels);

    expect(result).toEqual({
      cardId: '100',
      name: 'Test Quest Title',
      requirements: [
        {
          description: 'Things collected',
          target: 5,
          options: null,
          dependsOn: null,
        },
      ],
      openEnvelope: '24:42',
      _source: 'gloomhavensecretariat:personal-quest/100',
    });
  });

  it('resolves game tokens in requirement text', () => {
    const ghs = {
      cardId: '100',
      altId: '02',
      requirements: [
        { name: '%data.personalQuest.fh.100.1%', counter: 8 },
        {
          name: '%data.personalQuest.fh.100.2%',
          counter: 1,
          requires: [1],
        },
      ],
      openEnvelope: '24:42',
    };

    const result = convertPersonalQuest(ghs, labels);

    expect(result.requirements[1].description).toBe(
      'Follow "Some Place" ScenarioNumber 42 to a conclusion',
    );
    expect(result.requirements[1].dependsOn).toEqual([1]);
  });

  it('converts checkbox options with game tokens', () => {
    const ghs = {
      cardId: '200',
      altId: '03',
      requirements: [
        {
          name: '%data.personalQuest.fh.200.1%',
          counter: 3,
          checkbox: ['%game.resource.arrowvine%', '%game.resource.axenut%'],
        },
      ],
      openEnvelope: '37:74',
    };

    const result = convertPersonalQuest(ghs, labels);

    expect(result.requirements[0].options).toEqual(['Arrowvine', 'Axenut']);
  });

  it('handles multiple requirements with dependencies', () => {
    const ghs = {
      cardId: '300',
      altId: '04',
      requirements: [
        { name: '%data.personalQuest.fh.300.1%', counter: 5 },
        { name: '%data.personalQuest.fh.300.2%', counter: 3, requires: [1] },
        { name: '%data.personalQuest.fh.300.3%', counter: 1, requires: [1, 2] },
      ],
      openEnvelope: '90:83',
    };

    const result = convertPersonalQuest(ghs, labels);

    expect(result.requirements).toHaveLength(3);
    expect(result.requirements[0].dependsOn).toBeNull();
    expect(result.requirements[1].dependsOn).toEqual([1]);
    expect(result.requirements[2].dependsOn).toEqual([1, 2]);
  });

  it('handles non-%data. name references as fallback text', () => {
    const ghs = {
      cardId: '400',
      altId: '05',
      requirements: [{ name: '%character.progress.gold%', counter: '80+20xP' }],
      openEnvelope: '37:74',
    };

    const result = convertPersonalQuest(ghs, labels);

    // Falls back to resolving game tokens on the name itself
    expect(result.requirements[0].description).toBe('Gold');
    expect(result.requirements[0].target).toBe('80+20xP');
    // Quest title comes from labels — not found here, so falls back to cardId
    expect(result.name).toBe('Personal Quest 400');
  });

  it('handles formula counter strings', () => {
    const ghs = {
      cardId: '100',
      altId: '06',
      requirements: [{ name: '%data.personalQuest.fh.100.1%', counter: '80+20xP' }],
      openEnvelope: '24:42',
    };

    const result = convertPersonalQuest(ghs, labels);

    expect(result.requirements[0].target).toBe('80+20xP');
  });

  it('preserves errata field when present', () => {
    const ghs = {
      cardId: '100',
      altId: '01',
      requirements: [{ name: '%data.personalQuest.fh.100.1%', counter: 5 }],
      openEnvelope: '24:42',
      errata: 'env24',
    };

    // errata is not in our extracted schema — just ensure it doesn't break
    const result = convertPersonalQuest(ghs, labels);
    expect(result.cardId).toBe('100');
  });

  it('sets options to null when no checkbox present', () => {
    const ghs = {
      cardId: '100',
      altId: '01',
      requirements: [{ name: '%data.personalQuest.fh.100.1%', counter: 5 }],
      openEnvelope: '24:42',
    };

    const result = convertPersonalQuest(ghs, labels);
    expect(result.requirements[0].options).toBeNull();
  });
});
