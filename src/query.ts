/**
 * Query the Frosthaven knowledge base.
 * Usage: node src/query.ts "What is the loot action?"
 *
 * This is a thin CLI wrapper over service.ts. All RAG logic lives there.
 */

import 'dotenv/config';
import { sdk } from './instrumentation.ts';
import { runAgentLoopWithTrajectory, type AgentRunResult } from './agent.ts';
import { initialize, ask } from './service.ts';
import type { AskOptions } from './service.ts';

/**
 * Answer a Frosthaven rules question using RAG + structured card data.
 * Delegates to service.ts for all logic.
 */
export async function askFrosthaven(question: string, options?: AskOptions): Promise<string> {
  await initialize();
  return options ? ask(question, options) : ask(question);
}

export async function askFrosthavenWithTrajectory(question: string): Promise<AgentRunResult> {
  await initialize();
  return runAgentLoopWithTrajectory(question);
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
