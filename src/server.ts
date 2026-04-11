/**
 * Squire HTTP server.
 * Hono-based API with health check and service initialization.
 */

import 'dotenv/config';
// MUST be the first application import — PgInstrumentation has to patch `pg`
// before service.ts transitively loads db.ts, otherwise Postgres spans never
// reach Langfuse in production. Same pattern as query.ts and eval/run.ts.
import './instrumentation.ts';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { html } from 'hono/html';
import { streamSSE } from 'hono/streaming';
import {
  ask,
  ensureBootstrapStatus,
  getBootstrapStatus,
  isReady,
  startBootstrapLifecycle,
} from './service.ts';

import { getDb, getWorktreeRuntime } from './db.ts';
import { claimWorktreePort } from './worktree-runtime.ts';
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
import {
  generateState,
  generateCodeVerifier,
  computeCodeChallenge,
  buildGoogleAuthUrl,
  handleGoogleCallback,
  GoogleAuthError,
  resolveGoogleRedirectUri,
} from './auth/google.ts';
import { getSessionSecret } from './auth/session-middleware.ts';
import * as SessionRepository from './db/repositories/session-repository.ts';
import { writeAuditEvent } from './auth/audit.ts';
import {
  optionalSession,
  requirePageSession,
  requireSession,
  setSessionCookie,
  clearSessionCookie,
} from './auth/session-middleware.ts';
import { createCsrfToken, requireCsrf } from './auth/csrf.ts';
import { setSignedCookie, getSignedCookie, deleteCookie } from 'hono/cookie';
import {
  layoutShell,
  renderConversationTranscript,
  renderConversationTranscriptWithPendingTurn,
  renderConversationPage,
  renderConversationTranscriptWithRecentQuestions,
  renderHomePage,
  renderLoginPage,
  renderNotInvitedPage,
  renderPendingTurnShell,
  renderRecentQuestionsNav,
} from './web-ui/layout.ts';
import { renderAssistantContentHtml } from './web-ui/assistant-content.ts';
import { getAppCss, getHtmxJs, getSquireJs } from './web-ui/assets.ts';
import {
  appendMessage,
  createPendingConversation,
  createPendingFollowUp,
  GENERIC_FAILURE_MESSAGE,
  loadConversation,
  loadConversationMessage,
  loadSelectedConversation,
  startConversation,
  streamAssistantTurn,
} from './chat/conversation-service.ts';

export const app = new Hono();

const HTML_CSP =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' https://fonts.googleapis.com; " +
  "img-src 'self' data:; " +
  "connect-src 'self'; " +
  "font-src 'self' https://fonts.gstatic.com; " +
  "object-src 'none'; " +
  "base-uri 'none'; " +
  "frame-ancestors 'none'; " +
  "form-action 'self'";

const cspMiddleware: MiddlewareHandler = async (c, next) => {
  await next();
  const contentType = c.res.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) {
    c.res.headers.set('content-security-policy', HTML_CSP);
  }
};

app.use('*', cspMiddleware);

// ─── Web UI: on-demand asset pipeline (SQR-71, ADR 0011) ─────────────────────
//
// Replaces the prebuilt-static-file pipeline from ADR 0008 with
// Rails Propshaft semantics: dev serves bare paths with no-cache so
// edits to styles.css and squire.js show up immediately in devtools,
// prod serves content-hashed paths (`/app.<hash>.css`,
// `/squire.<hash>.js`) with immutable caching so Cloudflare and
// browsers can cache forever and invalidation is automatic on
// content change. Hash is enforced by the router regex
// (`[a-f0-9]+`) so non-hex paths 404 before the handler runs; a
// prod hash mismatch (stale HTML after deploy) also 404s and the
// browser reloads HTML on next navigation.
//
// Both route patterns are registered unconditionally; the handlers
// branch on NODE_ENV at request time so tests can stub env without
// re-importing the server module. See ADR 0011 fingerprinting
// addendum for the full rationale.

const PROD_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const DEV_ASSET_CACHE_CONTROL = 'no-cache';

function isProdEnv(): boolean {
  return process.env.NODE_ENV === 'production';
}

