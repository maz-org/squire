// Fly's Sentry extension provisioned maz-squire in this Sentry organization.
export const SENTRY_APP_HEALTH_ORG = 'brian-moseley';
export const SENTRY_APP_HEALTH_PROJECT_SLUG = 'maz-squire';
export const SENTRY_APP_HEALTH_PROJECT_ID = '4511564194643969';
export const SENTRY_APP_HEALTH_ENVIRONMENT = 'production';
export const SENTRY_APP_HEALTH_OWNER = 'team:4511564194512896';
export const SENTRY_APP_HEALTH_ROUTING_WORKFLOW_NAME = 'Email #brian-moseley-team';
export const SENTRY_APP_HEALTH_DASHBOARD_TITLE = 'Squire - Production App Health';

export const SENTRY_APP_HEALTH_AREAS = [
  'backend_errors',
  'backend_latency',
  'chat_failures',
  'chat_latency',
  'browser_errors',
  'browser_stream_transport',
  'cron_script_failures',
  'uptime',
  'deploy_regressions',
  'auth_rate_limit_anomalies',
  'budget_accounting_failures',
] as const;

export type SentryAppHealthArea = (typeof SENTRY_APP_HEALTH_AREAS)[number];

type DashboardDisplayType = 'area' | 'bar' | 'big_number' | 'line' | 'table';
type DashboardWidgetType = 'error-events' | 'logs' | 'spans';
type DetectorDataset = 'events' | 'events_analytics_platform';
type DetectorEventType = 'default' | 'error' | 'trace_item_log' | 'trace_item_span';

export interface DashboardWidgetQuery {
  aggregates: string[];
  columns: string[];
  conditions: string;
  fieldAliases?: string[];
  fields: string[];
  name: string;
  orderby: string;
}

export interface DashboardWidgetPayload {
  title: string;
  description: string;
  displayType: DashboardDisplayType;
  interval: string;
  widgetType: DashboardWidgetType;
  limit?: number;
  layout: {
    h: number;
    minH: number;
    w: number;
    x: number;
    y: number;
  };
  queries: DashboardWidgetQuery[];
}

export interface SentryAppHealthDashboardWidget extends DashboardWidgetPayload {
  areas: SentryAppHealthArea[];
  savedQueryName: string;
}

export interface SentryAppHealthMonitor {
  areas: SentryAppHealthArea[];
  aggregate: string;
  comparison: number;
  dataset: DetectorDataset;
  description: string;
  eventTypes: DetectorEventType[];
  firstAction: string;
  name: string;
  query: string;
  routeTo: string;
  safeTest: string;
  timeWindowSeconds: number;
  threshold: string;
  workflowName: string;
}

export interface SentryExistingAppHealthAlert {
  areas: SentryAppHealthArea[];
  firstAction: string;
  name: string;
  query: string;
  routeTo: string;
  safeTest: string;
  threshold: string;
}

export const SENTRY_APP_HEALTH_FORBIDDEN_QUERY_TERMS = [
  'answer',
  'completion',
  'cookie',
  'email',
  'model_output',
  'password',
  'prompt',
  'provider_payload',
  'raw_source',
  'retrieved_passage',
  'secret',
  'source_passage',
  'token',
  'transcript',
] as const;

function query(
  name: string,
  conditions: string,
  aggregates: string[],
  columns: string[] = [],
  orderby = aggregates[0] ?? '',
): DashboardWidgetQuery {
  return {
    name,
    conditions,
    fields: [...columns, ...aggregates],
    aggregates,
    columns,
    orderby,
    fieldAliases: [...columns, ...aggregates].map(() => ''),
  };
}

function layout(index: number, h = 2): DashboardWidgetPayload['layout'] {
  return {
    x: index % 2 === 0 ? 0 : 3,
    y: Math.floor(index / 2) * 2,
    w: 3,
    h,
    minH: h,
  };
}

