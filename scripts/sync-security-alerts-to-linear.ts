import 'dotenv/config';

import { pathToFileURL } from 'node:url';

import {
  createLinearClient,
  type LinearTargets,
  type SquireLinearClient,
} from '../src/linear-client.ts';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type Logger = (message: string) => void;

type AlertType = 'dependabot' | 'code-scanning' | 'secret-scanning';
type RoutableSeverity = 'high' | 'critical';

interface CollectAlertsOptions {
  repository: string;
  githubToken: string;
  fetch?: FetchLike;
  log?: Logger;
  httpTimeoutMs?: number;
}

interface SyncSecurityAlertsOptions extends CollectAlertsOptions {
  linearApiKey?: string;
  linearTeamKey: string;
  linearProjectName?: string;
  linearLabelName?: string;
  dryRun: boolean;
  validateConfigOnly?: boolean;
  linearClient?: SquireLinearClient;
}

export interface RoutableSecurityAlert {
  key: string;
  type: AlertType;
  number: number;
  severity: RoutableSeverity;
  state: string;
  title: string;
  summary: string;
  repository: string;
  htmlUrl: string;
}

export interface SyncSecurityAlertsResult {
  alerts: number;
  created: number;
  updated: number;
  dryRun: number;
}

interface GitHubDependabotAlert {
  number?: unknown;
  state?: unknown;
  html_url?: unknown;
  dependency?: {
    manifest_path?: unknown;
    package?: { name?: unknown; ecosystem?: unknown };
  };
  security_advisory?: {
    ghsa_id?: unknown;
    cve_id?: unknown;
    severity?: unknown;
    summary?: unknown;
  };
  security_vulnerability?: {
    vulnerable_version_range?: unknown;
    patched_versions?: unknown;
  };
}

interface GitHubCodeScanningAlert {
  number?: unknown;
  state?: unknown;
  html_url?: unknown;
  rule?: {
    id?: unknown;
    name?: unknown;
    description?: unknown;
    severity?: unknown;
    security_severity_level?: unknown;
  };
  most_recent_instance?: {
    location?: { path?: unknown; start_line?: unknown };
  };
}

interface GitHubSecretScanningAlert {
  number?: unknown;
  state?: unknown;
  html_url?: unknown;
  secret_type?: unknown;
  secret_type_display_name?: unknown;
  validity?: unknown;
}

const GITHUB_API_VERSION = '2022-11-28';
const DEFAULT_LINEAR_TEAM_KEY = 'SQR';
const DEFAULT_LINEAR_PROJECT_NAME = 'Squire · Security Alert Automation';
const DEFAULT_LINEAR_LABEL_NAME = 'Security';
const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function normalizeSeverity(value: unknown): RoutableSeverity | undefined {
  const severity = asString(value)?.toLowerCase();
  return severity === 'high' || severity === 'critical' ? severity : undefined;
}

function alertKey(repository: string, type: AlertType, number: number): string {
  return `github-security:${repository}:${type}:${number}`;
}

function githubHeaders(token: string): HeadersInit {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': GITHUB_API_VERSION,
  };
}

async function readJson(response: Response, context: string): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${context} did not return valid JSON`, { cause: error });
  }
}

async function fetchWithTimeout(
  fetch: FetchLike,
  input: string | URL,
  init: RequestInit,
  context: string,
  timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutError = new Error(`${context} timed out after ${String(timeoutMs)}ms`);
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      fetch(input, { ...init, signal: controller.signal }),
      timeoutPromise,
    ]);
  } catch (error) {
    if (error === timeoutError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw timeoutError;
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function nextLink(linkHeader: string | null): string | undefined {
  if (!linkHeader) return undefined;

  for (const part of linkHeader.split(',')) {
    const [rawUrl, rawRel] = part
      .trim()
      .split(';')
      .map((value) => value.trim());
    if (rawRel === 'rel="next"') {
      return rawUrl?.replace(/^<|>$/g, '');
    }
  }
  return undefined;
}

async function fetchGitHubPages(
  fetch: FetchLike,
  token: string,
  url: string,
  endpointName: string,
  log: Logger,
  options: { treatForbiddenAsEmpty?: boolean } = {},
  timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let nextUrl: string | undefined = url;

  while (nextUrl) {
    const response = await fetchWithTimeout(
      fetch,
      nextUrl,
      { headers: githubHeaders(token) },
      endpointName,
      timeoutMs,
    );

    if (response.status === 404) {
      log(`${endpointName} returned 404; treating it as no enabled alerts for this repo`);
      return results;
    }

    const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
    const retryAfter = response.headers.get('retry-after');
    const isRateLimited = rateLimitRemaining === '0' || retryAfter !== null;
    if (response.status === 403 && options.treatForbiddenAsEmpty && !isRateLimited) {
      log(`${endpointName} returned 403; skipping because the token cannot read this alert type`);
      return results;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${endpointName} returned ${response.status}: ${body}`);
    }

    const body = await readJson(response, endpointName);
    if (!Array.isArray(body)) {
      throw new Error(`${endpointName} returned a non-array response`);
    }

    results.push(...body);
    nextUrl = nextLink(response.headers.get('link'));
  }

  return results;
}

