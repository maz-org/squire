/**
 * SQR-65 — companion-first layout shell.
 *
 * Covers the curl/grep-style acceptance criteria from the ticket
 * (status, region selectors, aria-live, skip-link, real input target) plus
 * the server-side error fallback path: `renderHomePage` is stubbed to
 * throw, the route catches it, and the response still contains a
 * fully-formed layout with the `.squire-banner.squire-banner--error`
 * primitive in the main surface.
 */

import { readFileSync } from 'node:fs';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  _getCssCompileCountForTests,
  _getHtmxReadCountForTests,
  _getJsReadCountForTests,
  _resetAssetCachesForTests,
  getAppCss,
  getAppCssUrl,
  getHtmxJs,
  getHtmxJsUrl,
  getSquireJs,
  getSquireJsUrl,
} from '../src/web-ui/assets.ts';

process.env.SESSION_SECRET = 'test-session-secret-must-be-at-least-32-characters-long';

vi.mock('../src/service.ts', () => ({
  initialize: vi.fn(),
  isReady: vi.fn(),
  ask: vi.fn(),
}));
vi.mock('../src/db.ts', () => ({
  getDb: () => ({ db: { execute: vi.fn() }, close: async () => {} }),
  shutdownServerPool: vi.fn(),
}));
vi.mock('../src/tools.ts', () => ({
  searchRules: vi.fn(),
  searchCards: vi.fn(),
  listCardTypes: vi.fn(),
  listCards: vi.fn(),
  getCard: vi.fn(),
}));

// `renderHomePage` is the stub point for the error-fallback test. The route
// imports it from `src/web-ui/layout.ts`, so vi.mock here replaces it for
// the entire test file. Tests that exercise the happy path call the real
// `layoutShell` directly via `vi.importActual`.
const { mockRenderHomePage } = vi.hoisted(() => ({
  mockRenderHomePage: vi.fn(),
}));

vi.mock('../src/web-ui/layout.ts', async () => {
  const actual =
    await vi.importActual<typeof import('../src/web-ui/layout.ts')>('../src/web-ui/layout.ts');
  return {
    ...actual,
    renderHomePage: mockRenderHomePage,
  };
});

const actualLayout =
  await vi.importActual<typeof import('../src/web-ui/layout.ts')>('../src/web-ui/layout.ts');

import { app } from '../src/server.ts';
import type { AgentToolName } from '../src/agent.ts';
import type { Session } from '../src/db/repositories/types.ts';

const worldhavenDividerImageUrl =
  'https://any2cards.github.io/worldhaven/images/art/frosthaven/card-dividers/fh-available-pets.png';

process.env.SESSION_SECRET = 'test-session-secret-must-be-at-least-32-characters-long';

/** A test session object for logged-in layout rendering. */
const testSession: Session = {
  id: 'test-session-id',
  userId: 'test-user-id',
  expiresAt: new Date(Date.now() + 86400000),
  createdAt: new Date(),
  ipAddress: null,
  userAgent: null,
  lastSeenAt: new Date(),
  user: {
    id: 'test-user-id',
    googleSub: 'test-google-sub',
    email: 'test@example.com',
    name: 'Test User',
    avatarUrl: 'https://example.com/test-user.png',
    createdAt: new Date(),
  },
};

const testCsrfToken = 'test-csrf-token';

/** mockRenderHomePage impl that renders as logged-in. */
function loggedInHomePage() {
  return actualLayout.renderHomePage(testSession, testCsrfToken);
}

describe('GET / — companion-first layout shell (SQR-65)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRenderHomePage.mockImplementation(loggedInHomePage);
  });

  it('redirects unauthenticated / requests to /login', async () => {
    const res = await app.request('/', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });

  it('renders the login page document', async () => {
    const res = await app.request('/login');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-security-policy')).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; img-src 'self' data: https:; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    expect(res.headers.get('vary')).toContain('Cookie');
    const body = await res.text();
    expect(body).toMatch(/^<!doctype html>/i);
    expect(body).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
  });

  it('serves the favicon svg asset', async () => {
    const res = await app.request('/favicon.svg');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const body = await res.text();
    expect(body).toContain('<svg');
    expect(body).toContain('<rect');
    expect(body).toContain('<text');
    expect(body).toMatch(/>\s*S\s*</);
  });

  it('renders the centered login composition', async () => {
    const res = await app.request('/login');
    const body = await res.text();
    expect(body).toContain('class="squire-auth-page"');
    expect(body).toContain('class="squire-monogram squire-monogram--masthead"');
    expect(body).toContain('class="squire-wordmark squire-wordmark--auth"');
    expect(body).toContain('A FROSTHAVEN COMPANION');
    expect(body).toContain('href="/auth/google/start"');
    expect(body).toContain('Sign in with Google');
  });

  it('renders the dev-login button on /login when devLoginEnabled is true (SQR-98 preview workaround)', async () => {
    const body = String(await actualLayout.renderLoginPage({ devLoginEnabled: true }));
    expect(body).toContain('action="/dev/login"');
    expect(body).toContain('Sign in as Dev User');
    expect(body).toContain('local only');
  });

  it('omits the dev-login button on /login when devLoginEnabled is false (production)', async () => {
    const body = String(await actualLayout.renderLoginPage({ devLoginEnabled: false }));
    expect(body).not.toContain('action="/dev/login"');
    expect(body).not.toContain('Sign in as Dev User');
  });

  it('omits the dev-login button on /login when devLoginEnabled is undefined', async () => {
    const body = String(await actualLayout.renderLoginPage());
    expect(body).not.toContain('action="/dev/login"');
  });

  it('renders the login error banner from the query string', async () => {
    const res = await app.request('/login?error=denied');
    const body = await res.text();
    expect(body).toContain('COULDN&#39;T SIGN YOU IN');
    expect(body).toContain('denied');
    expect(body).toContain('Try again');
  });

  it('renders the not-invited page without the Google sign-in button', async () => {
    const res = await app.request('/not-invited');
    expect(res.headers.get('content-security-policy')).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; img-src 'self' data: https:; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    const body = await res.text();
    expect(body).toContain('NOT YET INVITED');
    expect(body).toContain(
      'Squire is single-user during Phase 1. Reach out if you&#39;d like access.',
    );
    expect(body).not.toContain('Sign in with Google');
  });

  it('renders authenticated app chrome with an account dropdown', async () => {
    const body = String(await actualLayout.renderHomePage(testSession, testCsrfToken));
    expect(body).toContain('class="squire-header"');
    expect(body).toContain('class="squire-header__brand"');
    expect(body).toMatch(/<a[^>]*class="squire-header__brand"[^>]*href="\/"[^>]*>/);
    expect(body).toContain('class="squire-context">FROSTHAVEN · RULES<');
    expect(body).toContain('class="squire-account-menu"');
    expect(body).toContain('class="squire-account-menu__avatar"');
    expect(body).toContain('Open account menu for Test User');
    expect(body).toContain('Internal tools');
    expect(body).toContain('href="/styleguide/markdown"');
    expect(body).toContain('Account');
    expect(body).toMatch(
      /<form[^>]*(class="squire-account-menu__form"[^>]*action="\/auth\/logout"|action="\/auth\/logout"[^>]*class="squire-account-menu__form")[^>]*method="post"|<form[^>]*method="post"[^>]*(class="squire-account-menu__form"[^>]*action="\/auth\/logout"|action="\/auth\/logout"[^>]*class="squire-account-menu__form")/,
    );
    expect(body).toMatch(/<input[^>]*type="hidden"[^>]*name="_csrf"[^>]*value="[^"]+"/);
    expect(body).toMatch(/>\s*Log out\s*</);
  });

  it('requires a csrf token when rendering authenticated chrome', async () => {
    await expect(actualLayout.renderHomePage(testSession)).rejects.toThrow(
      'layoutShell requires a csrfToken when rendering authenticated chrome',
    );
  });

  it('falls back to the user email when the session has no display name', async () => {
    const body = String(
      await actualLayout.renderHomePage(
        {
          ...testSession,
          user: { ...testSession.user, name: null },
        },
        testCsrfToken,
      ),
    );
    expect(body).toContain('Open account menu for test@example.com');
  });

  it('renders an initial fallback when the session has no avatar url', async () => {
    const body = String(
      await actualLayout.renderHomePage(
        {
          ...testSession,
          user: { ...testSession.user, avatarUrl: null },
        },
        testCsrfToken,
      ),
    );

    expect(body).not.toContain('class="squire-account-menu__avatar"');
    expect(body).toContain('class="squire-account-menu__avatar-fallback"');
    expect(body).toMatch(/squire-account-menu__avatar-fallback"[^>]*>\s*T\s*<\/span>/);
  });

  it('renders the authenticated home shell regions with stable selectors (SQR-107)', async () => {
    // SQR-107 / ADR 0012: the authenticated home page is a purpose-built
    // landing — hero + scope line + input dock. No chip row, no desktop
    // rail, no verdict/PICKED/spoiler stubs. The conversation page keeps
    // its chip row and rail until PR 2 (SQR-108); see test/conversation.test.ts
    // for the conversation-page selectors.
    const body = String(await actualLayout.renderHomePage(testSession, testCsrfToken));
    expect(body).toContain('class="squire-header"');
    expect(body).toContain('class="squire-surface"');
    expect(body).toContain('id="squire-surface"');
    // SQR-98: the consulted footer is no longer page chrome — it lives
    // inside each answer element now. The home page has no answer so no
    // footer should be rendered. See separate SQR-98 test below.
    expect(body).not.toContain('class="squire-toolcall"');
    expect(body).toContain('class="squire-input-dock"');
    // SQR-107: the home page no longer renders a recent-questions chip
    // row or a desktop rail. Those live on the conversation page only.
    expect(body).not.toContain('class="squire-recent"');
    expect(body).not.toContain('id="squire-recent-questions"');
    expect(body).not.toContain('class="squire-rail"');
    expect(body).toContain('aria-live="polite"');
    expect(body).toContain('aria-atomic="false"');
    expect(body).toContain('class="sr-only-focusable"');
    expect(body).toMatch(/<a href="#squire-input"[^>]*sr-only-focusable/);
    expect(body).toMatch(/<input[^>]*id="squire-input"/);
    expect(body).not.toMatch(/<form[^>]*id="squire-input"/);
    expect(body).toMatch(/<form[^>]*class="squire-input-dock"[^>]*action="\/chat"/);
    expect(body).toMatch(/hx-post="\/chat"/);
    expect(body).toMatch(/hx-target="#squire-surface"/);
    expect(body).toMatch(/hx-swap="innerHTML"/);
    expect(body).toMatch(/<input[^>]*type="hidden"[^>]*name="idempotencyKey"[^>]*value=""/);
    expect(body).toMatch(/placeholder="Ask a question\.\.\."/);
    expect(body).toMatch(
      /<button[^>]*type="submit"[^>]*class="squire-input-dock__submit"[^>]*aria-label="Ask"[^>]*>\s*<span aria-hidden="true">S<\/span>\s*<\/button>/,
    );
  });

  it('renders the CSRF token in both meta and inherited hx-headers for authenticated pages', async () => {
    const body = String(await actualLayout.renderHomePage(testSession, testCsrfToken));
    expect(body).toMatch(/<meta name="csrf-token" content="[^"]+"/);
    expect(body).toContain(
      `<meta name="htmx-config" content='{"includeIndicatorStyles":false}' />`,
    );
    expect(body).toMatch(/hx-headers='\{"x-csrf-token":"[^"]+"\}'/);
  });
});

