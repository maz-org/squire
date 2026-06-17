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
    const logs: string[] = [];
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
      log: (message) => logs.push(message),
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
    expect(logs).toEqual([
      'OK /api/live status=ok attempt=1/4',
      'OK /api/health status=ok attempt=1/4 db=ok vector=ok embedder=ok',
    ]);
  });

  it('retries a transient fetch failure and then succeeds', async () => {
    const requested: string[] = [];
    const sleeps: number[] = [];
    const logs: string[] = [];

    await expect(
      checkDeployHealth({
        baseUrl: 'https://maz-squire.fly.dev',
        fetch: async (url) => {
          requested.push(String(url));
          if (requested.length === 1) {
            throw Object.assign(new TypeError('fetch failed'), {
              cause: Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }),
            });
          }
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
        log: (message) => logs.push(message),
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      }),
    ).resolves.toMatchObject({
      liveUrl: 'https://maz-squire.fly.dev/api/live',
      healthUrl: 'https://maz-squire.fly.dev/api/health',
    });

    expect(requested).toEqual([
      'https://maz-squire.fly.dev/api/live',
      'https://maz-squire.fly.dev/api/live',
      'https://maz-squire.fly.dev/api/health',
    ]);
    expect(sleeps).toEqual([1000]);
    expect(logs).toEqual([
      'Retry /api/live attempt=1/4 reason=ECONNRESET nextDelayMs=1000',
      'OK /api/live status=ok attempt=2/4',
      'OK /api/health status=ok attempt=1/4 db=ok vector=ok embedder=ok',
    ]);
  });

  it('retries a TLS setup network reset without logging the full URL', async () => {
    const requested: string[] = [];
    const logs: string[] = [];

    await expect(
      checkDeployHealth({
        baseUrl: 'https://maz-squire.fly.dev',
        fetch: async (url) => {
          requested.push(String(url));
          if (requested.length === 1) {
            throw new TypeError(
              'Client network socket disconnected before secure TLS connection was established',
            );
          }
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
        log: (message) => logs.push(message),
        sleep: async () => undefined,
      }),
    ).resolves.toMatchObject({
      liveUrl: 'https://maz-squire.fly.dev/api/live',
      healthUrl: 'https://maz-squire.fly.dev/api/health',
    });

    expect(requested).toHaveLength(3);
    expect(logs[0]).toBe('Retry /api/live attempt=1/4 reason=fetch_failed nextDelayMs=1000');
    expect(logs.join('\n')).not.toContain('https://maz-squire.fly.dev');
  });

  it('retries transient 502, 503, and 504 responses', async () => {
    const responses = [
      jsonResponse(502, { status: 'bad_gateway' }),
      jsonResponse(503, { status: 'starting' }),
      jsonResponse(504, { status: 'timeout' }),
      jsonResponse(200, { status: 'ok' }),
      jsonResponse(200, {
        status: 'ok',
        db: { status: 'ok' },
        vector: { status: 'ok' },
        embedder: { status: 'ok' },
      }),
    ];
    const sleeps: number[] = [];

    await expect(
      checkDeployHealth({
        baseUrl: 'https://maz-squire.fly.dev',
        fetch: async () => responses.shift() ?? jsonResponse(500, { status: 'unexpected' }),
        log: () => undefined,
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      }),
    ).resolves.toMatchObject({ baseUrl: 'https://maz-squire.fly.dev' });

    expect(sleeps).toEqual([1000, 2000, 5000]);
  });

  it('fails after exhausting transient retries', async () => {
    const sleeps: number[] = [];

    await expect(
      checkDeployHealth({
        baseUrl: 'https://maz-squire.fly.dev',
        fetch: async () => {
          throw Object.assign(new TypeError('fetch failed'), {
            cause: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
          });
        },
        log: () => undefined,
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      }),
    ).rejects.toThrow('/api/live failed after 4 attempts: ETIMEDOUT');

    expect(sleeps).toEqual([1000, 2000, 5000]);
  });

  it('fails after exhausting transient HTTP status retries', async () => {
    const sleeps: number[] = [];

    await expect(
      checkDeployHealth({
        baseUrl: 'https://maz-squire.fly.dev',
        fetch: async () => jsonResponse(503, { status: 'starting' }),
        log: () => undefined,
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      }),
    ).rejects.toThrow('/api/live returned 503 after 4 attempts');

    expect(sleeps).toEqual([1000, 2000, 5000]);
  });

  it('does not retry permanent HTTP failures', async () => {
    const requested: string[] = [];

    await expect(
      checkDeployHealth({
        baseUrl: 'https://maz-squire.fly.dev',
        fetch: async (url) => {
          requested.push(String(url));
          return jsonResponse(404, { status: 'not_found' });
        },
        log: () => undefined,
      }),
    ).rejects.toThrow('/api/live returned 404');

    expect(requested).toEqual(['https://maz-squire.fly.dev/api/live']);
  });

  it('reports response status before parsing non-ok bodies', async () => {
    await expect(
      checkDeployHealth({
        baseUrl: 'https://maz-squire.fly.dev',
        fetch: async () =>
          new Response('<html>temporarily unavailable</html>', {
            status: 500,
            headers: { 'content-type': 'text/html' },
          }),
        log: () => undefined,
      }),
    ).rejects.toThrow('/api/live returned 500');
  });

  it('does not retry invalid JSON from a successful response', async () => {
    const requested: string[] = [];

    await expect(
      checkDeployHealth({
        baseUrl: 'https://maz-squire.fly.dev',
        fetch: async (url) => {
          requested.push(String(url));
          return new Response('<html>bad gateway</html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          });
        },
        log: () => undefined,
      }),
    ).rejects.toThrow('/api/live did not return valid JSON');

    expect(requested).toEqual(['https://maz-squire.fly.dev/api/live']);
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