function normalizeDependabotAlert(
  repository: string,
  alert: GitHubDependabotAlert,
): RoutableSecurityAlert | undefined {
  const number = asNumber(alert.number);
  const severity = normalizeSeverity(alert.security_advisory?.severity);
  if (number === undefined || severity === undefined) return undefined;

  const packageName = asString(alert.dependency?.package?.name) ?? 'unknown package';
  const ecosystem = asString(alert.dependency?.package?.ecosystem);
  const summary = asString(alert.security_advisory?.summary) ?? 'Dependabot security alert';
  const lines = [
    `Package: ${ecosystem ? `${ecosystem}:` : ''}${packageName}`,
    `Advisory: ${asString(alert.security_advisory?.ghsa_id) ?? 'unknown'}`,
    asString(alert.security_advisory?.cve_id)
      ? `CVE: ${String(alert.security_advisory?.cve_id)}`
      : undefined,
    asString(alert.dependency?.manifest_path)
      ? `Manifest: ${String(alert.dependency?.manifest_path)}`
      : undefined,
    asString(alert.security_vulnerability?.vulnerable_version_range)
      ? `Vulnerable range: ${String(alert.security_vulnerability?.vulnerable_version_range)}`
      : undefined,
    asString(alert.security_vulnerability?.patched_versions)
      ? `Patched versions: ${String(alert.security_vulnerability?.patched_versions)}`
      : undefined,
    `Summary: ${summary}`,
  ].filter((line): line is string => line !== undefined);

  return {
    key: alertKey(repository, 'dependabot', number),
    type: 'dependabot',
    number,
    severity,
    state: asString(alert.state) ?? 'open',
    title: `[${severity}] Dependabot alert #${number}: ${summary}`,
    summary: lines.join('\n'),
    repository,
    htmlUrl:
      asString(alert.html_url) ??
      `https://github.com/${repository}/security/dependabot/${String(number)}`,
  };
}

function normalizeCodeScanningAlert(
  repository: string,
  alert: GitHubCodeScanningAlert,
): RoutableSecurityAlert | undefined {
  const number = asNumber(alert.number);
  const severity = normalizeSeverity(alert.rule?.security_severity_level);
  if (number === undefined || severity === undefined) return undefined;

  const ruleName =
    asString(alert.rule?.description) ?? asString(alert.rule?.name) ?? asString(alert.rule?.id);
  const location = alert.most_recent_instance?.location;
  const locationText =
    asString(location?.path) && asNumber(location?.start_line)
      ? `${String(location?.path)}:${String(location?.start_line)}`
      : undefined;
  const lines = [
    `Rule: ${asString(alert.rule?.id) ?? 'unknown'}`,
    locationText ? `Location: ${locationText}` : undefined,
    `Summary: ${ruleName ?? 'Code scanning security alert'}`,
  ].filter((line): line is string => line !== undefined);

  return {
    key: alertKey(repository, 'code-scanning', number),
    type: 'code-scanning',
    number,
    severity,
    state: asString(alert.state) ?? 'open',
    title: `[${severity}] Code scanning alert #${number}: ${ruleName ?? 'security alert'}`,
    summary: lines.join('\n'),
    repository,
    htmlUrl:
      asString(alert.html_url) ??
      `https://github.com/${repository}/security/code-scanning/${String(number)}`,
  };
}

function normalizeSecretScanningAlert(
  repository: string,
  alert: GitHubSecretScanningAlert,
): RoutableSecurityAlert | undefined {
  const number = asNumber(alert.number);
  if (number === undefined) return undefined;

  const secretType =
    asString(alert.secret_type_display_name) ?? asString(alert.secret_type) ?? 'secret';
  const lines = [
    `Secret type: ${secretType}`,
    asString(alert.validity) ? `Validity: ${String(alert.validity)}` : undefined,
    'GitHub secret scanning does not expose severity through the alert API; open secret alerts are routed as high severity.',
  ].filter((line): line is string => line !== undefined);

  return {
    key: alertKey(repository, 'secret-scanning', number),
    type: 'secret-scanning',
    number,
    severity: 'high',
    state: asString(alert.state) ?? 'open',
    title: `[high] Secret scanning alert #${number}: ${secretType}`,
    summary: lines.join('\n'),
    repository,
    htmlUrl:
      asString(alert.html_url) ??
      `https://github.com/${repository}/security/secret-scanning/${String(number)}`,
  };
}

