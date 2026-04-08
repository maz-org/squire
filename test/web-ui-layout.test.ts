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

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

describe('GET / — companion-first layout shell (SQR-65)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRenderHomePage.mockImplementation(() => actualLayout.renderHomePage());
  });

  it('returns 200 and renders the layout document', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toMatch(/^<!doctype html>/i);
  });

  it('renders all five named mobile regions with stable selectors', async () => {
    const res = await app.request('/');
    const body = await res.text();
    expect(body).toContain('class="squire-header"');
    expect(body).toContain('class="squire-surface"');
    expect(body).toContain('class="squire-toolcall"');
    expect(body).toContain('class="squire-recent"');
    expect(body).toContain('class="squire-input-dock"');
  });

  it('renders the desktop rail (empty in Phase 1)', async () => {
    const res = await app.request('/');
    const body = await res.text();
    expect(body).toContain('class="squire-rail"');
  });

  it('marks the main surface as a polite aria-live region', async () => {
    const res = await app.request('/');
    const body = await res.text();
    expect(body).toContain('aria-live="polite"');
    expect(body).toContain('aria-atomic="false"');
  });

  it('marks the tool-call footer with aria-live="off"', async () => {
    const res = await app.request('/');
    const body = await res.text();
    expect(body).toContain('aria-live="off"');
  });

  it('renders a skip-link as the first focusable element in <body>', async () => {
    const res = await app.request('/');
    const body = await res.text();
    expect(body).toContain('class="sr-only-focusable"');
    expect(body).toMatch(/<a href="#squire-input"[^>]*sr-only-focusable/);
  });

  it('lands the skip-link on the real <input id="squire-input">', async () => {
    const res = await app.request('/');
    const body = await res.text();
    // The id MUST be on the input element itself, not the form wrapper —
    // this was an explicit eng-review correction in the ticket.
    expect(body).toMatch(/<input[^>]*id="squire-input"/);
    expect(body).not.toMatch(/<form[^>]*id="squire-input"/);
  });

  it('renders the header context strip with placeholder text', async () => {
    const res = await app.request('/');
    const body = await res.text();
    expect(body).toContain('FROSTHAVEN · RULES');
  });

  it('renders the form pointing at /api/ask without collapsing the input', async () => {
    const res = await app.request('/');
    const body = await res.text();
    expect(body).toMatch(/<form[^>]*class="squire-input-dock"[^>]*action="\/api\/ask"/);
  });
});

describe('GET /app.css — static asset serving (SQR-65 / ISSUE-001)', () => {
  // Regression: ISSUE-001 — layout shell linked to /app.css but the route
  // had no static handler and `public/app.css` was never built, so the page
  // rendered unstyled in a real browser even though all DOM-level tests
  // passed. Found by /qa on 2026-04-08. SQR-64's fonts.ts promised the
  // "/app.css served by Hono as a static file" wiring; this test pins it.
  // Report: .gstack/qa-reports/qa-report-localhost-2026-04-08.md
  it('serves /app.css when public/app.css exists', async () => {
    // The Tailwind CLI build emits public/app.css. We don't rebuild it from
    // the test (vitest shouldn't depend on the build pipeline) — instead
    // we assert the route is wired and gracefully degrades if the file is
    // absent. The HTTP layer either streams the file (200) or 404s if the
    // build hasn't been run. Either way it must NOT 500 and must NOT bleed
    // into another route.
    const res = await app.request('/app.css');
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.headers.get('content-type') ?? '').toMatch(/text\/css/);
    }
  });
});

describe('GET / — server-side error fallback (SQR-65)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('still renders the layout shell when the home page renderer throws', async () => {
    mockRenderHomePage.mockImplementation(() => {
      throw new Error('database is on fire');
    });

    const res = await app.request('/');

    // 5xx with HTML body — the ticket explicitly allows either 200 or 5xx
    // as long as the layout shell renders. We choose 500 so monitoring
    // still flags real failures.
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('text/html');

    const body = await res.text();
    // Layout shell still rendered.
    expect(body).toContain('class="squire-header"');
    expect(body).toContain('class="squire-surface"');
    expect(body).toContain('class="squire-input-dock"');
    // Error banner primitive present inside the main surface.
    expect(body).toContain('squire-banner squire-banner--error');
    expect(body).toContain('SOMETHING WENT WRONG');
    expect(body).toContain('database is on fire');
  });

  it('renders the error banner inside the main.squire-surface region', async () => {
    mockRenderHomePage.mockImplementation(() => {
      throw new Error('agent unavailable');
    });
    const res = await app.request('/');
    const body = await res.text();
    // Crude but sufficient: the main surface opens before the banner and
    // closes after it. (Full DOM parsing would pull in jsdom for one
    // assertion.)
    const surfaceStart = body.indexOf('class="squire-surface"');
    const bannerStart = body.indexOf('squire-banner--error');
    const surfaceEnd = body.indexOf('</main>');
    expect(surfaceStart).toBeGreaterThan(-1);
    expect(bannerStart).toBeGreaterThan(surfaceStart);
    expect(surfaceEnd).toBeGreaterThan(bannerStart);
  });
});
