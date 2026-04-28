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
import {
  SCENARIO_SECTION_BOOKS_BOOTSTRAP_MESSAGE,
  type ScenarioSectionBooksBootstrapStatus,
  getScenarioSectionBooksBootstrapStatus,
} from './scenario-section-data.ts';

const CARD_BOOTSTRAP_MESSAGE = 'No card data found in Postgres. Run `npm run seed:cards` first.';
const CARD_DB_HINT = 'Is Postgres running? Try `docker compose up -d` and `npm run db:migrate`.';
const WARMING_UP_MESSAGE = 'Service is warming up. Retry in a moment.';
const INIT_FAILED_MESSAGE = 'Service warmup failed. Check server logs and retry.';
const BOOTSTRAP_POLL_MS = 5000;

type MissingBootstrapStep =
  | 'npm run index'
  | 'npm run seed:cards'
  | 'npm run seed:scenario-section-books';

export type BootstrapLifecycle =
  | 'starting'
  | 'boot_blocked'
  | 'warming_up'
  | 'ready'
  | 'dependency_failed'
  | 'init_failed';

export type CapabilityReason =
  | 'missing_index'
  | 'missing_cards'
  | 'missing_scenario_section_books'
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

/**
 * Lifecycle contract
 *
 * starting
 *   Process is listening, but no live probe has completed yet.
 * boot_blocked
 *   Dependencies are reachable, but required bootstrap data is missing.
 * warming_up
 *   Bootstrap prerequisites exist and warmup is currently in flight.
 * ready
 *   Warmup completed successfully.
 * dependency_failed
 *   A required dependency probe failed.
 * init_failed
 *   Warmup itself failed after prerequisites were available.
 *
 * Transition sketch
 *   starting -> boot_blocked | warming_up | dependency_failed
 *   boot_blocked -> warming_up | dependency_failed
 *   warming_up -> ready | init_failed | dependency_failed
 *   ready -> boot_blocked | dependency_failed
 *   dependency_failed -> boot_blocked | warming_up
 *   init_failed -> warming_up | dependency_failed | boot_blocked
 *
 * Extension rules
 *   1. Keep health on snapshot reads only. Do not add live probes to
 *      getBootstrapStatus().
 *   2. A capability may be allowed only if every dependency it exercises on
 *      the request path is healthy. Example: rules require embeddings AND the
 *      embedder, so init_failed must block them.
 *   3. When adding a capability, update the capability map, endpoint policy,
 *      and lifecycle tests together.
 */
let initialized = false;
let initPromise: Promise<void> | null = null;
let initErrorMessage: string | null = null;
let lifecycle: BootstrapLifecycle = 'starting';
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
    rules: { allowed: false, reason: 'warming_up', message: WARMING_UP_MESSAGE },
    cards: { allowed: false, reason: 'warming_up', message: WARMING_UP_MESSAGE },
    ask: { allowed: false, reason: 'warming_up', message: WARMING_UP_MESSAGE },
  },
};

/** @internal Reset service state for testing. */
export function _resetForTesting(): void {
  initialized = false;
  initPromise = null;
  initErrorMessage = null;
  lifecycle = 'starting';
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
      rules: { allowed: false, reason: 'warming_up', message: WARMING_UP_MESSAGE },
      cards: { allowed: false, reason: 'warming_up', message: WARMING_UP_MESSAGE },
      ask: { allowed: false, reason: 'warming_up', message: WARMING_UP_MESSAGE },
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
    throw new Error(
      snapshot.capabilities.ask.message ?? snapshot.errors[0] ?? EMBEDDINGS_BOOTSTRAP_MESSAGE,
    );
  }

  // A retry is a fresh warmup attempt, so clear the stale terminal error
  // before rebuilding the in-flight snapshot.
  initErrorMessage = null;
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
    snapshot.lifecycle === 'dependency_failed'
      ? {
          ready: false,
          scenarioCount: 0,
          sectionCount: 0,
          linkCount: 0,
          error: snapshot.errors[0],
          reason: 'dependency_unavailable',
        }
      : { ready: true, scenarioCount: 1, sectionCount: 1, linkCount: 1 },
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
  scenarioSectionBooks: ScenarioSectionBooksBootstrapStatus,
): CapabilityStatus {
  if (kind === 'ready') return { allowed: true, reason: null, message: null };

  if (kind === 'init_failed' && scope !== 'cards') {
    return {
      allowed: false,
      reason: 'init_failed',
      message: initErrorMessage ?? INIT_FAILED_MESSAGE,
    };
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

  if (!scenarioSectionBooks.ready) {
    return {
      allowed: false,
      reason: scenarioSectionBooks.reason ?? 'missing_scenario_section_books',
      message: scenarioSectionBooks.error ?? SCENARIO_SECTION_BOOKS_BOOTSTRAP_MESSAGE,
    };
  }

  return { allowed: false, reason: 'warming_up', message: WARMING_UP_MESSAGE };
}

function buildBootstrapStatus(
  retrieval: RetrievalBootstrapStatus,
  cards: CardBootstrapStatus,
  scenarioSectionBooks: ScenarioSectionBooksBootstrapStatus,
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

  if (!scenarioSectionBooks.ready) {
    if (scenarioSectionBooks.missingStep)
      missingBootstrapSteps.push(scenarioSectionBooks.missingStep);
    if (scenarioSectionBooks.error) errors.push(scenarioSectionBooks.error);
  }

  const dependencyUnavailable =
    retrieval.reason === 'dependency_unavailable' ||
    cards.reason === 'dependency_unavailable' ||
    scenarioSectionBooks.reason === 'dependency_unavailable';
  const bootstrapReady = retrieval.ready && cards.ready && scenarioSectionBooks.ready;

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
    rules: buildCapabilityStatus(lifecycle, 'rules', retrieval, cards, scenarioSectionBooks),
    cards: buildCapabilityStatus(lifecycle, 'cards', retrieval, cards, scenarioSectionBooks),
    ask: buildCapabilityStatus(lifecycle, 'ask', retrieval, cards, scenarioSectionBooks),
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
    const [retrieval, cards, scenarioSectionBooks] = await Promise.all([
      getRetrievalBootstrapStatus(),
      getCardBootstrapStatus(),
      getScenarioSectionBooksBootstrapStatus(),
    ]);
    bootstrapStatus = buildBootstrapStatus(retrieval, cards, scenarioSectionBooks);
    bootstrapStatusReady = true;
    logBootstrapTransition(bootstrapStatus);
    return bootstrapStatus;
  })().finally(() => {
    bootstrapRefreshPromise = null;
  });

  return bootstrapRefreshPromise;
}

/**
 * Snapshot-only read for health and other observers. This must never trigger
 * live bootstrap probes or await dependency checks on the request path.
 */
export function getBootstrapStatus(): ServiceBootstrapStatus {
  return bootstrapStatus;
}

/**
 * Resolve bootstrap status for admission-control paths. This may perform live
 * dependency probes until the first real snapshot has been established.
 */
export async function ensureBootstrapStatus(): Promise<ServiceBootstrapStatus> {
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
  /**
   * Default uses the redesigned self-describing knowledge tools. `legacy`
   * keeps the old tool surface selectable until eval parity closes Step 3.
   */
  toolSurface?: 'redesigned' | 'legacy';
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
