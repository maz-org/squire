import { describe, it, expect } from 'vitest';
import { searchItems, formatItems } from '../src/item-lookup.js';

describe('searchItems', () => {
  it('finds an item by exact name', () => {
    const results = searchItems('major healing potion', 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('major healing potion');
    expect(results[0].number).toBe('099');
  });

  it('finds items when query contains the item name', () => {
    const results = searchItems('what is the healing potion?', 5);
    expect(results.some((r) => r.name === 'healing potion')).toBe(true);
  });

  it('finds items when item name contains the query', () => {
    const results = searchItems('spyglass', 5);
    expect(results.some((r) => r.name === 'spyglass')).toBe(true);
    expect(results[0].number).toBe('001');
  });

  it('is case-insensitive', () => {
    const results = searchItems('MAJOR HEALING POTION', 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('major healing potion');
  });

  it('respects the limit parameter', () => {
    const results = searchItems('boots', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('returns empty array for nonsense queries', () => {
    const results = searchItems('zzzzxyzzy', 5);
    expect(results).toEqual([]);
  });

  it('prefers longer (more specific) item names', () => {
    const results = searchItems('healing potion', 5);
    const names = results.map((r) => r.name);
    // "major healing potion" is longer than "healing potion"
    if (names.includes('major healing potion') && names.includes('healing potion')) {
      expect(names.indexOf('major healing potion')).toBeLessThan(names.indexOf('healing potion'));
    }
  });
});

describe('formatItems', () => {
  it('formats items with number and name', () => {
    const items = [
      { name: 'healing potion', number: '083', xws: 'healingpotion' },
      { name: 'spyglass', number: '001', xws: 'spyglass' },
    ];
    const result = formatItems(items);
    expect(result).toBe('Item #083: healing potion\nItem #001: spyglass');
  });

  it('returns empty string for empty array', () => {
    expect(formatItems([])).toBe('');
  });

  it('handles items with null number', () => {
    const result = formatItems([{ name: 'mystery', number: null, xws: 'mystery' }]);
    expect(result).toBe('Item #?: mystery');
  });
});
