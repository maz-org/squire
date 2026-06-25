import 'dotenv/config';

import { spawn, type ChildProcess } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

import { eq } from 'drizzle-orm';

import { llmBudgetLedger } from '../src/db/schema/budget.ts';
import { getDb, shutdownServerPool } from '../src/db.ts';
import { FROSTHAVEN_GAME_ID, GLOOMHAVEN_2E_GAME_ID, type GameId } from '../src/game.ts';

const CODE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CODE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const DEFAULT_PORT = '3000';
const DEFAULT_BUDGET_USD = '0.25';
const DEFAULT_SERVER_WAIT_MS = 120_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const BUDGET_GUARD_MODEL = 'squire-e2e-budget-guard';
const OVERRUN_COST_USD_MICROS = 1_000_000;

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;
type Logger = (message: string) => void;

export interface E2eSmokeGame {
  game: GameId;
  label: string;
  searchQuery: string;
  askQuestion: string;
  expectedSourceMarker: string;
  expectedSourceLabel: string;
  forbiddenSourceMarker: string;
  requiredAnswerTerms: string[];
}

export const E2E_SMOKE_GAMES: readonly E2eSmokeGame[] = [
  {
    game: FROSTHAVEN_GAME_ID,
    label: 'Frosthaven',
    searchQuery: 'loot',
    askQuestion: 'In Frosthaven, what does the Loot action do?',
    expectedSourceMarker: 'fh-',
    expectedSourceLabel: 'Rulebook',
    forbiddenSourceMarker: 'gh2-',
    requiredAnswerTerms: ['loot'],
  },
  {
    game: GLOOMHAVEN_2E_GAME_ID,
    label: 'Gloomhaven 2e',
    searchQuery: 'advantage',
    askQuestion: 'In Gloomhaven 2e, how does Advantage work?',
    expectedSourceMarker: 'gh2-',
    expectedSourceLabel: 'Rulebook',
    forbiddenSourceMarker: 'fh-',
    requiredAnswerTerms: ['advantage'],
  },
];

interface SmokeOptions {
  baseUrl: string;
  fetch?: FetchLike;
  logger?: Logger;
  clearBudgetExhaustion?: () => Promise<void>;
  seedBudgetExhaustion?: () => Promise<void>;
  requestTimeoutMs?: number;
}

export interface SmokeResult {
  games: GameId[];
  providerCalls: number;
  budgetExceededBeforeStream: boolean;
}

interface SseEvent {
  event?: string;
  data: unknown;
}

interface SearchResult {
  game?: string;
  source?: string;
  sourceRef?: string;
  sourceLabel?: string;
}

function log(logger: Logger, message: string) {
  logger(`[e2e-api-agent] ${message}`);
}

function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, '');
}

