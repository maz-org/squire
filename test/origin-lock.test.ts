import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { originSharedSecretMiddleware } from '../src/origin-lock.ts';

function makeApp(secret?: string) {
  const app = new Hono();
  app.use('*', originSharedSecretMiddleware({ secret }));
  app.get('/api/live', (c) => c.json({ status: 'ok' }));
  app.get('/api/health', (c) => c.json({ status: 'ok' }));
  app.get('/login', (c) => c.text('login'));
  return app;
}

describe('originSharedSecretMiddleware', () => {
  it('does nothing when no shared secret is configured', async () => {
    const res = await makeApp().request('/login');

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('login');
  });

  it('allows health endpoints without the shared secret for Fly machine checks', async () => {
    const app = makeApp('cloudfront-secret');

    await expect(app.request('/api/live')).resolves.toMatchObject({ status: 200 });
    await expect(app.request('/api/health')).resolves.toMatchObject({ status: 200 });
  });

  it('rejects non-health requests without the shared secret', async () => {
    const res = await makeApp('cloudfront-secret').request('/login');

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' });
  });

  it('rejects non-health requests with the wrong shared secret', async () => {
    const res = await makeApp('cloudfront-secret').request('/login', {
      headers: { 'X-Origin-Secret': 'wrong-secret' },
    });

    expect(res.status).toBe(403);
  });

  it('allows non-health requests with the exact shared secret', async () => {
    const res = await makeApp('cloudfront-secret').request('/login', {
      headers: { 'X-Origin-Secret': 'cloudfront-secret' },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('login');
  });
});