function widget(input: {
  areas: SentryAppHealthArea[];
  description: string;
  displayType: DashboardDisplayType;
  index: number;
  limit?: number;
  queries: DashboardWidgetQuery[];
  savedQueryName: string;
  title: string;
  widgetType: DashboardWidgetType;
}): SentryAppHealthDashboardWidget {
  return {
    areas: input.areas,
    title: input.title,
    description: input.description,
    displayType: input.displayType,
    interval: '5m',
    widgetType: input.widgetType,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    layout: layout(input.index),
    queries: input.queries,
    savedQueryName: input.savedQueryName,
  };
}

export const SENTRY_APP_HEALTH_DASHBOARD_WIDGETS: SentryAppHealthDashboardWidget[] = [
  widget({
    index: 0,
    title: 'Backend errors',
    savedQueryName: 'squire.backend.errors',
    description: 'Server-side production error events by route and request id.',
    areas: ['backend_errors'],
    widgetType: 'error-events',
    displayType: 'line',
    queries: [
      query('Backend errors', 'environment:production surface:server level:error', ['count()']),
    ],
  }),
  widget({
    index: 1,
    title: 'Backend request latency p95',
    savedQueryName: 'squire.backend.latency.p95',
    description: 'HTTP request span latency from Hono request lifecycle spans.',
    areas: ['backend_latency'],
    widgetType: 'spans',
    displayType: 'line',
    queries: [
      query('Backend p95', 'environment:production http.route:* squire.request_id:*', [
        'p95(span.duration)',
      ]),
    ],
  }),
  widget({
    index: 2,
    title: 'Chat and SSE failures',
    savedQueryName: 'squire.chat.failures',
    description: 'Chat lifecycle log errors for SSE and API ask paths.',
    areas: ['chat_failures'],
    widgetType: 'logs',
    displayType: 'area',
    queries: [
      query('Chat failures', 'environment:production surface:[chat_sse,api_ask] status:error', [
        'count()',
      ]),
    ],
  }),
  widget({
    index: 3,
    title: 'Chat and SSE latency p95',
    savedQueryName: 'squire.chat.latency.p95',
    description: 'Chat stream and API ask app span duration.',
    areas: ['chat_latency'],
    widgetType: 'spans',
    displayType: 'line',
    queries: [
      query('Chat p95', 'environment:production squire.surface:[chat_sse,api_ask]', [
        'p95(span.duration)',
      ]),
    ],
  }),
  widget({
    index: 4,
    title: 'Browser errors',
    savedQueryName: 'squire.browser.errors',
    description: 'Browser error events and unhandled rejections.',
    areas: ['browser_errors'],
    widgetType: 'error-events',
    displayType: 'line',
    queries: [
      query('Browser errors', 'environment:production surface:browser level:error', ['count()']),
    ],
  }),
  widget({
    index: 5,
    title: 'Browser stream transport failures',
    savedQueryName: 'squire.browser.stream_transport',
    description: 'Browser EventSource transport failures with stream counters.',
    areas: ['browser_stream_transport'],
    widgetType: 'logs',
    displayType: 'bar',
    queries: [
      query(
        'Transport failures',
        'environment:production surface:browser event_type:browser_stream_error stream_error_kind:transport',
        ['count()'],
      ),
    ],
  }),
  widget({
    index: 6,
    title: 'Cron and release command failures',
    savedQueryName: 'squire.scripts.failures',
    description: 'Script lifecycle errors from cron, release commands, and manual migrations.',
    areas: ['cron_script_failures'],
    widgetType: 'logs',
    displayType: 'area',
    queries: [
      query(
        'Script failures',
        'environment:production event_type:script.lifecycle job_kind:[cron,release_command,manual_migration] status:error',
        ['count()'],
      ),
    ],
  }),
  widget({
    index: 7,
    title: 'Deploy regression errors',
    savedQueryName: 'squire.deploy.regressions',
    description: 'Production errors grouped by release for deploy regression triage.',
    areas: ['deploy_regressions'],
    widgetType: 'error-events',
    displayType: 'table',
    limit: 10,
    queries: [
      query(
        'Errors by release',
        'environment:production release:* level:error',
        ['count()'],
        ['release', 'title'],
        '-count()',
      ),
    ],
  }),
  widget({
    index: 8,
    title: 'Auth and rate-limit anomalies',
    savedQueryName: 'squire.security.auth_rate_limit',
    description: 'Structured security logs for auth denials and rate-limit pressure.',
    areas: ['auth_rate_limit_anomalies'],
    widgetType: 'logs',
    displayType: 'bar',
    queries: [
      query(
        'Auth/rate-limit anomalies',
        'environment:production surface:security_log security_event:[rate_limit_rejected,rate_limit_unavailable,google_login_denied]',
        ['count()'],
      ),
    ],
  }),
  widget({
    index: 9,
    title: 'Budget and accounting failures',
    savedQueryName: 'squire.budget.accounting',
    description: 'LLM budget warnings and accounting failures from structured logs.',
    areas: ['budget_accounting_failures'],
    widgetType: 'logs',
    displayType: 'line',
    queries: [
      query(
        'Budget/accounting failures',
        'environment:production surface:security_log security_event:[llm_budget_accounting_failed,llm_budget_warning]',
        ['count()'],
      ),
    ],
  }),
];

