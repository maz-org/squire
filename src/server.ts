/**
 * Squire HTTP server.
 * Hono-based API with health check and service initialization.
 */

import 'dotenv/config';
// MUST be the first application import — PgInstrumentation has to patch `pg`
// before service.ts transitively loads db.ts, otherwise Postgres spans never
// reach LangSmith in production. Same pattern as query.ts and eval/run.ts.
import './instrumentation.ts';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { SpanStatusCode, trace, type Attributes, type Span } from '@opentelemetry/api';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import {
  identityFromSessionUser,
  requireIdentityFromAuthInfo,
  userIdFromAuthInfo,
  UserIdentityRequiredError,
  type CallerIdentity,
} from './campaign/identity.ts';
import * as CampaignService from './campaign/campaign-service.ts';
import * as CharacterService from './campaign/character-service.ts';
import { checkClassName, knownClassNames } from './campaign/class-validation.ts';
import { VersionConflictError } from './db/repositories/types.ts';
import { html } from 'hono/html';
import { streamSSE } from 'hono/streaming';
import {
  ask,
  ensureAskBudgetAvailable,
  ensureBootstrapStatus,
  isReady,
  startBootstrapLifecycle,
} from './service.ts';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

import { getDb, getWorktreeRuntime } from './db.ts';
import { loadServerConfig } from './config.ts';
import { runReadinessChecks } from './health.ts';
import { originSharedSecretMiddleware } from './origin-lock.ts';
import { resolveTrustedClientIp } from './http/trusted-client-ip.ts';
import { LlmBudgetExceededError } from './llm-budget.ts';
import {
  API_ASK_RATE_LIMIT_POLICY,
  API_CARD_SEARCH_RATE_LIMIT_POLICY,
  API_RULE_SEARCH_RATE_LIMIT_POLICY,
  CAMPAIGN_READ_RATE_LIMIT_POLICY,
  CAMPAIGN_WRITE_RATE_LIMIT_POLICY,
  GOOGLE_OAUTH_CALLBACK_RATE_LIMIT_POLICY,
  GOOGLE_OAUTH_START_RATE_LIMIT_POLICY,
  getDefaultRateLimiter,
  MCP_REQUEST_RATE_LIMIT_POLICY,
  REGISTER_CLIENT_RATE_LIMIT_POLICY,
  type RateLimitPolicy,
  type RateLimitDecision,
} from './rate-limit.ts';
import { errorLogFields, writeSecurityLog } from './security-log.ts';
import { registerDevLoginRoute, shouldRegisterDevLogin } from './auth/dev-login.ts';
import {
  toolSourceLabel,
  TOOL_SOURCE_FALLBACK_LABEL,
  retrievalSourceLabelToFooterLabel,
  isToolSourceLabel,
} from './web-ui/consulted-footer.ts';
import { humanizeWorkLogProgressMessage } from './work-log-display.ts';
import { stagedMutationLines } from './web-ui/proposal-block.ts';
import { itemCostWarnings, levelXpWarnings } from './campaign/write-validation.ts';
import { renderCharacterSheetContent } from './web-ui/character-sheet.ts';
import { renderProfileContent } from './web-ui/profile-page.ts';
import * as CharacterRepository from './db/repositories/character-repository.ts';
import {
  findCardByName,
  findItemByNumber,
  listCardOptionsForClass,
  listItemOptions,
  resolveCardDisplayNames,
} from './campaign/character-sheet-data.ts';
import { claimWorktreePort } from './worktree-runtime.ts';
import { searchRules, searchCards, listCardTypes, listCards, getCard } from './tools.ts';
import type { CardType } from './schemas.ts';
import { normalizeGameId, requireGameId } from './game.ts';
import { z } from 'zod';
import { createMcpServer } from './mcp.ts';
import { startHttpServer } from './server-start.ts';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  registerClient,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  verifyAccessToken,
  OAuthError,
} from './auth.ts';
import {
  generateState,
  generateCodeVerifier,
  computeCodeChallenge,
  buildGoogleAuthUrl,
  handleGoogleCallback,
  GoogleAuthError,
  resolveGoogleRedirectUri,
} from './auth/google.ts';
import { getSessionSecret, SESSION_COOKIE_NAME } from './auth/session-middleware.ts';
import { CSRF_HEADER_NAME } from './web-ui/csrf.ts';
import * as SessionRepository from './db/repositories/session-repository.ts';
import { writeAuditEvent } from './auth/audit.ts';
import {
  optionalSession,
  requirePageSession,
  requireSession,
  setSessionCookie,
  clearSessionCookie,
} from './auth/session-middleware.ts';
import { createCsrfToken, requireCsrf } from './auth/csrf.ts';
import { setSignedCookie, getSignedCookie, deleteCookie } from 'hono/cookie';
import {
  layoutShell,
  renderConversationPage,
  renderConversationTranscriptWithHistoryOob,
  renderConversationTurnAppendFragmentWithHistoryOob,
  renderHomePage,
  renderLoginPage,
  renderMarkdownStyleguidePage,
  renderEmailNotVerifiedPage,
  renderNotInvitedPage,
} from './web-ui/layout.ts';
import { renderAssistantContentHtml } from './web-ui/assistant-content.ts';
import {
  renderCampaignDashboardContent,
  renderCampaignListContent,
  type CampaignStripState,
} from './web-ui/campaign-pages.ts';
import { renderDashboardThreads } from './web-ui/campaign-dashboard.ts';
import { renderCampaignJournal } from './web-ui/campaign-journal.ts';
import { listJournal } from './campaign/journal.ts';
import * as PendingMutations from './campaign/pending-mutations.ts';
import * as WriteTools from './campaign/write-tools.ts';
import { ProposalStateError } from './campaign/pending-mutations.ts';
import { deriveAvailability, qualifiedKey } from './campaign/availability.ts';
import { loadModuleGraphs } from './campaign/unlock-graph-loader.ts';
import type { Campaign } from './db/repositories/types.ts';
import type { HtmlEscapedString } from 'hono/utils/html';
import {
  countActiveMembers as CampaignMemberRepositoryCount,
  findActiveMember as CampaignMemberRepositoryFindActive,
} from './db/repositories/campaign-member-repository.ts';
import { getAppCss, getHtmxJs, getSquireJs } from './web-ui/assets.ts';
import { getFaviconSvg } from './web-ui/favicon.ts';
import {
  appendMessage,
  createPendingConversation,
  createPendingFollowUp,
  GENERIC_FAILURE_MESSAGE,
  loadConversation,
  loadConversationHistory,
  loadConversationMessage,
  persistAssistantFailureTurn,
  startConversation,
  streamAssistantTurn,
} from './chat/conversation-service.ts';
import { captureChatFailureTelemetry } from './chat/chat-telemetry.ts';
import * as MessageStreamEventRepository from './db/repositories/message-stream-event-repository.ts';
import type { BrowserStreamEventName } from './db/repositories/message-stream-event-repository.ts';
import {
  captureTelemetryError,
  captureTelemetryFeedback,
  captureTelemetryLog,
  captureTelemetryMessage,
  flushTelemetry,
  initTelemetry,
  type TelemetryCaptureInput,
  type TelemetryFeedbackInput,
  type TelemetryLogInput,
  type TelemetryLogLevel,
  type TelemetryUserIdentity,
} from './telemetry.ts';
import { resolveSquireEnv } from './squire-env.ts';

initTelemetry(process.env);

export const app = new Hono();

const UNRESOLVED_REQUEST_ROUTE = 'unresolved';
const UNMATCHED_REQUEST_ROUTE = 'unmatched';
const TEST_TELEMETRY_HASH_SECRET = 'squire-test-telemetry-hash-secret';
const DEV_TELEMETRY_HASH_SECRET = 'squire-development-telemetry-hash-secret';

app.use('*', requestLifecycleMiddleware);
app.use('*', originSharedSecretMiddleware());

const HTML_CSP =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' https://fonts.googleapis.com; " +
  "img-src 'self' data: https:; " +
  "connect-src 'self'; " +
  "font-src 'self' https://fonts.gstatic.com; " +
  "object-src 'none'; " +
  "base-uri 'none'; " +
  "frame-ancestors 'none'; " +
  "form-action 'self'";

const cspMiddleware: MiddlewareHandler = async (c, next) => {
  await next();
  const contentType = c.res.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) {
    c.res.headers.set('content-security-policy', HTML_CSP);
  }
};

app.use('*', cspMiddleware);

// ─── Web UI asset pipeline (SQR-71, ADR 0011) ────────────────────────────────
//
// Rails Propshaft semantics: dev serves bare paths with no-cache so edits to
// styles.css and squire.js show up immediately in devtools, while prod reads
// CSS built by `npm run build:web-assets` during the Docker build and serves
// content-hashed paths (`/app.<hash>.css`,
// `/squire.<hash>.js`) with immutable caching so the edge and
// browsers can cache forever and invalidation is automatic on
// content change. Hash is enforced by the router regex
// (`[a-f0-9]+`) so non-hex paths 404 before the handler runs; a
// prod hash mismatch (stale HTML after deploy) also 404s and the
// browser reloads HTML on next navigation.
//
// Both route patterns are registered unconditionally; the handlers
// branch on NODE_ENV at request time so tests can stub env without
// re-importing the server module. See ADR 0011 fingerprinting
// addendum for the full rationale.

const PROD_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const DEV_ASSET_CACHE_CONTROL = 'no-cache';

function isProdEnv(): boolean {
  return process.env.NODE_ENV === 'production';
}

function auditContext(c: Context): { ipAddress: string | null; userAgent: string | null } {
  return {
    ipAddress: resolveTrustedClientIp(c.req),
    userAgent: c.req.header('user-agent') ?? null,
  };
}

function correlateRequest(c: Context): string {
  const existingRequestId = c.get('requestId');
  if (typeof existingRequestId === 'string' && existingRequestId.trim().length > 0) {
    c.header('X-Request-ID', existingRequestId);
    return existingRequestId;
  }

  const incomingRequestId = c.req.header('x-request-id');
  const requestId =
    incomingRequestId && /^[A-Za-z0-9._:-]{1,128}$/.test(incomingRequestId)
      ? incomingRequestId
      : randomUUID();
  c.set('requestId', requestId);
  c.header('X-Request-ID', requestId);
  return requestId;
}

function safeRequestRoute(c: Context): string {
  try {
    const route = c.req.routePath;
    return route && route !== '*' && route !== '/*' ? route : UNMATCHED_REQUEST_ROUTE;
  } catch {
    return UNMATCHED_REQUEST_ROUTE;
  }
}

function safeRequestStartRoute(c: Context): string {
  try {
    const route = c.req.routePath;
    return route && route !== '*' && route !== '/*' ? route : UNRESOLVED_REQUEST_ROUTE;
  } catch {
    return UNRESOLVED_REQUEST_ROUTE;
  }
}

function safeUserFromContext(c: Context): TelemetryUserIdentity | undefined {
  const callerIdentity = c.get('callerIdentity') as CallerIdentity | undefined;
  if (callerIdentity?.userId) return { id: callerIdentity.userId };

  const authInfo = c.get('authInfo') as AuthInfo | undefined;
  const tokenUserId = userIdFromAuthInfo(authInfo);
  if (tokenUserId) return { id: tokenUserId };

  const session = c.get('session') as { userId?: unknown } | undefined;
  return typeof session?.userId === 'string' && session.userId.trim().length > 0
    ? { id: session.userId }
    : undefined;
}

function telemetryHashSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (secret) return secret;
  return process.env.VITEST ? TEST_TELEMETRY_HASH_SECRET : DEV_TELEMETRY_HASH_SECRET;
}

function hashTelemetryIdentifier(kind: string, value: string): string {
  return createHmac('sha256', telemetryHashSecret())
    .update(`${kind}:${value}`)
    .digest('base64url')
    .slice(0, 32);
}

function hashedTelemetryUser(
  user: TelemetryUserIdentity | undefined,
): TelemetryUserIdentity | undefined {
  if (user?.hash) return { hash: user.hash };
  if (user?.id) return { hash: hashTelemetryIdentifier('user', user.id) };
  return undefined;
}

function safeLifecycleUserFromContext(c: Context): TelemetryUserIdentity | undefined {
  return hashedTelemetryUser(safeUserFromContext(c));
}

function buildServerErrorTelemetry(c: Context, requestId: string): TelemetryCaptureInput {
  const route = safeRequestRoute(c);
  return {
    route,
    requestId,
    user: safeUserFromContext(c),
    context: {
      surface: 'server',
      method: c.req.method,
      path: c.req.path,
      route,
      status: 500,
    },
  };
}

function safeTelemetryEnvironment(): string {
  try {
    return resolveSquireEnv(process.env);
  } catch {
    return 'unknown';
  }
}

function safeTelemetryRelease(): string {
  return process.env.SENTRY_RELEASE?.trim() || 'unavailable';
}

function requestLifecycleLevel(status: number): TelemetryLogLevel {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}

function requestDurationMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function responseStatus(c: Context, error: unknown): number {
  if (error) return 500;
  const status = c.res.status;
  return typeof status === 'number' && status > 0 ? status : 200;
}

function requestLifecycleAttributes(input: {
  method: string;
  route: string;
  requestId: string;
  environment: string;
  release: string;
  status?: number;
  durationMs?: number;
  user?: TelemetryUserIdentity;
}): Record<string, string | number> {
  return {
    environment: input.environment,
    release: input.release,
    method: input.method,
    route: input.route,
    request_id: input.requestId,
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.durationMs === undefined ? {} : { duration_ms: input.durationMs }),
    ...(input.user?.hash ? { user_hash: input.user.hash } : {}),
  };
}

function buildRequestLifecycleLogInput(input: {
  c: Context;
  requestId: string;
  route: string;
  environment: string;
  release: string;
  status?: number;
  durationMs?: number;
}): TelemetryLogInput {
  const user = safeLifecycleUserFromContext(input.c);
  return {
    route: input.route,
    requestId: input.requestId,
    user,
    context: {
      surface: 'server',
      eventType: 'request_lifecycle',
      method: input.c.req.method,
      route: input.route,
      ...(input.status === undefined ? {} : { status: input.status }),
    },
    attributes: requestLifecycleAttributes({
      method: input.c.req.method,
      route: input.route,
      requestId: input.requestId,
      environment: input.environment,
      release: input.release,
      status: input.status,
      durationMs: input.durationMs,
      user,
    }),
  };
}

