import { describe, it, expect } from 'vitest';
import { convertBuilding, type GhsBuilding } from '../src/import-buildings.ts';

// ─── convertBuilding ────────────────────────────────────────────────────────

describe('convertBuilding', () => {
  const labels = {
    buildings: {
      'mining-camp': {
        '': 'Mining Camp',
        '1': 'Collectively buy up to 1 %game.resource.metal% for 2 gold',
        '2': 'Collectively buy up to 2 %game.resource.metal% for 2 gold each',
        '3': 'Collectively buy up to 3 %game.resource.metal% for 2 gold each',
        '4': 'Collectively buy up to 4 %game.resource.metal% for 2 gold each',
      },
    },
  };

  const miningCamp: GhsBuilding = {
    id: '05',
    name: 'mining-camp',
    costs: { prosperity: 1, lumber: 4, metal: 2, hide: 1, gold: 10 },
    upgrades: [
      { prosperity: 3, lumber: 6, metal: 3, hide: 2 },
      { prosperity: 5, lumber: 8, metal: 5, hide: 2 },
      { prosperity: 7, lumber: 10, metal: 6, hide: 3 },
    ],
    repair: [2, 3, 3, 4],
    rebuild: [
      { lumber: 1, metal: 2, hide: 0 },
      { lumber: 1, metal: 2, hide: 1 },
      { lumber: 2, metal: 2, hide: 1 },
      { lumber: 2, metal: 2, hide: 1 },
    ],
    effectNormal: [
      '%data.buildings.mining-camp.1%',
      '%data.buildings.mining-camp.2%',
      '%data.buildings.mining-camp.3%',
      '%data.buildings.mining-camp.4%',
    ],
    rewards: [
      { prosperity: 1 },
      { prosperity: 1, section: '49.2' },
      { prosperity: 1 },
      { prosperity: 1, loseMorale: 1 },
    ],
  };

  it('produces one record per level from effectNormal', () => {
    const results = convertBuilding(miningCamp, labels);
    expect(results).toHaveLength(4);
  });

  it('sets building number and name correctly', () => {
    const results = convertBuilding(miningCamp, labels);
    expect(results[0].buildingNumber).toBe('05');
    expect(results[0].name).toBe('Mining Camp');
  });

  it('assigns sequential levels starting at 1', () => {
    const results = convertBuilding(miningCamp, labels);
    expect(results.map((r) => r.level)).toEqual([1, 2, 3, 4]);
  });

  it('uses initial costs for level 1', () => {
    const results = convertBuilding(miningCamp, labels);
    expect(results[0].buildCost).toEqual({
      prosperity: 1,
      gold: 10,
      lumber: 4,
      metal: 2,
      hide: 1,
    });
  });

  it('uses upgrade costs for levels 2+', () => {
    const results = convertBuilding(miningCamp, labels);
    expect(results[1].buildCost).toEqual({
      prosperity: 3,
      gold: 0,
      lumber: 6,
      metal: 3,
      hide: 2,
    });
  });

  it('resolves label references and game tokens in effect text', () => {
    const results = convertBuilding(miningCamp, labels);
    expect(results[0].effect).toBe('Collectively buy up to 1 Metal for 2 gold');
    expect(results[2].effect).toBe('Collectively buy up to 3 Metal for 2 gold each');
  });

  it('sets notes to null for normal buildings', () => {
    const results = convertBuilding(miningCamp, labels);
    for (const r of results) {
      expect(r.notes).toBeNull();
    }
  });

  it('includes sourceId provenance field', () => {
    const results = convertBuilding(miningCamp, labels);
    // sourceId includes the level suffix to distinguish each level row.
    expect(results[0].sourceId).toBe('gloomhavensecretariat:building/05/L1');
  });

  it('handles walls (no `id` in GHS) with null buildingNumber and name-based sourceId', () => {
    // Walls in GHS genuinely have no `id` field — only a `name` like "wall-j".
    // The importer should keep `buildingNumber` null (not "undefined") and
    // fall back to `name` for sourceId so each wall is uniquely identified.
    const wallJ: GhsBuilding = {
      // `id` deliberately omitted to mirror the real GHS shape
      name: 'wall-j',
      costs: { prosperity: 1, lumber: 4, metal: 0, hide: 0, gold: 10 },
      upgrades: [],
      repair: [],
      rebuild: [],
      effectNormal: ['+5 Defense'],
      rewards: [{ defense: 5 }],
    };

    const results = convertBuilding(wallJ, labels);

    expect(results).toHaveLength(1);
    expect(results[0].buildingNumber).toBeNull();
    expect(results[0].sourceId).toBe('gloomhavensecretariat:building/wall-j/L1');
  });

  it('normalizes missing cost fields to zero', () => {
    const results = convertBuilding(miningCamp, labels);
    // Upgrade costs in GHS omit gold when it is not required.
    expect(results[1].buildCost.gold).toBe(0);
  });

  it('handles already-built buildings with explicit zero level 1 build costs', () => {
    const wreckedLabels = {
      buildings: {
        craftsman: {
          '': 'Craftsman',
          '1': 'Lose 1 collective %game.resource.hide%',
          '4': 'Craft items',
        },
      },
    };

    const craftsman: GhsBuilding = {
      id: '34',
      name: 'craftsman',
      costs: { prosperity: 0, lumber: 0, metal: 0, hide: 0, gold: 0 },
      upgrades: [
        { prosperity: 1, lumber: 2, metal: 2, hide: 1 },
        { prosperity: 2, lumber: 3, metal: 2, hide: 2 },
      ],
      repair: [2, 2, 3],
      rebuild: [
        { lumber: 1, metal: 1, hide: 0 },
        { lumber: 1, metal: 1, hide: 1 },
        { lumber: 3, metal: 1, hide: 1 },
      ],
      effectWrecked: [
        '%data.buildings.craftsman.1%',
        '%data.buildings.craftsman.1%',
        '%data.buildings.craftsman.1%',
      ],
      rewards: [{}, { prosperity: 1 }, { prosperity: 1 }],
    };

    const results = convertBuilding(craftsman, wreckedLabels);
    // effectWrecked has 3 levels
    expect(results).toHaveLength(3);
    // Level numbering still starts at 1
    expect(results[0].level).toBe(1);
    // Effect text is resolved
    expect(results[0].effect).toBe('Lose 1 collective Hide');
    expect(results[0].buildCost).toEqual({
      prosperity: 0,
      gold: 0,
      lumber: 0,
      metal: 0,
      hide: 0,
    });
    expect(results[1].buildCost).toEqual({
      prosperity: 1,
      gold: 0,
      lumber: 2,
      metal: 2,
      hide: 1,
    });
  });

  it('handles buildings with no effect arrays (zero levels)', () => {
    const boatLabels = {
      buildings: {
        boat: { '': 'Boat' },
      },
    };

    const boat: GhsBuilding = {
      id: '99',
      name: 'boat',
      costs: { prosperity: 0, lumber: 0, metal: 0, hide: 0, gold: 0 },
      upgrades: [],
      repair: [],
      rebuild: [],
      rewards: [],
    };

    const results = convertBuilding(boat, boatLabels);
    expect(results).toHaveLength(0);
  });

  it('resolves %data.section:X.Y% tokens to readable text', () => {
    const sectionLabels = {
      buildings: {
        'town-hall': {
          '': 'Town Hall',
          '1': 'When complete, read %data.section:190.1%',
        },
      },
    };

    const townHall: GhsBuilding = {
      id: '80',
      name: 'town-hall',
      costs: { prosperity: 0, lumber: 0, metal: 0, hide: 0, gold: 0 },
      upgrades: [],
      repair: [2],
      rebuild: [{ lumber: 1, metal: 1, hide: 0 }],
      effectNormal: ['%data.buildings.town-hall.1%'],
      rewards: [{}],
    };

    const results = convertBuilding(townHall, sectionLabels);
    expect(results[0].effect).toBe('When complete, read Section 190.1');
  });

  it('strips HTML tags from effect text', () => {
    const htmlLabels = {
      buildings: {
        barracks: {
          '': 'Barracks',
          '1': 'Train soldiers<br><br><i>Capacity:</i> 4',
        },
      },
    };

    const barracks: GhsBuilding = {
      id: '60',
      name: 'barracks',
      costs: { prosperity: 1, lumber: 4, metal: 2, hide: 1, gold: 10 },
      upgrades: [],
      repair: [2],
      rebuild: [{ lumber: 1, metal: 1, hide: 0 }],
      effectNormal: ['%data.buildings.barracks.1%'],
      rewards: [{}],
    };

    const results = convertBuilding(barracks, htmlLabels);
    expect(results[0].effect).toBe('Train soldiers Capacity: 4');
  });

  it('preserves known zero costs', () => {
    const zeroLabels = {
      buildings: {
        free: {
          '': 'Free Building',
          '1': 'Some effect',
        },
      },
    };

    const free: GhsBuilding = {
      id: '50',
      name: 'free',
      costs: { prosperity: 0, lumber: 0, metal: 0, hide: 0, gold: 0 },
      upgrades: [],
      repair: [2],
      rebuild: [{ lumber: 0, metal: 0, hide: 0 }],
      effectNormal: ['%data.buildings.free.1%'],
      rewards: [{}],
    };

    const results = convertBuilding(free, zeroLabels);
    expect(results[0].buildCost).toEqual({
      prosperity: 0,
      gold: 0,
      lumber: 0,
      metal: 0,
      hide: 0,
    });
  });

  it('keeps manual upgrade costs unknown', () => {
    const barracksLabels = {
      buildings: {
        barracks: {
          '': 'Barracks',
          '1': 'Train soldiers',
          '2': 'Train more soldiers',
        },
      },
    };

    const barracks: GhsBuilding = {
      id: '98',
      name: 'barracks',
      costs: { prosperity: 0, lumber: 0, metal: 0, hide: 0, gold: 0 },
      upgrades: [{ prosperity: 0, lumber: 0, metal: 0, hide: 0, manual: 1 }],
      repair: [2],
      rebuild: [{ lumber: 0, metal: 0, hide: 0 }],
      effectNormal: ['%data.buildings.barracks.1%', '%data.buildings.barracks.2%'],
      rewards: [{}, {}],
    };

    const results = convertBuilding(barracks, barracksLabels);
    expect(results[0].buildCost).toEqual({
      prosperity: 0,
      gold: 0,
      lumber: 0,
      metal: 0,
      hide: 0,
    });
    expect(results[1].buildCost).toEqual({
      prosperity: null,
      gold: null,
      lumber: null,
      metal: null,
      hide: null,
    });
  });
});
