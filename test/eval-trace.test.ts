import { describe, expect, it } from 'vitest';

import { DATASET_NAME } from '../eval/dataset.ts';
import { OPENAI_TOOL_SCHEMA_VERSION, getOpenAiToolSchemaHash } from '../eval/openai-schema.ts';
import {
  buildEvalTraceIngestionBatch,
  redactTracePayload,
  writeEvalTrace,
  type EvalTraceInput,
  type LangfuseTraceIngestionClient,
} from '../eval/trace.ts';
import { TRACE_CONTRACT_VERSION } from '../eval/trace-contract.ts';

const baseTrace: EvalTraceInput = {
  traceId: 'trace-case-1',
  generationId: 'generation-case-1',
  runLabel: 'sqr-127-test-run',
  datasetName: DATASET_NAME,
  caseId: 'case-1',
  caseCategory: 'buildings',
  agentRuntime: 'claude-sdk',
  provider: 'openai',
  model: 'gpt-5.5',
  resolvedModel: 'gpt-5.5-2026-04-23',
  promptVersion: 'redesigned-agent-v1',
  promptHash: 'sha256:prompt',
  toolSurface: 'redesigned',
  toolSchemaVersion: OPENAI_TOOL_SCHEMA_VERSION,
  toolSchemaHash: getOpenAiToolSchemaHash(),
  modelSettings: {
    temperature: 0,
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
  errors: [
    {
      type: 'provider',
      message: 'first response timed out',
      retryable: true,
    },
  ],
  retries: [
    {
      operation: 'model',
      attempt: 1,
      reason: 'timeout',
      delayMs: 250,
      final: false,
    },
  ],
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
    { name: 'tool_call_count', value: 1 },
  ],
};

