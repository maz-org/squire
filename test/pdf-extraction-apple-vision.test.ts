import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  APPLE_VISION_PROVIDER_CONFIG_HASH,
  createAppleVisionProvider,
} from '../eval/pdf-extraction/apple-vision.ts';
import { validateExtractionArtifact } from '../eval/pdf-extraction/schema.ts';

describe('Apple Vision PDF extraction provider', () => {
  it('wraps mocked Apple Vision Markdown output in the shared normalized artifact schema', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'squire-apple-vision-'));
    const sourcePath = join(outputDir, 'gh2-rule-book.pdf');
    await writeFile(sourcePath, 'fake pdf bytes', 'utf8');
    const runOcr = vi.fn(async ({ outputPath }: { outputPath: string }) => {
      await writeFile(
        outputPath,
        [
          '# Gloomhaven (2nd Edition) Rulebook OCR Text Snapshot',
          '',
          '## Page 29',
          'Ignored page',
          '',
          '## Page 30',
          'Loot',
          'Loot X lets a figure loot all loot tokens within range X.',
          '30',
          '',
          '## Page 31',
          'Line-of-Sight',
          'Line-of-sight is checked from any part of one hex to another.',
        ].join('\n'),
        'utf8',
      );
    });
    const provider = createAppleVisionProvider({
      runOcr,
      now: () => '2026-05-29T00:00:00.000Z',
    });

    const artifact = await provider.extract({
      sourcePath,
      pages: [30, 31],
      outputDir,
      runLabel: 'apple baseline',
      retryCount: 0,
    });

    expect(runOcr).toHaveBeenCalledWith({
      sourcePath,
      outputPath: expect.stringContaining('/raw/apple-vision/'),
      scriptPath: 'scripts/ocr-pdf-apple-vision.swift',
      timeoutMs: undefined,
    });
    expect(validateExtractionArtifact(artifact)).toEqual(artifact);
    expect(artifact).toMatchObject({
      provider: 'apple-vision',
      providerVersion: provider.version,
      providerConfigHash: APPLE_VISION_PROVIDER_CONFIG_HASH,
      run: {
        id: 'apple baseline',
        status: 'succeeded',
        pageRange: [30, 31],
      },
      cost: {
        estimatedUsd: 0,
        actualUsd: 0,
        pagesProcessed: 2,
        costPerPageUsd: 0,
      },
      privacy: {
        retentionPolicy:
          'local macOS Vision OCR output is retained only in the configured eval output directory',
        trainingUse: 'not-used-for-training',
      },
    });
    expect(artifact.source.sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(artifact.source.pageCount).toBe(31);
    expect(artifact.rawArtifacts).toHaveLength(1);
    expect(artifact.rawArtifacts[0]).toMatchObject({
      kind: 'provider-markdown',
      persisted: true,
      redacted: false,
    });
    expect(artifact.rawArtifacts[0].path).toContain('/raw/apple-vision/');
    expect(artifact.rawArtifacts[0].sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(await readFile(artifact.rawArtifacts[0].path!, 'utf8')).toContain('## Page 30');
    expect(artifact.pages.map((page) => page.pageNumber)).toEqual([30, 31]);
    expect(artifact.pages[0]).toMatchObject({
      pageNumber: 30,
      width: 612,
      height: 792,
      unit: 'pt',
      markdown: '## Loot\n\nLoot X lets a figure loot all loot tokens within range X.\n\n30',
      text: 'Loot\nLoot X lets a figure loot all loot tokens within range X.\n30',
    });
    expect(artifact.pages[0].blocks).toEqual([
      { id: 'p30-b0', type: 'heading', order: 0, text: 'Loot' },
      {
        id: 'p30-b1',
        type: 'line',
        order: 1,
        text: 'Loot X lets a figure loot all loot tokens within range X.',
      },
      { id: 'p30-b2', type: 'page-number', order: 2, text: '30' },
    ]);
  });

  it('fails selected-page runs when the mocked OCR output omits a requested page', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'squire-apple-vision-missing-page-'));
    const sourcePath = join(outputDir, 'gh2-rule-book.pdf');
    await writeFile(sourcePath, 'fake pdf bytes', 'utf8');
    const provider = createAppleVisionProvider({
      runOcr: async ({ outputPath }) => {
        await writeFile(outputPath, '## Page 30\nLoot', 'utf8');
      },
      now: () => '2026-05-29T00:00:00.000Z',
    });

    await expect(
      provider.extract({
        sourcePath,
        pages: [30, 31],
        outputDir,
        runLabel: 'apple-baseline',
        retryCount: 0,
      }),
    ).rejects.toThrow(/partial page failure: Apple Vision output omitted page 31/);
  });
});
