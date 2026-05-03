/**
 * Squire knowledge agent.
 * Replaces the fixed RAG pipeline with a tool-using agent loop that lets
 * Claude decide which atomic tools to call based on the question.
 */

import Anthropic from '@anthropic-ai/sdk';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import {
  searchRules,
  searchCards,
  searchKnowledge,
  listCardTypes,
  listCards,
  getCard,
  inspectSources,
  getSchema,
  resolveEntity,
  openEntity,
  findScenario,
  getScenario,
  getSection,
  followLinks,
  neighbors,
} from './tools.ts';
import type { KnowledgeEntityKind } from './tools.ts';
import { CARD_TYPES, type CardType } from './schemas.ts';
import type { AskOptions, HistoryMessage, EmitFn } from './service.ts';
import {
  BOOK_RECORD_KINDS,
  BOOK_REFERENCE_TYPES,
  type BookRecordKind,
} from './scenario-section-schemas.ts';

type MessageParam = Anthropic.MessageParam;
type Tool = Anthropic.Tool;
type ContentBlockParam = Anthropic.ContentBlockParam;
type Message = Anthropic.Message;
type StopReason = Message['stop_reason'];

const client = new Anthropic();
const tracer = trace.getTracer('squire.agent');

/** Maximum agent loop iterations to prevent runaway tool calls. */
export const MAX_AGENT_ITERATIONS = 10;

/** Maximum repeated broad book searches before forcing synthesis. */
const MAX_RULE_SEARCHES_BEFORE_SYNTHESIS = 3;

/** Maximum number of history messages to include. */
const MAX_HISTORY_TURNS = 20;

const FORCE_SYNTHESIS_PROMPT =
  'Use the retrieved rulebook context to answer now. Do not search again unless the existing tool results are empty or clearly unrelated.';

const NEIGHBORS_TARGET_PROMPT =
  'If this neighbors result completes the requested traversal, use it as the traversal answer. If the question asks to show, open, quote, cite, list, or explain returned section/scenario content, call open_entity on the returned canonical ref before answering. Do not answer from a pointer alone when the user asked for the target text or its contents. Do not search for another path unless neighbors returned no relevant target.';

const RESOLUTION_TARGET_PROMPT =
  'You now have canonical candidate refs. If the user asked for an exact record or source text, open the best matching exact ref before answering. If the user also asked for fuzzy/contextual matches, keep those separate and use search only for the fuzzy part.';

const ANSWER_FORMATTING_PROMPT = `Formatting:
- Use *italics* only for named Frosthaven game terms — mechanics, abilities, conditions, status effects, keyword phrases (e.g., *Muddle*, *Shield 1*, *Retaliate*, *Loot 2*, *Move 3*). The UI renders these as a highlighted rule-term chip, so emphasizing prose words like *not* or *however* turns ordinary stress into a false rule citation. Use **bold** for general emphasis instead.
- Use > blockquotes when you reproduce literal rulebook text. Don't wrap quoted sentences in italics.`;

export const AGENT_SYSTEM_PROMPT = `You are Squire, a Frosthaven rules assistant. Answer the user's question using the provided knowledge tools.

Grounding rules:
- Use tools before answering factual rules, scenario, section, card, monster, item, or ability questions.
- Treat tool results as the source of truth. Do not invent rules, stats, item numbers, section text, or scenario outcomes.
- If the available data does not answer the question, say what is missing instead of guessing.
- Resolve natural user language to refs when exact records are needed, then open or traverse those refs.
- For scenario/section relationship questions, resolve the named scenario or section first, then open or traverse the canonical ref.
- For named card-data records such as items, monsters, buildings, events, battle goals, personal quests, and character mats, resolve the record first and then open the exact ref.
- When an exact record has null or empty fields, state that the field is not available in the checked-in data. Do not recommend physical components, community knowledge, memory, or likely values as a substitute for missing tool data.
- For building records, treat a cost object as known no-cost only when every numeric cost field is 0, including prosperity when present. If resources are 0 but prosperity is non-zero, say there is no resource cost but there is still a prosperity requirement.
- If the user asks you to resolve something, call resolve_entity before opening or answering.
- When the user gives an explicit game qualifier, preserve it in canonical refs such as section:gloomhaven2/67.1; never invent URI forms like gloomhaven2://section/67.1.
- Use neighbors for scenario/section traversal questions, including conclusions, read-now links, unlocks, next links, and related records. Open entities for record text after traversal identifies the target.
- When neighbors returns the requested unlock, conclusion, read-now, next, or related target, open that target if text is needed, then answer. Do not search for a second path unless neighbors returns no relevant target.
- For multi-hop traversal questions, open the starting record, then call neighbors for each hop; do not rely on open_entity links alone.
- For direct "related records" questions, a neighbors result is enough unless the user asks for full text from each neighbor.
- When comparing exact records with fuzzy search matches, open the exact requested record and use search result summaries for fuzzy/contextual matches. Do not open every fuzzy match unless the user asks for full details.

Citations and answer shape:
- Cite the book, section, scenario, or card source when the tool result provides one.
- Be concise, but include enough detail for the table to act on the answer.
- When quoting rules text, quote only the relevant sentence or short passage.

${ANSWER_FORMATTING_PROMPT}`;

