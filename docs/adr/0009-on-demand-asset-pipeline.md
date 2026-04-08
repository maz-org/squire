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

## Addendum — content-hash fingerprinting (2026-04-08 eng review)

The decision above stopped at "compile in-process, cache in memory"
and left the route handlers serving the bare `/app.css` and
`/squire.js` paths with no `Cache-Control` header. Eng review on the
initial SQR-71 implementation flagged that gap: without an explicit
cache header, Cloudflare's edge cache behavior is implicit and every
browser load re-fetches the CSS. Setting a short `max-age` is a
half-measure (stale-risk vs. cache-efficiency compromise); the
complete answer is content-hash fingerprinting with long-lived
immutable caching, which is what Webpack, Vite, Rails Propshaft, and
Phoenix Asset Pipeline all emit for the same reason. Folded into
SQR-71 rather than spun out as a follow-up so the asset pipeline
ships the complete caching story in one PR.

### Fingerprinting decision

**Prod**: URLs are content-hashed (`/app.<hash>.css`,
`/squire.<hash>.js`), where `<hash>` is the first 10 hex chars of
`sha256(content)`. Responses ship
`Cache-Control: public, max-age=31536000, immutable`. The route
patterns capture the full filename with a regex constraint
(`/:file{app\.[a-f0-9]+\.css}`) so non-hex paths 404 at the Hono
router layer before the handler runs. The handler then checks the
captured filename matches `app.${currentHash}.css` exactly and 404s
on mismatch — a stale HTML page from a previous deploy that still
references the old URL will 404 on its CSS, and the browser
re-fetches the HTML on the next navigation.

**Hono router quirk.** The "obvious" pattern `/app.:hash{[a-f0-9]+}.css`
(parameter with regex constraint followed by a literal suffix) is
*not* supported by Hono 4.12's `RegExpRouter`: single-segment
variants silently 404 even on matching inputs, and multi-segment
variants (`/assets/:hash{...}.css`) throw an uncaught
`TypeError: undefined is not iterable` from
`buildMatcherFromPreprocessedRoutes`. Full-filename regex
constraints (`/:file{app\.[a-f0-9]+\.css}`) work correctly and
remain hex-constrained at the match layer, which is all we
actually needed. Documented here so the next person who reaches
for the "pretty" syntax doesn't lose an hour debugging 404s.

**Dev**: URLs are bare (`/app.css`, `/squire.js`) with
`Cache-Control: no-cache`. This is the Rails Propshaft dev mode
pattern — no hashes in dev URLs, so devtools stays readable, there's
no hash-mismatch dance when editing `styles.css` between requests,
and the mtime-keyed cache from the original ADR still works
unchanged. The hashed routes are registered in the Hono app but
their handlers 404 in dev, so a stray hashed request (e.g., a
copied-from-prod link) fails cleanly instead of silently serving
stale content.

Both route patterns are registered unconditionally; the handlers
branch on `NODE_ENV` at request time. This lets test files stub
`NODE_ENV` per test case via `vi.stubEnv` without having to
re-import the server module, and the branching cost is a single
string compare per request — negligible next to the cache lookup.

### Promise memoization

A secondary gap eng review flagged: two concurrent requests arriving
on a cold process both see `cssCache === null`, both enter the
`compile(...)` path, both pay the 38 ms cost, both allocate a
Tailwind engine. The fix is Promise memoization — store an in-flight
`Promise<AssetEntry> | null` alongside the cache. The first caller
starts the compile and sets the in-flight promise; subsequent
callers await the same promise. On resolution the cache is populated
and the in-flight promise is cleared in a `finally` block so a
failed compile doesn't poison the cache (the next caller retries).

Probability in practice: low, especially behind Cloudflare where
cache-miss fan-out is one request per PoP. But the fix is ~5 lines,
it eliminates a whole class of "why did memory spike on deploy"
forensics, and it makes the concurrent-cold-start behavior
deterministic. Tested via `_getCssCompileCountForTests` — two
parallel `getAppCss()` calls assert the counter is exactly 1.

### URL threading into the layout

`layoutShell` in `src/web-ui/layout.ts` used to read a compile-time
constant (`APP_CSS_HREF = '/app.css'`) from `fonts.ts`. With
fingerprinting the URL is dynamic (depends on content and env), so
the constant is deleted and the layout awaits `getAppCssUrl()` /
`getSquireJsUrl()` internally. `layoutShell` was already returning
`HtmlEscapedString | Promise<HtmlEscapedString>`, so tightening to
`Promise<HtmlEscapedString>` is type-level cleanup rather than an
async propagation — all callers already `await` it.

### Rolling-deploy caveat

Phase 1 ships a single-instance deploy behind Cloudflare, so the
cache-invalidation story is simple: when a deploy starts, the new
process computes a new hash, and the `<link>` URL in the HTML
matches the current compile. Edge cache on the HTML is short-lived
(default browser + CDN heuristics), so the stale-HTML window is
measured in seconds. A brief unstyled flash on first page load
after deploy (old HTML referencing old hash, 404 on CSS) self-heals
on next navigation.

This story breaks in Phase 3+ multi-instance or blue/green deploys.
Two instances compiling in parallel can produce the same content
hash (deterministic) but only if they run the exact same
`@tailwindcss/node` version against the exact same source files. In
practice they will, but the assumption is fragile. The robust
answers for later:

1. **Pre-compile at boot** — run `getAppCss()` once during
   `startServer()` before the listener opens. Guarantees a
   deterministic hash at startup and eliminates first-request
   latency. Trade-off: adds 38 ms to cold-start time, which
   matters for serverless but not for the long-running single-
   instance deploy target.
2. **Per-instance hash broadcast** — each instance computes its
   own hash and the load balancer routes `/app.<hash>.css`
   requests to the matching instance via a sticky-session cookie.
   Overkill for Squire.
3. **Write compiled assets to a shared object store** at deploy
   time and serve via Cloudflare directly — bypasses the Node
   process entirely. The "right" answer at scale but Phase 1
   doesn't need it.

None of these are in scope for SQR-71. Flagged here so the next
deployment-model change knows where to start.

### What this does not solve

- **Subresource Integrity (SRI)**. `<link integrity="sha256-...">`
  is useful for third-party CDN assets but redundant for same-
  origin content that we already trust end-to-end. Skip.
- **Asset versioning in service worker cache**. Squire doesn't have
  a service worker. When one lands, it can key its cache on the
  same content hash.
- **Old-compile retention across deploys**. If an in-flight HTML
  response from deploy N references `/app.<oldhash>.css` and that
  request lands on deploy N+1, the hashed route 404s. Phase 1's
  ~second-long restart behind Cloudflare makes this window narrow
  enough to ignore; flagged above as a Phase 3+ concern.
