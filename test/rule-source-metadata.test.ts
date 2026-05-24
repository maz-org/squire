import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

interface RuleSourceMetadata {
  id: string;
  file: string;
  normalizedFile?: string;
  game: string;
  sourceType: string;
  sourceUrl: string;
  capturedAt: string;
  refreshNotes: string;
}

async function readMetadata(): Promise<RuleSourceMetadata[]> {
  const json = await readFile(
    new URL('../data/rule-sources/metadata.json', import.meta.url),
    'utf8',
  );
  return JSON.parse(json) as RuleSourceMetadata[];
}

describe('GH2 rule source metadata', () => {
  it('documents first-class source metadata for rulebook, FAQ, and errata', async () => {
    const sources = await readMetadata();

    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'gh2-rule-book',
          file: 'data/pdfs/gh2-rule-book.pdf',
          normalizedFile: 'data/rule-sources/gh2-rule-book.md',
          game: 'gloomhaven-2e',
          sourceType: 'rulebook',
          sourceUrl: expect.stringContaining('drive.google.com'),
        }),
        expect.objectContaining({
          id: 'gh2-faq',
          file: 'data/rule-sources/gh2-faq.html',
          game: 'gloomhaven-2e',
          sourceType: 'faq',
          sourceUrl: 'https://cephalofairgames.github.io/gloomhaven2e-faq/',
        }),
        expect.objectContaining({
          id: 'gh2-errata',
          file: 'data/rule-sources/gh2-errata.html',
          game: 'gloomhaven-2e',
          sourceType: 'errata',
          sourceUrl: 'https://cephalofairgames.github.io/gloomhaven2e-faq/#page_01',
        }),
      ]),
    );

    for (const source of sources) {
      expect(source.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(source.refreshNotes).not.toHaveLength(0);
      await expect(access(join(import.meta.dirname, '..', source.file))).resolves.toBeUndefined();
      if (source.normalizedFile) {
        await expect(
          access(join(import.meta.dirname, '..', source.normalizedFile)),
        ).resolves.toBeUndefined();
      }
    }
  });
});
