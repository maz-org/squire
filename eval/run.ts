/**
 * RAG pipeline evaluation runner using LangSmith datasets and experiments.
 *
 * First run:  node eval/run.ts --seed        # publish suite datasets to LangSmith
 * Run eval:   node eval/run.ts               # run native LangSmith experiments
 * Filtered:   node eval/run.ts --game=frosthaven --suite=table-qa
 *             node eval/run.ts --category=rulebook
 *             node eval/run.ts --id=rule-poison
 * Named run:  node eval/run.ts --run-label="after chunking fix"
 * Matrix:     node eval/run.ts --matrix --id=rule-poison --agent-runtime=langgraph --local-report=/tmp/eval.json
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
