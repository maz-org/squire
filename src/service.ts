/**
 * Squire knowledge service.
 * Provides initialization, readiness checks, and the knowledge agent.
 */

import { embed } from './embedder.ts';
import {
  EMBEDDINGS_BOOTSTRAP_MESSAGE,
  type RetrievalBootstrapStatus,
  getRetrievalBootstrapStatus,
  initializeRetrieval,
} from './vector-store.ts';
import { listCardTypes } from './tools.ts';
import { runAgentLoop } from './agent.ts';

const CARD_BOOTSTRAP_MESSAGE = 'No card data found in Postgres. Run `npm run seed:cards` first.';
const CARD_DB_HINT =
  'Is Postgres running? Try `docker compose up -d` and `npm run db:migrate`.';
const WARMING_UP_MESSAGE = 'Service is warming up. Retry in a moment.';
const INIT_FAILED_MESSAGE = 'Service warmup failed. Check server logs and retry.';
const BOOTSTRAP_POLL_MS = 5000;

type MissingBootstrapStep = 'npm run index' | 'npm run seed:cards';

export type BootstrapLifecycle =
  | 'boot_blocked'
  | 'warming_up'
  | 'ready'
  | 'dependency_failed'
  | 'init_failed';

export type CapabilityReason =
  | 'missing_index'
  | 'missing_cards'
  | 'dependency_unavailable'
  | 'warming_up'
  | 'init_failed';

interface CardBootstrapStatus {
  ready: boolean;
  cardCount: number;
  error?: string;
  missingStep?: 'npm run seed:cards';
  reason?: 'missing_cards' | 'dependency_unavailable';
}

export interface CapabilityStatus {
  allowed: boolean;
  reason: CapabilityReason | null;
  message: string | null;
}

export interface ServiceBootstrapStatus {
  lifecycle: BootstrapLifecycle;
  ready: boolean;
  bootstrapReady: boolean;
  warmingUp: boolean;
  indexSize: number;
  cardCount: number;
  ruleQueriesReady: boolean;
  cardQueriesReady: boolean;
  askReady: boolean;
  missingBootstrapSteps: MissingBootstrapStep[];
  errors: string[];
  capabilities: {
    rules: CapabilityStatus;
    cards: CapabilityStatus;
    ask: CapabilityStatus;
  };
}

let initialized = false;
let initPromise: Promise<void> | null = null;
let initErrorMessage: string | null = null;
let lifecycle: BootstrapLifecycle = 'boot_blocked';
let bootstrapPoller: ReturnType<typeof setInterval> | null = null;
let bootstrapRefreshPromise: Promise<ServiceBootstrapStatus> | null = null;
let bootstrapStatusReady = false;
let lastBootstrapLogSignature: string | null = null;

let bootstrapStatus: ServiceBootstrapStatus = {
  lifecycle,
  ready: false,
  bootstrapReady: false,
  warmingUp: false,
  indexSize: 0,
  cardCount: 0,
  ruleQueriesReady: false,
  cardQueriesReady: false,
  askReady: false,
  missingBootstrapSteps: [],
  errors: [],
  capabilities: {
    rules: { allowed: false, reason: 'missing_index', message: EMBEDDINGS_BOOTSTRAP_MESSAGE },
    cards: { allowed: false, reason: 'missing_cards', message: CARD_BOOTSTRAP_MESSAGE },
    ask: { allowed: false, reason: 'missing_index', message: EMBEDDINGS_BOOTSTRAP_MESSAGE },
  },
};

/** @internal Reset service state for testing. */
export function _resetForTesting(): void {
  initialized = false;
  initPromise = null;
  initErrorMessage = null;
  lifecycle = 'boot_blocked';
  bootstrapRefreshPromise = null;
  bootstrapStatusReady = false;
  lastBootstrapLogSignature = null;
  if (bootstrapPoller) {
    clearInterval(bootstrapPoller);
    bootstrapPoller = null;
  }
  bootstrapStatus = {
    lifecycle,
    ready: false,
    bootstrapReady: false,
    warmingUp: false,
    indexSize: 0,
    cardCount: 0,
    ruleQueriesReady: false,
    cardQueriesReady: false,
    askReady: false,
    missingBootstrapSteps: [],
    errors: [],
    capabilities: {
      rules: { allowed: false, reason: 'missing_index', message: EMBEDDINGS_BOOTSTRAP_MESSAGE },
      cards: { allowed: false, reason: 'missing_cards', message: CARD_BOOTSTRAP_MESSAGE },
      ask: { allowed: false, reason: 'missing_index', message: EMBEDDINGS_BOOTSTRAP_MESSAGE },
    },
  };
}

