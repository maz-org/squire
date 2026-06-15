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

type Mode = 'apply' | 'dry-run' | 'verify';

interface SentryRecord {
  id?: unknown;
  name?: unknown;
  title?: unknown;
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

function findRoutingWorkflowId(workflows: unknown[]): string {
  const workflow = named(workflows, SENTRY_APP_HEALTH_ROUTING_WORKFLOW_NAME);
  const workflowId = stringField(workflow, 'id');
  if (!workflowId) {
    throw new Error(`Missing Sentry workflow: ${SENTRY_APP_HEALTH_ROUTING_WORKFLOW_NAME}`);
  }
  return workflowId;
}

class SentryApi {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
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
    return (text.length > 0 ? JSON.parse(text) : null) as T;
  }

  async list(path: string): Promise<unknown[]> {
    const body = await this.request<unknown>(path);
    if (Array.isArray(body)) return body;
    if (isRecord(body) && Array.isArray(body.results)) return body.results;
    throw new Error(`Expected Sentry list response for ${path}`);
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
      if (!stringArrayField(existing, 'workflowIds').includes(routingWorkflowId)) {
        throw new Error(
          `Sentry detector is not routed to ${SENTRY_APP_HEALTH_ROUTING_WORKFLOW_NAME}: ${monitor.name}`,
        );
      }
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

async function verifyExistingAlerts(api: SentryApi): Promise<SyncResult['existingAlerts']> {
  const detectors = await api.list(`/organizations/${SENTRY_APP_HEALTH_ORG}/detectors/`);
  const workflows = await api.list(`/organizations/${SENTRY_APP_HEALTH_ORG}/workflows/`);
  return SENTRY_EXISTING_APP_HEALTH_ALERTS.map((alert) => {
    const detector = named(detectors, alert.name);
    const workflow = named(workflows, alert.name);
    const id = stringField(detector, 'id') ?? stringField(workflow, 'id');
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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
