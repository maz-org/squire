import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  availableExtractedGames,
  extractedDataPath,
  readExtractedRecords,
} from '../src/extracted-paths.ts';

describe('extracted data paths', () => {
  it('keeps Frosthaven on the legacy flat extracted path', () => {
    expect(extractedDataPath('items', 'frosthaven')).toMatch(/data\/extracted\/items\.json$/);
  });

  it('stores GH2 extracted records under the gh2 game directory', () => {
    expect(extractedDataPath('items', 'gh2')).toMatch(/data\/extracted\/gh2\/items\.json$/);
  });

  it('discovers non-default game extracts next to the legacy Frosthaven files', () => {
    const root = mkdtempSync(join(tmpdir(), 'squire-extracted-paths-'));
    try {
      writeFileSync(join(root, 'items.json'), '[]', 'utf-8');
      mkdirSync(join(root, 'gh2'), { recursive: true });
      writeFileSync(join(root, 'gh2', 'items.json'), '[{"sourceId":"gh2-item"}]', 'utf-8');

      expect(availableExtractedGames({ extractedDir: root })).toEqual([
        'frosthaven',
        'gloomhaven-2e',
      ]);
      expect(readExtractedRecords('items', 'gloomhaven-2e', { extractedDir: root })).toEqual([
        { sourceId: 'gh2-item' },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
