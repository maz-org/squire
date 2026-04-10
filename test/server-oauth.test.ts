/**
 * HTTP tests for OAuth 2.1 endpoints and bearer auth middleware on
 * `src/server.ts`.
 *
 * This file covers: `/.well-known/oauth-authorization-server`,
 * `/.well-known/oauth-protected-resource`, `/register`, `/authorize`,
 * `/token`, and the bearer middleware that protects `/api/*` and `/mcp`.
 *
 * Content/search endpoints live in `test/server-api.test.ts`. The split
 * keeps each file small enough to be worked on in parallel without merge
 * conflicts. Both files mock `src/service.ts` and `src/tools.ts` (since
 * `src/server.ts` imports them at module-load time), but `src/db.ts` is
 * NOT mocked here — SQR-69 wired the OAuth endpoints to the Drizzle-backed
 * provider, so this file runs against the real test DB via
 * `setupTestDb` / `resetTestDb`. The IRON RULE (tokens must survive
 * process restart) cannot be exercised against a fake `db.execute` stub.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

import { CODE_VERIFIER, CODE_CHALLENGE, makeAuthHelpers } from './helpers/server-oauth-helpers.ts';
import { setupTestDb, resetTestDb, teardownTestDb } from './helpers/db.ts';

function makeStatus() {
  return {
    lifecycle: 'ready',
    ready: true,
    bootstrapReady: true,
    warmingUp: false,
    indexSize: 3,
    cardCount: 15,
    ruleQueriesReady: true,
    cardQueriesReady: true,
    askReady: true,
    missingBootstrapSteps: [],
    errors: [],
    capabilities: {
      rules: { allowed: true, reason: null, message: null },
      cards: { allowed: true, reason: null, message: null },
      ask: { allowed: true, reason: null, message: null },
    },
  };
}

const {
  mockInitialize,
  mockGetBootstrapStatus,
  mockIsReady,
  mockRefreshInitializationIfReady,
  mockAsk,
  mockSearchRules,
} = vi.hoisted(() => ({
  mockInitialize: vi.fn(),
  mockGetBootstrapStatus: vi.fn(),
  mockIsReady: vi.fn(),
  mockRefreshInitializationIfReady: vi.fn(),
  mockAsk: vi.fn(),
  mockSearchRules: vi.fn(),
}));

vi.mock('../src/service.ts', () => ({
  initialize: mockInitialize,
  getBootstrapStatus: mockGetBootstrapStatus,
  isReady: mockIsReady,
  refreshInitializationIfReady: mockRefreshInitializationIfReady,
  ask: mockAsk,
}));

vi.mock('../src/tools.ts', () => ({
  searchRules: mockSearchRules,
  searchCards: vi.fn(),
  listCardTypes: vi.fn(),
  listCards: vi.fn(),
  getCard: vi.fn(),
}));

import { app } from '../src/server.ts';
import { resetAuthProvider } from '../src/auth.ts';
import { shutdownServerPool } from '../src/db.ts';

const { auth, resetTestToken } = makeAuthHelpers(app);

beforeAll(async () => {
  await setupTestDb();
});

beforeEach(() => {
  mockIsReady.mockReturnValue(true);
  mockRefreshInitializationIfReady.mockResolvedValue(undefined);
  mockGetBootstrapStatus.mockResolvedValue(makeStatus());
});

afterAll(async () => {
  await teardownTestDb();
  // The src/db.ts server pool is independent of the helper's pool — close
  // it too so vitest doesn't keep open handles between files.
  await shutdownServerPool();
  resetAuthProvider();
});

// ─── OAuth metadata ──────────────────────────────────────────────────────────

describe('GET /.well-known/oauth-authorization-server', () => {
  it('returns valid OAuth metadata', async () => {
    const res = await app.request('http://localhost:3000/.well-known/oauth-authorization-server');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = await res.json();
    expect(body).toHaveProperty('issuer');
    expect(body).toHaveProperty('authorization_endpoint');
    expect(body).toHaveProperty('token_endpoint');
    expect(body).toHaveProperty('registration_endpoint');
    expect(body.response_types_supported).toContain('code');
    expect(body.grant_types_supported).toContain('authorization_code');
    expect(body.code_challenge_methods_supported).toContain('S256');
  });

  it('endpoints are absolute URLs', async () => {
    const res = await app.request('http://localhost:3000/.well-known/oauth-authorization-server');
    const body = await res.json();
    for (const field of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
      const val = body[field] as string;
      expect(val, `${field} should be absolute`).toMatch(/^https?:\/\//);
    }
  });
});

describe('GET /.well-known/oauth-protected-resource', () => {
  it('returns valid protected resource metadata', async () => {
    const res = await app.request('http://localhost:3000/.well-known/oauth-protected-resource');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('resource');
    expect(body).toHaveProperty('authorization_servers');
    expect(body.authorization_servers).toBeInstanceOf(Array);
    expect(body.authorization_servers.length).toBeGreaterThan(0);
    expect(body).toHaveProperty('resource_name', 'Squire');
  });
});

// ─── POST /register ──────────────────────────────────────────────────────────

describe('POST /register', () => {
  beforeEach(async () => {
    await resetTestDb();
    resetTestToken();
  });

  it('registers a client and returns client_id', async () => {
    const res = await app.request('http://localhost:3000/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({
        redirect_uris: ['http://localhost:8080/callback'],
        client_name: 'Test Client',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty('client_id');
    expect(typeof body.client_id).toBe('string');
    expect(body.client_id.length).toBeGreaterThan(0);
    expect(body).toHaveProperty('client_name', 'Test Client');
    expect(body).toHaveProperty('redirect_uris');
    expect(body).toHaveProperty('client_id_issued_at');
  });

  it('returns 400 for missing redirect_uris', async () => {
    const res = await app.request('http://localhost:3000/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ client_name: 'Bad Client' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON', async () => {
    const res = await app.request('http://localhost:3000/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('generates unique client_ids', async () => {
    const register = () =>
      app.request('http://localhost:3000/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redirect_uris: ['http://localhost:8080/callback'],
          client_name: 'Client',
          token_endpoint_auth_method: 'none',
        }),
      });

    const res1 = await register();
    const res2 = await register();
    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1.client_id).not.toBe(body2.client_id);
  });
});

// ─── GET /authorize ──────────────────────────────────────────────────────────

describe('GET /authorize', () => {
  beforeEach(async () => {
    await resetTestDb();
    resetTestToken();
  });

  async function registerTestClient(): Promise<string> {
    const res = await app.request('http://localhost:3000/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({
        redirect_uris: ['http://localhost:8080/callback'],
        client_name: 'Test Client',
        token_endpoint_auth_method: 'none',
      }),
    });
    const body = await res.json();
    return body.client_id as string;
  }

  it('redirects with auth code for valid request', async () => {
    const clientId = await registerTestClient();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'http://localhost:8080/callback',
      response_type: 'code',
      code_challenge: CODE_CHALLENGE,
      code_challenge_method: 'S256',
      state: 'test-state',
    });
    const res = await app.request(`http://localhost:3000/authorize?${params}`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toBeTruthy();
    const redirectUrl = new URL(location!);
    expect(redirectUrl.searchParams.get('code')).toBeTruthy();
    expect(redirectUrl.searchParams.get('state')).toBe('test-state');
  });

  it('returns 400 for unknown client_id', async () => {
    const params = new URLSearchParams({
      client_id: 'nonexistent',
      redirect_uri: 'http://localhost:8080/callback',
      response_type: 'code',
      code_challenge: 'test',
      code_challenge_method: 'S256',
    });
    const res = await app.request(`http://localhost:3000/authorize?${params}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for mismatched redirect_uri', async () => {
    const clientId = await registerTestClient();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'http://evil.com/callback',
      response_type: 'code',
      code_challenge: 'test',
      code_challenge_method: 'S256',
    });
    const res = await app.request(`http://localhost:3000/authorize?${params}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing code_challenge', async () => {
    const clientId = await registerTestClient();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'http://localhost:8080/callback',
      response_type: 'code',
    });
    const res = await app.request(`http://localhost:3000/authorize?${params}`);
    expect(res.status).toBe(400);
  });
});

// ─── POST /token ─────────────────────────────────────────────────────────────

describe('POST /token', () => {
  beforeEach(async () => {
    await resetTestDb();
    resetTestToken();
  });

  async function getAuthCode(): Promise<{ clientId: string; code: string }> {
    const regRes = await app.request('http://localhost:3000/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({
        redirect_uris: ['http://localhost:8080/callback'],
        client_name: 'Test',
        token_endpoint_auth_method: 'none',
      }),
    });
    const { client_id: clientId } = (await regRes.json()) as { client_id: string };

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'http://localhost:8080/callback',
      response_type: 'code',
      code_challenge: CODE_CHALLENGE,
      code_challenge_method: 'S256',
    });
    const authRes = await app.request(`http://localhost:3000/authorize?${params}`, {
      redirect: 'manual',
    });
    const location = authRes.headers.get('location')!;
    const code = new URL(location).searchParams.get('code')!;
    return { clientId, code };
  }

  it('exchanges auth code for access token', async () => {
    const { clientId, code } = await getAuthCode();
    const res = await app.request('http://localhost:3000/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        code_verifier: CODE_VERIFIER,
        redirect_uri: 'http://localhost:8080/callback',
      }).toString(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('access_token');
    expect(body).toHaveProperty('token_type', 'bearer');
    expect(body).toHaveProperty('expires_in');
  });

  it('rejects invalid code_verifier', async () => {
    const { clientId, code } = await getAuthCode();
    const res = await app.request('http://localhost:3000/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        code_verifier: 'wrong-verifier',
        redirect_uri: 'http://localhost:8080/callback',
      }).toString(),
    });
    expect(res.status).toBe(400);
  });

  it('rejects reused auth code', async () => {
    const { clientId, code } = await getAuthCode();
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      code_verifier: CODE_VERIFIER,
      redirect_uri: 'http://localhost:8080/callback',
    }).toString();

    const res1 = await app.request('http://localhost:3000/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody,
    });
    expect(res1.status).toBe(200);

    const res2 = await app.request('http://localhost:3000/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody,
    });
    expect(res2.status).toBe(400);
  });

  it('rejects unknown grant_type', async () => {
    const res = await app.request('http://localhost:3000/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'password' }).toString(),
    });
    expect(res.status).toBe(400);
  });
});

// ─── Bearer auth middleware ──────────────────────────────────────────────────

describe('bearer auth middleware', () => {
  beforeEach(async () => {
    await resetTestDb();
    resetTestToken();
  });

  async function getAccessToken(): Promise<string> {
    const regRes = await app.request('http://localhost:3000/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({
        redirect_uris: ['http://localhost:8080/callback'],
        token_endpoint_auth_method: 'none',
      }),
    });
    const { client_id: clientId } = (await regRes.json()) as { client_id: string };

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'http://localhost:8080/callback',
      response_type: 'code',
      code_challenge: CODE_CHALLENGE,
      code_challenge_method: 'S256',
    });
    const authRes = await app.request(`http://localhost:3000/authorize?${params}`, {
      redirect: 'manual',
    });
    const code = new URL(authRes.headers.get('location')!).searchParams.get('code')!;

    const tokenRes = await app.request('http://localhost:3000/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        code_verifier: CODE_VERIFIER,
        redirect_uri: 'http://localhost:8080/callback',
      }).toString(),
    });
    const { access_token } = (await tokenRes.json()) as { access_token: string };
    return access_token;
  }

  it('rejects unauthenticated requests to /api/search/rules', async () => {
    const res = await app.request('http://localhost:3000/api/search/rules?q=loot');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
  });

  it('allows authenticated requests to /api/search/rules', async () => {
    mockSearchRules.mockResolvedValue([]);
    const token = await getAccessToken();
    const res = await app.request('http://localhost:3000/api/search/rules?q=loot', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('rejects invalid tokens', async () => {
    const res = await app.request('http://localhost:3000/api/search/rules?q=loot', {
      headers: { Authorization: 'Bearer invalid-token' },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('invalid_token');
  });

  it('allows unauthenticated access to /api/health', async () => {
    const res = await app.request('http://localhost:3000/api/health');
    expect(res.status).toBe(200);
  });

  it('allows unauthenticated access to OAuth endpoints', async () => {
    const res = await app.request('http://localhost:3000/.well-known/oauth-authorization-server');
    expect(res.status).toBe(200);
  });

  it('rejects unauthenticated requests to /mcp', async () => {
    const res = await app.request('http://localhost:3000/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
    });
    expect(res.status).toBe(401);
  });
});