// Dev-only bare CSS path. In prod the HTML references the hashed
// URL, so the bare path 404s there.
app.get('/app.css', async (c) => {
  if (isProdEnv()) return c.notFound();
  const { content } = await getAppCss();
  c.header('content-type', 'text/css; charset=utf-8');
  c.header('cache-control', DEV_ASSET_CACHE_CONTROL);
  return c.body(content);
});

// Prod-only hashed CSS path. The regex matches the full filename
// (`app.<hex>.css`) as a single param because Hono's router doesn't
// support `:param{regex}.literal` patterns — it either 404s silently
// (single-segment) or throws (multi-segment) — but full-filename
// constraints work fine. Router rejects non-hex at the match layer;
// the handler then checks the filename matches the current compile
// exactly and 404s on mismatch.
//
// Trade-off: the handler calls getAppCss() *before* comparing the
// hash, so an unauthenticated 404 probe on a cold process pays one
// Tailwind compile (~38 ms) before getting its 404. One-time cost
// per process lifetime, not amplifiable — accepted. See ADR 0011
// fingerprinting addendum, "What this does not solve".
app.get('/:file{app\\.[a-f0-9]+\\.css}', async (c) => {
  if (!isProdEnv()) return c.notFound();
  const { content, hash } = await getAppCss();
  if (c.req.param('file') !== `app.${hash}.css`) return c.notFound();
  c.header('content-type', 'text/css; charset=utf-8');
  c.header('cache-control', PROD_ASSET_CACHE_CONTROL);
  return c.body(content);
});

// Dev-only bare JS path.
app.get('/squire.js', async (c) => {
  if (isProdEnv()) return c.notFound();
  const { content } = await getSquireJs();
  c.header('content-type', 'text/javascript; charset=utf-8');
  c.header('cache-control', DEV_ASSET_CACHE_CONTROL);
  return c.body(content);
});

app.get('/htmx.js', async (c) => {
  if (isProdEnv()) return c.notFound();
  const { content } = await getHtmxJs();
  c.header('content-type', 'text/javascript; charset=utf-8');
  c.header('cache-control', DEV_ASSET_CACHE_CONTROL);
  return c.body(content);
});

// Prod-only hashed JS path. Same full-filename-as-param pattern as
// the CSS handler for the same Hono router reason.
app.get('/:file{squire\\.[a-f0-9]+\\.js}', async (c) => {
  if (!isProdEnv()) return c.notFound();
  const { content, hash } = await getSquireJs();
  if (c.req.param('file') !== `squire.${hash}.js`) return c.notFound();
  c.header('content-type', 'text/javascript; charset=utf-8');
  c.header('cache-control', PROD_ASSET_CACHE_CONTROL);
  return c.body(content);
});

app.get('/:file{htmx\\.[a-f0-9]+\\.js}', async (c) => {
  if (!isProdEnv()) return c.notFound();
  const { content, hash } = await getHtmxJs();
  if (c.req.param('file') !== `htmx.${hash}.js`) return c.notFound();
  c.header('content-type', 'text/javascript; charset=utf-8');
  c.header('cache-control', PROD_ASSET_CACHE_CONTROL);
  return c.body(content);
});

