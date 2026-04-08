---
type: ADR
id: "0009"
title: "On-demand asset pipeline via in-process Tailwind JIT"
status: active
supersedes: "0008"
date: 2026-04-08
---

## Context

[ADR 0008](0008-tailwind-cli-for-production-css.md) chose Tailwind CLI
build-at-deploy-time for the Web UI's CSS, with `public/app.css` served
as a static file by Hono. The framing was correct (static CSS file beats
a 350 KB JIT runtime blob from `cdn.tailwindcss.com`), but the
implementation introduced a fragile dev workflow:

- `public/app.css` is `.gitignore`d. Every clone needs `npm run build:css`
  before the server renders correctly.
- After every edit to `src/web-ui/styles.css` the dev has to remember to
  re-run the CLI. Multiple reviewers were bitten by this — see ISSUE-001
  in the SQR-65 PR discussion, where the layout shell rendered unstyled
  in a real browser even though all DOM-level tests passed because the
  build hadn't been run.
- SQR-66 added a ~12-line inline `<script>` to `src/web-ui/layout.ts`
  for the cite tap-toggle. SQR-61 (CSP headers) needs that script
  externalized so `script-src` can drop `'unsafe-inline'`. Building one
  asset pipeline now is cheaper than wiring two later.

ADR 0008 was made before SQR-65 added the static handler complexity and
before SQR-66 introduced inline JS. The trade-off it documented (avoid
Node-side compilation cost) is worth re-evaluating now that
`@tailwindcss/node` exposes a programmatic compile API and the cold-start
cost is small.

## Decision

**Compile CSS in-process at request time.** A new module
`src/web-ui/assets.ts` exposes `getAppCss()` and `getSquireJs()`. The
route handlers in `src/server.ts` for `/app.css` and `/squire.js` call
these functions and stream the result.

- `getAppCss()` reads `src/web-ui/styles.css`, calls
  `compile(...)` from `@tailwindcss/node`, walks the project sources via
  `@tailwindcss/oxide`'s `Scanner`, and returns the built CSS. In
  production the result is minified via `optimize({ minify: true })`.
- `getSquireJs()` reads `src/web-ui/squire.js` from disk. No bundler,
  no transform — vanilla file-read-and-cache. `src/web-ui/squire.js`
  contains the SQR-66 cite tap-toggle that previously lived inline in
  `layout.ts`.
- Both functions cache in module-level variables. The cache key is
  `'static'` in production (compile/read once on first request) and
  `'dev-${mtimeMs}'` of the source file in development, so edits during
  `npm run serve` are picked up on the next request without a rebuild.
- `npm run build:css` and the `@tailwindcss/cli` devDependency are
  removed. `public/app.css` is no longer in `.gitignore` because there
  is no longer a build output to ignore.

## Cold-start cost

Measured locally on Node 24.14.0, MacBook Pro M-series, against the
current `src/web-ui/styles.css` (692 lines, full design-token block):

| Stage | Time |
| --- | --- |
| `import('./src/web-ui/assets.ts')` | ~125 ms |
| First `getAppCss()` (cold compile + scan) | ~38 ms |
| Subsequent `getAppCss()` (cache hit) | <1 ms |
| Compiled CSS payload | 13,897 bytes |

Total time from a cold process to a served `/app.css` response is well
under 200 ms, comfortably under the 300 ms expected upper bound and an
order of magnitude under the 1 s "stop and reconsider" threshold from
SQR-71's acceptance criteria. Cache hits are negligible.

The Tailwind compiler keeps a few MB resident in Node. That cost is
acceptable on the Phase 1 single-instance deploy target — we're not
running this in a serverless function.

## Options considered

- **Compile CSS in-process at request time** (chosen). Eliminates the
  build-step prerequisite, picks up `styles.css` edits on next request
  in dev, and gives us a single asset pipeline for both CSS and JS.
  Costs ~38 ms once per process for the first `/app.css` request.
- **Keep ADR 0008's CLI build, externalize the script separately**:
  preserves the deploy-time CSS build pipeline and adds a separate
  static handler for `/squire.js`. Solves the CSP problem but doesn't
  solve the dev-drift problem for CSS. Two pipelines instead of one.
- **Switch to a full bundler (Vite/esbuild)**: overkill. We have one
  ~20-line vanilla JS file. ARCHITECTURE.md §Stack still says "no
  bundler, no client-side build step" and that stance is correct for
  Phase 1.
- **Keep `cdn.tailwindcss.com` JIT runtime**: still rejected for the
  same reasons as ADR 0008 (350 KB JS blob, mobile CPU, CSP). The
  in-process compile is the same JIT engine running in our trusted Node
  process instead of the user's untrusted browser.

## Consequences

- Fresh clone → `npm install && npm run serve` works. No build step
  required, no "I forgot to build the CSS" trap.
- Edit `src/web-ui/styles.css` in dev → next `/app.css` request reflects
  the edit. No watcher, no rebuild ritual.
- The first `/app.css` request after process start pays a one-time
  ~38 ms compile cost. Behind Cloudflare in production this is hidden
  by edge caching after the first hit; locally it's invisible to
  developers because dev tools cache the response too.
- `@tailwindcss/node` and `@tailwindcss/oxide` become explicit
  devDependencies. They were already transitively pulled in by
  `@tailwindcss/cli`; we're just naming them.
- SQR-61 (CSP headers) is now unblocked. The inline `<script>` in
  `layout.ts` is gone — the layout references `<script src="/squire.js"
  defer></script>` instead, and `script-src 'self'` will allow it.
- Re-evaluate this decision if: the in-process compile cost grows
  meaningfully as styles.css gets bigger, the resident memory becomes a
  problem under multi-tenant deployment (Phase 3+), or we add enough
  client-side JS that a real bundler becomes necessary.

## Advice

SQR-71 framed this as "the dev ergonomics win is worth one programmatic
import," and the measured cold-start cost confirms it. The biggest
surprise was how cheap the Tailwind v4 compile actually is — 38 ms for
the full design system was well below the expected 100–300 ms band, so
the trade-off ADR 0008 worried about (Node-side compilation cost)
turned out to be a non-issue at this scale.
