import {
  SENTRY_APP_HEALTH_DASHBOARD_TITLE,
  SENTRY_APP_HEALTH_MONITORS,
  SENTRY_APP_HEALTH_ORG,
  SENTRY_APP_HEALTH_PROJECT_SLUG,
  SENTRY_APP_HEALTH_ROUTING_WORKFLOW_NAME,
  SENTRY_APP_HEALTH_DASHBOARD_WIDGETS,
  SENTRY_EXISTING_APP_HEALTH_ALERTS,
  appHealthDashboardPayload,
  appHealthDetectorPayload,
  sentryDashboardUrl,
  sentryDetectorUrl,
} from './sentry-app-health-config.ts';
import { pathToFileURL } from 'node:url';

type Mode = 'apply' | 'dry-run' | 'verify';

interface SentryRecord {
  id?: unknown;
  name?: unknown;
  title?: unknown;
}

interface SentryListClient {
  list(path: string): Promise<unknown[]>;
}

interface SyncResult {
  dashboard?: {
    action: 'created' | 'updated' | 'verified' | 'would_create' | 'would_update';
    id?: string;
    title: string;
    url?: string;
    widgetCount: number;
  };
  detectors: Array<{
    action: 'created' | 'updated' | 'verified' | 'would_create' | 'would_update';
    id?: string;
    name: string;
    url?: string;
    workflowName?: string;
  }>;
  existingAlerts: Array<{
    found: boolean;
    id?: string;
    name: string;
  }>;
}

const API_BASE = 'https://sentry.io/api/0';

function usage(): string {
  return 'Usage: node scripts/sync-sentry-app-health.ts --dry-run | --apply | --verify';
}

function parseMode(argv: string[]): Mode {
  const modes = argv.filter(
    (arg) => arg === '--dry-run' || arg === '--apply' || arg === '--verify',
  );
  // Keep CLI input strict so automation fails loudly when a flag is mistyped.
  if (modes.length !== 1 || argv.length !== 1) throw new Error(usage());
  if (modes[0] === '--apply') return 'apply';
  if (modes[0] === '--verify') return 'verify';
  return 'dry-run';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, field: 'id' | 'name' | 'title'): string | undefined {
  if (!isRecord(value)) return undefined;
  const candidate = value[field];
  if (typeof candidate === 'string') return candidate;
  if (typeof candidate === 'number') return String(candidate);
  return undefined;
}

function named(records: unknown[], name: string): SentryRecord | undefined {
  return records.find((record) => stringField(record, 'name') === name) as SentryRecord | undefined;
}

function namedOrTitled(records: unknown[], name: string): SentryRecord | undefined {
  return records.find(
    (record) => stringField(record, 'name') === name || stringField(record, 'title') === name,
  ) as SentryRecord | undefined;
}

function titled(records: unknown[], title: string): SentryRecord | undefined {
  return records.find((record) => stringField(record, 'title') === title) as
    | SentryRecord
    | undefined;
}

function stringArrayField(value: unknown, field: string): string[] {
  if (!isRecord(value)) return [];
  const candidate = value[field];
  return Array.isArray(candidate)
    ? candidate.flatMap((item) => {
        if (typeof item === 'string') return [item];
        if (typeof item === 'number') return [String(item)];
        return [];
      })
    : [];
}