// ─── Web UI: companion-first layout shell (SQR-65) ───────────────────────────
//
// GET / renders the authenticated app shell and redirects unauthenticated
// browsers to /login. The handler still wraps the renderer in a try/catch so
// a thrown error (db down, agent down, future content slot throwing during
// render) yields a fully formed HTML page with an inline error banner instead
// of a bare 500 page. See DESIGN.md decisions log "`.squire-banner` is a
// reusable primitive."
app.get('/', requirePageSession(), async (c) => {
  // `renderHomePage()` and `layoutShell()` both return
  // `Promise<HtmlEscapedString>` (tightened from a union in SQR-71
  // when layout.ts went async to await the asset URL helpers).
  // Without `await`, a rejected promise from either function would
  // bypass this try/catch and bubble up to `app.onError` as a JSON
  // 500 — losing the styled HTML fallback that the SQR-65 ticket
  // required. Awaiting both ensures the catch branch always renders
  // the layout shell.
  //
  // Known gap (accepted, SQR-71 eng review): if the ORIGINAL error
  // was an asset-compile failure in prod (unreadable styles.css,
  // broken @tailwindcss/node upgrade), the fallback re-invokes
  // `layoutShell` which re-invokes `getAppCssUrl` → `getAppCss` →
  // throws again, bypassing this catch. The styled fallback is
  // lost in that specific case and the user gets the bare
  // `app.onError` JSON 500. We accept this because a prod deploy
  // with an unreadable styles.css is already broken end-to-end —
  // CSS is load-bearing, no error banner saves a page with no
  // styles. Dev is unaffected because `getAppCssUrl` in dev
  // returns a constant string without I/O. See ADR 0011
  // fingerprinting addendum, "What this does not solve".
  try {
    const session = c.get('session')!;
    c.header('Cache-Control', 'no-store');
    c.header('Vary', 'Cookie');
    return c.html(await renderHomePage(session, createCsrfToken(session.id)));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const session = c.get('session');
    if (session) {
      c.header('Cache-Control', 'no-store');
      c.header('Vary', 'Cookie');
    }
    return c.html(
      await layoutShell({
        errorBanner: { message },
        session,
        csrfToken: session ? createCsrfToken(session.id) : undefined,
      }),
      500,
    );
  }
});

// ─── OAuth metadata ──────────────────────────────────────────────────────────

function getBaseUrl(): string {
  const env = process.env.SQUIRE_BASE_URL;
  if (env && env.length > 0) return env.replace(/\/+$/, '');
  return 'http://localhost:3000';
}

function loginRedirectWithError(message: string): string {
  return `/login?${new URLSearchParams({ error: message }).toString()}`;
}

app.get('/login', optionalSession(), async (c) => {
  c.header('Cache-Control', 'no-store');
  c.header('Vary', 'Cookie');
  if (c.get('session')) return c.redirect('/');
  return c.html(await renderLoginPage({ errorMessage: c.req.query('error') }));
});

app.get('/not-invited', async (c) => c.html(await renderNotInvitedPage(), 403));

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
    return oauthErrorResponse(c, err);
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
    return oauthErrorResponse(c, err);
  }
});

// ─── Token endpoint ──────────────────────────────────────────────────────────

app.post('/token', async (c) => {
  const contentType = c.req.header('content-type') || '';
  let params: URLSearchParams;

  try {
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const body = await c.req.text();
      params = new URLSearchParams(body);
    } else if (contentType.includes('application/json')) {
      const body = (await c.req.json()) as Record<string, string>;
      params = new URLSearchParams(body);
    } else {
      return c.json(oauthError('invalid_request', 'Unsupported content type'), 400);
    }
  } catch {
    // Malformed JSON / unreadable body — surface as OAuth invalid_request
    // rather than letting it fall through to the generic 500 handler.
    return c.json(oauthError('invalid_request', 'Malformed request body'), 400);
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
      return oauthErrorResponse(c, err);
    }
  }

  return c.json(oauthError('unsupported_grant_type', `Unsupported grant_type: ${grantType}`), 400);
});

// ─── Google OAuth web login (SQR-38) ────────────────────────────────────────
//
// Squire acts as an OAuth CLIENT here (redirecting to Google). This is separate
// from the OAuth SERVER above (which serves MCP/API clients). The two auth
// systems use different transports (cookies vs bearer tokens) and are
// deliberately isolated.

const PKCE_COOKIE_NAME = 'squire_oauth_pkce';

app.get('/auth/google/start', async (c) => {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = computeCodeChallenge(codeVerifier);

  // Store state + code_verifier in a short-lived signed cookie (5-min expiry)
  const secret = getSessionSecret();
  const pkceData = JSON.stringify({ state, codeVerifier });
  await setSignedCookie(c, PKCE_COOKIE_NAME, pkceData, secret, {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax', // Lax so the cookie survives the Google redirect back
    maxAge: 300, // 5 minutes
  });

  const url = buildGoogleAuthUrl(state, codeChallenge, resolveGoogleRedirectUri(c.req.url));
  return c.redirect(url);
});

