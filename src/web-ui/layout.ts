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
  recentQuestionsNav?: HtmlEscapedString;
  showRail?: boolean;
  showChatChrome?: boolean;
  headerContext?: string;
  columnClassName?: string;
}

export interface PendingTurnShellOptions {
  question: string;
  streamUrl: string;
}

export interface RecentQuestionNavItem {
  href: string;
  label: string;
  hxGet?: string;
  pushUrl?: boolean;
}

export interface RecentQuestionsNavOptions {
  conversationId: string;
  questions: ConversationMessage[];
  selectedMessageId?: string;
  outOfBand?: boolean;
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

function renderAnswerTurn(message: ConversationMessage): HtmlEscapedString {
  const content = message.isError
    ? (html`<p>${message.content}</p>` as HtmlEscapedString)
    : renderAssistantContent(message.content);
  return html`<article
    class="squire-turn squire-answer${message.isError ? ' squire-answer--error' : ''}"
  >
    ${renderAnswerContent(content)}
  </article>` as HtmlEscapedString;
}

function renderConversationTurn(message: ConversationMessage): HtmlEscapedString {
  return message.role === 'user' ? renderQuestionTurn(message.content) : renderAnswerTurn(message);
}

function findCurrentConversationTurn(messages: ConversationMessage[]): {
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage | null;
} | null {
  const assistantResponses = new Map<string, ConversationMessage>();

  for (const message of messages) {
    if (message.role === 'assistant' && message.responseToMessageId) {
      assistantResponses.set(message.responseToMessageId, message);
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') continue;

    return {
      userMessage: message,
      assistantMessage: assistantResponses.get(message.id) ?? null,
    };
  }

  return null;
}

function renderPendingAnswerSkeleton(): HtmlEscapedString {
  return html`<article
    class="squire-turn squire-answer squire-answer--pending"
    data-stream-state="pending"
  >
    <div class="squire-answer__content squire-markdown"></div>
    <div class="squire-answer__tools" aria-live="off"></div>
    <div class="squire-answer__skeleton" aria-hidden="true">
      <div class="squire-answer__skeleton-dropcap"></div>
      <div class="squire-answer__skeleton-line squire-answer__skeleton-line--full"></div>
      <div class="squire-answer__skeleton-line squire-answer__skeleton-line--mid"></div>
      <div class="squire-answer__skeleton-line squire-answer__skeleton-line--short"></div>
    </div>
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

function renderStaticRecentQuestionChip(label: string): HtmlEscapedString {
  return html`<span class="squire-chip" title="${label}">${label}</span>` as HtmlEscapedString;
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

export function renderRecentQuestionsNav(options: RecentQuestionsNavOptions): HtmlEscapedString;
export function renderRecentQuestionsNav(
  items: RecentQuestionNavItem[],
  options?: { oob?: boolean },
): HtmlEscapedString;
export function renderRecentQuestionsNav(
  optionsOrItems: RecentQuestionsNavOptions | RecentQuestionNavItem[],
  options?: { oob?: boolean },
): HtmlEscapedString {
  const items = Array.isArray(optionsOrItems)
    ? optionsOrItems
    : optionsOrItems.questions
        .filter((question) => question.id !== optionsOrItems.selectedMessageId)
        .map((question) => ({
          href: `/chat/${optionsOrItems.conversationId}/messages/${question.id}`,
          hxGet: `/chat/${optionsOrItems.conversationId}/messages/${question.id}`,
          label: question.content,
          pushUrl: true,
        }));

  if (Array.isArray(optionsOrItems)) {
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

  if (items.length === 0) {
    return html`` as HtmlEscapedString;
  }

  return renderRecentQuestionsContainer({
    visibleChips: items.slice(0, VISIBLE_RECENT_QUESTION_LIMIT).map((item) =>
      renderRecentQuestionChip({
        href: item.href,
        hxGet: item.hxGet,
        pushUrl: item.pushUrl,
        label: item.label,
      }),
    ),
    overflowChips: items.slice(VISIBLE_RECENT_QUESTION_LIMIT).map((item) =>
      renderRecentQuestionChip({
        href: item.href,
        hxGet: item.hxGet,
        pushUrl: item.pushUrl,
        label: item.label,
      }),
    ),
    outOfBand: optionsOrItems.outOfBand,
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
  const recentQuestionsNav =
    options.recentQuestionsNav ??
    renderRecentQuestionsContainer({
      visibleChips: [
        renderStaticRecentQuestionChip('Looting'),
        renderStaticRecentQuestionChip('Element infusion'),
        renderStaticRecentQuestionChip('Negative scenario effects'),
      ],
    });

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
            : html`<footer class="squire-toolcall" aria-live="off">
                  CONSULTED · RULEBOOK P.47 · SCENARIO BOOK §14
                </footer>
                ${recentQuestionsNav}
                <form
                  class="squire-input-dock"
                  method="post"
                  action="${chatFormAction}"
                  hx-post="${chatFormAction}"
                  hx-target="#squire-surface"
                  hx-swap="innerHTML"
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
                    Ask
                  </button>
                </form>`}
        </div>
      </div>` as HtmlEscapedString,
  });
}