function arrayField(value: unknown, ...fields: string[]): unknown[] {
  if (!isRecord(value)) return [];
  for (const field of fields) {
    const candidate = value[field];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function recordField(value: unknown, ...fields: string[]): Record<string, unknown> {
  if (!isRecord(value)) return {};
  for (const field of fields) {
    const candidate = value[field];
    if (isRecord(candidate)) return candidate;
  }
  return {};
}

function numberField(value: unknown, field: string): number | undefined {
  if (!isRecord(value)) return undefined;
  const candidate = value[field];
  if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  if (typeof candidate === 'string' && candidate.trim() !== '') {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function booleanField(value: unknown, field: string): boolean | undefined {
  if (!isRecord(value)) return undefined;
  const candidate = value[field];
  return typeof candidate === 'boolean' ? candidate : undefined;
}

function optionalStringField(value: unknown, field: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const candidate = value[field];
  return typeof candidate === 'string' ? candidate : undefined;
}

function normalizeDashboardQuery(query: unknown): Record<string, unknown> {
  return {
    name: optionalStringField(query, 'name'),
    conditions: optionalStringField(query, 'conditions'),
    fields: stringArrayField(query, 'fields'),
    aggregates: stringArrayField(query, 'aggregates'),
    columns: stringArrayField(query, 'columns'),
    orderby: optionalStringField(query, 'orderby'),
    fieldAliases: stringArrayField(query, 'fieldAliases'),
  };
}

function normalizeDashboardWidget(widget: unknown): Record<string, unknown> {
  const limit = numberField(widget, 'limit');
  return {
    title: optionalStringField(widget, 'title'),
    description: optionalStringField(widget, 'description'),
    displayType: optionalStringField(widget, 'displayType'),
    interval: optionalStringField(widget, 'interval'),
    widgetType: optionalStringField(widget, 'widgetType'),
    ...(limit === undefined ? {} : { limit }),
    layout: {
      h: numberField(recordField(widget, 'layout'), 'h'),
      minH: numberField(recordField(widget, 'layout'), 'minH'),
      w: numberField(recordField(widget, 'layout'), 'w'),
      x: numberField(recordField(widget, 'layout'), 'x'),
      y: numberField(recordField(widget, 'layout'), 'y'),
    },
    queries: arrayField(widget, 'queries').map(normalizeDashboardQuery),
  };
}

function normalizeDetectorDataSource(dataSource: unknown): Record<string, unknown> {
  const queryObject = recordField(recordField(dataSource, 'queryObj'), 'snubaQuery');
  const source = Object.keys(queryObject).length > 0 ? queryObject : dataSource;
  return {
    dataset: optionalStringField(source, 'dataset'),
    query: optionalStringField(source, 'query'),
    aggregate: optionalStringField(source, 'aggregate'),
    timeWindow: numberField(source, 'timeWindow'),
    environment: optionalStringField(source, 'environment'),
    eventTypes: stringArrayField(source, 'eventTypes'),
    extrapolationMode: optionalStringField(source, 'extrapolationMode'),
  };
}

function normalizeDetectorCondition(condition: unknown): Record<string, unknown> {
  return {
    type: optionalStringField(condition, 'type'),
    comparison: numberField(condition, 'comparison'),
    conditionResult: numberField(condition, 'conditionResult'),
  };
}

function normalizeOwner(owner: unknown): string | undefined {
  if (typeof owner === 'string') return owner;
  const ownerType = optionalStringField(owner, 'type');
  const ownerId = optionalStringField(owner, 'id');
  if (ownerType && ownerId) return `${ownerType}:${ownerId}`;
  return undefined;
}

function normalizeDetectorPayload(detector: unknown): Record<string, unknown> {
  const conditionGroup = recordField(detector, 'condition_group', 'conditionGroup');
  return {
    name: optionalStringField(detector, 'name'),
    type: optionalStringField(detector, 'type'),
    owner: normalizeOwner(recordField(detector, 'owner')) ?? optionalStringField(detector, 'owner'),
    description: optionalStringField(detector, 'description'),
    enabled: booleanField(detector, 'enabled'),
    data_sources: arrayField(detector, 'data_sources', 'dataSources').map(
      normalizeDetectorDataSource,
    ),
    config: {
      detectionType: optionalStringField(recordField(detector, 'config'), 'detectionType'),
      comparisonDelta: recordField(detector, 'config').comparisonDelta ?? null,
    },
    condition_group: {
      logicType: optionalStringField(conditionGroup, 'logicType'),
      conditions: arrayField(conditionGroup, 'conditions').map(normalizeDetectorCondition),
    },
  };
}

function formatMismatchValue(value: unknown): string {
  return JSON.stringify(value);
}

function firstMismatch(actual: unknown, expected: unknown, path: string): string | undefined {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return `${path}: expected array, got ${formatMismatchValue(actual)}`;
    }
    if (actual.length !== expected.length) {
      return `${path}: expected ${expected.length} entries, got ${actual.length}`;
    }
    for (let index = 0; index < expected.length; index += 1) {
      const mismatch = firstMismatch(actual[index], expected[index], `${path}.${index}`);
      if (mismatch) return mismatch;
    }
    return undefined;
  }

  if (isRecord(expected)) {
    if (!isRecord(actual)) {
      return `${path}: expected object, got ${formatMismatchValue(actual)}`;
    }
    for (const key of Object.keys(expected).sort()) {
      const mismatch = firstMismatch(actual[key], expected[key], `${path}.${key}`);
      if (mismatch) return mismatch;
    }
    return undefined;
  }

  if (!Object.is(actual, expected)) {
    return `${path}: expected ${formatMismatchValue(expected)}, got ${formatMismatchValue(actual)}`;
  }
  return undefined;
}

export function assertDashboardMatchesExpected(
  actual: unknown,
  expected: ReturnType<typeof appHealthDashboardPayload>,
  dashboardTitle = SENTRY_APP_HEALTH_DASHBOARD_TITLE,
): void {
  const actualShape = {
    title: optionalStringField(actual, 'title'),
    widgets: arrayField(actual, 'widgets').map(normalizeDashboardWidget),
  };
  const expectedShape = {
    title: expected.title,
    widgets: expected.widgets.map(normalizeDashboardWidget),
  };
  const mismatch = firstMismatch(actualShape, expectedShape, '$');
  if (mismatch) {
    throw new Error(
      `Sentry dashboard does not match checked-in config (${dashboardTitle}): ${mismatch}`,
    );
  }
}

export function assertDetectorMatchesExpected(
  actual: unknown,
  expected: Record<string, unknown>,
  detectorName: string,
): void {
  const mismatch = firstMismatch(
    normalizeDetectorPayload(actual),
    normalizeDetectorPayload(expected),
    '$',
  );
  if (mismatch) {
    throw new Error(
      `Sentry detector does not match checked-in config (${detectorName}): ${mismatch}`,
    );
  }
}

function findRoutingWorkflowId(workflows: unknown[]): string {
  const workflow = named(workflows, SENTRY_APP_HEALTH_ROUTING_WORKFLOW_NAME);
  const workflowId = stringField(workflow, 'id');
  if (!workflowId) {
    throw new Error(`Missing Sentry workflow: ${SENTRY_APP_HEALTH_ROUTING_WORKFLOW_NAME}`);
  }
  return workflowId;
}

function pathWithListPageSize(path: string): string {
  const url = new URL(path, API_BASE);
  if (!url.searchParams.has('per_page')) url.searchParams.set('per_page', '100');
  return `${url.pathname}${url.search}`;
}

export function parseSentryNextPath(linkHeader: string | null): string | undefined {
  if (!linkHeader) return undefined;

  for (const part of linkHeader.split(/,\s*(?=<)/)) {
    if (!/\brel="next"/.test(part) || !/\bresults="true"/.test(part)) continue;
    const urlMatch = part.match(/<([^>]+)>/);
    if (!urlMatch) continue;
    try {
      const url = new URL(urlMatch[1] ?? '');
      const apiBasePath = new URL(API_BASE).pathname;
      const relativePath = url.pathname.startsWith(`${apiBasePath}/`)
        ? url.pathname.slice(apiBasePath.length)
        : url.pathname;
      return `${relativePath}${url.search}`;
    } catch {
      continue;
    }
  }

  return undefined;
}

class SentryApi {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async requestWithResponse<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<{ body: T; headers: Headers }> {
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    headers.set('Accept', 'application/json');
    if (options.body) headers.set('Content-Type', 'application/json');

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `${options.method ?? 'GET'} ${path} failed with ${response.status}: ${text.slice(0, 800)}`,
      );
    }
    return {
      body: (text.length > 0 ? JSON.parse(text) : null) as T,
      headers: response.headers,
    };
  }

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    return (await this.requestWithResponse<T>(path, options)).body;
  }

  async list(path: string): Promise<unknown[]> {
    const records: unknown[] = [];
    const seenPaths = new Set<string>();
    let nextPath: string | undefined = pathWithListPageSize(path);

    while (nextPath) {
      if (seenPaths.has(nextPath)) throw new Error(`Sentry pagination loop for ${path}`);
      seenPaths.add(nextPath);

      const { body, headers } = await this.requestWithResponse<unknown>(nextPath);
      if (Array.isArray(body)) {
        records.push(...body);
      } else if (isRecord(body) && Array.isArray(body.results)) {
        records.push(...body.results);
      } else {
        throw new Error(`Expected Sentry list response for ${path}`);
      }
      nextPath = parseSentryNextPath(headers.get('link'));
    }

    return records;
  }
}

