import { describe, expect, it, vi } from 'vitest';

import {
  buildLangSmithRuns,
  createLangSmithTraceWriter,
  langSmithRootRunIdForTraceId,
  langSmithRunUrl,
  langSmithTraceConfigFromEnv,
  type LangSmithTraceClient,
} from '../eval/langsmith-trace.ts';
import { DATASET_NAME } from '../eval/dataset.ts';
import { OPENAI_TOOL_SCHEMA_VERSION, getOpenAiToolSchemaHash } from '../eval/openai-schema.ts';
import type { EvalTraceInput } from '../eval/trace.ts';

const baseTrace: EvalTraceInput = {
  traceId: 'eval:sqr-162:openai:gpt-5.5:case-1',
  generationId: 'generation-case-1',
  environment: 'test',
  runLabel: 'sqr-162-test-run',
  datasetName: DATASET_NAME,
  caseId: 'case-1',
  game: 'frosthaven',
  suite: 'table-qa',
  caseCategory: 'buildings',
  agentRuntime: 'langgraph',
  provider: 'openai',
  model: 'gpt-5.5',
  resolvedModel: 'gpt-5.5-2026-04-23',
  promptVersion: 'redesigned-agent-v1',
  promptHash: 'sha256:prompt',
  toolSurface: 'redesigned',
  toolSchemaVersion: OPENAI_TOOL_SCHEMA_VERSION,
  toolSchemaHash: getOpenAiToolSchemaHash(),
  modelSettings: {
    maxOutputTokens: 1024,
    reasoningEffort: 'medium',
    timeoutMs: 30000,
    toolLoopLimit: 4,
  },
  inputQuestion: 'What does the level 1 Alchemist unlock?',
  finalAnswer: 'It can brew 2-herb potions.',
  statusReason: 'completed',
  stopReason: 'end_turn',
  startedAt: '2026-05-01T00:00:00.000Z',
  endedAt: '2026-05-01T00:00:02.500Z',
  durationMs: 2500,
  providerRequest: {
    input: 'question',
    authorization: 'Bearer sk-live-secret',
  },
  providerResponse: {
    id: 'resp_123',
    output: [{ type: 'message', content: 'It can brew 2-herb potions.' }],
  },
  providerNativeTranscript: {
    output: [
      { type: 'message', id: 'msg_1' },
      { type: 'function_call', id: 'call_1', arguments: { apiKey: 'sk-tool-secret' } },
    ],
  },
  tokenUsage: {
    input: 120,
    output: 45,
    reasoning: 10,
    cached: 5,
    total: 175,
  },
  costEstimate: {
    promptUsd: 0.0012,
    completionUsd: 0.0009,
    reasoningUsd: 0.0002,
    totalUsd: 0.0023,
  },
  errors: [],
  retries: [],
  toolCalls: [
    {
      id: 'tool-span-1',
      toolName: 'searchCards',
      toolCallId: 'tool-call-1',
      providerToolCallId: 'call_1',
      callIndex: 0,
      arguments: {
        query: 'Alchemist',
        sessionId: 'session-secret',
      },
      result: {
        items: [{ name: 'Alchemist', userEmail: 'player@example.test' }],
      },
      ok: true,
      startedAt: '2026-05-01T00:00:01.000Z',
      endedAt: '2026-05-01T00:00:01.125Z',
      durationMs: 125,
      sourceLabels: ['Building 35'],
      canonicalRefs: ['building:35'],
      errors: [],
      retries: [],
    },
  ],
  judgeScores: [
    {
      name: 'correctness',
      value: 1,
      comment: 'Expected detail present.',
      metadata: { playerId: 'player-1' },
    },
    { name: 'pass', value: 'pass' },
  ],
};

