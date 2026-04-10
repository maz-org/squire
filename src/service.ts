/**
 * Squire knowledge service.
 * Provides initialization, readiness checks, and the knowledge agent.
 */

import { embed } from './embedder.ts';
import {
  EMBEDDINGS_BOOTSTRAP_MESSAGE,
  getRetrievalBootstrapStatus,
  initializeRetrieval,
} from './vector-store.ts';
import { listCardTypes } from './tools.ts';
import { runAgentLoop } from './agent.ts';

let ready = false;
let initPromise: Promise<void> | null = null;

const CARD_BOOTSTRAP_MESSAGE = 'No card data found in Postgres. Run `npm run seed:cards` first.';
const CARD_DB_HINT =
  'Is Postgres running? Try `docker compose up -d` and `npm run db:migrate`.';

interface CardBootstrapStatus {
  ready: boolean;
  cardCount: number;
  error?: string;
  missingStep?: 'npm run seed:cards';
}

export interface ServiceBootstrapStatus {
  ready: boolean;
  bootstrapReady: boolean;
  warmingUp: boolean;
  indexSize: number;
  cardCount: number;
  ruleQueriesReady: boolean;
  cardQueriesReady: boolean;
  askReady: boolean;
  missingBootstrapSteps: Array<'npm run index' | 'npm run seed:cards'>;
  errors: string[];
}

/** @internal Reset service state for testing. */
export function _resetForTesting(): void {
  ready = false;
  initPromise = null;
}

/**
 * Initialize the service: load the vector index, warm the embedder, and
 * verify extracted data is available. Throws if the index is empty.
 * Safe to call concurrently — only the first call does work.
 */
export async function initialize(): Promise<void> {
  if (ready) return;
  if (initPromise) return initPromise;

  initPromise = doInitialize().catch((err) => {
    initPromise = null;
    throw err;
  });
  return initPromise;
}

async function doInitialize(): Promise<void> {
  const bootstrap = await getBootstrapStatus();
  if (!bootstrap.bootstrapReady) {
    throw new Error(bootstrap.errors[0] ?? EMBEDDINGS_BOOTSTRAP_MESSAGE);
  }

  // Retrieval layer owns vector index + embedder warmup + drift guard.
  await initializeRetrieval(embed);

  ready = true;
}

/**
 * Whether the service has been initialized and is ready to serve requests.
 */
export function isReady(): boolean {
  return ready;
}

async function getCardBootstrapStatus(): Promise<CardBootstrapStatus> {
  try {
    const types = await listCardTypes();
    const totalCards = types.reduce((sum, t) => sum + t.count, 0);
    if (totalCards === 0) {
      return {
        ready: false,
        cardCount: 0,
        error: CARD_BOOTSTRAP_MESSAGE,
        missingStep: 'npm run seed:cards',
      };
    }
    return { ready: true, cardCount: totalCards };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ready: false,
      cardCount: 0,
      error: `card data query failed: ${message}. ${CARD_DB_HINT}`,
    };
  }
}

export async function getBootstrapStatus(): Promise<ServiceBootstrapStatus> {
  const [retrieval, cards] = await Promise.all([
    getRetrievalBootstrapStatus(),
    getCardBootstrapStatus(),
  ]);
  const missingBootstrapSteps: Array<'npm run index' | 'npm run seed:cards'> = [];
  const errors: string[] = [];

  if (!retrieval.ready) {
    if (retrieval.missingStep) missingBootstrapSteps.push(retrieval.missingStep);
    if (retrieval.error) errors.push(retrieval.error);
  }

  if (!cards.ready) {
    if (cards.missingStep) missingBootstrapSteps.push(cards.missingStep);
    if (cards.error) errors.push(cards.error);
  }

  const bootstrapReady = missingBootstrapSteps.length === 0 && errors.length === 0;

  return {
    ready: ready && bootstrapReady,
    bootstrapReady,
    warmingUp: bootstrapReady && !ready,
    indexSize: retrieval.indexSize,
    cardCount: cards.cardCount,
    ruleQueriesReady: retrieval.ready,
    cardQueriesReady: cards.ready,
    askReady: retrieval.ready && cards.ready,
    missingBootstrapSteps,
    errors,
  };
}

/**
 * Best-effort recovery hook for health checks. If bootstrap prerequisites now
 * exist but the process has not finished initializing yet, kick initialization
 * once so `/api/health` can converge back to ready without waiting for an
 * `/api/ask` request.
 */
export async function refreshInitializationIfReady(): Promise<void> {
  if (ready || initPromise) {
    if (initPromise) {
      await initPromise.catch(() => {});
    }
    return;
  }

  const status = await getBootstrapStatus();
  if (!status.bootstrapReady) return;

  await initialize().catch(() => {});
}

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type EmitFn = (event: string, data: unknown) => Promise<void>;

export interface AskOptions {
  history?: HistoryMessage[];
  /** Campaign UUID — reserved for future campaign context loading. */
  campaignId?: string;
  /** User UUID — reserved for future player context loading. */
  userId?: string;
  /** SSE emit callback. When provided, the agent streams text deltas and tool events. */
  emit?: EmitFn;
}

/**
 * Answer a Frosthaven rules question using the knowledge agent.
 * The agent decides which tools to call based on the question,
 * iterates until it has enough context, then produces a grounded answer.
 */
export async function ask(question: string, options?: AskOptions): Promise<string> {
  if (!ready) await initialize();

  return runAgentLoop(question, options);
}