export const LEGACY_AGENT_SYSTEM_PROMPT = `You are a knowledgeable Frosthaven rules assistant with access to tools \
for searching the indexed Frosthaven books and looking up card data. Use the tools to find relevant information before answering.

Guidelines:
- Use inspect_sources and schema when you need to discover available kinds, filters, refs, or relations
- Use resolve_entity to turn natural references into opener-ready scenario, section, card type, or card refs
- Prefer search_knowledge for broad discovery across rules, scenarios, sections, and cards
- Use open_entity when you have an exact canonical ref
- Use neighbors to traverse explicit scenario/section links from a canonical ref
- Use find_scenario when the user names a scenario number or scenario title
- Use get_scenario once you know the exact canonical scenario ref
- Use get_section for exact section refs or when a traversal link points to a section
- Use follow_links to inspect explicit scenario/section reference chains
- For chained scenario/section questions, keep following explicit references until you reach the exact grounded text you need
- Prefer explicit scenario/section references over search_rules when the question already names a scenario number, scenario title, or section ref
- Use search_rules for fuzzy book-corpus questions (rules, mechanics, open-ended discovery, or when traversal runs out)
- Use search_cards for questions about specific cards, monsters, items, or abilities
- Use get_card for precise lookups only when you know the card type and canonical sourceId
- If you only know a natural card reference such as a name or number, use resolve_entity, search_cards, or list_cards first to find the canonical sourceId
- Use list_card_types to discover what data is available
- Use list_cards to browse or filter cards of a specific type
- You may call multiple tools or call the same tool multiple times to gather enough context
- Answer accurately based on the retrieved data. If the data doesn't contain enough information, say so.
- Do not invent rules, stats, or item numbers.
- Be concise but complete.

${ANSWER_FORMATTING_PROMPT}`;

// `as const satisfies readonly Tool[]` lets us derive `AgentToolName` below
// as a literal union of the tool names. That union is what powers the
// compile-time drift guard on `TOOL_SOURCE_LABELS` in
// src/web-ui/consulted-footer.ts — adding a tool here without also
// extending the label map is a typecheck error, so the consulted-sources
// footer can never silently drop a tool.
export const AGENT_TOOLS = [
  {
    name: 'inspect_sources',
    description:
      'Discover available Frosthaven knowledge sources, entity kinds, relation kinds, and live record counts before choosing a lookup tool.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'schema',
    description:
      'Inspect fields, filters, ref patterns, examples, and relations for a source kind returned by inspect_sources.',
    input_schema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          description: 'Entity kind or common alias, such as card, item, scenario, or section',
        },
      },
      required: ['kind'],
    },
  },
  {
    name: 'resolve_entity',
    description:
      'Resolve natural references like "scenario 61", "section 90.2", "Spyglass", "Alchemist building", or "Blinkblade level 4 cards" to ranked opener-ready entity refs.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language entity reference' },
        kinds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional kind filters returned by inspect_sources, plus common aliases',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: 'Maximum candidates (1-20, default 6)',
          default: 6,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'open_entity',
    description:
      'Open one exact Squire entity by canonical ref: rules:<game>/<source>#chunk=N, scenario:<game>/<id>, section:<game>/<id>, or card:<game>/<type>/<sourceId>. Do not use this as the only step for traversal questions; call neighbors to follow links. Use this to validate unavailable game-qualified refs instead of inventing URI forms.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Canonical inspectable ref' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'search_knowledge',
    description:
      'Search rules passages, scenarios, sections, and cards. Results include openable refs, citations, source labels, and next refs.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        scope: {
          type: 'array',
          items: { type: 'string', enum: ['rules_passage', 'scenario', 'section', 'card'] },
          description: 'Optional searchable kind filter',
        },
        limit: { type: 'integer', description: 'Global result limit (default 6)', default: 6 },
      },
      required: ['query'],
    },
  },
  {
    name: 'neighbors',
    description:
      'Traverse known relationships from a scenario or section ref, including incoming section links and unlocks for a scenario. Use this even when open_entity shows links; it is the traversal tool for conclusions, read-now links, unlocks, next links, and related scenario/section questions.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Canonical traversable ref' },
        relation: {
          type: 'string',
          enum: [...BOOK_REFERENCE_TYPES],
          description: 'Optional relation filter like "conclusion" or "section_link"',
        },
        limit: { type: 'integer', description: 'Maximum neighbors (default 20)', default: 20 },
      },
      required: ['ref'],
    },
  },
] as const satisfies readonly Tool[];