export async function collectRoutableAlerts(
  options: CollectAlertsOptions,
): Promise<RoutableSecurityAlert[]> {
  const fetch = options.fetch ?? globalThis.fetch;
  const log = options.log ?? console.log;
  const baseUrl = `https://api.github.com/repos/${options.repository}`;

  const [dependabotAlerts, codeScanningAlerts, secretScanningAlerts] = await Promise.all([
    fetchGitHubPages(
      fetch,
      options.githubToken,
      `${baseUrl}/dependabot/alerts?state=open&per_page=100`,
      'Dependabot alerts',
      log,
      {},
      options.httpTimeoutMs,
    ),
    fetchGitHubPages(
      fetch,
      options.githubToken,
      `${baseUrl}/code-scanning/alerts?state=open&per_page=100`,
      'Code scanning alerts',
      log,
      {},
      options.httpTimeoutMs,
    ),
    fetchGitHubPages(
      fetch,
      options.githubToken,
      `${baseUrl}/secret-scanning/alerts?state=open&per_page=100`,
      'Secret scanning alerts',
      log,
      { treatForbiddenAsEmpty: true },
      options.httpTimeoutMs,
    ),
  ]);

  return [
    ...dependabotAlerts
      .map((alert) => normalizeDependabotAlert(options.repository, alert as GitHubDependabotAlert))
      .filter((alert): alert is RoutableSecurityAlert => alert !== undefined),
    ...codeScanningAlerts
      .map((alert) =>
        normalizeCodeScanningAlert(options.repository, alert as GitHubCodeScanningAlert),
      )
      .filter((alert): alert is RoutableSecurityAlert => alert !== undefined),
    ...secretScanningAlerts
      .map((alert) =>
        normalizeSecretScanningAlert(options.repository, alert as GitHubSecretScanningAlert),
      )
      .filter((alert): alert is RoutableSecurityAlert => alert !== undefined),
  ];
}

function logValidatedLinearTarget(log: Logger, targets: LinearTargets): void {
  log(
    `Validated Linear target team=${targets.teamId} project=${targets.projectId ?? 'none'} label=${targets.labelName}`,
  );
}

function issueDescription(alert: RoutableSecurityAlert): string {
  return [
    `GitHub reported a ${alert.severity} ${alert.type} security alert in \`${alert.repository}\`.`,
    '',
    `Source: [${alert.type} alert #${alert.number}](${alert.htmlUrl})`,
    `Severity: \`${alert.severity}\``,
    `State: \`${alert.state}\``,
    '',
    'Details:',
    '```text',
    alert.summary,
    '```',
    '',
    `<!-- ${alert.key} -->`,
  ].join('\n');
}

function createSecurityIssueInput(targets: LinearTargets, alert: RoutableSecurityAlert) {
  return {
    teamId: targets.teamId,
    title: alert.title,
    description: issueDescription(alert),
    priority: 2,
    projectId: targets.projectId,
    labelIds: targets.labelIds,
  };
}

function updateSecurityIssueInput(targets: LinearTargets, alert: RoutableSecurityAlert) {
  return {
    title: alert.title,
    description: issueDescription(alert),
    priority: 2,
    projectId: targets.projectId,
    labelIds: targets.labelIds,
  };
}

function linearClientFromOptions(options: SyncSecurityAlertsOptions): SquireLinearClient {
  if (options.linearClient) return options.linearClient;
  if (!options.linearApiKey) {
    throw new Error('LINEAR_API_KEY is required unless SECURITY_ALERT_DRY_RUN=1');
  }
  return createLinearClient(options.linearApiKey);
}

