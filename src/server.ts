/**
 * Squire HTTP server.
 * Hono-based API with health check and service initialization.
 */

import 'dotenv/config';
// MUST be the first application import — PgInstrumentation has to patch `pg`
// before service.ts transitively loads db.ts, otherwise Postgres spans never
// reach Langfuse in production. Same pattern as query.ts and eval/run.ts.
import './instrumentation.ts';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { isReady, initialize, ask } from './service.ts';
import { sql } from 'drizzle-orm';

import { getDb } from './db.ts';
import { searchRules, searchCards, listCardTypes, listCards, getCard } from './tools.ts';
import type { CardType } from './schemas.ts';
import { z } from 'zod';
import { createMcpServer } from './mcp.ts';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  registerClient,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  verifyAccessToken,
  OAuthError,
} from './auth.ts';

export const app = new Hono();

// ─── OAuth metadata ──────────────────────────────────────────────────────────

function getBaseUrl(): string {
  const env = process.env.SQUIRE_BASE_URL;
  if (env && env.length > 0) return env.replace(/\/+$/, '');
  return 'http://localhost:3000';
}

app.get('/.well-known/oauth-authorization-server', (c) => {
  const base = getBaseUrl();
  return c.json({
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    response_types_supported: ['code'],
    // Squire deliberately does not support refresh_token rotation — access
    // tokens are long-lived (30 days) as a DX choice for MCP/API clients.
    // See SECURITY.md §2 and `SquireOAuthProvider.exchangeRefreshToken`
    // (throws UnsupportedGrantTypeError). Advertising only what the
    // provider actually honors keeps the discovery metadata truthful.
    grant_types_supported: ['authorization_code'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['squire:read', 'squire:write'],
  });
});

app.get('/.well-known/oauth-protected-resource', (c) => {
  const base = getBaseUrl();
  return c.json({
    resource: base,
    authorization_servers: [base],
    resource_name: 'Squire',
    bearer_methods_supported: ['header'],
    scopes_supported: ['squire:read', 'squire:write'],
  });
});

// ─── Client registration ─────────────────────────────────────────────────────

app.post('/register', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(oauthError('invalid_request', 'Invalid JSON body'), 400);
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return c.json(oauthError('invalid_request', 'Request body must be a JSON object'), 400);
  }

  try {
    const client = await registerClient(body as Record<string, unknown>);
    return c.json(client, 201);
  } catch (err) {
    return oauthErrorResponse(c, err, 'Registration failed');
  }
});

// ─── Authorization endpoint ──────────────────────────────────────────────────

app.get('/authorize', async (c) => {
  const clientId = c.req.query('client_id');
  const redirectUri = c.req.query('redirect_uri');
  const responseType = c.req.query('response_type');
  const codeChallenge = c.req.query('code_challenge');
  const codeChallengeMethod = c.req.query('code_challenge_method');
  const state = c.req.query('state');

  if (!clientId || !redirectUri || responseType !== 'code') {
    return c.json(oauthError('invalid_request', 'Missing or invalid required parameters'), 400);
  }
  if (!codeChallenge || codeChallengeMethod !== 'S256') {
    return c.json(
      oauthError('invalid_request', 'PKCE code_challenge with S256 method is required'),
      400,
    );
  }

  try {
    const authCode = await createAuthorizationCode(clientId, redirectUri, codeChallenge, state);
    const redirect = new URL(redirectUri);
    redirect.searchParams.set('code', authCode.code);
    if (state) redirect.searchParams.set('state', state);
    return c.redirect(redirect.toString(), 302);
  } catch (err) {
    return oauthErrorResponse(c, err, 'Authorization failed');
  }
});

// ─── Token endpoint ──────────────────────────────────────────────────────────

app.post('/token', async (c) => {
  const contentType = c.req.header('content-type') || '';
  let params: URLSearchParams;

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const body = await c.req.text();
    params = new URLSearchParams(body);
  } else if (contentType.includes('application/json')) {
    const body = (await c.req.json()) as Record<string, string>;
    params = new URLSearchParams(body);
  } else {
    return c.json(oauthError('invalid_request', 'Unsupported content type'), 400);
  }

  const grantType = params.get('grant_type');

  if (grantType === 'authorization_code') {
    const code = params.get('code');
    const clientId = params.get('client_id');
    const codeVerifier = params.get('code_verifier');
    const redirectUri = params.get('redirect_uri');

    if (!code || !clientId || !codeVerifier || !redirectUri) {
      return c.json(oauthError('invalid_request', 'Missing required parameters'), 400);
    }

    try {
      const tokenResponse = await exchangeAuthorizationCode(
        code,
        clientId,
        codeVerifier,
        redirectUri,
      );
      return c.json(tokenResponse);
    } catch (err) {
      return oauthErrorResponse(c, err, 'Token exchange failed');
    }
  }

  return c.json(oauthError('unsupported_grant_type', `Unsupported grant_type: ${grantType}`), 400);
});

// ─── Bearer auth middleware ──────────────────────────────────────────────────

function requireBearerAuth() {
  return async (c: Parameters<Parameters<typeof app.use>[1]>[0], next: () => Promise<void>) => {
    const authHeader = c.req.header('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      c.header('WWW-Authenticate', 'Bearer');
      return c.json(jsonError('Authentication required', 401), 401);
    }

    const token = authHeader.slice(7);
    const valid = await verifyAccessToken(token);
    if (!valid) {
      c.header('WWW-Authenticate', 'Bearer error="invalid_token"');
      return c.json(jsonError('Invalid or expired token', 401), 401);
    }

    await next();
  };
}

