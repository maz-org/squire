/**
 * Production LangGraph runtime for Squire's knowledge agent.
 *
 * The graph owns the planner/retriever/verifier/final-answer flow. Only the
 * final_answer node is allowed to emit answer text; all earlier nodes may emit
 * progress, tool, artifact, or debug events only.
 */

import Anthropic from '@anthropic-ai/sdk';
import { Annotation, END, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import { SpanStatusCode, trace, type Attributes } from '@opentelemetry/api';
import { randomUUID } from 'node:crypto';
import {
  MAX_AGENT_ITERATIONS,
  addUsage,
  callClaude,
  createFirstAnswerTokenTracker,
  emptyTokenUsage,
  executeToolCall,
  isToolResultOk,
  summarizeToolOutput,
  type AgentRunResult,
  type AgentRunTrajectory,
  type EvalAgentLoopOptions,
  type ModelTrajectoryStep,
  type TokenUsage,
  type ToolCallResult,
  type ToolTrajectoryStep,
} from './agent.ts';
import { maybeRunFastLane } from './agent-fastlane.ts';
import { EVIDENCE_JUDGE_MODEL, judgeEvidenceSufficiency } from './evidence-judge.ts';
import type { AgentStreamEventMap, AskOptions, EmitFn } from './service.ts';
import { requireGameId } from './game.ts';
import {
  applyCampaignContextToAskOptions,
  renderCampaignContextBlock,
} from './campaign/context.ts';
import { resolveSquireEnv } from './squire-env.ts';
import {
  activeWorkLogProgressMessageFromCompleted,
  humanizeWorkLogProgressMessage,
} from './work-log-display.ts';
import { langSmithRunReferenceFromSpan } from './langsmith-links.ts';

type Message = Anthropic.Message;
type MessageParam = Anthropic.MessageParam;
type ContentBlockParam = Anthropic.ContentBlockParam;
type MessageContentBlock = Message['content'][number];
type StopReason = Message['stop_reason'];

const AGENT_MODEL = 'claude-sonnet-4-6' as const;
const MAX_HISTORY_TURNS = 20;
const GRAPH_RUNTIME_PREFIX = 'langgraph';
const FINAL_ANSWER_PROMPT =
  'Write the final answer now using only verified tool results in this run. Do not call tools. If the verified results are insufficient, say exactly what is missing instead of guessing. If the user explicitly asked not to save, stage, or write anything, say no campaign state was saved or staged. If the user tried to make you use, cite, import, or blend another game source into a single-game answer, do not include a note about that rejected instruction and do not repeat the rejected source name or hostile phrase.';
const tracer = trace.getTracer('squire.agent');

// LangGraph treats neighbors as discovery so returned refs must be opened or
// searched before final_answer can use them.
const DISCOVERY_ONLY_TOOL_NAMES = new Set([
  'inspect_sources',
  'schema',
  'resolve_entity',
  'neighbors',
]);
const DIRECT_EVIDENCE_TOOL_NAMES = new Set([
  'lookup_entity',
  'open_entity',
  'get_card',
  'get_scenario',
  'get_section',
]);

// Rounds containing any state-writing tool stay serial: the propose→confirm
// discipline assumes writes observe the effects of earlier calls in the same
// round (SQR-407 parallel execution applies to read-only rounds only).
const WRITE_TOOL_NAMES = new Set([
  'write_campaign_state',
  'write_character_state',
  'propose_state_change',
  'confirm_state_change',
  'cancel_state_change',
  'create_campaign',
  'create_character',
  'invite_member',
]);
const graphCheckpointer = new MemorySaver();
// Dedicated client for the evidence-sufficiency judge (SQR-408); the main
// loop's calls go through callClaude.
const judgeClient = new Anthropic();

const LangGraphState = Annotation.Root({
  question: Annotation<string>(),
  messages: Annotation<MessageParam[]>(),
  lastResponse: Annotation<Message | undefined>(),
  toolCalls: Annotation<ToolTrajectoryStep[]>(),
  modelCalls: Annotation<ModelTrajectoryStep[]>(),
  tokenUsage: Annotation<TokenUsage>(),
  iterations: Annotation<number>(),
  readyToAnswer: Annotation<boolean>(),
  finalAnswer: Annotation<string>(),
  stopReason: Annotation<AgentRunTrajectory['stopReason']>(),
});

type LangGraphStateValue = typeof LangGraphState.State;

function emitGraphDebug(emit: EmitFn | undefined, message: string, data?: unknown): Promise<void> {
  if (!emit) return Promise.resolve();
  return emit('debug', data === undefined ? { message } : { message, data });
}

function textFromMessage(message: Message): string {
  return message.content
    .filter((block): block is Extract<(typeof message.content)[number], { type: 'text' }> => {
      return block.type === 'text';
    })
    .map((block) => block.text)
    .join('\n\n')
    .trim();
}

function hasToolUse(message: Message | undefined): boolean {
  return Boolean(message?.content.some((block) => block.type === 'tool_use'));
}

function toolUseBlocks(message: Message | undefined) {
  return (message?.content ?? []).filter(
    (block): block is Extract<MessageContentBlock, { type: 'tool_use' }> =>
      block.type === 'tool_use',
  );
}

function cloneUsage(usage: TokenUsage): TokenUsage {
  return { ...usage };
}

function jsonTraceAttribute(value: unknown): string {
  return JSON.stringify(value);
}

function primitiveTraceAttribute(value: unknown): string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : jsonTraceAttribute(value);
}

function langsmithUsageMetadata(usage: TokenUsage): Record<string, unknown> {
  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
    input_token_details: {
      cache_creation: usage.cacheCreationInputTokens,
      cache_read: usage.cacheReadInputTokens,
    },
  };
}

