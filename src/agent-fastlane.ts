/**
 * Fast lane for the two-lane knowledge agent (ADR 0026, SQR-399).
 *
 * Single-fact lookups and simple rules definitions skip the LangGraph loop:
 * deterministic classification, speculative retrieval fired immediately, and
 * one Haiku-class synthesis call that streams prose LIVE from the retrieved
 * bundle. Everything else — multi-hop, traversal, comparisons, campaign
 * context, writes — stays on the deep lane, as does any fast-lane question
 * whose retrieval comes back empty or whose synthesis reports insufficient
 * evidence (the correctness backstop).
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  ANSWER_FORMATTING_PROMPT,
  createFirstAnswerTokenTracker,
  emptyTokenUsage,
  executeToolCall,
  isToolResultOk,
  summarizeToolOutput,
  tokenUsageFromMessage,
  type AgentRunResult,
  type ToolCallResult,
  type ToolTrajectoryStep,
} from './agent.ts';
import type { AskOptions } from './service.ts';
import { requireGameId } from './game.ts';

type Message = Anthropic.Message;

export const FAST_LANE_MODEL = 'claude-haiku-4-5';
const FAST_LANE_MAX_OUTPUT_TOKENS = 1024;
const FAST_LANE_RUNTIME_PREFIX = 'fastlane';

/**
 * Exact sentinel the synthesis model outputs (as its ENTIRE response) when
 * the retrieved evidence cannot answer the question. Never streamed to the
 * browser: the delta gate below withholds output until the prefix is ruled
 * out, then streams live.
 */
export const INSUFFICIENT_EVIDENCE_SENTINEL = 'INSUFFICIENT_EVIDENCE';

export const FAST_LANE_SYNTHESIS_PROMPT = `You are Squire, a Frosthaven and Gloomhaven (2nd Edition) rules assistant. Answer the user's question using ONLY the retrieved evidence provided in the message.

Rules:
- Treat the retrieved evidence as the source of truth. Never invent rules, stats, numbers, or section text.
- Report record properties (spent, lost, uses, cost, slot, level) exactly as the evidence states them. Never infer usage or loss behavior from general game knowledge — if the evidence says lost is false, the item is not lost, no matter what similar items do.
- Answer every part the question asks for. If the evidence covers only part of the question, or none of it, reply with exactly ${INSUFFICIENT_EVIDENCE_SENTINEL} and nothing else.
- If a field the question asks about is genuinely absent from the evidence record, reply with exactly ${INSUFFICIENT_EVIDENCE_SENTINEL} and nothing else — do not answer with "not available".
- Cite the book, section, scenario, or card source when the evidence provides one.
- Be concise; the reader is mid-game at a table.

${ANSWER_FORMATTING_PROMPT}`;

const client = new Anthropic();

export type LaneDecision = 'fast' | 'deep';

// Patterns that force the deep lane: traversal/multi-hop shapes, comparisons,
// and write intent. Campaign context is checked structurally, not by text.
const DEEP_LANE_PATTERNS: RegExp[] = [
  /\b(?:unlock(?:s|ed)?|leads?\s+to|chain|conclusion|read[-\s]?now|next\s+(?:scenario|section)|links?\s+(?:to|onward)|belongs?\s+to|attached\s+to|parent)\b/i,
  /\bcompare|versus|\bvs\.?\b|difference between|which is better\b/i,
  /\b(?:record|mark|save|update|apply|confirm|stage|undo|create|invite|retire|delete|rename)\b.*\b(?:campaign|character|scenario list|prosperity|roster)\b/i,
  /\bwhat unlocks\b/i,
];

// Patterns that qualify for the fast lane: one record, one definition, one
// procedure. Anything that matches neither list abstains to the deep lane.
const FAST_LANE_PATTERNS: RegExp[] = [
  /\bwhat (?:is|are|does|do|happens|order)\b/i,
  /\bhow (?:does|do|is|are|many|much)\b/i,
  /\bwhen (?:is|are|do|does|can|i|you|a|my)\b/i,
  /\bcan (?:i|you|a|an|my|monsters?|characters?|allies)\b/i,
  /\bdo (?:i|you|we|they|monsters?|characters?|summons)\b/i,
  /\bdoes (?:it|that|this|a|an|the|my)\b/i,
  /\bis (?:my|a|an|the|this|that|it)\b/i,
  /\bif\b.{0,80}\b(?:do|does|is|are|can|will|which)\b/i,
  /\b(?:item|scenario|section|building|battle goal|personal quest)\s*#?\d/i,
  /\bstats? of\b/i,
  /\bwhich way do you round\b/i,
  /\binitiative\b/i,
];

/**
 * Deterministic lane routing (ADR 0026). Abstains to the deep lane — the
 * fast lane must only take questions it can answer with one retrieval and
 * one synthesis.
 */
