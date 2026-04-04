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

import {
  chunkText,
  splitIntoParagraphs,
  splitLongParagraph,
  mergeParagraphsIntoChunks,
  detectHeading,
  extractHeading,
  main,
} from '../src/index-docs.ts';

describe('splitIntoParagraphs', () => {
  it('splits on double newlines', () => {
    const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    const result = splitIntoParagraphs(text);
    expect(result).toEqual(['First paragraph.', 'Second paragraph.', 'Third paragraph.']);
  });

  it('splits on multiple newlines with whitespace', () => {
    const text = 'First.\n\n\n  \n\nSecond.';
    const result = splitIntoParagraphs(text);
    expect(result).toEqual(['First.', 'Second.']);
  });

  it('trims leading and trailing whitespace from paragraphs', () => {
    const text = '  First.  \n\n  Second.  ';
    const result = splitIntoParagraphs(text);
    expect(result).toEqual(['First.', 'Second.']);
  });

  it('filters out empty paragraphs', () => {
    const text = '\n\n\n\nOnly one.\n\n\n';
    const result = splitIntoParagraphs(text);
    expect(result).toEqual(['Only one.']);
  });

  it('returns single paragraph when no double newlines', () => {
    const text = 'One line\nAnother line\nThird line';
    const result = splitIntoParagraphs(text);
    expect(result).toEqual(['One line\nAnother line\nThird line']);
  });
});

describe('splitLongParagraph', () => {
  it('returns paragraph as-is when under max size', () => {
    const text = 'Short paragraph.';
    const result = splitLongParagraph(text, 1600);
    expect(result).toEqual(['Short paragraph.']);
  });

  it('splits at sentence boundaries when over max size', () => {
    const s1 = 'A'.repeat(800) + '.';
    const s2 = 'B'.repeat(800) + '.';
    const text = `${s1} ${s2}`;
    const result = splitLongParagraph(text, 1600);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(s1);
    expect(result[1]).toBe(s2);
  });

  it('falls back to word boundary when no sentence break fits', () => {
    // One long "sentence" with no periods
    const words = Array(200).fill('word').join(' ');
    const result = splitLongParagraph(words, 200);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(200);
    }
    // Reconstruct should preserve all content
    expect(result.join(' ')).toBe(words);
  });

  it('handles text with no spaces by splitting at max boundary', () => {
    const text = 'A'.repeat(3000);
    const result = splitLongParagraph(text, 1600);
    expect(result.length).toBe(2);
    expect(result[0].length).toBe(1600);
    expect(result[1].length).toBe(1400);
  });
});

describe('mergeParagraphsIntoChunks', () => {
  it('merges small paragraphs into a single chunk', () => {
    const paragraphs = [
      'Short paragraph one here.',
      'Another short paragraph here.',
      'Third paragraph with more text here.',
    ];
    const result = mergeParagraphsIntoChunks(paragraphs, 1200);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(
      'Short paragraph one here.\n\nAnother short paragraph here.\n\nThird paragraph with more text here.',
    );
  });

  it('flushes buffer when adding next paragraph would exceed target', () => {
    const p1 = 'A'.repeat(500);
    const p2 = 'B'.repeat(500);
    const p3 = 'C'.repeat(500);
    // p1 + \n\n + p2 = 1002, under 1200. Adding p3 would be 1504, over 1200.
    const result = mergeParagraphsIntoChunks([p1, p2, p3], 1200);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(`${p1}\n\n${p2}`);
    expect(result[1]).toBe(p3);
  });

  it('handles a single oversized paragraph by keeping it as one chunk', () => {
    const big = 'A'.repeat(2000);
    const result = mergeParagraphsIntoChunks([big], 1200);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(big);
  });

  it('filters out chunks shorter than MIN_CHUNK_CHARS', () => {
    const paragraphs = ['Hi', 'A'.repeat(200)];
    const result = mergeParagraphsIntoChunks(paragraphs, 1200);
    // 'Hi' is only 2 chars but gets merged with next paragraph
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('Hi');
  });
});