function annotateRequestSpan(
  span: Span,
  input: {
    method: string;
    route: string;
    status: number;
    durationMs: number;
    requestId: string;
    environment: string;
    release: string;
    user?: TelemetryUserIdentity;
  },
): void {
  span.setAttributes({
    'http.request.method': input.method,
    'http.route': input.route,
    'http.response.status_code': input.status,
    'squire.duration_ms': input.durationMs,
    'squire.environment': input.environment,
    'squire.release': input.release,
    'squire.request_id': input.requestId,
    ...(input.user?.hash ? { 'squire.user_hash': input.user.hash } : {}),
  });
  if (input.status >= 500) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${input.status}` });
  }
}

async function requestLifecycleMiddleware(c: Context, next: () => Promise<void>): Promise<void> {
  await trace.getTracer('squire.server').startActiveSpan('http.server.request', async (span) => {
    const startedAt = Date.now();
    const requestId = correlateRequest(c);
    const environment = safeTelemetryEnvironment();
    const release = safeTelemetryRelease();
    const startRoute = safeRequestStartRoute(c);

    captureTelemetryLog(
      'info',
      'server.request.started',
      buildRequestLifecycleLogInput({
        c,
        requestId,
        route: startRoute,
        environment,
        release,
      }),
    );

    let caughtError: unknown;
    try {
      await next();
    } catch (error) {
      caughtError = error;
      throw error;
    } finally {
      const status = responseStatus(c, caughtError);
      const durationMs = requestDurationMs(startedAt);
      const route = safeRequestRoute(c);
      const user = safeLifecycleUserFromContext(c);

      captureTelemetryLog(
        requestLifecycleLevel(status),
        'server.request.completed',
        buildRequestLifecycleLogInput({
          c,
          requestId,
          route,
          environment,
          release,
          status,
          durationMs,
        }),
      );
      annotateRequestSpan(span, {
        method: c.req.method,
        route,
        status,
        durationMs,
        requestId,
        environment,
        release,
        user,
      });
      span.end();
    }
  });
}

const BrowserTelemetryTokenSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const BrowserTelemetryEventIdSchema = z
  .string()
  .length(32)
  .regex(/^[a-f0-9]+$/i);

const BrowserFeedbackKindSchema = z.enum([
  'wrong_answer',
  'stream_failed',
  'ui_broken',
  'source_problem',
  'other',
]);

const BrowserMaskedReplayMaskSelectorSchema = z.enum([
  '.squire-transcript',
  '.squire-question',
  '.squire-answer',
  '.squire-answer__content',
  '.squire-answer__artifacts',
  '.squire-answer-work',
  '.squire-input-dock',
  '.squire-input-dock textarea',
  '.squire-history-row',
  '.squire-campaign-strip',
  '.squire-campaign-dashboard',
  '.squire-character-sheet',
]);

const BrowserMaskedReplayBlockSelectorSchema = z.enum([
  '.squire-account-menu',
  '.squire-account-menu__panel',
  '.squire-account-menu__avatar',
]);

const BrowserMaskedReplaySchema = z
  .object({
    version: z.literal(1),
    textMasked: z.literal(true),
    attributesMasked: z.literal(true),
    snapshotId: BrowserTelemetryTokenSchema.optional(),
    maskSelectors: z.array(BrowserMaskedReplayMaskSelectorSchema).min(1).max(24),
    blockSelectors: z.array(BrowserMaskedReplayBlockSelectorSchema).min(1).max(12),
    turns: z
      .object({
        userTurnCount: z.number().int().nonnegative().max(1_000),
        assistantTurnCount: z.number().int().nonnegative().max(1_000),
        pendingTurnCount: z.number().int().nonnegative().max(1_000),
        workLogCount: z.number().int().nonnegative().max(1_000),
        errorBannerCount: z.number().int().nonnegative().max(1_000),
      })
      .strict(),
    input: z
      .object({
        present: z.boolean(),
        valueLengthBucket: z.enum(['0', '1-80', '81-240', '241+']),
      })
      .strict(),
    history: z
      .object({
        rowCount: z.number().int().nonnegative().max(1_000),
        activeStatus: z.enum(['idle', 'running', 'error', 'unknown']),
      })
      .strict()
      .optional(),
  })
  .strict();

const BrowserTelemetrySchema = z
  .object({
    type: z.enum([
      'browser_error',
      'browser_unhandledrejection',
      'browser_stream_started',
      'browser_stream_completed',
      'browser_stream_error',
      'browser_htmx_error',
      'browser_feedback',
    ]),
    route: z.string().min(1).max(2048).optional(),
    conversationId: BrowserTelemetryTokenSchema.optional(),
    userMessageId: BrowserTelemetryTokenSchema.optional(),
    errorName: BrowserTelemetryTokenSchema.optional(),
    reasonType: BrowserTelemetryTokenSchema.optional(),
    source: z.string().min(1).max(2048).optional(),
    line: z.number().int().nonnegative().max(1_000_000).optional(),
    column: z.number().int().nonnegative().max(1_000_000).optional(),
    viewport: z
      .object({
        width: z.number().int().positive().max(20_000),
        height: z.number().int().positive().max(20_000),
      })
      .strict()
      .optional(),
    userAgent: z.string().min(1).max(512).optional(),
    streamErrorKind: z.enum(['transport', 'session']).optional(),
    streamReadyState: z.number().int().min(0).max(2).optional(),
    streamDurationMs: z.number().int().nonnegative().max(3_600_000).optional(),
    streamFirstEventMs: z.number().int().nonnegative().max(3_600_000).optional(),
    streamEventCount: z.number().int().nonnegative().max(100_000).optional(),
    streamTextEventCount: z.number().int().nonnegative().max(100_000).optional(),
    streamToolEventCount: z.number().int().nonnegative().max(100_000).optional(),
    htmxEvent: BrowserTelemetryTokenSchema.optional(),
    htmxStatus: z.number().int().min(0).max(999).optional(),
    feedbackKind: BrowserFeedbackKindSchema.optional(),
    associatedEventId: BrowserTelemetryEventIdSchema.optional(),
    maskedReplay: BrowserMaskedReplaySchema.optional(),
  })
  .strict();

type BrowserTelemetryEvent = z.infer<typeof BrowserTelemetrySchema>;

const browserTelemetryTracer = trace.getTracer('squire.browser-telemetry');

function browserTelemetryLevel(event: BrowserTelemetryEvent): 'info' | 'error' {
  if (
    event.type === 'browser_error' ||
    event.type === 'browser_unhandledrejection' ||
    event.type === 'browser_stream_error' ||
    event.type === 'browser_htmx_error'
  ) {
    return 'error';
  }
  return 'info';
}

function browserTelemetryAttributes(event: BrowserTelemetryEvent): Record<string, string | number> {
  return {
    surface: 'browser',
    event_type: event.type,
    ...(event.errorName ? { error_name: event.errorName } : {}),
    ...(event.reasonType ? { reason_type: event.reasonType } : {}),
    ...(event.streamErrorKind ? { stream_error_kind: event.streamErrorKind } : {}),
    ...(event.streamReadyState === undefined ? {} : { stream_ready_state: event.streamReadyState }),
    ...(event.streamDurationMs === undefined ? {} : { stream_duration_ms: event.streamDurationMs }),
    ...(event.streamFirstEventMs === undefined
      ? {}
      : { stream_first_event_ms: event.streamFirstEventMs }),
    ...(event.streamEventCount === undefined ? {} : { stream_event_count: event.streamEventCount }),
    ...(event.streamTextEventCount === undefined
      ? {}
      : { stream_text_event_count: event.streamTextEventCount }),
    ...(event.streamToolEventCount === undefined
      ? {}
      : { stream_tool_event_count: event.streamToolEventCount }),
    ...(event.htmxEvent ? { htmx_event: event.htmxEvent } : {}),
    ...(event.htmxStatus === undefined ? {} : { htmx_status: event.htmxStatus }),
    ...(event.feedbackKind ? { feedback_kind: event.feedbackKind } : {}),
  };
}

function browserTelemetrySpanAttributes(
  input: TelemetryCaptureInput,
  event: BrowserTelemetryEvent,
): Attributes {
  return {
    'squire.surface': 'browser',
    'squire.route': input.route ?? '/browser',
    'squire.browser.event_type': event.type,
    ...(input.requestId ? { 'squire.request_id': input.requestId } : {}),
    ...(input.conversationId ? { 'squire.conversation_id': input.conversationId } : {}),
    ...(input.userMessageId ? { 'squire.user_message_id': input.userMessageId } : {}),
    ...(event.streamDurationMs === undefined
      ? {}
      : { 'squire.browser.stream_duration_ms': event.streamDurationMs }),
    ...(event.streamFirstEventMs === undefined
      ? {}
      : { 'squire.browser.stream_first_event_ms': event.streamFirstEventMs }),
    ...(event.streamEventCount === undefined
      ? {}
      : { 'squire.browser.stream_event_count': event.streamEventCount }),
    ...(event.streamTextEventCount === undefined
      ? {}
      : { 'squire.browser.stream_text_event_count': event.streamTextEventCount }),
    ...(event.streamToolEventCount === undefined
      ? {}
      : { 'squire.browser.stream_tool_event_count': event.streamToolEventCount }),
  };
}

function finishBrowserTelemetrySpan(span: Span, level: 'info' | 'error'): void {
  if (level === 'error') span.setStatus({ code: SpanStatusCode.ERROR, message: 'browser_error' });
  span.end();
}

function browserPathOnly(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;

  try {
    if (/^https?:\/\//i.test(value)) return new URL(value).pathname || '/';
  } catch {
    return undefined;
  }

  if (!value.startsWith('/')) return undefined;
  return value.split('?')[0]?.split('#')[0] || '/';
}

function buildBrowserTelemetryInput(
  c: Context,
  requestId: string,
  event: BrowserTelemetryEvent,
): TelemetryCaptureInput {
  const route = browserPathOnly(event.route) ?? '/browser';
  const source = browserPathOnly(event.source);
  return {
    route,
    requestId,
    conversationId: event.conversationId,
    userMessageId: event.userMessageId,
    user: safeUserFromContext(c),
    context: {
      surface: 'browser',
      eventType: event.type,
      telemetryEndpoint: '/api/browser-telemetry',
      errorName: event.errorName ?? null,
      reasonType: event.reasonType ?? null,
      source: source ?? null,
      line: event.line ?? null,
      column: event.column ?? null,
      viewport: event.viewport ?? null,
      userAgent: event.userAgent ?? null,
      streamErrorKind: event.streamErrorKind ?? null,
      streamReadyState: event.streamReadyState ?? null,
      streamDurationMs: event.streamDurationMs ?? null,
      streamFirstEventMs: event.streamFirstEventMs ?? null,
      streamEventCount: event.streamEventCount ?? null,
      streamTextEventCount: event.streamTextEventCount ?? null,
      streamToolEventCount: event.streamToolEventCount ?? null,
      htmxEvent: event.htmxEvent ?? null,
      htmxStatus: event.htmxStatus ?? null,
      maskedReplay: event.maskedReplay ?? null,
    },
  };
}

function buildBrowserFeedbackInput(
  c: Context,
  requestId: string,
  event: BrowserTelemetryEvent,
): TelemetryFeedbackInput | null {
  if (event.type !== 'browser_feedback' || !event.feedbackKind) return null;
  const input = buildBrowserTelemetryInput(c, requestId, event);
  return {
    ...input,
    feedbackKind: event.feedbackKind,
    associatedEventId: event.associatedEventId,
  };
}

async function checkRegisterRateLimit(c: Context): Promise<RateLimitDecision> {
  const identity = resolveTrustedClientIp(c.req) ?? 'unknown';
  return getDefaultRateLimiter().consume({
    policy: REGISTER_CLIENT_RATE_LIMIT_POLICY,
    identity,
  });
}

async function checkIpRateLimit(c: Context, policy: RateLimitPolicy): Promise<RateLimitDecision> {
  const identity = resolveTrustedClientIp(c.req) ?? 'unknown';
  return getDefaultRateLimiter().consume({ policy, identity });
}

function rateLimitedResponse(c: Context, decision: RateLimitDecision) {
  const retryAfterSeconds = Math.max(1, decision.retryAfterSeconds);
  writeSecurityLog({
    event: 'rate_limit_rejected',
    fields: {
      route: '/register',
      method: 'POST',
      policy: decision.policy.name,
      limit: decision.policy.limit,
      window_ms: decision.policy.windowMs,
      identity_hash: decision.identityHash,
      retry_after_seconds: retryAfterSeconds,
      reset_after_seconds: decision.resetAfterSeconds,
    },
  });

  c.header('Retry-After', String(retryAfterSeconds));
  return c.json(
    {
      error: 'rate_limited',
      error_description: 'Too many registration requests. Try again later.',
      retry_after_seconds: retryAfterSeconds,
    },
    429,
  );
}

function googleOAuthRateLimitedResponse(c: Context, decision: RateLimitDecision, route: string) {
  const retryAfterSeconds = Math.max(1, decision.retryAfterSeconds);
  writeSecurityLog({
    event: 'rate_limit_rejected',
    fields: {
      route,
      method: 'GET',
      policy: decision.policy.name,
      limit: decision.policy.limit,
      window_ms: decision.policy.windowMs,
      identity_hash: decision.identityHash,
      retry_after_seconds: retryAfterSeconds,
      reset_after_seconds: decision.resetAfterSeconds,
    },
  });

  c.header('Retry-After', String(retryAfterSeconds));
  return c.json(
    {
      error: 'rate_limited',
      error_description: 'Too many sign-in attempts. Try again later.',
      retry_after_seconds: retryAfterSeconds,
    },
    429,
  );
}

function rateLimitUnavailableResponse(c: Context, error: unknown) {
  writeSecurityLog({
    event: 'rate_limit_unavailable',
    level: 'error',
    fields: {
      route: '/register',
      method: 'POST',
      policy: REGISTER_CLIENT_RATE_LIMIT_POLICY.name,
      ...errorLogFields(error),
    },
  });

  return c.json(
    {
      error: 'temporarily_unavailable',
      error_description: 'Registration is temporarily unavailable. Try again later.',
    },
    503,
  );
}

function googleOAuthRateLimitUnavailableResponse(
  c: Context,
  error: unknown,
  route: string,
  policy: RateLimitPolicy,
) {
  writeSecurityLog({
    event: 'rate_limit_unavailable',
    level: 'error',
    fields: {
      route,
      method: 'GET',
      policy: policy.name,
      ...errorLogFields(error),
    },
  });

  return c.json(
    {
      error: 'temporarily_unavailable',
      error_description: 'Sign-in is temporarily unavailable. Try again later.',
    },
    503,
  );
}

type McpRateLimitIdentityKind = 'user' | 'client' | 'ip' | 'unknown';

interface McpRateLimitIdentity {
  kind: McpRateLimitIdentityKind;
  value: string;
}

interface McpRateLimitResult {
  decision: RateLimitDecision;
  identityKind: McpRateLimitIdentityKind;
}

type ApiRateLimitIdentityKind = 'user' | 'client';

interface ApiRateLimitIdentity {
  kind: ApiRateLimitIdentityKind;
  value: string;
}

interface ApiRateLimitResult {
  decision: RateLimitDecision;
  identityKind: ApiRateLimitIdentityKind;
}

function authInfoUserId(authInfo: AuthInfo): string | undefined {
  const userId = authInfo.extra?.userId;
  return typeof userId === 'string' && userId.trim().length > 0 ? userId : undefined;
}

function resolveApiRateLimitIdentity(authInfo: AuthInfo): ApiRateLimitIdentity {
  const userId = authInfoUserId(authInfo);
  if (userId) return { kind: 'user', value: `user:${userId}` };
  return { kind: 'client', value: `client:${authInfo.clientId}` };
}

function resolveMcpRateLimitIdentity(
  c: Context,
  authInfo: AuthInfo | undefined,
): McpRateLimitIdentity {
  if (authInfo) {
    const userId = authInfoUserId(authInfo);
    if (userId) return { kind: 'user', value: `user:${userId}` };
    return { kind: 'client', value: `client:${authInfo.clientId}` };
  }

  const ip = resolveTrustedClientIp(c.req);
  if (ip) return { kind: 'ip', value: `ip:${ip}` };
  return { kind: 'unknown', value: 'unknown' };
}

async function checkMcpRateLimit(
  c: Context,
  authInfo: AuthInfo | undefined,
): Promise<McpRateLimitResult> {
  const identity = resolveMcpRateLimitIdentity(c, authInfo);
  const decision = await getDefaultRateLimiter().consume({
    policy: MCP_REQUEST_RATE_LIMIT_POLICY,
    identity: identity.value,
  });
  return { decision, identityKind: identity.kind };
}

async function checkApiRateLimit(
  authInfo: AuthInfo,
  policy: RateLimitPolicy,
): Promise<ApiRateLimitResult> {
  const identity = resolveApiRateLimitIdentity(authInfo);
  const decision = await getDefaultRateLimiter().consume({
    policy,
    identity: identity.value,
  });
  return { decision, identityKind: identity.kind };
}

function mcpRateLimitedResponse(c: Context, result: McpRateLimitResult) {
  const retryAfterSeconds = Math.max(1, result.decision.retryAfterSeconds);
  writeSecurityLog({
    event: 'rate_limit_rejected',
    fields: {
      route: '/mcp',
      method: c.req.method,
      policy: result.decision.policy.name,
      limit: result.decision.policy.limit,
      window_ms: result.decision.policy.windowMs,
      identity_hash: result.decision.identityHash,
      identity_kind: result.identityKind,
      retry_after_seconds: retryAfterSeconds,
      reset_after_seconds: result.decision.resetAfterSeconds,
    },
  });

  c.header('Retry-After', String(retryAfterSeconds));
  return c.json(
    {
      error: 'rate_limited',
      error_description: 'Too many MCP requests. Try again later.',
      retry_after_seconds: retryAfterSeconds,
    },
    429,
  );
}

function apiRateLimitedResponse(c: Context, result: ApiRateLimitResult, route: string) {
  const retryAfterSeconds = Math.max(1, result.decision.retryAfterSeconds);
  writeSecurityLog({
    event: 'rate_limit_rejected',
    fields: {
      route,
      method: c.req.method,
      policy: result.decision.policy.name,
      limit: result.decision.policy.limit,
      window_ms: result.decision.policy.windowMs,
      identity_hash: result.decision.identityHash,
      identity_kind: result.identityKind,
      retry_after_seconds: retryAfterSeconds,
      reset_after_seconds: result.decision.resetAfterSeconds,
    },
  });

  c.header('Retry-After', String(retryAfterSeconds));
  return c.json(
    {
      error: 'rate_limited',
      error_description: 'Too many API requests. Try again later.',
      retry_after_seconds: retryAfterSeconds,
    },
    429,
  );
}

function budgetExceededResponse(c: Context, error: LlmBudgetExceededError) {
  return c.json(
    {
      error: 'llm_budget_exceeded',
      error_description: 'Daily LLM budget exhausted. Try again tomorrow.',
      budget_day: error.status.budgetDay,
      budget_usd: error.status.budgetUsd,
      spent_usd: error.status.spentUsd,
      remaining_usd: error.status.remainingUsd,
    },
    429,
  );
}

function apiRateLimitUnavailableResponse(
  c: Context,
  error: unknown,
  route: string,
  policy: RateLimitPolicy,
) {
  writeSecurityLog({
    event: 'rate_limit_unavailable',
    level: 'error',
    fields: {
      route,
      method: c.req.method,
      policy: policy.name,
      ...errorLogFields(error),
    },
  });

  return c.json(
    {
      error: 'temporarily_unavailable',
      error_description: 'API is temporarily unavailable. Try again later.',
    },
    503,
  );
}

function mcpRateLimitUnavailableResponse(c: Context, error: unknown) {
  writeSecurityLog({
    event: 'rate_limit_unavailable',
    level: 'error',
    fields: {
      route: '/mcp',
      method: c.req.method,
      policy: MCP_REQUEST_RATE_LIMIT_POLICY.name,
      ...errorLogFields(error),
    },
  });

  return c.json(
    {
      error: 'temporarily_unavailable',
      error_description: 'MCP is temporarily unavailable. Try again later.',
    },
    503,
  );
}

app.get('/favicon.svg', (c) => {
  c.header('content-type', 'image/svg+xml; charset=utf-8');
  c.header('cache-control', 'no-cache');
  return c.body(getFaviconSvg());
});

// Dev-only bare CSS path. In prod the HTML references the hashed
// URL, so the bare path 404s there.
app.get('/app.css', async (c) => {
  if (isProdEnv()) return c.notFound();
  const { content } = await getAppCss();
  c.header('content-type', 'text/css; charset=utf-8');
  c.header('cache-control', DEV_ASSET_CACHE_CONTROL);
  return c.body(content);
});

// Prod-only hashed CSS path. The regex matches the full filename
// (`app.<hex>.css`) as a single param because Hono's router doesn't
// support `:param{regex}.literal` patterns — it either 404s silently
// (single-segment) or throws (multi-segment) — but full-filename
// constraints work fine. Router rejects non-hex at the match layer;
// the handler then checks the filename matches the current prebuilt
// asset exactly and 404s on mismatch.
app.get('/:file{app\\.[a-f0-9]+\\.css}', async (c) => {
  if (!isProdEnv()) return c.notFound();
  const { content, hash } = await getAppCss();
  if (c.req.param('file') !== `app.${hash}.css`) return c.notFound();
  c.header('content-type', 'text/css; charset=utf-8');
  c.header('cache-control', PROD_ASSET_CACHE_CONTROL);
  return c.body(content);
});

// Dev-only bare JS path.
app.get('/squire.js', async (c) => {
  if (isProdEnv()) return c.notFound();
  const { content } = await getSquireJs();
  c.header('content-type', 'text/javascript; charset=utf-8');
  c.header('cache-control', DEV_ASSET_CACHE_CONTROL);
  return c.body(content);
});

app.get('/htmx.js', async (c) => {
  if (isProdEnv()) return c.notFound();
  const { content } = await getHtmxJs();
  c.header('content-type', 'text/javascript; charset=utf-8');
  c.header('cache-control', DEV_ASSET_CACHE_CONTROL);
  return c.body(content);
});

// Prod-only hashed JS path. Same full-filename-as-param pattern as
// the CSS handler for the same Hono router reason.
app.get('/:file{squire\\.[a-f0-9]+\\.js}', async (c) => {
  if (!isProdEnv()) return c.notFound();
  const { content, hash } = await getSquireJs();
  if (c.req.param('file') !== `squire.${hash}.js`) return c.notFound();
  c.header('content-type', 'text/javascript; charset=utf-8');
  c.header('cache-control', PROD_ASSET_CACHE_CONTROL);
  return c.body(content);
});

app.get('/:file{htmx\\.[a-f0-9]+\\.js}', async (c) => {
  if (!isProdEnv()) return c.notFound();
  const { content, hash } = await getHtmxJs();
  if (c.req.param('file') !== `htmx.${hash}.js`) return c.notFound();
  c.header('content-type', 'text/javascript; charset=utf-8');
  c.header('cache-control', PROD_ASSET_CACHE_CONTROL);
  return c.body(content);
});

// ─── Web UI: companion-first layout shell (SQR-65) ───────────────────────────
//
// GET / renders the authenticated app shell and redirects unauthenticated
// browsers to /login. The handler still wraps the renderer in a try/catch so
// a thrown error (db down, agent down, future content slot throwing during
// render) yields a fully formed HTML page with an inline error banner instead
// of a bare 500 page. See DESIGN.md decisions log "`.squire-banner` is a
// reusable primitive."
app.get('/', requirePageSession(), async (c) => {
  // `renderHomePage()` and `layoutShell()` both return
  // `Promise<HtmlEscapedString>` (tightened from a union in SQR-71
  // when layout.ts went async to await the asset URL helpers).
  // Without `await`, a rejected promise from either function would
  // bypass this try/catch and bubble up to `app.onError` as a JSON
  // 500 — losing the styled HTML fallback that the SQR-65 ticket
  // required. Awaiting both ensures the catch branch always renders
  // the layout shell.
  //
  // Known gap (accepted, SQR-71 eng review): if the original error was
  // a production asset-read failure, the fallback re-invokes `layoutShell`,
  // which reads the same missing asset and falls through to `app.onError`.
  // A prod image missing `dist/web-ui/app.css` is broken end-to-end; Docker
  // now builds that file before deploy so this fails before runtime.
  try {
    const session = c.get('session')!;
    const conversationHistory = await loadConversationHistory({
      userId: session.userId,
      query: c.req.query('historyQuery'),
    });
    c.header('Cache-Control', 'no-store');
    c.header('Vary', 'Cookie');
    return c.html(
      await renderHomePage(session, createCsrfToken(session.id), {
        conversationHistory,
        campaignStrip: await campaignStripFor(c, session.userId),
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const session = c.get('session');
    if (session) {
      c.header('Cache-Control', 'no-store');
      c.header('Vary', 'Cookie');
    }
    return c.html(
      await layoutShell({
        errorBanner: { message },
        session,
        csrfToken: session ? createCsrfToken(session.id) : undefined,
      }),
      500,
    );
  }
});

app.get('/styleguide/markdown', requirePageSession(), async (c) => {
  const session = c.get('session')!;
  c.header('Cache-Control', 'no-store');
  c.header('Vary', 'Cookie');
  return c.html(await renderMarkdownStyleguidePage(session, createCsrfToken(session.id)));
});

// ─── User profile (SQR-40) ───────────────────────────────────────────────────

app.get('/profile', requirePageSession(), async (c) => {
  const session = c.get('session')!;
  const identity = identityFromSessionUser(session.userId);
  const user = await CampaignService.requireUser(session.userId);
  const campaigns = await CampaignService.listMyCampaigns(identity);
  const memberships = [];
  for (const campaign of campaigns) {
    const member = await CampaignMemberRepositoryFindActive(campaign.id, session.userId);
    memberships.push({
      campaignId: campaign.id,
      campaignName: campaign.name,
      game: campaign.game,
      role: member?.role ?? 'member',
    });
  }
  c.header('Cache-Control', 'no-store');
  c.header('Vary', 'Cookie');
  return c.html(
    await layoutShell({
      session,
      csrfToken: createCsrfToken(session.id),
      showChatChrome: false,
      showRail: false,
      campaignStrip: await campaignStripFor(c, session.userId),
      mainContent: renderProfileContent({
        name: user.name,
        email: user.email,
        memberships,
      }),
    }),
  );
});

// ─── Campaign pages + context strip (SQR-275, SQR-11) ───────────────────────

const ACTIVE_CAMPAIGN_COOKIE = 'squire_active_campaign';

/**
 * The active campaign for the header strip: the explicit selection (signed
 * cookie, validated against current membership) when present, else the most
 * recently updated membership. Null = signed-in user with no campaigns →
 * the NO CAMPAIGN affordance.
 */
async function campaignStripFor(
  c: Context,
  userId: string,
  preferCampaignId?: string,
): Promise<CampaignStripState | null> {
  const mine = await CampaignService.listMyCampaigns(identityFromSessionUser(userId));
  const cookieSelection = await getSignedCookie(c, getSessionSecret(), ACTIVE_CAMPAIGN_COOKIE);
  const active =
    (preferCampaignId && mine.find((campaign) => campaign.id === preferCampaignId)) ||
    (typeof cookieSelection === 'string' &&
      mine.find((campaign) => campaign.id === cookieSelection)) ||
    mine[0];
  if (!active) return null;
  return { campaignId: active.id, campaignName: active.name, game: active.game };
}

async function renderCampaignListPage(c: Context, errorMessage?: string): Promise<Response> {
  const session = c.get('session')!;
  const identity = identityFromSessionUser(session.userId);
  const campaigns = await CampaignService.listMyCampaigns(identity);
  const invites = await CampaignService.listMyInvites(identity);
  const strip = await campaignStripFor(c, session.userId);
  const { db } = getDb('server');
  const rows = [];
  for (const campaign of campaigns) {
    const member = await CampaignMemberRepositoryFindActive(campaign.id, session.userId);
    rows.push({
      campaign,
      memberCount: await CampaignMemberRepositoryCount(db, campaign.id),
      role: member?.role ?? 'member',
      active: strip?.campaignId === campaign.id,
    });
  }
  c.header('Cache-Control', 'no-store');
  c.header('Vary', 'Cookie');
  return c.html(
    await layoutShell({
      session,
      csrfToken: createCsrfToken(session.id),
      showChatChrome: false,
      showRail: false,
      campaignStrip: strip,
      mainContent: renderCampaignListContent({
        rows,
        invites,
        csrfToken: createCsrfToken(session.id),
        errorMessage,
      }),
    }),
    errorMessage ? 422 : 200,
  );
}

app.use('/campaigns', requirePageSession());
app.use('/campaigns/*', requirePageSession());
app.use('/campaigns', requireCsrf());
app.use('/campaigns/*', requireCsrf());

app.get('/campaigns', (c) => renderCampaignListPage(c));

/** Create via plain form post; errors re-render the page with a banner. */
app.post('/campaigns', async (c) => {
  const session = c.get('session')!;
  const form = await c.req.formData();
  const name = typeof form.get('name') === 'string' ? (form.get('name') as string).trim() : '';
  const game = typeof form.get('game') === 'string' ? (form.get('game') as string) : '';
  if (!name) return renderCampaignListPage(c, 'Campaign name is required.');
  // Modules derive from the game (advisory scenario-set selectors).
  const modules = normalizeGameId(game) === 'gloomhaven-2e' ? ['gh2e', 'solo2e'] : ['fh'];
  try {
    const campaign = await CampaignService.createCampaign(identityFromSessionUser(session.userId), {
      name,
      game,
      modules,
    });
    await setSignedCookie(c, ACTIVE_CAMPAIGN_COOKIE, campaign.id, getSessionSecret(), {
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    });
    return c.redirect(`/campaigns/${campaign.id}`, 303);
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      return renderCampaignListPage(c, error.message);
    }
    throw error;
  }
});

/** Explicit active-campaign switch: signed cookie, membership-validated. */
app.post('/campaigns/:id/activate', async (c) => {
  const session = c.get('session')!;
  const campaignId = campaignRouteId(c, 'id');
  if (!campaignId) return c.notFound();
  try {
    await CampaignService.requireActiveMember(campaignId, session.userId);
  } catch {
    return c.notFound();
  }
  await setSignedCookie(c, ACTIVE_CAMPAIGN_COOKIE, campaignId, getSessionSecret(), {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  });
  return c.redirect('/campaigns', 303);
});

app.post('/campaigns/invites/:memberId/accept', async (c) => {
  const session = c.get('session')!;
  const memberId = campaignRouteId(c, 'memberId');
  if (!memberId) return c.notFound();
  try {
    const campaign = await CampaignService.acceptInvite(
      identityFromSessionUser(session.userId),
      memberId,
    );
    return c.redirect(`/campaigns/${campaign.id}`, 303);
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      return renderCampaignListPage(c, error.message);
    }
    throw error;
  }
});

app.post('/campaigns/:id/leave-web', async (c) => {
  const session = c.get('session')!;
  const campaignId = campaignRouteId(c, 'id');
  if (!campaignId) return c.notFound();
  try {
    await CampaignService.leaveCampaign(identityFromSessionUser(session.userId), campaignId);
    return c.redirect('/campaigns', 303);
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      return renderCampaignListPage(c, error.message);
    }
    throw error;
  }
});

/**
 * Render the `/campaigns/:id` dashboard page. Shared by the GET route and the
 * create-character / invite POST error paths so a failed write re-renders in
 * place with an inline banner (SQR-318, SQR-319). Throws `CampaignNotFoundError`
 * for non-members — callers map it to the indistinguishable 404 (ADR 0021).
 */
async function renderCampaignDashboardPage(
  c: Context,
  campaignId: string,
  opts: { characterError?: string; inviteError?: string; renameError?: string } = {},
  status: 200 | 422 = 200,
): Promise<Response> {
  const session = c.get('session')!;
  const identity = identityFromSessionUser(session.userId);
  const detail = await CampaignService.getCampaignDetail(identity, campaignId);
  const csrfToken = createCsrfToken(session.id);
  // Invite is owner-only: the affordance is hidden (not just disabled) for
  // everyone else, matching the service-layer role gate.
  const isOwner = detail.self.role === 'owner';
  // Per-user, never-cached: set on every path through the shared renderer
  // (GET and the create-error re-render) so neither leaks across sessions.
  c.header('Cache-Control', 'no-store');
  c.header('Vary', 'Cookie');
  const body = await layoutShell({
    session,
    csrfToken,
    showChatChrome: false,
    showRail: false,
    campaignStrip: {
      campaignId: detail.campaign.id,
      campaignName: detail.campaign.name,
      game: detail.campaign.game,
    },
    campaignStripProminent: true,
    mainContent: renderCampaignDashboardContent(
      detail,
      await dashboardThreadsFragment(detail.campaign, csrfToken),
      renderCampaignJournal(await listJournal(identity, campaignId)),
      // Sheet links (SQR-277): member-visible projection only.
      (await CharacterRepository.listMemberVisibleByCampaign(campaignId)).map((character) => ({
        id: character.id,
        name: character.name,
        className: character.className,
        level: character.level,
        placeholder: character.placeholderForEmail !== null,
      })),
      // Create-character form (SQR-318): a select of the game's real class
      // names structurally prevents an invalid class.
      {
        csrfToken,
        classOptions: await knownClassNames(detail.campaign.game),
        errorMessage: opts.characterError,
      },
      // Invite-member affordance (SQR-319): form is owner-only; the error
      // banner still renders for a non-owner who tampers the route.
      { csrfToken, canInvite: isOwner, errorMessage: opts.inviteError },
      // Rename affordance (SQR-320): any active member; the name is shared
      // state. expectedVersion drives optimistic concurrency.
      { csrfToken, version: detail.campaign.version, errorMessage: opts.renameError },
    ),
  });
  return c.html(body, status);
}

app.get('/campaigns/:id', async (c) => {
  const campaignId = campaignRouteId(c, 'id');
  if (!campaignId) return c.notFound();
  try {
    return await renderCampaignDashboardPage(c, campaignId);
  } catch (error) {
    // Non-member and absent are the same 404 page (ADR 0021).
    if (error instanceof CampaignService.CampaignNotFoundError) return c.notFound();
    throw error;
  }
});

/** Create a character from the dashboard form (SQR-318). */
app.post('/campaigns/:id/characters', async (c) => {
  const session = c.get('session')!;
  const campaignId = campaignRouteId(c, 'id');
  if (!campaignId) return c.notFound();
  const identity = identityFromSessionUser(session.userId);
  const form = await c.req.formData();
  const name = typeof form.get('name') === 'string' ? (form.get('name') as string).trim() : '';
  const classNameInput =
    typeof form.get('className') === 'string' ? (form.get('className') as string).trim() : '';
  const levelRaw = form.get('level');
  const levelNum = typeof levelRaw === 'string' ? Number.parseInt(levelRaw, 10) : Number.NaN;
  const level = Number.isFinite(levelNum) ? Math.min(20, Math.max(1, levelNum)) : 1;

  try {
    // getCampaignDetail gates membership: a non-member gets the 404 below.
    const detail = await CampaignService.getCampaignDetail(identity, campaignId);
    if (!name) {
      return await renderCampaignDashboardPage(
        c,
        campaignId,
        { characterError: 'Character name is required.' },
        422,
      );
    }
    // An explicit non-empty check: in no-materials mode `knownClassNames` is
    // empty and `checkClassName` accepts anything, so a blank/tampered class
    // would otherwise slip through.
    if (!classNameInput) {
      return await renderCampaignDashboardPage(
        c,
        campaignId,
        { characterError: 'Class is required.' },
        422,
      );
    }
    // Validate against the game's class list (real names only). The select
    // already constrains this; the check covers no-JS / tampered posts.
    const check = checkClassName(classNameInput, await knownClassNames(detail.campaign.game));
    if (!check.ok) {
      const message = check.suggestion
        ? `Unknown class "${classNameInput}". Did you mean ${check.suggestion}?`
        : `"${classNameInput}" is not a class in this game.`;
      return await renderCampaignDashboardPage(c, campaignId, { characterError: message }, 422);
    }
    await CharacterService.createCharacter(identity, campaignId, {
      name,
      className: check.canonical,
      level,
    });
    return c.redirect(`/campaigns/${campaignId}`, 303);
  } catch (error) {
    if (error instanceof CampaignService.CampaignNotFoundError) return c.notFound();
    if (error instanceof CampaignService.CampaignForbiddenError) {
      return await renderCampaignDashboardPage(
        c,
        campaignId,
        { characterError: error.message },
        422,
      );
    }
    throw error;
  }
});

/** Invite a member from the dashboard Party section (owner-only, SQR-319). */
app.post('/campaigns/:id/invites', async (c) => {
  const session = c.get('session')!;
  const campaignId = campaignRouteId(c, 'id');
  if (!campaignId) return c.notFound();
  const identity = identityFromSessionUser(session.userId);
  const form = await c.req.formData();
  const email = typeof form.get('email') === 'string' ? (form.get('email') as string).trim() : '';

  try {
    // getCampaignDetail gates membership: a non-member gets the 404 below.
    const detail = await CampaignService.getCampaignDetail(identity, campaignId);
    // Authorize before validating the email so a non-owner always gets the
    // consistent owner-only rejection, never invite-field feedback.
    if (detail.self.role !== 'owner') {
      return await renderCampaignDashboardPage(
        c,
        campaignId,
        { inviteError: 'Only the owner can invite members' },
        422,
      );
    }
    if (!z.string().email().max(320).safeParse(email).success) {
      return await renderCampaignDashboardPage(
        c,
        campaignId,
        { inviteError: 'Enter a valid email address.' },
        422,
      );
    }
    // inviteMember re-checks the owner gate and enforces the allowlist + dedupe.
    await CampaignService.inviteMember(identity, campaignId, email);
    return c.redirect(`/campaigns/${campaignId}`, 303);
  } catch (error) {
    if (error instanceof CampaignService.CampaignNotFoundError) return c.notFound();
    if (
      error instanceof CampaignService.CampaignForbiddenError ||
      error instanceof CampaignService.NotAllowlistedError ||
      error instanceof CampaignService.AlreadyInvitedError
    ) {
      return await renderCampaignDashboardPage(c, campaignId, { inviteError: error.message }, 422);
    }
    throw error;
  }
});

/** Rename a campaign from the dashboard header (SQR-320). */
app.post('/campaigns/:id/rename', async (c) => {
  const session = c.get('session')!;
  const campaignId = campaignRouteId(c, 'id');
  if (!campaignId) return c.notFound();
  const identity = identityFromSessionUser(session.userId);
  const form = await c.req.formData();
  const name = typeof form.get('name') === 'string' ? (form.get('name') as string).trim() : '';
  // Strict parse via formInt (`/^\d+$/` → null) so a malformed token like
  // "7abc" can't slip past Number.parseInt's leniency into the version guard.
  const expectedVersion = formInt(form, 'expectedVersion');

  try {
    // getCampaignDetail gates membership: a non-member gets the 404 below.
    // The name is shared state, so any active member may rename (no owner gate),
    // matching updateSharedState's authorization and the scenario-toggle control.
    await CampaignService.getCampaignDetail(identity, campaignId);
    if (!name) {
      return await renderCampaignDashboardPage(
        c,
        campaignId,
        { renameError: 'Campaign name is required.' },
        422,
      );
    }
    if (name.length > 200) {
      return await renderCampaignDashboardPage(
        c,
        campaignId,
        { renameError: 'Campaign name must be 200 characters or fewer.' },
        422,
      );
    }
    if (expectedVersion === null) {
      return await renderCampaignDashboardPage(
        c,
        campaignId,
        { renameError: 'Could not save — please refresh and try again.' },
        422,
      );
    }
    await CampaignService.updateSharedState(identity, campaignId, { name, expectedVersion });
    return c.redirect(`/campaigns/${campaignId}`, 303);
  } catch (error) {
    if (error instanceof CampaignService.CampaignNotFoundError) return c.notFound();
    if (error instanceof VersionConflictError) {
      // A concurrent edit won — re-render with the latest state + a notice.
      return await renderCampaignDashboardPage(
        c,
        campaignId,
        { renameError: 'Updated elsewhere — showing the latest. Try the rename again.' },
        422,
      );
    }
    if (error instanceof CampaignService.CampaignForbiddenError) {
      return await renderCampaignDashboardPage(c, campaignId, { renameError: error.message }, 422);
    }
    throw error;
  }
});

/** Load graphs + derive availability for the dashboard fragment (SQR-276). */
async function dashboardThreadsFragment(
  campaign: Campaign,
  csrfToken: string,
  announcement?: string,
): Promise<HtmlEscapedString | undefined> {
  const graphs = await loadModuleGraphs(campaign.game, campaign.modules);
  if (graphs.length === 0) return undefined;
  const roster = await CharacterRepository.listActiveRosterByCampaign(campaign.id);
  const availability = deriveAvailability(
    graphs,
    new Set(campaign.playedScenarios),
    new Set(campaign.drawnScenarios),
    new Set(campaign.skippedScenarios),
    roster,
  );
  return renderDashboardThreads({ campaign, graphs, availability, csrfToken, announcement });
}

/**
 * Tap-to-advance a scenario (SQR-276): open→played, via-event→drew-it,
 * drew-it→played. Marking played is one-way in v1 — un-play is destructive.
 * TODO(SQR-279): allow un-play through a confirmed proposal.
 */
app.post('/campaigns/:id/scenarios/toggle', async (c) => {
  const session = c.get('session')!;
  const campaignId = campaignRouteId(c, 'id');
  if (!campaignId) return c.notFound();
  const form = await c.req.formData();
  const key = typeof form.get('key') === 'string' ? (form.get('key') as string).trim() : '';
  if (!key || key.length > 200) return c.notFound();
  // `mode=skip` is the skippable-intro path (GH2e scenario 0); default is the
  // play/draw advance cycle.
  const mode = form.get('mode') === 'skip' ? 'skip' : 'advance';

  const identity = identityFromSessionUser(session.userId);
  let announcement: string;
  let detail: Awaited<ReturnType<typeof CampaignService.getCampaignDetail>>;
  try {
    detail = await CampaignService.getCampaignDetail(identity, campaignId);
    const graphs = await loadModuleGraphs(detail.campaign.game, detail.campaign.modules);
    const roster = await CharacterRepository.listActiveRosterByCampaign(campaignId);
    const availability = deriveAvailability(
      graphs,
      new Set(detail.campaign.playedScenarios),
      new Set(detail.campaign.drawnScenarios),
      new Set(detail.campaign.skippedScenarios),
      roster,
    );
    const status = availability.statuses.get(key);
    const shortKey = key.split(':')[1] ?? key;
    const isSkippable = graphs.some((graph) =>
      graph.scenarios.some(
        (scenario) => qualifiedKey(graph.module, scenario.key) === key && scenario.skippable,
      ),
    );

    if (mode === 'skip') {
      // Skip is only valid for a skippable intro that is currently open. Adding
      // it to skippedScenarios is non-destructive — it opens what playing would.
      if (isSkippable && status === 'open') {
        await CampaignService.updateSharedState(identity, campaignId, {
          expectedVersion: detail.campaign.version,
          skippedScenarios: [...detail.campaign.skippedScenarios, key],
        });
        announcement = `Scenario ${shortKey} marked skipped.`;
      } else {
        announcement = `Scenario ${shortKey} cannot be skipped.`;
      }
    } else if (status === 'open' || status === 'drew-it') {
      await CampaignService.updateSharedState(identity, campaignId, {
        expectedVersion: detail.campaign.version,
        playedScenarios: [...detail.campaign.playedScenarios, key],
        drawnScenarios: detail.campaign.drawnScenarios.filter((drawn) => drawn !== key),
      });
      announcement = `Scenario ${shortKey} marked played.`;
    } else if (status === 'via-event') {
      await CampaignService.updateSharedState(identity, campaignId, {
        expectedVersion: detail.campaign.version,
        drawnScenarios: [...detail.campaign.drawnScenarios, key],
      });
      announcement = `Scenario ${shortKey} marked drawn.`;
    } else {
      announcement = `Scenario ${shortKey} is not actionable.`;
    }
    // Re-read after the write so the fragment reflects the new state.
    detail = await CampaignService.getCampaignDetail(identity, campaignId);
  } catch (error) {
    if (error instanceof CampaignService.CampaignNotFoundError) return c.notFound();
    if (error instanceof VersionConflictError) {
      // A concurrent edit won — re-render current state with a notice.
      detail = await CampaignService.getCampaignDetail(identity, campaignId);
      announcement = 'Updated elsewhere — showing the latest state.';
    } else {
      throw error;
    }
  }

  const fragment = await dashboardThreadsFragment(
    detail.campaign,
    createCsrfToken(session.id),
    announcement,
  );
  c.header('Cache-Control', 'no-store');
  c.header('Vary', 'Cookie');
  if (isHtmxRequest(c) && fragment) return c.html(fragment);
  return c.redirect(`/campaigns/${campaignId}`, 303);
});

// ─── Accordion character sheet (SQR-277, design G3) ─────────────────────────

app.use('/characters/*', requirePageSession());
app.use('/characters/*', requireCsrf());

const SHEET_CONFLICT_MESSAGE =
  'Someone else saved this sheet first — your edit was not applied. Review the current values and try again.';

/** Render `/characters/:id` with optional banner/warning state. */
async function renderCharacterSheetPage(
  c: Context,
  characterId: string,
  state: { errorMessage?: string; warningMessage?: string; openSection?: string } = {},
  status: 200 | 400 | 404 | 409 | 422 = 200,
): Promise<Response> {
  const session = c.get('session')!;
  const identity = identityFromSessionUser(session.userId);
  const detail = await CharacterService.getCharacterDetail(identity, characterId);
  const campaignDetail = await CampaignService.getCampaignDetail(
    identity,
    detail.character.campaignId,
  );
  const game = campaignDetail.campaign.game;
  const user = await CampaignService.requireUser(identity.userId);
  const canClaim =
    detail.character.placeholderForEmail !== null &&
    detail.character.placeholderForEmail.toLowerCase() === user.email.toLowerCase();
  const names = await resolveCardDisplayNames({
    game,
    itemSourceIds: detail.items.map((item) => item.sourceId),
    cardSourceIds: detail.cards.map((card) => card.sourceId),
  });
  c.header('Cache-Control', 'no-store');
  c.header('Vary', 'Cookie');
  return c.html(
    await layoutShell({
      session,
      csrfToken: createCsrfToken(session.id),
      showChatChrome: false,
      showRail: false,
      campaignStrip: {
        campaignId: campaignDetail.campaign.id,
        campaignName: campaignDetail.campaign.name,
        game,
      },
      campaignStripProminent: true,
      mainContent: renderCharacterSheetContent({
        detail,
        campaign: {
          id: campaignDetail.campaign.id,
          name: campaignDetail.campaign.name,
          game,
        },
        csrfToken: createCsrfToken(session.id),
        canClaim,
        itemOptions: detail.own ? await listItemOptions(game) : [],
        cardOptions: detail.own
          ? await listCardOptionsForClass(game, detail.character.className)
          : [],
        itemNames: names.items,
        cardNames: names.cards,
        ...state,
      }),
    }),
    status,
  );
}

/** Shared error mapping for sheet form posts: banner, never a lost edit. */
async function sheetActionErrorResponse(
  c: Context,
  characterId: string,
  section: string,
  error: unknown,
): Promise<Response> {
  if (error instanceof CampaignService.CampaignNotFoundError) return c.notFound();
  if (error instanceof VersionConflictError) {
    return renderCharacterSheetPage(
      c,
      characterId,
      { errorMessage: SHEET_CONFLICT_MESSAGE, openSection: section },
      409,
    );
  }
  if (error instanceof CharacterService.PlaceholderPrivateFieldsError) {
    return renderCharacterSheetPage(
      c,
      characterId,
      { errorMessage: error.message, openSection: section },
      422,
    );
  }
  throw error;
}

app.get('/characters/:id', async (c) => {
  const characterId = campaignRouteId(c, 'id');
  if (!characterId) return c.notFound();
  try {
    return await renderCharacterSheetPage(c, characterId);
  } catch (error) {
    if (error instanceof CampaignService.CampaignNotFoundError) return c.notFound();
    throw error;
  }
});

function formString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function formInt(form: FormData, key: string): number | null {
  const raw = formString(form, key);
  if (!/^\d+$/.test(raw)) return null;
  return Number.parseInt(raw, 10);
}

/** Per-section single-field saves; an empty private field clears to null. */
app.post('/characters/:id/update', async (c) => {
  const characterId = campaignRouteId(c, 'id');
  if (!characterId) return c.notFound();
  const form = await c.req.formData();
  const section = formString(form, 'section');
  const expectedVersion = formInt(form, 'expectedVersion');
  if (expectedVersion === null) return c.notFound();

  let patch: Record<string, unknown>;
  switch (section) {
    case 'identity': {
      const name = formString(form, 'name');
      if (!name || name.length > 100) {
        return renderCharacterSheetPage(
          c,
          characterId,
          { errorMessage: 'Character name is required.', openSection: section },
          400,
        );
      }
      patch = { name };
      break;
    }
    case 'level': {
      const level = formInt(form, 'level');
      const xp = formInt(form, 'xp');
      if (level === null || level < 1 || level > 20 || xp === null) {
        return renderCharacterSheetPage(
          c,
          characterId,
          { errorMessage: 'Level (1-20) and XP must be whole numbers.', openSection: section },
          400,
        );
      }
      patch = { level, xp };
      break;
    }
    case 'gold': {
      const gold = formInt(form, 'gold');
      if (gold === null) {
        return renderCharacterSheetPage(
          c,
          characterId,
          { errorMessage: 'Gold must be a whole number.', openSection: section },
          400,
        );
      }
      patch = { gold };
      break;
    }
    case 'perks': {
      const raw = formString(form, 'perks');
      const parts = raw.length === 0 ? [] : raw.split(/[\s,]+/).filter(Boolean);
      if (parts.some((part) => !/^\d+$/.test(part)) || parts.length > 100) {
        return renderCharacterSheetPage(
          c,
          characterId,
          {
            errorMessage: 'Perks must be a comma-separated list of numbers.',
            openSection: section,
          },
          400,
        );
      }
      patch = { perks: parts.map((part) => Number.parseInt(part, 10)) };
      break;
    }
    case 'quest':
    case 'goals':
    case 'notes': {
      const field =
        section === 'quest'
          ? 'personalQuest'
          : section === 'goals'
            ? 'battleGoals'
            : 'privateNotes';
      const value = formString(form, field);
      patch = { [field]: value.length > 0 ? value.slice(0, 5000) : null };
      break;
    }
    default:
      return c.notFound();
  }

  const identity = identityFromSessionUser(c.get('session')!.userId);
  try {
    const updated = await CharacterService.updateCharacter(identity, characterId, {
      expectedVersion,
      ...patch,
    });
    // Soft rules-legality warning (SQR-285) shows inline instead of a
    // silent redirect; the save itself already applied.
    const warnings = levelXpWarnings(patch, updated);
    if (warnings.length > 0) {
      return renderCharacterSheetPage(c, characterId, {
        warningMessage: warnings[0],
        openSection: section,
      });
    }
    return c.redirect(`/characters/${characterId}#${section}`, 303);
  } catch (error) {
    return sheetActionErrorResponse(c, characterId, section, error);
  }
});

