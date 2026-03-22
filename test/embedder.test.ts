import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockModel = vi.fn().mockResolvedValue({ data: new Float32Array([0.1, 0.2, 0.3]) });
const mockPipeline = vi.fn().mockResolvedValue(mockModel);

vi.mock('@xenova/transformers', () => ({
  pipeline: mockPipeline,
}));

describe('embedder', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockModel.mockClear();
    mockPipeline.mockClear();
  });

  describe('embed', () => {
    it('returns an array of numbers', async () => {
      const { embed } = await import('../src/embedder.ts');
      const result = await embed('hello world');
      expect(Array.isArray(result)).toBe(true);
      expect(result.every((n) => typeof n === 'number')).toBe(true);
    });

    it('returns the correct values from the model output', async () => {
      const { embed } = await import('../src/embedder.ts');
      const result = await embed('hello world');
      expect(result).toHaveLength(3);
      expect(result[0]).toBeCloseTo(0.1);
      expect(result[1]).toBeCloseTo(0.2);
      expect(result[2]).toBeCloseTo(0.3);
    });

    it('calls the model with pooling mean and normalize true', async () => {
      const { embed } = await import('../src/embedder.ts');
      await embed('test text');
      expect(mockModel).toHaveBeenCalledWith('test text', { pooling: 'mean', normalize: true });
    });

    it('initializes the pipeline with the correct model', async () => {
      const { embed } = await import('../src/embedder.ts');
      await embed('test');
      expect(mockPipeline).toHaveBeenCalledWith('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    });

    it('only initializes the model once across multiple calls (singleton)', async () => {
      const { embed } = await import('../src/embedder.ts');
      await embed('first');
      await embed('second');
      await embed('third');
      expect(mockPipeline).toHaveBeenCalledTimes(1);
    });
  });

  describe('embedBatch', () => {
    it('returns the correct number of results', async () => {
      const { embedBatch } = await import('../src/embedder.ts');
      const texts = ['one', 'two', 'three'];
      const results = await embedBatch(texts);
      expect(results).toHaveLength(3);
    });

    it('returns an array of number arrays', async () => {
      const { embedBatch } = await import('../src/embedder.ts');
      const results = await embedBatch(['a', 'b']);
      expect(results.every((r) => Array.isArray(r) && r.every((n) => typeof n === 'number'))).toBe(
        true,
      );
    });

    it('calls the model once per text', async () => {
      const { embedBatch } = await import('../src/embedder.ts');
      await embedBatch(['x', 'y', 'z']);
      expect(mockModel).toHaveBeenCalledTimes(3);
    });

    it('returns empty array for empty input', async () => {
      const { embedBatch } = await import('../src/embedder.ts');
      const results = await embedBatch([]);
      expect(results).toEqual([]);
    });
  });
});
