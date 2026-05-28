import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { embedVoyageExperiment } from '../src/retrieval-experiment.ts';

const originalVoyageApiKey = process.env.VOYAGE_API_KEY;

function embedding(dimensions = 1024): number[] {
  return Array.from({ length: dimensions }, (_, index) => index / dimensions);
}

describe('embedVoyageExperiment', () => {
  beforeEach(() => {
    process.env.VOYAGE_API_KEY = 'test-voyage-key';
  });

  afterEach(() => {
    process.env.VOYAGE_API_KEY = originalVoyageApiKey;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('accepts finite Voyage embeddings with the configured 1024 dimensions', async () => {
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
      Response.json({
        data: [{ embedding: embedding() }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await embedVoyageExperiment(['poison rules'], 'query');

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(1024);
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect(request.output_dimension).toBe(1024);
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects Voyage embeddings with the wrong dimensions before vector storage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: [{ embedding: embedding(2) }],
        }),
      ),
    );

    await expect(embedVoyageExperiment(['poison rules'], 'query')).rejects.toThrow(
      'parseVoyageEmbeddings: item 0 returned 2 dimension(s), expected 1024.',
    );
  });

  it('rejects non-finite Voyage embedding values before vector storage', async () => {
    const values = embedding() as unknown[];
    values[7] = 'not-a-number';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: [{ embedding: values }],
        }),
      ),
    );

    await expect(embedVoyageExperiment(['poison rules'], 'query')).rejects.toThrow(
      'parseVoyageEmbeddings: item 0 dimension 7 was not finite.',
    );
  });

  it('aborts hung provider attempts and retries before failing', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = expect(embedVoyageExperiment(['poison rules'], 'query')).rejects.toThrow(
      'retrieval experiment provider request failed after retries: aborted',
    );

    await vi.runAllTimersAsync();
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