app.post('/characters/:id/claim', async (c) => {
  const characterId = campaignRouteId(c, 'id');
  if (!characterId) return c.notFound();
  const identity = identityFromSessionUser(c.get('session')!.userId);
  try {
    await CharacterService.claimCharacter(identity, characterId);
    return c.redirect(`/characters/${characterId}`, 303);
  } catch (error) {
    if (error instanceof CampaignService.CampaignNotFoundError) return c.notFound();
    throw error;
  }
});

app.post('/characters/:id/items/add', async (c) => {
  const characterId = campaignRouteId(c, 'id');
  if (!characterId) return c.notFound();
  const form = await c.req.formData();
  const number = formString(form, 'number');
  const identity = identityFromSessionUser(c.get('session')!.userId);
  try {
    const detail = await CharacterService.getCharacterDetail(identity, characterId);
    const campaign = await CampaignService.getCampaignDetail(identity, detail.character.campaignId);
    const item = number ? await findItemByNumber(campaign.campaign.game, number) : null;
    if (!item) {
      return renderCharacterSheetPage(
        c,
        characterId,
        {
          errorMessage: `No ${campaign.campaign.game} item numbered "${number}" — pick one from the list.`,
          openSection: 'items',
        },
        400,
      );
    }
    await CharacterService.addItem(identity, characterId, item.sourceId);
    const warnings = await itemCostWarnings(
      campaign.campaign.game,
      item.sourceId,
      detail.character.gold,
    );
    if (warnings.length > 0) {
      return renderCharacterSheetPage(c, characterId, {
        warningMessage: warnings[0],
        openSection: 'items',
      });
    }
    return c.redirect(`/characters/${characterId}#items`, 303);
  } catch (error) {
    return sheetActionErrorResponse(c, characterId, 'items', error);
  }
});