function urlFor(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}${path}`;
}

function createTimedFetch(fetchImpl: FetchLike, timeoutMs: number): FetchLike {
  return async (url, init = {}) => {
    const controller = new AbortController();
    let timedOut = false;
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
    const timeoutError = new Error(`Timed out after ${timeoutMs}ms fetching ${String(url)}`);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = globalThis.setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(timeoutError);
      }, timeoutMs);
    });

    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(url, {
            ...init,
            signal: controller.signal,
          });
          const body = await response.arrayBuffer();
          return new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        })(),
        timeoutPromise,
      ]);
    } catch (error) {
      if (timedOut || controller.signal.aborted) {
        throw new Error(`Timed out after ${timeoutMs}ms fetching ${String(url)}`, { cause: error });
      }
      throw error;
    } finally {
      if (timeout !== undefined) globalThis.clearTimeout(timeout);
    }
  };
}

async function readBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<unreadable body>';
  }
}

async function expectStatus(step: string, res: Response, status: number): Promise<void> {
  if (res.status === status) return;
  throw new Error(`${step}: expected ${status}, got ${res.status}: ${await readBody(res)}`);
}

async function expectJson<T>(step: string, res: Response, status: number): Promise<T> {
  await expectStatus(step, res, status);
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(`${step}: expected JSON response, got ${contentType || '<missing>'}`);
  }
  return (await res.json()) as T;
}

function containsRequiredTerms(answer: string, terms: readonly string[]): boolean {
  const normalized = answer.toLowerCase();
  return terms.every((term) => normalized.includes(term.toLowerCase()));
}

export function parseSseEvents(text: string): SseEvent[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => {
      const lines = block.split('\n');
      const event = lines
        .find((line) => line.startsWith('event:'))
        ?.slice('event:'.length)
        .trim();
      const dataText =
        lines
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice('data:'.length).trim())
          .join('\n') || '{}';
      let data: unknown;
      try {
        data = JSON.parse(dataText);
      } catch {
        data = dataText;
      }
      return { event, data };
    });
}

async function waitForJsonOk(fetchImpl: FetchLike, url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  let lastError = '';

  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetchImpl(url);
      if (res.status === 200) return;
      lastError = `${res.status}: ${await readBody(res)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for ${url}. Last error: ${lastError}`);
}

async function mintBearerToken(baseUrl: string, fetchImpl: FetchLike): Promise<string> {
  const register = await expectJson<{ client_id: string }>(
    'oauth register',
    await fetchImpl(urlFor(baseUrl, '/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: ['http://localhost:8080/callback'],
        client_name: 'Squire scheduled E2E smoke',
        token_endpoint_auth_method: 'none',
      }),
    }),
    201,
  );

  const authorizeParams = new URLSearchParams({
    client_id: register.client_id,
    redirect_uri: 'http://localhost:8080/callback',
    response_type: 'code',
    code_challenge: CODE_CHALLENGE,
    code_challenge_method: 'S256',
  });
  const authorize = await fetchImpl(urlFor(baseUrl, `/authorize?${authorizeParams}`), {
    redirect: 'manual',
  });
  await expectStatus('oauth authorize', authorize, 302);
  const redirect = authorize.headers.get('location');
  if (!redirect) throw new Error('oauth authorize: missing redirect location');
  const code = new URL(redirect).searchParams.get('code');
  if (!code) throw new Error('oauth authorize: missing authorization code');

  const token = await expectJson<{ access_token: string; token_type?: string }>(
    'oauth token',
    await fetchImpl(urlFor(baseUrl, '/token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: register.client_id,
        code_verifier: CODE_VERIFIER,
        redirect_uri: 'http://localhost:8080/callback',
      }).toString(),
    }),
    200,
  );

  if (!token.access_token) throw new Error('oauth token: missing access_token');
  return token.access_token;
}

function assertSearchResults(game: E2eSmokeGame, results: SearchResult[]) {
  if (results.length === 0) {
    throw new Error(`${game.label} rule search: expected at least one result`);
  }

  const sourceMetadata = results
    .flatMap((result) => [result.source, result.sourceRef])
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  if (sourceMetadata.includes(game.forbiddenSourceMarker)) {
    throw new Error(`${game.label} rule search: result crossed into ${game.forbiddenSourceMarker}`);
  }

  if (!sourceMetadata.includes(game.expectedSourceMarker)) {
    throw new Error(`${game.label} rule search: no ${game.expectedSourceMarker} source metadata`);
  }

  for (const result of results) {
    if (result.game !== undefined && result.game !== game.game) {
      throw new Error(`${game.label} rule search: result game was ${result.game}`);
    }
  }
}

async function runRuleSearch(
  baseUrl: string,
  fetchImpl: FetchLike,
  token: string,
  game: E2eSmokeGame,
) {
  const params = new URLSearchParams({
    q: game.searchQuery,
    topK: '3',
    game: game.game,
  });
  const body = await expectJson<{ results: SearchResult[] }>(
    `${game.label} rule search`,
    await fetchImpl(urlFor(baseUrl, `/api/search/rules?${params}`), {
      headers: { Authorization: `Bearer ${token}` },
    }),
    200,
  );
  assertSearchResults(game, body.results);
}

function dataRecord(data: unknown): Record<string, unknown> {
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
}

async function runAsk(baseUrl: string, fetchImpl: FetchLike, token: string, game: E2eSmokeGame) {
  const res = await fetchImpl(urlFor(baseUrl, '/api/ask'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      question: game.askQuestion,
      game: game.game,
    }),
  });
  await expectStatus(`${game.label} ask`, res, 200);
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream')) {
    throw new Error(`${game.label} ask: expected SSE stream, got ${contentType || '<missing>'}`);
  }

  const events = parseSseEvents(await res.text());
  const eventNames = new Set(events.map((event) => event.event));
  for (const expectedEvent of ['tool_result', 'text', 'done']) {
    if (!eventNames.has(expectedEvent)) {
      throw new Error(`${game.label} ask: missing SSE event ${expectedEvent}`);
    }
  }

  const sourceLabels = events
    .filter((event) => event.event === 'tool_result')
    .flatMap((event) => {
      const sourceBooks = dataRecord(event.data).sourceBooks;
      return Array.isArray(sourceBooks)
        ? sourceBooks.filter((value) => typeof value === 'string')
        : [];
    });
  if (sourceLabels.length === 0) {
    throw new Error(`${game.label} ask: no citation/source labels in tool_result events`);
  }

  const answer = events
    .filter((event) => event.event === 'text')
    .map((event) => dataRecord(event.data).delta)
    .filter((delta): delta is string => typeof delta === 'string')
    .join('');
  if (!containsRequiredTerms(answer, game.requiredAnswerTerms)) {
    throw new Error(
      `${game.label} semantic answer check failed: missing ${game.requiredAnswerTerms.join(', ')}`,
    );
  }
}

async function seedBudgetExhaustionLedger() {
  const { db } = getDb('server');
  await db.insert(llmBudgetLedger).values({
    budgetDay: new Date().toISOString().slice(0, 10),
    userId: null,
    model: BUDGET_GUARD_MODEL,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: 0,
    costUsdMicros: OVERRUN_COST_USD_MICROS,
    createdAt: new Date(),
  });
}

async function clearBudgetExhaustionLedger() {
  const { db } = getDb('server');
  await db.delete(llmBudgetLedger).where(eq(llmBudgetLedger.model, BUDGET_GUARD_MODEL));
}

async function runBudgetExhaustionCheck(baseUrl: string, fetchImpl: FetchLike, token: string) {
  const res = await fetchImpl(urlFor(baseUrl, '/api/ask'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      question: 'In Frosthaven, what does the Loot action do?',
      game: FROSTHAVEN_GAME_ID,
    }),
  });
  await expectStatus('budget exhaustion', res, 429);
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    throw new Error('budget exhaustion: opened an SSE stream instead of returning JSON');
  }
  const body = await expectJson<{ error?: string }>('budget exhaustion', res, 429);
  if (body.error !== 'llm_budget_exceeded') {
    throw new Error(`budget exhaustion: expected llm_budget_exceeded, got ${body.error}`);
  }
}

export async function runApiAgentSmoke(options: SmokeOptions): Promise<SmokeResult> {
  const fetchImpl = createTimedFetch(
    options.fetch ?? fetch,
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  );
  const logger = options.logger ?? console.log;
  const clearBudgetExhaustion = options.clearBudgetExhaustion ?? clearBudgetExhaustionLedger;
  const seedBudgetExhaustion = options.seedBudgetExhaustion ?? seedBudgetExhaustionLedger;
  const baseUrl = normalizeBaseUrl(options.baseUrl);

  await clearBudgetExhaustion();

  log(logger, `checking liveness at ${baseUrl}`);
  await expectJson('live check', await fetchImpl(urlFor(baseUrl, '/api/live')), 200);
  await expectJson('health check', await fetchImpl(urlFor(baseUrl, '/api/health')), 200);

  log(logger, 'minting OAuth bearer token');
  const token = await mintBearerToken(baseUrl, fetchImpl);

  for (const game of E2E_SMOKE_GAMES) {
    log(logger, `searching ${game.label} rules`);
    await runRuleSearch(baseUrl, fetchImpl, token, game);
    log(logger, `asking ${game.label} agent question`);
    await runAsk(baseUrl, fetchImpl, token, game);
  }

  log(logger, 'seeding budget ledger and checking pre-stream 429');
  await seedBudgetExhaustion();
  try {
    await runBudgetExhaustionCheck(baseUrl, fetchImpl, token);
  } finally {
    await clearBudgetExhaustion();
  }

  return {
    games: E2E_SMOKE_GAMES.map((game) => game.game),
    providerCalls: E2E_SMOKE_GAMES.length,
    budgetExceededBeforeStream: true,
  };
}

function serverEnv(baseUrl: string): NodeJS.ProcessEnv {
  const port = new URL(baseUrl).port || DEFAULT_PORT;
  return {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    SQUIRE_ENV: process.env.SQUIRE_ENV ?? 'e2e',
    PORT: process.env.PORT ?? port,
    SQUIRE_BASE_URL: process.env.SQUIRE_BASE_URL ?? baseUrl,
    SQUIRE_LLM_DAILY_BUDGET_USD: process.env.SQUIRE_LLM_DAILY_BUDGET_USD ?? DEFAULT_BUDGET_USD,
  };
}

function pipeChildOutput(child: ChildProcess) {
  child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(chunk));
  child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
}

function signalChild(child: ChildProcess, signal: NodeJS.Signals) {
  if (child.pid && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall through to signaling the direct child.
    }
  }
  child.kill(signal);
}

async function stopServer(child: ChildProcess | null) {
  if (!child || child.exitCode !== null) return;
  signalChild(child, 'SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    sleep(5_000).then(() => {
      if (child.exitCode === null) signalChild(child, 'SIGKILL');
    }),
  ]);
}

async function main() {
  const baseUrl =
    process.env.SQUIRE_E2E_BASE_URL ??
    `http://localhost:${process.env.PORT ?? process.env.SQUIRE_E2E_PORT ?? DEFAULT_PORT}`;
  const shouldStartServer = process.env.SQUIRE_E2E_START_SERVER !== '0';
  const logger: Logger = (message) => console.log(message);
  let server: ChildProcess | null = null;

  try {
    if (shouldStartServer) {
      log(logger, `starting server at ${baseUrl}`);
      server = spawn('npm', ['run', 'serve'], {
        env: serverEnv(baseUrl),
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      pipeChildOutput(server);
      server.once('exit', (code) => {
        if (code !== null && code !== 0) {
          console.error(`[e2e-api-agent] server exited with code ${code}`);
        }
      });
    }

    const timedFetch = createTimedFetch(fetch, DEFAULT_REQUEST_TIMEOUT_MS);
    await waitForJsonOk(timedFetch, urlFor(baseUrl, '/api/live'), DEFAULT_SERVER_WAIT_MS);
    await waitForJsonOk(timedFetch, urlFor(baseUrl, '/api/health'), DEFAULT_SERVER_WAIT_MS);
    const result = await runApiAgentSmoke({ baseUrl, logger });
    log(
      logger,
      `passed for ${result.games.join(', ')} with ${result.providerCalls} provider calls and budget cap ${process.env.SQUIRE_LLM_DAILY_BUDGET_USD ?? DEFAULT_BUDGET_USD} USD`,
    );
  } finally {
    await shutdownServerPool();
    await stopServer(server);
  }
}

if (
  process.env.VITEST !== 'true' &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
