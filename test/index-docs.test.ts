import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';

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

const {
  mockGetIndexedSourceHashes,
  mockDeleteEntriesForSources,
  mockAddEntries,
  mockReplaceEntriesForSources,
} = vi.hoisted(() => ({
  mockGetIndexedSourceHashes: vi.fn(),
  mockDeleteEntriesForSources: vi.fn(),
  mockAddEntries: vi.fn(),
  mockReplaceEntriesForSources: vi.fn(),
}));

vi.mock('../src/vector-store.ts', () => ({
  getIndexedSourceHashes: mockGetIndexedSourceHashes,
  deleteEntriesForSources: mockDeleteEntriesForSources,
  addEntries: mockAddEntries,
  replaceEntriesForSources: mockReplaceEntriesForSources,
  ensureHnswIndex: vi.fn().mockResolvedValue(undefined),
  EMBEDDING_VERSION: 'test-version',
}));

vi.mock('../src/db.ts', () => ({
  shutdownServerPool: vi.fn().mockResolvedValue(undefined),
}));

import {
  computeContentHash,
  chunkText,
  splitIntoParagraphs,
  splitLongParagraph,
  mergeParagraphsIntoChunks,
  detectHeading,
  extractHeading,
  htmlToIndexText,
  assertUsablePdfText,
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

describe('htmlToIndexText', () => {
  it('normalizes HTML source snapshots into indexable text', () => {
    const html = `
      <html>
        <head><script>ignored()</script><style>.x { color: red; }</style></head>
        <body>
          <h1>Official FAQ</h1>
          <p>Last Updated 2026-04-19</p>
          <ul><li>First ruling &amp; note.</li><li>Second ruling.</li></ul>
        </body>
      </html>
    `;

    expect(htmlToIndexText(html)).toBe(
      [
        'Official FAQ',
        'Last Updated 2026-04-19',
        '- First ruling & note.',
        '- Second ruling.',
      ].join('\n\n'),
    );
  });
});

describe('assertUsablePdfText', () => {
  it('fails loudly when a PDF has no usable text layer', () => {
    expect(() => assertUsablePdfText('gh2-rule-book.pdf', '\n\n\n')).toThrow(
      'data/rule-sources/gh2-rule-book.md',
    );
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

  it('preserves heading context across split oversized paragraphs', () => {
    // A heading followed by a very long paragraph that must be split
    const longBody = Array(50).fill('This is a sentence about game rules.').join(' ');
    const text = `SCENARIO RULES\n\n${longBody}`;
    const chunks = chunkText(text, 'test.pdf');
    // Every chunk should have the heading prefix
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[SCENARIO RULES]');
    }
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
    mockDeleteEntriesForSources.mockResolvedValue(0);
    mockAddEntries.mockResolvedValue(undefined);
    mockReplaceEntriesForSources.mockResolvedValue(0);
  });

  it('skips unchanged files already in the index', async () => {
    const pdfBytes = Buffer.from('same pdf bytes');
    mockReaddirSync.mockReturnValue(['fh-rulebook.pdf']);
    mockReadFileSync.mockReturnValue(pdfBytes);
    mockGetIndexedSourceHashes.mockImplementation((game: string) =>
      Promise.resolve(
        game === 'frosthaven'
          ? new Map([['fh-rulebook.pdf', computeContentHash(pdfBytes)]])
          : new Map<string, string | null>(),
      ),
    );

    await main();

    expect(mockPdfParse).not.toHaveBeenCalled();
    expect(mockEmbedBatch).not.toHaveBeenCalled();
    expect(mockDeleteEntriesForSources).not.toHaveBeenCalled();
    expect(mockAddEntries).not.toHaveBeenCalled();
  });

  it('processes new PDF files', async () => {
    const longText = 'A'.repeat(900);
    mockReaddirSync.mockReturnValue(['gh2-newfile.pdf']);
    mockReadFileSync.mockReturnValue(Buffer.from('pdf'));
    mockPdfParse.mockResolvedValue({ text: longText });
    mockGetIndexedSourceHashes.mockResolvedValue(new Map<string, string | null>());
    mockEmbedBatch.mockResolvedValue([[0.1, 0.2]]);

    await main();

    expect(mockPdfParse).toHaveBeenCalledOnce();
    expect(mockEmbedBatch).toHaveBeenCalled();
    expect(mockAddEntries).toHaveBeenCalledOnce();

    const newEntries = mockAddEntries.mock.calls[0][0];
    expect(newEntries.length).toBeGreaterThan(0);
    expect(newEntries[0].source).toBe('gh2-newfile.pdf');
    expect(newEntries[0].game).toBe('gloomhaven-2e');
    expect(newEntries[0].contentHash).toBe(computeContentHash(Buffer.from('pdf')));
    expect(newEntries[0].embedding).toEqual([0.1, 0.2]);
  });

  it('rejects image-only PDFs without a normalized text source', async () => {
    mockReaddirSync.mockImplementation((path) => {
      const dir = String(path);
      if (dir.endsWith('/pdfs')) return ['gh2-rule-book.pdf'];
      if (dir.endsWith('/rule-sources')) return [];
      return [];
    });
    mockReadFileSync.mockReturnValue(Buffer.from('image-only pdf bytes'));
    mockPdfParse.mockResolvedValue({ text: '\n\n\n' });
    mockGetIndexedSourceHashes.mockResolvedValue(new Map<string, string | null>());

    await expect(main()).rejects.toThrow('PDF source gh2-rule-book.pdf produced only 0');
    expect(mockAddEntries).not.toHaveBeenCalled();
  });

  it('processes GH2 HTML rule sources alongside PDFs', async () => {
    const rulebookBytes = Buffer.from('pdf');
    const faqHtml = Buffer.from(
      '<html><body><h1>Official FAQ</h1><p>' + 'FAQ ruling. '.repeat(90) + '</p></body></html>',
    );
    const errataHtml = Buffer.from(
      '<html><body><h1>Official Errata</h1><p>' +
        'Errata ruling. '.repeat(90) +
        '</p></body></html>',
    );

    mockReaddirSync.mockImplementation((path) => {
      const dir = String(path);
      if (dir.endsWith('/pdfs')) return ['gh2-rule-book.pdf'];
      if (dir.endsWith('/rule-sources')) return ['gh2-faq.html', 'gh2-errata.html'];
      return [];
    });
    mockReadFileSync.mockImplementation((path) => {
      const file = String(path);
      if (file.endsWith('gh2-rule-book.pdf')) return rulebookBytes;
      if (file.endsWith('gh2-faq.html')) return faqHtml;
      if (file.endsWith('gh2-errata.html')) return errataHtml;
      throw new Error(`Unexpected read: ${file}`);
    });
    mockPdfParse.mockResolvedValue({ text: 'Rulebook text. '.repeat(90) });
    mockGetIndexedSourceHashes.mockResolvedValue(new Map<string, string | null>());
    mockEmbedBatch.mockImplementation((texts: string[]) =>
      Promise.resolve(texts.map((_, index) => [index + 0.1, 0.2])),
    );

    await main();

    expect(mockPdfParse).toHaveBeenCalledOnce();
    expect(mockAddEntries).toHaveBeenCalledOnce();

    const newEntries = mockAddEntries.mock.calls[0][0];
    expect(new Set(newEntries.map((entry: { source: string }) => entry.source))).toEqual(
      new Set(['gh2-rule-book.pdf', 'gh2-faq.html', 'gh2-errata.html']),
    );
    expect(new Set(newEntries.map((entry: { game: string }) => entry.game))).toEqual(
      new Set(['gloomhaven-2e']),
    );
    expect(
      newEntries.find((entry: { source: string }) => entry.source === 'gh2-faq.html').contentHash,
    ).toBe(computeContentHash(faqHtml));
  });

  it('prefers a normalized text rule source over a same-stem PDF', async () => {
    const rulebookText = Buffer.from('Normalized rulebook text. '.repeat(90));

    mockReaddirSync.mockImplementation((path) => {
      const dir = String(path);
      if (dir.endsWith('/pdfs')) return ['gh2-rule-book.pdf'];
      if (dir.endsWith('/rule-sources')) return ['gh2-rule-book.md'];
      return [];
    });
    mockReadFileSync.mockImplementation((path) => {
      const file = String(path);
      if (file.endsWith('gh2-rule-book.md')) return rulebookText;
      throw new Error(`Unexpected read: ${file}`);
    });
    mockGetIndexedSourceHashes.mockResolvedValue(new Map<string, string | null>());
    mockEmbedBatch.mockResolvedValue([[0.1, 0.2]]);

    await main();

    expect(mockPdfParse).not.toHaveBeenCalled();
    expect(mockAddEntries).toHaveBeenCalledOnce();

    const newEntries = mockAddEntries.mock.calls[0][0];
    expect(new Set(newEntries.map((entry: { source: string }) => entry.source))).toEqual(
      new Set(['gh2-rule-book.md']),
    );
    expect(newEntries[0].game).toBe('gloomhaven-2e');
    expect(newEntries[0].contentHash).toBe(computeContentHash(rulebookText));
  });

  it('reindexes changed PDF files with the same filename', async () => {
    const longText = 'B'.repeat(900);
    mockReaddirSync.mockReturnValue(['fh-changed.pdf']);
    mockReadFileSync.mockReturnValue(Buffer.from('changed pdf bytes'));
    mockPdfParse.mockResolvedValue({ text: longText });
    mockGetIndexedSourceHashes.mockImplementation((game: string) =>
      Promise.resolve(
        game === 'frosthaven'
          ? new Map([['fh-changed.pdf', 'old-hash']])
          : new Map<string, string | null>(),
      ),
    );
    mockEmbedBatch.mockResolvedValue([[0.3, 0.4]]);

    await main();

    expect(mockDeleteEntriesForSources).not.toHaveBeenCalled();
    expect(mockReplaceEntriesForSources).toHaveBeenCalledOnce();
    expect(mockReplaceEntriesForSources.mock.calls[0][0]).toEqual(
      new Map([['frosthaven', ['fh-changed.pdf']]]),
    );
    expect(mockPdfParse).toHaveBeenCalledOnce();
    expect(mockEmbedBatch).toHaveBeenCalledOnce();
    const newEntries = mockReplaceEntriesForSources.mock.calls[0][1];
    expect(newEntries[0].source).toBe('fh-changed.pdf');
    expect(newEntries[0].game).toBe('frosthaven');
    expect(newEntries[0].contentHash).toBe(computeContentHash(Buffer.from('changed pdf bytes')));
  });

  it('keeps existing changed-source rows when replacement embedding fails', async () => {
    mockReaddirSync.mockReturnValue(['fh-changed.pdf']);
    mockReadFileSync.mockReturnValue(Buffer.from('changed pdf bytes'));
    mockPdfParse.mockResolvedValue({ text: 'B'.repeat(900) });
    mockGetIndexedSourceHashes.mockImplementation((game: string) =>
      Promise.resolve(
        game === 'frosthaven'
          ? new Map([['fh-changed.pdf', 'old-hash']])
          : new Map<string, string | null>(),
      ),
    );
    mockEmbedBatch.mockRejectedValue(new Error('embedding failed'));

    await expect(main()).rejects.toThrow('embedding failed');

    expect(mockDeleteEntriesForSources).not.toHaveBeenCalled();
    expect(mockReplaceEntriesForSources).not.toHaveBeenCalled();
    expect(mockAddEntries).not.toHaveBeenCalled();
  });

  it('deletes embedding rows for PDFs that no longer exist', async () => {
    mockReaddirSync.mockReturnValue(['fh-kept.pdf']);
    const keptBytes = Buffer.from('kept pdf bytes');
    mockReadFileSync.mockReturnValue(keptBytes);
    mockGetIndexedSourceHashes.mockImplementation((game: string) =>
      Promise.resolve(
        game === 'frosthaven'
          ? new Map([
              ['fh-kept.pdf', computeContentHash(keptBytes)],
              ['fh-removed.pdf', 'removed-hash'],
            ])
          : new Map<string, string | null>(),
      ),
    );

    await main();

    expect(mockDeleteEntriesForSources).toHaveBeenCalledWith(['fh-removed.pdf'], 'frosthaven');
    expect(mockPdfParse).not.toHaveBeenCalled();
    expect(mockEmbedBatch).not.toHaveBeenCalled();
    expect(mockAddEntries).not.toHaveBeenCalled();
  });

  it('keeps indexed rule source rows when the source file still exists', async () => {
    const faqHtml = Buffer.from(
      '<html><body><h1>Official FAQ</h1><p>' + 'FAQ ruling. '.repeat(90) + '</p></body></html>',
    );
    mockReaddirSync.mockImplementation((path) => {
      const dir = String(path);
      if (dir.endsWith('/pdfs')) return [];
      if (dir.endsWith('/rule-sources')) return ['gh2-faq.html'];
      return [];
    });
    mockReadFileSync.mockImplementation((path) => {
      if (String(path).endsWith('gh2-faq.html')) return faqHtml;
      throw new Error(`Unexpected read: ${String(path)}`);
    });
    mockGetIndexedSourceHashes.mockImplementation((game: string) =>
      Promise.resolve(
        game === 'gloomhaven-2e'
          ? new Map([
              ['gh2-faq.html', computeContentHash(faqHtml)],
              ['gh2-removed.html', 'removed-hash'],
            ])
          : new Map<string, string | null>(),
      ),
    );

    await main();

    expect(mockDeleteEntriesForSources).toHaveBeenCalledWith(['gh2-removed.html'], 'gloomhaven-2e');
    expect(mockAddEntries).not.toHaveBeenCalled();
  });

  it('indexes scenario and section books alongside the rulebook corpus', async () => {
    const longText = 'A'.repeat(900);
    const rulebookPath = join(import.meta.dirname, '..', 'data', 'pdfs', 'fh-rule-book.pdf');
    mockReaddirSync.mockReturnValue([
      'fh-rule-book.pdf',
      'fh-scenario-book-42-61.pdf',
      'fh-section-book-62-81.pdf',
    ]);
    mockReadFileSync.mockImplementation((path) => Buffer.from(String(path)));
    mockPdfParse.mockResolvedValue({ text: longText });
    mockGetIndexedSourceHashes.mockImplementation((game: string) =>
      Promise.resolve(
        game === 'frosthaven'
          ? new Map([['fh-rule-book.pdf', computeContentHash(Buffer.from(rulebookPath))]])
          : new Map<string, string | null>(),
      ),
    );
    mockEmbedBatch.mockResolvedValue([[0.1, 0.2]]);

    await main();

    expect(mockPdfParse).toHaveBeenCalledTimes(2);
    const newEntries = mockAddEntries.mock.calls[0][0];
    expect(newEntries.map((entry: { source: string }) => entry.source)).toEqual([
      'fh-scenario-book-42-61.pdf',
      'fh-section-book-62-81.pdf',
    ]);
    expect(new Set(newEntries.map((entry: { game: string }) => entry.game))).toEqual(
      new Set(['frosthaven']),
    );
  });

  it('fails clearly for PDFs without a supported game prefix', async () => {
    mockReaddirSync.mockReturnValue(['rule-book.pdf']);

    await expect(main()).rejects.toThrow(
      'Cannot derive game id from source filename "rule-book.pdf"',
    );
    expect(mockGetIndexedSourceHashes).not.toHaveBeenCalled();
    expect(mockAddEntries).not.toHaveBeenCalled();
  });

  it('logs nothing new for empty docs directory', async () => {
    mockReaddirSync.mockReturnValue([]);
    mockGetIndexedSourceHashes.mockResolvedValue(new Map<string, string | null>());

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await main();

    expect(consoleSpy).toHaveBeenCalledWith('Nothing new to index.');
    expect(mockAddEntries).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
