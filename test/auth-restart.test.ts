/**
 * IRON RULE regression test (SQR-50 / SQR-69).
 *
 * The bug this test exists to lock down: the previous `src/auth.ts` kept
 * clients, authorization codes, and tokens in module-local `Map`s. Every
 * process restart silently dropped every live token, every registered
 * client, and every in-flight authorization code. The fix (SQR-68) moved
 * all OAuth state into Postgres via {@link SquireOAuthProvider}; SQR-69
 * wired the Hono endpoints to it. This test proves both halves landed by
 * walking the full OAuth dance, then **tearing the server-mode DB pool
 * down between requests** (the closest in-process simulation of `kill -9`
 * → restart we have) and replaying the bearer call. If a regression ever
 * reintroduces in-memory state, the post-restart call will 401 and this
 * test will fail loudly.
 *
 * No mocks. The test runs against the same `*_test` Postgres the rest of
 * the auth suite uses, via `setupTestDb` / `resetTestDb`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

import { setupTestDb, resetTestDb, teardownTestDb } from './helpers/db.ts';

// `src/server.ts` imports `service.ts` which would otherwise call out to
// embedders / other heavy init at module-load time. Stub it. The bearer
// middleware doesn't care about service state, and `/api/health` only reads
// `isReady()` plus a single `SELECT COUNT(*)` on a real table.
vi.mock('../src/service.ts', () => ({
  initialize: vi.fn(),
  isReady: vi.fn(() => true),
  ask: vi.fn(),
}));

vi.mock('../src/tools.ts', () => ({
  searchRules: vi.fn(),
  searchCards: vi.fn(),
  listCardTypes: vi.fn(),
  listCards: vi.fn(),
  getCard: vi.fn(),
}));

import { app } from '../src/server.ts';
import { resetAuthProvider } from '../src/auth.ts';
import { shutdownServerPool } from '../src/db.ts';

beforeAll(async () => {
  await setupTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  // Discard any singleton bound to a previous (now-truncated) state. This
  // is belt-and-suspenders: the singleton holds a reference to the pool,
  // and the pool's connections see the truncate, so a leftover provider
  // would be functionally fine — but resetting it makes the per-test
  // setup symmetric with the simulated-restart we do below.
  resetAuthProvider();
  await shutdownServerPool();
});

afterAll(async () => {
  await teardownTestDb();
  await shutdownServerPool();
  resetAuthProvider();
});

/**
 * Build a PKCE S256 challenge for a given verifier. Matches
 * `provider.ts#verifyPkceS256` exactly.
 */
function pkce(verifier: string) {
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function runOAuthDance(): Promise<{ accessToken: string }> {
  const registerRes = await app.request('http://localhost:3000/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: ['http://localhost:8080/callback'],
      client_name: 'Restart Regression',
      token_endpoint_auth_method: 'none',
    }),
  });
  expect(registerRes.status).toBe(201);
  const { client_id: clientId } = (await registerRes.json()) as { client_id: string };

  const { verifier, challenge } = pkce('verifier-restart-' + 'x'.repeat(60));

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: 'http://localhost:8080/callback',
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  const authRes = await app.request(`http://localhost:3000/authorize?${params}`, {
    redirect: 'manual',
  });
  expect(authRes.status).toBe(302);
  const code = new URL(authRes.headers.get('location')!).searchParams.get('code');
  expect(code).toBeTruthy();

  const tokenRes = await app.request('http://localhost:3000/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code!,
      client_id: clientId,
      code_verifier: verifier,
      redirect_uri: 'http://localhost:8080/callback',
    }).toString(),
  });
  expect(tokenRes.status).toBe(200);
  const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string };
  expect(accessToken).toBeTruthy();
  return { accessToken };
}

describe('IRON RULE: tokens survive process restart', () => {
  it('keeps a freshly-issued bearer valid after the server pool is torn down and rebuilt', async () => {
    // 1–4. Walk register → authorize → token end-to-end via the real
    //      Hono app, hitting the real test database through SquireOAuthProvider.
    const { accessToken } = await runOAuthDance();

    // 5. Simulate process exit. `shutdownServerPool` ends the pg Pool used
    //    by `getDb('server')`; `resetAuthProvider` discards the cached
    //    provider so the next call has to rebuild a fresh one against a
    //    new pool — exactly what would happen on a real restart. The token
    //    itself only ever lives in Postgres; if any in-memory state slipped
    //    back in, this is the moment it would vanish.
    await shutdownServerPool();
    resetAuthProvider();

    // 6. Replay an authenticated `/api/health` call. A fresh pool +
    //    provider has to verify the bearer purely from DB state.
    const healthRes = await app.request('http://localhost:3000/api/health', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(healthRes.status).toBe(200);

    // 7. The bearer also has to gate `/mcp` after the restart. We POST a
    //    minimal JSON-RPC initialize so the transport accepts the body —
    //    the assertion is that the bearer middleware lets us through, not
    //    that initialize itself succeeds. Anything other than 401 is a
    //    pass for the auth invariant under test.
    const mcpRes = await app.request('http://localhost:3000/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'restart-test', version: '0.0.0' },
        },
      }),
    });
    expect(mcpRes.status).not.toBe(401);
  });
});
