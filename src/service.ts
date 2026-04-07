/**
 * Squire knowledge service.
 * Provides initialization, readiness checks, and the knowledge agent.
 */

import { embed } from './embedder.ts';
import { initializeRetrieval } from './vector-store.ts';
import { listCardTypes } from './tools.ts';
import { runAgentLoop } from './agent.ts';

let ready = false;
let initPromise: Promise<void> | null = null;

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
  // Retrieval layer owns vector index + embedder warmup + drift guard.
  await initializeRetrieval(embed);

  // Verify extracted data is available.
  const types = listCardTypes();
  const totalCards = types.reduce((sum, t) => sum + t.count, 0);
  if (totalCards === 0) {
    throw new Error('No extracted card data found. Run `npm run extract` first.');
  }

  ready = true;
}

/**
 * Whether the service has been initialized and is ready to serve requests.
 */
export function isReady(): boolean {
  return ready;
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
  if (!ready) {
    throw new Error('Service not initialized. Call initialize() first.');
  }

  return runAgentLoop(question, options);
}
