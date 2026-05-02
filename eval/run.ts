/**
 * RAG pipeline evaluation runner using Langfuse datasets & experiments.
 *
 * First run:  node eval/run.ts --seed        # upload dataset to Langfuse
 * Run eval:   node eval/run.ts               # run all questions on redesigned tools
 * Legacy:     node eval/run.ts --tool-surface=legacy
 * Filtered:   node eval/run.ts --category=rulebook
 *             node eval/run.ts --id=rule-poison
 * Named run:  node eval/run.ts --run-label="after chunking fix"
 * Local JSON: node eval/run.ts --local-report=/tmp/eval.json
 * Matrix:     node eval/run.ts --matrix --id=rule-poison
 */

import 'dotenv/config';
import { sdk } from '../src/instrumentation.ts';
import { parseEvalArgs } from './cli.ts';
import { runEval } from './runner.ts';

try {
  await runEval(parseEvalArgs(process.argv.slice(2)));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await sdk.shutdown();
}
