import { afterEach, describe, expect, it, vi } from 'vitest';

describe('character mat assets', () => {
  afterEach(() => {
    vi.doUnmock('node:fs/promises');
    vi.resetModules();
  });

  it('returns null when an allowed mat asset is missing on disk', async () => {
    const readFile = vi.fn().mockRejectedValue(new Error('missing'));
    vi.doMock('node:fs/promises', () => ({ readFile }));
    const { readCharacterMatAsset } = await import('../src/web-ui/character-mat-assets.ts');

    await expect(
      readCharacterMatAsset({ game: 'gloomhaven-2e', file: 'gh2-bruiser.jpeg' }),
    ).resolves.toBeNull();
    expect(readFile).toHaveBeenCalledTimes(1);
  });
});