async function syncDashboard(api: SentryApi, mode: Mode): Promise<SyncResult['dashboard']> {
  const dashboards = await api.list(`/organizations/${SENTRY_APP_HEALTH_ORG}/dashboards/`);
  const existing = titled(dashboards, SENTRY_APP_HEALTH_DASHBOARD_TITLE);
  const existingId = stringField(existing, 'id');
  const payload = appHealthDashboardPayload();

  if (mode === 'verify') {
    if (!existingId)
      throw new Error(`Missing Sentry dashboard: ${SENTRY_APP_HEALTH_DASHBOARD_TITLE}`);
    const detail = await api.request<unknown>(
      `/organizations/${SENTRY_APP_HEALTH_ORG}/dashboards/${existingId}/`,
    );
    assertDashboardMatchesExpected(detail, payload);
    return {
      action: 'verified',
      id: existingId,
      title: SENTRY_APP_HEALTH_DASHBOARD_TITLE,
      url: sentryDashboardUrl(existingId),
      widgetCount: SENTRY_APP_HEALTH_DASHBOARD_WIDGETS.length,
    };
  }

  if (mode === 'dry-run') {
    return {
      action: existingId ? 'would_update' : 'would_create',
      id: existingId,
      title: SENTRY_APP_HEALTH_DASHBOARD_TITLE,
      ...(existingId ? { url: sentryDashboardUrl(existingId) } : {}),
      widgetCount: payload.widgets.length,
    };
  }

  const saved = existingId
    ? await api.request<SentryRecord>(
        `/organizations/${SENTRY_APP_HEALTH_ORG}/dashboards/${existingId}/`,
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        },
      )
    : await api.request<SentryRecord>(`/organizations/${SENTRY_APP_HEALTH_ORG}/dashboards/`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
  const id = stringField(saved, 'id') ?? existingId;
  if (!id)
    throw new Error(
      `Sentry did not return a dashboard id for ${SENTRY_APP_HEALTH_DASHBOARD_TITLE}`,
    );

  return {
    action: existingId ? 'updated' : 'created',
    id,
    title: SENTRY_APP_HEALTH_DASHBOARD_TITLE,
    url: sentryDashboardUrl(id),
    widgetCount: payload.widgets.length,
  };
}

