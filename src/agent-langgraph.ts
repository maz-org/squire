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
  FORCE_SYNTHESIS_PROMPT,
  MAX_AGENT_ITERATIONS,
  NEIGHBORS_TARGET_PROMPT,
  RESOLUTION_TARGET_PROMPT,
  addUsage,
  callClaude,
  emptyTokenUsage,
  executeToolCall,
  hasUsefulNeighborsResult,
  hasUsefulResolutionResult,
  isToolResultOk,
  isBroadRuleSearchTool,
  isNonRuleSearchTool,
  summarizeToolOutput,
  type AgentRunResult,
  type AgentRunTrajectory,
  type EvalAgentLoopOptions,
  type ModelTrajectoryStep,
  type TokenUsage,
  type ToolCallResult,
  type ToolTrajectoryStep,
} from './agent.ts';
import type { AgentStreamEventMap, AskOptions, EmitFn } from './service.ts';
import { requireGameId } from './game.ts';
import { resolveSquireEnv } from './squire-env.ts';

type Message = Anthropic.Message;
type MessageParam = Anthropic.MessageParam;
type ContentBlockParam = Anthropic.ContentBlockParam;
type MessageContentBlock = Message['content'][number];
type StopReason = Message['stop_reason'];

const AGENT_MODEL = 'claude-sonnet-4-6' as const;
const MAX_HISTORY_TURNS = 20;
const MAX_RULE_SEARCHES_BEFORE_SYNTHESIS = 3;
const GRAPH_RUNTIME_PREFIX = 'langgraph';
const FINAL_ANSWER_PROMPT =
  'Write the final answer now using only verified tool results in this run. Do not call tools. If the verified results are insufficient, say exactly what is missing instead of guessing.';
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
  'open_entity',
  'get_card',
  'get_scenario',
  'get_section',
]);
const graphCheckpointer = new MemorySaver();