export function classifyQuestionLane(question: string, options?: AskOptions): LaneDecision {
  // Campaign state and writes always take the deep lane, structurally.
  if (options?.campaignContext || options?.campaignId) return 'deep';
  if (options?.toolSurface === 'legacy') return 'deep';
  if (DEEP_LANE_PATTERNS.some((pattern) => pattern.test(question))) return 'deep';
  if (FAST_LANE_PATTERNS.some((pattern) => pattern.test(question))) return 'fast';
  return 'deep';
}

// lookup_entity fires unconditionally in parallel with search: it costs no
// wall-clock (concurrent) and named-record questions ("What do Crude Boots
// do?") need the FULL opened record — synthesis from search snippets alone
// produced truncated answers in the first dev runs (SQR-399).

interface FastLaneToolRun {
  step: ToolTrajectoryStep;
  result: ToolCallResult | null;
  ok: boolean;
}

async function runFastLaneTool(
  name: string,
  input: Record<string, unknown>,
  options: AskOptions | undefined,
  id: string,
): Promise<FastLaneToolRun> {
  const emit = options?.emit;
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  if (emit) await emit('tool_call', { name, input });

  const game = options?.game === undefined ? undefined : requireGameId(options.game);
  let result: ToolCallResult | null = null;
  let errorMessage: string | undefined;
  try {
    result = await executeToolCall(name, input, {
      game,
      userId: options?.userId,
    });
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  const endedAtMs = Date.now();
  const ok = result !== null && errorMessage === undefined && isToolResultOk(result);
  // Game-qualify legacy refs exactly like the deep lane (SQR-381) so the
  // groundedness scorer never reads a GH2e record as a wrong-game ref.
  const { summary, canonicalRefs } = summarizeToolOutput(result?.content ?? errorMessage ?? '', {
    game,
  });
  const step: ToolTrajectoryStep = {
    iteration: 0,
    id,
    name,
    input,
    ok,
    outputSummary: summary,
    sourceLabels: result?.sourceBooks ?? [],
    canonicalRefs,
    ...(errorMessage ? { error: errorMessage } : {}),
    startedAt,
    endedAt: new Date(endedAtMs).toISOString(),
    durationMs: endedAtMs - startedAtMs,
  };

  if (emit) {
    await emit('tool_result', {
      name,
      ok,
      message: ok
        ? name === 'lookup_entity'
          ? 'Looked up the exact record'
          : 'Searched available sources'
        : name === 'lookup_entity'
          ? "Couldn't look up the exact record"
          : "Couldn't search available sources",
      sourceBooks: result?.sourceBooks,
    });
  }

  return { step, result, ok };
}

function hasSearchEvidence(run: FastLaneToolRun): boolean {
  if (!run.ok || !run.result) return false;
  try {
    const parsed = JSON.parse(run.result.content) as { results?: unknown[] };
    return Array.isArray(parsed.results) && parsed.results.length > 0;
  } catch {
    return false;
  }
}

function hasLookupEvidence(run: FastLaneToolRun | null): boolean {
  if (!run?.ok || !run.result) return false;
  try {
    const parsed = JSON.parse(run.result.content) as { ok?: unknown; entity?: unknown };
    return parsed.ok === true && parsed.entity !== undefined && parsed.entity !== null;
  } catch {
    return false;
  }
}

/** Compact the evidence payload the synthesis call reads. */
function evidenceBlock(searchRun: FastLaneToolRun, lookupRun: FastLaneToolRun | null): string {
  const parts: string[] = [];
  if (hasLookupEvidence(lookupRun) && lookupRun?.result) {
    parts.push(`<exact-record>\n${compactJson(lookupRun.result.content)}\n</exact-record>`);
  }
  if (hasSearchEvidence(searchRun) && searchRun.result) {
    parts.push(`<search-results>\n${compactJson(searchRun.result.content)}\n</search-results>`);
  }
  return parts.join('\n');
}

function compactJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content));
  } catch {
    return content;
  }
}

export interface FastLaneConfig {
  model?: string;
  maxOutputTokens?: number;
}

/**
 * Run the fast lane. Returns null when the question should fall through to
 * the deep lane: classifier abstained upstream, retrieval found nothing, or
 * synthesis reported insufficient evidence. Callers treat null as "run the
 * LangGraph loop as before".
 */
