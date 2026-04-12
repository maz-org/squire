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
import type { Session } from '../src/db/repositories/types.ts';

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
      "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; img-src 'self' data:; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    expect(res.headers.get('vary')).toContain('Cookie');
    const body = await res.text();
    expect(body).toMatch(/^<!doctype html>/i);
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
      "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; img-src 'self' data:; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    const body = await res.text();
    expect(body).toContain('NOT YET INVITED');
    expect(body).toContain(
      'Squire is single-user during Phase 1. Reach out if you&#39;d like access.',
    );
    expect(body).not.toContain('Sign in with Google');
  });

  it('renders authenticated app chrome with user info and a logout form', async () => {
    const body = String(await actualLayout.renderHomePage(testSession, testCsrfToken));
    expect(body).toContain('class="squire-header"');
    expect(body).toContain('class="squire-header__brand"');
    expect(body).toContain('class="squire-context">FROSTHAVEN · RULES<');
    expect(body).toContain('class="squire-user">Test User</span>');
    expect(body).toMatch(
      /<form[^>]*class="squire-logout-form"[^>]*method="post"[^>]*action="\/auth\/logout"/,
    );
    expect(body).toMatch(/<input[^>]*type="hidden"[^>]*name="_csrf"[^>]*value="[^"]+"/);
    expect(body).toMatch(/>\s*Log out\s*</);
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
    expect(body).toContain('test@example.com');
  });

  it('renders the authenticated shell regions with stable selectors', async () => {
    const body = String(await actualLayout.renderHomePage(testSession, testCsrfToken));
    expect(body).toContain('class="squire-header"');
    expect(body).toContain('class="squire-surface"');
    expect(body).toContain('id="squire-surface"');
    expect(body).toContain('class="squire-toolcall"');
    expect(body).toContain('class="squire-recent"');
    expect(body).toContain('class="squire-input-dock"');
    expect(body).toContain('class="squire-rail"');
    expect(body).toContain('aria-live="polite"');
    expect(body).toContain('aria-atomic="false"');
    expect(body).toContain('aria-live="off"');
    expect(body).toContain('class="sr-only-focusable"');
    expect(body).toMatch(/<a href="#squire-input"[^>]*sr-only-focusable/);
    expect(body).toMatch(/<input[^>]*id="squire-input"/);
    expect(body).not.toMatch(/<form[^>]*id="squire-input"/);
    expect(body).toMatch(/<nav[^>]*id="squire-recent-questions"[^>]*class="squire-recent"/);
    expect(body).toMatch(/<form[^>]*class="squire-input-dock"[^>]*action="\/chat"/);
    expect(body).toMatch(/hx-post="\/chat"/);
    expect(body).toMatch(/hx-target="#squire-surface"/);
    expect(body).toMatch(/hx-swap="innerHTML"/);
    expect(body).toMatch(/<input[^>]*type="hidden"[^>]*name="idempotencyKey"[^>]*value=""/);
    expect(body).toMatch(/placeholder="Ask a question\.\.\."/);
    expect(body).toMatch(
      /<button[^>]*type="submit"[^>]*class="squire-input-dock__submit"[^>]*aria-label="Ask"[^>]*>\s*Ask\s*<\/button>/,
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
    expect(body).toContain("submitButton.textContent = '...'");
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

describe('renderPendingTurnShell', () => {
  it('renders a turn-scoped pending transcript shell with a skeleton and tool region', () => {
    const body = String(
      actualLayout.renderPendingTurnShell({
        question: 'Can I loot through a doorway?',
        streamUrl: '/chat/conv-123/turns/turn-456/stream',
      }),
    );

    expect(body).toMatch(/class="squire-transcript squire-transcript--pending"/);
    expect(body).toContain('data-stream-url="/chat/conv-123/turns/turn-456/stream"');
    expect(body).toMatch(/<article[^>]*class="squire-turn squire-question"/);
    expect(body).toContain('Can I loot through a doorway?');
    expect(body).toMatch(
      /<article[^>]*class="squire-turn squire-answer squire-answer--pending"[^>]*data-stream-state="pending"/,
    );
    expect(body).toMatch(/<div[^>]*class="squire-answer__content"><\/div>/);
    expect(body).toMatch(/<div[^>]*class="squire-answer__tools"[^>]*aria-live="off"><\/div>/);
    expect(body).toMatch(/class="squire-answer__skeleton"[^>]*aria-hidden="true"/);
    expect(body).toContain('squire-answer__skeleton-dropcap');
    expect(body).toContain('squire-answer__skeleton-line squire-answer__skeleton-line--full');
    expect(body).toContain('squire-answer__skeleton-line squire-answer__skeleton-line--mid');
    expect(body).toContain('squire-answer__skeleton-line squire-answer__skeleton-line--short');
  });
});

describe('renderConversationTranscriptWithPendingTurn', () => {
  it('renders prior turns and appends a pending answer shell for the latest turn', () => {
    const body = String(
      actualLayout.renderConversationTranscriptWithPendingTurn({
        conversationId: 'conv-123',
        streamUrl: '/chat/conv-123/messages/msg-456/stream',
        messages: [
          {
            id: 'm1',
            conversationId: 'conv-123',
            role: 'user',
            content: 'First question',
            isError: false,
            responseToMessageId: null,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
          {
            id: 'm2',
            conversationId: 'conv-123',
            role: 'assistant',
            content: 'First answer.',
            isError: false,
            responseToMessageId: 'm1',
            createdAt: new Date('2026-01-01T00:00:01.000Z'),
          },
          {
            id: 'm3',
            conversationId: 'conv-123',
            role: 'user',
            content: 'Second question',
            isError: false,
            responseToMessageId: null,
            createdAt: new Date('2026-01-01T00:00:02.000Z'),
          },
        ],
      }),
    );

    expect(body).toContain('First question');
    expect(body).toContain('First answer.');
    expect(body).toContain('Second question');
    expect(body).toContain('data-conversation-id="conv-123"');
    expect(body).toContain('data-stream-url="/chat/conv-123/messages/msg-456/stream"');
    expect(body).toMatch(/class="squire-turn squire-answer squire-answer--pending"/);
  });
});

describe('selected-message rendering helpers', () => {
  const messages = [
    {
      id: 'm1',
      conversationId: 'conv-123',
      role: 'user' as const,
      content: 'Oldest question',
      isError: false,
      responseToMessageId: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    {
      id: 'm2',
      conversationId: 'conv-123',
      role: 'assistant' as const,
      content: 'Oldest answer.',
      isError: false,
      responseToMessageId: 'm1',
      createdAt: new Date('2026-01-01T00:00:01.000Z'),
    },
    {
      id: 'm3',
      conversationId: 'conv-123',
      role: 'user' as const,
      content: 'Middle question',
      isError: false,
      responseToMessageId: null,
      createdAt: new Date('2026-01-01T00:00:02.000Z'),
    },
    {
      id: 'm4',
      conversationId: 'conv-123',
      role: 'assistant' as const,
      content: 'Middle answer.',
      isError: false,
      responseToMessageId: 'm3',
      createdAt: new Date('2026-01-01T00:00:03.000Z'),
    },
    {
      id: 'm5',
      conversationId: 'conv-123',
      role: 'user' as const,
      content: 'Newest question',
      isError: false,
      responseToMessageId: null,
      createdAt: new Date('2026-01-01T00:00:04.000Z'),
    },
    {
      id: 'm6',
      conversationId: 'conv-123',
      role: 'assistant' as const,
      content: 'Newest answer.',
      isError: false,
      responseToMessageId: 'm5',
      createdAt: new Date('2026-01-01T00:00:05.000Z'),
    },
  ];

  it('renders a selected earlier question and answer with the EARLIER QUESTION cue', () => {
    const body = String(
      actualLayout.renderSelectedMessageSurface({
        selectedQuestion: messages[2],
        selectedAnswer: messages[3],
        isEarlierQuestion: true,
      }),
    );

    expect(body).toContain('Middle question');
    expect(body).toContain('Middle answer.');
    expect(body).toContain('EARLIER QUESTION');
    expect(body).toMatch(/class="squire-turn squire-question"/);
    expect(body).toMatch(/class="squire-turn squire-answer"/);
  });

  it('omits the EARLIER QUESTION cue when rendering the newest question', () => {
    const body = String(
      actualLayout.renderSelectedMessageSurface({
        selectedQuestion: messages[4],
        selectedAnswer: messages[5],
        isEarlierQuestion: false,
      }),
    );

    expect(body).toContain('Newest question');
    expect(body).toContain('Newest answer.');
    expect(body).not.toContain('EARLIER QUESTION');
  });

  it('renders recent questions newest-to-oldest and excludes the selected question', () => {
    const body = String(
      actualLayout.renderRecentQuestionsNav({
        conversationId: 'conv-123',
        questions: [messages[4], messages[2], messages[0]],
        selectedMessageId: 'm3',
      }),
    );

    expect(body).toContain('Recent questions');
    expect(body).toContain('href="/chat/conv-123/messages/m5"');
    expect(body).toContain('Newest question');
    expect(body).toContain('href="/chat/conv-123/messages/m1"');
    expect(body).toContain('Oldest question');
    expect(body).not.toContain('Middle question');
    expect(body.indexOf('Newest question')).toBeLessThan(body.indexOf('Oldest question'));
  });

  it('hides the recent questions region when there are no eligible prior questions', () => {
    const body = String(
      actualLayout.renderRecentQuestionsNav({
        conversationId: 'conv-123',
        questions: [messages[2]],
        selectedMessageId: 'm3',
      }),
    );

    expect(body).toBe('');
  });

  it('renders the recent questions region as an out-of-band HTMX update when requested', () => {
    const body = String(
      actualLayout.renderRecentQuestionsNav({
        conversationId: 'conv-123',
        questions: [messages[4], messages[0]],
        selectedMessageId: 'm5',
        outOfBand: true,
      }),
    );

    expect(body).toMatch(/<nav[^>]*id="squire-recent-questions"[^>]*hx-swap-oob="outerHTML"/);
    expect(body).toContain('Recent questions');
  });

  it('renders explicit nav items with HTMX attributes when provided', () => {
    const body = String(
      actualLayout.renderRecentQuestionsNav(
        [
          {
            href: '/chat/conv-123/messages/m1',
            hxGet: '/chat/conv-123/messages/m1',
            label: 'Oldest question',
            pushUrl: true,
          },
        ],
        { oob: true },
      ),
    );

    expect(body).toContain('href="/chat/conv-123/messages/m1"');
    expect(body).toContain('hx-get="/chat/conv-123/messages/m1"');
    expect(body).toContain('hx-target="#squire-surface"');
    expect(body).toContain('hx-swap="innerHTML"');
    expect(body).toContain('hx-push-url="true"');
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

  it('renders the 56px masthead monogram on the desktop rail', async () => {
    const body = String(await actualLayout.renderHomePage(testSession, testCsrfToken));
    // The rail gets a second monogram marked as masthead so the 56px size
    // can be tested in the browser. The header monogram stays 28px.
    expect(body).toMatch(
      /<aside[^>]*class="squire-rail"[\s\S]*squire-monogram squire-monogram--masthead/,
    );
  });
});

describe('styles.css — SQR-66 signature component rules', () => {
  const css = readFileSync(new URL('../src/web-ui/styles.css', import.meta.url), 'utf8');

  it('declares .squire-question with Fraunces clamp font-size and line-height 1.25', () => {
    expect(css).toMatch(/\.squire-question\s*\{[^}]*font-family:\s*["']?Fraunces["']?/);
    expect(css).toMatch(/\.squire-question\s*\{[^}]*clamp\(\s*22px\s*,\s*5vw\s*,\s*28px\s*\)/);
    expect(css).toMatch(/\.squire-question\s*\{[^}]*line-height:\s*1\.25/);
  });

  it('styles .squire-answer em as the amber rule-term highlighter at 0.60 alpha, 75% coverage', () => {
    const rule = css.match(/\.squire-answer\s+em\s*\{[^}]*\}/);
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

  it('styles .squire-answer .cite as sepia underline with wax hover + tap-toggle', () => {
    expect(css).toMatch(/\.squire-answer\s+\.cite\s*\{[^}]*color:\s*var\(--sepia\)/);
    expect(css).toMatch(/\.squire-answer\s+\.cite\s*\{[^}]*text-underline-offset:\s*3px/);
    expect(css).toMatch(/\.squire-answer\s+\.cite:hover/);
    expect(css).toMatch(/\.squire-answer\s+\.cite\.is-active\s*\{[^}]*var\(--wax\)/);
  });

  it('declares a guarded .squire-answer first-paragraph drop cap in Fraunces', () => {
    expect(css).toContain('.squire-answer');
    expect(css).toContain('p:first-of-type:not(');
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

describe('GET / — SQR-67 stub regions', () => {
  it('renders the first-run empty state with "At your service." and the scope line', async () => {
    const body = String(await actualLayout.renderHomePage(testSession, testCsrfToken));
    expect(body).toMatch(/<section[^>]*class="squire-empty"/);
    expect(body).toContain('At your service.');
    expect(body).toMatch(/class="squire-empty__scope"/);
    expect(body).toContain('ASK ABOUT A RULE, CARD, ITEM, MONSTER, OR SCENARIO');
  });

  it('renders the spoiler warning banner via the .squire-banner primitive', async () => {
    const body = String(await actualLayout.renderHomePage(testSession, testCsrfToken));
    expect(body).toMatch(/squire-banner squire-banner--spoiler/);
    expect(body).toContain('SPOILER WARNING');
  });

  it('renders the tool-call footer with the CONSULTED placeholder line', async () => {
    const body = String(await actualLayout.renderHomePage(testSession, testCsrfToken));
    expect(body).toMatch(/<footer[^>]*class="squire-toolcall"[\s\S]*CONSULTED · RULEBOOK P\.47/);
  });

  it('renders at least two recent-question chips inside nav.squire-recent', async () => {
    const body = String(await actualLayout.renderHomePage(testSession, testCsrfToken));
    const navMatch = body.match(/<nav[^>]*class="squire-recent"[\s\S]*?<\/nav>/);
    expect(navMatch).not.toBeNull();
    const chips = (navMatch![0].match(/class="squire-chip"/g) || []).length;
    expect(chips).toBeGreaterThanOrEqual(2);
  });

  it('renders the .squire-verdict block with label and picked badge', async () => {
    const body = String(await actualLayout.renderHomePage(testSession, testCsrfToken));
    expect(body).toMatch(/class="squire-verdict"/);
    expect(body).toContain('SQUIRE RECOMMENDS');
    expect(body).toMatch(/class="squire-picked"/);
  });

  it('ships hidden fixtures for the error and sync banner variants', async () => {
    const body = String(await actualLayout.renderHomePage(testSession, testCsrfToken));
    const tpl = body.match(/<template[^>]*id="squire-banner-fixtures"[\s\S]*?<\/template>/);
    expect(tpl).not.toBeNull();
    expect(tpl![0]).toMatch(/squire-banner squire-banner--error/);
    expect(tpl![0]).toMatch(/squire-banner squire-banner--sync/);
    expect(tpl![0]).toContain('SYNCED · 2H AGO');
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

  it('declares .squire-recent .squire-chip with 1px --rule border and 4px radius', () => {
    const rule = css.match(/\.squire-recent\s+\.squire-chip\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    const body = rule![0];
    expect(body).toMatch(/border:\s*1px\s+solid\s+var\(--rule\)/);
    expect(body).toMatch(/border-radius:\s*4px/);
    expect(body).toContain('color: var(--sepia)');
  });

  it('declares .squire-recent__chips as a flex row with an 8px gap', () => {
    const rule = css.match(/\.squire-recent__chips\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    const body = rule![0];
    expect(body).toContain('display: flex');
    expect(body).toContain('gap: 8px');
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