app.get('/auth/google/callback', async (c) => {
  // Check for error from Google (e.g., user clicked Cancel)
  const error = c.req.query('error');
  if (error) {
    deleteCookie(c, PKCE_COOKIE_NAME, { path: '/' });
    return c.redirect(loginRedirectWithError('Google sign-in was cancelled or failed.'), 302);
  }

  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) {
    deleteCookie(c, PKCE_COOKIE_NAME, { path: '/' });
    return c.redirect(loginRedirectWithError('Missing code or state parameter.'), 302);
  }

  // Read and consume the PKCE cookie
  const secret = getSessionSecret();
  const pkceCookieRaw = await getSignedCookie(c, secret, PKCE_COOKIE_NAME);
  let cookieState: string | undefined;
  let cookieVerifier: string | undefined;
  if (pkceCookieRaw) {
    try {
      const parsed = JSON.parse(pkceCookieRaw);
      cookieState = parsed.state;
      cookieVerifier = parsed.codeVerifier;
    } catch {
      // Malformed cookie, will fail state check below
    }
  }

  // Clean up PKCE cookie on all paths (success and error). It served its
  // purpose once the callback is reached; leaving it around is untidy.
  deleteCookie(c, PKCE_COOKIE_NAME, { path: '/' });

  try {
    const result = await handleGoogleCallback(
      code,
      state,
      cookieState,
      cookieVerifier,
      c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip'),
      c.req.header('user-agent'),
      resolveGoogleRedirectUri(c.req.url),
    );

    await setSessionCookie(c, result.sessionId);
    return c.redirect('/');
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      if (err.code === 'not_allowed') {
        return c.redirect('/not-invited', 302);
      }
      return c.redirect(loginRedirectWithError(err.message), 302);
    }
    // Log unexpected errors for debugging
    console.error('[auth/google/callback] unexpected error:', err);
    throw err;
  }
});

app.post('/auth/logout', requirePageSession(), requireCsrf(), async (c) => {
  const session = c.get('session')!;
  c.header('Cache-Control', 'no-store');
  c.header('Vary', 'Cookie');
  const userId = await SessionRepository.destroy(session.id);
  if (userId) {
    const { db } = getDb('server');
    await writeAuditEvent(db, {
      eventType: 'google_logout',
      userId,
      outcome: 'success',
      ipAddress: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip'),
      userAgent: c.req.header('user-agent'),
    });
  }
  clearSessionCookie(c);
  return c.redirect('/login');
});

// /auth/me: returns current user JSON for HTMX header. Behind session middleware.
// The session (with user) is already loaded by requireSession(). Zero extra DB calls.
app.get('/auth/me', requireSession(), async (c) => {
  // requireSession() guarantees session is set; 401 returned otherwise
  const session = c.get('session')!;
  c.header('Cache-Control', 'no-store');
  c.header('Vary', 'Cookie');
  return c.json({ id: session.user.id, email: session.user.email, name: session.user.name });
});

// Protect /chat routes with session cookie auth
app.use('/chat/*', requirePageSession());
app.use('/chat', requirePageSession());
app.use('/chat/*', requireCsrf());
app.use('/chat', requireCsrf());

function badChatRequest(c: Context, message: string) {
  if (isHtmxRequest(c)) {
    return c.html(renderChatErrorFragment(message), 400);
  }
  return c.json(jsonError(message, 400), 400);
}

function isHtmxRequest(c: Context): boolean {
  return c.req.header('hx-request') === 'true';
}

function renderChatErrorFragment(message: string) {
  return html`<div class="squire-banner squire-banner--error" role="alert">
    <span class="squire-banner__label">SOMETHING WENT WRONG</span>
    <p class="squire-banner__body">${message}</p>
  </div>`;
}

function buildStreamUrl(conversationId: string, messageId: string): string {
  return `/chat/${conversationId}/messages/${messageId}/stream`;
}

function buildToolLabel(name: string): string {
  return name.replaceAll('_', ' ').toUpperCase();
}