app.post('/characters/:id/items/:itemId/remove', async (c) => {
  const characterId = campaignRouteId(c, 'id');
  const itemId = campaignRouteId(c, 'itemId');
  if (!characterId || !itemId) return c.notFound();
  const identity = identityFromSessionUser(c.get('session')!.userId);
  try {
    await CharacterService.removeItem(identity, characterId, itemId);
    return c.redirect(`/characters/${characterId}#items`, 303);
  } catch (error) {
    return sheetActionErrorResponse(c, characterId, 'items', error);
  }
});

app.post('/characters/:id/cards/add', async (c) => {
  const characterId = campaignRouteId(c, 'id');
  if (!characterId) return c.notFound();
  const form = await c.req.formData();
  const name = formString(form, 'name');
  const identity = identityFromSessionUser(c.get('session')!.userId);
  try {
    const detail = await CharacterService.getCharacterDetail(identity, characterId);
    const campaign = await CampaignService.getCampaignDetail(identity, detail.character.campaignId);
    const card = name
      ? await findCardByName(campaign.campaign.game, detail.character.className, name)
      : null;
    if (!card) {
      return renderCharacterSheetPage(
        c,
        characterId,
        {
          errorMessage: `No ${detail.character.className} card named "${name}" — pick one from the list.`,
          openSection: 'cards',
        },
        400,
      );
    }
    await CharacterService.addCard(identity, characterId, { sourceId: card.sourceId });
    return c.redirect(`/characters/${characterId}#cards`, 303);
  } catch (error) {
    return sheetActionErrorResponse(c, characterId, 'cards', error);
  }
});

app.post('/characters/:id/cards/:cardId/role', async (c) => {
  const characterId = campaignRouteId(c, 'id');
  const cardId = campaignRouteId(c, 'cardId');
  if (!characterId || !cardId) return c.notFound();
  const form = await c.req.formData();
  const role = formString(form, 'role');
  if (role !== 'owned' && role !== 'active') return c.notFound();
  const identity = identityFromSessionUser(c.get('session')!.userId);
  try {
    await CharacterService.setCardRole(identity, characterId, cardId, role);
    return c.redirect(`/characters/${characterId}#cards`, 303);
  } catch (error) {
    return sheetActionErrorResponse(c, characterId, 'cards', error);
  }
});

app.post('/characters/:id/cards/:cardId/remove', async (c) => {
  const characterId = campaignRouteId(c, 'id');
  const cardId = campaignRouteId(c, 'cardId');
  if (!characterId || !cardId) return c.notFound();
  const identity = identityFromSessionUser(c.get('session')!.userId);
  try {
    await CharacterService.removeCard(identity, characterId, cardId);
    return c.redirect(`/characters/${characterId}#cards`, 303);
  } catch (error) {
    return sheetActionErrorResponse(c, characterId, 'cards', error);
  }
});

// ─── OAuth metadata ──────────────────────────────────────────────────────────

function getBaseUrl(): string {
  const env = process.env.SQUIRE_BASE_URL;
  if (env && env.length > 0) return env.replace(/\/+$/, '');
  return 'http://localhost:3000';
}

function loginRedirectWithError(message: string): string {
  return `/login?${new URLSearchParams({ error: message }).toString()}`;
}