export const LEGACY_AGENT_TOOLS = [
  {
    name: 'search_rules',
    description:
      'Search the indexed Frosthaven books (rulebook, scenario book, section book, puzzle book) for passages relevant to a query.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        topK: { type: 'integer', description: 'Number of results (default 6)', default: 6 },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_cards',
    description: 'Search extracted card data using keyword matching.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        topK: { type: 'integer', description: 'Number of results (default 6)', default: 6 },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_card_types',
    description: 'List all available card types with record counts.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_cards',
    description: 'List cards of a given type, optionally filtered by field values.',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: [...CARD_TYPES],
          description: 'Card type to list',
        },
        filter: {
          type: 'object',
          description: 'Optional field/value filters (AND logic)',
        },
      },
      required: ['type'],
    },
  },
  {
    name: 'get_card',
    description: 'Look up a single card by type and canonical sourceId.',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: [...CARD_TYPES],
          description: 'Card type',
        },
        id: {
          type: 'string',
          description:
            'Canonical sourceId (e.g. "gloomhavensecretariat:item/1"). Case-sensitive. Use list_cards or search_cards to discover sourceIds.',
        },
      },
      required: ['type', 'id'],
    },
  },
  {
    name: 'find_scenario',
    description:
      'Resolve a scenario query like "scenario 61" or "Life and Death" to matching scenario records.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Scenario query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_scenario',
    description: 'Fetch an exact scenario record by canonical scenario ref.',
    input_schema: {
      type: 'object',
      properties: {
        ref: {
          type: 'string',
          description:
            'Canonical scenario ref like "gloomhavensecretariat:scenario/061". Use find_scenario if you only know the number or name.',
        },
      },
      required: ['ref'],
    },
  },
  {
    name: 'get_section',
    description: 'Fetch an exact section record by section ref like "90.2".',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Section ref like "90.2"' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'follow_links',
    description:
      'Follow explicit scenario/section book references from a known scenario or section.',
    input_schema: {
      type: 'object',
      properties: {
        fromKind: {
          type: 'string',
          enum: [...BOOK_RECORD_KINDS],
          description: 'Entity kind to follow from',
        },
        fromRef: {
          type: 'string',
          description: 'Canonical scenario or section ref',
        },
        linkType: {
          type: 'string',
          enum: [...BOOK_REFERENCE_TYPES],
          description: 'Optional link-type filter like "conclusion" or "section_link"',
        },
      },
      required: ['fromKind', 'fromRef'],
    },
  },
] as const satisfies readonly Tool[];

export const ALL_AGENT_TOOLS = [...AGENT_TOOLS, ...LEGACY_AGENT_TOOLS] as const;

/** Union of every selectable tool name. Keeps dependent maps honest. */
export type AgentToolName = (typeof ALL_AGENT_TOOLS)[number]['name'];

export type AgentToolSurface = 'redesigned' | 'legacy';

function selectedAgentSurface(surface: AgentToolSurface | undefined): {
  system: string;
  tools: readonly Tool[];
} {
  if (surface === 'redesigned') {
    return { system: AGENT_SYSTEM_PROMPT, tools: AGENT_TOOLS };
  }
  return { system: LEGACY_AGENT_SYSTEM_PROMPT, tools: LEGACY_AGENT_TOOLS };
}

