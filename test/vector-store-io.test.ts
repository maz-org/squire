import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadIndex, saveIndex, addEntries } from '../src/vector-store.ts';
import type { IndexEntry } from '../src/vector-store.ts';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);

beforeEach(() => {
  vi.clearAllMocks();
});

const entry: IndexEntry = {
  id: 'test::0',
  text: 'hello',
  embedding: [1, 0],
  source: 'test.pdf',
  chunkIndex: 0,
};

describe('loadIndex', () => {
  it('returns empty array when index file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(loadIndex()).toEqual([]);
  });

  it('returns parsed entries when index file exists', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify([entry]));
    const result = loadIndex();
    expect(result).toEqual([entry]);
  });
});

describe('saveIndex', () => {
  it('writes entries as JSON', () => {
    saveIndex([entry]);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const [, data, encoding] = mockWriteFileSync.mock.calls[0];
    expect(JSON.parse(data as string)).toEqual([entry]);
    expect(encoding).toBe('utf-8');
  });
});

describe('addEntries', () => {
  it('merges existing and new entries and saves', () => {
    const entry2: IndexEntry = { ...entry, id: 'test::1', chunkIndex: 1 };
    const result = addEntries([entry], [entry2]);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('test::0');
    expect(result[1].id).toBe('test::1');
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
  });
});
