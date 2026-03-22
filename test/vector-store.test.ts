import { describe, it, expect } from 'vitest';
import { cosineSimilarity, search } from '../src/vector-store.ts';
import type { IndexEntry } from '../src/vector-store.ts';

describe('cosineSimilarity', () => {
  it('returns 1 for identical normalized vectors', () => {
    const v = [1 / Math.sqrt(2), 1 / Math.sqrt(2)];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('returns -1 for opposite normalized vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
  });

  it('handles higher dimensional vectors', () => {
    const a = [0.5, 0.5, 0.5, 0.5];
    expect(cosineSimilarity(a, a)).toBeCloseTo(1);
  });
});

describe('search', () => {
  const entries: IndexEntry[] = [
    { id: 'a', text: 'first', embedding: [1, 0, 0], source: 'test', chunkIndex: 0 },
    { id: 'b', text: 'second', embedding: [0, 1, 0], source: 'test', chunkIndex: 1 },
    { id: 'c', text: 'third', embedding: [0, 0, 1], source: 'test', chunkIndex: 2 },
    { id: 'd', text: 'mixed', embedding: [0.577, 0.577, 0.577], source: 'test', chunkIndex: 3 },
  ];

  it('returns top-k results sorted by similarity', () => {
    const results = search(entries, [1, 0, 0], 2);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('a');
    expect(results[0].score).toBeCloseTo(1);
  });

  it('defaults to k=8', () => {
    const results = search(entries, [1, 0, 0]);
    expect(results).toHaveLength(4); // only 4 entries exist
  });

  it('returns results in descending score order', () => {
    const results = search(entries, [0.707, 0.707, 0]);
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    expect(results[1].score).toBeGreaterThanOrEqual(results[2].score);
  });

  it('returns empty array for empty index', () => {
    expect(search([], [1, 0, 0], 3)).toEqual([]);
  });

  it('preserves original entry fields in results', () => {
    const results = search(entries, [1, 0, 0], 1);
    expect(results[0]).toHaveProperty('text', 'first');
    expect(results[0]).toHaveProperty('score');
  });
});