export interface ToolCallResult {
  content: string;
  /** Distinct provenance labels for dynamic result sources. */
  sourceBooks?: string[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
}

export type AnthropicEvalModel = 'claude-sonnet-4-6' | 'claude-opus-4-7' | 'claude-haiku-4-5';

export interface ToolTrajectoryStep {
  iteration: number;
  id: string;
  name: string;
  input: Record<string, unknown>;
  ok: boolean;
  outputSummary: string;
  sourceLabels: string[];
  canonicalRefs: string[];
  error?: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
}

export interface ModelTrajectoryStep {
  iteration: number;
  model: string;
  stopReason: StopReason | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  content: unknown;
  startedAt: string;
  endedAt: string;
  durationMs: number;
}

export interface AgentRunTrajectory {
  toolCalls: ToolTrajectoryStep[];
  modelCalls: ModelTrajectoryStep[];
  finalAnswer: string;
  tokenUsage: TokenUsage;
  model: string;
  iterations: number;
  stopReason: StopReason | 'iteration_limit' | null;
}

export interface AgentRunResult {
  answer: string;
  trajectory: AgentRunTrajectory;
}

export interface EvalAgentLoopOptions {
  toolSurface?: AgentToolSurface;
  anthropicModel: AnthropicEvalModel;
  maxOutputTokens?: number;
  timeoutMs?: number;
  toolLoopLimit?: number;
  broadSearchSynthesisThreshold?: number;
}

const AGENT_MODEL = 'claude-sonnet-4-6' as const;
const MAX_ATTRIBUTE_TEXT_LENGTH = 2_000;
const PROMPT_CACHE_CONTROL: Anthropic.CacheControlEphemeral = { type: 'ephemeral', ttl: '1h' };

function truncateForAttribute(value: string, maxLength = MAX_ATTRIBUTE_TEXT_LENGTH): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function addUsage(total: TokenUsage, response: Message): void {
  total.inputTokens += response.usage.input_tokens;
  total.outputTokens += response.usage.output_tokens;
  total.cacheCreationInputTokens += response.usage.cache_creation_input_tokens ?? 0;
  total.cacheReadInputTokens += response.usage.cache_read_input_tokens ?? 0;
  total.totalTokens =
    total.inputTokens +
    total.outputTokens +
    total.cacheCreationInputTokens +
    total.cacheReadInputTokens;
}

function emptyTokenUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: 0,
  };
}

function collectCanonicalRefs(value: unknown, refs = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return refs;
  if (Array.isArray(value)) {
    for (const item of value) collectCanonicalRefs(item, refs);
    return refs;
  }

  for (const [key, nested] of Object.entries(value)) {
    if ((key === 'ref' || key === 'sourceId') && typeof nested === 'string') {
      refs.add(nested);
    } else {
      collectCanonicalRefs(nested, refs);
    }
  }
  return refs;
}

function summarizeToolOutput(content: string): { summary: string; canonicalRefs: string[] } {
  try {
    const parsed = JSON.parse(content) as unknown;
    const canonicalRefs = [...collectCanonicalRefs(parsed)];
    if (Array.isArray(parsed)) {
      return {
        summary: `json array (${parsed.length} item${parsed.length === 1 ? '' : 's'})`,
        canonicalRefs,
      };
    }
    if (parsed && typeof parsed === 'object') {
      const keys = Object.keys(parsed).slice(0, 8);
      return {
        summary: `json object (${keys.join(', ') || 'no keys'})`,
        canonicalRefs,
      };
    }
    return { summary: `json ${typeof parsed}`, canonicalRefs };
  } catch {
    return { summary: truncateForAttribute(content, 240), canonicalRefs: [] };
  }
}

function hasUsefulNeighborsResult(result: ToolCallResult): boolean {
  try {
    const parsed = JSON.parse(result.content) as {
      ok?: unknown;
      neighbors?: unknown;
    };
    return parsed.ok === true && Array.isArray(parsed.neighbors) && parsed.neighbors.length > 0;
  } catch {
    return false;
  }
}

function hasUsefulResolutionResult(result: ToolCallResult): boolean {
  try {
    const parsed = JSON.parse(result.content) as {
      ok?: unknown;
      candidates?: unknown;
    };
    return parsed.ok === true && Array.isArray(parsed.candidates) && parsed.candidates.length > 0;
  } catch {
    return false;
  }
}

function sourceLabelsFromResult(value: unknown): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  const add = (label: unknown) => {
    if (typeof label !== 'string' || seen.has(label)) return;
    seen.add(label);
    labels.push(label);
  };

  if (!value || typeof value !== 'object') return labels;
  const result = value as {
    citations?: Array<{ sourceLabel?: unknown }>;
    results?: Array<{ citations?: Array<{ sourceLabel?: unknown }> }>;
  };

  for (const citation of result.citations ?? []) add(citation.sourceLabel);
  for (const hit of result.results ?? []) {
    for (const citation of hit.citations ?? []) add(citation.sourceLabel);
  }
  return labels;
}

const DISCOVERY_ONLY_TOOL_NAMES = new Set<AgentToolName>([
  'inspect_sources',
  'schema',
  'resolve_entity',
]);

