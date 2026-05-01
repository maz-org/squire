import { describe, expect, it, vi } from 'vitest';

import type { EvalProviderConfig } from '../eval/cli.ts';
import {
  OpenAiEvalRunnerError,
  classifyOpenAiResponsesFailure,
  createOpenAiResponsesClient,
  runOpenAiResponsesEvalCase,
  type OpenAiResponsesClient,
} from '../eval/openai-runner.ts';
import type { EvalCase } from '../eval/schema.ts';
import { TRACE_CONTRACT_VERSION } from '../eval/trace-contract.ts';

const providerConfig: EvalProviderConfig = {
  provider: 'openai',
  model: 'gpt-5.5',
  reasoningEffort: 'low',
  maxOutputTokens: 1024,
  timeoutMs: 30_000,
  toolLoopLimit: 4,
};

const evalCase: EvalCase = {
  id: 'item-spyglass',
  category: 'card-data',
  source: 'unit-test',
  question: 'What does Spyglass do?',
  finalAnswer: {
    expected: 'Spyglass reveals cards.',
    grading: 'Mentions Spyglass effect.',
  },
};

function responsesClient(...responses: unknown[]): OpenAiResponsesClient {
  const create = vi.fn();
  for (const response of responses) {
    create.mockResolvedValueOnce(response);
  }
  return { responses: { create } };
}

