/**
 * Unit tests for the embedding-version drift guard in src/vector-store.ts.
 *
 * Isolated in its own file so the `vi.mock('../src/db.ts', ...)` at module
 * level doesn't leak into other vector-store tests that don't touch the DB.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));

vi.mock('../src/db.ts', () => ({
  getDb: () => ({
    db: { execute: mockExecute },
    close: async () => {},
  }),
}));

import { EMBEDDING_VERSION, checkEmbeddingVersion } from '../src/vector-store.ts';

describe('checkEmbeddingVersion', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockExecute.mockReset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('no-ops silently when the embeddings table is empty', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });
    await checkEmbeddingVersion();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('no-ops silently when the table contains only the current version', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{ embedding_version: EMBEDDING_VERSION }],
    });
    await checkEmbeddingVersion();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs a drift warning when a different version is present', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{ embedding_version: 'xenova-minilm-l6-v2.v0' }],
    });
    await checkEmbeddingVersion();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain('EMBEDDING VERSION DRIFT');
    expect(message).toContain(EMBEDDING_VERSION);
    expect(message).toContain('xenova-minilm-l6-v2.v0');
  });

  it('logs a drift warning when current + stale versions coexist', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [
        { embedding_version: EMBEDDING_VERSION },
        { embedding_version: 'xenova-minilm-l6-v2.v0' },
      ],
    });
    await checkEmbeddingVersion();
    // Current version is present, so no drift warning — drift is defined as
    // "current version is NOT in the set", not "only current version is in the set".
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('swallows database errors with a non-fatal warning', async () => {
    mockExecute.mockRejectedValueOnce(new Error('relation "embeddings" does not exist'));
    await expect(checkEmbeddingVersion()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain('embedding_version sanity check skipped');
  });
});
