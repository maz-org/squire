/**
 * Minimal local LangGraph adapter for Squire's existing agent loop.
 *
 * SQR-224 intentionally keeps Squire's tools, prompts, persistence, and browser
 * SSE contract owned by the app. LangGraph is only introduced behind `ask()` to
 * prove node-scoped stream routing: non-final graph work can emit tool/debug
 * events, while answer text is emitted only from the explicit `final_answer`
 * node.
 */

import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import {
  runAgentLoopWithEvalConfig,
  runAgentLoopWithTrajectory,
  type AgentRunResult,
  type EvalAgentLoopOptions,
} from './agent.ts';
import type { AgentStreamEventMap, AgentStreamEventName, AskOptions, EmitFn } from './service.ts';

const LangGraphState = Annotation.Root({
  question: Annotation<string>(),
  result: Annotation<AgentRunResult | undefined>(),
});

type LangGraphStateValue = typeof LangGraphState.State;

function createNonFinalNodeEmitter(emit: EmitFn): EmitFn {
  return async <EventName extends AgentStreamEventName>(
    event: EventName,
    data: AgentStreamEventMap[EventName],
  ) => {
    if (event === 'text' || event === 'done') return;
    await emit(event, data);
  };
}

function markLangGraphTrajectory(result: AgentRunResult): AgentRunResult {
  return {
    answer: result.answer,
    trajectory: {
      ...result.trajectory,
      model: `langgraph:${result.trajectory.model}`,
    },
  };
}

function requireResult(state: LangGraphStateValue): AgentRunResult {
  if (!state.result) {
    throw new Error('LangGraph final_answer node ran before agent_loop produced a result.');
  }
  return state.result;
}

export async function runLangGraphAgentLoopWithTrajectory(
  question: string,
  options?: AskOptions,
): Promise<AgentRunResult> {
  const { emit } = options ?? {};
  const currentRunnerOptions = { ...(options ?? {}) };
  delete currentRunnerOptions.runner;
  const currentOptions =
    Object.keys(currentRunnerOptions).length > 0 || emit
      ? {
          ...currentRunnerOptions,
          ...(emit ? { emit: createNonFinalNodeEmitter(emit) } : {}),
        }
      : undefined;

  return runLangGraphAgentLoop(question, emit, (currentQuestion) =>
    runAgentLoopWithTrajectory(currentQuestion, currentOptions),
  );
}

export async function runLangGraphAgentLoopWithEvalConfig(
  question: string,
  options: EvalAgentLoopOptions,
): Promise<AgentRunResult> {
  return runLangGraphAgentLoop(question, undefined, (currentQuestion) =>
    runAgentLoopWithEvalConfig(currentQuestion, options),
  );
}

async function runLangGraphAgentLoop(
  question: string,
  emit: EmitFn | undefined,
  currentRunner: (currentQuestion: string) => Promise<AgentRunResult>,
): Promise<AgentRunResult> {
  const graph = new StateGraph(LangGraphState)
    .addNode('agent_loop', async (state: LangGraphStateValue) => {
      const result = await currentRunner(state.question);
      return { result: markLangGraphTrajectory(result) };
    })
    .addNode('final_answer', async (state: LangGraphStateValue) => {
      const result = requireResult(state);
      if (emit) {
        await emit('text', { delta: result.answer });
        await emit('done', {});
      }
      return {};
    })
    .addEdge(START, 'agent_loop')
    .addEdge('agent_loop', 'final_answer')
    .addEdge('final_answer', END)
    .compile();

  const finalState = await graph.invoke({ question });
  return requireResult(finalState);
}