const DEV_LOGIN_ENABLED = shouldRegisterDevLogin();
if (DEV_LOGIN_ENABLED) {
  console.warn(
    '[dev] POST /dev/login route is registered (SQUIRE_DEV_LOGIN=1, NODE_ENV=development/test, DATABASE_URL points at a managed-local DB). This route never ships to production.',
  );
  registerDevLoginRoute(app);
}

app.get('/login', optionalSession(), async (c) => {
  c.header('Cache-Control', 'no-store');
  c.header('Vary', 'Cookie');
  if (c.get('session')) return c.redirect('/');
  return c.html(
    await renderLoginPage({
      errorMessage: c.req.query('error'),
      devLoginEnabled: DEV_LOGIN_ENABLED,
    }),
  );
});

app.get('/not-invited', async (c) => c.html(await renderNotInvitedPage(), 403));
app.get('/email-not-verified', async (c) => c.html(await renderEmailNotVerifiedPage(), 403));

app.get('/.well-known/oauth-authorization-server', (c) => {
  const base = getBaseUrl();
  return c.json({
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    response_types_supported: ['code'],
    // Squire deliberately does not support refresh_token rotation — access
    // tokens are long-lived (30 days) as a DX choice for MCP/API clients.
    // See SECURITY.md §2 and `SquireOAuthProvider.exchangeRefreshToken`
    // (throws UnsupportedGrantTypeError). Advertising only what the
    // provider actually honors keeps the discovery metadata truthful.
    grant_types_supported: ['authorization_code'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['squire:read', 'squire:write'],
  });
});

app.get('/.well-known/oauth-protected-resource', (c) => {
  const base = getBaseUrl();
  return c.json({
    resource: base,
    authorization_servers: [base],
    resource_name: 'Squire',
    bearer_methods_supported: ['header'],
    scopes_supported: ['squire:read', 'squire:write'],
  });
});

// ─── Client registration ─────────────────────────────────────────────────────

app.post('/register', async (c) => {
  let rateLimit: RateLimitDecision;
  try {
    rateLimit = await checkRegisterRateLimit(c);
  } catch (error) {
    return rateLimitUnavailableResponse(c, error);
  }

  if (!rateLimit.allowed) {
    return rateLimitedResponse(c, rateLimit);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(oauthError('invalid_request', 'Invalid JSON body'), 400);
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return c.json(oauthError('invalid_request', 'Request body must be a JSON object'), 400);
  }

  try {
    const client = await registerClient(body as Record<string, unknown>, auditContext(c));
    return c.json(client, 201);
  } catch (err) {
    return oauthErrorResponse(c, err);
  }
});

// ─── Authorization endpoint ──────────────────────────────────────────────────

app.get('/authorize', async (c) => {
  const clientId = c.req.query('client_id');
  const redirectUri = c.req.query('redirect_uri');
  const responseType = c.req.query('response_type');
  const codeChallenge = c.req.query('code_challenge');
  const codeChallengeMethod = c.req.query('code_challenge_method');
  const state = c.req.query('state');

  if (!clientId || !redirectUri || responseType !== 'code') {
    return c.json(oauthError('invalid_request', 'Missing or invalid required parameters'), 400);
  }
  if (!codeChallenge || codeChallengeMethod !== 'S256') {
    return c.json(
      oauthError('invalid_request', 'PKCE code_challenge with S256 method is required'),
      400,
    );
  }

  try {
    const authCode = await createAuthorizationCode(
      clientId,
      redirectUri,
      codeChallenge,
      state,
      auditContext(c),
    );
    const redirect = new URL(redirectUri);
    redirect.searchParams.set('code', authCode.code);
    if (state) redirect.searchParams.set('state', state);
    return c.redirect(redirect.toString(), 302);
  } catch (err) {
    return oauthErrorResponse(c, err);
  }
});

// ─── Token endpoint ──────────────────────────────────────────────────────────

app.post('/token', async (c) => {
  const contentType = c.req.header('content-type') || '';
  let params: URLSearchParams;

  try {
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const body = await c.req.text();
      params = new URLSearchParams(body);
    } else if (contentType.includes('application/json')) {
      const body = (await c.req.json()) as Record<string, string>;
      params = new URLSearchParams(body);
    } else {
      return c.json(oauthError('invalid_request', 'Unsupported content type'), 400);
    }
  } catch {
    // Malformed JSON / unreadable body — surface as OAuth invalid_request
    // rather than letting it fall through to the generic 500 handler.
    return c.json(oauthError('invalid_request', 'Malformed request body'), 400);
  }

  const grantType = params.get('grant_type');

  if (grantType === 'authorization_code') {
    const code = params.get('code');
    const clientId = params.get('client_id');
    const codeVerifier = params.get('code_verifier');
    const redirectUri = params.get('redirect_uri');

    if (!code || !clientId || !codeVerifier || !redirectUri) {
      return c.json(oauthError('invalid_request', 'Missing required parameters'), 400);
    }

    try {
      const tokenResponse = await exchangeAuthorizationCode(
        code,
        clientId,
        codeVerifier,
        redirectUri,
        auditContext(c),
      );
      return c.json(tokenResponse);
    } catch (err) {
      return oauthErrorResponse(c, err);
    }
  }

  return c.json(oauthError('unsupported_grant_type', `Unsupported grant_type: ${grantType}`), 400);
});

// ─── Google OAuth web login (SQR-38) ────────────────────────────────────────
//
// Squire acts as an OAuth CLIENT here (redirecting to Google). This is separate
// from the OAuth SERVER above (which serves MCP/API clients). The two auth
// systems use different transports (cookies vs bearer tokens) and are
// deliberately isolated.

const PKCE_COOKIE_NAME = 'squire_oauth_pkce';

app.get('/auth/google/start', async (c) => {
  let rateLimit: RateLimitDecision;
  try {
    rateLimit = await checkIpRateLimit(c, GOOGLE_OAUTH_START_RATE_LIMIT_POLICY);
  } catch (error) {
    return googleOAuthRateLimitUnavailableResponse(
      c,
      error,
      '/auth/google/start',
      GOOGLE_OAUTH_START_RATE_LIMIT_POLICY,
    );
  }
  if (!rateLimit.allowed) return googleOAuthRateLimitedResponse(c, rateLimit, '/auth/google/start');

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = computeCodeChallenge(codeVerifier);

  // Store state + code_verifier in a short-lived signed cookie (5-min expiry)
  const secret = getSessionSecret();
  const pkceData = JSON.stringify({ state, codeVerifier });
  await setSignedCookie(c, PKCE_COOKIE_NAME, pkceData, secret, {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax', // Lax so the cookie survives the Google redirect back
    maxAge: 300, // 5 minutes
  });

  const url = buildGoogleAuthUrl(state, codeChallenge, resolveGoogleRedirectUri(c.req.url));
  return c.redirect(url);
});

app.get('/auth/google/callback', async (c) => {
  let rateLimit: RateLimitDecision;
  try {
    rateLimit = await checkIpRateLimit(c, GOOGLE_OAUTH_CALLBACK_RATE_LIMIT_POLICY);
  } catch (error) {
    return googleOAuthRateLimitUnavailableResponse(
      c,
      error,
      '/auth/google/callback',
      GOOGLE_OAUTH_CALLBACK_RATE_LIMIT_POLICY,
    );
  }
  if (!rateLimit.allowed) {
    return googleOAuthRateLimitedResponse(c, rateLimit, '/auth/google/callback');
  }

  // Check for error from Google (e.g., user clicked Cancel)
  const error = c.req.query('error');
  if (error) {
    deleteCookie(c, PKCE_COOKIE_NAME, { path: '/' });
    return c.redirect(loginRedirectWithError('Google sign-in was cancelled or failed.'), 302);
  }

  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) {
    deleteCookie(c, PKCE_COOKIE_NAME, { path: '/' });
    return c.redirect(loginRedirectWithError('Missing code or state parameter.'), 302);
  }

  // Read and consume the PKCE cookie
  const secret = getSessionSecret();
  const pkceCookieRaw = await getSignedCookie(c, secret, PKCE_COOKIE_NAME);
  let cookieState: string | undefined;
  let cookieVerifier: string | undefined;
  if (pkceCookieRaw) {
    try {
      const parsed = JSON.parse(pkceCookieRaw);
      cookieState = parsed.state;
      cookieVerifier = parsed.codeVerifier;
    } catch {
      // Malformed cookie, will fail state check below
    }
  }

  // Clean up PKCE cookie on all paths (success and error). It served its
  // purpose once the callback is reached; leaving it around is untidy.
  deleteCookie(c, PKCE_COOKIE_NAME, { path: '/' });

  try {
    const result = await handleGoogleCallback(
      code,
      state,
      cookieState,
      cookieVerifier,
      resolveTrustedClientIp(c.req) ?? undefined,
      c.req.header('user-agent'),
      resolveGoogleRedirectUri(c.req.url),
    );

    await setSessionCookie(c, result.sessionId);
    return c.redirect('/');
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      if (err.code === 'email_not_verified') {
        return c.redirect('/email-not-verified', 302);
      }
      if (err.code === 'not_allowed') {
        return c.redirect('/not-invited', 302);
      }
      return c.redirect(loginRedirectWithError(err.message), 302);
    }
    // Log unexpected errors for debugging
    console.error('[auth/google/callback] unexpected error:', err);
    throw err;
  }
});

app.post('/auth/logout', requirePageSession(), requireCsrf(), async (c) => {
  const session = c.get('session')!;
  c.header('Cache-Control', 'no-store');
  c.header('Vary', 'Cookie');

  const { db } = getDb('server');
  await db.transaction(async (tx) => {
    const userId = await SessionRepository.destroy(tx, session.id);
    if (!userId) return;

    await writeAuditEvent(tx, {
      eventType: 'google_logout',
      userId,
      outcome: 'success',
      ipAddress: resolveTrustedClientIp(c.req),
      userAgent: c.req.header('user-agent'),
    });
  });

  clearSessionCookie(c);
  return c.redirect('/login');
});

// /auth/me: returns current user JSON for HTMX header. Behind session middleware.
// The session (with user) is already loaded by requireSession(). Zero extra DB calls.
app.get('/auth/me', requireSession(), async (c) => {
  // requireSession() guarantees session is set; 401 returned otherwise
  const session = c.get('session')!;
  c.header('Cache-Control', 'no-store');
  c.header('Vary', 'Cookie');
  return c.json({ id: session.user.id, email: session.user.email, name: session.user.name });
});

// Protect /chat routes with session cookie auth
app.use('/chat/*', requirePageSession());
app.use('/chat', requirePageSession());
app.use('/chat/*', requireCsrf());
app.use('/chat', requireCsrf());

function badChatRequest(c: Context, message: string) {
  if (isHtmxRequest(c)) {
    return c.html(renderChatErrorFragment(message), 400);
  }
  return c.json(jsonError(message, 400), 400);
}

function isHtmxRequest(c: Context): boolean {
  return c.req.header('hx-request') === 'true';
}

function renderChatErrorFragment(message: string) {
  return html`<div class="squire-banner squire-banner--error" role="alert">
    <span class="squire-banner__label">SOMETHING WENT WRONG</span>
    <p class="squire-banner__body">${message}</p>
  </div>`;
}

function buildStreamUrl(conversationId: string, messageId: string): string {
  return `/chat/${conversationId}/messages/${messageId}/stream`;
}

// DESIGN.md wants streaming tool metadata to read like ledger provenance
// ("CONSULTING · RULEBOOK"), not raw implementation names like search_rules.
// The provenance mapping itself lives in ./web-ui/consulted-footer.ts so the
// layout render path can reuse it when hydrating historical answers.
function buildToolStatusId(name: string): string {
  const label = toolSourceLabel(name);
  if (label === null) return name;

  return label
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function conversationPath(conversationId: string, historyQuery?: string): string {
  if (!historyQuery) return `/chat/${conversationId}`;
  return `/chat/${conversationId}?${new URLSearchParams({ historyQuery }).toString()}`;
}

async function readQuestionForm(c: Context): Promise<{
  question: string;
  idempotencyKey?: string;
  game?: string;
  campaignId?: string;
  historyQuery?: string;
}> {
  const form = await c.req.formData();
  const questionValue = form.get('question');
  const idempotencyValue = form.get('idempotencyKey');
  const gameValue = form.get('game');
  const campaignIdValue = form.get('campaignId');
  const historyQueryValue = form.get('historyQuery');

  return {
    question: typeof questionValue === 'string' ? questionValue.trim() : '',
    idempotencyKey:
      typeof idempotencyValue === 'string' && idempotencyValue.trim().length > 0
        ? idempotencyValue.trim()
        : undefined,
    game:
      typeof gameValue === 'string' && gameValue.trim().length > 0 ? gameValue.trim() : undefined,
    campaignId:
      typeof campaignIdValue === 'string' && z.string().uuid().safeParse(campaignIdValue).success
        ? campaignIdValue
        : undefined,
    historyQuery:
      typeof historyQueryValue === 'string' && historyQueryValue.trim().length > 0
        ? historyQueryValue.trim()
        : undefined,
  };
}

function readChatGame(game: string | undefined): string | undefined {
  return game === undefined ? undefined : requireGameId(game);
}

// ADR 0012: a "pending" turn is any persisted user message without an
// assistant reply — in-flight stream, stranded retry from a prior
// session, or any user message a follow-up submitted before its reply
// completed. The conversation page renders a skeleton answer for each
// such user message, and squire.js attaches one EventSource per
// pending stream URL.
//
// Returning a Map (instead of just the latest pending stream URL)
// closes the defense-in-depth case Codex flagged on SQR-108: an older
// turn still streaming when a newer one completes shouldn't drop off
// the in-flight UI on reload. Pairing happens in
// `pairConversationTurns` (src/web-ui/layout.ts) so renderable Q+A
// stays correct independent of which assistant replies arrive in
// what order.
//
// Skipping a user message when an assistant reply already exists
// fixes a pre-PR latent bug — the old code generated a stream URL
// for every latest user message regardless of whether it had been
// answered, so reloading a finalized conversation would re-attach a
// stream and re-trigger the SSE error path on a persisted error
// reply. Error assistant rows count as a reply because they're
// persisted as `role: 'assistant'` with `responseToMessageId` set.
export function computePendingStreamUrls(
  messages: Array<{ id: string; role: 'user' | 'assistant'; responseToMessageId?: string | null }>,
  conversationId: string,
): Map<string, string> {
  const repliedUserMessageIds = new Set<string>();
  for (const message of messages) {
    if (message.role === 'assistant' && message.responseToMessageId) {
      repliedUserMessageIds.add(message.responseToMessageId);
    }
  }
  const pending = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== 'user') continue;
    if (repliedUserMessageIds.has(message.id)) continue;
    pending.set(message.id, buildStreamUrl(conversationId, message.id));
  }
  return pending;
}

// SQR-108: cap the rendered transcript to the most recent N messages.
// With the scrolling-chat IA (ADR 0012) every persisted turn renders on
// each GET, so an unbounded conversation grows the per-request HTML
// linearly. 100 messages = ~50 turns of history, well above any
// observed Phase 1 conversation length while bounding worst-case render
// cost. Older turns are dropped (no "load earlier" affordance yet — file
// a follow-up if anyone scrolls past 50 turns and feels the cliff).
const TRANSCRIPT_MESSAGE_LIMIT = 100;
const STREAM_REPLAY_POLL_MS = 100;
const STREAM_REPLAY_MAX_POLLS = 1_200;

