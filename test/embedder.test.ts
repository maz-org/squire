import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEmbedVoyage } = vi.hoisted(() => ({
  mockEmbedVoyage: vi.fn(),
}));

vi.mock('../src/voyage-retrieval.ts', () => ({
  embedVoyage: mockEmbedVoyage,
  isEmbedderLoaded: () => true,
}));

describe('embedder', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockEmbedVoyage.mockReset();
  });

  describe('embed', () => {
    it('uses Voyage query embeddings', async () => {
      mockEmbedVoyage.mockResolvedValueOnce([[0.1, 0.2, 0.3]]);
      const { embed } = await import('../src/embedder.ts');

      await expect(embed('hello world')).resolves.toEqual([0.1, 0.2, 0.3]);
      expect(mockEmbedVoyage).toHaveBeenCalledWith(['hello world'], 'query');
    });
  });

  describe('embedBatch', () => {
    it('uses Voyage document embeddings', async () => {
      mockEmbedVoyage.mockResolvedValueOnce([
        [0.1, 0.2],
        [0.3, 0.4],
      ]);
      const { embedBatch } = await import('../src/embedder.ts');

      await expect(embedBatch(['one', 'two'])).resolves.toEqual([
        [0.1, 0.2],
        [0.3, 0.4],
      ]);
      expect(mockEmbedVoyage).toHaveBeenCalledWith(['one', 'two'], 'document');
    });

    it('returns an empty array for empty input', async () => {
      mockEmbedVoyage.mockResolvedValueOnce([]);
      const { embedBatch } = await import('../src/embedder.ts');

      await expect(embedBatch([])).resolves.toEqual([]);
      expect(mockEmbedVoyage).toHaveBeenCalledWith([], 'document');
    });
  });
});