describe('detectHeading', () => {
  it('detects all-uppercase single-line text as heading', () => {
    expect(detectHeading('NEGATIVE CONDITIONS')).toBe(true);
  });

  it('detects short title-case single-line text as heading', () => {
    expect(detectHeading('Scenario Setup')).toBe(true);
  });

  it('rejects multi-line text', () => {
    expect(detectHeading('Line one\nLine two')).toBe(false);
  });

  it('rejects long text even if uppercase', () => {
    expect(detectHeading('A'.repeat(100))).toBe(false);
  });

  it('rejects paragraph-like text', () => {
    expect(detectHeading('The figure suffers 1 damage at the start of each turn.')).toBe(false);
  });

  it('detects numbered headings', () => {
    expect(detectHeading('29')).toBe(true);
  });
});

describe('extractHeading', () => {
  it('extracts heading from start of paragraph with page number', () => {
    const text = '29\nNEGATIVE CONDITIONS\nWound: The figure suffers damage.';
    const [heading, body] = extractHeading(text);
    expect(heading).toBe('NEGATIVE CONDITIONS');
    expect(body).toBe('Wound: The figure suffers damage.');
  });

  it('returns null heading when no heading present', () => {
    const text = 'The figure suffers 1 damage at the start of each turn.';
    const [heading, body] = extractHeading(text);
    expect(heading).toBeNull();
    expect(body).toBe(text);
  });

  it('extracts standalone heading', () => {
    const text = 'SCENARIO SETUP\nPlace the tiles as shown.';
    const [heading, body] = extractHeading(text);
    expect(heading).toBe('SCENARIO SETUP');
    expect(body).toBe('Place the tiles as shown.');
  });
});

describe('chunkText', () => {
  it('creates chunks from text with paragraph boundaries', () => {
    const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    const chunks = chunkText(text, 'test.pdf');
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].source).toBe('test.pdf');
    expect(chunks[0].chunkIndex).toBe(0);
  });

  it('keeps related content together within target size', () => {
    const conditions = [
      'NEGATIVE CONDITIONS',
      '',
      'Wound: The figure suffers 1 damage at the start of each of their turns. Wound is removed when the figure is healed.',
      'Brittle: The next time the figure would suffer damage, they instead suffer double that amount.',
      'Poison: All attacks targeting the figure gain +1 Attack. Poison is removed when healed.',
    ].join('\n');
    // This is a single paragraph (no double-newlines within)
    const text = `Previous section content here.\n\n${conditions}\n\nNext section.`;
    const chunks = chunkText(text, 'test.pdf');
    // The conditions block should be in one chunk
    const conditionsChunk = chunks.find(
      (c) => c.text.includes('Wound:') && c.text.includes('Poison:'),
    );
    expect(conditionsChunk).toBeDefined();
  });

  it('prepends section heading context to chunks', () => {
    // Heading at start of paragraph (as pdf-parse outputs: page-num + heading + content)
    const text = '29\nNEGATIVE CONDITIONS\nWound: The figure suffers 1 damage.';
    const chunks = chunkText(text, 'test.pdf');
    const woundChunk = chunks.find((c) => c.text.includes('Wound:'));
    expect(woundChunk?.text).toContain('[NEGATIVE CONDITIONS]');
  });

  it('skips chunks shorter than 50 characters', () => {
    const text = 'A'.repeat(30);
    const chunks = chunkText(text, 'test.pdf');
    expect(chunks).toHaveLength(0);
  });

  it('assigns sequential chunkIndex values', () => {
    const text = 'A'.repeat(1500) + '\n\n' + 'B'.repeat(1500);
    const chunks = chunkText(text, 'test.pdf');
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].chunkIndex).toBe(i);
    }
  });

  it('handles empty text', () => {
    const chunks = chunkText('', 'test.pdf');
    expect(chunks).toHaveLength(0);
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