function parseLastEventSequence(headerValue: string | undefined): number {
  if (!headerValue) return 0;
  const parsed = Number.parseInt(headerValue, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.get('/chat/:conversationId', async (c) => {
  const session = c.get('session')!;
  const loaded = await loadConversation({
    conversationId: c.req.param('conversationId'),
    userId: session.userId,
    limit: TRANSCRIPT_MESSAGE_LIMIT,
  });
  if (!loaded) return c.notFound();

  const pendingStreamUrls = computePendingStreamUrls(loaded.messages, loaded.conversation.id);
  const conversationHistory = await loadConversationHistory({
    userId: session.userId,
    activeConversationId: loaded.conversation.id,
    activeStatus: pendingStreamUrls.size > 0 ? 'running' : 'idle',
    query: c.req.query('historyQuery'),
  });

  c.header('Cache-Control', 'no-store');
  c.header('Vary', 'Cookie');
  return c.html(
    await renderConversationPage({
      session,
      csrfToken: createCsrfToken(session.id),
      conversationId: loaded.conversation.id,
      messages: loaded.messages,
      pendingStreamUrls,
      conversationHistory,
      campaignStrip: await campaignStripFor(c, session.userId),
    }),
  );
});

app.get('/chat/:conversationId/messages/:messageId', async (c) => {
  const conversationId = c.req.param('conversationId');

  c.header('Cache-Control', 'no-store');
  c.header('Vary', 'Cookie');
  return c.redirect(`/chat/${conversationId}`, 301);
});

/**
 * Per-message campaign binding (E6/SQR-275): the hidden campaignId from the
 * strip binds the turn only when the sender is an active member — anything
 * else silently unbinds (same no-identity-no-state posture as /api/ask).
 */
async function chatCampaignBinding(
  userId: string,
  campaignId: string | undefined,
): Promise<string | null> {
  if (!campaignId) return null;
  try {
    await CampaignService.requireActiveMember(campaignId, userId);
    return campaignId;
  } catch {
    return null;
  }
}

app.post('/chat', async (c) => {
  const requestId = correlateRequest(c);
  const session = c.get('session')!;
  const {
    question,
    idempotencyKey,
    game: rawGame,
    campaignId: rawCampaignId,
    historyQuery,
  } = await readQuestionForm(c);

  if (!question) return badChatRequest(c, 'Question is required');
  if (!idempotencyKey) return badChatRequest(c, 'Idempotency key is required');
  let game: string | undefined;
  try {
    game = readChatGame(rawGame);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return badChatRequest(c, message);
  }

  if (isHtmxRequest(c)) {
    const boundCampaignId = await chatCampaignBinding(session.userId, rawCampaignId);
    const pending = await createPendingConversation({
      campaignId: boundCampaignId,
      userId: session.userId,
      question,
      idempotencyKey,
      game,
    });

    c.header('Cache-Control', 'no-store');
    c.header('Vary', 'Cookie');
    c.header('HX-Push-Url', conversationPath(pending.conversation.id, historyQuery));

    // ADR 0012: the home form swaps `#squire-surface innerHTML` with the
    // full transcript shell (one pending turn). After the swap, squire.js
    // sees the URL has flipped to `/chat/:id` and re-points the form to
    // `.squire-transcript` + `beforeend` for subsequent submits.
    if (!pending.currentUserMessage) {
      const loaded = await loadConversation({
        conversationId: pending.conversation.id,
        userId: session.userId,
      });
      if (!loaded) return c.notFound();
      const pendingStreamUrls = computePendingStreamUrls(loaded.messages, loaded.conversation.id);
      const conversationHistory = await loadConversationHistory({
        userId: session.userId,
        activeConversationId: loaded.conversation.id,
        activeStatus: pendingStreamUrls.size > 0 ? 'running' : 'idle',
        query: historyQuery,
      });
      return c.html(
        renderConversationTranscriptWithHistoryOob({
          conversationHistory,
          conversationId: loaded.conversation.id,
          messages: loaded.messages,
          pendingStreamUrls,
        }),
      );
    }

    const conversationHistory = await loadConversationHistory({
      userId: session.userId,
      activeConversationId: pending.conversation.id,
      activeStatus: 'running',
      query: historyQuery,
    });
    return c.html(
      renderConversationTranscriptWithHistoryOob({
        conversationHistory,
        conversationId: pending.conversation.id,
        messages: [pending.currentUserMessage],
        pendingStreamUrls: new Map([
          [
            pending.currentUserMessage.id,
            buildStreamUrl(pending.conversation.id, pending.currentUserMessage.id),
          ],
        ]),
      }),
    );
  }

  const conversation = await startConversation({
    userId: session.userId,
    question,
    idempotencyKey,
    game,
    campaignId: await chatCampaignBinding(session.userId, rawCampaignId),
    requestId,
    telemetry: { route: '/chat', surface: 'web_chat' },
  });

  c.header('Cache-Control', 'no-store');
  c.header('Vary', 'Cookie');
  return c.redirect(`/chat/${conversation.id}`, 302);
});

app.post('/chat/:conversationId/messages', async (c) => {
  const requestId = correlateRequest(c);
  const session = c.get('session')!;
  const {
    question,
    game: rawGame,
    campaignId: rawCampaignId,
    historyQuery,
  } = await readQuestionForm(c);
  if (!question) return badChatRequest(c, 'Question is required');
  let game: string | undefined;
  try {
    game = readChatGame(rawGame);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return badChatRequest(c, message);
  }

  if (isHtmxRequest(c)) {
    const pending = await createPendingFollowUp({
      conversationId: c.req.param('conversationId'),
      userId: session.userId,
      question,
      game,
      campaignId: await chatCampaignBinding(session.userId, rawCampaignId),
    });
    if (!pending?.currentUserMessage) return c.notFound();

    c.header('Cache-Control', 'no-store');
    c.header('Vary', 'Cookie');
    // Keep follow-up submissions pinned to the current conversation URL.
    c.header('HX-Push-Url', conversationPath(pending.conversation.id, historyQuery));
    const conversationHistory = await loadConversationHistory({
      userId: session.userId,
      activeConversationId: pending.conversation.id,
      activeStatus: 'running',
      query: historyQuery,
    });
    // ADR 0012 E-3: append-fragment swap. The client's form posts with
    // `hx-target=".squire-transcript"` `hx-swap="beforeend"`, so we return
    // ONLY the new question + pending answer skeleton — NOT the wrapping
    // transcript section.
    return c.html(
      renderConversationTurnAppendFragmentWithHistoryOob({
        conversationHistory,
        question: pending.currentUserMessage.content,
        streamUrl: buildStreamUrl(pending.conversation.id, pending.currentUserMessage.id),
      }),
    );
  }

  const conversation = await appendMessage({
    conversationId: c.req.param('conversationId'),
    userId: session.userId,
    question,
    game,
    campaignId: await chatCampaignBinding(session.userId, rawCampaignId),
    requestId,
    telemetry: { route: '/chat/:conversationId/messages', surface: 'web_chat' },
  });
  if (!conversation) return c.notFound();

  c.header('Cache-Control', 'no-store');
  c.header('Vary', 'Cookie');
  return c.redirect(`/chat/${conversation.id}`, 302);
});

app.get('/chat/:conversationId/messages/:messageId/stream', async (c) => {
  const requestId = correlateRequest(c);
  const session = c.get('session')!;
  const lastEventSequence = parseLastEventSequence(
    c.req.header('last-event-id') ?? c.req.header('Last-Event-ID'),
  );
  const loaded = await loadConversationMessage({
    conversationId: c.req.param('conversationId'),
    messageId: c.req.param('messageId'),
    userId: session.userId,
  });
  if (!loaded) return c.notFound();
  if (loaded.message.role !== 'user') return c.notFound();

  const bootstrapStatus = await ensureBootstrapStatus();
  const askCapability = bootstrapStatus.capabilities.ask;
  if (!askCapability.allowed) {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          kind: 'bootstrap',
          message: askCapability.message ?? 'Service unavailable.',
          recoverable: bootstrapStatus.lifecycle === 'warming_up',
        }),
      });
    });
  }

  // Browser SSE semantics are documented in docs/SSE_CONTRACT.md. This route
  // owns the final user-visible ordering guarantees, including the final
  // sanitized-html swap on `done`.
  //
  // SQR-98: consulted-source capture lives inside persistAssistantOutcome
  // now. Every write path (SSE here, plus plain-form POST fallbacks that
  // call startConversation / appendMessage) runs the same event wrapper
  // and persists the same sources. This handler just translates agent
  // events to wire events.
  return streamSSE(c, async (stream) => {
    let planSequence = 0;
    let progressSequence = 0;
    let artifactSequence = 0;
    let replayCursor = lastEventSequence;

    const writeStoredEvent = async (
      storedEvent: MessageStreamEventRepository.MessageStreamEvent,
    ) => {
      await stream.writeSSE({
        id: String(storedEvent.sequence),
        event: storedEvent.event,
        data: JSON.stringify(storedEvent.payload),
      });
      replayCursor = storedEvent.sequence;
    };

    const persistAndWrite = async (
      event: BrowserStreamEventName,
      payload: Record<string, unknown>,
    ) => {
      const storedEvent = await MessageStreamEventRepository.append({
        conversationId: loaded.conversation.id,
        userMessageId: loaded.message.id,
        event,
        payload,
      });
      if (storedEvent.sequence > replayCursor) {
        await writeStoredEvent(storedEvent);
      }
      return storedEvent;
    };

    const replayStoredEvents = async (): Promise<{
      wroteAny: boolean;
      reachedTerminal: boolean;
    }> => {
      const storedEvents = await MessageStreamEventRepository.listAfter({
        userMessageId: loaded.message.id,
        afterSequence: replayCursor,
      });
      let wroteAny = false;
      let reachedTerminal = false;
      for (const storedEvent of storedEvents) {
        await writeStoredEvent(storedEvent);
        wroteAny = true;
        if (MessageStreamEventRepository.isTerminalEvent(storedEvent)) {
          reachedTerminal = true;
          break;
        }
      }
      return { wroteAny, reachedTerminal };
    };

    const appendTerminalForAssistantMessage = async (
      assistantMessage: Awaited<ReturnType<typeof streamAssistantTurn>>,
    ) => {
      if (assistantMessage.isError) {
        await persistAndWrite('error', {
          kind: 'transport',
          message:
            assistantMessage.content === GENERIC_FAILURE_MESSAGE
              ? 'Trouble connecting. Please try again.'
              : assistantMessage.content,
          recoverable: true,
        });
        return;
      }

      await persistAndWrite('done', {
        html: renderAssistantContentHtml(assistantMessage.content),
        // SQR-98: send the persisted consulted_sources along with `done` so
        // the client can rebuild the footer on replay — duplicate /stream
        // hits, HTMX reconnects, or any path where persistAssistantOutcome
        // returns an already-persisted row return here with no tool_result
        // events fired. Without this, the footer would stay hidden on the
        // reconnected turn until a full page reload.
        // SQR-108 / ADR 0012 E-3: the `recentQuestionsNavHtml` field was
        // dropped — the conversation page is a scrolling transcript with
        // no recent-questions chip rail to refresh.
        consultedSources: assistantMessage.consultedSources,
      });
    };

    const existingTerminal = await MessageStreamEventRepository.findTerminal(loaded.message.id);
    if (existingTerminal && existingTerminal.sequence <= replayCursor) {
      return;
    }

    const initialReplay = await replayStoredEvents();
    if (initialReplay.reachedTerminal) {
      return;
    }

    const hasPriorStreamEvents = replayCursor > 0 || initialReplay.wroteAny;
    if (hasPriorStreamEvents) {
      for (let polls = 0; polls < STREAM_REPLAY_MAX_POLLS; polls += 1) {
        if (
          !(await MessageStreamEventRepository.isTurnGenerationLocked({
            conversationId: loaded.conversation.id,
            userMessageId: loaded.message.id,
          }))
        ) {
          const replay = await replayStoredEvents();
          if (replay.reachedTerminal) {
            return;
          }

          const assistantMessage = await persistAssistantFailureTurn({
            conversationId: loaded.conversation.id,
            userMessageId: loaded.message.id,
          });
          await appendTerminalForAssistantMessage(assistantMessage);
          return;
        }

        await delay(STREAM_REPLAY_POLL_MS);
        const replay = await replayStoredEvents();
        if (replay.reachedTerminal) {
          return;
        }
      }

      const replay = await replayStoredEvents();
      if (replay.reachedTerminal) {
        return;
      }

      const assistantMessage = await persistAssistantFailureTurn({
        conversationId: loaded.conversation.id,
        userMessageId: loaded.message.id,
      });
      await appendTerminalForAssistantMessage(assistantMessage);
      return;
    }

    const assistantMessage = await streamAssistantTurn({
      conversationId: loaded.conversation.id,
      question: loaded.message.content,
      userId: session.userId,
      currentUserMessageId: loaded.message.id,
      game: loaded.message.game ?? undefined,
      requestId,
      telemetry: { route: '/chat/:conversationId/messages/:messageId/stream', surface: 'chat_sse' },
      onEvent: async (event, data) => {
        if (event === 'text') {
          await persistAndWrite('text-delta', data);
          return;
        }

        if (event === 'tool_call') {
          const payload = data as { name?: string };
          const name = payload.name ?? 'tool';
          await persistAndWrite('tool-start', {
            id: buildToolStatusId(name),
            // Keep the SSE wire contract: always send a string label
            // (REFERENCE fallback for utility/traversal tools) so the
            // tool-indicator UI doesn't need to know about nulls.
            label: toolSourceLabel(name) ?? TOOL_SOURCE_FALLBACK_LABEL,
          });
          return;
        }

        if (event === 'tool_plan') {
          const payload = data as { message?: unknown; toolName?: string };
          const message = typeof payload.message === 'string' ? payload.message.trim() : '';
          if (message.length === 0) {
            return;
          }
          const name = payload.toolName ?? 'tool';
          planSequence += 1;
          await persistAndWrite('tool-plan', {
            id: `${buildToolStatusId(name)}-plan-${planSequence}`,
            message,
          });
          return;
        }

        if (event === 'tool_progress') {
          const payload = data as { message?: unknown; toolName?: string };
          const message = typeof payload.message === 'string' ? payload.message.trim() : '';
          if (message.length === 0) {
            return;
          }
          const name = payload.toolName ?? 'tool';
          const label = toolSourceLabel(name) ?? TOOL_SOURCE_FALLBACK_LABEL;
          progressSequence += 1;
          await persistAndWrite('tool-progress', {
            id: `${buildToolStatusId(name)}-progress-${progressSequence}`,
            label,
            message,
          });
          return;
        }

        if (event === 'artifact') {
          const payload = data as {
            kind?: unknown;
            title?: unknown;
            body?: unknown;
            sourceLabel?: unknown;
            ref?: unknown;
          };
          const title = typeof payload.title === 'string' ? payload.title.trim() : '';
          const body = typeof payload.body === 'string' ? payload.body.trim() : '';
          if (payload.kind !== 'section_quote' || title.length === 0 || body.length === 0) {
            return;
          }
          const rawSourceLabel =
            typeof payload.sourceLabel === 'string' ? payload.sourceLabel.trim() : '';
          const sourceLabel =
            rawSourceLabel.length === 0
              ? null
              : isToolSourceLabel(rawSourceLabel)
                ? rawSourceLabel
                : retrievalSourceLabelToFooterLabel(rawSourceLabel);
          const ref = typeof payload.ref === 'string' ? payload.ref.trim() : '';
          artifactSequence += 1;
          await persistAndWrite('answer-artifact', {
            id: `section-quote-${artifactSequence}`,
            kind: 'section-quote',
            title,
            body,
            sourceLabel,
            ref: ref.length > 0 ? ref : null,
          });
          return;
        }

        if (event === 'state_context') {
          // SQR-258: name the state snapshot this personalized answer ran
          // against, with a fix-it-here link to the edit surface.
          const payload = data as {
            summary?: unknown;
            campaignId?: unknown;
            characterId?: unknown;
          };
          if (typeof payload.summary !== 'string' || typeof payload.campaignId !== 'string') {
            return;
          }
          await persistAndWrite('state-used', {
            id: 'state-used',
            message: `Using campaign state: ${payload.summary}`,
            href:
              typeof payload.characterId === 'string'
                ? `/characters/${payload.characterId}`
                : `/campaigns/${payload.campaignId}`,
          });
          return;
        }

        if (event === 'proposal') {
          // SQR-286: a staged destructive mutation renders as the chat
          // confirmation block. Lines are server-derived so the preview
          // vocabulary stays in one tested place.
          const payload = data as {
            proposalId?: unknown;
            campaignId?: unknown;
            mutation?: unknown;
            expiresAt?: unknown;
            lines?: unknown;
          };
          if (
            typeof payload.proposalId !== 'string' ||
            typeof payload.campaignId !== 'string' ||
            typeof payload.expiresAt !== 'string'
          ) {
            return;
          }
          // Prefer the propose-time resolved lines (character names, derived
          // availability consequences); fall back to the generic vocabulary.
          const resolvedLines = Array.isArray(payload.lines)
            ? payload.lines.filter((line): line is string => typeof line === 'string')
            : [];
          await persistAndWrite('proposal-staged', {
            id: `proposal-${payload.proposalId}`,
            proposalId: payload.proposalId,
            campaignId: payload.campaignId,
            lines: resolvedLines.length > 0 ? resolvedLines : stagedMutationLines(payload.mutation),
            expiresAt: payload.expiresAt,
          });
          return;
        }

        if (event === 'tool_result') {
          const payload = data as {
            name?: string;
            ok?: boolean;
            message?: unknown;
            sourceBooks?: string[];
          };
          const name = payload.name ?? 'tool';
          const message = typeof payload.message === 'string' ? payload.message.trim() : '';
          // Use the actual books hit when available (search_rules always sets
          // sourceBooks, even to [] on no results); fall back to the static
          // label for tools that don't set sourceBooks at all.
          const staticLabel = toolSourceLabel(name) ?? TOOL_SOURCE_FALLBACK_LABEL;
          const mappedLabels =
            payload.sourceBooks === undefined
              ? null
              : payload.sourceBooks
                  .map(retrievalSourceLabelToFooterLabel)
                  .filter((l): l is NonNullable<typeof l> => l !== null);
          const labels = mappedLabels && mappedLabels.length > 0 ? mappedLabels : [staticLabel];
          await persistAndWrite('tool-result', {
            id: buildToolStatusId(name),
            labels,
            ok: payload.ok ?? true,
            message: message.length > 0 ? humanizeWorkLogProgressMessage(message) : undefined,
          });
          return;
        }
      },
    });

    await appendTerminalForAssistantMessage(assistantMessage);
  });
});

// ─── Bearer auth middleware ──────────────────────────────────────────────────

type BearerAuthResult =
  | { ok: true; authInfo: AuthInfo }
  | { ok: false; authenticateHeader: string; message: string };

async function authenticateBearer(c: Context): Promise<BearerAuthResult> {
  const authHeader = c.req.header('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return {
      ok: false,
      authenticateHeader: 'Bearer',
      message: 'Authentication required',
    };
  }

  const token = authHeader.slice(7);
  const authInfo = await verifyAccessToken(token, auditContext(c));
  if (!authInfo) {
    return {
      ok: false,
      authenticateHeader: 'Bearer error="invalid_token"',
      message: 'Invalid or expired token',
    };
  }

  return { ok: true, authInfo };
}

function bearerAuthFailureResponse(c: Context, result: Extract<BearerAuthResult, { ok: false }>) {
  c.header('WWW-Authenticate', result.authenticateHeader);
  return c.json(jsonError(result.message, 401), 401);
}

function requireBearerAuth(): MiddlewareHandler {
  return async (c: Parameters<Parameters<typeof app.use>[1]>[0], next: () => Promise<void>) => {
    const authResult = await authenticateBearer(c);
    if (!authResult.ok) {
      return bearerAuthFailureResponse(c, authResult);
    }

    c.set('authInfo', authResult.authInfo);
    await next();
  };
}