async function readQuestionForm(
  c: Context,
): Promise<{ question: string; idempotencyKey?: string }> {
  const form = await c.req.formData();
  const questionValue = form.get('question');
  const idempotencyValue = form.get('idempotencyKey');

  return {
    question: typeof questionValue === 'string' ? questionValue.trim() : '',
    idempotencyKey:
      typeof idempotencyValue === 'string' && idempotencyValue.trim().length > 0
        ? idempotencyValue.trim()
        : undefined,
  };
}

app.get('/chat/:conversationId', async (c) => {
  const session = c.get('session')!;
  const loaded = await loadConversation({
    conversationId: c.req.param('conversationId'),
    userId: session.userId,
  });
  if (!loaded) return c.notFound();

  c.header('Cache-Control', 'no-store');
  c.header('Vary', 'Cookie');
  return c.html(
    await renderConversationPage({
      session,
      csrfToken: createCsrfToken(session.id),
      conversationId: loaded.conversation.id,
      messages: loaded.messages,
    }),
  );
});

app.get('/chat/:conversationId/messages/:messageId', async (c) => {
  const session = c.get('session')!;
  const loaded = await loadSelectedConversation({
    conversationId: c.req.param('conversationId'),
    messageId: c.req.param('messageId'),
    userId: session.userId,
  });
  if (!loaded) return c.notFound();

  const selectedMessages = [loaded.selectedTurn.userMessage, loaded.selectedTurn.assistantMessage];
  const recentQuestionsNav = renderRecentQuestionsNav(
    loaded.recentQuestions.map((question) => ({
      href: `/chat/${loaded.conversation.id}/messages/${question.messageId}`,
      label: question.question,
    })),
    { oob: isHtmxRequest(c) },
  );

  c.header('Cache-Control', 'no-store');
  c.header('Vary', 'Cookie');

  if (isHtmxRequest(c)) {
    return c.html(
      renderConversationTranscriptWithRecentQuestions({
        conversationId: loaded.conversation.id,
        messages: selectedMessages,
        recentQuestionsNav,
      }),
    );
  }

  return c.html(
    await renderConversationPage({
      session,
      csrfToken: createCsrfToken(session.id),
      conversationId: loaded.conversation.id,
      messages: selectedMessages,
      recentQuestionsNav,
    }),
  );
});

app.post('/chat', async (c) => {
  const session = c.get('session')!;
  const { question, idempotencyKey } = await readQuestionForm(c);

  if (!question) return badChatRequest(c, 'Question is required');
  if (!idempotencyKey) return badChatRequest(c, 'Idempotency key is required');

  if (isHtmxRequest(c)) {
    const pending = await createPendingConversation({
      userId: session.userId,
      question,
      idempotencyKey,
    });

    c.header('Cache-Control', 'no-store');
    c.header('Vary', 'Cookie');
    c.header('HX-Push-Url', `/chat/${pending.conversation.id}`);

    if (!pending.currentUserMessage) {
      const loaded = await loadConversation({
        conversationId: pending.conversation.id,
        userId: session.userId,
      });
      if (!loaded) return c.notFound();
      return c.html(renderConversationTranscript(loaded.conversation.id, loaded.messages));
    }

    return c.html(
      renderPendingTurnShell({
        question: pending.currentUserMessage.content,
        streamUrl: buildStreamUrl(pending.conversation.id, pending.currentUserMessage.id),
      }),
    );
  }

  const conversation = await startConversation({
    userId: session.userId,
    question,
    idempotencyKey,
  });

  c.header('Cache-Control', 'no-store');
  c.header('Vary', 'Cookie');
  return c.redirect(`/chat/${conversation.id}`, 302);
});

app.post('/chat/:conversationId/messages', async (c) => {
  const session = c.get('session')!;
  const { question } = await readQuestionForm(c);
  if (!question) return badChatRequest(c, 'Question is required');

  if (isHtmxRequest(c)) {
    const pending = await createPendingFollowUp({
      conversationId: c.req.param('conversationId'),
      userId: session.userId,
      question,
    });
    if (!pending?.currentUserMessage) return c.notFound();

    c.header('Cache-Control', 'no-store');
    c.header('Vary', 'Cookie');
    const loaded = await loadConversation({
      conversationId: pending.conversation.id,
      userId: session.userId,
    });
    if (!loaded) return c.notFound();
    return c.html(
      renderConversationTranscriptWithPendingTurn({
        conversationId: loaded.conversation.id,
        messages: loaded.messages,
        streamUrl: buildStreamUrl(pending.conversation.id, pending.currentUserMessage.id),
      }),
    );
  }

  const conversation = await appendMessage({
    conversationId: c.req.param('conversationId'),
    userId: session.userId,
    question,
  });
  if (!conversation) return c.notFound();

  c.header('Cache-Control', 'no-store');
  c.header('Vary', 'Cookie');
  return c.redirect(`/chat/${conversation.id}`, 302);
});

