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

import { getAppCssUrl, getHtmxJsUrl, getSquireJsUrl } from './assets.ts';
import { renderAssistantContent } from './assistant-content.ts';
import { aggregateSourceLabels, formatConsultedFooter } from './consulted-footer.ts';
import { CSRF_FORM_FIELD_NAME, CSRF_HEADER_NAME, CSRF_META_NAME } from './csrf.ts';
import { FONT_PRECONNECTS, GOOGLE_FONTS_HREF } from './fonts.ts';
import {
  SUPPORTED_MARKDOWN_FEATURES,
  SUPPORTED_MARKDOWN_SPECIMEN,
  UNSUPPORTED_MARKDOWN_FEATURES,
  UNSUPPORTED_MARKDOWN_SPECIMEN,
} from './markdown-styleguide.ts';
import type { ConversationMessage, Session } from '../db/repositories/types.ts';

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
  /**
   * Current session (with user), if authenticated. When present, the layout
   * renders the full interaction surface (sidebar, input dock, recent
   * questions). When absent, renders brand-only chrome (header, monogram,
   * fonts, colors). The layout never touches the Hono context or DB.
   */
  session?: Session;
  /**
   * Per-session CSRF token for mutating web UI routes. Rendered into the
   * document head and inherited by HTMX requests via `hx-headers`.
   */
  csrfToken?: string;
  chatFormAction?: string;
  chatFormHiddenFields?: Array<{ name: string; value: string }>;
  /**
   * HTMX swap target selector for the input dock form. Home / first-submit
   * surfaces use `#squire-surface` + `innerHTML` so the landing is replaced
   * by the new transcript. The conversation page (ADR 0012) flips to
   * `.squire-transcript` + `beforeend` so each follow-up appends one new
   * turn instead of replacing the surface.
   */
  chatFormHxTarget?: string;
  chatFormHxSwap?: string;
  recentQuestionsNav?: HtmlEscapedString;
  showRail?: boolean;
  showChatChrome?: boolean;
  headerContext?: string;
  columnClassName?: string;
}

export interface RecentQuestionNavItem {
  href: string;
  label: string;
  hxGet?: string;
  pushUrl?: boolean;
}

export interface SelectedMessageSurfaceOptions {
  selectedQuestion: ConversationMessage;
  selectedAnswer: ConversationMessage;
  isEarlierQuestion: boolean;
}

const VISIBLE_RECENT_QUESTION_LIMIT = 3;

interface DocumentOptions {
  bodyContent: HtmlEscapedString;
  bodyClass?: string;
  authenticated?: boolean;
  csrfToken?: string;
}

function getDisplayName(session: Session): string {
  return session.user.name?.trim() || session.user.email;
}

function getAvatarFallbackLabel(session: Session): string {
  return (session.user.name?.trim() || session.user.email).slice(0, 1).toUpperCase();
}

function renderAccountMenu(session: Session, csrfToken: string): HtmlEscapedString {
  const displayName = getDisplayName(session);

  return html`<details class="squire-account-menu">
    <summary class="squire-account-menu__trigger" aria-label="Open account menu for ${displayName}">
      ${session.user.avatarUrl
        ? html`<img
            class="squire-account-menu__avatar"
            src="${session.user.avatarUrl}"
            alt="${displayName}"
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
          />`
        : html`<span class="squire-account-menu__avatar-fallback" aria-hidden="true">
            ${getAvatarFallbackLabel(session)}
          </span>`}
    </summary>
    <div class="squire-account-menu__panel">
      <section class="squire-account-menu__group" aria-label="Internal tools">
        <span class="squire-account-menu__group-label">Internal tools</span>
        <a class="squire-account-menu__item" href="/styleguide/markdown">Markdown styleguide</a>
      </section>
      <section class="squire-account-menu__group" aria-label="Account">
        <span class="squire-account-menu__group-label">Account</span>
        <form method="post" action="/auth/logout" class="squire-account-menu__form">
          <input type="hidden" name="${CSRF_FORM_FIELD_NAME}" value="${csrfToken}" />
          <button type="submit" class="squire-account-menu__item squire-account-menu__item--button">
            Log out
          </button>
        </form>
      </section>
    </div>
  </details>` as HtmlEscapedString;
}