describe('LangSmith eval trace writer', () => {
  it('requires API key and project when enabled', () => {
    expect(() => langSmithTraceConfigFromEnv({ LANGSMITH_PROJECT: 'squire-evals' })).toThrow(
      /LANGSMITH_API_KEY/,
    );
    expect(() => langSmithTraceConfigFromEnv({ LANGSMITH_API_KEY: 'key' })).toThrow(
      /LANGSMITH_PROJECT/,
    );
    expect(
      langSmithTraceConfigFromEnv({
        LANGSMITH_API_KEY: 'key',
        LANGSMITH_PROJECT: 'squire-evals',
        LANGSMITH_ENDPOINT: 'https://api.smith.langchain.com',
        LANGSMITH_WORKSPACE_ID: 'workspace-id',
      }),
    ).toEqual({
      apiKey: 'key',
      projectName: 'squire-evals',
      apiUrl: 'https://api.smith.langchain.com',
      workspaceId: 'workspace-id',
    });
  });

  it('maps redacted eval trace facts into LangSmith root, model, tool, and feedback writes', () => {
    const payload = buildLangSmithRuns(baseTrace, { projectName: 'squire-evals' });

    expect(payload.runs).toHaveLength(3);
    expect(payload.runs[0]).toMatchObject({
      name: 'eval.case',
      run_type: 'chain',
      project_name: 'squire-evals',
      inputs: { question: 'What does the level 1 Alchemist unlock?' },
      outputs: {
        finalAnswer: 'It can brew 2-herb potions.',
        statusReason: 'completed',
      },
      extra: {
        metadata: expect.objectContaining({
          environment: 'test',
          squireTraceId: 'eval:sqr-162:openai:gpt-5.5:case-1',
          provider: 'openai',
          model: 'gpt-5.5',
          runLabel: 'sqr-162-test-run',
          game: 'frosthaven',
          suite: 'table-qa',
          agentRuntime: 'langgraph',
          failureClass: 'none',
          pass: true,
          score: 1,
        }),
      },
      tags: expect.arrayContaining([
        'case:case-1',
        'game:frosthaven',
        'suite:table-qa',
        'runtime:langgraph',
        'category:buildings',
        'env:test',
        'failure:none',
        'pass:true',
      ]),
    });
    expect(payload.runs[1]).toMatchObject({
      name: 'eval.model_call',
      run_type: 'llm',
      parent_run_id: payload.rootRunId,
      inputs: { request: { input: 'question', authorization: '[REDACTED]' } },
      extra: {
        metadata: expect.objectContaining({
          providerNativeTranscript: {
            output: [
              { type: 'message', id: 'msg_1' },
              { type: 'function_call', id: 'call_1', arguments: { apiKey: '[REDACTED]' } },
            ],
          },
        }),
      },
    });
    expect(payload.runs[2]).toMatchObject({
      name: 'eval.tool_call.searchCards',
      run_type: 'tool',
      parent_run_id: payload.modelRunId,
      inputs: { query: 'Alchemist', sessionId: '[REDACTED]' },
      outputs: { items: [{ name: 'Alchemist', userEmail: '[REDACTED]' }] },
    });
    expect(payload.feedback).toEqual([
      expect.objectContaining({
        runId: payload.rootRunId,
        key: 'correctness',
        options: expect.objectContaining({
          score: 1,
          comment: 'Expected detail present.',
          sourceInfo: { playerId: '[REDACTED]' },
        }),
      }),
      expect.objectContaining({
        runId: payload.rootRunId,
        key: 'pass',
        options: expect.objectContaining({ value: 'pass' }),
      }),
    ]);
    expect(JSON.stringify(payload)).not.toContain('sk-live-secret');
    expect(JSON.stringify(payload)).not.toContain('sk-tool-secret');
    expect(JSON.stringify(payload)).not.toContain('session-secret');
    expect(JSON.stringify(payload)).not.toContain('player@example.test');
  });

  it('builds deterministic run URLs for matrix reports', () => {
    expect(
      langSmithRunUrl(
        'https://smith.langchain.com/o/org-id/projects/p/project-id/',
        baseTrace.traceId,
      ),
    ).toBe(
      `https://smith.langchain.com/o/org-id/projects/p/project-id/r/${langSmithRootRunIdForTraceId(
        baseTrace.traceId,
      )}?poll=true`,
    );
  });

  it('maps trajectory-only pass policy into filterable LangSmith facts', () => {
    const payload = buildLangSmithRuns(
      {
        ...baseTrace,
        judgeScores: [
          { name: 'failure_class', value: 'none' },
          { name: 'trajectory', value: 0 },
          { name: 'trajectory_pass', value: 'fail', comment: 'missing required ref' },
        ],
      },
      { projectName: 'squire-evals' },
    );

    expect(payload.runs[0]).toMatchObject({
      extra: {
        metadata: expect.objectContaining({
          failureClass: 'none',
          pass: false,
          score: 0,
          trajectoryScore: 0,
        }),
      },
      tags: expect.arrayContaining(['failure:none', 'pass:false']),
    });
  });

  it('wraps primitive tool arguments and results in LangSmith object payloads', () => {
    const payload = buildLangSmithRuns(
      {
        ...baseTrace,
        toolCalls: [
          {
            toolName: 'primitiveTool',
            callIndex: 0,
            arguments: 'raw input',
            result: null,
            ok: true,
          },
        ],
      },
      { projectName: 'squire-evals' },
    );

    expect(payload.runs[2]).toMatchObject({
      inputs: { value: 'raw input' },
      outputs: { value: null },
    });
  });

  it('writes LangSmith runs, feedback, and flushes the SDK client', async () => {
    const client: LangSmithTraceClient = {
      createRun: vi.fn(async () => undefined),
      createFeedback: vi.fn(async () => undefined),
      flush: vi.fn(async () => undefined),
      awaitPendingTraceBatches: vi.fn(async () => undefined),
    };
    const writer = createLangSmithTraceWriter({
      client,
      config: { apiKey: 'key', projectName: 'squire-evals' },
    });

    await writer.writeTrace(baseTrace);

    expect(client.createRun).toHaveBeenCalledTimes(3);
    expect(client.createFeedback).toHaveBeenCalledTimes(2);
    expect(client.flush).toHaveBeenCalledOnce();
    expect(client.awaitPendingTraceBatches).toHaveBeenCalledOnce();
  });

  it('fails when the LangSmith SDK rejects an explicit trace write', async () => {
    const client: LangSmithTraceClient = {
      createRun: vi.fn(async () => {
        throw new Error('LangSmith unavailable');
      }),
      createFeedback: vi.fn(async () => undefined),
    };
    const writer = createLangSmithTraceWriter({
      client,
      config: { apiKey: 'key', projectName: 'squire-evals' },
    });

    await expect(writer.writeTrace(baseTrace)).rejects.toThrow('LangSmith unavailable');
  });
});