export async function runFastLane(
  question: string,
  options?: AskOptions,
  config: FastLaneConfig = {},
): Promise<AgentRunResult | null> {
  if (process.env.SQUIRE_DISABLE_FAST_LANE === '1') return null;
  const startedAtMs = Date.now();
  const tracker = createFirstAnswerTokenTracker(options?.emit, startedAtMs);

  // Speculative retrieval: both calls leave immediately, no planner first.
  const searchPromise = runFastLaneTool(
    'search_knowledge',
    { query: question, limit: 6 },
    options,
    'fastlane_search_1',
  );
  const lookupPromise = runFastLaneTool(
    'lookup_entity',
    { query: question },
    options,
    'fastlane_lookup_1',
  );

  const [searchRun, lookupRun] = await Promise.all([searchPromise, lookupPromise]);
  const toolCalls = [searchRun.step, ...(lookupRun ? [lookupRun.step] : [])];

  if (!hasSearchEvidence(searchRun) && !hasLookupEvidence(lookupRun)) return null;

  const modelId = config.model ?? FAST_LANE_MODEL;
  const synthesisStartedAtMs = Date.now();
  const stream = client.messages.stream({
    model: modelId,
    max_tokens: config.maxOutputTokens ?? FAST_LANE_MAX_OUTPUT_TOKENS,
    system: [
      {
        type: 'text',
        text: FAST_LANE_SYNTHESIS_PROMPT,
        cache_control: { type: 'ephemeral', ttl: '1h' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: `${question}\n\n<retrieved-evidence>\n${evidenceBlock(searchRun, lookupRun)}\n</retrieved-evidence>`,
      },
    ],
  });

  // Live streaming with a sentinel gate: hold deltas only until the
  // INSUFFICIENT_EVIDENCE prefix is ruled out, then pass through in order.
  let gateBuffer = '';
  let gateOpen = false;
  let suppressed = false;
  let emitChain: Promise<void> = Promise.resolve();
  const pushDelta = (delta: string) => {
    emitChain = emitChain.then(async () => {
      tracker.recordTextDelta(delta);
      if (tracker.emit) await tracker.emit('text', { delta });
    });
  };
  stream.on('text', (delta: string) => {
    if (suppressed || delta.length === 0) return;
    if (gateOpen) {
      pushDelta(delta);
      return;
    }
    gateBuffer += delta;
    if (gateBuffer.length < INSUFFICIENT_EVIDENCE_SENTINEL.length) {
      if (!INSUFFICIENT_EVIDENCE_SENTINEL.startsWith(gateBuffer)) {
        gateOpen = true;
        pushDelta(gateBuffer);
      }
      return;
    }
    if (gateBuffer.startsWith(INSUFFICIENT_EVIDENCE_SENTINEL)) {
      suppressed = true;
      return;
    }
    gateOpen = true;
    pushDelta(gateBuffer);
  });

  const message: Message = await stream.finalMessage();
  await emitChain;

  const answer = message.content
    .filter((block): block is Extract<Message['content'][number], { type: 'text' }> => {
      return block.type === 'text';
    })
    .map((block) => block.text)
    .join('\n\n')
    .trim();

  if (suppressed || answer.startsWith(INSUFFICIENT_EVIDENCE_SENTINEL)) return null;
  // Short answer never opened the gate (shorter than the sentinel): flush.
  if (!gateOpen && !suppressed && answer.length > 0) pushDelta(answer);
  await emitChain;
  if (tracker.emit) await tracker.emit('done', {});

  const synthesisEndedAtMs = Date.now();
  const tokenUsage = emptyTokenUsage();
  const usage = tokenUsageFromMessage(message);
  tokenUsage.inputTokens = usage.inputTokens;
  tokenUsage.outputTokens = usage.outputTokens;
  tokenUsage.cacheCreationInputTokens = usage.cacheCreationInputTokens;
  tokenUsage.cacheReadInputTokens = usage.cacheReadInputTokens;
  tokenUsage.totalTokens = usage.totalTokens;

  return {
    answer,
    trajectory: {
      toolCalls,
      modelCalls: [
        {
          iteration: 1,
          model: modelId,
          stopReason: message.stop_reason,
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
          cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
          content: message.content,
          startedAt: new Date(synthesisStartedAtMs).toISOString(),
          endedAt: new Date(synthesisEndedAtMs).toISOString(),
          durationMs: synthesisEndedAtMs - synthesisStartedAtMs,
        },
      ],
      finalAnswer: answer,
      ...tracker.timing(),
      tokenUsage,
      model: `${FAST_LANE_RUNTIME_PREFIX}:${modelId}`,
      iterations: 1,
      stopReason: message.stop_reason,
    },
  };
}

/**
 * Lane router used by both production and eval entry points: classify, try
 * the fast lane, fall through to the deep lane on null.
 */
export async function maybeRunFastLane(
  question: string,
  options?: AskOptions,
  config: FastLaneConfig = {},
): Promise<AgentRunResult | null> {
  if (classifyQuestionLane(question, options) !== 'fast') return null;
  return runFastLane(question, options, config);
}
