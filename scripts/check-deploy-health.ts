import { pathToFileURL } from 'node:url';

const DEFAULT_BASE_URL = 'https://maz-squire.fly.dev';
const HEALTH_COMPONENTS = ['db', 'vector', 'embedder'] as const;
const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 5000] as const;
const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);
const TRANSIENT_FETCH_ERROR_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENOTFOUND',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type Logger = (message: string) => void;
type Sleep = (milliseconds: number) => Promise<void>;

interface CheckDeployHealthOptions {
  baseUrl?: string;
  fetch?: FetchLike;
  log?: Logger;
  retryDelaysMs?: readonly number[];
  sleep?: Sleep;
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

interface EndpointStatusResult {
  attempt: number;
  maxAttempts: number;
  payload: StatusPayload;
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

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorCode(error: unknown, depth = 0): string | undefined {
  if (depth > 4 || !isRecord(error)) return undefined;
  const code = error.code;
  if (typeof code === 'string' && code.trim().length > 0) return code.trim();
  return errorCode(error.cause, depth + 1);
}

function errorMessage(error: unknown, depth = 0): string {
  if (depth > 4 || !isRecord(error)) return '';
  const message = error.message;
  const causeMessage = errorMessage(error.cause, depth + 1);
  return [typeof message === 'string' ? message : '', causeMessage].filter(Boolean).join(' ');
}

function transientFetchFailureReason(error: unknown): string | undefined {
  const code = errorCode(error);
  if (code && TRANSIENT_FETCH_ERROR_CODES.has(code)) return code;

  const message = errorMessage(error).toLowerCase();
  if (
    /\bfetch failed\b/.test(message) ||
    /network socket disconnected/.test(message) ||
    /before secure tls connection was established/.test(message) ||
    /socket hang up/.test(message)
  ) {
    return 'fetch_failed';
  }

  return undefined;
}

async function checkEndpointStatus(
  fetch: FetchLike,
  url: string,
  path: string,
  options: {
    log: Logger;
    retryDelaysMs: readonly number[];
    sleep: Sleep;
  },
): Promise<EndpointStatusResult> {
  const maxAttempts = options.retryDelaysMs.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        if (TRANSIENT_HTTP_STATUSES.has(response.status)) {
          if (attempt < maxAttempts) {
            const nextDelayMs = options.retryDelaysMs[attempt - 1] ?? 0;
            options.log(
              `Retry ${path} attempt=${attempt}/${maxAttempts} reason=HTTP ${response.status} nextDelayMs=${nextDelayMs}`,
            );
            await options.sleep(nextDelayMs);
            continue;
          }
          throw new Error(`${path} returned ${response.status} after ${maxAttempts} attempts`);
        }
        throw new Error(`${path} returned ${response.status}`);
      }

      const payload = await readJson(response, path);
      if (payload.status !== 'ok') {
        throw new Error(`${path} status was ${String(payload.status)}`);
      }
      return { attempt, maxAttempts, payload };
    } catch (error) {
      const reason = transientFetchFailureReason(error);
      if (!reason) throw error;
      if (attempt >= maxAttempts) {
        throw new Error(`${path} failed after ${maxAttempts} attempts: ${reason}`, {
          cause: error,
        });
      }

      const nextDelayMs = options.retryDelaysMs[attempt - 1] ?? 0;
      options.log(
        `Retry ${path} attempt=${attempt}/${maxAttempts} reason=${reason} nextDelayMs=${nextDelayMs}`,
      );
      await options.sleep(nextDelayMs);
    }
  }

  throw new Error(`${path} failed after ${maxAttempts} attempts`);
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
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleepFn = options.sleep ?? sleep;
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const liveUrl = `${baseUrl}/api/live`;
  const healthUrl = `${baseUrl}/api/health`;

  const live = await checkEndpointStatus(fetch, liveUrl, '/api/live', {
    log,
    retryDelaysMs,
    sleep: sleepFn,
  });
  log(
    `OK /api/live status=${String(live.payload.status)} attempt=${live.attempt}/${live.maxAttempts}`,
  );

  const health = await checkEndpointStatus(fetch, healthUrl, '/api/health', {
    log,
    retryDelaysMs,
    sleep: sleepFn,
  });
  assertHealthComponents(health.payload);
  log(
    `OK /api/health status=${String(health.payload.status)} attempt=${health.attempt}/${
      health.maxAttempts
    } db=${String(health.payload.db?.status)} vector=${String(
      health.payload.vector?.status,
    )} embedder=${String(health.payload.embedder?.status)}`,
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
