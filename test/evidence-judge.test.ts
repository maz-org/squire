/**
 * Unit tests for the evidence-sufficiency judge (Phase 3, SQR-408).
 */
import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';

import { judgeEvidenceSufficiency } from '../src/evidence-judge.ts';
import type { ToolTrajectoryStep } from '../src/agent.ts';

function clientReturning(text: string | Error): Anthropic {
  return {
    messages: {
      create: vi.fn(async () => {
        if (text instanceof Error) throw text;
        return {
          content: [{ type: 'text', text }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 200, output_tokens: 30 },
        };
      }),
    },
  } as unknown as Anthropic;
}

const step = (name: string, summary: string): ToolTrajectoryStep =>
  ({
    iteration: 1,
    id: 't1',
    name,
    input: {},
    ok: true,
    outputSummary: summary,
    sourceLabels: [],
    canonicalRefs: [],
    startedAt: '',
    endedAt: '',
    durationMs: 1,
  }) as ToolTrajectoryStep;

describe('judgeEvidenceSufficiency', () => {
  it('parses a sufficient verdict with the raw message attached', async () => {
    const verdict = await judgeEvidenceSufficiency(
      clientReturning('{"sufficient": true, "missing": ""}'),
      'What does Muddle do?',
      [step('open_entity', 'Muddle: disadvantage on attacks')],
    );
    expect(verdict).toMatchObject({ sufficient: true, missing: '', failed: false });
    expect(verdict.message).not.toBeNull();
  });

  it('parses an insufficient verdict with the missing gap', async () => {
    const verdict = await judgeEvidenceSufficiency(
      clientReturning('{"sufficient": false, "missing": "open section 42.4 for its text"}'),
      'What does the conclusion of scenario 10 say?',
      [step('neighbors', 'conclusion -> section:frosthaven/42.4')],
    );
    expect(verdict).toMatchObject({
      sufficient: false,
      missing: 'open section 42.4 for its text',
      failed: false,
    });
  });

  it('flags unparseable output as failed so the caller falls back', async () => {
    const verdict = await judgeEvidenceSufficiency(clientReturning('not json at all'), 'q', [
      step('search_knowledge', 'hits'),
    ]);
    expect(verdict.failed).toBe(true);
  });

  it('flags API errors as failed instead of throwing', async () => {
    const verdict = await judgeEvidenceSufficiency(clientReturning(new Error('overloaded')), 'q', [
      step('search_knowledge', 'hits'),
    ]);
    expect(verdict).toMatchObject({ sufficient: false, failed: true, message: null });
  });

  it('feeds the latest round result content to the judge (SQR-409)', async () => {
    const client = clientReturning('{"sufficient": true, "missing": ""}');
    await judgeEvidenceSufficiency(
      client,
      'What does Ruinous Rift do?',
      [step('open_entity', 'json object (ok, entity)')],
      [
        {
          name: 'open_entity',
          ok: true,
          content: '{"entity":{"data":{"notes":"special rift rules text"}}}',
        },
      ],
    );
    const create = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      messages: Array<{ content: string }>;
    };
    expect(create.messages[0].content).toContain('special rift rules text');
    expect(create.messages[0].content).toContain('Latest tool results');
  });

  it('caps the evidence payload to the last steps and truncates summaries', async () => {
    const client = clientReturning('{"sufficient": true, "missing": ""}');
    const steps = Array.from({ length: 30 }, (_, i) => step(`tool_${i}`, 'x'.repeat(2000)));
    await judgeEvidenceSufficiency(client, 'q', steps);
    const create = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      messages: Array<{ content: string }>;
    };
    const payload = create.messages[0].content;
    expect(payload).not.toContain('tool_0');
    expect(payload).toContain('tool_29');
    expect(payload.length).toBeLessThan(12 * 500 + 2000);
  });
});
