import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import { optionalSession } from '../src/auth/session-middleware.ts';

const originalSessionSecret = process.env.SESSION_SECRET;

afterEach(() => {
  if (originalSessionSecret === undefined) {
    delete process.env.SESSION_SECRET;
  } else {
    process.env.SESSION_SECRET = originalSessionSecret;
  }
  vi.restoreAllMocks();
});

describe('optionalSession', () => {
  it('warns when optional auth fails but continues as unauthenticated', async () => {
    process.env.SESSION_SECRET = 'too-short';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = new Hono();
    app.use('*', optionalSession());
    app.get('/', (c) => c.text('ok'));

    const response = await app.request('/');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(warn).toHaveBeenCalledWith(
      '[session] optional session check failed; continuing unauthenticated:',
      'SESSION_SECRET must be set and at least 32 characters',
    );
  });
});
