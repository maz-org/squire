export const SENTRY_USAGE_GUARDRAILS_AS_OF = '2026-06-15';

export const SENTRY_USAGE_GUARDRAILS_SOURCES = [
  'https://sentry.io/pricing/',
  'https://docs.sentry.io/pricing/',
  'https://docs.sentry.io/pricing/quotas/',
  'https://docs.sentry.io/pricing/quotas/manage-logs-quota/',
  'https://docs.sentry.io/pricing/quotas/manage-transaction-quota/',
] as const;

export const SENTRY_USAGE_PRICING_SNAPSHOT = {
  asOf: SENTRY_USAGE_GUARDRAILS_AS_OF,
  includedMonthlyVolume: {
    developer: {
      errors: '5k errors',
      logs: '5GB logs',
      spans: '5M spans',
      replays: '50 replays',
      cronMonitors: '1 cron monitor',
      uptimeMonitors: '1 uptime monitor',
    },
    team: {
      errors: '50k errors',
      logs: '5GB logs',
      spans: '5M spans',
      replays: '50 replays',
      cronMonitors: '1 cron monitor',
      uptimeMonitors: '1 uptime monitor',
    },
    business: {
      errors: '50k errors',
      logs: '5GB logs',
      spans: '5M spans',
      replays: '50 replays',
      cronMonitors: '1 cron monitor',
      uptimeMonitors: '1 uptime monitor',
    },
  },
  payAsYouGo: {
    logs: '$0.50/GB',
    applicationMetrics: '$0.50/GB',
    teamSpans: '$0.0000020/span for 5M-100M spans',
    businessSpans: '$0.0000040/span for 5M-100M spans',
    uptimeMonitor: '$1.00/monitor',
    cronMonitor: '$0.78/monitor',
  },
  notes: [
    'Verify pricing in Sentry before changing PAYG budget or reserved volume.',
    'When reserved volume and PAYG budget are exhausted, Sentry drops later data for the billing cycle.',
    'Owners receive quota emails for logs and spans when usage approaches or exceeds included volume.',
  ],
} as const;

export type SentryUsageQuerySurface =
  | 'stats_usage'
  | 'dashboard'
  | 'project_settings'
  | 'org_billing';

export type SentryUsageDataset = 'logs' | 'spans' | 'error-events' | 'billing';

export interface SentryUsageGuardrailQuery {
  name: string;
  surface: SentryUsageQuerySurface;
  dataset: SentryUsageDataset;
  query: string;
  fields: string[];
  purpose: string;
}

export const SENTRY_USAGE_DASHBOARD_QUERIES: readonly SentryUsageGuardrailQuery[] = [
  {
    name: 'squire.usage.logs.accepted_gb',
    surface: 'stats_usage',
    dataset: 'billing',
    query: 'Stats & Usage > Logs > project=maz-squire > accepted log data, shown in GB',
    fields: ['accepted GB', 'dropped GB', 'filtered GB', 'project'],
    purpose: 'Actual billed log volume. Use this for cost checks, not dashboard count proxies.',
  },
  {
    name: 'squire.usage.spans.accepted_count',
    surface: 'stats_usage',
    dataset: 'billing',
    query: 'Stats & Usage > Spans > project=maz-squire > accepted spans',
    fields: ['accepted spans', 'dropped spans', 'filtered spans', 'project'],
    purpose: 'Actual billed span count and dropped span visibility.',
  },
  {
    name: 'squire.usage.logs.count',
    surface: 'dashboard',
    dataset: 'logs',
    query: 'environment:production',
    fields: ['count()'],
    purpose: 'Production log entry trend. Pair with Usage accepted GB for cost.',
  },
  {
    name: 'squire.usage.spans.count',
    surface: 'dashboard',
    dataset: 'spans',
    query: 'environment:production',
    fields: ['count()'],
    purpose: 'Production span count trend.',
  },
  {
    name: 'squire.usage.errors.count',
    surface: 'dashboard',
    dataset: 'error-events',
    query: 'environment:production level:error',
    fields: ['count()'],
    purpose: 'Production error event count trend.',
  },
  {
    name: 'squire.usage.top_log_routes',
    surface: 'dashboard',
    dataset: 'logs',
    query: 'environment:production route:*',
    fields: ['route', 'count()'],
    purpose: 'Highest-volume log routes.',
  },
  {
    name: 'squire.usage.top_log_events',
    surface: 'dashboard',
    dataset: 'logs',
    query: 'environment:production event_type:*',
    fields: ['event_type', 'count()'],
    purpose: 'Highest-volume log event families.',
  },
  {
    name: 'squire.usage.top_span_routes',
    surface: 'dashboard',
    dataset: 'spans',
    query: 'environment:production http.route:*',
    fields: ['http.route', 'count()', 'p95(span.duration)'],
    purpose: 'Highest-volume traced routes and their latency.',
  },
  {
    name: 'squire.usage.top_error_routes',
    surface: 'dashboard',
    dataset: 'error-events',
    query: 'environment:production route:* level:error',
    fields: ['route', 'count()'],
    purpose: 'Highest-volume error routes.',
  },
  {
    name: 'squire.usage.top_security_events',
    surface: 'dashboard',
    dataset: 'logs',
    query: 'environment:production surface:security_log security_event:*',
    fields: ['security_event', 'count()'],
    purpose: 'Highest-volume auth, limiter, and budget accounting log families.',
  },
] as const;

export const SENTRY_USAGE_GUARDRAIL_ACTIONS = [
  {
    name: 'review_sentry_usage',
    owner: 'any member',
    cadence: 'weekly until baseline is known, then monthly',
    path: 'Sentry > Stats & Usage',
    acceptance:
      'Log accepted GB, accepted spans, and dropped/filtered rows are reviewed for maz-squire.',
  },
  {
    name: 'confirm_spend_notifications',
    owner: 'Sentry owner or billing member',
    cadence: 'after setup and after plan changes',
    path: 'Sentry > Settings > Subscription',
    acceptance: 'Owner quota emails and PAYG budget are configured or explicitly left at $0.',
  },
  {
    name: 'tune_trace_sample_rate',
    owner: 'operator',
    cadence: 'only when span volume is too high',
    path: 'Fly secret SENTRY_TRACES_SAMPLE_RATE',
    acceptance: 'Sample rate changes without a code deploy and is noted in the deploy log.',
  },
  {
    name: 'emergency_throttle',
    owner: 'operator',
    cadence: 'only during a runaway event',
    path: 'Fly secret or Sentry project setting',
    acceptance:
      'Throttle is explicit, reversible, and tracked with an owner, reason, start time, and rollback condition.',
  },
] as const;

export const SENTRY_USAGE_FORBIDDEN_COST_CONTROL_TERMS = [
  'cost-based log allowlist',
  'drop info logs for cost',
  'filter safe logs for cost',
  'beforeSendLog returns null for budget',
  'allow only error logs',
] as const;