function langgraphCorrelationMetadata(options: AskOptions | undefined): Record<string, string> {
  const metadata: Record<string, string> = {
    runtime: GRAPH_RUNTIME_PREFIX,
    squireEnv: resolveSquireEnv(),
  };
  const langsmithThreadId = langsmithThreadIdFor(options);
  if (langsmithThreadId) metadata.thread_id = langsmithThreadId;
  if (options?.requestId) metadata.requestId = options.requestId;
  if (options?.conversationId) metadata.conversationId = options.conversationId;
  if (options?.userMessageId) metadata.userMessageId = options.userMessageId;
  if (options?.userId) metadata.userId = options.userId;
  if (options?.campaignId) metadata.campaignId = options.campaignId;
  if (options?.game) metadata.game = requireGameId(options.game);
  return metadata;
}

function langsmithThreadIdFor(options: AskOptions | undefined): string | undefined {
  return options?.conversationId ?? options?.userMessageId;
}

function langgraphCorrelationAttributes(options: AskOptions | undefined): Attributes {
  const attributes: Attributes = {
    'squire.env': resolveSquireEnv(),
  };
  if (options?.requestId) attributes['squire.request_id'] = options.requestId;
  if (options?.conversationId) attributes['squire.conversation_id'] = options.conversationId;
  if (options?.userMessageId) attributes['squire.user_message_id'] = options.userMessageId;
  if (options?.userId) attributes['squire.user_id'] = options.userId;
  if (options?.campaignId) attributes['squire.campaign_id'] = options.campaignId;
  if (options?.game) attributes['squire.game'] = requireGameId(options.game);
  return attributes;
}

function langsmithMetadataAttributes(metadata: Record<string, unknown>): Attributes {
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [`langsmith.metadata.${key}`, primitiveTraceAttribute(value)]),
  );
}

function langgraphTraceTags(model: string): string {
  return [
    'agent',
    'runtime',
    'anthropic',
    GRAPH_RUNTIME_PREFIX,
    model,
    'redesigned',
    `env:${resolveSquireEnv()}`,
  ].join(', ');
}

function langgraphRunTraceAttributes({
  question,
  model,
  options,
  result,
}: {
  question: string;
  model: string;
  options?: AskOptions;
  result?: AgentRunResult;
}): Attributes {
  return {
    'langsmith.traceable': 'true',
    'langsmith.span.kind': 'chain',
    'langsmith.trace.name': 'squire.agent.langgraph',
    'langsmith.span.tags': langgraphTraceTags(model),
    'gen_ai.prompt': jsonTraceAttribute({ question }),
    ...(result
      ? {
          'gen_ai.completion': jsonTraceAttribute({ finalAnswer: result.answer }),
          'langsmith.usage_metadata': jsonTraceAttribute(
            langsmithUsageMetadata(result.trajectory.tokenUsage),
          ),
          'squire.agent.iterations': result.trajectory.iterations,
          'squire.agent.tool_call_count': result.trajectory.toolCalls.length,
          'squire.agent.stop_reason': result.trajectory.stopReason ?? 'unknown',
          'squire.agent.input_tokens': result.trajectory.tokenUsage.inputTokens,
          'squire.agent.output_tokens': result.trajectory.tokenUsage.outputTokens,
          'squire.agent.cache_creation_input_tokens':
            result.trajectory.tokenUsage.cacheCreationInputTokens,
          'squire.agent.cache_read_input_tokens': result.trajectory.tokenUsage.cacheReadInputTokens,
        }
      : {}),
    'squire.agent.runtime': GRAPH_RUNTIME_PREFIX,
    'squire.agent.model': `${GRAPH_RUNTIME_PREFIX}:${model}`,
    ...langsmithMetadataAttributes({
      ...langgraphCorrelationMetadata(options),
      model,
      toolSurface: 'redesigned',
      ...(result
        ? {
            iterations: result.trajectory.iterations,
            toolCallCount: result.trajectory.toolCalls.length,
            stopReason: result.trajectory.stopReason ?? 'unknown',
          }
        : {}),
    }),
    ...langgraphCorrelationAttributes(options),
  };
}

function appendModelCall(
  state: LangGraphStateValue,
  message: Message,
  model: string,
  startedAtMs: number,
  startedAt: string,
): Pick<LangGraphStateValue, 'modelCalls' | 'tokenUsage'> {
  const endedAtMs = Date.now();
  const tokenUsage = cloneUsage(state.tokenUsage);
  addUsage(tokenUsage, message);
  return {
    tokenUsage,
    modelCalls: [
      ...state.modelCalls,
      {
        iteration: state.iterations,
        model,
        stopReason: message.stop_reason,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
        content: message.content,
        startedAt,
        endedAt: new Date(endedAtMs).toISOString(),
        durationMs: endedAtMs - startedAtMs,
      },
    ],
  };
}

function initialMessages(question: string, options: AskOptions | undefined): MessageParam[] {
  const history = options?.history?.slice(-MAX_HISTORY_TURNS) ?? [];
  // Campaign context rides the current question (SQR-19): persisted history
  // stays raw, and every turn carries fresh state instead of a stale block.
  const content = options?.campaignContext
    ? `${renderCampaignContextBlock(options.campaignContext)}\n\n${question}`
    : question;
  return [
    ...history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content },
  ];
}

function threadIdFor(options: AskOptions | undefined): string {
  return (
    options?.userMessageId ??
    options?.conversationId ??
    options?.requestId ??
    `squire-langgraph-${randomUUID()}`
  );
}

