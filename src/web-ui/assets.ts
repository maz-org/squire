/**
 * Squire web UI — on-demand asset pipeline (SQR-71, ADR 0009).
 *
 * Compiles `src/web-ui/styles.css` in-process via `@tailwindcss/node` and
 * serves the result at `/app.css`. Reads `src/web-ui/squire.js` from disk
 * and serves it at `/squire.js`. Both responses are cached in module-level
 * variables; in production the cache is permanent (compile once at first
 * request), in development the cache is keyed on source-file mtimes so
 * edits are picked up on the next request without a rebuild.
 *
 * This replaces the prebuilt-static-file pipeline from ADR 0008. The
 * Tailwind CLI build step (`npm run build:css` → `public/app.css`) is
 * gone — every clone now renders correctly without a build prerequisite.
 * See ADR 0009 for the full rationale and the cold-start cost
 * measurement.
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile, optimize } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// `src/web-ui/` resolved from this file. The compiled output and the JS
// asset both live next to it.
const WEB_UI_DIR = HERE;
const STYLES_PATH = path.join(WEB_UI_DIR, 'styles.css');
const SQUIRE_JS_PATH = path.join(WEB_UI_DIR, 'squire.js');

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

interface CssCacheEntry {
  key: string;
  css: string;
}

let cssCache: CssCacheEntry | null = null;

async function computeCssCacheKey(): Promise<string> {
  if (isProd()) return 'static';
  // Dev: key on the styles.css mtime. The Scanner picks up class-name
  // changes in `src/web-ui/**/*.{ts,html}` automatically because it
  // re-scans on every compile call (we deliberately don't cache the
  // Scanner instance for that reason). Keying on the styles.css mtime
  // alone catches the common case (editing the stylesheet) and means
  // the worst-case dev cost is one recompile per request when nothing
  // has changed in styles.css — the Scanner walk dominates either way.
  // If this proves too cache-friendly in practice we can fold a glob
  // walk in here later, but the simple key matches the ADR 0009 promise
  // ("edit styles.css → next request reflects the edit").
  try {
    const s = await stat(STYLES_PATH);
    return `dev-${s.mtimeMs}`;
  } catch {
    return 'dev-missing';
  }
}

/**
 * Compile and return the Tailwind CSS for `src/web-ui/styles.css`. Cached
 * in memory; see `computeCssCacheKey` for the dev cache-bust strategy.
 *
 * Exported for tests and the route handler. Callers should treat the
 * returned string as opaque — content-type and caching headers belong to
 * the route layer in `src/server.ts`.
 */
export async function getAppCss(): Promise<string> {
  const key = await computeCssCacheKey();
  if (cssCache && cssCache.key === key) return cssCache.css;

  const cssSource = await readFile(STYLES_PATH, 'utf8');
  const compiler = await compile(cssSource, {
    base: WEB_UI_DIR,
    onDependency: () => {
      // No-op. We don't need watch-mode dependency tracking — the
      // mtime cache key handles dev invalidation, and prod compiles
      // exactly once.
    },
  });

  // The Scanner walks the project sources (driven by `@source` directives
  // in styles.css) and returns every utility-class candidate present in
  // the codebase. compiler.build() then materializes only the classes
  // that were actually used.
  const scanner = new Scanner({ sources: compiler.sources });
  const candidates = scanner.scan();
  let css = compiler.build(candidates);

  if (isProd()) {
    // Minify in prod only — dev keeps the readable form so devtools is
    // useful when poking at computed styles. Source maps are out of
    // scope for SQR-71 (see "Out of scope" in the ticket).
    css = optimize(css, { minify: true }).code;
  }

  cssCache = { key, css };
  return css;
}

interface JsCacheEntry {
  key: string;
  js: string;
}

let jsCache: JsCacheEntry | null = null;

/**
 * Read and return `src/web-ui/squire.js`. No bundling, no transform —
 * just file-read-and-cache. The same dev mtime key strategy as the CSS
 * pipeline applies, so edits during `npm run serve` show up on the
 * next request.
 */
export async function getSquireJs(): Promise<string> {
  let key: string;
  if (isProd()) {
    key = 'static';
  } else {
    try {
      const s = await stat(SQUIRE_JS_PATH);
      key = `dev-${s.mtimeMs}`;
    } catch {
      key = 'dev-missing';
    }
  }
  if (jsCache && jsCache.key === key) return jsCache.js;

  const js = await readFile(SQUIRE_JS_PATH, 'utf8');
  jsCache = { key, js };
  return js;
}

/**
 * Test-only hook. Vitest re-imports this module per test file, so the
 * caches naturally reset between files, but a single file that exercises
 * both prod and dev branches needs an explicit reset to avoid bleed.
 */
export function _resetAssetCachesForTests(): void {
  cssCache = null;
  jsCache = null;
}