export async function syncSecurityAlertsToLinear(
  options: SyncSecurityAlertsOptions,
): Promise<SyncSecurityAlertsResult> {
  const fetch = options.fetch ?? globalThis.fetch;
  const log = options.log ?? console.log;

  if (options.validateConfigOnly) {
    if (!options.linearApiKey && !options.linearClient) {
      throw new Error('LINEAR_API_KEY is required for --validate-config');
    }
    const linearClient = linearClientFromOptions(options);
    const targets = await linearClient.resolveTargets({
      teamKey: options.linearTeamKey,
      projectName: options.linearProjectName ?? DEFAULT_LINEAR_PROJECT_NAME,
      labelName: options.linearLabelName ?? DEFAULT_LINEAR_LABEL_NAME,
    });
    logValidatedLinearTarget(log, targets);
    return { alerts: 0, created: 0, updated: 0, dryRun: 0 };
  }

  const alerts = await collectRoutableAlerts({ ...options, fetch, log });

  const result: SyncSecurityAlertsResult = {
    alerts: alerts.length,
    created: 0,
    updated: 0,
    dryRun: 0,
  };

  if (options.dryRun) {
    if (alerts.length === 0) {
      log('No high or critical GitHub security alerts found.');
      return result;
    }

    for (const alert of alerts) {
      log(
        `[dry-run] would create/update ${alert.severity} ${alert.type} alert #${alert.number}: ${alert.title}`,
      );
      log(`[dry-run] ${alert.key}`);
      result.dryRun += 1;
    }
    return result;
  }

  if (!options.linearApiKey && !options.linearClient) {
    throw new Error('LINEAR_API_KEY is required unless SECURITY_ALERT_DRY_RUN=1');
  }

  const linearClient = linearClientFromOptions(options);
  const targets = await linearClient.resolveTargets({
    teamKey: options.linearTeamKey,
    projectName: options.linearProjectName ?? DEFAULT_LINEAR_PROJECT_NAME,
    labelName: options.linearLabelName ?? DEFAULT_LINEAR_LABEL_NAME,
  });
  logValidatedLinearTarget(log, targets);

  if (alerts.length === 0) {
    log('No high or critical GitHub security alerts found.');
    return result;
  }

  for (const alert of alerts) {
    const existing = await linearClient.findIssueByMarker(options.linearTeamKey, alert.key);

    if (existing) {
      const updated = await linearClient.updateIssue(
        existing.id,
        updateSecurityIssueInput(targets, alert),
      );
      log(`Updated ${updated.identifier} for ${alert.key}: ${updated.url}`);
      result.updated += 1;
    } else {
      const created = await linearClient.createIssue(createSecurityIssueInput(targets, alert));
      log(`Created ${created.identifier} for ${alert.key}: ${created.url}`);
      result.created += 1;
    }
  }

  return result;
}

function optionValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function booleanFromEnv(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

function parseOptions(argv: readonly string[], env: NodeJS.ProcessEnv): SyncSecurityAlertsOptions {
  const validateConfigOnly =
    argv.includes('--validate-config') || booleanFromEnv(env.SECURITY_ALERT_VALIDATE_CONFIG);
  const repository =
    optionValue(argv, '--repository') ?? env.SECURITY_ALERT_REPOSITORY ?? env.GITHUB_REPOSITORY;
  if (!repository && !validateConfigOnly) {
    throw new Error('--repository or SECURITY_ALERT_REPOSITORY is required');
  }

  const githubToken =
    optionValue(argv, '--github-token') ??
    env.SECURITY_ALERT_GITHUB_TOKEN ??
    env.GITHUB_TOKEN ??
    env.GH_TOKEN;
  if (!githubToken && !validateConfigOnly) {
    throw new Error('GITHUB_TOKEN or SECURITY_ALERT_GITHUB_TOKEN is required');
  }

  const dryRun =
    argv.includes('--dry-run') ||
    booleanFromEnv(env.SECURITY_ALERT_DRY_RUN) ||
    !argv.includes('--apply');

  return {
    repository: repository ?? 'unused',
    githubToken: githubToken ?? '',
    linearApiKey:
      optionValue(argv, '--linear-api-key') ??
      env.SECURITY_ALERT_LINEAR_API_KEY ??
      env.LINEAR_API_KEY,
    linearTeamKey:
      optionValue(argv, '--linear-team-key') ??
      env.SECURITY_ALERT_LINEAR_TEAM_KEY ??
      DEFAULT_LINEAR_TEAM_KEY,
    linearProjectName:
      optionValue(argv, '--linear-project') ??
      env.SECURITY_ALERT_LINEAR_PROJECT ??
      DEFAULT_LINEAR_PROJECT_NAME,
    linearLabelName:
      optionValue(argv, '--linear-label') ??
      env.SECURITY_ALERT_LINEAR_LABEL ??
      DEFAULT_LINEAR_LABEL_NAME,
    validateConfigOnly,
    dryRun,
  };
}

async function main(): Promise<void> {
  const result = await syncSecurityAlertsToLinear(parseOptions(process.argv.slice(2), process.env));
  console.log(
    `Security alert Linear sync complete: alerts=${result.alerts} created=${result.created} updated=${result.updated} dryRun=${result.dryRun}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
