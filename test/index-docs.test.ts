import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('dotenv/config', () => ({}));

const { mockReaddirSync, mockReadFileSync } = vi.hoisted(() => ({
  mockReaddirSync: vi.fn(),
  mockReadFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  readFileSync: mockReadFileSync,
  readdirSync: mockReaddirSync,
}));

const { mockPdfParse } = vi.hoisted(() => ({
  mockPdfParse: vi.fn(),
}));

vi.mock('pdf-parse/lib/pdf-parse.js', () => ({
  default: mockPdfParse,
}));

const { mockEmbedBatch } = vi.hoisted(() => ({
  mockEmbedBatch: vi.fn(),
}));

vi.mock('../src/embedder.ts', () => ({
  embedBatch: mockEmbedBatch,
}));

const { mockLoadIndex, mockAddEntries } = vi.hoisted(() => ({
  mockLoadIndex: vi.fn(),
  mockAddEntries: vi.fn(),
}));

vi.mock('../src/vector-store.ts', () => ({
  loadIndex: mockLoadIndex,
  addEntries: mockAddEntries,
}));

import { chunkText, main } from '../src/index-docs.ts';

describe('chunkText', () => {
  it('creates chunks from text longer than chunk size', () => {
    const text = 'A'.repeat(1000);
    const chunks = chunkText(text, 'test.pdf');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].source).toBe('test.pdf');
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[1].chunkIndex).toBe(1);
  });

  it('creates a single chunk for short text', () => {
    const text = 'A'.repeat(100);
    const chunks = chunkText(text, 'test.pdf');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(text);
  });

  it('skips chunks shorter than 50 characters', () => {
    const text = 'A'.repeat(30);
    const chunks = chunkText(text, 'test.pdf');
    expect(chunks).toHaveLength(0);
  });

  it('chunks overlap by 150 characters', () => {
    const text = 'A'.repeat(1600);
    const chunks = chunkText(text, 'test.pdf');
    // Chunk 0 ends at 800, chunk 1 starts at 650 (800 - 150)
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Each chunk should be at most 800 chars
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(800);
    }
  });
});

describe('main', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips files already in the index', async () => {
    mockReaddirSync.mockReturnValue(['rulebook.pdf']);
    mockLoadIndex.mockReturnValue([
      {
        id: 'rulebook.pdf::0',
        text: 'text',
        embedding: [0.1],
        source: 'rulebook.pdf',
        chunkIndex: 0,
      },
    ]);

    await main();

    expect(mockPdfParse).not.toHaveBeenCalled();
    expect(mockEmbedBatch).not.toHaveBeenCalled();
    expect(mockAddEntries).not.toHaveBeenCalled();
  });

  it('processes new PDF files', async () => {
    const longText = 'A'.repeat(900);
    mockReaddirSync.mockReturnValue(['newfile.pdf']);
    mockReadFileSync.mockReturnValue(Buffer.from('pdf'));
    mockPdfParse.mockResolvedValue({ text: longText });
    mockLoadIndex.mockReturnValue([]);
    mockEmbedBatch.mockResolvedValue([[0.1, 0.2]]);
    mockAddEntries.mockReturnValue([]);

    await main();

    expect(mockPdfParse).toHaveBeenCalledOnce();
    expect(mockEmbedBatch).toHaveBeenCalled();
    expect(mockAddEntries).toHaveBeenCalledOnce();

    const newEntries = mockAddEntries.mock.calls[0][1];
    expect(newEntries.length).toBeGreaterThan(0);
    expect(newEntries[0].source).toBe('newfile.pdf');
    expect(newEntries[0].embedding).toEqual([0.1, 0.2]);
  });

  it('logs nothing new for empty docs directory', async () => {
    mockReaddirSync.mockReturnValue([]);
    mockLoadIndex.mockReturnValue([]);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await main();

    expect(consoleSpy).toHaveBeenCalledWith('Nothing new to index.');
    expect(mockAddEntries).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
