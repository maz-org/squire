import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockInitialize,
  mockIsReady,
  mockAsk,
  mockSearchRules,
  mockSearchCards,
  mockListCardTypes,
  mockListCards,
  mockGetCard,
} = vi.hoisted(() => ({
  mockInitialize: vi.fn(),
  mockIsReady: vi.fn(),
  mockAsk: vi.fn(),
  mockSearchRules: vi.fn(),
  mockSearchCards: vi.fn(),
  mockListCardTypes: vi.fn(),
  mockListCards: vi.fn(),
  mockGetCard: vi.fn(),
}));

vi.mock('../src/service.ts', () => ({
  initialize: mockInitialize,
  isReady: mockIsReady,
  ask: mockAsk,
}));

vi.mock('../src/vector-store.ts', () => ({
  loadIndex: vi.fn(() => [{ id: '1' }, { id: '2' }, { id: '3' }]),
}));

vi.mock('../src/tools.ts', () => ({
  searchRules: mockSearchRules,
  searchCards: mockSearchCards,
  listCardTypes: mockListCardTypes,
  listCards: mockListCards,
  getCard: mockGetCard,
}));

import { app } from '../src/server.ts';
import { _resetClientsForTesting } from '../src/auth.ts';

// ─── Test auth helper ────────────────────────────────────────────────────────

const CODE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CODE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

async function getTestToken(): Promise<string> {
  const regRes = await app.request('http://localhost:3000/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

let testToken: string | null = null;

/** Get or create a valid access token for tests. Reset if clients were cleared. */
async function auth(): Promise<Record<string, string>> {
  if (!testToken) testToken = await getTestToken();
  return { Authorization: `Bearer ${testToken}` };
}

/** Reset auth state — call after _resetClientsForTesting(). */
function resetTestToken(): void {
  testToken = null;
}

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with ready status', async () => {
    mockIsReady.mockReturnValue(true);
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('ready', true);
    expect(body).toHaveProperty('index_size');
    expect(typeof body.index_size).toBe('number');
  });

  it('returns ready=false when service is not initialized', async () => {
    mockIsReady.mockReturnValue(false);
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ready).toBe(false);
  });

  it('includes index_size in response', async () => {
    mockIsReady.mockReturnValue(true);
    const res = await app.request('/api/health');
    const body = await res.json();
    expect(body.index_size).toBe(3);
  });

  it('returns JSON content type', async () => {
    mockIsReady.mockReturnValue(true);
    const res = await app.request('/api/health');
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});

// ─── GET /api/search/rules ───────────────────────────────────────────────────

describe('GET /api/search/rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchRules.mockResolvedValue([
      { text: 'Loot: pick up all loot tokens.', source: 'rulebook.pdf:42', score: 0.9 },
    ]);
  });

  it('returns search results', async () => {
    const res = await app.request('/api/search/rules?q=loot+action', { headers: await auth() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toHaveProperty('text');
    expect(body.results[0]).toHaveProperty('source');
    expect(body.results[0]).toHaveProperty('score');
  });

  it('passes query and topK to searchRules', async () => {
    await app.request('/api/search/rules?q=loot&topK=3', { headers: await auth() });
    expect(mockSearchRules).toHaveBeenCalledWith('loot', 3);
  });

  it('defaults topK to 6', async () => {
    await app.request('/api/search/rules?q=loot', { headers: await auth() });
    expect(mockSearchRules).toHaveBeenCalledWith('loot', 6);
  });

  it('returns 400 when q is missing', async () => {
    const res = await app.request('/api/search/rules', { headers: await auth() });
    expect(res.status).toBe(400);
  });

  it('returns 400 when q is empty', async () => {
    const res = await app.request('/api/search/rules?q=', { headers: await auth() });
    expect(res.status).toBe(400);
  });

  it('defaults topK when given invalid value', async () => {
    await app.request('/api/search/rules?q=loot&topK=abc', { headers: await auth() });
    expect(mockSearchRules).toHaveBeenCalledWith('loot', 6);
  });
});

// ─── GET /api/search/cards ───────────────────────────────────────────────────

describe('GET /api/search/cards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchCards.mockReturnValue([
      { type: 'monster-stats', data: { name: 'Algox Archer' }, score: 2 },
    ]);
  });

  it('returns search results', async () => {
    const res = await app.request('/api/search/cards?q=algox+archer', { headers: await auth() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toHaveProperty('type');
    expect(body.results[0]).toHaveProperty('data');
    expect(body.results[0]).toHaveProperty('score');
  });

  it('passes query and topK to searchCards', async () => {
    await app.request('/api/search/cards?q=algox&topK=4', { headers: await auth() });
    expect(mockSearchCards).toHaveBeenCalledWith('algox', 4);
  });

  it('defaults topK to 6', async () => {
    await app.request('/api/search/cards?q=algox', { headers: await auth() });
    expect(mockSearchCards).toHaveBeenCalledWith('algox', 6);
  });

  it('returns 400 when q is missing', async () => {
    const res = await app.request('/api/search/cards', { headers: await auth() });
    expect(res.status).toBe(400);
  });

  it('returns 400 when q is empty', async () => {
    const res = await app.request('/api/search/cards?q=', { headers: await auth() });
    expect(res.status).toBe(400);
  });

  it('defaults topK when given invalid value', async () => {
    await app.request('/api/search/cards?q=algox&topK=abc', { headers: await auth() });
    expect(mockSearchCards).toHaveBeenCalledWith('algox', 6);
  });
});