function isBroadRuleSearchTool(toolName: string, input: Record<string, unknown>): boolean {
  if (toolName === 'search_rules') return true;
  if (toolName !== 'search_knowledge') return false;

  const scope = input.scope;
  if (!Array.isArray(scope) || scope.length === 0) return false;
  return scope.length > 0 && scope.every((kind) => kind === 'rules_passage');
}

function isNonRuleSearchTool(toolName: string, input: Record<string, unknown>): boolean {
  if (DISCOVERY_ONLY_TOOL_NAMES.has(toolName as AgentToolName)) return false;
  if (toolName === 'open_entity' && typeof input.ref === 'string') {
    return !input.ref.startsWith('rules:');
  }
  return !isBroadRuleSearchTool(toolName, input);
}

/**
 * Execute a single tool call and return the result content plus any per-result
 * provenance metadata. Dynamic search/open tools return distinct source labels
 * (e.g. "Rulebook", "Section Book 62-81") so callers can surface accurate
 * provenance instead of a static tool-name label.
 */
export async function executeToolCall(
  name: string,
  input: Record<string, unknown>,
): Promise<ToolCallResult> {
  switch (name) {
    case 'inspect_sources': {
      return { content: JSON.stringify(await inspectSources(), null, 2) };
    }
    case 'schema': {
      return { content: JSON.stringify(getSchema(input.kind as string), null, 2) };
    }
    case 'resolve_entity': {
      const kinds = Array.isArray(input.kinds)
        ? input.kinds.filter((kind): kind is string => typeof kind === 'string')
        : undefined;
      return {
        content: JSON.stringify(
          await resolveEntity(input.query as string, {
            kinds,
            limit: input.limit as number | undefined,
          }),
          null,
          2,
        ),
      };
    }
    case 'search_rules': {
      const results = await searchRules(
        input.query as string,
        (input.topK as number | undefined) ?? 6,
      );
      const seen = new Set<string>();
      const sourceBooks: string[] = [];
      for (const r of results) {
        if (r.sourceLabel && !seen.has(r.sourceLabel)) {
          seen.add(r.sourceLabel);
          sourceBooks.push(r.sourceLabel);
        }
      }
      return {
        content: JSON.stringify(results, null, 2),
        // Always include the array (even empty) so callers can distinguish
        // "tool doesn't produce book labels" (undefined) from "search found
        // nothing" ([]). An empty array means: searched, found no hits.
        sourceBooks,
      };
    }
    case 'search_cards': {
      const results = await searchCards(
        input.query as string,
        (input.topK as number | undefined) ?? 6,
      );
      return { content: JSON.stringify(results, null, 2) };
    }
    case 'search_knowledge': {
      const scope = Array.isArray(input.scope) ? (input.scope as KnowledgeEntityKind[]) : undefined;
      const result = await searchKnowledge(input.query as string, {
        scope,
        limit: (input.limit as number | undefined) ?? 6,
      });
      return {
        content: JSON.stringify(result, null, 2),
        sourceBooks: sourceLabelsFromResult(result),
      };
    }
    case 'open_entity': {
      const result = await openEntity(input.ref as string);
      return {
        content: JSON.stringify(result, null, 2),
        sourceBooks: sourceLabelsFromResult(result),
      };
    }
    case 'neighbors': {
      const result = await neighbors(input.ref as string, {
        relation: input.relation as (typeof BOOK_REFERENCE_TYPES)[number] | undefined,
        limit: (input.limit as number | undefined) ?? 20,
      });
      return { content: JSON.stringify(result, null, 2) };
    }
    case 'list_card_types': {
      return { content: JSON.stringify(await listCardTypes(), null, 2) };
    }
    case 'list_cards': {
      const filter =
        input.filter && typeof input.filter === 'object' && !Array.isArray(input.filter)
          ? (input.filter as Record<string, unknown>)
          : undefined;
      const cards = await listCards(input.type as CardType, filter);
      return { content: JSON.stringify(cards, null, 2) };
    }
    case 'get_card': {
      const card = await getCard(input.type as CardType, input.id as string);
      if (!card) return { content: `Card not found: ${input.type}/${input.id}` };
      return { content: JSON.stringify(card, null, 2) };
    }
    case 'find_scenario': {
      const scenarios = await findScenario(input.query as string);
      return { content: JSON.stringify(scenarios, null, 2) };
    }
    case 'get_scenario': {
      const scenario = await getScenario(input.ref as string);
      if (!scenario) return { content: `Scenario not found: ${input.ref}` };
      return { content: JSON.stringify(scenario, null, 2) };
    }
    case 'get_section': {
      const section = await getSection(input.ref as string);
      if (!section) return { content: `Section not found: ${input.ref}` };
      return { content: JSON.stringify(section, null, 2) };
    }
    case 'follow_links': {
      const links = await followLinks(
        input.fromKind as BookRecordKind,
        input.fromRef as string,
        input.linkType as (typeof BOOK_REFERENCE_TYPES)[number] | undefined,
      );
      return { content: JSON.stringify(links, null, 2) };
    }
    default:
      return { content: `Unknown tool: ${name}` };
  }
}