// Protect API endpoints (except health) and MCP
app.use('/api/search/*', requireBearerAuth());
app.use('/api/cards/*', requireBearerAuth());
app.use('/api/cards', requireBearerAuth());
app.use('/api/card-types', requireBearerAuth());
app.use('/api/ask', requireBearerAuth());
app.use('/mcp', requireBearerAuth());

// ─── MCP transport ───────────────────────────────────────────────────────────

app.all('/mcp', async (c) => {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless mode — auth added later
  });
  const server = createMcpServer();
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

// ─── Error handling ──────────────────────────────────────────────────────────

function jsonError(message: string, status: number) {
  return { error: message, status };
}

/**
 * Build an RFC 6749 §5.2 error body. OAuth endpoints return this shape
 * (`error`, `error_description`) instead of the generic `{error, status}`
 * envelope used elsewhere on the API. Keeping the two helpers separate makes
 * it obvious at the call site which contract a route is honoring.
 */
function oauthError(
  error: string,
  errorDescription?: string,
): { error: string; error_description?: string } {
  return errorDescription === undefined
    ? { error }
    : { error: error, error_description: errorDescription };
}

/**
 * Translate an exception into an OAuth 2.0 error JSON response. SDK
 * `OAuthError`s carry their own `errorCode` and serialize via
 * `toResponseObject()`. Anything else gets coerced to `invalid_request` with
 * the supplied fallback description so internal stack messages don't leak.
 */
function oauthErrorResponse(c: Context, err: unknown, fallbackDescription: string) {
  if (err instanceof OAuthError) {
    return c.json(err.toResponseObject(), 400);
  }
  return c.json(oauthError('invalid_request', fallbackDescription), 400);
}

app.notFound((c) => {
  return c.json(jsonError('Not found', 404), 404);
});

app.onError((err, c) => {
  console.error('Unhandled error:', err instanceof Error ? err.message : err);
  return c.json(jsonError('Internal server error', 500), 500);
});

// ─── Health endpoint ─────────────────────────────────────────────────────────

app.get('/api/health', async (c) => {
  let indexSize = 0;
  try {
    const { db } = getDb('server');
    const result = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count FROM embeddings`,
    );
    indexSize = Number(result.rows[0]?.count ?? 0);
  } catch {
    // Health endpoint stays best-effort — if the DB is down, report ready:false
    // via isReady() and leave index_size at 0 rather than 500ing.
  }
  return c.json({
    ready: isReady(),
    index_size: indexSize,
  });
});

// ─── Search endpoints ────────────────────────────────────────────────────────

function parseTopK(raw: string | undefined): number {
  if (!raw) return 6;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100) return 6;
  return n;
}

app.get('/api/search/rules', async (c) => {
  const q = c.req.query('q');
  if (!q) return c.json(jsonError('Missing required query parameter: q', 400), 400);

  const topK = parseTopK(c.req.query('topK'));
  const results = await searchRules(q, topK);
  return c.json({ results });
});

app.get('/api/search/cards', async (c) => {
  const q = c.req.query('q');
  if (!q) return c.json(jsonError('Missing required query parameter: q', 400), 400);

  const topK = parseTopK(c.req.query('topK'));
  const results = await searchCards(q, topK);
  return c.json({ results });
});

// ─── Card discovery and lookup endpoints ─────────────────────────────────────

app.get('/api/card-types', async (c) => {
  const types = await listCardTypes();
  return c.json({ types });
});

app.get('/api/cards/:type/:id', async (c) => {
  const type = c.req.param('type') as CardType;
  const id = decodeURIComponent(c.req.param('id'));
  const card = await getCard(type, id);
  if (!card) return c.json(jsonError('Card not found', 404), 404);
  return c.json({ card });
});

app.get('/api/cards', async (c) => {
  const type = c.req.query('type');
  if (!type) return c.json(jsonError('Missing required query parameter: type', 400), 400);

  const filterRaw = c.req.query('filter');
  let filter: Record<string, unknown> | undefined;
  if (filterRaw) {
    try {
      const parsed = JSON.parse(filterRaw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return c.json(jsonError('Filter must be a JSON object', 400), 400);
      }
      filter = parsed as Record<string, unknown>;
    } catch {
      return c.json(jsonError('Invalid filter JSON', 400), 400);
    }
  }

  const cards = await listCards(type as CardType, filter);
  return c.json({ cards });
});

// ─── Ask endpoint ────────────────────────────────────────────────────────────

const AskRequestSchema = z.object({
  question: z.string().min(1),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      }),
    )
    .max(20)
    .optional(),
  campaignId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
});

app.post('/api/ask', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(jsonError('Invalid JSON body', 400), 400);
  }

  const result = AskRequestSchema.safeParse(body);
  if (!result.success) {
    return c.json(jsonError('Invalid request: ' + result.error.issues[0].message, 400), 400);
  }

  const { question, ...options } = result.data;
  return streamSSE(c, async (stream) => {
    try {
      await ask(question, {
        ...options,
        emit: async (event, data) => {
          await stream.writeSSE({ event, data: JSON.stringify(data) });
        },
      });
    } catch {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ message: 'Internal server error' }),
      });
    }
  });
});

// ─── Server startup ──────────────────────────────────────────────────────────

export async function startServer(): Promise<void> {
  await initialize();

  const parsed = parseInt(process.env.PORT || '3000', 10);
  const port = Number.isNaN(parsed) ? 3000 : parsed;
  const { serve } = await import('@hono/node-server');
  serve({ fetch: app.fetch, port });
  console.log(`Squire server listening on port ${port}`);
}

// CLI entrypoint
if (process.argv[1]?.endsWith('server.ts')) {
  startServer().catch((err: unknown) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