async function renderDocument(options: DocumentOptions): Promise<HtmlEscapedString> {
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
  // whatever they return and drop them into the document. Fetched
  // in parallel because the CSS and JS helpers are independent.
  const [cssUrl, htmxUrl, jsUrl] = await Promise.all([
    getAppCssUrl(),
    getHtmxJsUrl(),
    getSquireJsUrl(),
  ]);

  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="htmx-config" content='{"includeIndicatorStyles":false}' />
        <title>Squire</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        ${options.csrfToken
          ? html`<meta name="${CSRF_META_NAME}" content="${options.csrfToken}" />`
          : html``}
        ${preconnects}
        <link rel="stylesheet" href="${GOOGLE_FONTS_HREF}" />
        <link rel="stylesheet" href="${cssUrl}" />
      </head>
      <body
        class="${options.bodyClass ?? 'squire-body'}"
        ${options.authenticated && options.csrfToken
          ? html`hx-headers='{"${CSRF_HEADER_NAME}":"${options.csrfToken}"}'`
          : html``}
      >
        ${options.bodyContent}
        <script src="${htmxUrl}" defer></script>
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

function renderQuestionTurn(
  content: string,
  options: { eyebrowLabel?: string } = {},
): HtmlEscapedString {
  return html`<article class="squire-turn squire-question">
    ${options.eyebrowLabel
      ? html`<span class="squire-question__eyebrow">${options.eyebrowLabel}</span>`
      : html``}
    <p>${content}</p>
  </article>` as HtmlEscapedString;
}

function renderAnswerContent(content: HtmlEscapedString): HtmlEscapedString {
  return html`<div class="squire-answer__content squire-markdown">
    ${content}
  </div>` as HtmlEscapedString;
}

function renderMarkdownSpecimenCard(options: {
  title: string;
  description: string;
  source: string;
  rendered: HtmlEscapedString;
}): HtmlEscapedString {
  return html`<section class="squire-styleguide__specimen">
    <div class="squire-styleguide__specimen-header">
      <h2 class="squire-styleguide__specimen-title">${options.title}</h2>
      <p class="squire-styleguide__specimen-copy">${options.description}</p>
    </div>
    <div class="squire-styleguide__specimen-grid">
      <section class="squire-styleguide__panel" aria-label="${options.title} markdown source">
        <span class="squire-styleguide__panel-label">Markdown</span>
        <pre><code>${options.source}</code></pre>
      </section>
      <section class="squire-styleguide__panel" aria-label="${options.title} rendered output">
        <span class="squire-styleguide__panel-label">Rendered</span>
        <section class="squire-styleguide__rendered squire-markdown">${options.rendered}</section>
      </section>
    </div>
  </section>` as HtmlEscapedString;
}

// SQR-98: single source of truth for the hidden footer slot. The JS in
// squire.js finds the footer via `answerEl.querySelector('.squire-toolcall')`
// on every turn — pending, completed with no sources, completed with sources.
// If the hidden-state markup diverges between the pending skeleton and the
// render path, squire.js could miss the element and silently fail to
// populate on `done`. Collapsing to one constant locks the contract.
const HIDDEN_CONSULTED_FOOTER = html`<footer
  class="squire-toolcall"
  aria-live="off"
  hidden
></footer>` as HtmlEscapedString;

function renderConsultedFooter(message: ConversationMessage): HtmlEscapedString {
  // SQR-98: hydrate the consulted-sources footer from persisted tool names
  // on this message. Null, empty, or all-null-mapped sources → hidden.
  // Error messages never show a footer (the turn didn't produce an answer).
  if (message.isError || !message.consultedSources || message.consultedSources.length === 0) {
    return HIDDEN_CONSULTED_FOOTER;
  }
  const labels = aggregateSourceLabels(message.consultedSources);
  if (labels.length === 0) {
    return HIDDEN_CONSULTED_FOOTER;
  }
  return html`<footer class="squire-toolcall" aria-live="off">
    ${formatConsultedFooter(labels)}
  </footer>` as HtmlEscapedString;
}

function renderAnswerTurn(message: ConversationMessage): HtmlEscapedString {
  const content = message.isError
    ? (html`<p>${message.content}</p>` as HtmlEscapedString)
    : renderAssistantContent(message.content);
  return html`<article
    class="squire-turn squire-answer${message.isError ? ' squire-answer--error' : ''}"
  >
    ${renderAnswerContent(content)} ${renderConsultedFooter(message)}
  </article>` as HtmlEscapedString;
}

function renderPendingAnswerSkeleton(streamUrl: string): HtmlEscapedString {
  // ADR 0012: the pending answer is the unit of streaming. The stream URL
  // moves from the (deleted) `.squire-transcript--pending` wrapper onto the
  // `<article class="squire-answer--pending">` itself, so squire.js can find
  // the active stream regardless of whether the article was rendered as part
  // of a full transcript or appended via `hx-swap="beforeend"`.
  return html`<article
    class="squire-turn squire-answer squire-answer--pending"
    data-stream-state="pending"
    data-stream-url="${streamUrl}"
  >
    <div class="squire-answer__content squire-markdown"></div>
    <div class="squire-answer__tools" aria-live="off"></div>
    <div class="squire-answer__skeleton" aria-hidden="true">
      <div class="squire-answer__skeleton-dropcap"></div>
      <div class="squire-answer__skeleton-line squire-answer__skeleton-line--full"></div>
      <div class="squire-answer__skeleton-line squire-answer__skeleton-line--mid"></div>
      <div class="squire-answer__skeleton-line squire-answer__skeleton-line--short"></div>
    </div>
    ${HIDDEN_CONSULTED_FOOTER}
  </article>` as HtmlEscapedString;
}

function renderRecentQuestionChip(options: {
  href: string;
  label: string;
  hxGet?: string;
  pushUrl?: boolean;
}): HtmlEscapedString {
  return html`<a
    class="squire-chip"
    href="${options.href}"
    title="${options.label}"
    ${options.hxGet ? html`hx-get="${options.hxGet}"` : html``}
    ${options.hxGet ? html`hx-target="#squire-surface"` : html``}
    ${options.hxGet ? html`hx-swap="innerHTML"` : html``}
    ${options.hxGet && options.pushUrl ? html`hx-push-url="true"` : html``}
  >
    ${options.label}
  </a>` as HtmlEscapedString;
}

function renderRecentQuestionsOverflow(options: {
  hiddenChipCount: number;
  chips: HtmlEscapedString[];
}): HtmlEscapedString {
  const questionLabel = options.hiddenChipCount === 1 ? 'question' : 'questions';
  const summaryLabel = `${options.hiddenChipCount} older ${questionLabel}`;

  return html`<details class="squire-recent__overflow">
    <summary class="squire-chip squire-chip--overflow" aria-label="Show ${summaryLabel}">
      <span class="squire-chip__overflow-copy">More history</span>
      <span class="squire-chip__overflow-count">${summaryLabel}</span>
    </summary>
    <div class="squire-recent__overflow-panel">${options.chips}</div>
  </details>` as HtmlEscapedString;
}

function renderRecentQuestionsContainer(options: {
  visibleChips: HtmlEscapedString[];
  overflowChips?: HtmlEscapedString[];
  hidden?: boolean;
  outOfBand?: boolean;
}): HtmlEscapedString {
  return html`<nav
    id="squire-recent-questions"
    class="squire-recent"
    aria-label="Recent questions"
    ${options.outOfBand ? html`hx-swap-oob="outerHTML"` : html``}
    ${options.hidden ? html`hidden` : html``}
  >
    <span class="squire-recent__label">Recent questions</span>
    <div class="squire-recent__chips">${options.visibleChips}</div>
    ${options.overflowChips && options.overflowChips.length > 0
      ? renderRecentQuestionsOverflow({
          hiddenChipCount: options.overflowChips.length,
          chips: options.overflowChips,
        })
      : html``}
  </nav>` as HtmlEscapedString;
}

// SQR-108 dropped the typed-options overload (`renderRecentQuestionsNav({
// conversationId, questions, selectedMessageId, outOfBand })`) — the
// production caller in `src/server.ts` uses the array-form, and the typed
// overload was test-only. PR 3 retires the legacy `/messages/:mid` route
// entirely, at which point this whole helper goes too.
export function renderRecentQuestionsNav(
  items: RecentQuestionNavItem[],
  options?: { oob?: boolean },
): HtmlEscapedString {
  return renderRecentQuestionsContainer({
    visibleChips: items.slice(0, VISIBLE_RECENT_QUESTION_LIMIT).map((item) =>
      renderRecentQuestionChip({
        href: item.href,
        hxGet: item.hxGet,
        label: item.label,
        pushUrl: item.pushUrl,
      }),
    ),
    overflowChips: items.slice(VISIBLE_RECENT_QUESTION_LIMIT).map((item) =>
      renderRecentQuestionChip({
        href: item.href,
        hxGet: item.hxGet,
        label: item.label,
        pushUrl: item.pushUrl,
      }),
    ),
    hidden: items.length === 0,
    outOfBand: options?.oob,
  });
}

export function renderSelectedMessageSurface(
  options: SelectedMessageSurfaceOptions,
): HtmlEscapedString {
  return html`<section class="squire-transcript" aria-label="Conversation transcript">
    ${renderQuestionTurn(options.selectedQuestion.content, {
      eyebrowLabel: options.isEarlierQuestion ? 'EARLIER QUESTION' : undefined,
    })}
    ${renderAnswerTurn(options.selectedAnswer)}
  </section>` as HtmlEscapedString;
}
/**
 * Render the full HTML document for the companion-first layout. Stable
 * selectors (`squire-header`, `squire-surface`, `squire-toolcall`,
 * `squire-recent`, `squire-input-dock`, `squire-rail`) are guaranteed by
 * the acceptance criteria — later tickets target them by class.
 */
export async function layoutShell(options: LayoutShellOptions = {}): Promise<HtmlEscapedString> {
  // The layout adapts chrome based on whether a session was provided.
  // Session present = logged in = full chrome. Absent = brand only.
  const authenticated = options.session !== undefined;
  const showRail = options.showRail ?? authenticated;
  const showChatChrome = options.showChatChrome ?? authenticated;
  const csrfToken = options.csrfToken;
  if (authenticated && !csrfToken) {
    throw new Error('layoutShell requires a csrfToken when rendering authenticated chrome');
  }
  const authenticatedCsrfToken = csrfToken ?? '';
  const chatFormAction = options.chatFormAction ?? '/chat';
  const chatFormHxTarget = options.chatFormHxTarget ?? '#squire-surface';
  const chatFormHxSwap = options.chatFormHxSwap ?? 'innerHTML';
  const headerContext = options.headerContext ?? 'FROSTHAVEN · RULES';
  const columnClassName = options.columnClassName ?? 'squire-column';
  const chatFormHiddenFields = [
    ...(csrfToken ? [{ name: CSRF_FORM_FIELD_NAME, value: csrfToken }] : []),
    ...(options.chatFormHiddenFields ?? []),
  ];
  // SAFETY: `errorBanner.message` is interpolated via hono/html's tagged
  // template, which auto-escapes — safe to receive raw `Error.message`
  // strings from a caught exception. `mainContent` is typed as
  // `HtmlEscapedString` so the compiler guarantees the caller already
  // escaped it (see the LayoutShellOptions doc comment above) — no `raw()`
  // wrap needed, the value flows directly into the template.
  const surfaceContent = options.errorBanner
    ? html`<div class="squire-banner squire-banner--error" role="alert">
        <span class="squire-banner__label">SOMETHING WENT WRONG</span>
        <p class="squire-banner__body">${options.errorBanner.message}</p>
      </div>`
    : (options.mainContent ?? (html`` as HtmlEscapedString));
  // SQR-107 / ADR 0012: `layoutShell` no longer owns an empty-state
  // fallback. `renderHomePage` now supplies its own purpose-built
  // landing (hero + scope + input dock) via `mainContent`, and error
  // fallbacks render with `errorBanner`. The old hardcoded
  // recent-questions default (Looting / Element infusion / Negative
  // scenario effects) was dishonest placeholder content and has been
  // removed. Callers that want a chip row must pass one explicitly.
  const recentQuestionsNav = options.recentQuestionsNav;

  return renderDocument({
    authenticated,
    csrfToken,
    bodyClass: 'squire-body',
    bodyContent: html`${!authenticated || !showChatChrome
        ? html``
        : html`<a href="#squire-input" class="sr-only-focusable">Skip to ask Squire</a>`}
      <div class="squire-frame">
        ${!authenticated || !showRail
          ? html``
          : html`<aside class="squire-rail" aria-label="Squire ledger">
              <span class="squire-monogram squire-monogram--masthead" aria-hidden="true">S</span>
              <span class="squire-wordmark">Squire</span>
            </aside>`}
        <div class="${columnClassName}">
          <header class="squire-header">
            ${authenticated && options.session
              ? html`<a class="squire-header__brand" href="/" aria-label="Go to Squire home">
                    <span class="squire-monogram" aria-hidden="true">S</span>
                    <span class="squire-wordmark">Squire</span>
                  </a>
                  <span class="squire-context">${headerContext}</span>
                  <div class="squire-header__account">
                    ${renderAccountMenu(options.session, authenticatedCsrfToken)}
                  </div>`
              : html`<span class="squire-monogram" aria-hidden="true">S</span>
                  <span class="squire-wordmark">Squire</span>
                  <span class="squire-context">${headerContext}</span>`}
          </header>
          <main
            id="squire-surface"
            class="squire-surface"
            aria-live="${showChatChrome ? 'polite' : 'off'}"
            aria-atomic="${showChatChrome ? 'false' : 'true'}"
          >
            ${surfaceContent}
          </main>
          ${!authenticated || !showChatChrome
            ? html``
            : html`${recentQuestionsNav ?? html``}
                <form
                  class="squire-input-dock"
                  method="post"
                  action="${chatFormAction}"
                  hx-post="${chatFormAction}"
                  hx-target="${chatFormHxTarget}"
                  hx-swap="${chatFormHxSwap}"
                >
                  ${chatFormHiddenFields.map(
                    (field) =>
                      html`<input type="hidden" name="${field.name}" value="${field.value}" />`,
                  )}
                  <input
                    id="squire-input"
                    name="question"
                    type="text"
                    autocomplete="off"
                    placeholder="Ask a question..."
                  />
                  <button type="submit" class="squire-input-dock__submit" aria-label="Ask">
                    <span aria-hidden="true">S</span>
                  </button>
                </form>`}
        </div>
      </div>` as HtmlEscapedString,
  });
}

interface LoginPageOptions {
  errorMessage?: string;
  /**
   * When true, renders a local-only "Sign in as Dev User" button that
   * posts to /dev/login. The server only passes true when
   * `shouldRegisterDevLogin()` is satisfied (non-production + managed-local
   * DB), so the button is literally not present in production HTML.
   * Exists because Claude Code's preview sandbox blocks off-localhost
   * navigation, which means the real Google OAuth round-trip can't
   * complete inside the preview tab.
   */
  devLoginEnabled?: boolean;
}

const GOOGLE_G_MARK = html`<svg
  class="squire-google-mark"
  viewBox="0 0 18 18"
  aria-hidden="true"
  focusable="false"
>
  <path
    fill="#4285F4"
    d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.13 4.13 0 0 1-1.8 2.7v2.24h2.9c1.7-1.56 2.7-3.86 2.7-6.58Z"
  />
  <path
    fill="#34A853"
    d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.24c-.8.54-1.82.86-3.06.86-2.35 0-4.34-1.58-5.05-3.7H.96v2.31A9 9 0 0 0 9 18Z"
  />
  <path
    fill="#FBBC05"
    d="M3.95 10.74A5.41 5.41 0 0 1 3.67 9c0-.6.1-1.18.28-1.74V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l2.99-2.31Z"
  />
  <path
    fill="#EA4335"
    d="M9 3.58c1.32 0 2.5.45 3.44 1.33l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l2.99 2.31C4.66 5.16 6.65 3.58 9 3.58Z"
  />
</svg>`;

function renderAuthBanner(options: {
  label: string;
  message: string;
  retry?: { href: string; label: string };
}): HtmlEscapedString {
  return html`<div class="squire-banner squire-banner--error" role="alert">
    <span class="squire-banner__label">${options.label}</span>
    <p class="squire-banner__body">${options.message}</p>
    ${options.retry
      ? html`<div class="squire-banner__actions">
          <a href="${options.retry.href}" class="squire-button squire-button--ghost">
            ${options.retry.label}
          </a>
        </div>`
      : html``}
  </div>` as HtmlEscapedString;
}

async function renderAuthPage(content: HtmlEscapedString): Promise<HtmlEscapedString> {
  return renderDocument({
    bodyClass: 'squire-body squire-body--auth',
    bodyContent: content,
  });
}

export async function renderLoginPage(options: LoginPageOptions = {}): Promise<HtmlEscapedString> {
  return renderAuthPage(
    html`<main class="squire-auth-page">
      <section class="squire-auth-page__stack" aria-label="Sign in to Squire">
        <span class="squire-monogram squire-monogram--masthead" aria-hidden="true">S</span>
        <span class="squire-wordmark squire-wordmark--auth">Squire</span>
        <p class="squire-tagline">A FROSTHAVEN COMPANION</p>
        <a
          href="/auth/google/start"
          class="squire-button squire-button--primary squire-button--google"
        >
          ${GOOGLE_G_MARK}
          <span>Sign in with Google</span>
        </a>
        ${options.devLoginEnabled
          ? html`<form method="post" action="/dev/login" class="squire-auth-page__dev-login">
              <button type="submit" class="squire-button squire-button--secondary">
                <span>Sign in as Dev User (local only)</span>
              </button>
            </form>`
          : html``}
        ${options.errorMessage
          ? renderAuthBanner({
              label: "COULDN'T SIGN YOU IN",
              message: options.errorMessage,
              retry: { href: '/auth/google/start', label: 'Try again' },
            })
          : html``}
      </section>
    </main>` as HtmlEscapedString,
  );
}

export async function renderNotInvitedPage(): Promise<HtmlEscapedString> {
  return renderAuthPage(
    html`<main class="squire-auth-page">
      <section class="squire-auth-page__stack" aria-label="Not invited to Squire">
        <span class="squire-monogram squire-monogram--masthead" aria-hidden="true">S</span>
        <span class="squire-wordmark squire-wordmark--auth">Squire</span>
        <p class="squire-tagline">A FROSTHAVEN COMPANION</p>
        ${renderAuthBanner({
          label: 'NOT YET INVITED',
          message: "Squire is single-user during Phase 1. Reach out if you'd like access.",
        })}
      </section>
    </main>` as HtmlEscapedString,
  );
}

/**
 * Authenticated home-page surface. A purpose-built landing composition —
 * "At your service." Fraunces hero, a sepia small-caps scope line, and
 * nothing else above the input dock. Chip row, verdict block, PICKED
 * badge, spoiler banner, and desktop rail are all intentionally absent:
 * SQR-107 / ADR 0012 supersede ADR 0010's current-turn ledger on the
 * home surface.
 *
 * The hidden `<template id="squire-banner-fixtures">` carries the error,
 * sync, verdict, and PICKED markup so CSS drift tests (and future QA)
 * have real DOM references to target without waiting for a Phase 5
 * recommendation or Phase 6 sync to fire in the wild.
 */
function renderHomeLanding(): HtmlEscapedString {
  return html`<section class="squire-empty" aria-label="Welcome">
      <h1 class="squire-question">At your service.</h1>
      <p class="squire-empty__scope">ASK ABOUT A RULE, CARD, ITEM, MONSTER, OR SCENARIO</p>
    </section>
    <template id="squire-banner-fixtures" aria-hidden="true">
      <div class="squire-banner squire-banner--error" role="alert">
        <span class="squire-banner__label">SOMETHING WENT WRONG</span>
        <p class="squire-banner__body">Error banner fixture for QA / tests.</p>
      </div>
      <div class="squire-banner squire-banner--sync" role="status">
        <span class="squire-banner__label">SYNCED · 2H AGO</span>
        <p class="squire-banner__body">Sync banner fixture for QA / tests.</p>
      </div>
      <aside class="squire-verdict" aria-label="Squire recommends">
        <span class="squire-verdict__label">SQUIRE RECOMMENDS</span>
        <p class="squire-verdict__body">
          Phase 5 will render a recommendation here when comparing cards.
          <span class="squire-picked">PICKED</span>
        </p>
      </aside>
    </template>` as HtmlEscapedString;
}

/**
 * Exported as a separate function so the route handler in `src/server.ts`
 * has a single override point in tests.
 */
export async function renderHomePage(
  session?: Session,
  csrfToken?: string,
): Promise<HtmlEscapedString> {
  return layoutShell({
    session,
    csrfToken,
    chatFormAction: '/chat',
    chatFormHiddenFields: [{ name: 'idempotencyKey', value: '' }],
    mainContent: renderHomeLanding(),
    showRail: false,
  });
}

export async function renderConversationPage(options: {
  session: Session;
  csrfToken: string;
  conversationId: string;
  messages: ConversationMessage[];
  /**
   * Map of user-message id → SSE stream URL for any user message
   * without an assistant reply. The common case is a single entry (one
   * pending turn at the bottom). When concurrent turns are pending —
   * e.g. a stranded prior pending plus a new in-flight turn — each
   * gets its own EventSource on the client side.
   */
  pendingStreamUrls?: Map<string, string>;
}): Promise<HtmlEscapedString> {
  // ADR 0012: the conversation page is a standard scrolling-chat transcript.
  // Past turns stack oldest-to-newest, the pending answer skeleton (when
  // the latest user message has no assistant response yet) sits at the
  // bottom, and follow-up submits append a single new pending turn rather
  // than replacing the whole surface. The desktop rail collapses entirely
  // on this surface in Phase 1 — no `.squire-rail` aside on conversation.
  const transcript = renderConversationTranscript({
    conversationId: options.conversationId,
    messages: options.messages,
    pendingStreamUrls: options.pendingStreamUrls,
  });

  return layoutShell({
    session: options.session,
    csrfToken: options.csrfToken,
    mainContent: transcript,
    chatFormAction: `/chat/${options.conversationId}/messages`,
    chatFormHxTarget: '.squire-transcript',
    chatFormHxSwap: 'beforeend',
    showRail: false,
  });
}

export async function renderMarkdownStyleguidePage(
  session: Session,
  csrfToken: string,
): Promise<HtmlEscapedString> {
  const mainContent = html`<section class="squire-internal-shell">
    <section class="squire-styleguide" aria-label="Markdown rendering styleguide">
      <header class="squire-styleguide__intro">
        <span class="squire-question__eyebrow">Styleguide</span>
        <h1 class="squire-question">Markdown rendering styleguide</h1>
        <p class="squire-styleguide__lede">
          This page is the in-app contract for Squire's supported markdown subset. One source
          specimen, one rendered answer, no mystery meat.
        </p>
      </header>

      <section class="squire-styleguide__summary">
        <div class="squire-styleguide__summary-block">
          <h2 class="squire-styleguide__summary-title">Supported constructs</h2>
          <ul class="squire-styleguide__feature-list">
            ${SUPPORTED_MARKDOWN_FEATURES.map((feature) => html`<li>${feature}</li>`)}
          </ul>
        </div>
        <div class="squire-styleguide__summary-block">
          <h2 class="squire-styleguide__summary-title">Unsafe stays inert</h2>
          <ul class="squire-styleguide__feature-list">
            ${UNSUPPORTED_MARKDOWN_FEATURES.map((feature) => html`<li>${feature}</li>`)}
          </ul>
        </div>
      </section>

      ${renderMarkdownSpecimenCard({
        title: 'Supported subset specimen',
        description:
          'A single answer specimen that exercises every markdown construct Squire intentionally supports.',
        source: SUPPORTED_MARKDOWN_SPECIMEN,
        rendered: renderAssistantContent(SUPPORTED_MARKDOWN_SPECIMEN),
      })}
      ${renderMarkdownSpecimenCard({
        title: 'Unsafe syntax stays inert',
        description:
          'These constructs should remain literal text instead of turning into partially trusted rich content.',
        source: UNSUPPORTED_MARKDOWN_SPECIMEN,
        rendered: renderAssistantContent(UNSUPPORTED_MARKDOWN_SPECIMEN),
      })}
    </section>
  </section>` as HtmlEscapedString;

  return layoutShell({
    session,
    csrfToken,
    mainContent,
    showRail: false,
    showChatChrome: false,
    headerContext: 'INTERNAL · STYLEGUIDE',
    columnClassName: 'squire-column squire-column--wide',
  });
}

/**
 * Build Q+A pairs from a flat message list. Groups each user message
 * with its assistant reply (matched by `responseToMessageId`) and orders
 * pairs by user-message `createdAt` (ties broken by id, matching the
 * repository's `(created_at, id)` sort). Defends against the
 * reload-ordering corruption Codex flagged on SQR-108: if turn N+1's
 * assistant reply happens to land in the DB before turn N's, walking
 * messages in raw `createdAt` order would render `Q1, Q2, A2, A1` —
 * broken pairs, no visible Q→A grouping. Pairing first keeps
 * `Q1, A1, Q2, A2` no matter the assistant arrival order.
 */
function pairConversationTurns(
  messages: ConversationMessage[],
): Array<{ userMessage: ConversationMessage; assistantMessage: ConversationMessage | null }> {
  const assistantByResponseTo = new Map<string, ConversationMessage>();
  const userMessages: ConversationMessage[] = [];

  for (const message of messages) {
    if (message.role === 'user') {
      userMessages.push(message);
    } else if (message.role === 'assistant' && message.responseToMessageId) {
      assistantByResponseTo.set(message.responseToMessageId, message);
    }
  }

  userMessages.sort((a, b) => {
    const ta = a.createdAt.getTime();
    const tb = b.createdAt.getTime();
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });

  return userMessages.map((userMessage) => ({
    userMessage,
    assistantMessage: assistantByResponseTo.get(userMessage.id) ?? null,
  }));
}

/**
 * Render a scrolling-chat transcript. ADR 0012 / SQR-108: the conversation
 * page is a standard top-to-bottom transcript with a permanent live-region
 * container. The transcript element itself is `role="log" aria-live="polite"`,
 * so follow-up `hx-swap="beforeend"` appends register as live-region updates
 * without re-creating the container (the live-region permanent-slot pattern
 * — without it, screen readers can miss the first append after a fresh
 * registration).
 *
 * Turns are paired by `responseToMessageId` before render so concurrent
 * turns survive reload (see `pairConversationTurns`). Any user message
 * with no assistant reply renders a pending answer skeleton — the
 * `pendingStreamUrls` map keys those user-message ids to their stream
 * URLs so multiple in-flight turns each get their own EventSource on
 * the client side. The common case (one pending) passes a single-entry
 * map; the empty case (everything answered) passes an empty map and no
 * skeletons render.
 */
export function renderConversationTranscript(options: {
  conversationId: string;
  messages: ConversationMessage[];
  pendingStreamUrls?: Map<string, string>;
}): HtmlEscapedString {
  const pairs = pairConversationTurns(options.messages);
  const pendingStreamUrls = options.pendingStreamUrls ?? new Map<string, string>();

  return html`<section
    class="squire-transcript"
    role="log"
    aria-live="polite"
    aria-label="Conversation transcript"
    data-conversation-id="${options.conversationId}"
  >
    ${pairs.map((pair) => {
      const streamUrl = pendingStreamUrls.get(pair.userMessage.id);
      // Three states: (1) answered → render the answer; (2) pending with a
      // live stream URL → render the skeleton so the client reattaches the
      // SSE; (3) orphan question with no assistant row and no stream URL —
      // shows the question alone (defensive: no expected production path
      // produces this, but a crashed/aborted stream could leave one behind).
      return html`${renderQuestionTurn(pair.userMessage.content)}
      ${pair.assistantMessage
        ? renderAnswerTurn(pair.assistantMessage)
        : streamUrl
          ? renderPendingAnswerSkeleton(streamUrl)
          : html``}`;
    })}
  </section>` as HtmlEscapedString;
}

/**
 * Append-fragment for `POST /chat/:conversationId/messages` (ADR 0012 E-3).
 * The client appends this to `.squire-transcript` via `hx-swap="beforeend"`,
 * adding exactly one new turn (question + pending answer skeleton) without
 * replacing the surrounding transcript chrome.
 */
export function renderConversationTurnAppendFragment(options: {
  question: string;
  streamUrl: string;
}): HtmlEscapedString {
  return html`${renderQuestionTurn(options.question)}
  ${renderPendingAnswerSkeleton(options.streamUrl)}` as HtmlEscapedString;
}

export function renderSelectedMessageSurfaceWithRecentQuestions(options: {
  selectedQuestion: ConversationMessage;
  selectedAnswer: ConversationMessage;
  isEarlierQuestion: boolean;
  recentQuestionsNav: HtmlEscapedString;
}): HtmlEscapedString {
  return html`${renderSelectedMessageSurface({
    selectedQuestion: options.selectedQuestion,
    selectedAnswer: options.selectedAnswer,
    isEarlierQuestion: options.isEarlierQuestion,
  })}
  ${options.recentQuestionsNav}` as HtmlEscapedString;
}
