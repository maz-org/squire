/**
 * Frosthaven item lookup from worldhaven JSON data.
 * Extracts item number from image filename (e.g. fh-099-major-healing-potion.png → 099).
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ITEMS_PATH = join(__dirname, '..', 'data', 'worldhaven', 'data', 'items.js');

interface RawItem {
  name: string;
  image: string;
  expansion: string;
  xws: string;
}

export interface ItemEntry {
  name: string;
  number: string | null;
  xws: string;
  image: string;
}

let _items: ItemEntry[] | null = null;

function loadItems(): ItemEntry[] {
  if (_items) return _items;

  const raw: RawItem[] = JSON.parse(readFileSync(ITEMS_PATH, 'utf-8'));

  // Group by xws, then pick the best name (prefer real name over "item N" aliases)
  const byXws = new Map<string, RawItem>();

  for (const entry of raw) {
    if (!entry.name || !entry.image || entry.expansion !== 'frosthaven') continue;
    // Skip back-of-card images
    if (entry.image.endsWith('-back.png')) continue;

    const existing = byXws.get(entry.xws);
    if (!existing) {
      byXws.set(entry.xws, entry);
    } else {
      // Prefer the entry whose name isn't just "item N" or "item #N"
      const isAlias = /^item\s*#?\d+$/i.test(entry.name);
      const existingIsAlias = /^item\s*#?\d+$/i.test(existing.name);
      if (existingIsAlias && !isAlias) {
        byXws.set(entry.xws, entry);
      }
    }
  }

  _items = [];
  for (const entry of byXws.values()) {
    const match = entry.image.match(/fh-(\d+)-/);
    const itemNumber = match ? match[1] : null;
    _items.push({ name: entry.name, number: itemNumber, xws: entry.xws, image: entry.image });
  }

  return _items;
}

/**
 * Search items by name (case-insensitive substring match).
 * Returns up to `limit` results sorted by match quality.
 */
export function searchItems(query: string, limit = 5): ItemEntry[] {
  const items = loadItems();
  const q = query.toLowerCase();

  const results = items
    .filter((item) => {
      const name = item.name.toLowerCase();
      // Match if query contains the item name, or item name contains the query
      return q.includes(name) || name.includes(q);
    })
    .sort((a, b) => {
      // Prefer longer (more specific) item names
      return b.name.length - a.name.length;
    });

  return results.slice(0, limit);
}

/**
 * Format item results as a readable string for LLM context.
 */
export function formatItems(items: ItemEntry[]): string {
  if (items.length === 0) return '';
  return items.map((i) => `Item #${i.number ?? '?'}: ${i.name}`).join('\n');
}
