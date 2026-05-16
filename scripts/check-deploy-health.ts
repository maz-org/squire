import { pathToFileURL } from 'node:url';

const DEFAULT_BASE_URL = 'https://maz-squire.fly.dev';
const HEALTH_COMPONENTS = ['db', 'vector', 'embedder'] as const;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type Logger = (message: string) => void;

interface CheckDeployHealthOptions {
  baseUrl?: string;
  fetch?: FetchLike;
  log?: Logger;
}

interface StatusPayload {
  status?: unknown;
  db?: { status?: unknown };
  vector?: { status?: unknown };
  embedder?: { status?: unknown };
}

export interface CheckDeployHealthResult {
  baseUrl: string;
  liveUrl: string;
  healthUrl: string;
}

function normalizeBaseUrl(rawBaseUrl: string): string {
  const url = new URL(rawBaseUrl);
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

async function readJson(response: Response, path: string): Promise<StatusPayload> {
  try {
    return (await response.json()) as StatusPayload;
  } catch (error) {
    throw new Error(`${path} did not return valid JSON`, { cause: error });
  }
}

async function checkEndpointStatus(
  fetch: FetchLike,
  url: string,
  path: string,
): Promise<StatusPayload> {
  const response = await fetch(url);
  const payload = await readJson(response, path);

  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  if (payload.status !== 'ok') {
    throw new Error(`${path} status was ${String(payload.status)}`);
  }
  return payload;
}

function assertHealthComponents(payload: StatusPayload) {
  for (const component of HEALTH_COMPONENTS) {
    const status = payload[component]?.status;
    if (status !== 'ok') {
      throw new Error(`/api/health ${component} status was ${String(status)}`);
    }
  }
}

export async function checkDeployHealth(
  options: CheckDeployHealthOptions = {},
): Promise<CheckDeployHealthResult> {
  const fetch = options.fetch ?? globalThis.fetch;
  const log = options.log ?? console.log;
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const liveUrl = `${baseUrl}/api/live`;
  const healthUrl = `${baseUrl}/api/health`;

  const live = await checkEndpointStatus(fetch, liveUrl, '/api/live');
  log(`OK /api/live status=${String(live.status)}`);

  const health = await checkEndpointStatus(fetch, healthUrl, '/api/health');
  assertHealthComponents(health);
  log(
    `OK /api/health status=${String(health.status)} db=${String(
      health.db?.status,
    )} vector=${String(health.vector?.status)} embedder=${String(health.embedder?.status)}`,
  );

  return { baseUrl, liveUrl, healthUrl };
}

function parseBaseUrl(argv: readonly string[]): string {
  const baseUrlFlagIndex = argv.indexOf('--base-url');
  if (baseUrlFlagIndex !== -1) {
    const value = argv[baseUrlFlagIndex + 1];
    if (!value) throw new Error('--base-url requires a value');
    return value;
  }
  return process.env.SQUIRE_DEPLOY_HEALTH_BASE_URL ?? DEFAULT_BASE_URL;
}

async function main(): Promise<void> {
  await checkDeployHealth({ baseUrl: parseBaseUrl(process.argv.slice(2)) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
