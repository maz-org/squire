/**
 * Squire knowledge agent.
 * Replaces the fixed RAG pipeline with a tool-using agent loop that lets
 * Claude decide which atomic tools to call based on the question.
 */

import Anthropic from '@anthropic-ai/sdk';
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

const client = new Anthropic();

/** Maximum agent loop iterations to prevent runaway tool calls. */
export const MAX_AGENT_ITERATIONS = 10;

/** Maximum repeated broad book searches before forcing synthesis. */
const MAX_RULE_SEARCHES_BEFORE_SYNTHESIS = 3;

/** Maximum number of history messages to include. */
const MAX_HISTORY_TURNS = 20;

const FORCE_SYNTHESIS_PROMPT =
  'Use the retrieved rulebook context to answer now. Do not search again unless the existing tool results are empty or clearly unrelated.';

const ANSWER_FORMATTING_PROMPT = `Formatting:
- Use *italics* only for named Frosthaven game terms — mechanics, abilities, conditions, status effects, keyword phrases (e.g., *Muddle*, *Shield 1*, *Retaliate*, *Loot 2*, *Move 3*). The UI renders these as a highlighted rule-term chip, so emphasizing prose words like *not* or *however* turns ordinary stress into a false rule citation. Use **bold** for general emphasis instead.
- Use > blockquotes when you reproduce literal rulebook text. Don't wrap quoted sentences in italics.`;

export const AGENT_SYSTEM_PROMPT = `You are Squire, a Frosthaven rules assistant. Answer the user's question using the provided knowledge tools.

Grounding rules:
- Use tools before answering factual rules, scenario, section, card, monster, item, or ability questions.
- Treat tool results as the source of truth. Do not invent rules, stats, item numbers, section text, or scenario outcomes.
- If the available data does not answer the question, say what is missing instead of guessing.
- Resolve natural user language to refs when exact records are needed, then open or traverse those refs.
- Follow explicit links between records when the answer depends on connected scenario or section text.

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
      'Resolve natural references like "scenario 61", "section 90.2", "Spyglass", or "Blinkblade level 4 cards" to ranked opener-ready entity refs.',
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
      'Open one exact Squire entity by canonical ref: rules passage, scenario, section, or card.',
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
    description: 'Traverse known outgoing relationships from a scenario or section ref.',
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

type AgentToolSurface = 'redesigned' | 'legacy';

function selectedAgentSurface(surface: AgentToolSurface | undefined): {
  system: string;
  tools: readonly Tool[];
} {
  if (surface === 'legacy') {
    return {
      system: LEGACY_AGENT_SYSTEM_PROMPT,
      tools: LEGACY_AGENT_TOOLS,
    };
  }
  return {
    system: AGENT_SYSTEM_PROMPT,
    tools: AGENT_TOOLS,
  };
}

export interface ToolCallResult {
  content: string;
  /** Distinct provenance labels for dynamic result sources. */
  sourceBooks?: string[];
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
      const scope = Array.isArray(input.scope) ? (input.scope as never[]) : undefined;
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
  opts: { allowTools?: boolean; toolSurface?: AgentToolSurface } = {},
): Promise<Message> {
  const allowTools = opts.allowTools ?? true;
  const surface = selectedAgentSurface(opts.toolSurface);
  const params = {
    model: 'claude-sonnet-4-6' as const,
    max_tokens: 4096,
    system: surface.system,
    messages,
  };

  const paramsWithTools = allowTools
    ? {
        ...params,
        // Spread into a mutable array so the readonly tool tuples
        // (declared `as const` to power the AgentToolName union) satisfies
        // the Anthropic SDK's `ToolUnion[]` signature.
        tools: [...surface.tools],
      }
    : params;

  if (!emit) {
    return client.messages.create(paramsWithTools);
  }

  const stream = client.messages.stream(paramsWithTools);
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
  const history = options?.history;
  const emit = options?.emit;
  const toolSurface = options?.toolSurface;
  const truncatedHistory = history ? history.slice(-MAX_HISTORY_TURNS) : [];

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

  for (let i = 0; i < MAX_AGENT_ITERATIONS; i++) {
    const response = await callClaude(messages, emit, {
      allowTools: !forceSynthesis,
      toolSurface,
    });
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
      return lastTextContent;
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
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          if (block.name === 'search_rules') {
            broadRuleSearches += 1;
          } else if (!DISCOVERY_ONLY_TOOL_NAMES.has(block.name as AgentToolName)) {
            hasUsedNonRuleSearchTool = true;
          }

          if (emit) {
            await emit('tool_call', { name: block.name, input: block.input });
          }

          let toolResult: ToolCallResult;
          let isError = false;
          try {
            toolResult = await executeToolCall(block.name, block.input as Record<string, unknown>);
          } catch (err) {
            toolResult = {
              content: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
            };
            isError = true;
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
      // Simple factual rule lookups can drift into repeated broad searches.
      // After three rule-corpus searches, force synthesis from gathered context
      // without lowering the global loop budget needed by traversal questions.
      if (broadRuleSearches >= MAX_RULE_SEARCHES_BEFORE_SYNTHESIS && !hasUsedNonRuleSearchTool) {
        forceSynthesis = true;
        messages.push({ role: 'user', content: FORCE_SYNTHESIS_PROMPT });
      }
      continue;
    }

    // Unrecoverable stop reasons (refusal, context window exceeded, etc.)
    if (emit) await emit('done', {});
    return lastTextContent || 'I was unable to answer this question.';
  }

  // Iteration limit reached
  if (emit) await emit('done', {});
  return lastTextContent || 'I was unable to produce an answer within the allowed number of steps.';
}
