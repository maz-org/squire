/**
 * Squire knowledge service.
 * Provides initialization, readiness checks, and the bundled RAG convenience path.
 */

import Anthropic from '@anthropic-ai/sdk';
import { embed } from './embedder.ts';
import { loadIndex } from './vector-store.ts';
import { searchRules, searchCards, listCardTypes } from './tools.ts';
import type { RuleResult, CardResult } from './tools.ts';

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a knowledgeable Frosthaven rules assistant. \
Answer questions accurately based on the rulebook excerpts and card data provided. \
Be concise but complete. If the provided data doesn't contain enough information to answer confidently, say so. \
Do not invent rules, stats, or item numbers.`;

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
  const index = loadIndex();
  if (index.length === 0) {
    throw new Error('Vector index is empty. Run `npm run index` first.');
  }

  // Verify extracted data is available
  const types = listCardTypes();
  const totalCards = types.reduce((sum, t) => sum + t.count, 0);
  if (totalCards === 0) {
    throw new Error('No extracted card data found. Run `npm run extract` first.');
  }

  // Warm the embedder so the first real query doesn't pay the cold-start cost
  await embed('warmup');

  ready = true;
}

/**
 * Whether the service has been initialized and is ready to serve requests.
 */
export function isReady(): boolean {
  return ready;
}

/** Maximum number of history messages to include in the LLM call. */
const MAX_HISTORY_TURNS = 20;

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Answer a Frosthaven rules question using the bundled RAG pipeline.
 * This is the "graduated optimization" convenience path — it composes
 * the atomic tools (searchRules, searchCards) with an LLM call.
 *
 * @param history - Optional conversation history for multi-turn context.
 *   Truncated to the last {@link MAX_HISTORY_TURNS} messages.
 */
export async function ask(question: string, history?: HistoryMessage[]): Promise<string> {
  if (!ready) {
    throw new Error('Service not initialized. Call initialize() first.');
  }

  // Step 1: Search for relevant rulebook passages and card data
  const ruleHits: RuleResult[] = await searchRules(question, 6);
  const cardHits: CardResult[] = searchCards(question, 8);

  // Step 2: Assemble context
  const rulebookContext = ruleHits
    .map((h, i) => `[${i + 1}] (${h.source})\n${h.text}`)
    .join('\n\n---\n\n');

  const cardContext =
    cardHits.length > 0
      ? `\n\n## Card Data\n${cardHits.map((c) => `[${c.type}] ${JSON.stringify(c.data)}`).join('\n')}`
      : '';

  const userMessage = `## Rulebook Excerpts\n\n${rulebookContext}${cardContext}\n\n---\n\nQuestion: ${question}`;

  // Step 3: Build messages array with optional history
  const truncatedHistory = history ? history.slice(-MAX_HISTORY_TURNS) : [];
  const messages = [
    ...truncatedHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: userMessage },
  ];

  // Step 4: LLM generation
  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages,
  });

  return response.content.find((b) => b.type === 'text')?.text ?? '';
}
