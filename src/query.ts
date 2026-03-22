/**
 * Query the Frosthaven knowledge base.
 * Usage: node src/query.ts "What is the loot action?"
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { embed } from './embedder.ts';
import { loadIndex, search } from './vector-store.ts';
import { searchExtracted, formatExtracted } from './extracted-data.ts';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const SYSTEM_PROMPT = `You are a knowledgeable Frosthaven rules assistant. \
Answer questions accurately based on the rulebook excerpts and card data provided. \
Be concise but complete. If the provided data doesn't contain enough information to answer confidently, say so. \
Do not invent rules, stats, or item numbers.`;

/**
 * Answer a Frosthaven rules question using RAG + structured card data.
 */
export async function askFrosthaven(question: string): Promise<string> {
  const index = loadIndex();
  if (index.length === 0) {
    return 'The rulebook index is empty. Run `npm run index` first to index the docs.';
  }

  // Run all lookups in parallel
  const [queryEmbedding, cardHits] = await Promise.all([
    embed(question),
    Promise.resolve(searchExtracted(question, 8)),
  ]);
  const hits = search(index, queryEmbedding, 6);

  const rulebookContext = hits
    .map((h, i) => `[${i + 1}] (${h.source})\n${h.text}`)
    .join('\n\n---\n\n');

  const cardContext = cardHits.length > 0 ? `\n\n## Card Data\n${formatExtracted(cardHits)}` : '';

  const userMessage = `## Rulebook Excerpts\n\n${rulebookContext}${cardContext}\n\n---\n\nQuestion: ${question}`;

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const block = response.content[0];
  return block.type === 'text' ? block.text : '';
}

// CLI entrypoint
if (process.argv[1]?.endsWith('query.ts')) {
  const question = process.argv.slice(2).join(' ');
  if (!question) {
    console.error('Usage: node src/query.ts "your question here"');
    process.exit(1);
  }
  console.log('Searching...\n');
  askFrosthaven(question)
    .then((answer) => console.log(answer))
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