describe('OpenAI Responses eval runner', () => {
  it('runs a manual stateless Responses tool loop without previous_response_id', async () => {
    const reasoningItem = {
      type: 'reasoning',
      id: 'rs_1',
      encrypted_content: 'opaque-reasoning',
    };
    const toolCallItem = {
      type: 'function_call',
      id: 'fc_1',
      call_id: 'call_1',
      name: 'search_cards',
      arguments: '{"query":"Spyglass","topK":null}',
    };
    const client = responsesClient(
      {
        id: 'resp_1',
        model: 'gpt-5.5-2026-04-23',
        status: 'completed',
        output: [reasoningItem, toolCallItem],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      },
      {
        id: 'resp_2',
        model: 'gpt-5.5-2026-04-23',
        status: 'completed',
        output: [
          {
            type: 'message',
            id: 'msg_1',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Spyglass reveals the top card.' }],
          },
        ],
        output_text: 'Spyglass reveals the top card.',
        usage: {
          input_tokens: 20,
          output_tokens: 8,
          total_tokens: 28,
          output_tokens_details: { reasoning_tokens: 2 },
        },
      },
    );
    const executeTool = vi.fn().mockResolvedValue({
      content: '[{"name":"Spyglass","effect":"Reveal the top card."}]',
      sourceBooks: ['Items'],
    });

    const result = await runOpenAiResponsesEvalCase({
      client,
      evalCase,
      providerConfig,
      runLabel: 'unit-openai',
      toolSurface: 'redesigned',
      executeTool,
      now: () => new Date('2026-05-01T00:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    expect(result.answer).toBe('Spyglass reveals the top card.');
    expect(result.failureClass).toBe('none');
    expect(executeTool).toHaveBeenCalledWith('search_cards', { query: 'Spyglass', topK: null });

    const create = vi.mocked(client.responses.create);
    expect(create).toHaveBeenCalledTimes(2);

    const firstRequest = create.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(firstRequest).toMatchObject({
      model: 'gpt-5.5',
      store: false,
      parallel_tool_calls: false,
      max_output_tokens: 1024,
      reasoning: { effort: 'low' },
    });
    expect(firstRequest).not.toHaveProperty('previous_response_id');
    expect(firstRequest.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'search_cards', strict: true })]),
    );

    const secondRequest = create.mock.calls[1]?.[0] as { input: unknown[] };
    expect(secondRequest).not.toHaveProperty('previous_response_id');
    expect(secondRequest.input).toEqual(
      expect.arrayContaining([
        reasoningItem,
        toolCallItem,
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: '[{"name":"Spyglass","effect":"Reveal the top card."}]',
        },
      ]),
    );

    expect(result.trajectory.toolCalls).toEqual([
      expect.objectContaining({
        iteration: 1,
        id: 'fc_1',
        name: 'search_cards',
        ok: true,
        sourceLabels: ['Items'],
      }),
    ]);
    expect(result.trace).toMatchObject({
      runLabel: 'unit-openai',
      provider: 'openai',
      model: 'gpt-5.5',
      resolvedModel: 'gpt-5.5-2026-04-23',
      caseId: 'item-spyglass',
      caseCategory: 'card-data',
      toolSurface: 'redesigned',
      statusReason: 'completed',
      stopReason: 'completed',
      finalAnswer: 'Spyglass reveals the top card.',
      tokenUsage: {
        input: 30,
        output: 13,
        reasoning: 2,
        total: 43,
      },
      toolCalls: [
        expect.objectContaining({
          toolName: 'search_cards',
          providerToolCallId: 'call_1',
          arguments: { query: 'Spyglass', topK: null },
          result: '[{"name":"Spyglass","effect":"Reveal the top card."}]',
        }),
      ],
      errors: [],
    });
    expect(result.trace.judgeScores).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'failure_class', value: 'none' })]),
    );
    expect(result.trace.providerNativeTranscript).toMatchObject({
      contractVersion: TRACE_CONTRACT_VERSION,
      turns: [
        expect.objectContaining({
          response: expect.objectContaining({ id: 'resp_1' }),
          outputItems: [reasoningItem, toolCallItem],
          functionCallOutputs: [
            {
              type: 'function_call_output',
              call_id: 'call_1',
              output: '[{"name":"Spyglass","effect":"Reveal the top card."}]',
            },
          ],
        }),
        expect.objectContaining({
          response: expect.objectContaining({ id: 'resp_2' }),
        }),
      ],
    });
  });

  it('writes SQR-127 trace artifacts when a trace client is provided', async () => {
    const client = responsesClient({
      id: 'resp_final',
      model: 'gpt-5.5-2026-04-23',
      status: 'completed',
      output_text: 'Done.',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    const batch = vi.fn();

    await runOpenAiResponsesEvalCase({
      client,
      evalCase,
      providerConfig,
      runLabel: 'trace-run',
      toolSurface: 'redesigned',
      traceClient: { api: { ingestion: { batch } } },
    });

    expect(batch).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { contractVersion: TRACE_CONTRACT_VERSION },
        batch: expect.arrayContaining([
          expect.objectContaining({ type: 'trace-create' }),
          expect.objectContaining({ type: 'generation-create' }),
        ]),
      }),
    );
  });

  it('classifies schema failures from malformed function-call arguments', async () => {
    const client = responsesClient({
      id: 'resp_bad_args',
      model: 'gpt-5.5-2026-04-23',
      status: 'completed',
      output: [
        {
          type: 'function_call',
          id: 'fc_bad',
          call_id: 'call_bad',
          name: 'search_cards',
          arguments: '{"query":',
        },
      ],
    });

    const result = await runOpenAiResponsesEvalCase({
      client,
      evalCase,
      providerConfig,
      runLabel: 'schema-failure',
      toolSurface: 'redesigned',
    });

    expect(result.ok).toBe(false);
    expect(result.failureClass).toBe('schema');
    expect(result.trace.errors).toEqual([
      expect.objectContaining({
        type: 'schema',
        message: expect.stringContaining('Invalid JSON arguments'),
      }),
    ]);
  });

  it('classifies tool execution failures', async () => {
    const client = responsesClient({
      id: 'resp_tool',
      model: 'gpt-5.5-2026-04-23',
      status: 'completed',
      output: [
        {
          type: 'function_call',
          id: 'fc_tool',
          call_id: 'call_tool',
          name: 'search_cards',
          arguments: '{"query":"Spyglass"}',
        },
      ],
    });

    const result = await runOpenAiResponsesEvalCase({
      client,
      evalCase,
      providerConfig,
      runLabel: 'tool-failure',
      toolSurface: 'redesigned',
      executeTool: vi.fn().mockRejectedValue(new Error('tool exploded')),
    });

    expect(result.ok).toBe(false);
    expect(result.failureClass).toBe('tool_execution');
    expect(result.trace.toolCalls).toEqual([
      expect.objectContaining({
        ok: false,
        errors: [expect.objectContaining({ type: 'tool_execution', message: 'tool exploded' })],
      }),
    ]);
  });

  it('classifies answer-quality failures when the model returns no text', async () => {
    const client = responsesClient({
      id: 'resp_empty',
      model: 'gpt-5.5-2026-04-23',
      status: 'completed',
      output: [{ type: 'message', content: [] }],
    });

    const result = await runOpenAiResponsesEvalCase({
      client,
      evalCase,
      providerConfig,
      runLabel: 'empty-answer',
      toolSurface: 'redesigned',
    });

    expect(result.ok).toBe(false);
    expect(result.failureClass).toBe('answer_quality');
    expect(result.trace.errors).toEqual([
      expect.objectContaining({
        type: 'answer_quality',
        message: expect.stringContaining('empty final answer'),
      }),
    ]);
  });

  it('classifies model access, API status, and timeout failures', () => {
    expect(classifyOpenAiResponsesFailure({ status: 401, message: 'missing model' })).toBe(
      'model_access',
    );
    expect(classifyOpenAiResponsesFailure({ status: 429, message: 'rate limited' })).toBe(
      'api_status',
    );
    expect(classifyOpenAiResponsesFailure(new DOMException('aborted', 'AbortError'))).toBe(
      'timeout',
    );
    expect(classifyOpenAiResponsesFailure(new OpenAiEvalRunnerError('schema', 'bad schema'))).toBe(
      'schema',
    );
  });

  it('classifies non-JSON OpenAI API responses as API status failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('bad gateway', { status: 502 }));
    const client = createOpenAiResponsesClient(
      { OPENAI_API_KEY: 'test-key' } as NodeJS.ProcessEnv,
      fetchImpl as typeof fetch,
    );

    await expect(
      client.responses.create({
        model: 'gpt-5.5',
        instructions: 'Answer the question.',
        input: [],
        tools: [],
        store: false,
        parallel_tool_calls: false,
        include: [],
      }),
    ).rejects.toMatchObject({
      failureClass: 'api_status',
      status: 502,
      message: 'OpenAI Responses API returned non-JSON body with status 502.',
    });
  });
});
