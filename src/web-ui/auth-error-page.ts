/**
 * Auth error page for the Google OAuth browser flow (SQR-38).
 *
 * Renders a full-page error using the project layout shell so auth errors
 * get the same fonts, colors, dark background, and header as the rest of
 * Squire. A user hitting a sign-in error should not land on a different
 * visual planet.
 *
 * Uses `layoutShell({ mainContent })` with a `.squire-banner--error` block
 * plus auth-specific navigation (try again, back to home). The `errorBanner`
 * option on layoutShell was designed for in-flow server errors, not
 * standalone pages with their own CTAs.
 *
 * This file lives in `src/web-ui/` because it's a page component, not
 * routing logic. `server.ts` calls it and returns the result via `c.html()`.
 */

import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

import { layoutShell } from './layout.ts';
import type { Session } from '../db/repositories/types.ts';

export interface AuthErrorPageOptions {
  /** Human-readable error message. Auto-escaped by hono/html template. */
  message: string;
  /** Current session, if any. Auth error pages are typically pre-session (undefined). */
  session?: Session;
  /** Short machine-readable label shown above the message. */
  label?: string;
  /** URL for the primary retry action. Defaults to /auth/google/start. */
  retryUrl?: string;
  /** Label for the retry button. Defaults to "Try again". */
  retryLabel?: string;
}

/**
 * Render a full-page auth error in the Squire design system.
 *
 * Returns the complete HTML document (layout shell + error content).
 * The caller passes the result to `c.html(result, status)`.
 */
export async function renderAuthErrorPage(
  options: AuthErrorPageOptions,
): Promise<HtmlEscapedString> {
  const {
    message,
    label = 'SIGN IN ERROR',
    retryUrl = '/auth/google/start',
    retryLabel = 'Try again',
  } = options;

  // Guard against javascript: URI injection and protocol-relative URLs
  // (//evil.com) in the retry link. Must be a single-slash relative path.
  if (retryUrl && (!retryUrl.startsWith('/') || retryUrl.startsWith('//'))) {
    throw new Error('retryUrl must be a relative path starting with /');
  }

  // The error banner + navigation links as the main surface content.
  // Uses the same .squire-banner--error component from DESIGN.md,
  // plus a nav block with the retry CTA and a home link styled to
  // match the design system (sepia text, underline offset, ghost style).
  //
  // Type assertion: html`` returns HtmlEscapedString | Promise<...> in
  // Hono's overloaded types, but all interpolations here are plain strings
  // so the result is always synchronous. The cast avoids a false-positive
  // type error on layoutShell's mainContent parameter.
  const content = html`
    <div class="squire-banner squire-banner--error" role="alert">
      <span class="squire-banner__label">${label}</span>
      <p class="squire-banner__body">${message}</p>
    </div>
    <nav
      class="squire-auth-error-nav"
      style="
        margin-top: 24px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
      "
    >
      <a
        href="${retryUrl}"
        class="squire-submit"
        style="display: inline-flex; text-decoration: none; padding: 10px 24px;"
        >${retryLabel}</a
      >
      <a
        href="/"
        style="
          color: var(--sepia, #9a8d74);
          text-decoration: underline;
          text-underline-offset: 3px;
          font-size: 14px;
          font-family: var(--font-body, 'Geist', sans-serif);
        "
        >Back to home</a
      >
    </nav>
  `;

  return await layoutShell({ mainContent: content as HtmlEscapedString, session: options.session });
}
