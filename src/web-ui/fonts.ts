/**
 * Squire web UI — font loading constants.
 *
 * SQR-64 defines the Google Fonts URL and preconnect hosts; SQR-5b wires
 * them into the actual Hono JSX layout markup (out of scope for this
 * ticket). Keeping the URL in one place means the later layout ticket can
 * import it instead of re-deriving it, and a single grep finds the font
 * load in the codebase.
 *
 * URL axes per DESIGN.md §Typography:
 *   - Fraunces: opsz 9..144, wght 300..900, SOFT 30..100
 *   - Geist:    wght 100..900
 * Both subset to Latin (Google Fonts default) with `display=swap` and
 * served with preconnect hints to fonts.googleapis.com and
 * fonts.gstatic.com (the latter requires `crossorigin`).
 *
 * The app stylesheet URL is no longer a compile-time constant — it is
 * computed at render time by `getAppCssUrl()` in `assets.ts` because
 * SQR-71 / ADR 0011 fingerprints the prod URL with the content hash.
 * Importers in `layout.ts` await the URL helper instead of reading a
 * constant from this module.
 */

export const GOOGLE_FONTS_HREF =
  'https://fonts.googleapis.com/css2?' +
  'family=Fraunces:opsz,wght,SOFT@9..144,300..900,30..100&' +
  'family=Geist:wght@100..900&' +
  'display=swap';

export const FONT_PRECONNECTS = [
  { href: 'https://fonts.googleapis.com', crossorigin: false },
  { href: 'https://fonts.gstatic.com', crossorigin: true },
] as const;
