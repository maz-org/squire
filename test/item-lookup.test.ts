import { describe, it, expect, vi } from 'vitest';

const { FAKE_ITEMS } = vi.hoisted(() => ({
  FAKE_ITEMS: JSON.stringify([
    {
      name: 'spyglass',
      image: 'items/frosthaven/fh-001-spyglass.png',
      expansion: 'frosthaven',
      xws: 'spyglass',
    },
    {
      name: 'healing potion',
      image: 'items/frosthaven/fh-083-healing-potion.png',
      expansion: 'frosthaven',
      xws: 'healingpotion',
    },
    {
      name: 'major healing potion',
      image: 'items/frosthaven/fh-099-major-healing-potion.png',
      expansion: 'frosthaven',
      xws: 'majorhealingpotion',
    },
    {
      name: 'item 099',
      image: 'items/frosthaven/fh-099-major-healing-potion.png',
      expansion: 'frosthaven',
      xws: 'majorhealingpotion',
    },
    {
      name: 'winged boots',
      image: 'items/frosthaven/fh-050-winged-boots.png',
      expansion: 'frosthaven',
      xws: 'wingedboots',
    },
    {
      name: 'sturdy boots',
      image: 'items/frosthaven/fh-051-sturdy-boots.png',
      expansion: 'frosthaven',
      xws: 'sturdyboots',
    },
    {
      name: 'other game item',
      image: 'items/other/other.png',
      expansion: 'gloomhaven',
      xws: 'othergameitem',
    },
  ]),
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn().mockReturnValue(FAKE_ITEMS),
}));

import { searchItems, formatItems } from '../src/item-lookup.ts';
import type { ItemEntry } from '../src/item-lookup.ts';

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
    const results = searchItems('boots', 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('returns empty array for nonsense queries', () => {
    const results = searchItems('zzzzxyzzy', 5);
    expect(results).toEqual([]);
  });

  it('prefers longer (more specific) item names', () => {
    const results = searchItems('healing potion', 5);
    const names = results.map((r) => r.name);
    if (names.includes('major healing potion') && names.includes('healing potion')) {
      expect(names.indexOf('major healing potion')).toBeLessThan(names.indexOf('healing potion'));
    }
  });

  it('filters out non-frosthaven items', () => {
    const results = searchItems('other game item', 5);
    expect(results).toEqual([]);
  });

  it('deduplicates by xws, preferring real names over aliases', () => {
    const results = searchItems('099', 5);
    const names = results.map((r) => r.name);
    expect(names).not.toContain('item 099');
  });
});

describe('formatItems', () => {
  it('formats items with number and name', () => {
    const items: ItemEntry[] = [
      { name: 'healing potion', number: '083', xws: 'healingpotion', image: 'test.png' },
      { name: 'spyglass', number: '001', xws: 'spyglass', image: 'test.png' },
    ];
    const result = formatItems(items);
    expect(result).toBe('Item #083: healing potion\nItem #001: spyglass');
  });

  it('returns empty string for empty array', () => {
    expect(formatItems([])).toBe('');
  });

  it('handles items with null number', () => {
    const result = formatItems([
      { name: 'mystery', number: null, xws: 'mystery', image: 'test.png' },
    ]);
    expect(result).toBe('Item #?: mystery');
  });
});
