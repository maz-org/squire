/**
 * Squire web UI — on-demand asset pipeline (SQR-71, ADR 0009).
 *
 * Compiles `src/web-ui/styles.css` in-process via `@tailwindcss/node`
 * and reads `src/web-ui/squire.js` from disk. Exposes both content
 * getters (`getAppCss` / `getSquireJs`, returning `{content, hash}`)
 * and URL helpers (`getAppCssUrl` / `getSquireJsUrl`) that follow
 * Rails Propshaft semantics:
 *
 *   - **dev**: bare paths, `Cache-Control: no-cache`, mtime-keyed
 *     cache so edits to the source files show up on the next
 *     request without a rebuild. URL helpers return `/app.css`
 *     and `/squire.js`.
 *   - **prod**: content-hashed paths, `Cache-Control: public,
 *     max-age=31536000, immutable`, compile-once-per-process. URL
 *     helpers return `/app.<hash>.css` and `/squire.<hash>.js` so
 *     Cloudflare and browsers can cache forever and invalidation
 *     is automatic on content change.
 *
 * Promise memoization on the compile/read paths collapses two
 * concurrent cold-start callers into a single compile instead of
 * a race. See ADR 0009 (fingerprinting addendum) for the full
 * rationale and the rolling-deploy caveat.
 */

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile, optimize } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_UI_DIR = HERE;
const STYLES_PATH = path.join(WEB_UI_DIR, 'styles.css');
const SQUIRE_JS_PATH = path.join(WEB_UI_DIR, 'squire.js');

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * First 10 hex chars of sha256(content). 40 bits of entropy —
 * collision probability is negligible at Squire deploy cadence, and
 * matches Vite/Webpack's default content-hash length. Rails Propshaft
 * uses longer digests but the trade-off (URL length vs collision
 * safety) favors shorter here.
 */
function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 10);
}

export interface AssetEntry {
  content: string;
  hash: string;
}

// Test-only counters — increment each time the compile/read path
// actually runs. Lets the concurrent-cold-start test prove that
// Promise memoization collapsed two parallel requests into a single
// compile. Reset by _resetAssetCachesForTests.
let cssCompileCount = 0;
let jsReadCount = 0;

// ─── CSS pipeline ────────────────────────────────────────────────────────────

interface CssCache {
  key: string;
  entry: AssetEntry;
}

let cssCache: CssCache | null = null;
let cssInFlight: Promise<AssetEntry> | null = null;

async function computeCssCacheKey(): Promise<string> {
  if (isProd()) return 'static';
  // Dev: key on the styles.css mtime. The Scanner picks up class-name
  // changes in `src/web-ui/**/*.{ts,html}` automatically because it
  // re-scans on every compile call (we deliberately don't cache the
  // Scanner instance for that reason). Keying on the styles.css mtime
  // alone catches the common case (editing the stylesheet) — the
  // Scanner walk dominates the cost either way. Matches the ADR 0009
  // promise: "edit styles.css → next request reflects the edit."
  try {
    const s = await stat(STYLES_PATH);
    return `dev-${s.mtimeMs}`;
  } catch {
    return 'dev-missing';
  }
}

async function compileCssEntry(): Promise<AssetEntry> {
  cssCompileCount += 1;
  const cssSource = await readFile(STYLES_PATH, 'utf8');
  const compiler = await compile(cssSource, {
    base: WEB_UI_DIR,
    onDependency: () => {
      // No-op. Dev invalidation is handled by the mtime cache key
      // and prod compiles exactly once per process.
    },
  });
  // The Scanner walks the project sources (driven by `@source`
  // directives in styles.css) and returns every utility-class
  // candidate present in the codebase. compiler.build() materializes
  // only the classes that were actually used.
  const scanner = new Scanner({ sources: compiler.sources });
  const candidates = scanner.scan();
  let content = compiler.build(candidates);
  if (isProd()) {
    // Minify in prod only — dev keeps the readable form so devtools
    // is useful when poking at computed styles. Source maps are out
    // of scope for SQR-71.
    content = optimize(content, { minify: true }).code;
  }
  return { content, hash: hashContent(content) };
}