/**
 * Call the Claude API, either streaming or non-streaming based on emit.
 * Returns the final Message in both cases.
 */
async function callClaude(
  messages: MessageParam[],
  emit?: EmitFn,
  opts: {
    allowTools?: boolean;
    toolSurface?: AgentToolSurface;
    model?: string;
    maxOutputTokens?: number;
    timeoutMs?: number;
  } = {},
): Promise<Message> {
  const allowTools = opts.allowTools ?? true;
  const surface = selectedAgentSurface(opts.toolSurface);
  const includeTools = allowTools && surface.tools.length > 0;
  const params = {
    model: opts.model ?? AGENT_MODEL,
    max_tokens: opts.maxOutputTokens ?? 4096,
    system: surface.system,
    cache_control: PROMPT_CACHE_CONTROL,
    messages,
  };

  const paramsWithTools = includeTools
    ? {
        ...params,
        // Spread into a mutable array so the readonly tool tuples
        // (declared `as const` to power the AgentToolName union) satisfies
        // the Anthropic SDK's `ToolUnion[]` signature.
        tools: [...surface.tools],
      }
    : params;

  const requestOptions = opts.timeoutMs ? { timeout: opts.timeoutMs } : undefined;

  if (!emit) {
    if (requestOptions) return client.messages.create(paramsWithTools, requestOptions);
    return client.messages.create(paramsWithTools);
  }

  const stream = requestOptions
    ? client.messages.stream(paramsWithTools, requestOptions)
    : client.messages.stream(paramsWithTools);
  stream.on('text', (delta) => {
    void emit('text', { delta });
  });
  return stream.finalMessage();
}

/**
 * Run the knowledge agent loop. Claude decides which tools to call,
 * iterates until it has enough context, then produces a final answer.
 *
 * When `options.emit` is provided, text is streamed as it's generated
 * and tool activity is emitted as events.
 */
export async function runAgentLoop(question: string, options?: AskOptions): Promise<string> {
  const result = await runAgentLoopWithTrajectory(question, options);
  return result.answer;
}

export async function runAgentLoopWithTrajectory(
  question: string,
  options?: AskOptions,
): Promise<AgentRunResult> {
  return tracer.startActiveSpan('squire.agent.run', async (runSpan) => {
    try {
      const result = await runAgentLoopInternal(question, options);
      runSpan.setAttributes({
        'squire.agent.model': result.trajectory.model,
        'squire.agent.iterations': result.trajectory.iterations,
        'squire.agent.tool_call_count': result.trajectory.toolCalls.length,
        'squire.agent.stop_reason': result.trajectory.stopReason ?? 'unknown',
        'squire.agent.input_tokens': result.trajectory.tokenUsage.inputTokens,
        'squire.agent.output_tokens': result.trajectory.tokenUsage.outputTokens,
        'squire.agent.cache_creation_input_tokens':
          result.trajectory.tokenUsage.cacheCreationInputTokens,
        'squire.agent.cache_read_input_tokens': result.trajectory.tokenUsage.cacheReadInputTokens,
      });
      return result;
    } catch (err) {
      runSpan.recordException(err as Error);
      runSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      runSpan.end();
    }
  });
}

