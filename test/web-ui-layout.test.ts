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
import { mkdir, rm, writeFile } from 'node:fs/promises';

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
import { GENERATED_APP_CSS_PATH, GENERATED_WEB_UI_DIR } from '../src/web-ui/asset-paths.ts';

process.env.SESSION_SECRET = 'test-session-secret-must-be-at-least-32-characters-long';

vi.mock('../src/service.ts', () => ({
  initialize: vi.fn(),
  isReady: vi.fn(),
  ask: vi.fn(),
  askWithResult: vi.fn(),
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

const noCampaignChatContext = {
  activeCampaign: null,
  campaigns: [],
  returnTo: '/',
};

const activeCampaignChatContext = {
  activeCampaign: {
    campaignId: 'campaign-123',
    campaignName: 'Center Table Campaign',
    game: 'frosthaven',
  },
  campaigns: [
    {
      campaignId: 'campaign-123',
      campaignName: 'Center Table Campaign',
      game: 'frosthaven',
    },
  ],
  returnTo: '/',
};

const fixedCampaignChatContext = {
  ...activeCampaignChatContext,
  campaigns: [],
  fixed: true,
};

function testConversationHistory() {
  return {
    rows: [
      {
        id: 'conv-active',
        href: '/chat/conv-active',
        active: true,
        title: 'How does poison interact with healing?',
        preview: 'Trouble connecting. Please try again.',
        gameScope: 'Gloomhaven 2e',
        lastActivityAt: new Date('2026-01-02T00:00:00.000Z'),
        lastActivityLabel: 'Jan 2',
        status: 'running' as const,
      },
      {
        id: 'conv-old',
        href: '/chat/conv-old',
        active: false,
        title: 'How does looting work?',
        preview: 'Loot tokens in your hex are picked up.',
        gameScope: 'Frosthaven',
        lastActivityAt: new Date('2026-01-01T00:00:00.000Z'),
        lastActivityLabel: 'Jan 1',
        status: 'idle' as const,
      },
    ],
    nextCursor: null,
  };
}

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
    expect(body).toContain('<link rel="icon" href="/favicon.png" type="image/png" />');
  });

  it('renders same-origin browser telemetry config without leaking a Sentry DSN', async () => {
    const originalDsn = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = 'https://public@example.sentry.io/123';
    try {
      const body = String(await actualLayout.renderLoginPage());

      expect(body).toContain('name="squire-browser-telemetry"');
      expect(body).toContain('/api/browser-telemetry');
      expect(body).toContain('&quot;enabled&quot;:true');
      expect(body).not.toContain('public@example.sentry.io');
      expect(body).not.toContain('sentry.io/123');
    } finally {
      if (originalDsn === undefined) {
        delete process.env.SENTRY_DSN;
      } else {
        process.env.SENTRY_DSN = originalDsn;
      }
    }
  });

  it('serves the favicon png asset', async () => {
    const res = await app.request('/favicon.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it('serves the Squire wax-seal png asset', async () => {
    const res = await app.request('/squire-wax-seal-s.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it('renders the centered login composition', async () => {
    const res = await app.request('/login');
    const body = await res.text();
    expect(body).toContain('class="squire-auth-page"');
    expect(body).toContain('class="squire-monogram squire-monogram--masthead"');
    expect(body).toContain('class="squire-wordmark squire-wordmark--auth"');
    expect(body).toContain('A HAVEN RULES COMPANION');
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

  it('renders a no-campaign game selector in the chat context and submits the current game with chat forms', async () => {
    const body = String(
      await actualLayout.renderHomePage(testSession, testCsrfToken, {
        chatCampaignContext: noCampaignChatContext,
      }),
    );
    const header = body.match(/<header class="squire-header">[\s\S]*?<\/header>/)?.[0] ?? '';
    const context = body.match(/<section[^>]*class="squire-chat-context"[\s\S]*?<\/section>/)?.[0];

    expect(header).not.toContain('squire-game-picker');
    expect(context).toContain('No campaign selected');
    expect(context).toContain('class="squire-game-picker"');
    expect(context).toContain('aria-label="Active game"');
    expect(context).toMatch(
      /<input[^>]*type="radio"[^>]*name="activeGame"[^>]*value="frosthaven"[^>]*checked/,
    );
    expect(context).toMatch(
      /<input[^>]*type="radio"[^>]*name="activeGame"[^>]*value="gloomhaven-2e"/,
    );
    expect(context).toContain('Frosthaven');
    expect(context).toContain('Gloomhaven 2e');
    expect(body).toMatch(/<input[^>]*type="hidden"[^>]*name="game"[^>]*value="frosthaven"/);
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

  it('renders the authenticated home shell regions with stable selectors', async () => {
    // ADR 0020: the authenticated home page stays a purpose-built landing,
    // but the app shell now has real conversation history. Fake chip rows,
    // verdict/PICKED/spoiler stubs remain absent.
    const body = String(await actualLayout.renderHomePage(testSession, testCsrfToken));
    expect(body).toContain('class="squire-header"');
    expect(body).toContain('class="squire-surface"');
    expect(body).toContain('id="squire-surface"');
    // Source provenance now lives in answer-owned work logs, not page chrome.
    expect(body).not.toContain('class="squire-toolcall"');
    expect(body).toContain('class="squire-input-dock"');
    // SQR-107: the home page no longer renders a recent-questions chip
    // row. Conversation history is now a real app-shell surface.
    expect(body).not.toContain('class="squire-recent"');
    expect(body).not.toContain('id="squire-recent-questions"');
    expect(body).toContain('id="squire-history-shell"');
    expect(body).toContain('class="squire-rail"');
    expect(body).toContain('New chat');
    expect(body).not.toContain('id="squire-run-progress"');
    expect(body).not.toContain('class="squire-run-progress"');
    expect(body).toContain('class="sr-only-focusable"');
    expect(body).toMatch(/<a href="#squire-input"[^>]*sr-only-focusable/);
    expect(body).toMatch(/<textarea[^>]*id="squire-input"/);
    expect(body).not.toMatch(/<input[^>]*id="squire-input"/);
    expect(body).not.toMatch(/<form[^>]*id="squire-input"/);
    expect(body).toMatch(/<form[^>]*class="squire-input-dock"[^>]*action="\/chat"/);
    expect(body).toMatch(/hx-post="\/chat"/);
    expect(body).toMatch(/hx-target="#squire-surface"/);
    expect(body).toMatch(/hx-swap="innerHTML"/);
    expect(body).toMatch(/<input[^>]*type="hidden"[^>]*name="idempotencyKey"[^>]*value=""/);
    expect(body).toMatch(/placeholder="Ask about a rule, card, item, monster, or scenario"/);
    expect(body).toMatch(
      /<button[^>]*type="submit"[^>]*class="squire-input-dock__submit"[^>]*aria-label="Ask"[^>]*>\s*<\/button>/,
    );
  });

  it('renders conversation history rows in the desktop rail and mobile drawer', async () => {
    const body = String(
      await actualLayout.renderHomePage(testSession, testCsrfToken, {
        conversationHistory: testConversationHistory(),
      }),
    );

    expect(body).toContain('id="squire-history-shell"');
    expect(body).toContain('aria-label="Conversation history"');
    expect(body).toContain('aria-label="Recent conversations"');
    expect(body).toContain('aria-controls="squire-history-drawer"');
    expect(body).toContain('id="squire-history-drawer"');
    expect(body).toContain('role="dialog"');
    expect(body).toContain('aria-modal="true"');
    expect(body).toContain('aria-labelledby="squire-history-drawer-title"');
    expect(body).toContain('tabindex="-1"');
    expect(body).toContain('How does poison interact with healing?');
    expect(body).toContain('Trouble connecting. Please try again.');
    expect(body).toContain('Gloomhaven 2e');
    expect(body).toContain('aria-current="page"');
    expect(body).toContain('data-history-status="running"');
    expect(body).toContain('How does looting work?');
    expect(body).toContain('Frosthaven');
  });

  it('renders chat as the primary header surface and keeps history subordinate (SQR-366)', async () => {
    const body = String(
      await actualLayout.renderHomePage(testSession, testCsrfToken, {
        conversationHistory: testConversationHistory(),
        chatCampaignContext: noCampaignChatContext,
      }),
    );
    const header = body.match(/<header class="squire-header">[\s\S]*?<\/header>/)?.[0] ?? '';
    const historyShell = body.match(/<div[^>]*id="squire-history-shell"[\s\S]*?<\/div>/)?.[0] ?? '';

    expect(body.indexOf('<header class="squire-header">')).toBeLessThan(
      body.indexOf('<div class="squire-frame">'),
    );
    expect(body.indexOf('id="squire-history-shell"')).toBeGreaterThan(
      body.indexOf('<div class="squire-frame">'),
    );
    expect(header).toContain('class="squire-app-nav"');
    expect(header).toMatch(/<a[^>]*href="\/"[^>]*aria-current="page"[^>]*>\s*Chat\s*<\/a>/);
    expect(header).toMatch(/<a[^>]*href="\/campaigns"[^>]*>\s*Campaigns\s*<\/a>/);
    expect(body).not.toContain('HAVEN · RULES');
    expect(historyShell).toContain('class="squire-history-title"');
    expect(historyShell).toContain('Conversations');
    expect(historyShell).not.toContain('squire-history-brand');
    expect(historyShell).not.toContain('squire-monogram--masthead');
    expect(historyShell).not.toContain('squire-wordmark');
  });

  it('links the current campaign name from the chat context without a separate campaign action (SQR-366)', async () => {
    const body = String(
      await actualLayout.renderHomePage(testSession, testCsrfToken, {
        chatCampaignContext: activeCampaignChatContext,
      }),
    );
    const context = body.match(/<section[^>]*class="squire-chat-context"[\s\S]*?<\/section>/)?.[0];

    expect(context).toMatch(
      /<a[^>]*class="squire-chat-context__name"[^>]*href="\/campaigns\/campaign-123"[^>]*>\s*Center Table Campaign\s*<\/a>/,
    );
    expect(context).not.toContain('Open campaign');
  });

  it('renders an existing conversation with a fixed campaign context', async () => {
    const body = String(
      await actualLayout.renderConversationPage({
        session: testSession,
        csrfToken: testCsrfToken,
        conversationId: 'conv-123',
        messages: [],
        chatCampaignContext: fixedCampaignChatContext,
      }),
    );
    const context = body.match(/<section[^>]*id="squire-chat-context"[\s\S]*?<\/section>/)?.[0];
    const form = body.match(/<form[^>]*class="squire-input-dock"[\s\S]*?<\/form>/)?.[0] ?? '';

    expect(context).toContain('Conversation campaign');
    expect(context).toContain('Center Table Campaign');
    expect(context).toContain('Frosthaven context for this conversation');
    expect(context).not.toContain('squire-chat-context__switcher');
    expect(context).not.toContain('Change');
    expect(context).not.toContain('Set up campaign');
    expect(form).not.toMatch(/<input[^>]*name="campaignId"/);
  });

  it('keeps campaign context out of the shared app header (SQR-366)', async () => {
    const body = String(
      await actualLayout.renderHomePage(testSession, testCsrfToken, {
        campaignStrip: activeCampaignChatContext.activeCampaign,
        chatCampaignContext: activeCampaignChatContext,
      }),
    );
    const header = body.match(/<header class="squire-header">[\s\S]*?<\/header>/)?.[0] ?? '';

    expect(header).toContain('class="squire-app-nav"');
    expect(header).not.toContain('squire-campaign-strip');
    expect(header).not.toContain('Center Table Campaign');
    expect(body).toContain('class="squire-chat-context"');
    expect(body).toContain('Center Table Campaign');
  });

  it('renders a history search affordance in the desktop rail and mobile drawer', async () => {
    const body = String(
      await actualLayout.renderHomePage(testSession, testCsrfToken, {
        conversationHistory: { ...testConversationHistory(), query: 'poison' },
      }),
    );

    expect(body).toContain('class="squire-history-search"');
    expect(body).toContain('class="squire-history-search__field"');
    expect(body).toContain('name="historyQuery"');
    expect(body).toContain('placeholder="Search history"');
    expect(body).toContain('value="poison"');
    expect(body).toContain('type="hidden" name="historyQuery" value="poison"');
    expect(body.match(/class="squire-history-search"/g)).toHaveLength(2);
  });

  it('does not render the history toggle when the history shell is disabled', async () => {
    const body = String(
      await actualLayout.layoutShell({
        session: testSession,
        csrfToken: testCsrfToken,
        showRail: false,
        conversationHistory: testConversationHistory(),
      }),
    );

    expect(body).not.toContain('id="squire-history-shell"');
    expect(body).not.toContain('class="squire-history-toggle"');
    expect(body).not.toContain('aria-controls="squire-history-drawer"');
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

// SQR-71 serves assets with Rails Propshaft semantics: dev uses bare paths
// with no-cache, prod uses content-hashed paths with immutable caching.
// CSS compiles on demand in dev and is read from a prebuilt Docker artifact
// in prod. Concurrent cold-start requests share one read/compile via Promise
// memoization.
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
    // PNG-backed wax-seal mark. The pending visual is now driven
    // entirely by `data-submitting='true'` on the form + the `disabled`
    // attribute on the button + CSS opacity.
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
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'production');
    await mkdir(GENERATED_WEB_UI_DIR, { recursive: true });
    await writeFile(GENERATED_APP_CSS_PATH, '.squire-monogram{display:block}');
    _resetAssetCachesForTests();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    _resetAssetCachesForTests();
    await rm(GENERATED_WEB_UI_DIR, { recursive: true, force: true });
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

  it('reads prebuilt CSS in prod instead of compiling Tailwind at runtime', async () => {
    const { content } = await getAppCss();

    expect(content).toBe('.squire-monogram{display:block}');
    expect(_getCssCompileCountForTests()).toBe(0);
  });
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
    expect(body).toContain('data-testid="question-turn"');
    expect(body).toContain('data-message-id="msg-456"');
    expect(body).toContain('aria-labelledby="squire-question-label-msg-456"');
    expect(body).toContain(
      '<h2 class="sr-only" id="squire-question-label-msg-456">Your question</h2>',
    );
    expect(body).toContain('Can I loot through a doorway?');
    expect(body).toMatch(
      /<article[^>]*class="squire-turn squire-answer squire-answer--pending"[^>]*data-stream-state="pending"[^>]*data-stream-url="\/chat\/conv-123\/messages\/msg-456\/stream"/,
    );
    expect(body).toContain('data-testid="answer-turn"');
    expect(body).toContain('data-response-to-message-id="msg-456"');
    expect(body).toContain('aria-labelledby="squire-pending-answer-label-msg-456"');
    expect(body).toContain(
      '<h2 class="sr-only" id="squire-pending-answer-label-msg-456">Squire answer</h2>',
    );
    expect(body).toMatch(
      /<div[^>]*class="squire-answer__content squire-markdown"[^>]*data-testid="answer-content"[^>]*><\/div>/,
    );
    expect(body).toContain('class="squire-answer-work"');
    expect(body).toContain('data-testid="answer-progress"');
    expect(body).toContain('data-work-state="idle"');
    expect(body).toContain('class="squire-answer-work__status" data-answer-work-status');
    expect(body).toContain('data-answer-work-status');
    expect(body).toContain('data-answer-work-rows');
    expect(body).toMatch(
      /<button[^>]*type="button"[^>]*class="squire-answer__report"[^>]*data-squire-report-bug/,
    );
    expect(body).toContain('data-user-message-id="msg-456"');
    expect(body).toContain('data-bug-report-default-kind="broken_stream"');
    expect(body).toMatch(
      /<div[^>]*class="squire-answer__artifacts"[^>]*data-testid="answer-artifacts"[^>]*aria-live="polite"><\/div>/,
    );
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
    expect(body).toContain('data-testid="conversation-transcript"');
    expect(body).toContain('data-conversation-id="conv-123"');
  });

  it('renders stable headless-test hooks and named turn articles', () => {
    const body = String(
      actualLayout.renderConversationTranscript({
        conversationId: 'conv-123',
        messages: [
          messages[0]!,
          {
            ...messages[1]!,
            langsmithRunId: '00000000-0000-0000-abcd-0123456789ab',
            langsmithRunUrl:
              'https://smith.langchain.com/o/org/projects/p/project/r/00000000-0000-0000-abcd-0123456789ab?poll=true',
            langsmithTraceUrl:
              'https://smith.langchain.com/o/org/projects/p/project/r/00000000-0000-0000-abcd-0123456789ab?poll=true',
          },
        ],
      }),
    );

    expect(body).toContain('data-testid="conversation-transcript"');
    expect(body).toMatch(
      /<article[^>]*class="squire-turn squire-question"[^>]*data-testid="question-turn"[^>]*data-message-id="m1"[^>]*aria-labelledby="squire-question-label-m1"/,
    );
    expect(body).toContain('<h2 class="sr-only" id="squire-question-label-m1">Your question</h2>');
    expect(body).toMatch(
      /<article[^>]*class="squire-turn squire-answer"[^>]*data-testid="answer-turn"[^>]*data-message-id="m2"[^>]*data-response-to-message-id="m1"[^>]*aria-labelledby="squire-answer-label-m2"/,
    );
    expect(body).toMatch(
      /<button[^>]*type="button"[^>]*class="squire-answer__report"[^>]*data-squire-report-bug[^>]*data-user-message-id="m1"[^>]*data-assistant-message-id="m2"/,
    );
    expect(body).toContain('data-langsmith-run-id="00000000-0000-0000-abcd-0123456789ab"');
    expect(body).toContain(
      'data-langsmith-run-url="https://smith.langchain.com/o/org/projects/p/project/r/00000000-0000-0000-abcd-0123456789ab?poll=true"',
    );
    expect(body).toContain(
      'data-langsmith-trace-url="https://smith.langchain.com/o/org/projects/p/project/r/00000000-0000-0000-abcd-0123456789ab?poll=true"',
    );
    expect(body).toContain('data-bug-report-default-kind="bad_answer"');
    expect(body).toContain('<h2 class="sr-only" id="squire-answer-label-m2">Squire answer</h2>');
    expect(body).toMatch(
      /<div[^>]*class="squire-answer__content squire-markdown"[^>]*data-testid="answer-content"/,
    );
    expect(body).not.toContain('data-testid="consulted-footer"');
    expect(body).not.toContain('class="squire-toolcall"');
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

      const contentStart = body.search(
        /class="squire-answer__content squire-markdown"[^>]*data-testid="answer-content"/,
      );
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

  it('renders the conversation page as a full scrolling transcript with role=log and no recent-questions chrome', async () => {
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
    // ADR 0020: the old recent-questions rail stays gone, but real
    // conversation history is now present in the shell.
    expect(body).toMatch(/id="squire-history-shell"/);
    expect(body).toMatch(/class="squire-rail"/);
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

  it('can include an out-of-band fixed campaign context with the first transcript swap', () => {
    const body = String(
      actualLayout.renderConversationTranscriptWithHistoryOob({
        conversationHistory: testConversationHistory(),
        conversationId: 'conv-123',
        messages: [messages[0]],
        pendingStreamUrls: new Map([['m1', '/chat/conv-123/messages/m1/stream']]),
        chatCampaignContext: fixedCampaignChatContext,
        csrfToken: testCsrfToken,
      }),
    );
    const context = body.match(/<section[^>]*id="squire-chat-context"[\s\S]*?<\/section>/)?.[0];

    expect(context).toMatch(/hx-swap-oob="true"/);
    expect(context).toContain('Conversation campaign');
    expect(context).toContain('Frosthaven context for this conversation');
    expect(context).not.toContain('Change');
    expect(body).toContain('id="squire-history-shell"');
    expect(body).toContain('class="squire-transcript"');
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

  // ADR 0020: the authenticated shell renders real conversation history in
  // the rail/drawer. CSS rule coverage for `.squire-monogram--masthead`
  // sizing is preserved in the `styles.css` block below.
});

describe('styles.css — SQR-66 signature component rules', () => {
  const css = readFileSync(new URL('../src/web-ui/styles.css', import.meta.url), 'utf8');
  const compactCss = css.replace(/\s+/g, '');

  it('uses one conversation-page scroll container so the transcript and ask widget move together (SQR-366)', () => {
    expect(css).toMatch(
      /\.squire-column:has\(> \.squire-surface > \.squire-transcript\)\s*\{[^}]*height:\s*100%[^}]*overflow-y:\s*auto/,
    );
    expect(css).toMatch(
      /\.squire-column:has\(> \.squire-surface > \.squire-transcript\)\s+\.squire-surface\s*\{[^}]*flex:\s*0 0 auto[^}]*overflow:\s*visible/,
    );
    expect(compactCss).not.toContain(
      '.squire-column:has(>.squire-surface>.squire-transcript).squire-surface{min-height:0;overflow-y:auto;',
    );
    expect(css).toMatch(
      /@media\s*\(min-width:\s*1024px\)[\s\S]*\.squire-frame:has\(\.squire-rail\)\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*hidden/,
    );
    expect(css).toMatch(
      /@media\s*\(min-width:\s*1024px\)[\s\S]*\.squire-frame:has\(\.squire-rail\)\s+\.squire-rail\s*\{[^}]*height:\s*100%[^}]*overflow-y:\s*auto/,
    );
  });

  it('keeps the SQR-366 chat nav lightweight and centers the home composer', () => {
    const navRule = css.match(/\.squire-app-nav\s*\{[^}]*\}/)?.[0] ?? '';
    expect(navRule).toContain('background: transparent');
    expect(navRule).not.toContain('border:');
    expect(css).toContain('--squire-content-column-width: 640px');
    expect(css).toContain('--squire-content-inline-padding-desktop: 24px');
    expect(css).toContain('--squire-header-nav-baseline-offset: 5px');
    expect(css).toMatch(/\.squire-header\s*\{[^}]*position:\s*relative/);
    expect(compactCss).toContain(
      '.squire-app-nav{position:absolute;left:max(var(--squire-header-nav-min-left),calc((100vw-var(--squire-content-column-width))/2+var(--squire-content-inline-padding-desktop)));top:calc(50%+var(--squire-header-nav-baseline-offset));',
    );
    expect(compactCss).toContain(
      '.squire-body:has(.squire-rail).squire-app-nav{left:max(var(--squire-header-nav-min-left),calc(var(--squire-rail-width)+max(var(--space-xl),calc((100vw-var(--squire-content-column-width))/2-var(--squire-rail-width)))+var(--squire-content-inline-padding-desktop)));',
    );
    expect(css).toMatch(
      /\.squire-app-nav__link--active\s*\{[^}]*border-bottom-color:\s*var\(--wax\)/,
    );
    expect(css).toMatch(
      /\.squire-column:has\(> \.squire-composer\):not\(:has\(> \.squire-surface > \.squire-transcript\)\)\s+\.squire-composer\s*\{[^}]*position:\s*absolute[^}]*top:\s*50%[^}]*transform:\s*translateY\(-50%\)/,
    );
  });

  it('aligns the desktop chat content column with non-rail pages when space allows (SQR-366)', () => {
    expect(css).toContain('--squire-rail-width: 280px');
    expect(compactCss).toContain(
      '.squire-frame:has(.squire-rail).squire-column:not(.squire-column--wide){margin-left:max(var(--space-xl),calc((100vw-var(--squire-content-column-width))/2-var(--squire-rail-width)));margin-right:auto;',
    );
  });

  it('places history search and ask actions inside their fields (SQR-366)', () => {
    expect(css).toMatch(/\.squire-history-search__field\s*\{[^}]*position:\s*relative/);
    expect(css).toMatch(
      /\.squire-history-search__submit\s*\{[^}]*position:\s*absolute[^}]*right:\s*4px[^}]*bottom:\s*4px/,
    );
    expect(css).toMatch(/\.squire-input-dock\s*\{[^}]*position:\s*relative/);
    expect(css).toMatch(/\.squire-input-dock #squire-input\s*\{[^}]*min-height:\s*112px/);
    expect(css).toMatch(
      /\.squire-input-dock__submit\s*\{[^}]*position:\s*absolute[^}]*right:\s*12px[^}]*bottom:\s*12px/,
    );
  });

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

  it('puts the PNG-backed mark styling on the BASE .squire-monogram', () => {
    // Regression: CodeRabbit on PR #202 caught that the monogram styling
    // was scoped to .squire-header .squire-monogram. The base selector must
    // keep owning the shared brand mark so the desktop rail and auth pages
    // do not drift from the header.
    const baseRule = css.match(/^\.squire-monogram\s*\{[^}]*\}/m);
    expect(baseRule).not.toBeNull();
    const body = baseRule![0];
    expect(body).toContain('display: inline-block');
    expect(body).toContain("url('/squire-wax-seal-s.png')");
    expect(body).toContain('color: transparent');
    expect(body).toContain('overflow: hidden');
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

  it('does not ship the removed source footer in page chrome', async () => {
    const body = String(await actualLayout.renderHomePage(testSession, testCsrfToken));
    expect(body).not.toContain('CONSULTED · RULEBOOK P.47');
    expect(body).not.toContain('SCENARIO BOOK §14');
    expect(body).not.toMatch(/<footer[^>]*class="squire-toolcall"/);
  });

  describe('SQR-98: per-answer source work log', () => {
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

    it('renders a collapsed checked-source work log inside the answer element for a single source', () => {
      const body = renderTranscriptAnswer(answerWith(['search_rules']));
      expect(body).toMatch(
        /class="squire-turn squire-answer"[\s\S]*<details[^>]*class="squire-answer-work"[^>]*data-work-state="complete"[\s\S]*Worked[\s\S]*Checked the rulebook[\s\S]*<\/details>/,
      );
      expect(body).not.toContain('class="squire-answer-work__summary-icon"');
      expect(body).toContain('class="squire-answer-work__row-icon" aria-hidden="true"');
      expect(body).toContain('class="squire-answer-work__summary-caret" aria-hidden="true"');
      expect(body).not.toContain('Work log');
      expect(body).not.toContain('aria-label="Progress detail"');
      expect(body).not.toContain('data-progress-visibility-choice');
      expect(body).not.toContain('CONSULTED');
      expect(body).not.toContain('class="squire-toolcall"');
    });

    it('reloads the completed work timeline from persisted browser-safe stream events', () => {
      const rawRef =
        'card:gloomhaven-2e/monster-stats/gloomhavensecretariat:monster-stat/bandit-archer/0-3';
      const body = renderTranscriptAnswer(
        answerWith(null, {
          publicWorkEvents: [
            {
              sequence: 1,
              event: 'tool-result',
              payload: {
                id: 'search_cards',
                labels: ['CARD INDEX'],
                ok: true,
              },
              createdAt: new Date('2026-04-20T00:00:01.000Z'),
            },
            {
              sequence: 2,
              event: 'tool-progress',
              payload: {
                id: 'resolve_entity-progress-1',
                label: 'REFERENCE',
                message: 'Resolving Bandit Archer',
              },
              createdAt: new Date('2026-04-20T00:00:02.000Z'),
            },
            {
              sequence: 3,
              event: 'tool-progress',
              payload: {
                id: 'search_knowledge-progress-1',
                label: 'REFERENCE',
                message: 'Searching selected sources',
              },
              createdAt: new Date('2026-04-20T00:00:03.000Z'),
            },
            {
              sequence: 4,
              event: 'tool-progress',
              payload: {
                id: 'open_entity-progress-1',
                label: 'REFERENCE',
                message: `Opening ${rawRef}`,
              },
              createdAt: new Date('2026-04-20T00:00:04.000Z'),
            },
            {
              sequence: 5,
              event: 'tool-result',
              payload: {
                id: 'search_rules',
                labels: ['RULEBOOK', 'SECTION BOOK'],
                ok: true,
              },
              createdAt: new Date('2026-04-20T00:00:05.000Z'),
            },
          ],
        }),
      );

      expect(body).toContain('Worked for 0s');
      expect(body).toMatch(
        /Checked Bandit Archer stat card[\s\S]*Searched available sources[\s\S]*Checked the rulebook[\s\S]*Checked the section book/,
      );
      expect(body).not.toContain('SEARCHING');
      expect(body).not.toContain('CHECKED');
      expect(body).not.toContain('class="squire-toolcall"');
      expect(body).not.toContain('class="squire-answer-work__row-note"');
      expect(body).not.toContain(rawRef);
      expect(body).not.toContain('Looked up Bandit Archer');
    });

    it('renders failed unlabeled lookup results with a useful public label', () => {
      const body = renderTranscriptAnswer(
        answerWith(null, {
          publicWorkEvents: [
            {
              sequence: 1,
              event: 'tool-result',
              payload: {
                id: 'lookup_entity',
                name: 'lookup_entity',
                ok: false,
              },
              createdAt: new Date('2026-04-20T00:00:01.000Z'),
            },
            {
              sequence: 2,
              event: 'tool-result',
              payload: {
                id: 'lookup_entity-drifter',
                name: 'lookup_entity',
                ok: false,
                message: 'Resolving Drifter character mat',
              },
              createdAt: new Date('2026-04-20T00:00:02.000Z'),
            },
          ],
        }),
      );

      expect(body).toContain('Couldn&#39;t look up entity');
      expect(body).toContain('Couldn&#39;t resolve Drifter character mat');
      expect(body).not.toContain('Couldn&#39;t check source index');
    });

    it('renders completed persisted work with the elapsed disclosure title', () => {
      const body = renderTranscriptAnswer(
        answerWith(null, {
          createdAt: new Date('2026-04-20T00:08:34.000Z'),
          publicWorkEvents: [
            {
              sequence: 1,
              event: 'tool-progress',
              payload: {
                id: 'search_knowledge-progress-1',
                label: 'RULEBOOK',
                message: 'Searching the rulebook',
              },
              createdAt: new Date('2026-04-20T00:00:01.000Z'),
            },
            {
              sequence: 2,
              event: 'tool-result',
              payload: { id: 'search_knowledge', labels: ['RULEBOOK'], ok: true },
              createdAt: new Date('2026-04-20T00:00:03.000Z'),
            },
          ],
        }),
      );

      expect(body).toContain('Worked for 8m 33s');
      expect(body).not.toContain('Finished working');
      expect(body).toContain('Searched the rulebook');
    });

    it('uses the persisted terminal event time for completed work duration after reload', () => {
      const body = renderTranscriptAnswer(
        answerWith(null, {
          createdAt: new Date('2026-04-20T00:00:01.000Z'),
          workCompletedAt: new Date('2026-04-20T00:00:09.000Z'),
          publicWorkEvents: [
            {
              sequence: 1,
              event: 'tool-progress',
              payload: {
                id: 'search_knowledge-progress-1',
                label: 'RULEBOOK',
                message: 'Searching the rulebook',
              },
              createdAt: new Date('2026-04-20T00:00:01.000Z'),
            },
            {
              sequence: 2,
              event: 'tool-result',
              payload: { id: 'search_knowledge', labels: ['RULEBOOK'], ok: true },
              createdAt: new Date('2026-04-20T00:00:03.000Z'),
            },
          ],
        }),
      );

      expect(body).toContain('Worked for 8s');
      expect(body).not.toContain('Worked for 0s');
    });

    it('replays persisted agent intent rows in the completed work timeline', () => {
      const body = renderTranscriptAnswer(
        answerWith(null, {
          publicWorkEvents: [
            {
              sequence: 1,
              event: 'tool-plan',
              payload: {
                id: 'search_knowledge-plan-1',
                message: "I'll search the rulebook.",
              },
              createdAt: new Date('2026-04-20T00:00:01.000Z'),
            },
            {
              sequence: 2,
              event: 'tool-progress',
              payload: {
                id: 'search_knowledge-progress-1',
                label: 'RULEBOOK',
                message: 'Looking up loot in the rulebook',
              },
              createdAt: new Date('2026-04-20T00:00:02.000Z'),
            },
            {
              sequence: 3,
              event: 'tool-result',
              payload: { id: 'search_knowledge', labels: ['RULEBOOK'], ok: true },
              createdAt: new Date('2026-04-20T00:00:03.000Z'),
            },
            {
              sequence: 4,
              event: 'tool-plan',
              payload: {
                id: 'search_knowledge-plan-2',
                message: "I'll search the scenario book.",
              },
              createdAt: new Date('2026-04-20T00:00:04.000Z'),
            },
            {
              sequence: 5,
              event: 'tool-progress',
              payload: {
                id: 'search_knowledge-progress-2',
                label: 'SCENARIO BOOK',
                message: 'Looking up loot reminders in the scenario book',
              },
              createdAt: new Date('2026-04-20T00:00:05.000Z'),
            },
            {
              sequence: 6,
              event: 'tool-result',
              payload: { id: 'search_knowledge', labels: ['SCENARIO BOOK'], ok: true },
              createdAt: new Date('2026-04-20T00:00:06.000Z'),
            },
          ],
        }),
      );

      expect(body).toContain('Worked for 0s');
      expect(body).toMatch(
        /I&#39;ll search the rulebook\.[\s\S]*Searched the rulebook[\s\S]*I&#39;ll search the scenario book\.[\s\S]*Searched the scenario book/,
      );
      expect(body).toContain('squire-answer-work__row--narrative');
    });

    it('reloads section and scenario lookups as one source-action row', () => {
      const sectionBody = renderTranscriptAnswer(
        answerWith(null, {
          publicWorkEvents: [
            {
              sequence: 1,
              event: 'tool-progress',
              payload: {
                id: 'resolve_entity-progress-1',
                label: 'REFERENCE',
                message: 'Resolving section 67.1',
              },
              createdAt: new Date('2026-04-20T00:00:01.000Z'),
            },
            {
              sequence: 2,
              event: 'tool-plan',
              payload: {
                id: 'open_entity-plan-1',
                message: "I'll look that up in the section book.",
              },
              createdAt: new Date('2026-04-20T00:00:02.000Z'),
            },
            {
              sequence: 3,
              event: 'tool-progress',
              payload: {
                id: 'open_entity-progress-1',
                label: 'REFERENCE',
                message: 'Opening section:gloomhaven-2e/67.1',
              },
              createdAt: new Date('2026-04-20T00:00:03.000Z'),
            },
            {
              sequence: 4,
              event: 'answer-artifact',
              payload: {
                id: 'section-quote-1',
                kind: 'section-quote',
                title: 'Section 67.1',
                body: 'Conclusion',
                sourceLabel: 'SECTION BOOK',
              },
              createdAt: new Date('2026-04-20T00:00:04.000Z'),
            },
            {
              sequence: 5,
              event: 'tool-result',
              payload: { id: 'open_entity', labels: ['SECTION BOOK'], ok: true },
              createdAt: new Date('2026-04-20T00:00:05.000Z'),
            },
          ],
        }),
      );

      expect(sectionBody).toContain('Worked for 0s');
      expect(sectionBody).toMatch(
        /I&#39;ll look that up in the section book\.[\s\S]*Looked up section 67.1 in the section book/,
      );
      expect(sectionBody).not.toContain('Found Section 67.1');
      expect(sectionBody).not.toContain('Checked the section book');

      const scenarioBody = renderTranscriptAnswer(
        answerWith(null, {
          publicWorkEvents: [
            {
              sequence: 1,
              event: 'tool-progress',
              payload: {
                id: 'resolve_entity-progress-1',
                label: 'REFERENCE',
                message: 'Resolving scenario 61',
              },
              createdAt: new Date('2026-04-20T00:00:01.000Z'),
            },
            {
              sequence: 2,
              event: 'tool-plan',
              payload: {
                id: 'open_entity-plan-1',
                message: "I'll look that up in the scenario book.",
              },
              createdAt: new Date('2026-04-20T00:00:02.000Z'),
            },
            {
              sequence: 3,
              event: 'tool-progress',
              payload: {
                id: 'open_entity-progress-1',
                label: 'REFERENCE',
                message: 'Opening gloomhavensecretariat:scenario/061',
              },
              createdAt: new Date('2026-04-20T00:00:03.000Z'),
            },
            {
              sequence: 4,
              event: 'tool-result',
              payload: { id: 'open_entity', labels: ['SCENARIO BOOK'], ok: true },
              createdAt: new Date('2026-04-20T00:00:04.000Z'),
            },
          ],
        }),
      );

      expect(scenarioBody).toContain('Worked for 0s');
      expect(scenarioBody).toMatch(
        /I&#39;ll look that up in the scenario book\.[\s\S]*Looked up scenario 61 in the scenario book/,
      );
      expect(scenarioBody).not.toContain('Checked the scenario book');
      expect(scenarioBody).not.toContain('gloomhavensecretariat:scenario/061');
    });

    it('replays bare section open progress as the same section lookup row', () => {
      const body = renderTranscriptAnswer(
        answerWith(null, {
          publicWorkEvents: [
            {
              sequence: 1,
              event: 'tool-progress',
              payload: {
                id: 'resolve_entity-progress-1',
                label: 'REFERENCE',
                message: 'Looked up section 67.1',
              },
              createdAt: new Date('2026-04-20T00:00:01.000Z'),
            },
            {
              sequence: 2,
              event: 'tool-progress',
              payload: {
                id: 'open_entity-progress-2',
                label: 'REFERENCE',
                message: 'Opening 67.1',
              },
              createdAt: new Date('2026-04-20T00:00:02.000Z'),
            },
            {
              sequence: 3,
              event: 'tool-result',
              payload: { id: 'open_entity', labels: ['SECTION BOOK'], ok: true },
              createdAt: new Date('2026-04-20T00:00:03.000Z'),
            },
          ],
        }),
      );

      expect(body).toContain('Worked for 0s');
      expect(body).toContain('Looked up section 67.1 in the section book');
      expect(body).not.toContain('Opening 67.1');
    });

    it('aggregates multiple tool names into deduped labels, preserving insertion order', () => {
      const body = renderTranscriptAnswer(
        answerWith(['search_rules', 'search_cards', 'search_rules', 'get_card', 'get_section']),
      );
      expect(body).toMatch(
        /Checked the rulebook[\s\S]*Checked the cards[\s\S]*Checked the section book/,
      );
      expect(body).not.toContain('CONSULTED');
      // The RULEBOOK-first ordering is the insertion-order contract — ensure
      // card-source labels don't leapfrog ahead of RULEBOOK just because more
      // card-family tools were called.
      expect(body.indexOf('Checked the rulebook')).toBeLessThan(body.indexOf('Checked the cards'));
    });

    it('renders no source work log when consultedSources is null (pre-SQR-98 rows)', () => {
      const body = renderTranscriptAnswer(answerWith(null));
      expect(body).not.toContain('class="squire-answer-work"');
      expect(body).not.toContain('class="squire-toolcall"');
    });

    it('renders no source work log when the only tool used was a traversal tool', () => {
      // follow_links is a utility/traversal tool — the actual content came
      // from whatever tool resolved the link, so it never contributes a
      // provenance label on its own. An answer that "only" used follow_links
      // shouldn't show any consulted sources.
      const body = renderTranscriptAnswer(answerWith(['follow_links']));
      expect(body).not.toContain('class="squire-answer-work"');
      expect(body).not.toContain('class="squire-toolcall"');
    });

    it('renders no source work log for error messages even if sources exist', () => {
      // An error turn didn't produce a real answer. A source row would imply
      // the error was a sourced answer.
      const body = renderTranscriptAnswer(
        answerWith(['search_rules'], {
          isError: true,
          content: 'Trouble connecting. Please try again.',
        }),
      );
      expect(body).not.toContain('class="squire-answer-work"');
      expect(body).not.toContain('class="squire-toolcall"');
    });

    it('maps scenario-family and section-family tools to the right labels', () => {
      const body = renderTranscriptAnswer(
        answerWith(['find_scenario', 'get_scenario', 'get_section']),
      );
      expect(body).toMatch(/Checked the scenario book[\s\S]*Checked the section book/);
      expect(body).not.toContain('CONSULTED');
    });

    it('renders the pending answer work log without a footer slot', async () => {
      const body = String(
        await actualLayout.renderConversationPage({
          session: testSession,
          csrfToken: testCsrfToken,
          conversationId: 'conv-sqr98',
          messages: [userMessage],
          pendingStreamUrls: new Map([['user-1', '/chat/conv-sqr98/messages/user-1/stream']]),
        }),
      );
      expect(body).toMatch(/squire-answer--pending[\s\S]*class="squire-answer-work"/);
      const pendingAnswer = body.match(/<article[\s\S]*?squire-answer--pending[\s\S]*?<\/article>/);
      expect(pendingAnswer).not.toBeNull();
      expect(pendingAnswer?.[0]).toContain('data-answer-work-status');
      expect(pendingAnswer?.[0]).not.toContain('aria-label="Progress detail"');
      expect(pendingAnswer?.[0]).not.toContain('data-progress-visibility-choice');
      expect(body).not.toContain('class="squire-toolcall"');
      expect(body).not.toContain('data-testid="consulted-footer"');
    });
  });

  it('ships hidden fixtures for the error, status, verdict, and PICKED variants', async () => {
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
    expect(tpl![0]).toContain('SAVED');
    expect(tpl![0]).toContain('Status banner fixture for QA / tests.');
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

  it('does not declare the removed tool-call footer class', () => {
    expect(css).not.toContain('.squire-toolcall');
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