/**
 * Initialize the service: load the vector index, warm the embedder, and
 * verify extracted data is available. Safe to call concurrently.
 */
export async function initialize(): Promise<void> {
  if (initialized && lifecycle === 'ready') return;
  if (initPromise) return initPromise;

  const snapshot = await refreshBootstrapState();
  if (!snapshot.bootstrapReady) {
    throw new Error(snapshot.capabilities.ask.message ?? snapshot.errors[0] ?? EMBEDDINGS_BOOTSTRAP_MESSAGE);
  }

  lifecycle = 'warming_up';
  bootstrapStatus = buildBootstrapStatus(
    snapshot.lifecycle === 'dependency_failed'
      ? {
          ready: false,
          indexSize: snapshot.indexSize,
          error: snapshot.errors[0],
          reason: 'dependency_unavailable',
        }
      : { ready: true, indexSize: snapshot.indexSize },
    snapshot.lifecycle === 'dependency_failed'
      ? {
          ready: false,
          cardCount: snapshot.cardCount,
          error: snapshot.errors[0],
          reason: 'dependency_unavailable',
        }
      : { ready: true, cardCount: snapshot.cardCount },
  );

  initPromise = doInitialize()
    .then(() => {
      initialized = true;
      initErrorMessage = null;
      lifecycle = 'ready';
    })
    .catch((err) => {
      initialized = false;
      initErrorMessage = err instanceof Error ? err.message : String(err);
      lifecycle = 'init_failed';
      throw err;
    })
    .finally(async () => {
      initPromise = null;
      await refreshBootstrapState();
    });

  return initPromise;
}

async function doInitialize(): Promise<void> {
  await initializeRetrieval(embed);
}

/**
 * Whether the service has been initialized and is ready to serve requests.
 */
export function isReady(): boolean {
  return initialized && lifecycle === 'ready';
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
        reason: 'missing_cards',
      };
    }
    return { ready: true, cardCount: totalCards };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ready: false,
      cardCount: 0,
      error: `card data query failed: ${message}. ${CARD_DB_HINT}`,
      reason: 'dependency_unavailable',
    };
  }
}

function buildCapabilityStatus(
  kind: BootstrapLifecycle,
  scope: 'rules' | 'cards' | 'ask',
  retrieval: RetrievalBootstrapStatus,
  cards: CardBootstrapStatus,
): CapabilityStatus {
  if (kind === 'ready') return { allowed: true, reason: null, message: null };

  if (kind === 'dependency_failed') {
    const message = retrieval.error ?? cards.error ?? CARD_DB_HINT;
    return { allowed: false, reason: 'dependency_unavailable', message };
  }

  if (scope === 'rules') {
    if (retrieval.ready) return { allowed: true, reason: null, message: null };
    return {
      allowed: false,
      reason: retrieval.reason ?? 'missing_index',
      message: retrieval.error ?? EMBEDDINGS_BOOTSTRAP_MESSAGE,
    };
  }

  if (scope === 'cards') {
    if (cards.ready) return { allowed: true, reason: null, message: null };
    return {
      allowed: false,
      reason: cards.reason ?? 'missing_cards',
      message: cards.error ?? CARD_BOOTSTRAP_MESSAGE,
    };
  }

  if (kind === 'warming_up') {
    return { allowed: false, reason: 'warming_up', message: WARMING_UP_MESSAGE };
  }

  if (kind === 'init_failed') {
    return {
      allowed: false,
      reason: 'init_failed',
      message: initErrorMessage ?? INIT_FAILED_MESSAGE,
    };
  }

  if (!retrieval.ready) {
    return {
      allowed: false,
      reason: retrieval.reason ?? 'missing_index',
      message: retrieval.error ?? EMBEDDINGS_BOOTSTRAP_MESSAGE,
    };
  }

  if (!cards.ready) {
    return {
      allowed: false,
      reason: cards.reason ?? 'missing_cards',
      message: cards.error ?? CARD_BOOTSTRAP_MESSAGE,
    };
  }

  return { allowed: false, reason: 'warming_up', message: WARMING_UP_MESSAGE };
}