export async function runAgentLoopWithEvalConfig(
  question: string,
  options: EvalAgentLoopOptions,
): Promise<AgentRunResult> {
  return tracer.startActiveSpan('squire.agent.eval.run', async (runSpan) => {
    try {
      const result = await runAgentLoopInternal(
        question,
        { toolSurface: options.toolSurface },
        {
          model: options.anthropicModel,
          maxOutputTokens: options.maxOutputTokens,
          timeoutMs: options.timeoutMs,
          toolLoopLimit: options.toolLoopLimit,
          broadSearchSynthesisThreshold: options.broadSearchSynthesisThreshold,
        },
      );
      runSpan.setAttributes({
        'squire.agent.model': result.trajectory.model,
        'squire.agent.iterations': result.trajectory.iterations,
        'squire.agent.tool_call_count': result.trajectory.toolCalls.length,
        'squire.agent.stop_reason': result.trajectory.stopReason ?? 'unknown',
        'squire.agent.input_tokens': result.trajectory.tokenUsage.inputTokens,
        'squire.agent.output_tokens': result.trajectory.tokenUsage.outputTokens,
        'squire.agent.cache_creation_input_tokens':
          result.trajectory.tokenUsage.cacheCreationInputTokens,
        'squire.agent.cache_read_input_tokens': result.trajectory.tokenUsage.cacheReadInputTokens,
        'squire.agent.eval': true,
      });
      return result;
    } catch (err) {
      runSpan.recordException(err as Error);
      runSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      runSpan.end();
    }
  });
}

interface AgentLoopInternalConfig {
  model?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
  toolLoopLimit?: number;
  broadSearchSynthesisThreshold?: number;
}

