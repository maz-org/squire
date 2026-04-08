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

import { APP_CSS_HREF, FONT_PRECONNECTS, GOOGLE_FONTS_HREF } from './fonts.ts';

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
export function layoutShell(
  options: LayoutShellOptions = {},
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const preconnects = FONT_PRECONNECTS.map((p) =>
    p.crossorigin
      ? html`<link rel="preconnect" href="${p.href}" crossorigin />`
      : html`<link rel="preconnect" href="${p.href}" />`,
  );

  // SAFETY: `errorBanner.message` is interpolated via hono/html's tagged
  // template, which auto-escapes — safe to receive raw `Error.message`
  // strings from a caught exception. `mainContent` is typed as
  // `HtmlEscapedString` so the compiler guarantees the caller already
  // escaped it (see the LayoutShellOptions doc comment above) — no `raw()`
  // wrap needed, the value flows directly into the template.
  // SQR-66 placeholder content — a hero question above a sample answer
  // that exercises every signature component (drop cap, two rule-term
  // `<em>`s, a citation link). SQR-6 replaces this with real streamed
  // content; until then the shell renders visually complete so QA can
  // verify the stylesheet against docs/design-preview.html. The text is
  // intentionally mundane rather than trying to look like a real ruling
  // so no one mistakes it for a source-of-truth answer.
  const placeholderAnswer = html`<h1 class="squire-question">
      Sample question rendered here by SQR-6.
    </h1>
    <section class="squire-answer" aria-label="Sample answer">
      <p>
        Sometimes a <em>rule term</em> needs emphasis inside the body copy, and sometimes two terms
        like <em>loss condition</em> and <em>round end</em>
        sit on the same line without colliding. Squire cites its sources inline, like the
        <a class="cite" href="#">Rulebook p.47</a> or the scenario book, so you can verify without
        leaving the table.
      </p>
    </section>`;

  const surfaceContent = options.errorBanner
    ? html`<div class="squire-banner squire-banner--error" role="alert">
        <span class="squire-banner__label">SOMETHING WENT WRONG</span>
        <p class="squire-banner__body">${options.errorBanner.message}</p>
      </div>`
    : (options.mainContent ?? placeholderAnswer);

  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>Squire</title>
        ${preconnects}
        <link rel="stylesheet" href="${GOOGLE_FONTS_HREF}" />
        <link rel="stylesheet" href="${APP_CSS_HREF}" />
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
            <footer class="squire-toolcall" aria-live="off"></footer>
            <nav class="squire-recent" aria-label="Recent questions"></nav>
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
          SQR-66 cite tap-toggle (plan-design-review Decision #4). Tap on a
          .squire-answer .cite adds .is-active; tap anywhere else clears it.
          Five lines of vanilla JS — no framework, no dependency. Keyboard
          focus is already covered by the global :focus-visible ring.
        -->
        <script>
          document.addEventListener('click', function (e) {
            var t = e.target;
            var cite = t && t.closest ? t.closest('.squire-answer .cite') : null;
            document.querySelectorAll('.squire-answer .cite.is-active').forEach(function (el) {
              if (el !== cite) el.classList.remove('is-active');
            });
            if (cite) {
              e.preventDefault();
              cite.classList.toggle('is-active');
            }
          });
        </script>
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
export function renderHomePage(): HtmlEscapedString | Promise<HtmlEscapedString> {
  return layoutShell();
}
