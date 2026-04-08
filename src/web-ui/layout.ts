/**
 * Squire web UI — companion-first layout shell (SQR-65 / SQR-5b).
 *
 * Ships the five mobile regions + desktop rail described in DESIGN.md
 * §Layout. Empty regions, stable selectors, sticky input dock. Visual polish
 * (monogram glyph, drop cap, rule-term highlighter, populated chips/footer)
 * is intentionally out of scope — later tickets drop content into these
 * slots without refactoring the page grid.
 *
 * Hono's `html` tagged template literal is used instead of JSX/TSX so this
 * project doesn't need to take on a tsconfig `jsx` mode and a `.tsx` build
 * step for one file. The deliverable in SQR-65 calls for "Hono JSX layout
 * template (`src/web-ui/layout.tsx` or equivalent)" — this is the
 * equivalent. The output is identical server-rendered HTML and the function
 * signature stays JSX-shaped (`{ mainContent, errorBanner? }`) so a future
 * migration to TSX is mechanical.
 */

import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

import { getAppCssUrl, getSquireJsUrl } from './assets.ts';
import { FONT_PRECONNECTS, GOOGLE_FONTS_HREF } from './fonts.ts';

export interface LayoutShellOptions {
  /**
   * Slot content rendered inside `main.squire-surface`. Must be an
   * already-escaped `HtmlEscapedString` produced by hono/html's `html`
   * tagged template (or `raw()` if the caller has manually escaped). The
   * type deliberately excludes plain `string` so callers can't accidentally
   * pass user- or LLM-supplied text into the `raw()` unwrap below — the
   * compiler enforces escaping at the call site instead of relying on a
   * comment for safety. See SQR-65 / CodeRabbit review on PR #198.
   */
  mainContent?: HtmlEscapedString;
  /**
   * Server-side error fallback. When set, the layout still renders but
   * `main.squire-surface` contains the error banner instead of the normal
   * `mainContent` slot. Reuses the `.squire-banner.squire-banner--error`
   * primitive (SQR-67) — see DESIGN.md decisions log entry "`.squire-banner`
   * is a reusable primitive."
   */
  errorBanner?: { message: string };
}

/**
 * Render the full HTML document for the companion-first layout. Stable
 * selectors (`squire-header`, `squire-surface`, `squire-toolcall`,
 * `squire-recent`, `squire-input-dock`, `squire-rail`) are guaranteed by
 * the acceptance criteria — later tickets target them by class.
 */