// ─── GET /api/card-types ─────────────────────────────────────────────────────

describe('GET /api/card-types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListCardTypes.mockReturnValue([
      { type: 'monster-stats', count: 10 },
      { type: 'items', count: 5 },
    ]);
  });

  it('returns all card types', async () => {
    const res = await app.request('/api/card-types', { headers: await auth() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.types).toHaveLength(2);
    expect(body.types[0]).toHaveProperty('type');
    expect(body.types[0]).toHaveProperty('count');
  });
});

// ─── GET /api/cards ──────────────────────────────────────────────────────────

describe('GET /api/cards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListCards.mockReturnValue([{ name: 'Algox Archer' }]);
  });

  it('returns cards of a given type', async () => {
    const res = await app.request('/api/cards?type=monster-stats', { headers: await auth() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cards).toHaveLength(1);
    expect(mockListCards).toHaveBeenCalledWith('monster-stats', undefined);
  });

  it('returns 400 when type is missing', async () => {
    const res = await app.request('/api/cards', { headers: await auth() });
    expect(res.status).toBe(400);
  });

  it('passes filter as parsed JSON', async () => {
    const filter = encodeURIComponent(JSON.stringify({ name: 'Algox Archer' }));
    await app.request(`/api/cards?type=monster-stats&filter=${filter}`, { headers: await auth() });
    expect(mockListCards).toHaveBeenCalledWith('monster-stats', { name: 'Algox Archer' });
  });

  it('returns 400 for invalid filter JSON', async () => {
    const res = await app.request('/api/cards?type=monster-stats&filter=not-json', {
      headers: await auth(),
    });
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/cards/:type/:id ────────────────────────────────────────────────

describe('GET /api/cards/:type/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCard.mockReturnValue({ name: 'Algox Archer', levelRange: '0-3' });
  });

  it('returns a card by type and id', async () => {
    const res = await app.request('/api/cards/monster-stats/Algox%20Archer', {
      headers: await auth(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.card).toHaveProperty('name', 'Algox Archer');
    expect(mockGetCard).toHaveBeenCalledWith('monster-stats', 'Algox Archer');
  });

  it('returns 404 when card is not found', async () => {
    mockGetCard.mockReturnValue(null);
    const res = await app.request('/api/cards/monster-stats/Nonexistent', {
      headers: await auth(),
    });
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/ask ───────────────────────────────────────────────────────────

describe('POST /api/ask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAsk.mockResolvedValue('Loot tokens are picked up in your hex.');
  });

  it('returns an answer for a valid question', async () => {
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ question: 'What is the loot action?' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('answer', 'Loot tokens are picked up in your hex.');
  });

  it('calls service.ask with the question', async () => {
    await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ question: 'What is the loot action?' }),
    });
    expect(mockAsk).toHaveBeenCalledWith('What is the loot action?', undefined);
  });

  it('returns 400 when question is missing', async () => {
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when question is empty', async () => {
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ question: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON body', async () => {
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('passes history to ask()', async () => {
    const history = [
      { role: 'user', content: 'What is loot?' },
      { role: 'assistant', content: 'Loot tokens are picked up.' },
    ];
    await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ question: 'What about traps?', history }),
    });
    expect(mockAsk).toHaveBeenCalledWith('What about traps?', history);
  });

  it('works without history (backward compatible)', async () => {
    await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ question: 'What is loot?' }),
    });
    expect(mockAsk).toHaveBeenCalledWith('What is loot?', undefined);
  });

  it('returns 400 for invalid history role', async () => {
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({
        question: 'test',
        history: [{ role: 'system', content: 'hi' }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when history is not an array', async () => {
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ question: 'test', history: 'not-array' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when history item missing content', async () => {
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({
        question: 'test',
        history: [{ role: 'user' }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 500 when ask() throws', async () => {
    mockAsk.mockRejectedValue(new Error('Claude API error'));
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ question: 'test' }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error', 'Internal server error');
    expect(body).toHaveProperty('status', 500);
  });
});

// ─── Error handling ──────────────────────────────────────────────────────────

describe('error handling', () => {
  it('returns structured 404 for unknown paths', async () => {
    const res = await app.request('/api/nonexistent');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('status', 404);
  });

  it('returns structured error for unhandled exceptions', async () => {
    mockSearchRules.mockRejectedValue(new Error('Unexpected failure'));
    const res = await app.request('/api/search/rules?q=test', { headers: await auth() });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('status', 500);
  });

  it('all error responses have consistent shape', async () => {
    // 400 case
    const res400 = await app.request('/api/search/rules', { headers: await auth() });
    expect(res400.status).toBe(400);
    const body400 = await res400.json();
    expect(body400).toHaveProperty('error');
    expect(body400).toHaveProperty('status', 400);
  });
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
  beforeEach(() => {
    _resetClientsForTesting();
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
  beforeEach(() => {
    _resetClientsForTesting();
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
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
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
  beforeEach(() => {
    _resetClientsForTesting();
    resetTestToken();
  });

  // PKCE: code_verifier → SHA256 → base64url = code_challenge
  // Known pair from RFC 7636 Appendix B
  const CODE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const CODE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

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
  beforeEach(() => {
    _resetClientsForTesting();
    resetTestToken();
  });

  const CODE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const CODE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

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
