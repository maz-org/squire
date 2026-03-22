/**
 * Query the Frosthaven knowledge base.
 * Usage: node src/query.ts "What is the loot action?"
 */

import 'dotenv/config';
import { sdk } from './instrumentation.ts';
import Anthropic from '@anthropic-ai/sdk';
import { startActiveObservation, startObservation } from '@langfuse/tracing';
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
  return startActiveObservation('rag-query', async (trace) => {
    trace.update({ input: { question } });

    const index = loadIndex();
    if (index.length === 0) {
      trace.update({ output: 'empty index' });
      return 'The rulebook index is empty. Run `npm run index` first to index the docs.';
    }

    // Step 1: Embed query
    const embedObs = startObservation('embed-query', { input: { text: question } });
    const queryEmbedding = await embed(question);
    embedObs.update({ output: { dimensions: queryEmbedding.length } });
    embedObs.end();

    // Step 2: Vector search
    const searchObs = startObservation('vector-search', { input: { topK: 6 } });
    const hits = search(index, queryEmbedding, 6);
    searchObs.update({ output: { resultCount: hits.length, sources: hits.map((h) => h.source) } });
    searchObs.end();

    // Step 3: Card data search
    const cardObs = startObservation('card-search', { input: { topK: 8 } });
    const cardHits = searchExtracted(question, 8);
    cardObs.update({ output: { resultCount: cardHits.length } });
    cardObs.end();

    // Step 4: LLM generation
    const rulebookContext = hits
      .map((h, i) => `[${i + 1}] (${h.source})\n${h.text}`)
      .join('\n\n---\n\n');
    const cardContext = cardHits.length > 0 ? `\n\n## Card Data\n${formatExtracted(cardHits)}` : '';
    const userMessage = `## Rulebook Excerpts\n\n${rulebookContext}${cardContext}\n\n---\n\nQuestion: ${question}`;

    const genObs = startObservation(
      'claude-generation',
      {
        model: 'claude-opus-4-6',
        input: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        modelParameters: { max_tokens: 1024 },
      },
      { asType: 'generation' },
    );

    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const block = response.content[0];
    const answer = block.type === 'text' ? block.text : '';

    genObs.update({
      output: answer,
      usageDetails: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
    });
    genObs.end();

    trace.update({ output: answer });
    return answer;
  });
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
    .then(async (answer) => {
      console.log(answer);
      await sdk.shutdown();
    })
    .catch(async (err: unknown) => {
      console.error(err);
      await sdk.shutdown();
      process.exit(1);
    });
}