const LangGraphState = Annotation.Root({
  question: Annotation<string>(),
  messages: Annotation<MessageParam[]>(),
  lastResponse: Annotation<Message | undefined>(),
  toolCalls: Annotation<ToolTrajectoryStep[]>(),
  modelCalls: Annotation<ModelTrajectoryStep[]>(),
  tokenUsage: Annotation<TokenUsage>(),
  iterations: Annotation<number>(),
  broadRuleSearches: Annotation<number>(),
  hasUsedNonRuleSearchTool: Annotation<boolean>(),
  forceSynthesis: Annotation<boolean>(),
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
  return [
    ...history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: question },
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

function progressMessageForTool(name: string, input: Record<string, unknown>): string {
  if (name === 'search_knowledge')
    return `Searching ${input.scope ? 'selected sources' : 'knowledge'}`;
  if (name === 'open_entity')
    return `Opening ${typeof input.ref === 'string' ? input.ref : 'source'}`;
  if (name === 'neighbors')
    return `Checking links from ${typeof input.ref === 'string' ? input.ref : 'source'}`;
  if (name === 'resolve_entity')
    return `Resolving ${typeof input.query === 'string' ? input.query : 'reference'}`;
  if (name === 'inspect_sources') return 'Inspecting available sources';
  if (name === 'schema')
    return `Checking ${typeof input.kind === 'string' ? input.kind : 'source'} schema`;
  return `Running ${name}`;
}

function sectionArtifactFromToolResult(
  toolName: string,
  result: ToolCallResult,
): AgentStreamEventMap['artifact'] | undefined {
  if (toolName !== 'open_entity') return undefined;
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

function hasAnswerableToolCalls(toolCalls: ToolTrajectoryStep[]): boolean {
  return toolCalls.some((call) => {
    if (!call.ok) return false;
    return !DISCOVERY_ONLY_TOOL_NAMES.has(call.name);
  });
}

function hasDirectOpenedEvidence(toolCalls: ToolTrajectoryStep[]): boolean {
  return toolCalls.some((call) => call.ok && DIRECT_EVIDENCE_TOOL_NAMES.has(call.name));
}

function shouldForceSynthesis(state: LangGraphStateValue, threshold: number): boolean {
  return state.broadRuleSearches >= threshold && !state.hasUsedNonRuleSearchTool;
}

function trajectoryFromState(state: LangGraphStateValue, model: string): AgentRunTrajectory {
  return {
    toolCalls: state.toolCalls,
    modelCalls: state.modelCalls,
    finalAnswer: state.finalAnswer,
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
    broadRuleSearches: 0,
    hasUsedNonRuleSearchTool: false,
    forceSynthesis: false,
    readyToAnswer: false,
    finalAnswer: '',
    stopReason: null,
  };
}

export async function runLangGraphAgentLoopWithTrajectory(
  question: string,
  options?: AskOptions,
): Promise<AgentRunResult> {
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
  return runLangGraphAgentLoop(
    question,
    {
      toolSurface: 'redesigned',
      game: options.game,
      requestId: options.requestId,
    },
    {
      model: options.anthropicModel,
      maxOutputTokens: options.maxOutputTokens,
      timeoutMs: options.timeoutMs,
      toolLoopLimit: options.toolLoopLimit,
      broadSearchSynthesisThreshold: options.broadSearchSynthesisThreshold,
    },
  );
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
  const emit = options?.emit;
  const activeGame = options?.game === undefined ? undefined : requireGameId(options.game);
  const maxIterations = config.toolLoopLimit ?? MAX_AGENT_ITERATIONS;
  const broadSearchSynthesisThreshold =
    config.broadSearchSynthesisThreshold ?? MAX_RULE_SEARCHES_BEFORE_SYNTHESIS;

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
        forceSynthesis: state.forceSynthesis,
      });
      const startedAtMs = Date.now();
      const startedAt = new Date(startedAtMs).toISOString();
      const message = await callClaude(state.messages, undefined, {
        allowTools: !state.forceSynthesis,
        toolSurface: 'redesigned',
        model: config.model,
        maxOutputTokens: config.maxOutputTokens,
        timeoutMs: config.timeoutMs,
      });
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
      let broadRuleSearches = state.broadRuleSearches;
      let hasUsedNonRuleSearchTool = state.hasUsedNonRuleSearchTool;
      let forceSynthesis = state.forceSynthesis;
      let sawNeighborsWithTargets = false;
      let sawResolutionWithCandidates = false;
      const nextToolCalls = [...state.toolCalls];

      for (const block of toolUseBlocks(response)) {
        const input = block.input as Record<string, unknown>;
        if (isBroadRuleSearchTool(block.name, input)) {
          broadRuleSearches += 1;
        } else if (isNonRuleSearchTool(block.name, input)) {
          hasUsedNonRuleSearchTool = true;
        }

        if (emit) {
          await emit('tool_progress', {
            message: progressMessageForTool(block.name, input),
            toolName: block.name,
          });
          await emit('tool_call', { name: block.name, input: block.input });
        }

        const toolStartedAtMs = Date.now();
        const toolStartedAt = new Date(toolStartedAtMs).toISOString();
        let toolResult: ToolCallResult;
        let isError = false;
        let errorMessage: string | undefined;
        try {
          toolResult = await executeToolCall(block.name, input, { game: activeGame });
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : String(error);
          toolResult = { content: `Tool error: ${errorMessage}` };
          isError = true;
        }

        const toolEndedAtMs = Date.now();
        const { summary, canonicalRefs } = summarizeToolOutput(toolResult.content);
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

        if (block.name === 'neighbors' && !isError && hasUsefulNeighborsResult(toolResult)) {
          sawNeighborsWithTargets = true;
        }
        if (block.name === 'resolve_entity' && !isError && hasUsefulResolutionResult(toolResult)) {
          sawResolutionWithCandidates = true;
        }

        if (emit) {
          await emit('tool_result', {
            name: block.name,
            ok: toolOk,
            sourceBooks: toolResult.sourceBooks,
          });
          const artifact = sectionArtifactFromToolResult(block.name, toolResult);
          if (artifact) await emit('artifact', artifact);
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: toolResult.content,
          is_error: isError,
        } as ContentBlockParam);
      }

      nextMessages.push({ role: 'user' as const, content: toolResults });
      if (sawResolutionWithCandidates) {
        nextMessages.push({ role: 'user' as const, content: RESOLUTION_TARGET_PROMPT });
      }
      if (sawNeighborsWithTargets) {
        nextMessages.push({ role: 'user' as const, content: NEIGHBORS_TARGET_PROMPT });
      }
      if (
        shouldForceSynthesis(
          { ...state, broadRuleSearches, hasUsedNonRuleSearchTool },
          broadSearchSynthesisThreshold,
        )
      ) {
        forceSynthesis = true;
        nextMessages.push({ role: 'user' as const, content: FORCE_SYNTHESIS_PROMPT });
      }

      return {
        messages: nextMessages,
        toolCalls: nextToolCalls,
        broadRuleSearches,
        hasUsedNonRuleSearchTool,
        forceSynthesis,
      };
    })
    .addNode('verify_sources', async (state: LangGraphStateValue) => {
      const readyToAnswer = hasDirectOpenedEvidence(state.toolCalls);
      await emitGraphDebug(emit, 'LangGraph verify_sources node completed.', {
        readyToAnswer,
        toolCallCount: state.toolCalls.length,
      });
      return { readyToAnswer };
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
      if (state.readyToAnswer || state.forceSynthesis || state.iterations >= maxIterations) {
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
      const finalState = await graph.invoke(createInitialState(question, options), {
        configurable: { thread_id: threadIdFor(options) },
        metadata: langgraphCorrelationMetadata(options),
      });
      const result = {
        answer: finalState.finalAnswer,
        trajectory: trajectoryFromState(finalState, config.model),
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