app.get('/chat/:conversationId/messages/:messageId/stream', async (c) => {
  const session = c.get('session')!;
  const loaded = await loadConversationMessage({
    conversationId: c.req.param('conversationId'),
    messageId: c.req.param('messageId'),
    userId: session.userId,
  });
  if (!loaded) return c.notFound();
  if (loaded.message.role !== 'user') return c.notFound();

  const bootstrapStatus = await ensureBootstrapStatus();
  const askCapability = bootstrapStatus.capabilities.ask;
  if (!askCapability.allowed) {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          kind: 'bootstrap',
          message: askCapability.message ?? 'Service unavailable.',
          recoverable: bootstrapStatus.lifecycle === 'warming_up',
        }),
      });
    });
  }

  // Browser SSE semantics are documented in docs/SSE_CONTRACT.md. This route
  // owns the final user-visible ordering guarantees, including the final
  // sanitized-html swap on `done`.
  return streamSSE(c, async (stream) => {
    const toolIds = new Map<string, string[]>();
    const nextToolId = (name: string) => {
      const queue = toolIds.get(name) ?? [];
      const id = `${name}-${queue.length + 1}`;
      queue.push(id);
      toolIds.set(name, queue);
      return id;
    };
    const consumeToolId = (name: string) => {
      const queue = toolIds.get(name) ?? [];
      const id = queue.shift() ?? `${name}-1`;
      if (queue.length === 0) {
        toolIds.delete(name);
      } else {
        toolIds.set(name, queue);
      }
      return id;
    };

    const assistantMessage = await streamAssistantTurn({
      conversationId: loaded.conversation.id,
      question: loaded.message.content,
      userId: session.userId,
      currentUserMessageId: loaded.message.id,
      onEvent: async (event, data) => {
        if (event === 'text') {
          await stream.writeSSE({
            event: 'text-delta',
            data: JSON.stringify(data),
          });
          return;
        }

        if (event === 'tool_call') {
          const payload = data as { name?: string };
          const name = payload.name ?? 'tool';
          await stream.writeSSE({
            event: 'tool-start',
            data: JSON.stringify({
              id: nextToolId(name),
              label: buildToolLabel(name),
            }),
          });
          return;
        }

        if (event === 'tool_result') {
          const payload = data as { name?: string; ok?: boolean };
          const name = payload.name ?? 'tool';
          await stream.writeSSE({
            event: 'tool-result',
            data: JSON.stringify({
              id: consumeToolId(name),
              label: buildToolLabel(name),
              ok: payload.ok ?? true,
            }),
          });
          return;
        }
      },
    });

    if (assistantMessage.isError) {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          kind: 'transport',
          message:
            assistantMessage.content === GENERIC_FAILURE_MESSAGE
              ? 'Trouble connecting. Please try again.'
              : assistantMessage.content,
          recoverable: true,
        }),
      });
      return;
    }

    await stream.writeSSE({
      event: 'done',
      data: JSON.stringify({
        html: renderAssistantContentHtml(assistantMessage.content),
      }),
    });
  });
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
 * Translate an SDK `OAuthError` into an RFC 6749 §5.2 JSON response. Only
 * OAuth-shaped errors are handled here — anything else (DB outage, bug) is
 * re-thrown so the global `app.onError` surfaces it as a 500. Relabeling
 * arbitrary exceptions as `invalid_request` would mask real outages as
 * caller errors. CodeRabbit flagged this on PR #196.
 */