interface LoginPageOptions {
  errorMessage?: string;
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
 * Default authenticated home page renderer. Phase 1 still uses the empty
 * ledger surface — SQR-67 ships the first-run empty state, SQR-6 ships the
 * streaming answer slot. Exported as a separate function so the route handler
 * in `src/server.ts` has a single override point in tests.
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
  });
}

export async function renderConversationPage(options: {
  session: Session;
  csrfToken: string;
  conversationId: string;
  messages: ConversationMessage[];
  recentQuestionsNav?: HtmlEscapedString;
  pendingStreamUrl?: string;
}): Promise<HtmlEscapedString> {
  const currentTurn = findCurrentConversationTurn(options.messages);
  const transcript = !currentTurn
    ? renderConversationTranscript(options.conversationId, options.messages)
    : currentTurn.assistantMessage
      ? renderSelectedMessageSurface({
          selectedQuestion: currentTurn.userMessage,
          selectedAnswer: currentTurn.assistantMessage,
          isEarlierQuestion: false,
        })
      : (html`<section
          class="squire-transcript squire-transcript--pending"
          aria-label="Conversation transcript"
          ${options.pendingStreamUrl ? html`data-stream-url="${options.pendingStreamUrl}"` : html``}
        >
          ${renderQuestionTurn(currentTurn.userMessage.content)} ${renderPendingAnswerSkeleton()}
        </section>` as HtmlEscapedString);

  return layoutShell({
    session: options.session,
    csrfToken: options.csrfToken,
    mainContent: transcript as HtmlEscapedString,
    chatFormAction: `/chat/${options.conversationId}/messages`,
    recentQuestionsNav: options.recentQuestionsNav,
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

export function renderConversationTranscript(
  conversationId: string,
  messages: ConversationMessage[],
): HtmlEscapedString {
  if (messages.length === 0) {
    return html`<section class="squire-empty" aria-label="Conversation">
      <h1 class="squire-question">Conversation is empty.</h1>
    </section>` as HtmlEscapedString;
  }

  return html`<section
    class="squire-transcript"
    aria-label="Conversation transcript"
    data-conversation-id="${conversationId}"
  >
    ${messages.map((message) => renderConversationTurn(message))}
  </section>` as HtmlEscapedString;
}

export function renderConversationTranscriptWithPendingTurn(options: {
  conversationId: string;
  messages: ConversationMessage[];
  streamUrl: string;
}): HtmlEscapedString {
  return html`<section
    class="squire-transcript squire-transcript--pending"
    aria-label="Conversation transcript"
    data-conversation-id="${options.conversationId}"
    data-stream-url="${options.streamUrl}"
  >
    ${options.messages.map((message) => renderConversationTurn(message))}
    ${renderPendingAnswerSkeleton()}
  </section>` as HtmlEscapedString;
}

export function renderConversationTranscriptWithPendingTurnAndRecentQuestions(options: {
  conversationId: string;
  messages: ConversationMessage[];
  streamUrl: string;
  recentQuestionsNav: HtmlEscapedString;
}): HtmlEscapedString {
  return html`${renderConversationTranscriptWithPendingTurn(options)} ${options.recentQuestionsNav}` as HtmlEscapedString;
}

export function renderConversationTranscriptWithRecentQuestions(options: {
  conversationId: string;
  messages: ConversationMessage[];
  recentQuestionsNav: HtmlEscapedString;
}): HtmlEscapedString {
  return html`${renderConversationTranscript(options.conversationId, options.messages)}
  ${options.recentQuestionsNav}` as HtmlEscapedString;
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

export function renderPendingTurnShell(options: PendingTurnShellOptions): HtmlEscapedString {
  return html`<section
    class="squire-transcript squire-transcript--pending"
    aria-label="Conversation transcript"
    data-stream-url="${options.streamUrl}"
  >
    ${renderQuestionTurn(options.question)} ${renderPendingAnswerSkeleton()}
  </section>` as HtmlEscapedString;
}

export function renderPendingTurnShellWithRecentQuestions(
  options: PendingTurnShellOptions & {
    recentQuestionsNav: HtmlEscapedString;
  },
): HtmlEscapedString {
  return html`${renderPendingTurnShell(options)} ${options.recentQuestionsNav}` as HtmlEscapedString;
}