function buildBootstrapStatus(
  retrieval: RetrievalBootstrapStatus,
  cards: CardBootstrapStatus,
): ServiceBootstrapStatus {
  const missingBootstrapSteps: MissingBootstrapStep[] = [];
  const errors: string[] = [];

  if (!retrieval.ready) {
    if (retrieval.missingStep) missingBootstrapSteps.push(retrieval.missingStep);
    if (retrieval.error) errors.push(retrieval.error);
  }

  if (!cards.ready) {
    if (cards.missingStep) missingBootstrapSteps.push(cards.missingStep);
    if (cards.error) errors.push(cards.error);
  }

  const dependencyUnavailable =
    retrieval.reason === 'dependency_unavailable' || cards.reason === 'dependency_unavailable';
  const bootstrapReady = retrieval.ready && cards.ready;

  if (dependencyUnavailable) {
    lifecycle = 'dependency_failed';
  } else if (!bootstrapReady) {
    lifecycle = 'boot_blocked';
  } else if (initialized) {
    lifecycle = 'ready';
  } else if (initPromise) {
    lifecycle = 'warming_up';
  } else if (initErrorMessage) {
    lifecycle = 'init_failed';
  } else {
    lifecycle = 'warming_up';
  }

  const capabilities = {
    rules: buildCapabilityStatus(lifecycle, 'rules', retrieval, cards),
    cards: buildCapabilityStatus(lifecycle, 'cards', retrieval, cards),
    ask: buildCapabilityStatus(lifecycle, 'ask', retrieval, cards),
  };

  return {
    lifecycle,
    ready: lifecycle === 'ready',
    bootstrapReady,
    warmingUp: lifecycle === 'warming_up',
    indexSize: retrieval.indexSize,
    cardCount: cards.cardCount,
    ruleQueriesReady: capabilities.rules.allowed,
    cardQueriesReady: capabilities.cards.allowed,
    askReady: capabilities.ask.allowed,
    missingBootstrapSteps,
    errors,
    capabilities,
  };
}

function logBootstrapTransition(status: ServiceBootstrapStatus): void {
  const signature = `${status.lifecycle}|${status.errors.join('|')}`;
  if (signature === lastBootstrapLogSignature) return;
  lastBootstrapLogSignature = signature;

  if (status.lifecycle === 'ready') {
    console.log('Squire bootstrap ready.');
    return;
  }

  const detail = status.errors[0];
  if (detail) {
    console.warn(`Squire bootstrap ${status.lifecycle}: ${detail}`);
    return;
  }

  if (status.lifecycle === 'warming_up') {
    console.log('Squire bootstrap warming up.');
    return;
  }

  console.warn(`Squire bootstrap ${status.lifecycle}.`);
}

export async function refreshBootstrapState(): Promise<ServiceBootstrapStatus> {
  if (bootstrapRefreshPromise) return bootstrapRefreshPromise;

  bootstrapRefreshPromise = (async () => {
  const [retrieval, cards] = await Promise.all([
    getRetrievalBootstrapStatus(),
    getCardBootstrapStatus(),
  ]);
    bootstrapStatus = buildBootstrapStatus(retrieval, cards);
    bootstrapStatusReady = true;
    logBootstrapTransition(bootstrapStatus);
    return bootstrapStatus;
  })().finally(() => {
    bootstrapRefreshPromise = null;
  });

  return bootstrapRefreshPromise;
}

export async function getBootstrapStatus(): Promise<ServiceBootstrapStatus> {
  if (!bootstrapStatusReady) return refreshBootstrapState();
  return bootstrapStatus;
}

export function startBootstrapLifecycle(): void {
  if (bootstrapPoller) return;

  const tick = async (): Promise<void> => {
    const status = await refreshBootstrapState();
    if (status.bootstrapReady && !status.ready && !initPromise) {
      void initialize().catch(() => {});
    }
  };

  void tick();
  bootstrapPoller = setInterval(() => {
    void tick();
  }, BOOTSTRAP_POLL_MS);
  bootstrapPoller.unref?.();
}

/**
 * Deprecated compatibility hook for earlier tests and callers. Performs a
 * non-blocking state refresh and kicks background initialization when
 * prerequisites are available.
 */
export async function refreshInitializationIfReady(): Promise<void> {
  const status = await refreshBootstrapState();
  if (status.bootstrapReady && !status.ready && !initPromise) {
    void initialize().catch(() => {});
  }
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
  if (!isReady()) await initialize();
  return runAgentLoop(question, options);
}