function requireBearerAuthAndRateLimit(policy: RateLimitPolicy, route: string): MiddlewareHandler {
  return async (c, next) => {
    const authResult = await authenticateBearer(c);
    if (!authResult.ok) {
      return bearerAuthFailureResponse(c, authResult);
    }

    let rateLimit: ApiRateLimitResult;
    try {
      rateLimit = await checkApiRateLimit(authResult.authInfo, policy);
    } catch (error) {
      return apiRateLimitUnavailableResponse(c, error, route, policy);
    }

    if (!rateLimit.decision.allowed) {
      return apiRateLimitedResponse(c, rateLimit, route);
    }

    c.set('authInfo', authResult.authInfo);
    await next();
  };
}

function requireMcpAuthAndRateLimit(): MiddlewareHandler {
  return async (c, next) => {
    const authResult = await authenticateBearer(c);
    const authInfo = authResult.ok ? authResult.authInfo : undefined;

    let rateLimit: McpRateLimitResult;
    try {
      rateLimit = await checkMcpRateLimit(c, authInfo);
    } catch (error) {
      return mcpRateLimitUnavailableResponse(c, error);
    }

    if (!rateLimit.decision.allowed) {
      return mcpRateLimitedResponse(c, rateLimit);
    }

    if (!authResult.ok) {
      return bearerAuthFailureResponse(c, authResult);
    }

    c.set('authInfo', authInfo);
    await next();
  };
}

// Protect API endpoints (except health) and MCP
app.use(
  '/api/search/rules',
  requireBearerAuthAndRateLimit(API_RULE_SEARCH_RATE_LIMIT_POLICY, '/api/search/rules'),
);
app.use(
  '/api/search/cards',
  requireBearerAuthAndRateLimit(API_CARD_SEARCH_RATE_LIMIT_POLICY, '/api/search/cards'),
);
app.use('/api/cards/*', requireBearerAuth());
app.use('/api/cards', requireBearerAuth());
app.use('/api/card-types', requireBearerAuth());
app.use('/api/ask', requireBearerAuthAndRateLimit(API_ASK_RATE_LIMIT_POLICY, '/api/ask'));
app.use('/mcp', requireMcpAuthAndRateLimit());

// ─── MCP transport ───────────────────────────────────────────────────────────

app.all('/mcp', async (c) => {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless mode
  });
  const server = createMcpServer();
  await server.connect(transport);
  // Thread the verified bearer token into tool handlers as `extra.authInfo`
  // so identity-requiring tools (campaign state, SQR-20/269) can resolve the
  // caller. Knowledge tools ignore it.
  const authInfo = c.get('authInfo');
  return transport.handleRequest(c.req.raw, authInfo ? { authInfo } : undefined);
});

// ─── Error handling ──────────────────────────────────────────────────────────

function jsonError(message: string, status: number) {
  return { error: message, status };
}

/**
 * Build an RFC 6749 §5.2 error body. OAuth endpoints return this shape
 * (`error`, `error_description`) instead of the generic `{error, status}`
 * envelope used elsewhere on the API. Keeping the two helpers separate makes
 * it obvious at the call site which contract a route is honoring.
 */
function oauthError(
  error: string,
  errorDescription?: string,
): { error: string; error_description?: string } {
  return errorDescription === undefined
    ? { error }
    : { error: error, error_description: errorDescription };
}

/**
 * Translate an SDK `OAuthError` into an RFC 6749 §5.2 JSON response. Only
 * OAuth-shaped errors are handled here — anything else (DB outage, bug) is
 * re-thrown so the global `app.onError` surfaces it as a 500. Relabeling
 * arbitrary exceptions as `invalid_request` would mask real outages as
 * caller errors. CodeRabbit flagged this on PR #196.
 */
function oauthErrorResponse(c: Context, err: unknown) {
  if (err instanceof OAuthError) {
    return c.json(err.toResponseObject(), 400);
  }
  throw err;
}

app.notFound((c) => {
  return c.json(jsonError('Not found', 404), 404);
});

app.onError((err, c) => {
  console.error('Unhandled error:', err instanceof Error ? err.message : err);
  const requestId = correlateRequest(c);
  captureTelemetryError(err, buildServerErrorTelemetry(c, requestId));
  return c.json(jsonError('Internal server error', 500), 500);
});

// ─── Health endpoint ─────────────────────────────────────────────────────────

app.get('/api/health', async (c) => {
  const readiness = await runReadinessChecks();
  return c.json(readiness, readiness.status === 'ok' ? 200 : 503);
});

app.get('/api/live', (c) => {
  return c.json({ status: 'ok' });
});

// Browser observability endpoint. It deliberately accepts only a strict,
// operational allowlist; invalid telemetry is ignored because diagnostics must
// never change the page behavior or mirror unknown browser data into Sentry.
app.post('/api/browser-telemetry', optionalSession(), async (c) => {
  const requestId = correlateRequest(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.body(null, 204);
  }

  const result = BrowserTelemetrySchema.safeParse(body);
  if (!result.success) return c.body(null, 204);

  const event = result.data;
  const telemetryInput = buildBrowserTelemetryInput(c, requestId, event);
  const logLevel = browserTelemetryLevel(event);

  return browserTelemetryTracer.startActiveSpan(
    'squire.browser_telemetry',
    { attributes: browserTelemetrySpanAttributes(telemetryInput, event) },
    (span) => {
      if (event.type === 'browser_feedback') {
        const feedbackInput = buildBrowserFeedbackInput(c, requestId, event);
        if (!feedbackInput) {
          finishBrowserTelemetrySpan(span, logLevel);
          return c.body(null, 204);
        }
        captureTelemetryLog(logLevel, `browser.${event.type}`, {
          ...telemetryInput,
          attributes: browserTelemetryAttributes(event),
        });
        const eventId = captureTelemetryFeedback(feedbackInput);
        finishBrowserTelemetrySpan(span, logLevel);
        return c.json({ eventId }, 202);
      }

      captureTelemetryLog(logLevel, `browser.${event.type}`, {
        ...telemetryInput,
        attributes: browserTelemetryAttributes(event),
      });

      if (logLevel === 'info') {
        finishBrowserTelemetrySpan(span, logLevel);
        return c.json({ eventId: null }, 202);
      }

      const eventId = captureTelemetryMessage(`browser.${event.type}`, 'error', telemetryInput);
      finishBrowserTelemetrySpan(span, logLevel);
      return c.json({ eventId }, 202);
    },
  );
});

// ─── Search endpoints ────────────────────────────────────────────────────────

function parseTopK(raw: string | undefined): number {
  if (!raw) return 6;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100) return 6;
  return n;
}

function gameOptsFromValue(game: string | undefined): { game: string } | undefined {
  if (game === undefined) return undefined;
  requireGameId(game);
  return { game };
}

function gameOptsFromQuery(
  c: Context,
): { ok: true; opts?: { game: string } } | { ok: false; response: Response } {
  try {
    return { ok: true, opts: gameOptsFromValue(c.req.query('game')) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, response: c.json(jsonError(message, 400), 400) };
  }
}

async function bootstrapErrorResponse(
  c: Context,
  scope: 'rules' | 'cards' | 'ask',
): Promise<Response | null> {
  if (isReady()) return null;

  const status = await ensureBootstrapStatus();
  const capability = status.capabilities[scope];

  if (capability.allowed) return null;

  const message =
    status.lifecycle === 'warming_up'
      ? 'Service is warming up. Retry in a moment.'
      : 'Service unavailable.';

  return c.json(jsonError(message, 503), 503);
}

function requireBootstrapCapability(scope: 'rules' | 'cards' | 'ask'): MiddlewareHandler {
  return async (c, next) => {
    const bootstrapError = await bootstrapErrorResponse(c, scope);
    if (bootstrapError) return bootstrapError;
    await next();
  };
}

async function ensureBootstrapCapability(
  c: Context,
  scope: 'rules' | 'cards' | 'ask',
): Promise<Response | null> {
  return bootstrapErrorResponse(c, scope);
}

app.get('/api/search/rules', async (c) => {
  const q = c.req.query('q');
  if (!q) return c.json(jsonError('Missing required query parameter: q', 400), 400);

  const bootstrapError = await ensureBootstrapCapability(c, 'rules');
  if (bootstrapError) return bootstrapError;

  const topK = parseTopK(c.req.query('topK'));
  const gameOpts = gameOptsFromQuery(c);
  if (!gameOpts.ok) return gameOpts.response;
  const results = gameOpts.opts
    ? await searchRules(q, topK, gameOpts.opts)
    : await searchRules(q, topK);
  return c.json({ results });
});

app.get('/api/search/cards', async (c) => {
  const q = c.req.query('q');
  if (!q) return c.json(jsonError('Missing required query parameter: q', 400), 400);

  const bootstrapError = await ensureBootstrapCapability(c, 'cards');
  if (bootstrapError) return bootstrapError;

  const topK = parseTopK(c.req.query('topK'));
  const gameOpts = gameOptsFromQuery(c);
  if (!gameOpts.ok) return gameOpts.response;
  const results = gameOpts.opts
    ? await searchCards(q, topK, gameOpts.opts)
    : await searchCards(q, topK);
  return c.json({ results });
});

// ─── Card discovery and lookup endpoints ─────────────────────────────────────

app.get('/api/card-types', requireBootstrapCapability('cards'), async (c) => {
  const gameOpts = gameOptsFromQuery(c);
  if (!gameOpts.ok) return gameOpts.response;
  const types = gameOpts.opts ? await listCardTypes(gameOpts.opts) : await listCardTypes();
  return c.json({ types });
});

app.get('/api/cards/:type/:id', requireBootstrapCapability('cards'), async (c) => {
  const type = c.req.param('type') as CardType;
  const id = decodeURIComponent(c.req.param('id'));
  const gameOpts = gameOptsFromQuery(c);
  if (!gameOpts.ok) return gameOpts.response;
  const card = gameOpts.opts ? await getCard(type, id, gameOpts.opts) : await getCard(type, id);
  if (!card) return c.json(jsonError('Card not found', 404), 404);
  return c.json({ card });
});

app.get('/api/cards', async (c) => {
  const type = c.req.query('type');
  if (!type) return c.json(jsonError('Missing required query parameter: type', 400), 400);

  const filterRaw = c.req.query('filter');
  let filter: Record<string, unknown> | undefined;
  if (filterRaw) {
    try {
      const parsed = JSON.parse(filterRaw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return c.json(jsonError('Filter must be a JSON object', 400), 400);
      }
      filter = parsed as Record<string, unknown>;
    } catch {
      return c.json(jsonError('Invalid filter JSON', 400), 400);
    }
  }

  const bootstrapError = await ensureBootstrapCapability(c, 'cards');
  if (bootstrapError) return bootstrapError;

  const gameOpts = gameOptsFromQuery(c);
  if (!gameOpts.ok) return gameOpts.response;
  const cards = gameOpts.opts
    ? await listCards(type as CardType, filter, gameOpts.opts)
    : await listCards(type as CardType, filter);
  return c.json({ cards });
});

// ─── Ask endpoint ────────────────────────────────────────────────────────────

const ASK_QUESTION_MAX_CHARS = 2_000;
const ASK_HISTORY_MAX_ITEMS = 20;
const ASK_HISTORY_MESSAGE_MAX_CHARS = 2_000;

const AskRequestSchema = z.object({
  question: z.string().min(1).max(ASK_QUESTION_MAX_CHARS),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(ASK_HISTORY_MESSAGE_MAX_CHARS),
      }),
    )
    .max(ASK_HISTORY_MAX_ITEMS)
    .optional(),
  campaignId: z.string().uuid().optional(),
  activeCharacterId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  toolSurface: z.enum(['redesigned', 'legacy']).optional(),
  game: z.string().optional(),
});

app.post('/api/ask', async (c) => {
  const requestId = correlateRequest(c);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(jsonError('Invalid JSON body', 400), 400);
  }

  const result = AskRequestSchema.safeParse(body);
  if (!result.success) {
    return c.json(jsonError('Invalid request: ' + result.error.issues[0].message, 400), 400);
  }

  const bootstrapError = await ensureBootstrapCapability(c, 'ask');
  if (bootstrapError) return bootstrapError;

  const { question, ...options } = result.data;
  try {
    gameOptsFromValue(options.game);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json(jsonError(message, 400), 400);
  }
  // Identity comes from the verified bearer token, never the request body
  // (SQR-20 / ADR 0021): a body-supplied userId is discarded, and client-
  // credentials tokens (no userId) simply get no personalization or
  // per-user budget attribution on this read path.
  delete options.userId;
  const tokenUserId = userIdFromAuthInfo(c.get('authInfo'));
  if (tokenUserId) options.userId = tokenUserId;
  try {
    await ensureAskBudgetAvailable(tokenUserId);
  } catch (error) {
    if (error instanceof LlmBudgetExceededError) return budgetExceededResponse(c, error);
    throw error;
  }
  // Campaign binding fails BEFORE the SSE stream opens: non-members get the
  // indistinguishable 404, and client-only tokens get no campaign context at
  // all (the same posture as the contract kinds, SQR-19/269).
  if (options.campaignId) {
    if (!tokenUserId) {
      delete options.campaignId;
      delete options.activeCharacterId;
    } else {
      try {
        await CampaignService.requireActiveMember(options.campaignId, tokenUserId);
      } catch (error) {
        if (error instanceof CampaignService.CampaignNotFoundError) {
          return c.json(jsonError('Not found', 404), 404);
        }
        throw error;
      }
    }
  }

  return streamSSE(c, async (stream) => {
    try {
      await ask(question, {
        ...options,
        budgetPrechecked: true,
        requestId,
        emit: async (event, data) => {
          await stream.writeSSE({ event, data: JSON.stringify(data) });
        },
      });
    } catch (error) {
      captureChatFailureTelemetry(error, {
        route: '/api/ask',
        surface: 'api_ask',
        failureKind: 'api_ask',
        requestId,
        user: safeUserFromContext(c),
        game: options.game ?? null,
        context: {
          method: 'POST',
        },
      });
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ message: 'Internal server error' }),
      });
    }
  });
});

// ─── Campaign state API (SQR-21, ADR 0021) ──────────────────────────────────
//
// Dual-channel auth: a user-bound OAuth bearer token (API/MCP clients) or the
// web session cookie (browser fetch/HTMX, with a CSRF header on writes).
// Client-credentials tokens are structurally rejected — campaign state always
// needs a real user (SQR-20). Authorization itself (membership, roles, the
// permission matrix) lives in campaign-service, not here.

type CampaignAuthResult =
  | { ok: true; identity: CallerIdentity }
  | { ok: false; response: Response };

function timingSafeEqualStrings(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

async function authenticateCampaignRequest(c: Context): Promise<CampaignAuthResult> {
  if (c.req.header('authorization')) {
    const authResult = await authenticateBearer(c);
    if (!authResult.ok) return { ok: false, response: bearerAuthFailureResponse(c, authResult) };
    c.set('authInfo', authResult.authInfo);
    try {
      return { ok: true, identity: requireIdentityFromAuthInfo(authResult.authInfo, 'rest') };
    } catch (error) {
      if (error instanceof UserIdentityRequiredError) {
        writeSecurityLog({
          event: 'campaign_client_token_rejected',
          fields: {
            route: c.req.path,
            method: c.req.method,
            client_id: authResult.authInfo.clientId,
          },
        });
        return {
          ok: false,
          response: c.json({ error: error.code, message: error.message, status: 403 }, 403),
        };
      }
      throw error;
    }
  }

  const sessionId = await getSignedCookie(c, getSessionSecret(), SESSION_COOKIE_NAME);
  if (!sessionId) {
    if (sessionId === false) deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
    return { ok: false, response: c.json(jsonError('Authentication required', 401), 401) };
  }
  const session = await SessionRepository.findById(sessionId);
  if (!session) {
    deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
    return { ok: false, response: c.json(jsonError('Session expired', 401), 401) };
  }
  c.set('session', session);

  // Cookie-authenticated writes need the CSRF header (JSON API: header only,
  // no form-field fallback — HTMX/fetch callers set `x-csrf-token`).
  if (!['GET', 'HEAD'].includes(c.req.method)) {
    const provided = c.req.header(CSRF_HEADER_NAME);
    if (!provided || !timingSafeEqualStrings(provided, createCsrfToken(session.id))) {
      return {
        ok: false,
        response: c.json(
          jsonError('Security check failed. Refresh the page and try again.', 403),
          403,
        ),
      };
    }
  }

  return { ok: true, identity: identityFromSessionUser(session.userId) };
}

function requireCampaignUser(route: string): MiddlewareHandler {
  return async (c, next) => {
    const auth = await authenticateCampaignRequest(c);
    if (!auth.ok) return auth.response;

    const policy =
      c.req.method === 'GET' || c.req.method === 'HEAD'
        ? CAMPAIGN_READ_RATE_LIMIT_POLICY
        : CAMPAIGN_WRITE_RATE_LIMIT_POLICY;
    let decision: RateLimitDecision;
    try {
      decision = await getDefaultRateLimiter().consume({
        policy,
        identity: `user:${auth.identity.userId}`,
      });
    } catch (error) {
      return apiRateLimitUnavailableResponse(c, error, route, policy);
    }
    if (!decision.allowed) {
      return apiRateLimitedResponse(c, { decision, identityKind: 'user' }, route);
    }

    // Per-user JSON must never be cacheable — these routes also serve
    // cookie-authenticated browser reads, where a shared cache would happily
    // reuse one member's roster for another without this.
    c.header('Cache-Control', 'no-store');
    c.set('callerIdentity', auth.identity);
    await next();
  };
}

// `/*` also matches the bare path in Hono 4 — one registration per prefix,
// or the rate limiter would consume twice per request.
app.use('/api/campaigns/*', requireCampaignUser('/api/campaigns'));
app.use('/api/invites/*', requireCampaignUser('/api/invites'));
app.use('/api/proposals/*', requireCampaignUser('/api/proposals'));

/** Map campaign-service errors to HTTP; rethrow anything unrecognized. */
function campaignErrorResponse(c: Context, error: unknown): Response {
  if (error instanceof CampaignService.CampaignNotFoundError) {
    return c.json(jsonError('Not found', 404), 404);
  }
  if (error instanceof CampaignService.CampaignForbiddenError) {
    return c.json({ error: error.code, message: error.message, status: 403 }, 403);
  }
  if (error instanceof CampaignService.NotAllowlistedError) {
    return c.json({ error: error.code, message: error.message, status: 403 }, 403);
  }
  if (error instanceof CampaignService.OwnerCannotLeaveError) {
    return c.json({ error: error.code, message: error.message, status: 409 }, 409);
  }
  if (error instanceof CampaignService.AlreadyInvitedError) {
    return c.json({ error: error.code, message: error.message, status: 409 }, 409);
  }
  if (error instanceof CampaignService.UnsupportedGameError) {
    return c.json({ error: error.code, message: error.message, status: 400 }, 400);
  }
  if (error instanceof CampaignService.ProposalRequiredError) {
    return c.json(
      {
        error: error.code,
        message: error.message,
        mutationType: error.mutationType,
        status: 409,
      },
      409,
    );
  }
  if (error instanceof ProposalStateError) {
    return c.json({ error: error.code, message: error.message, status: 409 }, 409);
  }
  throw error;
}

/**
 * Malformed ids return the same not-found as absent ids: a 400 on a
 * non-UUID would distinguish "bad id" from "real id you cannot see"
 * (ADR 0021 §Non-member access).
 */
function campaignRouteId(c: Context, param: string): string | null {
  const value = c.req.param(param);
  return value !== undefined && z.string().uuid().safeParse(value).success ? value : null;
}

const CreateCampaignRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  game: z.string().trim().min(1).max(100),
  modules: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
});