function parsedToolResultContent(result: ToolCallResult | undefined): {
  ok?: unknown;
  entity?: { ref?: unknown };
} | null {
  if (!result) return null;
  try {
    return JSON.parse(result.content) as {
      ok?: unknown;
      entity?: { ref?: unknown };
    };
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function openedEntityRefFromToolResult(result: ToolCallResult | undefined): string | undefined {
  const ref = parsedToolResultContent(result)?.entity?.ref;
  return typeof ref === 'string' && ref.trim().length > 0 ? ref.trim() : undefined;
}

function failedWorkMessageForTool(name: string, input: Record<string, unknown>): string {
  if (name === 'search_knowledge') return "Couldn't search available sources";
  if (name === 'open_entity') {
    const ref =
      typeof input.ref === 'string' && input.ref.trim().length > 0 ? input.ref.trim() : 'source';
    const humanized = humanizeWorkLogProgressMessage(`Opening ${ref}`);
    const searched = humanized.match(/^Searched\s+(.+)$/i);
    if (searched) return `Couldn't search ${searched[1]!.trim()}`;
    const checked = humanized.match(/^Checked\s+(.+)$/i);
    if (checked) return `Couldn't check ${checked[1]!.trim()}`;
    const lookedUp = humanized.match(/^Looked up\s+(.+)$/i);
    if (lookedUp) return `Couldn't look up ${lookedUp[1]!.trim()}`;
    return `Couldn't look up ${ref}`;
  }
  if (name === 'lookup_entity' || name === 'resolve_entity') {
    const query =
      typeof input.query === 'string' && input.query.trim().length > 0
        ? input.query.trim()
        : 'source';
    return `Couldn't look up ${query}`;
  }
  if (name === 'neighbors') return "Couldn't follow links";
  if (name === 'inspect_sources') return "Couldn't inspect available sources";
  if (name === 'schema') return "Couldn't check source schema";
  if (name === 'write_campaign_state') return "Couldn't update campaign state";
  if (name === 'write_character_state') return "Couldn't update character state";
  if (name === 'propose_state_change') return "Couldn't stage the change";
  if (name === 'confirm_state_change') return "Couldn't apply the confirmed change";
  if (name === 'cancel_state_change') return "Couldn't cancel the staged change";
  if (name === 'create_campaign') return "Couldn't create the campaign";
  if (name === 'create_character') return "Couldn't add the character";
  if (name === 'invite_member') return "Couldn't send the invite";
  return `Couldn't run ${name}`;
}

/**
 * Mutation visibility rule (SQR-286): every write the agent makes appears
 * in the work log — no silent writes. These are the ledger-voiced completed
 * messages for the SQR-280 write tool family.
 */
function writeWorkMessageForTool(name: string): string | undefined {
  if (name === 'write_campaign_state') return 'Updated campaign state';
  if (name === 'write_character_state') return 'Updated character state';
  if (name === 'propose_state_change') return 'Staged a change for confirmation';
  if (name === 'confirm_state_change') return 'Applied the confirmed change';
  if (name === 'cancel_state_change') return 'Cancelled the staged change';
  if (name === 'create_campaign') return 'Created the campaign';
  if (name === 'create_character') return 'Added a character to the roster';
  if (name === 'invite_member') return 'Sent a campaign invite';
  return undefined;
}

function completedWorkMessageForTool(
  name: string,
  input: Record<string, unknown>,
  toolResult?: ToolCallResult,
  toolOk = true,
): string {
  if (!toolOk) return failedWorkMessageForTool(name, input);

  const writeMessage = writeWorkMessageForTool(name);
  if (writeMessage) return writeMessage;

  if (name === 'search_knowledge') {
    const scopeLabels = sourceLabelsForSearchScope(input.scope);
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    if (scopeLabels.length === 1 && query.length > 0) {
      const target = scopeLabels[0];
      if (target === 'Rulebook') return 'Searched the rulebook';
      if (target === 'Scenario Book') return 'Searched the scenario book';
      if (target === 'Section Book') return 'Searched the section book';
      if (target === 'Card Index') return 'Searched cards';
    }
    return 'Searched available sources';
  }
  if (name === 'open_entity') {
    const openedRef = openedEntityRefFromToolResult(toolResult);
    return humanizeWorkLogProgressMessage(
      `Opening ${openedRef ?? (typeof input.ref === 'string' ? input.ref : 'source')}`,
    );
  }
  if (name === 'lookup_entity') {
    const openedRef = openedEntityRefFromToolResult(toolResult);
    if (openedRef) return humanizeWorkLogProgressMessage(`Opening ${openedRef}`);
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    if (query.length === 0) return 'Looked up source';
    const openingMessage = humanizeWorkLogProgressMessage(`Opening ${query}`);
    if (openingMessage !== `Opening ${query}`) return openingMessage;
    return humanizeWorkLogProgressMessage(`Resolving ${query}`);
  }
  if (name === 'neighbors')
    return humanizeWorkLogProgressMessage(
      `Checking links from ${typeof input.ref === 'string' ? input.ref : 'source'}`,
    );
  if (name === 'resolve_entity') {
    return humanizeWorkLogProgressMessage(
      `Resolving ${typeof input.query === 'string' ? input.query : 'reference'}`,
    );
  }
  if (name === 'inspect_sources') return 'Inspected available sources';
  if (name === 'schema')
    return `Checked ${typeof input.kind === 'string' ? input.kind : 'source'} schema`;
  return `Ran ${name}`;
}

function progressMessageForTool(name: string, input: Record<string, unknown>): string {
  return activeWorkLogProgressMessageFromCompleted(completedWorkMessageForTool(name, input));
}

function shouldEmitUserFacingPlan(name: string): boolean {
  return name !== 'resolve_entity';
}

function shouldEmitUserFacingProgress(name: string): boolean {
  return name !== 'resolve_entity' && name !== 'open_entity' && name !== 'lookup_entity';
}

function shouldEmitUserFacingResult(name: string, ok: boolean): boolean {
  return name !== 'resolve_entity' || !ok;
}

function sourcePlanTarget(label: string): string {
  if (label === 'Rulebook') return 'the rulebook';
  if (label === 'Scenario Book') return 'the scenario book';
  if (label === 'Section Book') return 'the section book';
  if (label === 'Card Index') return 'the cards';
  return label.toLowerCase();
}

function joinPlanTargets(targets: string[]): string {
  if (targets.length <= 1) return targets[0] ?? 'available sources';
  if (targets.length === 2) return `${targets[0]} and ${targets[1]}`;
  return `${targets.slice(0, -1).join(', ')}, and ${targets[targets.length - 1]}`;
}

function planMessageFromCompletedAction(action: string): string | undefined {
  const lookedUpInBook = action.match(/^Looked up\s+.+?\s+in the\s+(.+)$/i);
  if (lookedUpInBook) return `I'll look that up in the ${lookedUpInBook[1]!.trim()}.`;

  const lookedUp = action.match(/^Looked up\s+(.+)$/i);
  if (lookedUp) return `I'll look up ${lookedUp[1]!.trim()}.`;

  const checked = action.match(/^Checked\s+(.+)$/i);
  if (checked) {
    const target = checked[1]!.trim();
    if (/stat card$/i.test(target)) return "I'll check that stat card.";
    if (/card$/i.test(target)) return "I'll check that card.";
    return `I'll check ${target.toLowerCase().startsWith('the ') ? target : `the ${target}`}.`;
  }

  const searched = action.match(/^Searched\s+(.+)$/i);
  if (searched) return `I'll search ${searched[1]!.trim()}.`;
  return undefined;
}

function planMessageForTool(name: string, input: Record<string, unknown>): string | undefined {
  if (name === 'search_knowledge') {
    const scopeLabels = sourceLabelsForSearchScope(input.scope);
    if (scopeLabels.length === 0) return "I'll search available sources.";
    if (scopeLabels.length === 1 && scopeLabels[0] === 'Card Index') return "I'll check the cards.";
    return `I'll search ${joinPlanTargets(scopeLabels.map(sourcePlanTarget))}.`;
  }
  if (name === 'open_entity') {
    const ref = typeof input.ref === 'string' ? input.ref.trim() : '';
    if (ref.length === 0) return undefined;
    return planMessageFromCompletedAction(humanizeWorkLogProgressMessage(`Opening ${ref}`));
  }
  if (name === 'lookup_entity') {
    return planMessageFromCompletedAction(completedWorkMessageForTool(name, input));
  }
  if (name === 'resolve_entity') {
    return planMessageFromCompletedAction(completedWorkMessageForTool(name, input));
  }
  if (name === 'write_campaign_state') return "I'll update the campaign ledger.";
  if (name === 'write_character_state') return "I'll update the character sheet.";
  if (name === 'propose_state_change') return "I'll stage that change for your confirmation.";
  if (name === 'confirm_state_change') return "I'll apply the confirmed change.";
  if (name === 'cancel_state_change') return "I'll cancel the staged change.";
  if (name === 'create_campaign') return "I'll set up the campaign.";
  if (name === 'create_character') return "I'll add that character to the roster.";
  if (name === 'invite_member') return "I'll send the invite.";
  return undefined;
}

function isMonsterStatText(text: string): boolean {
  return (
    /\b(?:monster\s+)?stat(?:s| card| block)?\b|\bhp\b|\bhit points?\b|\belite\b|\bnormal\b|\blevel\s+\d+\b/i.test(
      text,
    ) && !/\babilit(?:y|ies)\b|\bdeck\b/i.test(text)
  );
}

function monsterStatKinds(kinds: unknown): string[] | undefined {
  if (!Array.isArray(kinds)) return undefined;
  const normalized = kinds.filter((kind): kind is string => typeof kind === 'string');
  if (!normalized.some((kind) => /^monsters?$/i.test(kind))) return undefined;

  const out = normalized.map((kind) => (/^monsters?$/i.test(kind) ? 'monster-stat' : kind));
  return [...new Set(out.filter((kind) => !/^monster-abilit(?:y|ies)$/i.test(kind)))];
}

function monsterStatQueryDetails(question: string, query: string): string[] {
  const details: string[] = [];
  if (/\belite\b/i.test(question) && !/\belite\b/i.test(query)) details.push('elite');
  if (/\bnormal\b/i.test(question) && !/\bnormal\b/i.test(query)) details.push('normal');

  const level = question.match(/\blevel\s+(\d+)\b/i)?.[1];
  if (level && !/\blevel\s+\d+\b/i.test(query)) details.push(`level ${level}`);
  return details;
}

function shouldUseCardScenarioData(question: string): boolean {
  return /\bstructured\s+scenario\s+data\b/i.test(question);
}

function normalizeStructuredScenarioKinds(kinds: unknown, question: string): string[] | undefined {
  if (!shouldUseCardScenarioData(question)) return undefined;
  const normalized = Array.isArray(kinds)
    ? kinds.filter((kind): kind is string => typeof kind === 'string')
    : [];
  if (normalized.length > 0 && !normalized.some((kind) => /^scenario$/i.test(kind))) {
    return undefined;
  }
  return ['card'];
}

function preserveQuestionEntitySpelling(query: string, question: string): string {
  if (/\bBladewarm\b/i.test(question)) {
    return query.replace(/\bBladeswarm\b/gi, 'Bladewarm');
  }
  return query;
}

function executionInputForQuestion(
  toolName: string,
  rawInput: Record<string, unknown>,
  question: string,
): Record<string, unknown> {
  const input = { ...rawInput };
  if (toolName !== 'lookup_entity' && toolName !== 'resolve_entity') return input;

  const scenarioKinds = normalizeStructuredScenarioKinds(input.kinds, question);
  if (scenarioKinds) input.kinds = scenarioKinds;

  const originalQuery = stringValue(input.query);
  if (originalQuery) input.query = preserveQuestionEntitySpelling(originalQuery, question);

  const query = stringValue(input.query);
  if (!query || !isMonsterStatText(`${question}\n${query}`)) return input;

  const narrowedKinds = monsterStatKinds(input.kinds);
  if (narrowedKinds) input.kinds = narrowedKinds;
  if (!narrowedKinds && !/\bmonster\s+stat(?:s| card)?\b/i.test(query)) return input;

  const details = monsterStatQueryDetails(question, query);
  if (details.length > 0) input.query = `${query} ${details.join(' ')}`;

  return input;
}

function sourceLabelsForSearchScope(scope: unknown): string[] {
  if (!Array.isArray(scope)) return [];
  const labelsByScope: Record<string, string> = {
    rules_passage: 'Rulebook',
    scenario: 'Scenario Book',
    section: 'Section Book',
    card: 'Card Index',
  };
  const labels: string[] = [];
  for (const item of scope) {
    if (typeof item !== 'string') continue;
    const label = labelsByScope[item];
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

function sectionArtifactFromToolResult(
  toolName: string,
  result: ToolCallResult,
): AgentStreamEventMap['artifact'] | undefined {
  if (toolName !== 'open_entity' && toolName !== 'lookup_entity') return undefined;
  try {
    const parsed = JSON.parse(result.content) as {
      ok?: unknown;
      entity?: {
        kind?: unknown;
        ref?: unknown;
        title?: unknown;
        sourceLabel?: unknown;
        data?: { text?: unknown; rawText?: unknown };
      };
      citations?: Array<{ sourceLabel?: unknown }>;
    };
    const entity = parsed.entity;
    if (parsed.ok !== true || entity?.kind !== 'section') return undefined;
    const body =
      typeof entity.data?.text === 'string'
        ? entity.data.text
        : typeof entity.data?.rawText === 'string'
          ? entity.data.rawText
          : '';
    const title =
      typeof entity.title === 'string'
        ? entity.title
        : typeof entity.ref === 'string'
          ? entity.ref
          : '';
    if (title.trim().length === 0 || body.trim().length === 0) return undefined;
    const sourceLabel =
      result.sourceBooks?.[0] ??
      (typeof parsed.citations?.[0]?.sourceLabel === 'string'
        ? parsed.citations[0].sourceLabel
        : typeof entity.sourceLabel === 'string'
          ? entity.sourceLabel
          : undefined);
    return {
      kind: 'section_quote',
      title,
      body,
      sourceLabel,
      ref: typeof entity.ref === 'string' ? entity.ref : undefined,
    };
  } catch {
    return undefined;
  }
}

/**
 * A successful propose_state_change result becomes a `proposal` stream event
 * (SQR-286) so routes can render the chat confirmation block. The proposal id
 * and expiry come from the tool result; the campaign id from the tool input
 * (the tool validated it against the caller's membership).
 */
function proposalEventFromToolResult(
  toolName: string,
  input: Record<string, unknown>,
  result: ToolCallResult,
): AgentStreamEventMap['proposal'] | undefined {
  if (toolName !== 'propose_state_change') return undefined;
  try {
    const parsed = JSON.parse(result.content) as {
      ok?: unknown;
      proposal?: { id?: unknown; mutation?: unknown; expiresAt?: unknown };
      preview?: unknown;
    };
    if (parsed.ok !== true || !parsed.proposal) return undefined;
    const { id, mutation, expiresAt } = parsed.proposal;
    const campaignId = typeof input.campaignId === 'string' ? input.campaignId : '';
    if (typeof id !== 'string' || typeof expiresAt !== 'string' || campaignId.length === 0) {
      return undefined;
    }
    const lines = Array.isArray(parsed.preview)
      ? parsed.preview.filter((line): line is string => typeof line === 'string')
      : undefined;
    return {
      proposalId: id,
      campaignId,
      mutation,
      expiresAt,
      ...(lines && lines.length > 0 ? { lines } : {}),
    };
  } catch {
    return undefined;
  }
}

function hasAnswerableToolCalls(toolCalls: ToolTrajectoryStep[]): boolean {
  return toolCalls.some((call) => {
    if (!call.ok) return false;
    return !DISCOVERY_ONLY_TOOL_NAMES.has(call.name);
  });
}

function hasDirectOpenedEvidence(toolCalls: ToolTrajectoryStep[]): boolean {
  return toolCalls.some((call) => call.ok && DIRECT_EVIDENCE_TOOL_NAMES.has(call.name));
}

function trajectoryFromState(
  state: LangGraphStateValue,
  model: string,
  firstAnswerTiming?: Pick<AgentRunTrajectory, 'firstAnswerTokenAt' | 'firstAnswerTokenLatencyMs'>,
): AgentRunTrajectory {
  return {
    toolCalls: state.toolCalls,
    modelCalls: state.modelCalls,
    finalAnswer: state.finalAnswer,
    ...firstAnswerTiming,
    tokenUsage: state.tokenUsage,
    model: `${GRAPH_RUNTIME_PREFIX}:${model}`,
    iterations: state.iterations,
    stopReason: state.stopReason,
  };
}

function createInitialState(
  question: string,
  options: AskOptions | undefined,
): LangGraphStateValue {
  return {
    question,
    messages: initialMessages(question, options),
    lastResponse: undefined,
    toolCalls: [],
    modelCalls: [],
    tokenUsage: emptyTokenUsage(),
    iterations: 0,
    readyToAnswer: false,
    finalAnswer: '',
    stopReason: null,
  };
}

export async function runLangGraphAgentLoopWithTrajectory(
  question: string,
  options?: AskOptions,
): Promise<AgentRunResult> {
  // Lane split (ADR 0026): eligible questions take the fast lane; null means
  // fall through to the deep lane exactly as before.
  const fastLaneResult = await maybeRunFastLane(question, options);
  if (fastLaneResult) return fastLaneResult;
  return runLangGraphAgentLoop(question, options, {
    model: AGENT_MODEL,
    maxOutputTokens: undefined,
    timeoutMs: undefined,
    toolLoopLimit: undefined,
    broadSearchSynthesisThreshold: undefined,
  });
}

export async function runLangGraphAgentLoopWithEvalConfig(
  question: string,
  options: EvalAgentLoopOptions,
): Promise<AgentRunResult> {
  // Campaign-bound eval cases get the same context loading as production
  // ask() — identical projection, game fallback, and tool identity.
  const askOptions = await applyCampaignContextToAskOptions({
    toolSurface: 'redesigned' as const,
    game: options.game,
    requestId: options.requestId,
    userId: options.userId,
    campaignId: options.campaignId,
    activeCharacterId: options.activeCharacterId,
    emit: async () => undefined,
  });
  // Same lane split as production (ADR 0026) so evals measure what ships.
  // The fast-lane synthesis model is architectural (Haiku-class), not the
  // matrix's deep-lane model; the trajectory records the lane explicitly.
  const fastLaneResult = await maybeRunFastLane(question, askOptions);
  if (fastLaneResult) return fastLaneResult;
  return runLangGraphAgentLoop(question, askOptions, {
    model: options.anthropicModel,
    maxOutputTokens: options.maxOutputTokens,
    timeoutMs: options.timeoutMs,
    toolLoopLimit: options.toolLoopLimit,
    broadSearchSynthesisThreshold: options.broadSearchSynthesisThreshold,
  });
}

/**
 * Per-answer transparency (SQR-258): the state snapshot a personalized
 * turn runs against, named up front in the work log. No campaign context →
 * no event — nothing ever pretends state exists.
 */
function stateContextEventFor(
  options: AskOptions | undefined,
): AgentStreamEventMap['state_context'] | undefined {
  const view = options?.campaignContext;
  if (!view) return undefined;
  const active = view.activeCharacterId
    ? view.ownCharacters.find((character) => character.id === view.activeCharacterId)
    : undefined;
  const parts = [view.campaign.name];
  if (active) parts.push(`${active.name} L${active.level}`, `${active.gold} gold`);
  parts.push(`prosperity ${view.campaign.prosperity}`);
  return {
    summary: parts.join(' · '),
    campaignId: view.campaign.id,
    ...(active ? { characterId: active.id } : {}),
  };
}

async function runLangGraphAgentLoop(
  question: string,
  options: AskOptions | undefined,
  config: {
    model: string;
    maxOutputTokens?: number;
    timeoutMs?: number;
    toolLoopLimit?: number;
    broadSearchSynthesisThreshold?: number;
  },
): Promise<AgentRunResult> {
  const firstAnswerTracker = createFirstAnswerTokenTracker(options?.emit);
  const emit = firstAnswerTracker.emit;
  const activeGame = options?.game === undefined ? undefined : requireGameId(options.game);
  const maxIterations = config.toolLoopLimit ?? MAX_AGENT_ITERATIONS;

  const graph = new StateGraph(LangGraphState)
    .addNode('plan_retrieval', async (state: LangGraphStateValue) => {
      if (state.iterations >= maxIterations) {
        await emitGraphDebug(emit, 'LangGraph planner reached iteration limit.', {
          iterations: state.iterations,
        });
        return {
          stopReason: 'iteration_limit' as const,
          readyToAnswer: hasAnswerableToolCalls(state.toolCalls),
        };
      }

      await emitGraphDebug(emit, 'LangGraph plan_retrieval node started.', {
        iteration: state.iterations + 1,
      });
      const startedAtMs = Date.now();
      const startedAt = new Date(startedAtMs).toISOString();
      const message = await callClaude(state.messages, undefined, {
        allowTools: true,
        toolSurface: 'redesigned',
        model: config.model,
        maxOutputTokens: config.maxOutputTokens,
        timeoutMs: config.timeoutMs,
      });
      if (options?.emit && !hasToolUse(message)) {
        firstAnswerTracker.recordTextDelta(textFromMessage(message));
      }
      const nextIterations = state.iterations + 1;
      const modelUpdates = appendModelCall(
        { ...state, iterations: nextIterations },
        message,
        config.model,
        startedAtMs,
        startedAt,
      );
      const continuationMessages =
        message.stop_reason === 'max_tokens' || message.stop_reason === 'pause_turn'
          ? [
              ...state.messages,
              { role: 'assistant' as const, content: message.content },
              { role: 'user' as const, content: 'Continue.' },
            ]
          : state.messages;
      return {
        ...modelUpdates,
        messages: continuationMessages,
        iterations: nextIterations,
        lastResponse: message,
        stopReason: message.stop_reason,
      };
    })
    .addNode('execute_tools', async (state: LangGraphStateValue) => {
      const response = state.lastResponse;
      if (!response) return {};

      const toolResults: ContentBlockParam[] = [];
      const nextMessages: MessageParam[] = [
        ...state.messages,
        { role: 'assistant' as const, content: response.content },
      ];
      const nextToolCalls = [...state.toolCalls];

      // Phase 1 — announce every call in block order (SSE plan/progress/call
      // events keep their contract ordering), collecting the round's inputs.
      const blocks = toolUseBlocks(response);
      const preparedCalls: Array<{
        block: (typeof blocks)[number];
        input: Record<string, unknown>;
      }> = [];
      for (const block of blocks) {
        const rawInput = block.input as Record<string, unknown>;
        const input = executionInputForQuestion(block.name, rawInput, state.question);

        if (emit) {
          const planMessage = planMessageForTool(block.name, rawInput);
          if (planMessage && shouldEmitUserFacingPlan(block.name)) {
            await emit('tool_plan', {
              message: planMessage,
              toolName: block.name,
            });
          }
          if (shouldEmitUserFacingProgress(block.name)) {
            await emit('tool_progress', {
              message: progressMessageForTool(block.name, rawInput),
              toolName: block.name,
            });
          }
          await emit('tool_call', { name: block.name, input });
        }

        preparedCalls.push({ block, input });
      }

      // Phase 2 — execute. Read-only rounds run concurrently (SQR-407); any
      // round containing a write-family tool stays strictly serial so writes
      // observe earlier effects in the same round.
      const runOne = async (call: (typeof preparedCalls)[number]) => {
        const toolStartedAtMs = Date.now();
        const toolStartedAt = new Date(toolStartedAtMs).toISOString();
        let toolResult: ToolCallResult;
        let isError = false;
        let errorMessage: string | undefined;
        try {
          toolResult = await executeToolCall(call.block.name, call.input, {
            game: activeGame,
            userId: options?.userId,
          });
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : String(error);
          toolResult = { content: `Tool error: ${errorMessage}` };
          isError = true;
        }
        const toolEndedAtMs = Date.now();
        return { toolResult, isError, errorMessage, toolStartedAtMs, toolStartedAt, toolEndedAtMs };
      };
      const roundHasWrites = preparedCalls.some((call) => WRITE_TOOL_NAMES.has(call.block.name));
      const executions: Array<Awaited<ReturnType<typeof runOne>>> = [];
      if (roundHasWrites) {
        for (const call of preparedCalls) executions.push(await runOne(call));
      } else {
        executions.push(...(await Promise.all(preparedCalls.map(runOne))));
      }

      // Phase 3 — post-process strictly in block order: trajectory steps,
      // result/artifact/proposal events, and tool_result content blocks.
      for (let index = 0; index < preparedCalls.length; index += 1) {
        const { block, input } = preparedCalls[index];
        const { toolResult, isError, errorMessage, toolStartedAtMs, toolStartedAt, toolEndedAtMs } =
          executions[index];
        const { summary, canonicalRefs } = summarizeToolOutput(toolResult.content, {
          game: activeGame,
        });
        const toolOk = !isError && isToolResultOk(toolResult);
        nextToolCalls.push({
          iteration: state.iterations,
          id: block.id,
          name: block.name,
          input,
          ok: toolOk,
          outputSummary: summary,
          sourceLabels: toolResult.sourceBooks ?? [],
          canonicalRefs,
          ...(errorMessage ? { error: errorMessage } : {}),
          startedAt: toolStartedAt,
          endedAt: new Date(toolEndedAtMs).toISOString(),
          durationMs: toolEndedAtMs - toolStartedAtMs,
        });

        if (emit) {
          if (shouldEmitUserFacingResult(block.name, toolOk)) {
            await emit('tool_result', {
              name: block.name,
              ok: toolOk,
              message: completedWorkMessageForTool(block.name, input, toolResult, toolOk),
              sourceBooks: toolResult.sourceBooks,
            });
          }
          const artifact = sectionArtifactFromToolResult(block.name, toolResult);
          if (artifact) await emit('artifact', artifact);
          const stagedProposal = proposalEventFromToolResult(block.name, input, toolResult);
          if (stagedProposal) await emit('proposal', stagedProposal);
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: toolResult.content,
          is_error: isError,
        } as ContentBlockParam);
      }

      nextMessages.push({ role: 'user' as const, content: toolResults });

      return {
        messages: nextMessages,
        toolCalls: nextToolCalls,
      };
    })
    .addNode('verify_sources', async (state: LangGraphStateValue) => {
      // At the loop budget the model concludes from whatever it has — the
      // final-answer prompt already instructs it to state gaps honestly, so
      // there is nothing left for a verdict to change.
      if (state.iterations >= maxIterations) {
        const readyToAnswer = hasDirectOpenedEvidence(state.toolCalls);
        await emitGraphDebug(emit, 'LangGraph verify_sources at iteration limit.', {
          readyToAnswer,
          toolCallCount: state.toolCalls.length,
        });
        return {
          readyToAnswer,
          ...(readyToAnswer ? {} : { stopReason: 'iteration_limit' as const }),
        };
      }

      // Write flows conclude on the model's own terms: evidence sufficiency
      // is a retrieval question, and a gap nudge would derail the
      // propose→confirm choreography. Rounds that touched a write-family
      // tool continue silently, exactly like the pre-judge loop.
      const latestRoundHadWrites = state.toolCalls.some(
        (call) => call.iteration === state.iterations && WRITE_TOOL_NAMES.has(call.name),
      );
      if (latestRoundHadWrites) {
        await emitGraphDebug(emit, 'LangGraph verify_sources skipped for write round.', {
          toolCallCount: state.toolCalls.length,
        });
        return { readyToAnswer: false };
      }

      // Evidence sufficiency is a model judgment (SQR-408): does the
      // gathered evidence answer the question, and if not, what exactly is
      // missing? Replaces tool-name set-membership.
      const judgeStartedAtMs = Date.now();
      const judgeStartedAt = new Date(judgeStartedAtMs).toISOString();
      const verdict = await judgeEvidenceSufficiency(judgeClient, state.question, state.toolCalls);

      if (verdict.failed) {
        // Availability fallback only: a judge outage or unparseable verdict
        // degrades to the legacy deterministic gate instead of wedging the
        // turn. A malformed-but-billed response still enters the trajectory
        // so its tokens stay cost-visible.
        const failedModelUpdates = verdict.message
          ? appendModelCall(
              state,
              verdict.message,
              EVIDENCE_JUDGE_MODEL,
              judgeStartedAtMs,
              judgeStartedAt,
            )
          : {};
        const readyToAnswer = hasDirectOpenedEvidence(state.toolCalls);
        await emitGraphDebug(emit, 'Evidence judge unavailable; deterministic fallback.', {
          readyToAnswer,
          toolCallCount: state.toolCalls.length,
        });
        return { ...failedModelUpdates, readyToAnswer };
      }

      const modelUpdates = verdict.message
        ? appendModelCall(
            state,
            verdict.message,
            EVIDENCE_JUDGE_MODEL,
            judgeStartedAtMs,
            judgeStartedAt,
          )
        : {};
      await emitGraphDebug(emit, 'LangGraph verify_sources node completed.', {
        sufficient: verdict.sufficient,
        missing: verdict.missing,
        toolCallCount: state.toolCalls.length,
      });

      if (verdict.sufficient) {
        return { ...modelUpdates, readyToAnswer: true };
      }
      return {
        ...modelUpdates,
        readyToAnswer: false,
        messages: [
          ...state.messages,
          {
            role: 'user' as const,
            content: `Evidence verification found a gap: ${verdict.missing || 'the gathered evidence does not yet answer the question'}. Address exactly this gap with your next tool calls. If the sources genuinely lack it, stop calling tools and write the final answer saying what is missing.`,
          },
        ],
      };
    })
    .addNode('final_answer', async (state: LangGraphStateValue) => {
      await emitGraphDebug(emit, 'LangGraph final_answer node started.', {
        readyToAnswer: state.readyToAnswer,
        stopReason: state.stopReason,
      });
      const draftAnswer =
        state.toolCalls.length === 0 && state.lastResponse && !hasToolUse(state.lastResponse)
          ? textFromMessage(state.lastResponse)
          : '';
      if (draftAnswer) {
        if (emit) {
          await emit('text', { delta: draftAnswer });
          await emit('done', {});
        }
        return {
          finalAnswer: draftAnswer,
          stopReason: state.stopReason as StopReason | null,
        };
      }

      const finalMessages: MessageParam[] = [
        ...state.messages,
        { role: 'user' as const, content: FINAL_ANSWER_PROMPT },
      ];
      const startedAtMs = Date.now();
      const startedAt = new Date(startedAtMs).toISOString();
      const message = await callClaude(finalMessages, emit, {
        allowTools: false,
        toolSurface: 'redesigned',
        model: config.model,
        maxOutputTokens: config.maxOutputTokens,
        timeoutMs: config.timeoutMs,
      });
      const modelUpdates = appendModelCall(state, message, config.model, startedAtMs, startedAt);
      const answer =
        textFromMessage(message) ||
        (state.stopReason === 'iteration_limit'
          ? 'I was unable to produce an answer within the allowed number of steps.'
          : 'I was unable to answer this question from the available sources.');
      if (emit) await emit('done', {});
      return {
        ...modelUpdates,
        finalAnswer: answer,
        stopReason:
          state.stopReason === 'iteration_limit'
            ? ('iteration_limit' as const)
            : (message.stop_reason as StopReason | null),
      };
    })
    .addConditionalEdges('plan_retrieval', (state: LangGraphStateValue) => {
      if (state.stopReason === 'iteration_limit') return 'final_answer';
      if (
        state.lastResponse?.stop_reason === 'max_tokens' ||
        state.lastResponse?.stop_reason === 'pause_turn'
      ) {
        return 'plan_retrieval';
      }
      return hasToolUse(state.lastResponse) ? 'execute_tools' : 'final_answer';
    })
    .addEdge(START, 'plan_retrieval')
    .addEdge('execute_tools', 'verify_sources')
    .addConditionalEdges('verify_sources', (state: LangGraphStateValue) => {
      if (state.readyToAnswer || state.iterations >= maxIterations) {
        return 'final_answer';
      }
      return 'plan_retrieval';
    })
    .addEdge('final_answer', END)
    .compile({ checkpointer: graphCheckpointer });

  return tracer.startActiveSpan('squire.agent.langgraph.run', async (span) => {
    try {
      span.setAttributes(
        langgraphRunTraceAttributes({
          question,
          model: config.model,
          options,
        }),
      );
      const stateContext = stateContextEventFor(options);
      if (emit && stateContext) await emit('state_context', stateContext);
      const finalState = await graph.invoke(createInitialState(question, options), {
        configurable: { thread_id: threadIdFor(options) },
        metadata: langgraphCorrelationMetadata(options),
        recursionLimit: maxIterations * 3 + 4,
      });
      const result = {
        answer: finalState.finalAnswer,
        trajectory: trajectoryFromState(finalState, config.model, firstAnswerTracker.timing()),
        observability: langSmithRunReferenceFromSpan(span),
      };
      span.setAttributes(
        langgraphRunTraceAttributes({
          question,
          model: config.model,
          options,
          result,
        }),
      );
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      span.setAttributes({
        'gen_ai.completion': jsonTraceAttribute({ error: message }),
        ...langsmithMetadataAttributes({
          ...langgraphCorrelationMetadata(options),
          level: 'ERROR',
          statusMessage: message,
        }),
        ...langgraphCorrelationAttributes(options),
      });
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      throw error;
    } finally {
      span.end();
    }
  });
}
