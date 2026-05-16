import { describe, expect, it } from 'vitest';

import { checkDeployHealth } from '../scripts/check-deploy-health.ts';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('checkDeployHealth', () => {
  it('passes when liveness and all readiness dependencies are healthy', async () => {
    const requested: string[] = [];
    const result = await checkDeployHealth({
      baseUrl: 'https://maz-squire.fly.dev/',
      fetch: async (url) => {
        requested.push(String(url));
        if (String(url).endsWith('/api/live')) {
          return jsonResponse(200, { status: 'ok' });
        }
        return jsonResponse(200, {
          status: 'ok',
          db: { status: 'ok' },
          vector: { status: 'ok' },
          embedder: { status: 'ok' },
        });
      },
      log: () => undefined,
    });

    expect(result).toEqual({
      baseUrl: 'https://maz-squire.fly.dev',
      liveUrl: 'https://maz-squire.fly.dev/api/live',
      healthUrl: 'https://maz-squire.fly.dev/api/health',
    });
    expect(requested).toEqual([
      'https://maz-squire.fly.dev/api/live',
      'https://maz-squire.fly.dev/api/health',
    ]);
  });

  it('fails when the liveness endpoint is not ok', async () => {
    await expect(
      checkDeployHealth({
        baseUrl: 'https://maz-squire.fly.dev',
        fetch: async () => jsonResponse(503, { status: 'starting' }),
        log: () => undefined,
      }),
    ).rejects.toThrow('/api/live returned 503');
  });

  it('reports response status before parsing non-ok bodies', async () => {
    await expect(
      checkDeployHealth({
        baseUrl: 'https://maz-squire.fly.dev',
        fetch: async () =>
          new Response('<html>temporarily unavailable</html>', {
            status: 503,
            headers: { 'content-type': 'text/html' },
          }),
        log: () => undefined,
      }),
    ).rejects.toThrow('/api/live returned 503');
  });

  it('fails when a readiness dependency is unhealthy', async () => {
    await expect(
      checkDeployHealth({
        baseUrl: 'https://maz-squire.fly.dev',
        fetch: async (url) => {
          if (String(url).endsWith('/api/live')) {
            return jsonResponse(200, { status: 'ok' });
          }
          return jsonResponse(200, {
            status: 'ok',
            db: { status: 'ok' },
            vector: { status: 'degraded' },
            embedder: { status: 'ok' },
          });
        },
        log: () => undefined,
      }),
    ).rejects.toThrow('/api/health vector status was degraded');
  });
});