export const SENTRY_APP_HEALTH_MONITORS: SentryAppHealthMonitor[] = [
  {
    name: 'Squire production backend request p95 latency',
    workflowName: SENTRY_APP_HEALTH_ROUTING_WORKFLOW_NAME,
    areas: ['backend_latency'],
    dataset: 'events_analytics_platform',
    eventTypes: ['trace_item_span'],
    query: 'environment:production http.route:* squire.request_id:*',
    aggregate: 'p95(span.duration)',
    comparison: 2500,
    threshold: 'p95(span.duration) > 2500ms for 10 minutes',
    timeWindowSeconds: 600,
    routeTo: 'team:4511564194512896 email',
    firstAction: 'Open the slow span, group by http.route, then inspect Sentry logs by request_id.',
    safeTest: 'Run one backend safe test after deploy and verify request lifecycle spans exist.',
    description:
      'Detects production server request latency before it becomes a user-visible error.',
  },
  {
    name: 'Squire production chat/SSE p95 latency',
    workflowName: SENTRY_APP_HEALTH_ROUTING_WORKFLOW_NAME,
    areas: ['chat_latency'],
    dataset: 'events_analytics_platform',
    eventTypes: ['trace_item_span'],
    query: 'environment:production squire.surface:[chat_sse,api_ask]',
    aggregate: 'p95(span.duration)',
    comparison: 15000,
    threshold: 'p95(span.duration) > 15000ms for 10 minutes',
    timeWindowSeconds: 600,
    routeTo: 'team:4511564194512896 email',
    firstAction:
      'Open the slow span, copy conversation_id/user_message_id, then jump to LangSmith.',
    safeTest: 'Run a safe chat test and verify the chat span links to LangSmith by IDs.',
    description: 'Detects slow chat streams while LangSmith remains the AI trace owner.',
  },
  {
    name: 'Squire production chat/SSE log failure spike',
    workflowName: SENTRY_APP_HEALTH_ROUTING_WORKFLOW_NAME,
    areas: ['chat_failures'],
    dataset: 'events_analytics_platform',
    eventTypes: ['trace_item_log'],
    query: 'environment:production surface:[chat_sse,api_ask] status:error',
    aggregate: 'count()',
    comparison: 3,
    threshold: 'more than 3 chat lifecycle error logs in 10 minutes',
    timeWindowSeconds: 600,
    routeTo: 'team:4511564194512896 email',
    firstAction:
      'Open matching logs, copy request_id and conversation_id, then inspect the linked error event.',
    safeTest: 'npm run sentry:test-event -- --kind chat',
    description: 'Catches chat failures that are visible in logs even when error grouping changes.',
  },
  {
    name: 'Squire production browser stream transport failures',
    workflowName: SENTRY_APP_HEALTH_ROUTING_WORKFLOW_NAME,
    areas: ['browser_stream_transport'],
    dataset: 'events_analytics_platform',
    eventTypes: ['trace_item_log'],
    query:
      'environment:production surface:browser event_type:browser_stream_error stream_error_kind:transport',
    aggregate: 'count()',
    comparison: 3,
    threshold: 'more than 3 browser stream transport failures in 10 minutes',
    timeWindowSeconds: 600,
    routeTo: 'team:4511564194512896 email',
    firstAction: 'Open logs and masked replay, then inspect stream counters and release.',
    safeTest: 'Run the browser telemetry smoke on a safe masked page.',
    description: 'Catches EventSource transport failures separately from browser exceptions.',
  },
  {
    name: 'Squire production script failure log spike',
    workflowName: SENTRY_APP_HEALTH_ROUTING_WORKFLOW_NAME,
    areas: ['cron_script_failures'],
    dataset: 'events_analytics_platform',
    eventTypes: ['trace_item_log'],
    query:
      'environment:production event_type:script.lifecycle job_kind:[cron,release_command,manual_migration] status:error',
    aggregate: 'count()',
    comparison: 0,
    threshold: 'any script lifecycle error log in 30 minutes',
    timeWindowSeconds: 1800,
    routeTo: 'team:4511564194512896 email',
    firstAction:
      'Open the script log, copy job_name/job_kind, then inspect the matching Fly process.',
    safeTest: 'npm run sentry:test-event -- --kind cron',
    description: 'Detects failures from Supercronic, release commands, and migration scripts.',
  },
  {
    name: 'Squire production auth/rate-limit anomaly spike',
    workflowName: SENTRY_APP_HEALTH_ROUTING_WORKFLOW_NAME,
    areas: ['auth_rate_limit_anomalies'],
    dataset: 'events_analytics_platform',
    eventTypes: ['trace_item_log'],
    query:
      'environment:production surface:security_log security_event:[rate_limit_rejected,rate_limit_unavailable,google_login_denied]',
    aggregate: 'count()',
    comparison: 20,
    threshold: 'more than 20 auth/rate-limit security logs in 10 minutes',
    timeWindowSeconds: 600,
    routeTo: 'team:4511564194512896 email',
    firstAction:
      'Open security logs by security_event and route, then check whether the rate limiter is unavailable.',
    safeTest: 'Use dry-run security logs locally; do not generate production auth floods.',
    description: 'Uses structured security logs as app-health signals without storing PII.',
  },
  {
    name: 'Squire production budget/accounting failure',
    workflowName: SENTRY_APP_HEALTH_ROUTING_WORKFLOW_NAME,
    areas: ['budget_accounting_failures'],
    dataset: 'events_analytics_platform',
    eventTypes: ['trace_item_log'],
    query:
      'environment:production surface:security_log security_event:[llm_budget_accounting_failed,llm_budget_warning]',
    aggregate: 'count()',
    comparison: 0,
    threshold: 'any budget warning or accounting failure log in 30 minutes',
    timeWindowSeconds: 1800,
    routeTo: 'team:4511564194512896 email',
    firstAction: 'Open budget logs, inspect model and budget_day, then check the ledger table.',
    safeTest: 'Run the API E2E budget smoke in a non-production environment.',
    description: 'Alerts on budget accounting failures and spend warnings from structured logs.',
  },
];

