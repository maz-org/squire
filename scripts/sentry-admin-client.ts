export const SENTRY_API_BASE = 'https://sentry.io/api/0';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface SentryAdminClientOptions {
  token: string;
  fetch?: FetchLike;
  apiBase?: string;
}

export interface SentryListClient {
  list(path: string): Promise<unknown[]>;
}

export function parseSentryNextPath(linkHeader: string | null): string | undefined {
  if (!linkHeader) return undefined;

  for (const part of linkHeader.split(/,\s*(?=<)/)) {
    if (!/\brel="next"/.test(part) || !/\bresults="true"/.test(part)) continue;
    const urlMatch = part.match(/<([^>]+)>/);
    if (!urlMatch) continue;
    try {
      const url = new URL(urlMatch[1] ?? '');
      const apiBase = new URL(SENTRY_API_BASE);
      if (url.origin !== apiBase.origin) continue;
      const relativePath = url.pathname.startsWith(`${apiBase.pathname}/`)
        ? url.pathname.slice(apiBase.pathname.length)
        : url.pathname;
      return `${relativePath}${url.search}`;
    } catch {
      continue;
    }
  }

  return undefined;
}

function pathWithListPageSize(path: string, apiBase: string): string {
  const url = sentryApiUrl(path, apiBase);
  if (!url.searchParams.has('per_page') && !url.searchParams.has('limit')) {
    url.searchParams.set('per_page', '100');
  }
  const apiBaseUrl = new URL(apiBase);
  if (url.origin === apiBaseUrl.origin && url.pathname.startsWith(`${apiBaseUrl.pathname}/`)) {
    return `${url.pathname.slice(apiBaseUrl.pathname.length)}${url.search}`;
  }
  return url.toString();
}

function sentryApiUrl(path: string | URL, apiBase: string): URL {
  if (path instanceof URL) return path;
  if (/^https?:\/\//i.test(path)) return new URL(path);
  const base = apiBase.replace(/\/$/, '');
  if (path.startsWith('/api/0/')) return new URL(path, new URL(base).origin);
  if (path.startsWith('/')) return new URL(`${base}${path}`);
  return new URL(`${base}/${path}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeHeaders(token: string, init: RequestInit | undefined): Headers {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (init?.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
}

async function responseBody(response: Response, context: string): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${context} returned invalid JSON`, { cause: error });
  }
}

export class SentryAdminClient implements SentryListClient {
  private readonly token: string;
  private readonly fetch: FetchLike;
  private readonly apiBase: string;

  constructor(options: SentryAdminClientOptions) {
    this.token = options.token;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.apiBase = options.apiBase ?? SENTRY_API_BASE;
  }

  async request<T>(path: string | URL, init: RequestInit = {}): Promise<T> {
    return (await this.requestWithHeaders<T>(path, init)).body;
  }

  async requestWithHeaders<T>(
    path: string | URL,
    init: RequestInit = {},
  ): Promise<{ body: T; headers: Headers }> {
    const url = sentryApiUrl(path, this.apiBase);
    const response = await this.fetch(url, {
      ...init,
      headers: mergeHeaders(this.token, init),
    });
    const context = `Sentry API ${init.method ?? 'GET'} ${url.toString()}`;
    const body = await responseBody(response, context);
    if (!response.ok) {
      throw new Error(
        `${context} returned ${String(response.status)} ${response.statusText}: ${JSON.stringify(
          body,
        )}`,
      );
    }
    return { body: body as T, headers: response.headers };
  }

  async list(path: string): Promise<unknown[]> {
    const records: unknown[] = [];
    const seenPaths = new Set<string>();
    let nextPath: string | undefined = pathWithListPageSize(path, this.apiBase);

    while (nextPath) {
      if (seenPaths.has(nextPath)) throw new Error(`Sentry pagination loop at ${nextPath}`);
      seenPaths.add(nextPath);

      const { body, headers } = await this.requestWithHeaders<unknown>(nextPath);
      if (Array.isArray(body)) {
        records.push(...body);
      } else if (isRecord(body) && Array.isArray(body.results)) {
        records.push(...body.results);
      } else {
        throw new Error(`Expected Sentry list response for ${nextPath}`);
      }
      nextPath = parseSentryNextPath(headers.get('link'));
    }

    return records;
  }
}
