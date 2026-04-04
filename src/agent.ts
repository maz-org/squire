/**
 * Squire knowledge agent.
 * Replaces the fixed RAG pipeline with a tool-using agent loop that lets
 * Claude decide which atomic tools to call based on the question.
 */

import Anthropic from '@anthropic-ai/sdk';
import { searchRules, searchCards, listCardTypes, listCards, getCard } from './tools.ts';
import type { CardType } from './schemas.ts';
import type { AskOptions, HistoryMessage } from './service.ts';

type MessageParam = Anthropic.MessageParam;
type Tool = Anthropic.Tool;
type ContentBlockParam = Anthropic.ContentBlockParam;

const client = new Anthropic();

/** Maximum agent loop iterations to prevent runaway tool calls. */
export const MAX_AGENT_ITERATIONS = 10;

/** Maximum number of history messages to include. */
const MAX_HISTORY_TURNS = 20;

const CARD_TYPES = [
  'monster-stats',
  'monster-abilities',
  'character-abilities',
  'items',
  'events',
  'battle-goals',
  'buildings',
] as const;

export const AGENT_SYSTEM_PROMPT = `You are a knowledgeable Frosthaven rules assistant with access to tools \
for searching the rulebook and looking up card data. Use the tools to find relevant information before answering.

Guidelines:
- Use search_rules for rulebook questions (rules, mechanics, timing, etc.)
- Use search_cards for questions about specific cards, monsters, items, or abilities
- Use get_card for precise lookups when you know the card type and name/number
- Use list_card_types to discover what data is available
- Use list_cards to browse or filter cards of a specific type
- You may call multiple tools or call the same tool multiple times to gather enough context
- Answer accurately based on the retrieved data. If the data doesn't contain enough information, say so.
- Do not invent rules, stats, or item numbers.
- Be concise but complete.`;

export const AGENT_TOOLS: Tool[] = [
  {
    name: 'search_rules',
    description: 'Search the Frosthaven rulebook for passages relevant to a query.',
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
          type: 'string',
          description: 'Optional JSON filter object (AND logic), e.g. {"name":"Algox Archer"}',
        },
      },
      required: ['type'],
    },
  },
  {
    name: 'get_card',
    description: 'Look up a single card by type and identifier (name, number, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: [...CARD_TYPES],
          description: 'Card type',
        },
        id: { type: 'string', description: 'Card identifier (name, number, etc.)' },
      },
      required: ['type', 'id'],
    },
  },
];

/**
 * Execute a single tool call and return the result as a string.
 */
export async function executeToolCall(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case 'search_rules': {
      const results = await searchRules(
        input.query as string,
        (input.topK as number | undefined) ?? 6,
      );
      return JSON.stringify(results, null, 2);
    }
    case 'search_cards': {
      const results = searchCards(input.query as string, (input.topK as number | undefined) ?? 6);
      return JSON.stringify(results, null, 2);
    }
    case 'list_card_types': {
      return JSON.stringify(listCardTypes(), null, 2);
    }
    case 'list_cards': {
      let filter: Record<string, unknown> | undefined;
      if (input.filter) {
        filter = JSON.parse(input.filter as string) as Record<string, unknown>;
      }
      const cards = listCards(input.type as CardType, filter);
      return JSON.stringify(cards, null, 2);
    }
    case 'get_card': {
      const card = getCard(input.type as CardType, input.id as string);
      if (!card) return `Card not found: ${input.type}/${input.id}`;
      return JSON.stringify(card, null, 2);
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

/**
 * Run the knowledge agent loop. Claude decides which tools to call,
 * iterates until it has enough context, then produces a final answer.
 */
export async function runAgentLoop(question: string, options?: AskOptions): Promise<string> {
  const history = options?.history;
  const truncatedHistory = history ? history.slice(-MAX_HISTORY_TURNS) : [];

  const messages: MessageParam[] = [
    ...truncatedHistory.map((m: HistoryMessage) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: question },
  ];

  let lastTextContent = '';

  for (let i = 0; i < MAX_AGENT_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: AGENT_SYSTEM_PROMPT,
      tools: AGENT_TOOLS,
      messages,
    });

    // Collect any text content from this response
    for (const block of response.content) {
      if (block.type === 'text') {
        lastTextContent = block.text;
      }
    }

    // If the model is done (no more tool calls), return the answer
    if (response.stop_reason === 'end_turn') {
      return lastTextContent;
    }

    // Process tool calls
    if (response.stop_reason === 'tool_use') {
      // Add the assistant's response (with tool_use blocks) to messages
      messages.push({ role: 'assistant', content: response.content });

      // Execute each tool call and build tool_result blocks
      const toolResults: ContentBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          const result = await executeToolCall(block.name, block.input as Record<string, unknown>);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result,
          } as ContentBlockParam);
        }
      }

      messages.push({ role: 'user', content: toolResults });
    }
  }

  // Iteration limit reached — return whatever text we have
  return lastTextContent || 'I was unable to produce an answer within the allowed number of steps.';
}