export const SENTRY_EXISTING_APP_HEALTH_ALERTS: SentryExistingAppHealthAlert[] = [
  {
    name: 'Squire production backend error spike',
    areas: ['backend_errors'],
    query: 'environment:production surface:server level:error',
    threshold: '5 events in 10 minutes',
    routeTo: 'team:4511564194512896 email',
    firstAction: 'Open the issue, copy request_id, inspect route/context, then check request logs.',
    safeTest: 'npm run sentry:test-event -- --kind backend',
  },
  {
    name: 'Squire production chat/SSE failure spike',
    areas: ['chat_failures'],
    query: 'environment:production failure_kind:assistant_turn level:error',
    threshold: '3 events in 10 minutes',
    routeTo: 'team:4511564194512896 email',
    firstAction: 'Open Sentry event, then jump to LangSmith by conversation and turn ids.',
    safeTest: 'npm run sentry:test-event -- --kind chat',
  },
  {
    name: 'Squire production frontend error spike',
    areas: ['browser_errors'],
    query: 'environment:production surface:browser event_type:browser_error level:error',
    threshold: '5 events in 10 minutes',
    routeTo: 'team:4511564194512896 email',
    firstAction: 'Open event/replay and verify masked replay has no transcript text.',
    safeTest: 'npm run sentry:test-event -- --kind browser',
  },
  {
    name: 'Squire production cron/job failure',
    areas: ['cron_script_failures'],
    query: 'environment:production job_kind:cron level:error',
    threshold: '1 event in 30 minutes',
    routeTo: 'team:4511564194512896 email',
    firstAction: 'Check job_name, then inspect script logs and Fly timeline.',
    safeTest: 'npm run sentry:test-event -- --kind cron',
  },
  {
    name: 'Squire production deploy regression new issue',
    areas: ['deploy_regressions'],
    query: 'environment:production release:* level:error',
    threshold: '1 new issue in the current release window',
    routeTo: 'team:4511564194512896 email',
    firstAction:
      'Compare release SHA with GitHub/Fly deploy and roll back only after confirming the current release fault.',
    safeTest: 'npm run sentry:test-event -- --kind deploy-regression',
  },
  {
    name: 'Squire production uptime failure',
    areas: ['uptime'],
    query: 'https://squire.maz.org/api/health expects HTTP 200 and JSON status ok',
    threshold: '2 failed checks in 5 minutes',
    routeTo: 'team:4511564194512896 email',
    firstAction:
      'Open the uptime monitor, compare /api/health and /api/live, then check Fly status.',
    safeTest:
      'Use Sentry monitor test or a temporary duplicate monitor pointed at /api/__sentry-uptime-test-404.',
  },
];