const InviteRequestSchema = z.object({
  email: z.string().trim().email().max(320),
});

/** The enumerated destructive set (ADR 0021) — closed by construction. */
const ProposalRequestSchema = z.object({
  mutation: PendingMutations.StagedMutationSchema,
});

const StateKeyArraySchema = z.array(z.string().trim().min(1).max(200)).max(1000);

const UpdateCampaignRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    name: z.string().trim().min(1).max(200).optional(),
    prosperity: z.number().int().min(0).max(100).optional(),
    activeScenario: z.string().trim().min(1).max(200).nullable().optional(),
    playedScenarios: StateKeyArraySchema.optional(),
    drawnScenarios: StateKeyArraySchema.optional(),
    unlockedClasses: StateKeyArraySchema.optional(),
    unlockedItems: StateKeyArraySchema.optional(),
    unlockedBuildings: StateKeyArraySchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 1, {
    message: 'At least one field to update is required',
  });

app.post('/api/campaigns', async (c) => {
  const body = CreateCampaignRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json(jsonError('Invalid request body', 400), 400);
  try {
    const campaign = await CampaignService.createCampaign(c.get('callerIdentity')!, body.data);
    return c.json({ campaign }, 201);
  } catch (error) {
    return campaignErrorResponse(c, error);
  }
});

app.get('/api/campaigns', async (c) => {
  const campaigns = await CampaignService.listMyCampaigns(c.get('callerIdentity')!);
  return c.json({ campaigns });
});

app.get('/api/campaigns/:id', async (c) => {
  const campaignId = campaignRouteId(c, 'id');
  if (!campaignId) return c.json(jsonError('Not found', 404), 404);
  try {
    return c.json(await CampaignService.getCampaignDetail(c.get('callerIdentity')!, campaignId));
  } catch (error) {
    return campaignErrorResponse(c, error);
  }
});

app.patch('/api/campaigns/:id', async (c) => {
  const campaignId = campaignRouteId(c, 'id');
  if (!campaignId) return c.json(jsonError('Not found', 404), 404);
  const body = UpdateCampaignRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json(jsonError('Invalid request body', 400), 400);
  const identity = c.get('callerIdentity')!;
  try {
    const campaign = await CampaignService.updateSharedState(identity, campaignId, body.data);
    return c.json({ campaign });
  } catch (error) {
    if (error instanceof VersionConflictError) {
      // E3: 409 + the current state so the client can re-read and retry.
      // The follow-up read can itself lose a race (campaign deleted, caller
      // removed) — map that outcome instead of letting it become a 500.
      try {
        const detail = await CampaignService.getCampaignDetail(identity, campaignId);
        return c.json(
          {
            error: 'version_conflict',
            currentVersion: detail.campaign.version,
            campaign: detail.campaign,
            status: 409,
          },
          409,
        );
      } catch (readError) {
        return campaignErrorResponse(c, readError);
      }
    }
    return campaignErrorResponse(c, error);
  }
});

app.delete('/api/campaigns/:id', async (c) => {
  const campaignId = campaignRouteId(c, 'id');
  if (!campaignId) return c.json(jsonError('Not found', 404), 404);
  try {
    await CampaignService.deleteCampaign(c.get('callerIdentity')!, campaignId);
    return c.body(null, 204);
  } catch (error) {
    return campaignErrorResponse(c, error);
  }
});

app.post('/api/campaigns/:id/invites', async (c) => {
  const campaignId = campaignRouteId(c, 'id');
  if (!campaignId) return c.json(jsonError('Not found', 404), 404);
  const body = InviteRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json(jsonError('Invalid request body', 400), 400);
  try {
    const member = await CampaignService.inviteMember(
      c.get('callerIdentity')!,
      campaignId,
      body.data.email,
    );
    return c.json({ member }, 201);
  } catch (error) {
    return campaignErrorResponse(c, error);
  }
});

app.post('/api/campaigns/:id/leave', async (c) => {
  const campaignId = campaignRouteId(c, 'id');
  if (!campaignId) return c.json(jsonError('Not found', 404), 404);
  try {
    await CampaignService.leaveCampaign(c.get('callerIdentity')!, campaignId);
    return c.body(null, 204);
  } catch (error) {
    return campaignErrorResponse(c, error);
  }
});

app.delete('/api/campaigns/:id/members/:memberId', async (c) => {
  const campaignId = campaignRouteId(c, 'id');
  const memberId = campaignRouteId(c, 'memberId');
  if (!campaignId || !memberId) return c.json(jsonError('Not found', 404), 404);
  try {
    await CampaignService.removeMember(c.get('callerIdentity')!, campaignId, memberId);
    return c.body(null, 204);
  } catch (error) {
    return campaignErrorResponse(c, error);
  }
});

app.get('/api/campaigns/:id/journal', async (c) => {
  const campaignId = campaignRouteId(c, 'id');
  if (!campaignId) return c.json(jsonError('Not found', 404), 404);
  try {
    const journal = await listJournal(c.get('callerIdentity')!, campaignId);
    return c.json({ journal });
  } catch (error) {
    return campaignErrorResponse(c, error);
  }
});

app.post('/api/campaigns/:id/proposals', async (c) => {
  const campaignId = campaignRouteId(c, 'id');
  if (!campaignId) return c.json(jsonError('Not found', 404), 404);
  const body = ProposalRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json(jsonError('Invalid request body', 400), 400);
  try {
    const identity = c.get('callerIdentity')!;
    const proposal = await PendingMutations.propose(identity, campaignId, body.data.mutation);
    // Headless parity (SQR-283): REST clients get the same resolved preview
    // lines the chat confirmation block shows.
    const preview = await WriteTools.proposalPreviewLines(identity, campaignId, proposal.mutation);
    return c.json({ proposal, preview }, 201);
  } catch (error) {
    return campaignErrorResponse(c, error);
  }
});

app.post('/api/proposals/:id/confirm', async (c) => {
  const proposalId = campaignRouteId(c, 'id');
  if (!proposalId) return c.json(jsonError('Not found', 404), 404);
  try {
    const proposal = await PendingMutations.confirm(c.get('callerIdentity')!, proposalId);
    return c.json({ proposal });
  } catch (error) {
    return campaignErrorResponse(c, error);
  }
});

app.delete('/api/proposals/:id', async (c) => {
  const proposalId = campaignRouteId(c, 'id');
  if (!proposalId) return c.json(jsonError('Not found', 404), 404);
  try {
    await PendingMutations.cancel(c.get('callerIdentity')!, proposalId);
    return c.body(null, 204);
  } catch (error) {
    return campaignErrorResponse(c, error);
  }
});

app.get('/api/invites', async (c) => {
  try {
    const invites = await CampaignService.listMyInvites(c.get('callerIdentity')!);
    return c.json({ invites });
  } catch (error) {
    return campaignErrorResponse(c, error);
  }
});

app.post('/api/invites/:memberId/accept', async (c) => {
  const memberId = campaignRouteId(c, 'memberId');
  if (!memberId) return c.json(jsonError('Not found', 404), 404);
  try {
    const campaign = await CampaignService.acceptInvite(c.get('callerIdentity')!, memberId);
    return c.json({ campaign });
  } catch (error) {
    return campaignErrorResponse(c, error);
  }
});

// ─── Character API (SQR-22, ADR 0021) ────────────────────────────────────────

app.use('/api/characters/*', requireCampaignUser('/api/characters'));

const PrivateFieldSchema = z.string().trim().min(1).max(5000).nullable();

const CreateCharacterRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  className: z.string().trim().min(1).max(100),
  level: z.number().int().min(1).max(20).optional(),
  xp: z.number().int().min(0).optional(),
  gold: z.number().int().min(0).optional(),
  perks: z.array(z.number().int().min(0)).max(100).optional(),
  personalQuest: PrivateFieldSchema.optional(),
  battleGoals: PrivateFieldSchema.optional(),
  privateNotes: PrivateFieldSchema.optional(),
  placeholderForEmail: z.string().trim().email().max(320).optional(),
});

const UpdateCharacterRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    name: z.string().trim().min(1).max(100).optional(),
    className: z.string().trim().min(1).max(100).optional(),
    level: z.number().int().min(1).max(20).optional(),
    xp: z.number().int().min(0).optional(),
    gold: z.number().int().min(0).optional(),
    perks: z.array(z.number().int().min(0)).max(100).optional(),
    personalQuest: PrivateFieldSchema.optional(),
    battleGoals: PrivateFieldSchema.optional(),
    privateNotes: PrivateFieldSchema.optional(),
    status: z.enum(['active', 'retired']).optional(),
    successorId: z.string().uuid().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 1, {
    message: 'At least one field to update is required',
  });

const AddItemRequestSchema = z.object({
  sourceId: z.string().trim().min(1).max(200),
});

const AddCardRequestSchema = z.object({
  sourceId: z.string().trim().min(1).max(200),
  role: z.enum(['owned', 'active']).optional(),
});

const SetCardRoleRequestSchema = z.object({
  role: z.enum(['owned', 'active']),
});

/** Character routes share the campaign error mapping plus one more shape. */
function characterErrorResponse(c: Context, error: unknown): Response {
  if (error instanceof CharacterService.PlaceholderPrivateFieldsError) {
    return c.json({ error: error.code, message: error.message, status: 422 }, 422);
  }
  return campaignErrorResponse(c, error);
}

app.post('/api/campaigns/:id/characters', async (c) => {
  const campaignId = campaignRouteId(c, 'id');
  if (!campaignId) return c.json(jsonError('Not found', 404), 404);
  const body = CreateCharacterRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json(jsonError('Invalid request body', 400), 400);
  try {
    const character = await CharacterService.createCharacter(
      c.get('callerIdentity')!,
      campaignId,
      body.data,
    );
    return c.json({ character }, 201);
  } catch (error) {
    return characterErrorResponse(c, error);
  }
});

app.get('/api/campaigns/:id/characters', async (c) => {
  const campaignId = campaignRouteId(c, 'id');
  if (!campaignId) return c.json(jsonError('Not found', 404), 404);
  try {
    const characters = await CharacterService.listCampaignCharacters(
      c.get('callerIdentity')!,
      campaignId,
    );
    return c.json({ characters });
  } catch (error) {
    return characterErrorResponse(c, error);
  }
});

app.get('/api/characters/:id', async (c) => {
  const characterId = campaignRouteId(c, 'id');
  if (!characterId) return c.json(jsonError('Not found', 404), 404);
  try {
    return c.json(await CharacterService.getCharacterDetail(c.get('callerIdentity')!, characterId));
  } catch (error) {
    return characterErrorResponse(c, error);
  }
});

app.patch('/api/characters/:id', async (c) => {
  const characterId = campaignRouteId(c, 'id');
  if (!characterId) return c.json(jsonError('Not found', 404), 404);
  const body = UpdateCharacterRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json(jsonError('Invalid request body', 400), 400);
  const identity = c.get('callerIdentity')!;
  try {
    const character = await CharacterService.updateCharacter(identity, characterId, body.data);
    // Soft rules-legality warnings (SQR-285): the write already applied;
    // forms surface these inline, house rules always win.
    const warnings = levelXpWarnings(body.data, character);
    return c.json({ character, ...(warnings.length > 0 ? { warnings } : {}) });
  } catch (error) {
    if (error instanceof VersionConflictError) {
      // Same guard as the campaign PATCH: the follow-up read can lose a
      // concurrent delete/removal race — map it, don't 500.
      try {
        const detail = await CharacterService.getCharacterDetail(identity, characterId);
        return c.json(
          {
            error: 'version_conflict',
            currentVersion: detail.character.version,
            character: detail.character,
            status: 409,
          },
          409,
        );
      } catch (readError) {
        return characterErrorResponse(c, readError);
      }
    }
    return characterErrorResponse(c, error);
  }
});

app.delete('/api/characters/:id', async (c) => {
  const characterId = campaignRouteId(c, 'id');
  if (!characterId) return c.json(jsonError('Not found', 404), 404);
  try {
    await CharacterService.deleteCharacter(c.get('callerIdentity')!, characterId);
    return c.body(null, 204);
  } catch (error) {
    return characterErrorResponse(c, error);
  }
});

app.post('/api/characters/:id/claim', async (c) => {
  const characterId = campaignRouteId(c, 'id');
  if (!characterId) return c.json(jsonError('Not found', 404), 404);
  try {
    const character = await CharacterService.claimCharacter(c.get('callerIdentity')!, characterId);
    return c.json({ character });
  } catch (error) {
    return characterErrorResponse(c, error);
  }
});

app.post('/api/characters/:id/items', async (c) => {
  const characterId = campaignRouteId(c, 'id');
  if (!characterId) return c.json(jsonError('Not found', 404), 404);
  const body = AddItemRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json(jsonError('Invalid request body', 400), 400);
  try {
    const identity = c.get('callerIdentity')!;
    const item = await CharacterService.addItem(identity, characterId, body.data.sourceId);
    // Soft rules-legality warning (SQR-285): gold vs item cost, computed
    // against the post-add sheet. Items without cost data stay silent.
    const detail = await CharacterService.getCharacterDetail(identity, characterId);
    const campaign = await CampaignService.getCampaignDetail(identity, detail.character.campaignId);
    const warnings = await itemCostWarnings(
      campaign.campaign.game,
      body.data.sourceId,
      detail.character.gold,
    );
    return c.json({ item, ...(warnings.length > 0 ? { warnings } : {}) }, 201);
  } catch (error) {
    return characterErrorResponse(c, error);
  }
});

app.delete('/api/characters/:id/items/:itemId', async (c) => {
  const characterId = campaignRouteId(c, 'id');
  const itemId = campaignRouteId(c, 'itemId');
  if (!characterId || !itemId) return c.json(jsonError('Not found', 404), 404);
  try {
    await CharacterService.removeItem(c.get('callerIdentity')!, characterId, itemId);
    return c.body(null, 204);
  } catch (error) {
    return characterErrorResponse(c, error);
  }
});

app.post('/api/characters/:id/cards', async (c) => {
  const characterId = campaignRouteId(c, 'id');
  if (!characterId) return c.json(jsonError('Not found', 404), 404);
  const body = AddCardRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json(jsonError('Invalid request body', 400), 400);
  try {
    const card = await CharacterService.addCard(c.get('callerIdentity')!, characterId, body.data);
    return c.json({ card }, 201);
  } catch (error) {
    return characterErrorResponse(c, error);
  }
});

app.patch('/api/characters/:id/cards/:cardId', async (c) => {
  const characterId = campaignRouteId(c, 'id');
  const cardId = campaignRouteId(c, 'cardId');
  if (!characterId || !cardId) return c.json(jsonError('Not found', 404), 404);
  const body = SetCardRoleRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json(jsonError('Invalid request body', 400), 400);
  try {
    await CharacterService.setCardRole(
      c.get('callerIdentity')!,
      characterId,
      cardId,
      body.data.role,
    );
    return c.body(null, 204);
  } catch (error) {
    return characterErrorResponse(c, error);
  }
});

app.delete('/api/characters/:id/cards/:cardId', async (c) => {
  const characterId = campaignRouteId(c, 'id');
  const cardId = campaignRouteId(c, 'cardId');
  if (!characterId || !cardId) return c.json(jsonError('Not found', 404), 404);
  try {
    await CharacterService.removeCard(c.get('callerIdentity')!, characterId, cardId);
    return c.body(null, 204);
  } catch (error) {
    return characterErrorResponse(c, error);
  }
});

// ─── Server startup ──────────────────────────────────────────────────────────

export async function startServer(): Promise<void> {
  const { createAdaptorServer } = await import('@hono/node-server');
  try {
    await startHttpServer({
      appFetch: app.fetch,
      createAdaptorServer,
      loadServerConfig,
      getWorktreeRuntime,
      claimWorktreePort,
      startBootstrapLifecycle,
    });
  } catch (error) {
    captureTelemetryError(error, {
      route: 'server.startup',
      context: {
        surface: 'server',
        phase: 'startup',
      },
    });
    await flushTelemetry(2_000);
    throw error;
  }
}

// CLI entrypoint
if (
  process.env.VITEST !== 'true' &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  startServer().catch((err: unknown) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