function oauthErrorResponse(c: Context, err: unknown) {
  if (err instanceof OAuthError) {
    return c.json(err.toResponseObject(), 400);
  }
  throw err;
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
  // Health is a pure snapshot read. Do not await live bootstrap probes here.
  const status = getBootstrapStatus();
  return c.json({
    lifecycle: status.lifecycle,
    ready: status.ready,
    warming_up: status.warmingUp,
  });
});

// ─── Search endpoints ────────────────────────────────────────────────────────

function parseTopK(raw: string | undefined): number {
  if (!raw) return 6;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100) return 6;
  return n;
}

async function bootstrapErrorResponse(
  c: Context,
  scope: 'rules' | 'cards' | 'ask',
): Promise<Response | null> {
  if (isReady()) return null;

  const status = await ensureBootstrapStatus();
  const capability = status.capabilities[scope];

  if (capability.allowed) return null;

  const message =
    status.lifecycle === 'warming_up'
      ? 'Service is warming up. Retry in a moment.'
      : 'Service unavailable.';

  return c.json(jsonError(message, 503), 503);
}

function requireBootstrapCapability(scope: 'rules' | 'cards' | 'ask'): MiddlewareHandler {
  return async (c, next) => {
    const bootstrapError = await bootstrapErrorResponse(c, scope);
    if (bootstrapError) return bootstrapError;
    await next();
  };
}

async function ensureBootstrapCapability(
  c: Context,
  scope: 'rules' | 'cards' | 'ask',
): Promise<Response | null> {
  return bootstrapErrorResponse(c, scope);
}

app.get('/api/search/rules', async (c) => {
  const q = c.req.query('q');
  if (!q) return c.json(jsonError('Missing required query parameter: q', 400), 400);

  const bootstrapError = await ensureBootstrapCapability(c, 'rules');
  if (bootstrapError) return bootstrapError;

  const topK = parseTopK(c.req.query('topK'));
  const results = await searchRules(q, topK);
  return c.json({ results });
});

app.get('/api/search/cards', async (c) => {
  const q = c.req.query('q');
  if (!q) return c.json(jsonError('Missing required query parameter: q', 400), 400);

  const bootstrapError = await ensureBootstrapCapability(c, 'cards');
  if (bootstrapError) return bootstrapError;

  const topK = parseTopK(c.req.query('topK'));
  const results = await searchCards(q, topK);
  return c.json({ results });
});

// ─── Card discovery and lookup endpoints ─────────────────────────────────────

app.get('/api/card-types', requireBootstrapCapability('cards'), async (c) => {
  const types = await listCardTypes();
  return c.json({ types });
});

app.get('/api/cards/:type/:id', requireBootstrapCapability('cards'), async (c) => {
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

  const bootstrapError = await ensureBootstrapCapability(c, 'cards');
  if (bootstrapError) return bootstrapError;

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

  const bootstrapError = await ensureBootstrapCapability(c, 'ask');
  if (bootstrapError) return bootstrapError;

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
  const configuredPort = parseInt(process.env.PORT || '', 10);
  const runtime = getWorktreeRuntime();
  const { createAdaptorServer } = await import('@hono/node-server');

  if (!process.env.PORT || Number.isNaN(configuredPort)) {
    while (true) {
      const claim = await claimWorktreePort({
        checkoutRoot: runtime.checkoutRoot,
        checkoutSlug: runtime.checkoutSlug,
        isMainCheckout: runtime.isMainCheckout,
      });
      const server = createAdaptorServer({ fetch: app.fetch });
      try {
        await listen(server, claim.port);
        server.once('close', () => {
          void claim.release();
        });
        startBootstrapLifecycle();
        console.log(`Squire server listening on port ${claim.port}`);
        return;
      } catch (error) {
        await claim.release();
        const errno = error as NodeJS.ErrnoException;
        if (errno.code !== 'EADDRINUSE' || runtime.isMainCheckout) throw error;
      }
    }
  }

  const server = createAdaptorServer({ fetch: app.fetch });
  await listen(server, configuredPort);
  startBootstrapLifecycle();
  console.log(`Squire server listening on port ${configuredPort}`);
}

async function listen(server: import('node:net').Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

// CLI entrypoint
if (process.argv[1]?.endsWith('server.ts')) {
  startServer().catch((err: unknown) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
