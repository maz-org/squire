/**
 * Squire web UI — companion-first layout shell (SQR-65 / SQR-5b).
 *
 * Ships the authenticated app shell described in DESIGN.md §Layout:
 * header, conversation history, transcript/home surface, bottom input,
 * and footer provenance. Visual polish (drop cap, rule-term highlighter,
 * populated footer) is intentionally layered into these stable slots.
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
import { renderCampaignStrip, type CampaignStripState } from './campaign-pages.ts';
import { aggregateSourceLabels, type ToolSourceLabel } from './consulted-footer.ts';
import { CSRF_FORM_FIELD_NAME, CSRF_HEADER_NAME, CSRF_META_NAME } from './csrf.ts';
import { FONT_PRECONNECTS, GOOGLE_FONTS_HREF } from './fonts.ts';
import {
  SUPPORTED_MARKDOWN_FEATURES,
  SUPPORTED_MARKDOWN_SPECIMEN,
  UNSUPPORTED_MARKDOWN_FEATURES,
  UNSUPPORTED_MARKDOWN_SPECIMEN,
} from './markdown-styleguide.ts';
import { DEFAULT_GAME_ID, SUPPORTED_GAME_IDS, SUPPORTED_GAMES } from '../game.ts';
import {
  formatWorkLogDuration,
  humanizeWorkLogProgressMessage,
  workLogSourceActionFromProgressMessage,
} from '../work-log-display.ts';
import type {
  ConversationMessage,
  ConversationMessagePublicWorkEvent,
  Session,
} from '../db/repositories/types.ts';
import type {
  ConversationHistoryStatus,
  ConversationHistoryViewModel,
  ConversationHistoryViewRow,
} from '../chat/conversation-service.ts';

export interface LayoutShellOptions {
  /**
   * Header context strip (SQR-275): the persistent campaign bridge.
   * Pass the active campaign (or null for the NO CAMPAIGN affordance);
   * leave undefined to omit the strip entirely (unauthenticated chrome).
   * `campaignStripProminent` marks campaign surfaces, where the campaign
   * name outranks the brand.
   */
  campaignStrip?: CampaignStripState | null;
  campaignStripProminent?: boolean;
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
   * renders the full interaction surface. When absent, renders brand-only
   * chrome (header, monogram, fonts, colors). The layout never touches the
   * Hono context or DB.
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
  showRail?: boolean;
  showChatChrome?: boolean;
  conversationHistory?: ConversationHistoryViewModel;
  headerContext?: string;
  columnClassName?: string;
  /**
   * Set to true on pages whose `mainContent` contains its own live region
   * (e.g., `section.squire-transcript[role="log" aria-live="polite"]` on
   * /chat/:id, ADR 0012). When set, `main.squire-surface` is rendered with
   * `aria-live="off"` so screen readers don't announce the same swap from
   * two nested polite regions.
   */
  transcriptOwnsLiveRegion?: boolean;
}

const EMPTY_CONVERSATION_HISTORY: ConversationHistoryViewModel = {
  rows: [],
  nextCursor: null,
  query: '',
};

interface DocumentOptions {
  bodyContent: HtmlEscapedString;
  bodyClass?: string;
  authenticated?: boolean;
  csrfToken?: string;
}

const BROWSER_TELEMETRY_ENDPOINT = '/api/browser-telemetry';

