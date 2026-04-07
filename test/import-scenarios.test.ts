import { describe, it, expect } from 'vitest';
import { convertScenario } from '../src/import-scenarios.ts';
import type { LabelData } from '../src/ghs-utils.ts';

const labels: LabelData = {
  scenario: {
    rewards: {
      fh: {
        '001': '(Gain 2+X morale, where X is the number of City Guards still on the map.)',
      },
    },
  },
};

describe('convertScenario', () => {
  it('converts a basic scenario with monsters, allies, unlocks, and loot', () => {
    const ghs = {
      index: '1',
      name: 'A Town in Flames',
      flowChartGroup: 'intro',
      edition: 'fh',
      complexity: 1,
      initial: true,
      unlocks: ['2', '3'],
      rewards: {
        custom: '%data.scenario.rewards.fh.001%',
        morale: '2+X',
      },
      monsters: ['algox-archer', 'algox-guard', 'algox-priest', 'city-guard'],
      allies: ['city-guard'],
      lootDeckConfig: {
        money: 6,
        lumber: 5,
        metal: 3,
        hide: 3,
        rockroot: 1,
        snowthistle: 2,
      },
    };

    const result = convertScenario(ghs, '001', labels);

    expect(result.index).toBe('1');
    expect(result.name).toBe('A Town in Flames');
    expect(result.complexity).toBe(1);
    expect(result.initial).toBe(true);
    expect(result.monsters).toEqual(['Algox Archer', 'Algox Guard', 'Algox Priest', 'City Guard']);
    expect(result.allies).toEqual(['City Guard']);
    expect(result.unlocks).toEqual(['2', '3']);
    expect(result.rewards).toBe(
      '(Gain 2+X morale, where X is the number of City Guards still on the map.)',
    );
    expect(result.lootDeckConfig).toEqual({
      money: 6,
      lumber: 5,
      metal: 3,
      hide: 3,
      rockroot: 1,
      snowthistle: 2,
    });
    expect(result.flowChartGroup).toBe('intro');
    expect(result.scenarioGroup).toBe('main');
    expect(result.sourceId).toBe('gloomhavensecretariat:scenario/001');
  });

  it('derives scenarioGroup=solo from solo* filename and uses filename in sourceId', () => {
    const ghs = {
      index: '20',
      name: 'Wonder of Nature',
      edition: 'fh',
      complexity: 1,
      monsters: [],
      lootDeckConfig: {},
    };

    const result = convertScenario(ghs, 'solo20_drifter', labels);

    expect(result.scenarioGroup).toBe('solo');
    // sourceId uses the filename basename, not the in-file index — this is
    // what disambiguates main scenario 20 from solo scenario 20.
    expect(result.sourceId).toBe('gloomhavensecretariat:scenario/solo20_drifter');
  });

  it('derives scenarioGroup=random from the random.json filename', () => {
    const ghs = {
      index: '1',
      name: 'Random',
      edition: 'fh',
      complexity: 1,
      monsters: [],
      lootDeckConfig: {},
    };

    const result = convertScenario(ghs, 'random', labels);

    expect(result.scenarioGroup).toBe('random');
    expect(result.sourceId).toBe('gloomhavensecretariat:scenario/random');
  });

  it('converts a scenario with requirements, objectives, and structured rewards', () => {
    const ghs = {
      index: '50',
      name: 'Explosive Descent',
      flowChartGroup: 'lurker',
      edition: 'fh',
      complexity: 2,
      eventType: 'boat',
      unlocks: ['54'],
      requirements: [{ buildings: ['boat'] }],
      rewards: {
        inspiration: -2,
        collectiveResources: [
          { type: 'lumber', value: 4 },
          { type: 'metal', value: 4 },
        ],
      },
      monsters: ['lightning-eel', 'lurker-clawcrusher', 'lurker-mindsnipper', 'lurker-wavethrower'],
      objectives: [{ name: 'Pulse Emitter', escort: true, health: '6+(3xL)' }],
      lootDeckConfig: { money: 13, lumber: 2, hide: 3, arrowvine: 2 },
    };

    const result = convertScenario(ghs, '001', labels);

    expect(result.index).toBe('50');
    expect(result.name).toBe('Explosive Descent');
    expect(result.complexity).toBe(2);
    expect(result.initial).toBe(false);
    expect(result.monsters).toEqual([
      'Lightning Eel',
      'Lurker Clawcrusher',
      'Lurker Mindsnipper',
      'Lurker Wavethrower',
    ]);
    expect(result.allies).toEqual([]);
    expect(result.requirements).toEqual([{ buildings: ['boat'] }]);
    expect(result.objectives).toEqual([{ name: 'Pulse Emitter', escort: true }]);
    expect(result.rewards).toBe('Inspiration -2, 4 lumber, 4 metal');
    expect(result.unlocks).toEqual(['54']);
  });

  it('converts a minimal scenario with no allies, objectives, or requirements', () => {
    const ghs = {
      index: '73',
      name: 'Flotsam',
      flowChartGroup: 'personal-quests',
      edition: 'fh',
      complexity: 2,
      monsters: ['lightning-eel'],
      lootDeckConfig: {
        money: 9,
        lumber: 5,
        hide: 3,
        flamefruit: 1,
        arrowvine: 2,
      },
    };

    const result = convertScenario(ghs, '001', labels);

    expect(result.index).toBe('73');
    expect(result.name).toBe('Flotsam');
    expect(result.initial).toBe(false);
    expect(result.monsters).toEqual(['Lightning Eel']);
    expect(result.allies).toEqual([]);
    expect(result.unlocks).toEqual([]);
    expect(result.requirements).toEqual([]);
    expect(result.objectives).toEqual([]);
    expect(result.rewards).toBeNull();
    expect(result.flowChartGroup).toBe('personal-quests');
  });

  it('builds reward text from structured morale and prosperity fields', () => {
    const ghs = {
      index: '4A',
      name: 'Heart of Ice A',
      flowChartGroup: 'unfettered',
      edition: 'fh',
      complexity: 2,
      monsters: ['algox-guard'],
      lootDeckConfig: { money: 5 },
      rewards: {
        prosperity: 1,
        morale: 1,
      },
    };

    const result = convertScenario(ghs, '001', labels);

    expect(result.rewards).toBe('Prosperity 1, Morale 1');
  });

  it('builds reward text from experience and gold', () => {
    const ghs = {
      index: '99',
      name: 'Test Scenario',
      flowChartGroup: 'test',
      edition: 'fh',
      complexity: 1,
      monsters: [],
      lootDeckConfig: {},
      rewards: {
        experience: 15,
        gold: 10,
      },
    };

    const result = convertScenario(ghs, '001', labels);

    expect(result.rewards).toBe('15 XP, 10 gold');
  });

  it('prefers custom label-resolved rewards over structured fields', () => {
    const ghs = {
      index: '1',
      name: 'A Town in Flames',
      flowChartGroup: 'intro',
      edition: 'fh',
      complexity: 1,
      monsters: [],
      lootDeckConfig: {},
      rewards: {
        custom: '%data.scenario.rewards.fh.001%',
        morale: '2+X',
      },
    };

    const result = convertScenario(ghs, '001', labels);

    // custom label takes priority
    expect(result.rewards).toBe(
      '(Gain 2+X morale, where X is the number of City Guards still on the map.)',
    );
  });
});