// SQR-71 ships two asset pipelines in one module: an on-demand Tailwind
// JIT compile for CSS, and a vanilla file-read-and-cache for squire.js.
// Both are served with Rails Propshaft semantics — dev uses bare paths
// with no-cache, prod uses content-hashed paths with immutable caching.
// Concurrent cold-start requests share one compile via Promise memo.
// See ADR 0011 (fingerprinting addendum) for the decision log.

describe('SQR-71 dev asset pipeline — bare paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'development');
    // Env transitions within a test file invalidate the cache (prod
    // minifies, dev doesn't → different content, different hash).
    _resetAssetCachesForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    _resetAssetCachesForTests();
  });

  it('serves /app.css with no-cache and compiled body', async () => {
    const res = await app.request('/app.css');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/text\/css/);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const body = await res.text();
    // Smoke test: the JIT engine ran against our source. The
    // .squire-monogram class is styled in styles.css.
    expect(body).toContain('squire-monogram');
  }, 15000);

  it('serves /squire.js with no-cache and the cite tap-toggle handler', async () => {
    const res = await app.request('/squire.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/javascript/);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const body = await res.text();
    expect(body).toContain('squire-answer');
    expect(body).toContain('is-active');
    expect(body).toContain('EventSource');
    // SQR-108 QA: removed `submitButton.textContent = '...'` and
    // `submitButton.textContent = 'Ask'` mutations. They destroyed the
    // inner `<span>S</span>` that renders the wax-seal monogram. The
    // pending visual is now driven entirely by `data-submitting='true'`
    // on the form + the `disabled` attribute on the button + CSS
    // opacity.
    expect(body).not.toContain("submitButton.textContent = '...'");
    expect(body).not.toContain("submitButton.textContent = 'Ask'");
    expect(body).not.toContain("action === '/chat'");
  });

  it('serves /htmx.js with no-cache and the htmx runtime body', async () => {
    const res = await app.request('/htmx.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/javascript/);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const body = await res.text();
    expect(body).toContain('htmx');
    expect(body).toContain('XMLHttpRequest');
  });

  it('404s the hashed CSS route in dev (it is prod-only)', async () => {
    const res = await app.request('/app.abc123def0.css');
    expect(res.status).toBe(404);
  });

  it('404s the hashed JS route in dev (it is prod-only)', async () => {
    const res = await app.request('/squire.abc123def0.js');
    expect(res.status).toBe(404);
  });

  it('404s the hashed HTMX route in dev (it is prod-only)', async () => {
    const res = await app.request('/htmx.abc123def0.js');
    expect(res.status).toBe(404);
  });

  it('renders the layout with bare /app.css, /htmx.js, and /squire.js URLs', async () => {
    const body = String(await actualLayout.renderLoginPage());
    expect(body).toMatch(/<link[^>]+rel="stylesheet"[^>]+href="\/app\.css"/);
    expect(body).toMatch(/<script[^>]+src="\/htmx\.js"[^>]*defer/);
    expect(body).toMatch(/<script[^>]+src="\/squire\.js"[^>]*defer/);
    // Inline tap-toggle gone (SQR-66 extraction pin for CSP — SQR-61).
    expect(body).not.toMatch(/document\.addEventListener\(\s*['"]click['"]/);
  }, 15000);

  it('getAppCssUrl, getHtmxJsUrl, and getSquireJsUrl return bare paths in dev', async () => {
    expect(await getAppCssUrl()).toBe('/app.css');
    expect(await getHtmxJsUrl()).toBe('/htmx.js');
    expect(await getSquireJsUrl()).toBe('/squire.js');
  });
});

describe('SQR-71 prod asset pipeline — content-hashed paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'production');
    _resetAssetCachesForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    _resetAssetCachesForTests();
  });

  it('serves /app.<hash>.css with immutable cache on correct hash', async () => {
    const { hash } = await getAppCss();
    const res = await app.request(`/app.${hash}.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/text\/css/);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const body = await res.text();
    expect(body).toContain('squire-monogram');
  }, 15000);

  it('serves /squire.<hash>.js with immutable cache on correct hash', async () => {
    const { hash } = await getSquireJs();
    const res = await app.request(`/squire.${hash}.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/javascript/);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const body = await res.text();
    expect(body).toContain('squire-answer');
  });

  it('serves /htmx.<hash>.js with immutable cache on correct hash', async () => {
    const { hash } = await getHtmxJs();
    const res = await app.request(`/htmx.${hash}.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/javascript/);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const body = await res.text();
    expect(body).toContain('htmx');
  });

  it('404s /app.<hash>.css on hash mismatch', async () => {
    const res = await app.request('/app.deadbeef01.css');
    expect(res.status).toBe(404);
  }, 15000);

  it('404s /squire.<hash>.js on hash mismatch', async () => {
    const res = await app.request('/squire.deadbeef01.js');
    expect(res.status).toBe(404);
  });

  it('404s /htmx.<hash>.js on hash mismatch', async () => {
    const res = await app.request('/htmx.deadbeef01.js');
    expect(res.status).toBe(404);
  });

  it('404s non-hex hash paths at the router layer', async () => {
    // `NOTAHASH!!` contains non-hex chars — the route regex
    // [a-f0-9]+ rejects it before the handler sees it.
    const cssRes = await app.request('/app.NOTAHASH.css');
    expect(cssRes.status).toBe(404);
    const jsRes = await app.request('/squire.NOTAHASH.js');
    expect(jsRes.status).toBe(404);
    const htmxRes = await app.request('/htmx.NOTAHASH.js');
    expect(htmxRes.status).toBe(404);
  });

  it('404s the bare /app.css, /htmx.js, and /squire.js paths in prod', async () => {
    expect((await app.request('/app.css')).status).toBe(404);
    expect((await app.request('/htmx.js')).status).toBe(404);
    expect((await app.request('/squire.js')).status).toBe(404);
  });

  it('renders the layout with hashed asset URLs in prod', async () => {
    const body = String(await actualLayout.renderLoginPage());
    expect(body).toMatch(/<link[^>]+rel="stylesheet"[^>]+href="\/app\.[a-f0-9]+\.css"/);
    expect(body).toMatch(/<script[^>]+src="\/htmx\.[a-f0-9]+\.js"[^>]*defer/);
    expect(body).toMatch(/<script[^>]+src="\/squire\.[a-f0-9]+\.js"[^>]*defer/);
    expect(body).not.toMatch(/document\.addEventListener\(\s*['"]click['"]/);
  }, 15000);

  it('getAppCssUrl, getHtmxJsUrl, and getSquireJsUrl return hashed paths in prod', async () => {
    const cssUrl = await getAppCssUrl();
    const htmxUrl = await getHtmxJsUrl();
    const jsUrl = await getSquireJsUrl();
    expect(cssUrl).toMatch(/^\/app\.[a-f0-9]{10}\.css$/);
    expect(htmxUrl).toMatch(/^\/htmx\.[a-f0-9]{10}\.js$/);
    expect(jsUrl).toMatch(/^\/squire\.[a-f0-9]{10}\.js$/);
  }, 15000);
});

describe('SQR-71 Promise memoization — concurrent cold start', () => {
  beforeEach(() => {
    _resetAssetCachesForTests();
  });
  afterEach(() => {
    _resetAssetCachesForTests();
  });

  it('compiles CSS exactly once when two callers race a cold cache', async () => {
    const [a, b] = await Promise.all([getAppCss(), getAppCss()]);
    // Both callers receive the same entry reference (same content,
    // same hash) because the second await joined the first compile.
    expect(a.hash).toBe(b.hash);
    expect(a.content).toBe(b.content);
    // And the compile ran exactly once, not twice.
    expect(_getCssCompileCountForTests()).toBe(1);
  }, 15000);

  it('reads squire.js exactly once when two callers race a cold cache', async () => {
    const [a, b] = await Promise.all([getSquireJs(), getSquireJs()]);
    expect(a.hash).toBe(b.hash);
    expect(a.content).toBe(b.content);
    expect(_getJsReadCountForTests()).toBe(1);
  });

  it('reads htmx.js exactly once when two callers race a cold cache', async () => {
    const [a, b] = await Promise.all([getHtmxJs(), getHtmxJs()]);
    expect(a.hash).toBe(b.hash);
    expect(a.content).toBe(b.content);
    expect(_getHtmxReadCountForTests()).toBe(1);
  });
});

describe('renderConversationTurnAppendFragment (SQR-108 / ADR 0012 E-3)', () => {
  it('renders only the new question + pending answer skeleton for `hx-swap=beforeend`', () => {
    const body = String(
      actualLayout.renderConversationTurnAppendFragment({
        question: 'Can I loot through a doorway?',
        streamUrl: '/chat/conv-123/messages/msg-456/stream',
      }),
    );

    // No wrapping <section class="squire-transcript"> — the append fragment
    // is meant to drop into an existing transcript via `beforeend`.
    expect(body).not.toMatch(/<section[^>]*class="squire-transcript/);
    expect(body).toMatch(/<article[^>]*class="squire-turn squire-question"/);
    expect(body).toContain('Can I loot through a doorway?');
    expect(body).toMatch(
      /<article[^>]*class="squire-turn squire-answer squire-answer--pending"[^>]*data-stream-state="pending"[^>]*data-stream-url="\/chat\/conv-123\/messages\/msg-456\/stream"/,
    );
    expect(body).toMatch(/<div[^>]*class="squire-answer__content squire-markdown"><\/div>/);
    expect(body).toMatch(/<div[^>]*class="squire-answer__tools"[^>]*aria-live="off"><\/div>/);
    expect(body).toMatch(/class="squire-answer__skeleton"[^>]*aria-hidden="true"/);
    expect(body).toContain('squire-answer__skeleton-dropcap');
    expect(body).toContain('squire-answer__skeleton-line squire-answer__skeleton-line--full');
    expect(body).toContain('squire-answer__skeleton-line squire-answer__skeleton-line--mid');
    expect(body).toContain('squire-answer__skeleton-line squire-answer__skeleton-line--short');
  });
});

describe('renderConversationTranscript (SQR-108 / ADR 0012)', () => {
  const messages = [
    {
      id: 'm1',
      conversationId: 'conv-123',
      role: 'user' as const,
      content: 'First question',
      isError: false,
      responseToMessageId: null,
      consultedSources: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    {
      id: 'm2',
      conversationId: 'conv-123',
      role: 'assistant' as const,
      content: 'First answer.',
      isError: false,
      responseToMessageId: 'm1',
      consultedSources: null,
      createdAt: new Date('2026-01-01T00:00:01.000Z'),
    },
    {
      id: 'm3',
      conversationId: 'conv-123',
      role: 'user' as const,
      content: 'Second question',
      isError: false,
      responseToMessageId: null,
      consultedSources: null,
      createdAt: new Date('2026-01-01T00:00:02.000Z'),
    },
  ];

  it('renders the transcript as role="log" with aria-live="polite" — the permanent live-region container', () => {
    const body = String(
      actualLayout.renderConversationTranscript({
        conversationId: 'conv-123',
        messages: messages.slice(0, 2),
      }),
    );

    expect(body).toMatch(
      /<section[^>]*class="squire-transcript"[^>]*role="log"[^>]*aria-live="polite"/,
    );
    expect(body).toContain('data-conversation-id="conv-123"');
  });

  it('renders prior turns oldest-first then a pending skeleton for any user message in pendingStreamUrls', () => {
    const body = String(
      actualLayout.renderConversationTranscript({
        conversationId: 'conv-123',
        messages,
        pendingStreamUrls: new Map([['m3', '/chat/conv-123/messages/m3/stream']]),
      }),
    );

    expect(body).toContain('First question');
    expect(body).toContain('First answer.');
    expect(body).toContain('Second question');
    expect(body.indexOf('First question')).toBeLessThan(body.indexOf('Second question'));
    expect(body).toMatch(
      /<article[^>]*class="squire-turn squire-answer squire-answer--pending"[^>]*data-stream-url="\/chat\/conv-123\/messages\/m3\/stream"/,
    );
  });

  it('omits the pending skeleton when pendingStreamUrls is empty / undefined', () => {
    const body = String(
      actualLayout.renderConversationTranscript({
        conversationId: 'conv-123',
        messages: messages.slice(0, 2),
      }),
    );

    expect(body).not.toMatch(/squire-answer--pending/);
    expect(body).not.toMatch(/data-stream-url/);
  });

  it('still renders the live-region container when messages is empty (so beforeend appends are announced)', () => {
    // ADR 0012 D-5: the transcript IS the permanent live-region container.
    // It must exist on initial page load before any turns have been
    // appended — otherwise the FIRST `hx-swap=beforeend` append misses
    // its live-region announcement on screen readers that key off
    // container registration time.
    const body = String(
      actualLayout.renderConversationTranscript({
        conversationId: 'conv-empty',
        messages: [],
      }),
    );

    expect(body).toMatch(
      /<section[^>]*class="squire-transcript"[^>]*role="log"[^>]*aria-live="polite"/,
    );
    expect(body).toContain('data-conversation-id="conv-empty"');
    expect(body).not.toMatch(/<article/);
    expect(body).not.toMatch(/squire-answer--pending/);
    expect(body).not.toMatch(/squire-empty/);
  });
});

describe('conversation transcript rendering helpers', () => {
  const messages = [
    {
      id: 'm1',
      conversationId: 'conv-123',
      role: 'user' as const,
      content: 'Oldest question',
      isError: false,
      responseToMessageId: null,
      consultedSources: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    {
      id: 'm2',
      conversationId: 'conv-123',
      role: 'assistant' as const,
      content: 'Oldest answer.',
      isError: false,
      responseToMessageId: 'm1',
      consultedSources: null,
      createdAt: new Date('2026-01-01T00:00:01.000Z'),
    },
    {
      id: 'm3',
      conversationId: 'conv-123',
      role: 'user' as const,
      content: 'Middle question',
      isError: false,
      responseToMessageId: null,
      consultedSources: null,
      createdAt: new Date('2026-01-01T00:00:02.000Z'),
    },
    {
      id: 'm4',
      conversationId: 'conv-123',
      role: 'assistant' as const,
      content: 'Middle answer.',
      isError: false,
      responseToMessageId: 'm3',
      consultedSources: null,
      createdAt: new Date('2026-01-01T00:00:03.000Z'),
    },
    {
      id: 'm5',
      conversationId: 'conv-123',
      role: 'user' as const,
      content: 'Newest question',
      isError: false,
      responseToMessageId: null,
      consultedSources: null,
      createdAt: new Date('2026-01-01T00:00:04.000Z'),
    },
    {
      id: 'm6',
      conversationId: 'conv-123',
      role: 'assistant' as const,
      content: 'Newest answer.',
      isError: false,
      responseToMessageId: 'm5',
      consultedSources: null,
      createdAt: new Date('2026-01-01T00:00:05.000Z'),
    },
  ];

  it('wraps persisted transcript answer markdown in the shared answer content container', () => {
    const body = String(
      actualLayout.renderConversationTranscript({
        conversationId: 'conv-123',
        messages: [
          messages[2],
          {
            ...messages[3],
            content: 'Paragraph with **strong** and *emphasis*.',
          },
        ],
      }),
    );

    expect(body).toContain('Middle question');
    expect(body).toMatch(
      /class="squire-turn squire-answer"[\s\S]*class="squire-answer__content squire-markdown"/,
    );
    expect(body).toContain('<strong>strong</strong>');
    expect(body).toContain('<em>emphasis</em>');
  });

  // SQR-100: when a completed/persisted answer opens with a heading (or a
  // list/blockquote) before its first paragraph, the first top-level <p>
  // must still be the drop-cap target. Earlier the stylesheet pinned the
  // drop cap to `> p:first-child`, so any non-<p> lead element pushed the
  // paragraph out of first-child position and the answer rendered as a
  // plain fallback text block. The DOM contract asserted here (heading
  // rendered as a sibling <h2>, first top-level <p> intact, both direct
  // children of `.squire-markdown`) is what the `> p:first-of-type` drop
  // cap selector now targets — keep these two in sync.
  it.each([
    [
      'heading',
      '## Short answer\n\nYes, you can rest on the same round.',
      '<h2>Short answer</h2>',
      '<p>Yes, you can rest on the same round.</p>',
    ],
    [
      'unordered list',
      '- Item one\n- Item two\n\nYes, you can rest on the same round.',
      '<ul>',
      '<p>Yes, you can rest on the same round.</p>',
    ],
    [
      'blockquote',
      '> Quoted rule text.\n\nYes, you can rest on the same round.',
      '<blockquote>',
      '<p>Yes, you can rest on the same round.</p>',
    ],
  ])(
    'preserves the top-level first paragraph drop-cap target when the answer opens with a %s',
    (_label, content, leadElement, paragraph) => {
      const body = String(
        actualLayout.renderConversationTranscript({
          conversationId: 'conv-123',
          messages: [messages[4], { ...messages[5], content }],
        }),
      );

      const contentStart = body.indexOf('squire-answer__content squire-markdown">');
      expect(contentStart).not.toBe(-1);
      const contentSlice = body.slice(contentStart);
      expect(contentSlice).toContain(leadElement);
      expect(contentSlice).toContain(paragraph);
      // Lead element precedes the follow-up paragraph, so `> p:first-child`
      // would not match it. The fixed `> p:first-of-type` still pins the
      // drop cap to the first top-level <p>.
      expect(contentSlice.indexOf(leadElement)).toBeLessThan(contentSlice.indexOf(paragraph));
    },
  );

  it('renders the conversation page as a full scrolling transcript with role=log and no recent-questions chrome (SQR-108)', async () => {
    // ADR 0012: the conversation page is a standard scrolling chat
    // transcript — every persisted turn renders top-to-bottom inside one
    // `.squire-transcript` `role="log" aria-live="polite"` container, not
    // a single current-turn slot with collapsed history.
    const body = String(
      await actualLayout.renderConversationPage({
        session: testSession,
        csrfToken: testCsrfToken,
        conversationId: 'conv-123',
        messages,
      }),
    );

    const transcript = body.match(/<section[^>]*class="squire-transcript"[\s\S]*?<\/section>/)?.[0];
    expect(transcript).toMatch(/role="log"/);
    expect(transcript).toMatch(/aria-live="polite"/);
    expect(transcript).toContain('Oldest question');
    expect(transcript).toContain('Oldest answer.');
    expect(transcript).toContain('Middle question');
    expect(transcript).toContain('Middle answer.');
    expect(transcript).toContain('Newest question');
    expect(transcript).toContain('Newest answer.');
    // Oldest-to-newest order: the persisted-message ordering drives DOM
    // order so the position-based drop cap selector targets the newest
    // answer correctly.
    expect(transcript!.indexOf('Oldest answer.')).toBeLessThan(
      transcript!.indexOf('Middle answer.'),
    );
    expect(transcript!.indexOf('Middle answer.')).toBeLessThan(
      transcript!.indexOf('Newest answer.'),
    );
    // No recent-questions chip rail anywhere on the page (SQR-108).
    expect(body).not.toMatch(/class="squire-recent"/);
    expect(body).not.toMatch(/id="squire-recent-questions"/);
    // No desktop rail aside on the conversation page (D-6).
    expect(body).not.toMatch(/class="squire-rail"/);
    // The input dock posts to /chat/:id/messages and uses the
    // append-fragment swap contract.
    expect(body).toMatch(
      /<form[^>]*class="squire-input-dock"[^>]*action="\/chat\/conv-123\/messages"/,
    );
    expect(body).toMatch(/hx-target="\.squire-transcript"/);
    expect(body).toMatch(/hx-swap="beforeend"/);
  });

  it('makes the transcript the ONLY polite live region on /chat/:id (CR PR #274 — duplicate aria-live regions cause double announcement)', async () => {
    // The transcript section owns role=log + aria-live=polite. The outer
    // `main.squire-surface` wrapper from layoutShell defaults to
    // aria-live=polite on authenticated pages with chat chrome, but on
    // transcript pages we flip it to "off" via transcriptOwnsLiveRegion
    // so screen readers don't announce the same swap from two nested
    // polite regions.
    const body = String(
      await actualLayout.renderConversationPage({
        session: testSession,
        csrfToken: testCsrfToken,
        conversationId: 'conv-123',
        messages,
      }),
    );
    const surface = body.match(/<main[^>]*id="squire-surface"[^>]*>/)?.[0];
    expect(surface).toBeDefined();
    expect(surface).toMatch(/aria-live="off"/);
    expect(surface).toMatch(/aria-atomic="true"/);
  });

  it('renders the conversation page with a pending answer skeleton for each entry in pendingStreamUrls', async () => {
    // Drop m6 (the assistant reply to m5) so m5 is unanswered — the
    // skeleton only renders for user messages that have no paired
    // assistant message.
    const messagesWithUnansweredLatest = messages.slice(0, 5);
    const body = String(
      await actualLayout.renderConversationPage({
        session: testSession,
        csrfToken: testCsrfToken,
        conversationId: 'conv-123',
        messages: messagesWithUnansweredLatest,
        pendingStreamUrls: new Map([['m5', '/chat/conv-123/messages/m5/stream']]),
      }),
    );

    expect(body).toMatch(
      /squire-answer--pending[^>]*data-stream-url="\/chat\/conv-123\/messages\/m5\/stream"/,
    );
  });

  it('renders multiple pending skeletons when concurrent turns exist (SQR-108 defense-in-depth)', async () => {
    // Codex flagged that an older still-running turn could disappear
    // from the in-flight UI on reload because computePendingStreamUrl
    // only checked the latest user message. The render path now pairs
    // by responseToMessageId and emits a skeleton for every unanswered
    // user message; the server's computePendingStreamUrls returns one
    // entry per unanswered turn.
    const concurrent: typeof messages = [
      {
        id: 'q1',
        conversationId: 'conv-c',
        role: 'user',
        content: 'First question',
        isError: false,
        responseToMessageId: null,
        consultedSources: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'q2',
        conversationId: 'conv-c',
        role: 'user',
        content: 'Second question',
        isError: false,
        responseToMessageId: null,
        consultedSources: null,
        createdAt: new Date('2026-01-01T00:00:01.000Z'),
      },
    ];
    const body = String(
      await actualLayout.renderConversationPage({
        session: testSession,
        csrfToken: testCsrfToken,
        conversationId: 'conv-c',
        messages: concurrent,
        pendingStreamUrls: new Map([
          ['q1', '/chat/conv-c/messages/q1/stream'],
          ['q2', '/chat/conv-c/messages/q2/stream'],
        ]),
      }),
    );

    expect(body).toMatch(
      /squire-answer--pending[^>]*data-stream-url="\/chat\/conv-c\/messages\/q1\/stream"/,
    );
    expect(body).toMatch(
      /squire-answer--pending[^>]*data-stream-url="\/chat\/conv-c\/messages\/q2\/stream"/,
    );
  });

  it('pairs Q+A by responseToMessageId so out-of-order assistant arrival still renders correctly (SQR-108 reload-ordering regression)', () => {
    // Codex finding: if turn 2's assistant reply lands in the DB before
    // turn 1's, walking by createdAt would render Q1, Q2, A2, A1.
    // Pairing first keeps Q1, A1, Q2, A2 regardless of arrival order.
    const reorderedMessages: typeof messages = [
      {
        id: 'q1',
        conversationId: 'conv-r',
        role: 'user',
        content: 'First question',
        isError: false,
        responseToMessageId: null,
        consultedSources: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'q2',
        conversationId: 'conv-r',
        role: 'user',
        content: 'Second question',
        isError: false,
        responseToMessageId: null,
        consultedSources: null,
        createdAt: new Date('2026-01-01T00:00:01.000Z'),
      },
      // a2 lands BEFORE a1 in createdAt order
      {
        id: 'a2',
        conversationId: 'conv-r',
        role: 'assistant',
        content: 'Second answer.',
        isError: false,
        responseToMessageId: 'q2',
        consultedSources: null,
        createdAt: new Date('2026-01-01T00:00:02.000Z'),
      },
      {
        id: 'a1',
        conversationId: 'conv-r',
        role: 'assistant',
        content: 'First answer.',
        isError: false,
        responseToMessageId: 'q1',
        consultedSources: null,
        createdAt: new Date('2026-01-01T00:00:03.000Z'),
      },
    ];

    const body = String(
      actualLayout.renderConversationTranscript({
        conversationId: 'conv-r',
        messages: reorderedMessages,
      }),
    );

    // Q1, A1, Q2, A2 — paired by responseToMessageId, ordered by user
    // message createdAt.
    expect(body.indexOf('First question')).toBeLessThan(body.indexOf('First answer.'));
    expect(body.indexOf('First answer.')).toBeLessThan(body.indexOf('Second question'));
    expect(body.indexOf('Second question')).toBeLessThan(body.indexOf('Second answer.'));
  });
});

describe('GET / — signature components (SQR-66)', () => {
  // Note: SQR-67 replaced the SQR-66 placeholderAnswer (squire-question +
  // squire-answer sample) with the first-run empty state. The hero question
  // selector `.squire-question` is still rendered inside `.squire-empty`
  // (empty state reuses that class per the ticket), but the sample
  // `<section class="squire-answer">` is gone until SQR-6 wires real
  // streamed answers. Drop-cap / em / cite CSS is covered by the
  // `styles.css` block below instead of DOM assertions on the home page.

  it('renders the .squire-question hero (now inside the empty state)', async () => {
    const body = String(await actualLayout.renderHomePage(testSession, testCsrfToken));
    expect(body).toMatch(/<h1[^>]*class="squire-question"[^>]*>/);
  });

  it('does NOT use a wrapping <span class="squire-dropcap"> for the drop cap', async () => {
    const body = String(await actualLayout.renderHomePage(testSession, testCsrfToken));
    expect(body).not.toMatch(/squire-dropcap/);
  });

  // SQR-107 / ADR 0012: the desktop rail is not rendered on the authenticated
  // home page any more. Its masthead monogram still lives on the conversation
  // page (until PR 2 ships SQR-108) and on the login / not-invited pages.
  // CSS rule coverage for `.squire-monogram--masthead` sizing is preserved in
  // the `styles.css` block below.
});

describe('styles.css — SQR-66 signature component rules', () => {
  const css = readFileSync(new URL('../src/web-ui/styles.css', import.meta.url), 'utf8');

  it('declares .squire-question with Fraunces clamp font-size and line-height 1.25', () => {
    expect(css).toMatch(/\.squire-question\s*\{[^}]*font-family:\s*["']?Fraunces["']?/);
    expect(css).toMatch(/\.squire-question\s*\{[^}]*clamp\(\s*22px\s*,\s*5vw\s*,\s*28px\s*\)/);
    expect(css).toMatch(/\.squire-question\s*\{[^}]*line-height:\s*1\.25/);
  });

  it('styles .squire-markdown em as the amber rule-term highlighter at 0.60 alpha, 75% coverage', () => {
    const rule = css.match(/\.squire-markdown\s+em\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    const body = rule![0];
    expect(body).toContain('font-variant-caps: all-small-caps');
    // stylelint-config-standard enforces `color-function-notation: modern`, so
    // stylelint autofix rewrote the original `rgba(212, 161, 71, 0.6)` to the
    // modern space-separated form `rgb(212 161 71 / 0.6)`. An earlier attempt
    // used `color-function-notation: legacy`, which produced an invalid 4-arg
    // comma form `rgb(212, 161, 71, 0.6)` (legacy rgb() has no alpha arg);
    // browsers dropped the whole declaration and the rule-term highlighter
    // rendered without its amber stripe. Pin the modern syntax here so a
    // future config regression fails loudly instead of silently shipping
    // broken CSS.
    expect(body).toMatch(/rgb\(212\s+161\s+71\s*\/\s*0\.6/);
    expect(body).toContain('75%');
    expect(body).toContain('white-space: nowrap');
  });

  it('renders blockquote emphasis as a normal wrapping quote instead of a term chip', () => {
    const rule = css.match(/\.squire-markdown\s+blockquote\s+em\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    const body = rule![0];
    expect(body).toContain('font-style: italic');
    expect(body).toContain('font-weight: inherit');
    expect(body).toContain('font-variant-caps: normal');
    expect(body).toContain('letter-spacing: normal');
    expect(body).toContain('background-image: none');
    expect(body).toContain('padding: 0');
    expect(body).toContain('white-space: normal');
  });

  it('styles .squire-markdown .cite as sepia underline with wax hover + tap-toggle', () => {
    expect(css).toMatch(/\.squire-markdown\s+\.cite\s*\{[^}]*color:\s*var\(--sepia\)/);
    expect(css).toMatch(/\.squire-markdown\s+\.cite\s*\{[^}]*text-underline-offset:\s*3px/);
    expect(css).toMatch(/\.squire-markdown\s+\.cite:hover/);
    expect(css).toMatch(/\.squire-markdown\s+\.cite\.is-active\s*\{[^}]*var\(--wax\)/);
  });

  it('styles the supported markdown subset on the reusable markdown surface', () => {
    expect(css).toMatch(/\.squire-markdown\s+h1\s*\{/);
    expect(css).toMatch(/\.squire-markdown\s+h2\s*\{/);
    expect(css).toMatch(/\.squire-markdown\s+strong\s*\{/);
    expect(css).toMatch(/\.squire-markdown\s+(ul|ol)\s*\{/);
    expect(css).toMatch(/\.squire-markdown\s+blockquote\s*\{/);
    expect(css).toMatch(/\.squire-markdown\s+code\s*\{/);
    expect(css).toMatch(/\.squire-markdown\s+pre\s*\{/);
    expect(css).toMatch(/\.squire-markdown\s+a\s*\{/);
    expect(css).toMatch(/\.squire-markdown__table-scroll\s*\{/);
    expect(css).toMatch(/\.squire-markdown\s+table\s*\{/);
    expect(css).toMatch(/\.squire-markdown\s+hr\s*\{/);
    expect(css).toMatch(/\.squire-markdown\s+img\s*\{/);
  });

  it('styles markdown table alignment through classes instead of inline styles', () => {
    expect(css).toMatch(/\.squire-markdown__align-left\s*\{[^}]*text-align:\s*left/);
    expect(css).toMatch(/\.squire-markdown__align-center\s*\{[^}]*text-align:\s*center/);
    expect(css).toMatch(/\.squire-markdown__align-right\s*\{[^}]*text-align:\s*right/);
  });

  it('lets narrow markdown tables hug their content instead of stretching full width', () => {
    const wrapperRule = css.match(/\.squire-markdown__table-scroll\s*\{[^}]*\}/);
    const tableRule = css.match(/\.squire-markdown\s+table\s*\{[^}]*\}/);
    expect(wrapperRule).not.toBeNull();
    expect(tableRule).not.toBeNull();
    expect(wrapperRule![0]).toContain('width: fit-content');
    expect(wrapperRule![0]).toContain('max-width: 100%');
    expect(tableRule![0]).toContain('width: max-content');
    expect(tableRule![0]).not.toContain('min-width: 100%');
  });

  it('preserves native table display semantics on markdown tables', () => {
    const rule = css.match(/\.squire-markdown\s+table\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).not.toContain('display: block');
  });

  it('declares a guarded q&a-only first-paragraph drop cap in Fraunces', () => {
    // SQR-100: use `:first-of-type` (not `:first-child`) so the first top-level
    // <p> still receives the drop cap when the answer opens with a heading,
    // list, or blockquote — the previous `:first-child` variant suppressed the
    // drop cap on completed/persisted answers whose markdown opened with any
    // non-<p> block element, leaving them as plain fallback text blocks.
    // SQR-108: the parent selector now also constrains to the newest
    // `.squire-answer` via `:not(:has(~ .squire-answer))`, but the inner
    // `:first-of-type` shape is unchanged.
    expect(css).toMatch(/\.squire-answer[^{]*\.squire-markdown\s+>\s+p:first-of-type:not\(/);
    expect(css).not.toMatch(/\.squire-answer[^{]*\.squire-markdown\s+>\s+p:first-child:not\(/);
    expect(css).toContain(
      ':has(> strong:first-child, > em:first-child, > code:first-child, > a:first-child)',
    );
    const rule = css.match(/::first-letter\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    const body = rule![0];
    expect(body).toMatch(/font-family:\s*["']?Fraunces["']?/);
    expect(body).toMatch(/font-size:\s*(68|70|72)px/);
    expect(body).toContain('color: var(--wax)');
    expect(body).toMatch(/['"]opsz['"]\s*144/);
    expect(body).toMatch(/['"]SOFT['"]\s*30/);
  });

  it('declares a global :focus-visible ring in --wax at 2px', () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--wax\)/);
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline-offset:\s*2px/);
  });

  it('declares a 56px masthead monogram modifier', () => {
    expect(css).toMatch(/\.squire-monogram--masthead\s*\{[^}]*width:\s*56px[^}]*height:\s*56px/);
  });

  it('puts the wax-box styling on the BASE .squire-monogram so all contexts inherit it', () => {
    // Regression: CodeRabbit on PR #202 caught that the box styling
    // (display, background, centering) was scoped to .squire-header
    // .squire-monogram, so the desktop rail's masthead monogram rendered
    // as a bare Fraunces "S" instead of a wax square. The fix lifts the
    // box styling to the base selector. This test pins the new structure
    // so a future cleanup can't accidentally re-scope it.
    const baseRule = css.match(/^\.squire-monogram\s*\{[^}]*\}/m);
    expect(baseRule).not.toBeNull();
    const body = baseRule![0];
    expect(body).toContain('display: inline-flex');
    expect(body).toContain('background: var(--wax)');
    expect(body).toContain('color: var(--parchment)');
    expect(body).toContain('border-radius: 4px');
    expect(body).toContain('justify-content: center');
  });

  it('gates hover transitions on .cite under prefers-reduced-motion: reduce', () => {
    // The existing global * { transition: none } rule already satisfies the
    // acceptance criterion; assert it still exists AFTER SQR-66's stylesheet
    // additions so nobody accidentally drops it.
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});

describe('GET / — SQR-107 purpose-built landing', () => {
  it('renders the first-run empty state with "At your service." and the scope line', async () => {
    const body = String(await actualLayout.renderHomePage(testSession, testCsrfToken));
    expect(body).toMatch(/<section[^>]*class="squire-empty"/);
    expect(body).toContain('At your service.');
    expect(body).toMatch(/class="squire-empty__scope"/);
    expect(body).toContain('ASK ABOUT A RULE, CARD, ITEM, MONSTER, OR SCENARIO');
  });

  it('renders the home page as hero + scope + input dock only (no chrome stubs)', async () => {
    // SQR-107 / ADR 0012: the home page is a purpose-built landing. No
    // pre-history chip row (used to read Looting / Element infusion /
    // Negative scenario effects), no visible verdict block, no PICKED
    // badge, no spoiler-warning banner. Those lived in `layoutShell`'s
    // empty-state fallback and ADR 0012 moves them off visible HTML on
    // home. Verdict + PICKED survive as fixtures inside
    // `<template id="squire-banner-fixtures">` so CSS drift tests still
    // find markup to target.
    const body = String(await actualLayout.renderHomePage(testSession, testCsrfToken));
    expect(body).not.toContain('Looting');
    expect(body).not.toContain('Element infusion');
    expect(body).not.toContain('Negative scenario effects');

    const withoutFixtures = body.replace(
      /<template[^>]*id="squire-banner-fixtures"[\s\S]*?<\/template>/,
      '',
    );
    expect(withoutFixtures).not.toMatch(/class="squire-verdict/);
    expect(withoutFixtures).not.toContain('SQUIRE RECOMMENDS');
    expect(withoutFixtures).not.toMatch(/class="squire-picked/);
    expect(withoutFixtures).not.toContain('PICKED');
    expect(withoutFixtures).not.toMatch(/squire-banner--spoiler/);
    expect(withoutFixtures).not.toContain('SPOILER WARNING');
  });

  it('no longer ships the hardcoded CONSULTED placeholder in page chrome (SQR-98)', async () => {
    // Regression: the old footer lied — it always said "CONSULTED · RULEBOOK
    // P.47 · SCENARIO BOOK §14" regardless of what the answer actually
    // consulted. The new footer lives inside each answer element and is
    // populated from real per-turn source data. The home page has no
    // current answer, so it should not render a consulted footer at all.
    const body = String(await actualLayout.renderHomePage(testSession, testCsrfToken));
    expect(body).not.toContain('CONSULTED · RULEBOOK P.47');
    expect(body).not.toContain('SCENARIO BOOK §14');
    expect(body).not.toMatch(/<footer[^>]*class="squire-toolcall"/);
  });

  describe('SQR-98: per-answer consulted footer', () => {
    const userMessage = {
      id: 'user-1',
      conversationId: 'conv-sqr98',
      role: 'user' as const,
      content: 'How does looting work?',
      isError: false,
      responseToMessageId: null,
      consultedSources: null,
      createdAt: new Date('2026-04-20T00:00:00.000Z'),
    };

    function answerWith(
      consultedSources: AgentToolName[] | null,
      overrides: Record<string, unknown> = {},
    ) {
      return {
        id: 'assistant-1',
        conversationId: 'conv-sqr98',
        role: 'assistant' as const,
        content: 'Loot tokens in your hex are picked up.',
        isError: false,
        responseToMessageId: 'user-1',
        consultedSources,
        createdAt: new Date('2026-04-20T00:00:01.000Z'),
        ...overrides,
      };
    }

    function renderTranscriptAnswer(answer: ReturnType<typeof answerWith>): string {
      return String(
        actualLayout.renderConversationTranscript({
          conversationId: 'conv-sqr98',
          messages: [userMessage, answer],
        }),
      );
    }

    it('renders the consulted footer inside the answer element for a single source', () => {
      const body = renderTranscriptAnswer(answerWith(['search_rules']));
      // Template whitespace is nondeterministic across hono/html versions,
      // so match the shape with \s* tolerance between tokens rather than
      // asserting byte-for-byte equality.
      expect(body).toMatch(
        /class="squire-turn squire-answer"[\s\S]*<footer[^>]*class="squire-toolcall"[^>]*>\s*CONSULTED · RULEBOOK\s*<\/footer>/,
      );
    });

    it('aggregates multiple tool names into deduped labels, preserving insertion order', () => {
      const body = renderTranscriptAnswer(
        answerWith(['search_rules', 'search_cards', 'search_rules', 'get_card', 'get_section']),
      );
      expect(body).toContain('CONSULTED · RULEBOOK · CARD INDEX · SECTION BOOK');
      // The RULEBOOK-first ordering is the insertion-order contract — ensure
      // CARD INDEX doesn't leapfrog ahead of RULEBOOK just because more
      // card-family tools were called.
      expect(body.indexOf('RULEBOOK')).toBeLessThan(body.indexOf('CARD INDEX'));
    });

    it('renders the footer hidden when consultedSources is null (pre-SQR-98 rows)', () => {
      const body = renderTranscriptAnswer(answerWith(null));
      expect(body).toMatch(/<footer[^>]*class="squire-toolcall"[^>]*hidden[^>]*><\/footer>/);
    });

    it('renders the footer hidden when the only tool used was a traversal tool', () => {
      // follow_links is a utility/traversal tool — the actual content came
      // from whatever tool resolved the link, so it never contributes a
      // provenance label on its own. An answer that "only" used follow_links
      // shouldn't show any consulted sources.
      const body = renderTranscriptAnswer(answerWith(['follow_links']));
      expect(body).toMatch(/<footer[^>]*class="squire-toolcall"[^>]*hidden[^>]*><\/footer>/);
    });

    it('renders the footer hidden for error messages even if sources exist', () => {
      // An error turn didn't produce a real answer. The footer would lie
      // about the error being the result of consulting a source.
      const body = renderTranscriptAnswer(
        answerWith(['search_rules'], {
          isError: true,
          content: 'Trouble connecting. Please try again.',
        }),
      );
      expect(body).toMatch(/<footer[^>]*class="squire-toolcall"[^>]*hidden[^>]*><\/footer>/);
    });

    it('maps scenario-family and section-family tools to the right labels', () => {
      const body = renderTranscriptAnswer(
        answerWith(['find_scenario', 'get_scenario', 'get_section']),
      );
      expect(body).toContain('CONSULTED · SCENARIO BOOK · SECTION BOOK');
    });

    it('renders a hidden empty footer slot inside the pending answer skeleton', async () => {
      // The JS relies on answerEl.querySelector('.squire-toolcall') to find
      // and populate the footer during the live stream, so the pending
      // skeleton must always ship one in the DOM — just hidden until `done`.
      const body = String(
        await actualLayout.renderConversationPage({
          session: testSession,
          csrfToken: testCsrfToken,
          conversationId: 'conv-sqr98',
          messages: [userMessage],
          pendingStreamUrls: new Map([['user-1', '/chat/conv-sqr98/messages/user-1/stream']]),
        }),
      );
      expect(body).toMatch(
        /squire-answer--pending[\s\S]*<footer[^>]*class="squire-toolcall"[^>]*hidden[^>]*><\/footer>/,
      );
    });
  });

  it('ships hidden fixtures for the error, sync, verdict, and PICKED variants', async () => {
    // SQR-107 / ADR 0012: the visible home page drops the verdict block
    // and PICKED badge. They stay in this hidden `<template>` so CSS
    // drift tests that read `styles.css` keep a markup reference, and
    // future QA can instantiate the fixtures without waiting for real
    // Phase 5 content.
    const body = String(await actualLayout.renderHomePage(testSession, testCsrfToken));
    const tpl = body.match(/<template[^>]*id="squire-banner-fixtures"[\s\S]*?<\/template>/);
    expect(tpl).not.toBeNull();
    expect(tpl![0]).toMatch(/squire-banner squire-banner--error/);
    expect(tpl![0]).toMatch(/squire-banner squire-banner--sync/);
    expect(tpl![0]).toContain('SYNCED · 2H AGO');
    expect(tpl![0]).toMatch(/class="squire-verdict"/);
    expect(tpl![0]).toContain('SQUIRE RECOMMENDS');
    expect(tpl![0]).toMatch(/class="squire-picked"/);
    expect(tpl![0]).toContain('PICKED');
  });
});

describe('renderMarkdownStyleguidePage', () => {
  it('renders a styleguide page with supported and unsupported markdown specimens', async () => {
    const body = String(
      await actualLayout.renderMarkdownStyleguidePage(testSession, testCsrfToken),
    );

    expect(body).toContain('Markdown rendering styleguide');
    expect(body).toContain('Supported subset specimen');
    expect(body).toContain('Unsafe syntax stays inert');
    expect(body).toMatch(/<a[^>]*class="squire-header__brand"[^>]*href="\/"[^>]*>/);
    expect(body).toContain('class="squire-internal-shell"');
    expect(body).not.toContain('class="squire-toolcall"');
    expect(body).not.toContain('class="squire-recent"');
    expect(body).not.toContain('class="squire-input-dock"');
    expect(body).not.toContain('class="squire-answer"');
    expect(body).toContain('<h1>Heading one</h1>');
    expect(body).toContain('Paragraph one with <strong>strong</strong> and <em>emphasis</em>.');
    expect(body).toContain('<h2>Heading two</h2>');
    expect(body).toContain('<ul>');
    expect(body).toContain('<ol>');
    expect(body).toContain('<blockquote>');
    expect(body).toContain('<pre><code>block code');
    expect(body).toContain('<a href="https://example.com" rel="noopener noreferrer">safe link</a>');
    expect(body).toContain('<table>');
    expect(body).toContain('<th class="squire-markdown__align-left">Column A</th>');
    expect(body).toContain('<td class="squire-markdown__align-right">2</td>');
    expect(body).not.toContain('style="text-align:');
    expect(body).toContain('<hr>');
    expect(body).toContain(
      `<img src="${worldhavenDividerImageUrl}" alt="Worldhaven Frosthaven divider" loading="lazy" decoding="async" referrerpolicy="no-referrer">`,
    );
    expect(body).toContain('[unsafe link](http://example.com)');
    expect(body).toContain('![alt](http://example.com/image.png)');
  });
});

describe('styles.css — SQR-67 stub-region rules', () => {
  const css = readFileSync(new URL('../src/web-ui/styles.css', import.meta.url), 'utf8');

  it('declares .squire-banner--spoiler with amber left border and 8% amber tint', () => {
    const rule = css.match(/\.squire-banner--spoiler\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain('border-left-color: var(--amber)');
    // Modern space-separated form — see the rule-term highlighter comment
    // above for why SQR-70 enforces this.
    expect(rule![0]).toMatch(/rgb\(212\s+161\s+71\s*\/\s*0\.08\)/);
  });

  it('declares .squire-banner--sync with sage left border and 8% sage tint', () => {
    const rule = css.match(/\.squire-banner--sync\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain('border-left-color: var(--sage)');
    expect(rule![0]).toMatch(/rgb\(122\s+140\s+92\s*\/\s*0\.08\)/);
  });

  it('declares .squire-banner--error with 8% error tint (Phase 6 bit-rot guard)', () => {
    const rule = css.match(/\.squire-banner--error\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain('border-left-color: var(--error)');
    expect(rule![0]).toMatch(/rgb\(139\s+41\s+25\s*\/\s*0\.08\)/);
  });

  it('declares .squire-empty__scope with small-caps, letter-spacing ≥ 0.14em, sepia', () => {
    const rule = css.match(/\.squire-empty__scope\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    const body = rule![0];
    expect(body).toContain('text-transform: uppercase');
    expect(body).toMatch(/letter-spacing:\s*0\.1[4-9]em|letter-spacing:\s*0\.2/);
    expect(body).toContain('color: var(--sepia)');
    expect(body).toMatch(/font-size:\s*1[01]px/);
  });

  it('SQR-108 D-7: .squire-turn declares no card-shell properties (no shadow / outer radius / deviant background)', () => {
    // ADR 0012 D-7 — the conversation page reads as ledger prose, not a
    // chat-bubble or card stack. A computed-style assertion is heavier
    // than the constraint needs; greping the rule body keeps it cheap and
    // tests the source of truth (a future change adding box-shadow has to
    // pass this rule body anyway).
    const rule = css.match(/\.squire-turn\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    const body = rule![0];
    expect(body).toContain('background: transparent');
    expect(body).toContain('border-radius: 0');
    expect(body).toContain('box-shadow: none');
  });

  it('SQR-108 D-7: .squire-answer declares no card-shell properties', () => {
    const rule = css.match(/^\.squire-answer\s*\{[^}]*\}/m);
    expect(rule).not.toBeNull();
    const body = rule![0];
    expect(body).toContain('background: transparent');
    expect(body).toContain('border-radius: 0');
    expect(body).toContain('box-shadow: none');
  });

  it('SQR-108 D-7: .squire-turn + .squire-turn uses a hairline --rule border-top as the only between-turn separator', () => {
    const rule = css.match(/\.squire-turn\s*\+\s*\.squire-turn\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    const body = rule![0];
    expect(body).toMatch(/border-top:\s*1px\s+solid\s+var\(--rule\)/);
    expect(body).toMatch(/padding-top:\s*var\(--space-lg\)/);
  });

  it('SQR-108: .squire-transcript stacks turns vertically with a --space-lg gap', () => {
    const rule = css.match(/^\.squire-transcript\s*\{[^}]*\}/m);
    expect(rule).not.toBeNull();
    const body = rule![0];
    expect(body).toContain('display: flex');
    expect(body).toContain('flex-direction: column');
    expect(body).toMatch(/gap:\s*var\(--space-lg\)/);
  });

  it('declares a --space-* scale on :root that matches DESIGN.md §Spacing (4px base unit)', () => {
    const rootRule = css.match(/^:root\s*\{[^}]*\}/m);
    expect(rootRule).not.toBeNull();
    const body = rootRule![0];
    expect(body).toMatch(/--space-2xs:\s*2px/);
    expect(body).toMatch(/--space-xs:\s*4px/);
    expect(body).toMatch(/--space-sm:\s*8px/);
    expect(body).toMatch(/--space-md:\s*16px/);
    expect(body).toMatch(/--space-lg:\s*24px/);
    expect(body).toMatch(/--space-xl:\s*32px/);
    expect(body).toMatch(/--space-2xl:\s*48px/);
    expect(body).toMatch(/--space-3xl:\s*64px/);
    expect(body).toMatch(/--space-4xl:\s*96px/);
  });

  it('SQR-108: drop cap selector targets only the LAST .squire-answer (newest-only) via :not(:has(~ .squire-answer))', () => {
    // ADR 0012: drop cap rarity is preserved by position, not by limiting
    // visible turns. The selector pins ::first-letter to the last
    // .squire-answer in the transcript so prior answers render plain.
    expect(css).toMatch(
      /\.squire-answer:not\(:has\(\s*~\s*\.squire-answer\s*\)\)\s+\.squire-markdown\s+>\s+p:first-of-type/,
    );
  });

  it('declares .squire-question__eyebrow as small metadata instead of hero text', () => {
    const rule = css.match(/\.squire-question__eyebrow\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    const body = rule![0];
    expect(body).toContain('display: block');
    expect(body).toContain("font-family: 'Geist', system-ui, sans-serif");
    expect(body).toContain('font-size: 12px');
    expect(body).toContain('text-transform: uppercase');
    expect(body).toContain('color: var(--sepia)');
  });

  it('declares .squire-verdict with 3px wax left border', () => {
    const rule = css.match(/\.squire-verdict\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/border-left:\s*3px\s+solid\s+var\(--wax\)/);
  });

  it('declares .squire-picked with --wax background and --parchment text', () => {
    const rule = css.match(/\.squire-picked\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    const body = rule![0];
    expect(body).toContain('background: var(--wax)');
    expect(body).toContain('color: var(--parchment)');
  });

  it('declares the tool-call footer with sepia small-caps ≤12px font', () => {
    const rule = css.match(/\.squire-toolcall\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    const body = rule![0];
    expect(body).toContain('color: var(--sepia)');
    expect(body).toContain('text-transform: uppercase');
    expect(body).toMatch(/letter-spacing:\s*0\.1[4-9]em|letter-spacing:\s*0\.2/);
    expect(body).toMatch(/font-size:\s*1[012]px/);
  });
});

describe('layoutShell error banner rendering', () => {
  it('renders the error banner inside the main.squire-surface region', async () => {
    const body = String(
      await actualLayout.layoutShell({
        errorBanner: { message: 'agent unavailable' },
        csrfToken: testCsrfToken,
        session: testSession,
      }),
    );
    const surfaceStart = body.indexOf('class="squire-surface"');
    const bannerStart = body.indexOf('squire-banner--error');
    const surfaceEnd = body.indexOf('</main>');
    expect(surfaceStart).toBeGreaterThan(-1);
    expect(bannerStart).toBeGreaterThan(surfaceStart);
    expect(surfaceEnd).toBeGreaterThan(bannerStart);
    expect(body).toContain('SOMETHING WENT WRONG');
    expect(body).toContain('agent unavailable');
  });
});

// ─── retryUrl security (SQR-38 review) ──────────────────────────────────────

describe('Auth error page retryUrl validation', () => {
  it('rejects protocol-relative URLs (//evil.com bypass)', async () => {
    const { renderAuthErrorPage } = await vi.importActual<
      typeof import('../src/web-ui/auth-error-page.ts')
    >('../src/web-ui/auth-error-page.ts');
    await expect(renderAuthErrorPage({ message: 'test', retryUrl: '//evil.com' })).rejects.toThrow(
      'retryUrl must be a relative path',
    );
  });

  it('rejects javascript: URIs', async () => {
    const { renderAuthErrorPage } = await vi.importActual<
      typeof import('../src/web-ui/auth-error-page.ts')
    >('../src/web-ui/auth-error-page.ts');
    await expect(
      renderAuthErrorPage({ message: 'test', retryUrl: 'javascript:alert(1)' }),
    ).rejects.toThrow('retryUrl must be a relative path');
  });

  it('allows valid relative paths', async () => {
    const { renderAuthErrorPage } = await vi.importActual<
      typeof import('../src/web-ui/auth-error-page.ts')
    >('../src/web-ui/auth-error-page.ts');
    const result = await renderAuthErrorPage({ message: 'test', retryUrl: '/auth/google/start' });
    expect(String(result)).toContain('href="/auth/google/start"');
  });
});