export async function layoutShell(options: LayoutShellOptions = {}): Promise<HtmlEscapedString> {
  const preconnects = FONT_PRECONNECTS.map((p) =>
    p.crossorigin
      ? html`<link rel="preconnect" href="${p.href}" crossorigin />`
      : html`<link rel="preconnect" href="${p.href}" />`,
  );

  // Rails Propshaft semantics (SQR-71, ADR 0011): dev emits bare
  // `/app.css` / `/squire.js` for a clean devtools experience and
  // immediate edit-refresh; prod emits content-hashed paths
  // (`/app.<hash>.css`, `/squire.<hash>.js`) for immutable edge
  // caching. The URL helpers handle both cases — we just await
  // whatever they return and drop it into the template. Fetched in
  // parallel because the two helpers are independent; in dev each
  // call is microseconds (one fs.stat), in prod each is a cache hit
  // after the first request, but that's still one avoidable serial
  // hop per page render.
  const [cssUrl, jsUrl] = await Promise.all([getAppCssUrl(), getSquireJsUrl()]);

  // SAFETY: `errorBanner.message` is interpolated via hono/html's tagged
  // template, which auto-escapes — safe to receive raw `Error.message`
  // strings from a caught exception. `mainContent` is typed as
  // `HtmlEscapedString` so the compiler guarantees the caller already
  // escaped it (see the LayoutShellOptions doc comment above) — no `raw()`
  // wrap needed, the value flows directly into the template.
  //
  // SQR-67 stub content — first-run empty state plus a styled showcase of
  // the signature components SQR-6 / SQR-8 / Phase 5 will later wire to
  // real data (spoiler banner, verdict block, picked-card badge). These
  // are pure visual stubs: no behavior, no state. SQR-6 will swap the
  // empty state for a streaming `.squire-question` + `.squire-answer`
  // pair once there's a current turn. The hidden `<template>` at the end
  // pins the error and sync banner variants so QA and tests can verify
  // their computed CSS without needing to fake an error or wait for the
  // Phase 6 sync feature. Without the fixtures the CSS silently bit-rots.
  const emptyStateAndStubs = html`<section class="squire-empty" aria-label="Welcome">
      <h1 class="squire-question">At your service.</h1>
      <p class="squire-empty__scope">ASK ABOUT A RULE, CARD, ITEM, MONSTER, OR SCENARIO</p>
    </section>
    <div class="squire-banner squire-banner--spoiler" role="note" aria-label="Spoiler warning">
      <span class="squire-banner__label">SPOILER WARNING</span>
      <p class="squire-banner__body">
        Squire's answers may reference unlocked content from your campaign. Ask a narrower question
        to keep the surprise intact.
      </p>
    </div>
    <aside class="squire-verdict" aria-label="Squire recommends">
      <span class="squire-verdict__label">SQUIRE RECOMMENDS</span>
      <p class="squire-verdict__body">
        Phase 5 will render a recommendation here when comparing cards.
        <span class="squire-picked">PICKED</span>
      </p>
    </aside>
    <template id="squire-banner-fixtures" aria-hidden="true">
      <div class="squire-banner squire-banner--error" role="alert">
        <span class="squire-banner__label">SOMETHING WENT WRONG</span>
        <p class="squire-banner__body">Error banner fixture for QA / tests.</p>
      </div>
      <div class="squire-banner squire-banner--sync" role="status">
        <span class="squire-banner__label">SYNCED · 2H AGO</span>
        <p class="squire-banner__body">Sync banner fixture for QA / tests.</p>
      </div>
    </template>`;

  const surfaceContent = options.errorBanner
    ? html`<div class="squire-banner squire-banner--error" role="alert">
        <span class="squire-banner__label">SOMETHING WENT WRONG</span>
        <p class="squire-banner__body">${options.errorBanner.message}</p>
      </div>`
    : (options.mainContent ?? emptyStateAndStubs);

  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>Squire</title>
        ${preconnects}
        <link rel="stylesheet" href="${GOOGLE_FONTS_HREF}" />
        <link rel="stylesheet" href="${cssUrl}" />
      </head>
      <body class="squire-body">
        <a href="#squire-input" class="sr-only-focusable">Skip to ask Squire</a>
        <div class="squire-frame">
          <aside class="squire-rail" aria-label="Squire ledger">
            <span class="squire-monogram squire-monogram--masthead" aria-hidden="true">S</span>
            <span class="squire-wordmark">Squire</span>
          </aside>
          <div class="squire-column">
            <header class="squire-header">
              <span class="squire-monogram" aria-hidden="true">S</span>
              <span class="squire-wordmark">Squire</span>
              <span class="squire-context">FROSTHAVEN · RULES</span>
            </header>
            <main class="squire-surface" aria-live="polite" aria-atomic="false">
              ${surfaceContent}
            </main>
            <footer class="squire-toolcall" aria-live="off">
              CONSULTED · RULEBOOK P.47 · SCENARIO BOOK §14
            </footer>
            <nav class="squire-recent" aria-label="Recent questions">
              <span class="squire-chip">Looting</span>
              <span class="squire-chip">Element infusion</span>
              <span class="squire-chip">Negative scenario effects</span>
            </nav>
            <!--
          SQR-65 ships the structural form only. The action target points
          at /api/ask, which is the eventual endpoint, but the API requires
          Bearer auth and a JSON body — a raw HTML form POST will 401
          today. SQR-6 wires real submission (HTMX + SSE streaming + the
          recent-questions chip row), at which point this form gets
          hx-post, hx-swap, and friends layered on. Do not try to make
          the form work before SQR-6 lands — it is a layout slot.
        -->
            <form class="squire-input-dock" method="post" action="/api/ask">
              <input
                id="squire-input"
                name="question"
                type="text"
                autocomplete="off"
                placeholder="Ask the Squire…"
              />
              <button type="submit" class="squire-input-dock__submit" aria-label="Ask">→</button>
            </form>
          </div>
        </div>
        <!--
          SQR-66 cite tap-toggle, served from /squire.js (dev) or
          /squire.<hash>.js (prod) by the on-demand asset pipeline
          (SQR-71, ADR 0011). Extracted from an inline <script> so
          SQR-61's CSP can drop 'unsafe-inline' for script-src.
          The file lives at src/web-ui/squire.js and ships unbundled.
        -->
        <script src="${jsUrl}" defer></script>
      </body>
    </html>`;
}

/**
 * Default home page renderer. Phase 1 ships the empty layout shell with no
 * content slotted into the main surface — SQR-67 ships the first-run empty
 * state, SQR-6 ships the streaming answer slot. Exported as a separate
 * function so the route handler in `src/server.ts` has a single override
 * point that tests can stub via `vi.mock` to exercise the server-side error
 * fallback branch.
 */
export async function renderHomePage(): Promise<HtmlEscapedString> {
  return layoutShell();
}