function renderBrowserTelemetryConfig(): HtmlEscapedString {
  const enabled = Boolean(process.env.SENTRY_DSN?.trim());
  const config = JSON.stringify({
    enabled,
    endpoint: BROWSER_TELEMETRY_ENDPOINT,
  });

  return html`<meta name="squire-browser-telemetry" content="${config}" />` as HtmlEscapedString;
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
        <a class="squire-account-menu__item" href="/profile">Profile</a>
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

function renderActiveGamePicker(): HtmlEscapedString {
  const labels = new Map<string, string>([['gloomhaven-2e', 'Gloomhaven 2e']]);
  return html`<fieldset
    class="squire-game-picker"
    aria-label="Active game"
    data-default-game="${DEFAULT_GAME_ID}"
    data-supported-games="${SUPPORTED_GAME_IDS.join(' ')}"
  >
    <legend class="squire-game-picker__legend">Active game</legend>
    ${SUPPORTED_GAMES.map(
      (game) =>
        html`<label class="squire-game-picker__option">
          <input
            class="squire-game-picker__input"
            type="radio"
            name="activeGame"
            value="${game.id}"
            ${game.id === DEFAULT_GAME_ID ? html`checked` : html``}
          />
          <span>${labels.get(game.id) ?? game.label}</span>
        </label>`,
    )}
  </fieldset>` as HtmlEscapedString;
}

function statusLabel(status: ConversationHistoryStatus): string {
  if (status === 'running') return 'Running';
  if (status === 'error') return 'Error';
  return '';
}

function renderHistoryRows(
  rows: ConversationHistoryViewRow[],
  options: { query?: string } = {},
): HtmlEscapedString {
  if (rows.length === 0) {
    return html`<div class="squire-history-empty">
      <p>${options.query ? 'No matching conversations.' : 'No conversations yet.'}</p>
    </div>` as HtmlEscapedString;
  }

  return html`${rows.map((row) => {
    const rowClass = ['squire-history-row', row.active ? 'is-active' : '']
      .filter(Boolean)
      .join(' ');
    const status = statusLabel(row.status);
    return html`<a
      class="${rowClass}"
      href="${row.href}"
      data-conversation-id="${row.id}"
      data-history-status="${row.status}"
      ${row.active ? html`aria-current="page"` : html``}
    >
      <span class="squire-history-row__title">${row.title}</span>
      ${row.preview
        ? html`<span class="squire-history-row__preview">${row.preview}</span>`
        : html``}
      <span class="squire-history-row__meta">
        ${row.gameScope ? html`<span>${row.gameScope}</span>` : html``}
        <time datetime="${row.lastActivityAt.toISOString()}">${row.lastActivityLabel}</time>
        <span class="squire-history-row__status" ${status ? html`` : html`hidden`}>
          ${status}
        </span>
      </span>
    </a>`;
  })}` as HtmlEscapedString;
}

function renderConversationHistorySearch(
  history: ConversationHistoryViewModel,
  idSuffix: string,
): HtmlEscapedString {
  const query = history.query ?? '';
  return html`<form class="squire-history-search" method="get" role="search">
    <label class="sr-only" for="squire-history-search-${idSuffix}">Search history</label>
    <input
      id="squire-history-search-${idSuffix}"
      class="squire-history-search__input"
      type="search"
      name="historyQuery"
      value="${query}"
      placeholder="Search history"
      autocomplete="off"
    />
    <button class="squire-history-search__submit" type="submit">Search</button>
  </form>` as HtmlEscapedString;
}

function renderConversationHistoryList(history: ConversationHistoryViewModel): HtmlEscapedString {
  const query = history.query ?? '';
  return html`<nav
    class="squire-history-list"
    aria-label="${query ? 'Matching conversations' : 'Recent conversations'}"
  >
    ${renderHistoryRows(history.rows, { query })}
  </nav>` as HtmlEscapedString;
}

function renderNewChatLink(className: string): HtmlEscapedString {
  return html`<a class="${className}" href="/">New chat</a>` as HtmlEscapedString;
}

export function renderConversationHistoryShell(
  history: ConversationHistoryViewModel = EMPTY_CONVERSATION_HISTORY,
  options: { oob?: boolean } = {},
): HtmlEscapedString {
  return html`<div
    id="squire-history-shell"
    class="squire-history-shell"
    ${options.oob ? html`hx-swap-oob="true"` : html``}
  >
    <aside class="squire-rail" aria-label="Conversation history">
      <div class="squire-history-head">
        <a class="squire-history-brand" href="/" aria-label="Go to Squire home">
          <span class="squire-monogram squire-monogram--masthead" aria-hidden="true">S</span>
          <span class="squire-wordmark">Squire</span>
        </a>
        ${renderNewChatLink('squire-history-new-chat')}
      </div>
      ${renderConversationHistorySearch(history, 'rail')} ${renderConversationHistoryList(history)}
    </aside>
    <div class="squire-history-backdrop" data-history-close hidden></div>
    <aside
      id="squire-history-drawer"
      class="squire-history-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="squire-history-drawer-title"
      aria-hidden="true"
      tabindex="-1"
      hidden
    >
      <div class="squire-history-drawer__header">
        <span id="squire-history-drawer-title" class="squire-history-drawer__title"> History </span>
        <button
          type="button"
          class="squire-history-drawer__close"
          data-history-close
          aria-label="Close history"
        >
          Close
        </button>
      </div>
      ${renderNewChatLink('squire-history-new-chat squire-history-new-chat--drawer')}
      ${renderConversationHistorySearch(history, 'drawer')}
      ${renderConversationHistoryList(history)}
    </aside>
  </div>` as HtmlEscapedString;
}

export function renderConversationTranscriptWithHistoryOob(options: {
  conversationHistory: ConversationHistoryViewModel;
  conversationId: string;
  messages: ConversationMessage[];
  pendingStreamUrls?: Map<string, string>;
}): HtmlEscapedString {
  return html`${renderConversationHistoryShell(options.conversationHistory, { oob: true })}
  ${renderConversationTranscript({
    conversationId: options.conversationId,
    messages: options.messages,
    pendingStreamUrls: options.pendingStreamUrls,
  })}` as HtmlEscapedString;
}

export function renderConversationTurnAppendFragmentWithHistoryOob(options: {
  conversationHistory: ConversationHistoryViewModel;
  question: string;
  streamUrl: string;
}): HtmlEscapedString {
  return html`${renderConversationHistoryShell(options.conversationHistory, { oob: true })}
  ${renderConversationTurnAppendFragment({
    question: options.question,
    streamUrl: options.streamUrl,
  })}` as HtmlEscapedString;
}

function renderHistoryToggle(): HtmlEscapedString {
  return html`<button
    type="button"
    class="squire-history-toggle"
    aria-controls="squire-history-drawer"
    aria-expanded="false"
  >
    History
  </button>` as HtmlEscapedString;
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
        ${renderBrowserTelemetryConfig()}
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

function messageIdFromStreamUrl(streamUrl: string): string | null {
  return streamUrl.match(/\/messages\/([^/]+)\/stream$/)?.[1] ?? null;
}

function renderQuestionTurn(
  content: string,
  options: { eyebrowLabel?: string; messageId?: string } = {},
): HtmlEscapedString {
  const labelId = options.messageId ? `squire-question-label-${options.messageId}` : null;
  return html`<article
    class="squire-turn squire-question"
    data-testid="question-turn"
    ${options.messageId ? html`data-message-id="${options.messageId}"` : html``}
    ${labelId ? html`aria-labelledby="${labelId}"` : html`aria-label="Your question"`}
  >
    <h2 class="sr-only" ${labelId ? html`id="${labelId}"` : html``}>Your question</h2>
    ${options.eyebrowLabel
      ? html`<span class="squire-question__eyebrow">${options.eyebrowLabel}</span>`
      : html``}
    <p>${content}</p>
  </article>` as HtmlEscapedString;
}

function renderAnswerContent(content: HtmlEscapedString): HtmlEscapedString {
  return html`<div class="squire-answer__content squire-markdown" data-testid="answer-content">
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

function physicalToolSourceLabel(label: ToolSourceLabel): string {
  switch (label) {
    case 'RULEBOOK':
      return 'the rulebook';
    case 'PUZZLE BOOK':
      return 'the puzzle book';
    case 'CARD INDEX':
      return 'the cards';
    case 'SCENARIO BOOK':
      return 'the scenario book';
    case 'SECTION BOOK':
      return 'the section book';
  }
}

interface CompletedAnswerWorkRow {
  id: string;
  detail: string;
  sourceLabels: ToolSourceLabel[];
  state: 'complete' | 'error';
  variant?: 'narrative';
  sort: number;
  ordinal: number;
}

interface CompletedAnswerWorkTimeline {
  rows: CompletedAnswerWorkRow[];
  sourceCount: number;
  durationMs: number | null;
}

function answerWorkSlug(value: string | undefined, fallback: string): string {
  const slug = (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || fallback;
}

function baseAnswerWorkId(rowId: string | undefined): string | undefined {
  return rowId?.replace(/-progress-\d+$/, '');
}

function payloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function payloadSourceLabels(value: unknown): ToolSourceLabel[] {
  if (!Array.isArray(value)) return [];
  return aggregateSourceLabels(value.filter((entry): entry is string => typeof entry === 'string'));
}

function payloadSourceLabel(value: unknown): ToolSourceLabel | null {
  if (typeof value !== 'string') return null;
  return aggregateSourceLabels([value])[0] ?? null;
}

function genericAnswerWorkProgressDetail(message: string): string {
  return humanizeWorkLogProgressMessage(message);
}

function answerWorkProgressRowId(rowId: string | null, detail: string): string {
  const baseId = baseAnswerWorkId(rowId ?? undefined) ?? 'progress';
  const normalizedDetail = detail.toLowerCase();
  if (normalizedDetail.startsWith('resolving ') || normalizedDetail.startsWith('looked up ')) {
    return `progress-resolving-${answerWorkSlug(detail, 'event')}`;
  }
  if (
    normalizedDetail === 'searching available sources' ||
    normalizedDetail === 'searched available sources'
  ) {
    return 'progress-searched-available-sources';
  }
  return `${baseId}-progress-${answerWorkSlug(detail, 'event')}`;
}

function answerWorkProgressSort(detail: string): number {
  const normalizedDetail = detail.toLowerCase();
  if (normalizedDetail.startsWith('looked up ')) return 10;
  if (normalizedDetail.startsWith('checked ') && normalizedDetail.includes(' card')) return 10;
  if (normalizedDetail.startsWith('resolving ')) return 10;
  if (normalizedDetail === 'searched available sources') return 20;
  return 30;
}

function answerWorkPlanRowId(rowId: string | null, detail: string): string {
  return `plan-${answerWorkSlug(rowId ?? (detail.length > 0 ? detail : undefined), 'event')}`;
}

function answerWorkPlanSort(detail: string): number {
  const normalizedDetail = detail.toLowerCase();
  if (
    normalizedDetail.startsWith("i'll look that up ") ||
    normalizedDetail.startsWith("i'll look up ") ||
    normalizedDetail.startsWith("i'm looking up ") ||
    normalizedDetail.startsWith("i'm checking ") ||
    normalizedDetail.includes(' stat card')
  ) {
    return 9;
  }
  if (
    normalizedDetail.includes('available sources') ||
    normalizedDetail.includes(',') ||
    normalizedDetail.includes(' and ')
  ) {
    return 20;
  }
  return 30;
}

function answerWorkCheckedSourceRowId(label: ToolSourceLabel, ok: boolean, index: number): string {
  return `${ok ? 'checked-source-' : 'failed-source-'}${answerWorkSlug(label, String(index))}`;
}

function answerWorkProgressMessage(detail: string, sourceLabel: ToolSourceLabel | null): string {
  if (detail === 'Searched available sources' || detail === 'Searching available sources')
    return detail;
  if (!sourceLabel) return detail || 'Checking sources';

  const source = physicalToolSourceLabel(sourceLabel);
  if (detail && !detail.toLowerCase().includes(source)) {
    return `${detail} in ${source}`;
  }
  return detail || 'Checking sources';
}

function answerWorkArtifactMessage(title: string, sourceLabel: ToolSourceLabel | null): string {
  return `Found ${title || 'source'}${sourceLabel ? ` in ${physicalToolSourceLabel(sourceLabel)}` : ''}`;
}

function failedToolProgressMessage(detail: string): string | null {
  const resolveMatch = detail.match(/^Resolving\s+(.+)$/i);
  if (resolveMatch) return `Couldn't resolve ${resolveMatch[1]!.trim()}`;

  const lookupMatch = detail.match(/^(?:Looking up|Looked up)\s+(.+)$/i);
  if (lookupMatch) return `Couldn't look up ${lookupMatch[1]!.trim()}`;

  const openMatch = detail.match(/^Opening\s+(.+)$/i);
  if (openMatch) return `Couldn't open ${openMatch[1]!.trim()}`;

  if (/^Search(?:ing|ed)\s+available sources$/i.test(detail)) {
    return "Couldn't search available sources";
  }
  if (/^Search(?:ing|ed)\s+selected sources$/i.test(detail)) {
    return "Couldn't search selected sources";
  }

  return null;
}

function failedToolNameMessage(rawName: string | null): string | null {
  if (!rawName) return null;
  const normalized = rawName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (normalized.includes('lookup_entity')) return "Couldn't look up entity";
  if (normalized.includes('resolve_entity')) return "Couldn't resolve entity";
  if (normalized.includes('open_entity')) return "Couldn't open reference";
  if (normalized.includes('search_knowledge')) return "Couldn't search sources";
  if (normalized.includes('search_rules')) return "Couldn't search rules";
  if (normalized.includes('search_cards')) return "Couldn't search cards";
  if (normalized.includes('inspect_sources')) return "Couldn't inspect sources";
  if (normalized.includes('neighbors')) return "Couldn't follow reference links";

  return null;
}

function failedUnlabeledToolResultMessage(payload: Record<string, unknown>): string {
  const resultDetail = payloadString(payload, 'message');
  if (resultDetail) {
    const rawFailedProgressDetail = failedToolProgressMessage(resultDetail);
    if (rawFailedProgressDetail) return rawFailedProgressDetail;

    const progressDetail = genericAnswerWorkProgressDetail(resultDetail);
    const failedProgressDetail = failedToolProgressMessage(progressDetail);
    if (failedProgressDetail) return failedProgressDetail;
  }

  return (
    failedToolNameMessage(payloadString(payload, 'name')) ??
    failedToolNameMessage(payloadString(payload, 'id')) ??
    "Couldn't check sources"
  );
}

function addCompletedAnswerWorkRow(
  rows: Map<string, CompletedAnswerWorkRow>,
  input: Omit<CompletedAnswerWorkRow, 'ordinal'>,
): CompletedAnswerWorkRow {
  const existing = rows.get(input.id);
  if (existing) return existing;
  const row = { ...input, ordinal: rows.size };
  rows.set(input.id, row);
  return row;
}

function genericLookupSubject(detail: string): string | null {
  const match = detail.match(/^Look(?:ed|ing) up\s+(.+)$/i);
  if (!match || /\s+in the\s+/i.test(detail)) return null;
  const subject = match[1]!.trim().toLowerCase();
  return subject.length > 0 ? subject : null;
}

function sourceActionSupersedesGenericLookup(
  action: { detail: string },
  lookup: { id: string; detail: string },
): boolean {
  const subject = genericLookupSubject(lookup.detail);
  if (!subject) return false;
  return action.detail.toLowerCase().includes(subject);
}

function removeSupersededGenericLookupRows(
  rows: Map<string, CompletedAnswerWorkRow>,
  genericLookupRows: Array<{ id: string; detail: string }>,
  action: { detail: string },
): Array<{ id: string; detail: string }> {
  const remaining: Array<{ id: string; detail: string }> = [];
  for (const lookup of genericLookupRows) {
    if (sourceActionSupersedesGenericLookup(action, lookup)) {
      rows.delete(lookup.id);
    } else {
      remaining.push(lookup);
    }
  }
  return remaining;
}

function removeArtifactRowsForSourceAction(
  rows: Map<string, CompletedAnswerWorkRow>,
  artifactRowIdsByLabel: Map<ToolSourceLabel, string[]>,
  label: ToolSourceLabel,
): void {
  const artifactRows = artifactRowIdsByLabel.get(label);
  if (!artifactRows) return;
  for (const rowId of artifactRows) rows.delete(rowId);
  artifactRowIdsByLabel.delete(label);
}

function countTimelineSourceLabels(rows: CompletedAnswerWorkRow[]): number {
  const labels = new Set<ToolSourceLabel>();
  for (const row of rows) {
    for (const label of row.sourceLabels) labels.add(label);
  }
  return labels.size;
}

function buildCompletedAnswerWorkTimeline(
  events: readonly ConversationMessagePublicWorkEvent[] | undefined,
  completedAt: Date,
): CompletedAnswerWorkTimeline {
  const rows = new Map<string, CompletedAnswerWorkRow>();
  const successfulSources = new Set<ToolSourceLabel>();
  const sourceActionRowIdsByLabel = new Map<ToolSourceLabel, string>();
  const checkedRowIdsByLabel = new Map<ToolSourceLabel, string>();
  const artifactRowIdsByLabel = new Map<ToolSourceLabel, string[]>();
  let genericLookupRows: Array<{ id: string; detail: string }> = [];

  for (const event of events ?? []) {
    const payload = event.payload ?? {};
    if (event.event === 'tool-plan') {
      const detail = payloadString(payload, 'message');
      if (!detail) continue;
      addCompletedAnswerWorkRow(rows, {
        id: answerWorkPlanRowId(payloadString(payload, 'id'), detail),
        detail,
        sourceLabels: [],
        state: 'complete',
        variant: 'narrative',
        sort: answerWorkPlanSort(detail),
      });
      continue;
    }

    if (event.event === 'tool-progress') {
      const rawMessage = payloadString(payload, 'message');
      if (!rawMessage) continue;
      const detail = genericAnswerWorkProgressDetail(rawMessage);
      const sourceLabel = payloadSourceLabel(payload.label);
      const sourceAction = workLogSourceActionFromProgressMessage(detail, sourceLabel);
      if (sourceAction) {
        const label = sourceAction.label as ToolSourceLabel;
        genericLookupRows = removeSupersededGenericLookupRows(
          rows,
          genericLookupRows,
          sourceAction,
        );
        removeArtifactRowsForSourceAction(rows, artifactRowIdsByLabel, label);
        const checkedRowId = checkedRowIdsByLabel.get(label);
        if (checkedRowId) {
          rows.delete(checkedRowId);
          checkedRowIdsByLabel.delete(label);
        }
        const id = `source-action-${answerWorkSlug(label, 'source')}-${answerWorkSlug(
          sourceAction.detail,
          'event',
        )}`;
        sourceActionRowIdsByLabel.set(label, id);
        addCompletedAnswerWorkRow(rows, {
          id,
          detail: sourceAction.detail,
          sourceLabels: [label],
          state: 'complete',
          sort: answerWorkProgressSort(detail),
        });
        continue;
      }
      const id = answerWorkProgressRowId(payloadString(payload, 'id'), detail);
      addCompletedAnswerWorkRow(rows, {
        id,
        detail: answerWorkProgressMessage(detail, sourceLabel),
        sourceLabels: sourceLabel ? [sourceLabel] : [],
        state: 'complete',
        sort: answerWorkProgressSort(detail),
      });
      if (genericLookupSubject(detail)) genericLookupRows.push({ id, detail });
      continue;
    }

    if (event.event === 'answer-artifact') {
      const title = payloadString(payload, 'title');
      if (!title) continue;
      const sourceLabel = payloadSourceLabel(payload.sourceLabel);
      if (sourceLabel && sourceActionRowIdsByLabel.has(sourceLabel)) continue;
      const id = payloadString(payload, 'id') ?? `answer-artifact-${event.sequence}`;
      addCompletedAnswerWorkRow(rows, {
        id,
        detail: answerWorkArtifactMessage(title, sourceLabel),
        sourceLabels: sourceLabel ? [sourceLabel] : [],
        state: 'complete',
        sort: 40,
      });
      if (sourceLabel) {
        artifactRowIdsByLabel.set(sourceLabel, [
          ...(artifactRowIdsByLabel.get(sourceLabel) ?? []),
          id,
        ]);
      }
      continue;
    }

    if (event.event === 'tool-result') {
      const ok = payload.ok !== false;
      const labels = payloadSourceLabels(payload.labels);
      const resultDetail = payloadString(payload, 'message');
      const resultSourceAction = resultDetail
        ? workLogSourceActionFromProgressMessage(resultDetail, labels[0])
        : null;
      if (ok && resultSourceAction) {
        const label = resultSourceAction.label as ToolSourceLabel;
        successfulSources.add(label);
        genericLookupRows = removeSupersededGenericLookupRows(
          rows,
          genericLookupRows,
          resultSourceAction,
        );
        removeArtifactRowsForSourceAction(rows, artifactRowIdsByLabel, label);
        const checkedRowId = checkedRowIdsByLabel.get(label);
        if (checkedRowId) {
          rows.delete(checkedRowId);
          checkedRowIdsByLabel.delete(label);
        }
        const id = `source-action-${answerWorkSlug(label, 'source')}-${answerWorkSlug(
          resultSourceAction.detail,
          'event',
        )}`;
        sourceActionRowIdsByLabel.set(label, id);
        addCompletedAnswerWorkRow(rows, {
          id,
          detail: resultSourceAction.detail,
          sourceLabels: [label],
          state: 'complete',
          sort: answerWorkProgressSort(resultSourceAction.detail),
        });
      }
      if (labels.length === 0) {
        if (ok) continue;
        addCompletedAnswerWorkRow(rows, {
          id: payloadString(payload, 'id') ?? `failed-source-${event.sequence}`,
          detail: failedUnlabeledToolResultMessage(payload),
          sourceLabels: [],
          state: 'error',
          sort: 90,
        });
        continue;
      }

      labels.forEach((label, index) => {
        if (ok) successfulSources.add(label);
        const id = answerWorkCheckedSourceRowId(label, ok, index);
        const previousCheckedRowId = checkedRowIdsByLabel.get(label);
        if (previousCheckedRowId && previousCheckedRowId !== id) rows.delete(previousCheckedRowId);
        if (ok && sourceActionRowIdsByLabel.has(label)) {
          checkedRowIdsByLabel.delete(label);
          return;
        }
        checkedRowIdsByLabel.set(label, id);
        addCompletedAnswerWorkRow(rows, {
          id,
          detail: `${ok ? 'Checked' : "Couldn't check"} ${physicalToolSourceLabel(label)}`,
          sourceLabels: ok ? [label] : [],
          state: ok ? 'complete' : 'error',
          sort: ok ? 50 : 90,
        });
      });
    }
  }

  const orderedRows = [...rows.values()].sort((left, right) => {
    if (left.sort !== right.sort) return left.sort - right.sort;
    return left.ordinal - right.ordinal;
  });

  return {
    rows: orderedRows,
    sourceCount:
      successfulSources.size > 0 ? successfulSources.size : countTimelineSourceLabels(orderedRows),
    durationMs: completedAnswerWorkDurationMs(events, completedAt),
  };
}

function timelineFromConsultedSources(
  consultedSources: readonly string[] | null,
): CompletedAnswerWorkTimeline {
  const labels = aggregateSourceLabels(consultedSources ?? []);
  return {
    rows: labels.map((label, index) => ({
      id: answerWorkCheckedSourceRowId(label, true, index),
      detail: `Checked ${physicalToolSourceLabel(label)}`,
      sourceLabels: [label],
      state: 'complete' as const,
      sort: 50,
      ordinal: index,
    })),
    sourceCount: labels.length,
    durationMs: null,
  };
}

function completedAnswerWorkDurationMs(
  events: readonly ConversationMessagePublicWorkEvent[] | undefined,
  completedAt: Date,
): number | null {
  const firstEvent = (events ?? []).find((event) => event.createdAt instanceof Date);
  if (!firstEvent) return null;
  return Math.max(0, completedAt.getTime() - firstEvent.createdAt.getTime());
}

function completedAnswerWorkStatus(timeline: CompletedAnswerWorkTimeline): string {
  if (timeline.durationMs === null) return 'Worked';
  return `Worked for ${formatWorkLogDuration(timeline.durationMs)}`;
}

function renderCompletedAnswerWorkTimeline(
  timeline: CompletedAnswerWorkTimeline,
): HtmlEscapedString {
  if (timeline.rows.length === 0) return html`` as HtmlEscapedString;
  return html`<details
    class="squire-answer-work"
    data-testid="answer-progress"
    data-work-state="complete"
  >
    <summary class="squire-answer-work__summary">
      <span class="squire-answer-work__status" data-answer-work-status>
        ${completedAnswerWorkStatus(timeline)}
      </span>
      <span class="squire-answer-work__summary-caret" aria-hidden="true"></span>
    </summary>
    <div class="squire-answer-work__rows" data-answer-work-rows>
      ${timeline.rows.map(
        (row) =>
          html`<div
            class="${row.variant === 'narrative'
              ? 'squire-answer-work__row squire-answer-work__row--narrative'
              : `squire-answer-work__row squire-answer-work__row--event${
                  row.state === 'error' ? ' is-error' : ''
                }`}"
            data-answer-work-id="${row.id}"
            ${row.sourceLabels.length > 0
              ? html`data-answer-work-source-labels="${row.sourceLabels.join('|')}"`
              : html``}
            data-work-state="${row.state}"
          >
            ${row.variant === 'narrative'
              ? html``
              : html`<span class="squire-answer-work__row-icon" aria-hidden="true"></span>`}
            <span class="squire-answer-work__row-detail">${row.detail}</span>
          </div>`,
      )}
    </div>
  </details>` as HtmlEscapedString;
}

function renderCompletedAnswerWork(message: ConversationMessage): HtmlEscapedString {
  if (message.isError) {
    return html`` as HtmlEscapedString;
  }
  const persistedTimeline = buildCompletedAnswerWorkTimeline(
    message.publicWorkEvents,
    message.workCompletedAt ?? message.createdAt,
  );
  if (persistedTimeline.rows.length > 0) {
    return renderCompletedAnswerWorkTimeline(persistedTimeline);
  }
  return renderCompletedAnswerWorkTimeline(timelineFromConsultedSources(message.consultedSources));
}

function renderAnswerReportAction(options: {
  userMessageId?: string | null;
  assistantMessageId?: string | null;
  langsmithRunId?: string | null;
  langsmithRunUrl?: string | null;
  langsmithTraceUrl?: string | null;
  defaultKind: 'bad_answer' | 'broken_stream';
}): HtmlEscapedString {
  return html`<div class="squire-answer__actions">
    <button
      type="button"
      class="squire-answer__report"
      data-squire-report-bug
      ${options.userMessageId ? html`data-user-message-id="${options.userMessageId}"` : html``}
      ${options.assistantMessageId
        ? html`data-assistant-message-id="${options.assistantMessageId}"`
        : html``}
      ${options.langsmithRunId ? html`data-langsmith-run-id="${options.langsmithRunId}"` : html``}
      ${options.langsmithRunUrl
        ? html`data-langsmith-run-url="${options.langsmithRunUrl}"`
        : html``}
      ${options.langsmithTraceUrl
        ? html`data-langsmith-trace-url="${options.langsmithTraceUrl}"`
        : html``}
      data-bug-report-default-kind="${options.defaultKind}"
    >
      Report bug
    </button>
  </div>` as HtmlEscapedString;
}

function renderAnswerTurn(message: ConversationMessage): HtmlEscapedString {
  const content = message.isError
    ? (html`<p>${message.content}</p>` as HtmlEscapedString)
    : renderAssistantContent(message.content);
  const labelId = `squire-answer-label-${message.id}`;
  return html`<article
    class="squire-turn squire-answer${message.isError ? ' squire-answer--error' : ''}"
    data-testid="answer-turn"
    data-message-id="${message.id}"
    ${message.responseToMessageId
      ? html`data-response-to-message-id="${message.responseToMessageId}"`
      : html``}
    aria-labelledby="${labelId}"
  >
    <h2 class="sr-only" id="${labelId}">Squire answer</h2>
    ${renderCompletedAnswerWork(message)} ${renderAnswerContent(content)}
    ${renderAnswerReportAction({
      userMessageId: message.responseToMessageId,
      assistantMessageId: message.id,
      langsmithRunId: message.langsmithRunId,
      langsmithRunUrl: message.langsmithRunUrl,
      langsmithTraceUrl: message.langsmithTraceUrl,
      defaultKind: message.isError ? 'broken_stream' : 'bad_answer',
    })}
  </article>` as HtmlEscapedString;
}

function renderPendingAnswerSkeleton(streamUrl: string): HtmlEscapedString {
  // ADR 0012: the pending answer is the unit of streaming. The stream URL
  // moves from the (deleted) `.squire-transcript--pending` wrapper onto the
  // `<article class="squire-answer--pending">` itself, so squire.js can find
  // the active stream regardless of whether the article was rendered as part
  // of a full transcript or appended via `hx-swap="beforeend"`.
  const userMessageId = messageIdFromStreamUrl(streamUrl);
  const labelId = userMessageId
    ? `squire-pending-answer-label-${userMessageId}`
    : 'squire-pending-answer-label';
  return html`<article
    class="squire-turn squire-answer squire-answer--pending"
    data-testid="answer-turn"
    ${userMessageId ? html`data-response-to-message-id="${userMessageId}"` : html``}
    data-stream-state="pending"
    data-stream-url="${streamUrl}"
    aria-labelledby="${labelId}"
  >
    <h2 class="sr-only" id="${labelId}">Squire answer</h2>
    <details class="squire-answer-work" data-testid="answer-progress" data-work-state="idle" open>
      <summary class="squire-answer-work__summary">
        <span class="squire-answer-work__status" data-answer-work-status>Working</span>
        <span class="squire-answer-work__summary-caret" aria-hidden="true"></span>
      </summary>
      <div
        class="squire-answer-work__rows"
        data-answer-work-rows
        aria-live="polite"
        aria-atomic="false"
      ></div>
    </details>
    <div class="squire-answer__artifacts" data-testid="answer-artifacts" aria-live="polite"></div>
    <div class="squire-answer__content squire-markdown" data-testid="answer-content"></div>
    <div class="squire-answer__skeleton" aria-hidden="true">
      <div class="squire-answer__skeleton-dropcap"></div>
      <div class="squire-answer__skeleton-line squire-answer__skeleton-line--full"></div>
      <div class="squire-answer__skeleton-line squire-answer__skeleton-line--mid"></div>
      <div class="squire-answer__skeleton-line squire-answer__skeleton-line--short"></div>
    </div>
    ${renderAnswerReportAction({
      userMessageId,
      assistantMessageId: null,
      defaultKind: 'broken_stream',
    })}
  </article>` as HtmlEscapedString;
}

/**
 * Render the full HTML document for the companion-first layout. Stable
 * selectors (`squire-header`, `squire-surface`, `squire-input-dock`,
 * `squire-rail`) are guaranteed by the acceptance
 * criteria — later tickets target them by class.
 */
export async function layoutShell(options: LayoutShellOptions = {}): Promise<HtmlEscapedString> {
  // The layout adapts chrome based on whether a session was provided.
  // Session present = logged in = full chrome. Absent = brand only.
  const authenticated = options.session !== undefined;
  const showRail = options.showRail ?? authenticated;
  const showChatChrome = options.showChatChrome ?? authenticated;
  const showConversationHistory = authenticated && showChatChrome && showRail;
  const conversationHistory = showConversationHistory
    ? (options.conversationHistory ?? EMPTY_CONVERSATION_HISTORY)
    : null;
  const csrfToken = options.csrfToken;
  if (authenticated && !csrfToken) {
    throw new Error('layoutShell requires a csrfToken when rendering authenticated chrome');
  }
  const authenticatedCsrfToken = csrfToken ?? '';
  const chatFormAction = options.chatFormAction ?? '/chat';
  const chatFormHxTarget = options.chatFormHxTarget ?? '#squire-surface';
  const chatFormHxSwap = options.chatFormHxSwap ?? 'innerHTML';
  const headerContext = options.headerContext ?? 'HAVEN · RULES';
  const columnClassName = options.columnClassName ?? 'squire-column';
  const historyQuery = conversationHistory?.query ?? '';
  const chatFormHiddenFields = [
    ...(csrfToken ? [{ name: CSRF_FORM_FIELD_NAME, value: csrfToken }] : []),
    // E8: an active campaign supplies the game dimension; the per-session
    // selector (and its hidden field) exist only for no-campaign sessions.
    ...(options.campaignStrip ? [] : [{ name: 'game', value: DEFAULT_GAME_ID }]),
    ...(historyQuery ? [{ name: 'historyQuery', value: historyQuery }] : []),
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
  return renderDocument({
    authenticated,
    csrfToken,
    bodyClass: 'squire-body',
    bodyContent: html`${!authenticated || !showChatChrome
        ? html``
        : html`<a href="#squire-input" class="sr-only-focusable">Skip to ask Squire</a>`}
      <div class="squire-frame">
        ${conversationHistory ? renderConversationHistoryShell(conversationHistory) : html``}
        <div class="${columnClassName}">
          <header class="squire-header">
            ${authenticated && options.session
              ? html`<a class="squire-header__brand" href="/" aria-label="Go to Squire home">
                    <span class="squire-monogram" aria-hidden="true">S</span>
                    <span class="squire-wordmark">Squire</span>
                  </a>
                  ${conversationHistory ? renderHistoryToggle() : html``}
                  ${options.campaignStrip !== undefined
                    ? renderCampaignStrip(options.campaignStrip, {
                        prominent: options.campaignStripProminent,
                      })
                    : html``}
                  ${showChatChrome
                    ? options.campaignStrip
                      ? html``
                      : renderActiveGamePicker()
                    : html`<span class="squire-context">${headerContext}</span>`}
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
            aria-live="${showChatChrome && !options.transcriptOwnsLiveRegion ? 'polite' : 'off'}"
            aria-atomic="${showChatChrome && !options.transcriptOwnsLiveRegion ? 'false' : 'true'}"
          >
            ${surfaceContent}
          </main>
          ${!authenticated || !showChatChrome
            ? html``
            : html`<form
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
        <p class="squire-tagline">A HAVEN RULES COMPANION</p>
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
        <p class="squire-tagline">A HAVEN RULES COMPANION</p>
        ${renderAuthBanner({
          label: 'NOT YET INVITED',
          message: "Squire is single-user during Phase 1. Reach out if you'd like access.",
        })}
      </section>
    </main>` as HtmlEscapedString,
  );
}

export async function renderEmailNotVerifiedPage(): Promise<HtmlEscapedString> {
  return renderAuthPage(
    html`<main class="squire-auth-page">
      <section class="squire-auth-page__stack" aria-label="Google email not verified">
        <span class="squire-monogram squire-monogram--masthead" aria-hidden="true">S</span>
        <span class="squire-wordmark squire-wordmark--auth">Squire</span>
        <p class="squire-tagline">A HAVEN RULES COMPANION</p>
        <div class="squire-banner squire-banner--error" role="alert">
          <span class="squire-banner__label">GOOGLE EMAIL NOT VERIFIED</span>
          <p class="squire-banner__body">
            Google says this account's email address has not been verified. Squire only allows
            sign-in with a verified Google email address.
          </p>
          <p class="squire-banner__body">
            Sign in to that Google Account and finish Google's account verification, then try again.
          </p>
          <div class="squire-banner__actions">
            <a href="/auth/google/start" class="squire-button squire-button--ghost">
              Try again with Google
            </a>
            <a
              href="https://support.google.com/accounts/answer/63950"
              class="squire-button squire-button--ghost"
              rel="noreferrer"
            >
              Open Google verification help
            </a>
          </div>
        </div>
      </section>
    </main>` as HtmlEscapedString,
  );
}

/**
 * Authenticated home-page surface. A purpose-built landing composition —
 * "At your service." Fraunces hero, a sepia small-caps scope line, and
 * nothing else above the input dock. Chip row, verdict block, PICKED
 * badge, and spoiler banner are all intentionally absent: SQR-107 /
 * ADR 0012 supersede ADR 0010's current-turn ledger on the home surface.
 * Real owned conversation history lives in the shell per ADR 0020.
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
  options: {
    conversationHistory?: ConversationHistoryViewModel;
    campaignStrip?: CampaignStripState | null;
  } = {},
): Promise<HtmlEscapedString> {
  return layoutShell({
    session,
    csrfToken,
    conversationHistory: options.conversationHistory,
    campaignStrip: options.campaignStrip,
    chatFormAction: '/chat',
    chatFormHiddenFields: [
      { name: 'idempotencyKey', value: '' },
      // Per-message campaign binding (E6/SQR-19): chat turns bind to the
      // active campaign shown in the strip.
      ...(options.campaignStrip
        ? [{ name: 'campaignId', value: options.campaignStrip.campaignId }]
        : []),
    ],
    mainContent: renderHomeLanding(),
  });
}

export async function renderConversationPage(options: {
  session: Session;
  csrfToken: string;
  conversationId: string;
  messages: ConversationMessage[];
  conversationHistory?: ConversationHistoryViewModel;
  campaignStrip?: CampaignStripState | null;
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
  // than replacing the whole surface. ADR 0020 keeps real conversation
  // history in the shell without reviving placeholder campaign/thread UI.
  const transcript = renderConversationTranscript({
    conversationId: options.conversationId,
    messages: options.messages,
    pendingStreamUrls: options.pendingStreamUrls,
  });

  return layoutShell({
    session: options.session,
    csrfToken: options.csrfToken,
    mainContent: transcript,
    conversationHistory: options.conversationHistory,
    campaignStrip: options.campaignStrip,
    chatFormAction: `/chat/${options.conversationId}/messages`,
    chatFormHxTarget: '.squire-transcript',
    chatFormHxSwap: 'beforeend',
    chatFormHiddenFields: options.campaignStrip
      ? [{ name: 'campaignId', value: options.campaignStrip.campaignId }]
      : [],
    transcriptOwnsLiveRegion: true,
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
    data-testid="conversation-transcript"
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
      return html`${renderQuestionTurn(pair.userMessage.content, {
        messageId: pair.userMessage.id,
      })}
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
  return html`${renderQuestionTurn(options.question, {
    messageId: messageIdFromStreamUrl(options.streamUrl) ?? undefined,
  })}
  ${renderPendingAnswerSkeleton(options.streamUrl)}` as HtmlEscapedString;
}
