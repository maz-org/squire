import { describe, it, expect } from 'vitest';
import { searchExtracted, formatExtracted } from '../src/extracted-data.js';

describe('searchExtracted', () => {
  it('finds monster stats by monster name', () => {
    const results = searchExtracted('algox archer stats');
    expect(results.some((r) => r._type === 'monster-stats')).toBe(true);
  });

  it('finds battle goals by name', () => {
    const results = searchExtracted('assassin battle goal');
    expect(results.some((r) => r._type === 'battle-goals')).toBe(true);
  });

  it('respects the k limit', () => {
    const results = searchExtracted('attack move', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('returns empty for stopword-only queries', () => {
    const results = searchExtracted('the and for');
    expect(results).toEqual([]);
  });

  it('returns empty for empty query', () => {
    const results = searchExtracted('');
    expect(results).toEqual([]);
  });

  it('filters short tokens (< 3 chars)', () => {
    // "at" is only 2 chars, should be filtered out
    const results = searchExtracted('at');
    expect(results).toEqual([]);
  });
});

describe('formatExtracted', () => {
  it('returns empty string for empty array', () => {
    expect(formatExtracted([])).toBe('');
  });

  it('formats monster stats with name and levels', () => {
    const record = {
      _type: 'monster-stats',
      name: 'Ooze',
      levelRange: '0-3',
      normal: { '0': { hp: 5, move: 1, attack: 2, range: null } },
      elite: { '0': { hp: 8, move: 2, attack: 3, range: null } },
      immunities: ['poison'],
      notes: null,
    };
    const text = formatExtracted([record]);
    expect(text).toContain('Monster: Ooze');
    expect(text).toContain('Level 0');
    expect(text).toContain('HP 5');
  });

  it('formats battle goals with condition', () => {
    const record = {
      _type: 'battle-goals',
      name: 'Assassin',
      condition: 'Kill an enemy before its first turn.',
      checkmarks: 2,
    };
    const text = formatExtracted([record]);
    expect(text).toContain('Battle Goal');
    expect(text).toContain('Assassin');
    expect(text).toContain('Kill an enemy');
    expect(text).toContain('Checkmarks: 2');
  });

  it('formats items with slot and cost', () => {
    const record = {
      _type: 'items',
      number: '099',
      name: 'Major Healing Potion',
      slot: 'small item',
      cost: 20,
      effect: 'Heal 4',
      uses: 1,
      spent: false,
      lost: true,
    };
    const text = formatExtracted([record]);
    expect(text).toContain('Item #099');
    expect(text).toContain('Major Healing Potion');
    expect(text).toContain('20g');
    expect(text).toContain('Heal 4');
    expect(text).toContain('[lost]');
  });

  it('formats character abilities with top and bottom actions', () => {
    const record = {
      _type: 'character-abilities',
      cardName: 'Nimble Knife',
      characterClass: 'Drifter',
      level: 1,
      initiative: 23,
      top: { action: 'Attack 3', effects: ['Pierce 1'] },
      bottom: { action: 'Move 4', effects: [] },
      lost: false,
    };
    const text = formatExtracted([record]);
    expect(text).toContain('Drifter');
    expect(text).toContain('Nimble Knife');
    expect(text).toContain('Attack 3');
    expect(text).toContain('Move 4');
  });

  it('formats events with options', () => {
    const record = {
      _type: 'events',
      eventType: 'road',
      season: 'winter',
      number: '05',
      flavorText: 'A storm approaches.',
      optionA: { text: 'Take shelter', outcome: 'Gain 5 gold' },
      optionB: { text: 'Push through', outcome: 'Lose 2 HP' },
    };
    const text = formatExtracted([record]);
    expect(text).toContain('winter');
    expect(text).toContain('road event #05');
    expect(text).toContain('A storm approaches');
    expect(text).toContain('Take shelter');
    expect(text).toContain('Push through');
  });

  it('formats buildings with cost and effect', () => {
    const record = {
      _type: 'buildings',
      buildingNumber: '05',
      name: 'Mining Camp',
      level: 1,
      buildCost: { gold: 20, lumber: 5, metal: null, hide: null },
      effect: 'Gain 2 metal each week',
      notes: null,
    };
    const text = formatExtracted([record]);
    expect(text).toContain('Mining Camp');
    expect(text).toContain('20 gold');
    expect(text).toContain('5 lumber');
    expect(text).toContain('Gain 2 metal');
  });

  it('formats monster abilities with initiative', () => {
    const record = {
      _type: 'monster-abilities',
      monsterType: 'Algox Archer',
      cardName: 'Aimed Shot',
      initiative: 45,
      abilities: ['Attack +2', 'Range +1'],
    };
    const text = formatExtracted([record]);
    expect(text).toContain('Algox Archer');
    expect(text).toContain('Aimed Shot');
    expect(text).toContain('initiative 45');
    expect(text).toContain('Attack +2');
  });
});