async function runAgentLoopInternal(
  question: string,
  options?: AskOptions,
  config: AgentLoopInternalConfig = {},
): Promise<AgentRunResult> {
  const history = options?.history;
  const emit = options?.emit;
  const toolSurface = options?.toolSurface;
  const truncatedHistory = history ? history.slice(-MAX_HISTORY_TURNS) : [];
  const model = config.model ?? AGENT_MODEL;
  const maxIterations = config.toolLoopLimit ?? MAX_AGENT_ITERATIONS;
  const broadSearchSynthesisThreshold =
    config.broadSearchSynthesisThreshold ?? MAX_RULE_SEARCHES_BEFORE_SYNTHESIS;

  const messages: MessageParam[] = [
    ...truncatedHistory.map((m: HistoryMessage) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: question },
  ];

  let lastTextContent = '';
  let broadRuleSearches = 0;
  let hasUsedNonRuleSearchTool = false;
  let forceSynthesis = false;
  const toolCalls: ToolTrajectoryStep[] = [];
  const modelCalls: ModelTrajectoryStep[] = [];
  const tokenUsage: TokenUsage = emptyTokenUsage();
  let iterations = 0;

  for (let i = 0; i < maxIterations; i++) {
    iterations = i + 1;
    const modelStartedAtMs = Date.now();
    const modelStartedAt = new Date(modelStartedAtMs).toISOString();
    const response = await tracer.startActiveSpan('squire.agent.iteration', async (span) => {
      try {
        span.setAttributes({
          'squire.agent.iteration': i + 1,
          'squire.agent.allow_tools': !forceSynthesis,
          'squire.agent.message_count': messages.length,
        });
        const message = await callClaude(messages, emit, {
          allowTools: !forceSynthesis,
          toolSurface,
          model,
          maxOutputTokens: config.maxOutputTokens,
          timeoutMs: config.timeoutMs,
        });
        span.setAttributes({
          'squire.agent.stop_reason': message.stop_reason ?? 'unknown',
          'squire.agent.input_tokens': message.usage.input_tokens,
          'squire.agent.output_tokens': message.usage.output_tokens,
          'squire.agent.cache_creation_input_tokens':
            message.usage.cache_creation_input_tokens ?? 0,
          'squire.agent.cache_read_input_tokens': message.usage.cache_read_input_tokens ?? 0,
        });
        return message;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        });
        throw err;
      } finally {
        span.end();
      }
    });
    const modelEndedAtMs = Date.now();
    modelCalls.push({
      iteration: i + 1,
      model,
      stopReason: response.stop_reason,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
      content: response.content,
      startedAt: modelStartedAt,
      endedAt: new Date(modelEndedAtMs).toISOString(),
      durationMs: modelEndedAtMs - modelStartedAtMs,
    });
    addUsage(tokenUsage, response);
    const hasToolUse = response.content.some((block) => block.type === 'tool_use');

    // Collect all text content from this response
    const texts: string[] = [];
    for (const block of response.content) {
      if (block.type === 'text') {
        texts.push(block.text);
      }
    }
    // Text emitted alongside `tool_use` is scratch narration for the live
    // stream, not the final persisted answer. Only pure text turns count as
    // the assistant's saved answer content.
    if (texts.length > 0 && !hasToolUse) {
      lastTextContent = texts.join('\n\n');
    }

    // If the model is done (no more tool calls), return the answer
    if (response.stop_reason === 'end_turn' || response.stop_reason === 'stop_sequence') {
      if (emit) await emit('done', {});
      return {
        answer: lastTextContent,
        trajectory: {
          toolCalls,
          modelCalls,
          finalAnswer: lastTextContent,
          tokenUsage,
          model,
          iterations,
          stopReason: response.stop_reason,
        },
      };
    }

    // Max tokens or pause — append partial response and continue for more
    if (response.stop_reason === 'max_tokens' || response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: 'Continue.' });
      continue;
    }

    // Process tool calls
    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: ContentBlockParam[] = [];
      let sawNeighborsWithTargets = false;
      let sawResolutionWithCandidates = false;
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          const input = block.input as Record<string, unknown>;
          if (isBroadRuleSearchTool(block.name, input)) {
            broadRuleSearches += 1;
          } else if (isNonRuleSearchTool(block.name, input)) {
            hasUsedNonRuleSearchTool = true;
          }

          if (emit) {
            await emit('tool_call', { name: block.name, input: block.input });
          }

          const toolStartedAtMs = Date.now();
          const toolStartedAt = new Date(toolStartedAtMs).toISOString();
          let toolResult: ToolCallResult;
          let isError = false;
          let errorMessage: string | undefined;
          try {
            toolResult = await tracer.startActiveSpan('squire.agent.tool', async (span) => {
              try {
                span.setAttributes({
                  'squire.agent.iteration': i + 1,
                  'squire.agent.tool.id': block.id,
                  'squire.agent.tool.name': block.name,
                  'squire.agent.tool.input': truncateForAttribute(JSON.stringify(block.input)),
                });
                const result = await executeToolCall(
                  block.name,
                  block.input as Record<string, unknown>,
                );
                const { summary, canonicalRefs } = summarizeToolOutput(result.content);
                span.setAttributes({
                  'squire.agent.tool.ok': true,
                  'squire.agent.tool.output_summary': summary,
                  'squire.agent.tool.source_labels': result.sourceBooks ?? [],
                  'squire.agent.tool.canonical_refs': canonicalRefs,
                });
                return result;
              } catch (err) {
                span.recordException(err as Error);
                span.setStatus({
                  code: SpanStatusCode.ERROR,
                  message: err instanceof Error ? err.message : String(err),
                });
                throw err;
              } finally {
                span.end();
              }
            });
          } catch (err) {
            errorMessage = err instanceof Error ? err.message : String(err);
            toolResult = {
              content: `Tool error: ${errorMessage}`,
            };
            isError = true;
          }
          const toolEndedAtMs = Date.now();
          const { summary, canonicalRefs } = summarizeToolOutput(toolResult.content);
          toolCalls.push({
            iteration: i + 1,
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
            ok: !isError,
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
          if (
            block.name === 'resolve_entity' &&
            !isError &&
            hasUsefulResolutionResult(toolResult)
          ) {
            sawResolutionWithCandidates = true;
          }

          if (emit) {
            await emit('tool_result', {
              name: block.name,
              ok: !isError,
              sourceBooks: toolResult.sourceBooks,
            });
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: toolResult.content,
            is_error: isError,
          } as ContentBlockParam);
        }
      }

      messages.push({ role: 'user', content: toolResults });
      if (sawResolutionWithCandidates) {
        messages.push({ role: 'user', content: RESOLUTION_TARGET_PROMPT });
      }
      if (sawNeighborsWithTargets) {
        messages.push({ role: 'user', content: NEIGHBORS_TARGET_PROMPT });
      }
      // Simple factual rule lookups can drift into repeated broad searches.
      // After three rule-corpus searches, force synthesis from gathered context
      // without lowering the global loop budget needed by traversal questions.
      if (broadRuleSearches >= broadSearchSynthesisThreshold && !hasUsedNonRuleSearchTool) {
        forceSynthesis = true;
        messages.push({ role: 'user', content: FORCE_SYNTHESIS_PROMPT });
      }
      continue;
    }

    // Unrecoverable stop reasons (refusal, context window exceeded, etc.)
    if (emit) await emit('done', {});
    const answer = lastTextContent || 'I was unable to answer this question.';
    return {
      answer,
      trajectory: {
        toolCalls,
        modelCalls,
        finalAnswer: answer,
        tokenUsage,
        model,
        iterations,
        stopReason: response.stop_reason,
      },
    };
  }

  // Iteration limit reached
  if (emit) await emit('done', {});
  const answer =
    lastTextContent || 'I was unable to produce an answer within the allowed number of steps.';
  return {
    answer,
    trajectory: {
      toolCalls,
      modelCalls,
      finalAnswer: answer,
      tokenUsage,
      model,
      iterations,
      stopReason: 'iteration_limit',
    },
  };
}
