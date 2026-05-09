import { describe, expect, it, vi } from 'vitest';

import { runReadinessChecks } from '../src/health.ts';

describe('runReadinessChecks', () => {
  it('returns ok only when Postgres, pgvector, and the embedder are ready', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] });

    const status = await runReadinessChecks({
      db: { $client: { query } },
      isEmbedderLoaded: () => true,
    });

    expect(status).toEqual({
      status: 'ok',
      db: { status: 'ok' },
      vector: { status: 'ok' },
      embedder: { status: 'ok' },
    });
    expect(query).toHaveBeenCalledWith('SELECT 1');
    expect(query).toHaveBeenCalledWith("SELECT '[1]'::vector");
  });

  it('names failing components and returns error status', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ ok: 1 }] })
      .mockRejectedValueOnce(new Error('type "vector" does not exist'));

    const status = await runReadinessChecks({
      db: { $client: { query } },
      isEmbedderLoaded: () => false,
    });

    expect(status.status).toBe('error');
    expect(status.db).toEqual({ status: 'ok' });
    expect(status.vector).toEqual({
      status: 'error',
      error: 'type "vector" does not exist',
    });
    expect(status.embedder).toEqual({
      status: 'error',
      error: 'embedder is not loaded',
    });
  });

  it('times out dependency probes that never return', async () => {
    const query = vi.fn(() => new Promise(() => {}));

    const status = await runReadinessChecks({
      db: { $client: { query } },
      isEmbedderLoaded: () => true,
      queryTimeoutMs: 1,
    });

    expect(status.status).toBe('error');
    expect(status.db).toEqual({ status: 'error', error: 'readiness check timed out' });
    expect(status.vector).toEqual({
      status: 'error',
      error: 'skipped because database is unavailable',
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('reports an exhausted Postgres pool without queuing another query', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] });

    const status = await runReadinessChecks({
      db: {
        $client: {
          query,
          totalCount: 10,
          idleCount: 0,
          waitingCount: 0,
          options: { max: 10 },
        },
      },
      isEmbedderLoaded: () => true,
    });

    expect(status.status).toBe('error');
    expect(status.db).toEqual({ status: 'error', error: 'postgres pool is exhausted' });
    expect(status.vector).toEqual({
      status: 'error',
      error: 'skipped because database is unavailable',
    });
    expect(query).not.toHaveBeenCalled();
  });
});