describe('SQR-127 eval trace writer', () => {
  it('builds Langfuse trace, generation, tool-span, and score events with required metadata', () => {
    const batch = buildEvalTraceIngestionBatch(baseTrace);

    expect(batch.metadata).toEqual({ contractVersion: TRACE_CONTRACT_VERSION });
    expect(batch.batch.map((event) => event.type)).toEqual([
      'trace-create',
      'generation-create',
      'span-create',
      'score-create',
      'score-create',
      'score-create',
    ]);

    const [trace, generation, toolSpan, ...scores] = batch.batch;

    expect(trace.body).toMatchObject({
      id: 'trace-case-1',
      name: 'eval.case',
      input: { question: 'What does the level 1 Alchemist unlock?' },
      output: { finalAnswer: 'It can brew 2-herb potions.', statusReason: 'completed' },
      metadata: {
        contractVersion: TRACE_CONTRACT_VERSION,
        agentRuntime: 'claude-sdk',
        provider: 'openai',
        model: 'gpt-5.5',
        resolvedModel: 'gpt-5.5-2026-04-23',
        runLabel: 'sqr-127-test-run',
        datasetName: DATASET_NAME,
        caseId: 'case-1',
        caseCategory: 'buildings',
        promptVersion: 'redesigned-agent-v1',
        promptHash: 'sha256:prompt',
        toolSurface: 'redesigned',
        toolSchemaVersion: OPENAI_TOOL_SCHEMA_VERSION,
        toolSchemaHash: getOpenAiToolSchemaHash(),
        statusReason: 'completed',
      },
    });

    expect(generation.body).toMatchObject({
      id: 'generation-case-1',
      traceId: 'trace-case-1',
      name: 'eval.model_call',
      model: 'gpt-5.5',
      input: {
        request: {
          input: 'question',
          authorization: '[REDACTED]',
        },
      },
      output: {
        finalAnswer: 'It can brew 2-herb potions.',
        response: {
          id: 'resp_123',
        },
      },
      modelParameters: baseTrace.modelSettings,
      usageDetails: {
        input: 120,
        output: 45,
        reasoning: 10,
        cached: 5,
        total: 175,
      },
      costDetails: {
        promptUsd: 0.0012,
        completionUsd: 0.0009,
        reasoningUsd: 0.0002,
        totalUsd: 0.0023,
      },
      metadata: {
        provider: 'openai',
        resolvedModel: 'gpt-5.5-2026-04-23',
        stopReason: 'end_turn',
        statusReason: 'completed',
        providerNativeTranscript: {
          output: [
            { type: 'message', id: 'msg_1' },
            { type: 'function_call', id: 'call_1', arguments: { apiKey: '[REDACTED]' } },
          ],
        },
        errors: baseTrace.errors,
        retries: baseTrace.retries,
        timings: {
          startedAt: '2026-05-01T00:00:00.000Z',
          endedAt: '2026-05-01T00:00:02.500Z',
          durationMs: 2500,
        },
      },
    });

    expect(toolSpan.body).toMatchObject({
      id: 'tool-span-1',
      traceId: 'trace-case-1',
      parentObservationId: 'generation-case-1',
      name: 'eval.tool_call.searchCards',
      input: {
        query: 'Alchemist',
        sessionId: '[REDACTED]',
      },
      output: {
        items: [{ name: 'Alchemist', userEmail: '[REDACTED]' }],
      },
      metadata: {
        toolName: 'searchCards',
        toolCallId: 'tool-call-1',
        providerToolCallId: 'call_1',
        callIndex: 0,
        ok: true,
        durationMs: 125,
        sourceLabels: ['Building 35'],
        canonicalRefs: ['building:35'],
        errors: [],
        retries: [],
      },
    });

    expect(scores).toEqual([
      expect.objectContaining({
        id: 'trace-case-1:score:correctness:score-create',
        body: expect.objectContaining({
          id: 'trace-case-1:score:correctness',
          traceId: 'trace-case-1',
          name: 'correctness',
          value: 1,
          dataType: 'NUMERIC',
          comment: 'Expected detail present.',
          metadata: { playerId: '[REDACTED]' },
        }),
      }),
      expect.objectContaining({
        id: 'trace-case-1:score:pass:score-create',
        body: expect.objectContaining({
          id: 'trace-case-1:score:pass',
          traceId: 'trace-case-1',
          name: 'pass',
          value: 'pass',
          dataType: 'CATEGORICAL',
        }),
      }),
      expect.objectContaining({
        id: 'trace-case-1:score:tool_call_count:score-create',
        body: expect.objectContaining({
          id: 'trace-case-1:score:tool_call_count',
          traceId: 'trace-case-1',
          name: 'tool_call_count',
          value: 1,
          dataType: 'NUMERIC',
        }),
      }),
    ]);
  });

  it('redacts API keys, bearer tokens, cookies, sessions, and future user/campaign state', () => {
    const redacted = redactTracePayload({
      apiKey: 'sk-test-secret',
      authorization: 'Bearer live-token',
      nested: {
        Cookie: 'squire_session=abc123',
        set_cookie: 'session=abc123',
        session: 'session-value',
        csrf: 'csrf-token',
        oauth: 'oauth-token',
        accessToken: 'access-token',
        refresh_token: 'refresh-token',
        userId: 'user-1',
        userEmail: 'player@example.test',
        campaignId: 'campaign-1',
        character_id: 'character-1',
        playerId: 'player-1',
      },
      values: [
        'Bearer another-token',
        'sk-live-abcdefghijklmnopqrstuvwxyz1234567890',
        'ordinary rules text',
      ],
    });

    expect(redacted).toEqual({
      apiKey: '[REDACTED]',
      authorization: '[REDACTED]',
      nested: {
        Cookie: '[REDACTED]',
        set_cookie: '[REDACTED]',
        session: '[REDACTED]',
        csrf: '[REDACTED]',
        oauth: '[REDACTED]',
        accessToken: '[REDACTED]',
        refresh_token: '[REDACTED]',
        userId: '[REDACTED]',
        userEmail: '[REDACTED]',
        campaignId: '[REDACTED]',
        character_id: '[REDACTED]',
        playerId: '[REDACTED]',
      },
      values: ['[REDACTED]', '[REDACTED]', 'ordinary rules text'],
    });
  });

  it('sends only redacted Langfuse-bound events through the ingestion API', async () => {
    const batches: unknown[] = [];
    const client: LangfuseTraceIngestionClient = {
      api: {
        ingestion: {
          batch: async (payload) => {
            batches.push(payload);
            return { successes: [], errors: [] };
          },
        },
      },
    };

    await writeEvalTrace(client, baseTrace);

    expect(batches).toHaveLength(1);
    expect(JSON.stringify(batches[0])).not.toContain('sk-live-secret');
    expect(JSON.stringify(batches[0])).not.toContain('sk-tool-secret');
    expect(JSON.stringify(batches[0])).not.toContain('session-secret');
    expect(JSON.stringify(batches[0])).not.toContain('player@example.test');
  });

  it('fails when Langfuse accepts a batch with per-event ingestion errors', async () => {
    const client: LangfuseTraceIngestionClient = {
      api: {
        ingestion: {
          batch: async () => ({
            successes: [],
            errors: [{ id: 'score-event', status: 400, message: 'invalid score' }],
          }),
        },
      },
    };

    await expect(writeEvalTrace(client, baseTrace)).rejects.toThrow(
      'Langfuse trace ingestion failed',
    );
  });
});