async function syncDetectors(api: SentryApi, mode: Mode): Promise<SyncResult['detectors']> {
  const detectors = await api.list(`/organizations/${SENTRY_APP_HEALTH_ORG}/detectors/`);
  const workflows = await api.list(`/organizations/${SENTRY_APP_HEALTH_ORG}/workflows/`);
  const routingWorkflowId = findRoutingWorkflowId(workflows);
  const results: SyncResult['detectors'] = [];

  for (const monitor of SENTRY_APP_HEALTH_MONITORS) {
    const existing = named(detectors, monitor.name);
    const existingId = stringField(existing, 'id');
    if (mode === 'verify') {
      if (!existingId) throw new Error(`Missing Sentry detector: ${monitor.name}`);
      const detectorDetail = await api.request<unknown>(
        `/organizations/${SENTRY_APP_HEALTH_ORG}/detectors/${existingId}/`,
      );
      const workflowIds = [
        ...stringArrayField(existing, 'workflowIds'),
        ...stringArrayField(existing, 'workflow_ids'),
        ...stringArrayField(detectorDetail, 'workflowIds'),
        ...stringArrayField(detectorDetail, 'workflow_ids'),
      ];
      if (!workflowIds.includes(routingWorkflowId)) {
        throw new Error(
          `Sentry detector is not routed to ${SENTRY_APP_HEALTH_ROUTING_WORKFLOW_NAME}: ${monitor.name}`,
        );
      }
      assertDetectorMatchesExpected(
        detectorDetail,
        appHealthDetectorPayload(monitor, [routingWorkflowId]),
        monitor.name,
      );
      results.push({
        action: 'verified',
        id: existingId,
        name: monitor.name,
        url: sentryDetectorUrl(existingId),
        workflowName: monitor.workflowName,
      });
      continue;
    }

    if (mode === 'dry-run') {
      results.push({
        action: existingId ? 'would_update' : 'would_create',
        id: existingId,
        name: monitor.name,
        ...(existingId ? { url: sentryDetectorUrl(existingId) } : {}),
        workflowName: monitor.workflowName,
      });
      continue;
    }

    const detectorPayload = appHealthDetectorPayload(monitor, [routingWorkflowId]);
    const savedDetector = existingId
      ? await api.request<SentryRecord>(
          `/organizations/${SENTRY_APP_HEALTH_ORG}/detectors/${existingId}/`,
          {
            method: 'PUT',
            body: JSON.stringify(detectorPayload),
          },
        )
      : await api.request<SentryRecord>(
          `/organizations/${SENTRY_APP_HEALTH_ORG}/projects/${SENTRY_APP_HEALTH_PROJECT_SLUG}/detectors/`,
          {
            method: 'POST',
            body: JSON.stringify(detectorPayload),
          },
        );
    const detectorId = stringField(savedDetector, 'id') ?? existingId;
    if (!detectorId) throw new Error(`Sentry did not return a detector id for ${monitor.name}`);

    results.push({
      action: existingId ? 'updated' : 'created',
      id: detectorId,
      name: monitor.name,
      url: sentryDetectorUrl(detectorId),
      workflowName: monitor.workflowName,
    });
  }

  return results;
}