export function appHealthDashboardPayload(): {
  environment: string[];
  filters: Record<string, unknown>;
  is_favorited: boolean;
  period: string;
  projects: number[];
  title: string;
  utc: boolean;
  widgets: DashboardWidgetPayload[];
} {
  return {
    title: SENTRY_APP_HEALTH_DASHBOARD_TITLE,
    projects: [Number(SENTRY_APP_HEALTH_PROJECT_ID)],
    environment: [SENTRY_APP_HEALTH_ENVIRONMENT],
    period: '24h',
    filters: {},
    utc: true,
    is_favorited: true,
    widgets: SENTRY_APP_HEALTH_DASHBOARD_WIDGETS.map(
      ({ areas: _areas, savedQueryName: _name, ...payload }) => payload,
    ),
  };
}

export function appHealthDetectorPayload(
  monitor: SentryAppHealthMonitor,
  workflowIds: string[] = [],
): Record<string, unknown> {
  return {
    name: monitor.name,
    type: 'metric_issue',
    owner: SENTRY_APP_HEALTH_OWNER,
    ...(workflowIds.length > 0 ? { workflow_ids: workflowIds } : {}),
    description: monitor.description,
    enabled: true,
    data_sources: [
      {
        queryType: 1,
        dataset: monitor.dataset,
        query: monitor.query,
        aggregate: monitor.aggregate,
        timeWindow: monitor.timeWindowSeconds,
        environment: SENTRY_APP_HEALTH_ENVIRONMENT,
        eventTypes: monitor.eventTypes,
        extrapolationMode: 'unknown',
      },
    ],
    config: {
      detectionType: 'static',
      comparisonDelta: null,
    },
    condition_group: {
      logicType: 'any',
      conditions: [
        {
          type: 'gt',
          comparison: monitor.comparison,
          conditionResult: 75,
        },
        {
          type: 'lte',
          comparison: monitor.comparison,
          conditionResult: 0,
        },
      ],
      actions: [],
    },
  };
}

export function sentryDashboardUrl(dashboardId: string): string {
  return `https://${SENTRY_APP_HEALTH_ORG}.sentry.io/dashboard/${dashboardId}/?project=${SENTRY_APP_HEALTH_PROJECT_ID}&environment=${SENTRY_APP_HEALTH_ENVIRONMENT}`;
}

export function sentryDetectorUrl(detectorId: string): string {
  return `https://${SENTRY_APP_HEALTH_ORG}.sentry.io/alerts/rules/details/${detectorId}/?project=${SENTRY_APP_HEALTH_PROJECT_ID}`;
}