/**
 * Compile (or fetch cached) Tailwind CSS for `src/web-ui/styles.css`.
 * Returns `{content, hash}` where `hash` is the content digest used
 * to fingerprint the prod URL.
 *
 * Promise-memoized: two concurrent cold-start callers share a single
 * compile instead of racing to populate the cache twice. The in-flight
 * promise is cleared in `finally` so a failed compile doesn't poison
 * the cache — the next caller will retry.
 *
 * Key-drift guard: if an in-flight compile was started under a
 * different cache key (e.g., a dev caller edited styles.css while
 * another request was mid-compile, bumping the mtime), the later
 * caller verifies after awaiting that the populated cache matches
 * its own key. On mismatch it falls through and starts a fresh
 * compile, so the edit shows up on the next request instead of
 * lingering for one extra hit.
 */
export async function getAppCss(): Promise<AssetEntry> {
  const key = await computeCssCacheKey();
  if (cssCache && cssCache.key === key) return cssCache.entry;
  if (cssInFlight) {
    const entry = await cssInFlight;
    if (cssCache && cssCache.key === key) return entry;
    // Key drifted while we were waiting. Fall through to recompile.
  }

  cssInFlight = (async () => {
    try {
      const entry = await compileCssEntry();
      cssCache = { key, entry };
      return entry;
    } finally {
      cssInFlight = null;
    }
  })();
  return cssInFlight;
}

/**
 * URL to emit in HTML for the app stylesheet. Rails Propshaft
 * semantics: in prod the URL is content-hashed
 * (`/app.<hash>.css`) so Cloudflare and browsers can cache it
 * forever; in dev the URL is the bare `/app.css` path so devtools
 * stays readable and there's no hash-mismatch dance when editing
 * `styles.css`.
 *
 * Triggers a compile on first prod call (to know the hash); dev
 * skips the compile because the bare path is static.
 */
export async function getAppCssUrl(): Promise<string> {
  if (!isProd()) return '/app.css';
  const { hash } = await getAppCss();
  return `/app.${hash}.css`;
}

// ─── JS pipeline ─────────────────────────────────────────────────────────────

interface JsCache {
  key: string;
  entry: AssetEntry;
}

let jsCache: JsCache | null = null;
let jsInFlight: Promise<AssetEntry> | null = null;

async function computeJsCacheKey(): Promise<string> {
  if (isProd()) return 'static';
  try {
    const s = await stat(SQUIRE_JS_PATH);
    return `dev-${s.mtimeMs}`;
  } catch {
    return 'dev-missing';
  }
}

async function readJsEntry(): Promise<AssetEntry> {
  jsReadCount += 1;
  const content = await readFile(SQUIRE_JS_PATH, 'utf8');
  return { content, hash: hashContent(content) };
}

/**
 * Read (or fetch cached) `src/web-ui/squire.js`. No bundling, no
 * transform — vanilla file-read-and-cache. Same Promise memoization,
 * cache-key strategy, and key-drift guard as the CSS pipeline for
 * symmetry.
 */
export async function getSquireJs(): Promise<AssetEntry> {
  const key = await computeJsCacheKey();
  if (jsCache && jsCache.key === key) return jsCache.entry;
  if (jsInFlight) {
    const entry = await jsInFlight;
    if (jsCache && jsCache.key === key) return entry;
    // Key drifted while we were waiting. Fall through to re-read.
  }

  jsInFlight = (async () => {
    try {
      const entry = await readJsEntry();
      jsCache = { key, entry };
      return entry;
    } finally {
      jsInFlight = null;
    }
  })();
  return jsInFlight;
}

/**
 * URL to emit in HTML for the squire.js island. Prod: hashed
 * (`/squire.<hash>.js`). Dev: bare (`/squire.js`).
 */
export async function getSquireJsUrl(): Promise<string> {
  if (!isProd()) return '/squire.js';
  const { hash } = await getSquireJs();
  return `/squire.${hash}.js`;
}

// ─── Test-only hooks ─────────────────────────────────────────────────────────

/**
 * Test-only hook. Vitest re-imports this module per test file, so
 * the caches naturally reset between files, but a single file that
 * exercises env transitions (dev ↔ prod) or the concurrent-compile
 * memoization needs an explicit reset. Also clears the in-flight
 * promise and the compile/read counters.
 */
export function _resetAssetCachesForTests(): void {
  cssCache = null;
  cssInFlight = null;
  cssCompileCount = 0;
  jsCache = null;
  jsInFlight = null;
  jsReadCount = 0;
}

/** Test-only accessor for the CSS compile counter. */
export function _getCssCompileCountForTests(): number {
  return cssCompileCount;
}

/** Test-only accessor for the JS read counter. */
export function _getJsReadCountForTests(): number {
  return jsReadCount;
}