export async function verifyExistingAlerts(
  api: SentryListClient,
): Promise<SyncResult['existingAlerts']> {
  const detectors = await api.list(`/organizations/${SENTRY_APP_HEALTH_ORG}/detectors/`);
  const workflows = await api.list(`/organizations/${SENTRY_APP_HEALTH_ORG}/workflows/`);
  const alertRules = await api.list(`/organizations/${SENTRY_APP_HEALTH_ORG}/alert-rules/`);
  const uptimeAlerts = await api.list(`/organizations/${SENTRY_APP_HEALTH_ORG}/uptime/`);
  const searchableAlerts = [...detectors, ...workflows, ...alertRules, ...uptimeAlerts];

  return SENTRY_EXISTING_APP_HEALTH_ALERTS.map((alert) => {
    const match = namedOrTitled(searchableAlerts, alert.name);
    const id = stringField(match, 'id');
    return {
      found: id !== undefined,
      ...(id ? { id } : {}),
      name: alert.name,
    };
  });
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  if (mode === 'dry-run') {
    const payload = appHealthDashboardPayload();
    console.log(
      JSON.stringify(
        {
          mode,
          dashboard: {
            title: payload.title,
            widgetCount: payload.widgets.length,
            savedQueries: SENTRY_APP_HEALTH_DASHBOARD_WIDGETS.map(
              (widget) => widget.savedQueryName,
            ),
          },
          monitors: SENTRY_APP_HEALTH_MONITORS.map((monitor) => ({
            name: monitor.name,
            dataset: monitor.dataset,
            eventTypes: monitor.eventTypes,
            aggregate: monitor.aggregate,
            query: monitor.query,
            threshold: monitor.threshold,
            workflowName: monitor.workflowName,
          })),
          existingAlerts: SENTRY_EXISTING_APP_HEALTH_ALERTS.map((alert) => alert.name),
        },
        null,
        2,
      ),
    );
    return;
  }

  const token = process.env.SENTRY_TOKEN;
  if (!token) throw new Error('SENTRY_TOKEN is required for --apply and --verify');

  const api = new SentryApi(token);
  const result: SyncResult = {
    detectors: [],
    existingAlerts: [],
  };

  result.dashboard = await syncDashboard(api, mode);
  result.detectors = await syncDetectors(api, mode);
  result.existingAlerts = await verifyExistingAlerts(api);

  if (mode === 'verify') {
    const missingExisting = result.existingAlerts.filter((alert) => !alert.found);
    if (missingExisting.length > 0) {
      throw new Error(
        `Missing existing Sentry alerts: ${missingExisting.map((alert) => alert.name).join(', ')}`,
      );
    }
  }

  console.log(JSON.stringify({ mode, ...result }, null, 2));
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (import.meta.url === entrypoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
