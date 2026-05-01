import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  TRACE_CONTRACT_VERSION,
  TRACE_FIELDS,
  TRACE_REDACTION_DENYLIST,
  type TraceField,
} from '../eval/trace-contract.ts';

const DOC_PATH = fileURLToPath(
  new URL('../docs/plans/sqr-125-trace-artifact-contract.md', import.meta.url),
);

function field(name: string): TraceField {
  const match = TRACE_FIELDS.find((candidate) => candidate.name === name);
  if (!match) throw new Error(`Missing trace field contract entry: ${name}`);
  return match;
}

describe('SQR-125 trace artifact contract', () => {
  it('keeps provider, model, run, and case filters in Langfuse trace metadata', () => {
    for (const name of [
      'contractVersion',
      'provider',
      'model',
      'resolvedModel',
      'runLabel',
      'datasetName',
      'caseId',
      'caseCategory',
      'promptHash',
      'promptVersion',
      'toolSurface',
      'toolSchemaVersion',
      'toolSchemaHash',
    ]) {
      expect(field(name)).toMatchObject({
        required: true,
        langfuseTarget: 'trace.metadata',
      });
    }
  });

  it('maps every required debugging field to an explicit Langfuse or export target', () => {
    const allowedTargets = new Set([
      'trace.metadata',
      'trace.input',
      'trace.output',
      'generation',
      'generation.input',
      'generation.output',
      'generation.metadata',
      'generation.modelParameters',
      'generation.usageDetails',
      'generation.costDetails',
      'span',
      'span.input',
      'span.output',
      'span.metadata',
      'score',
      'optional_export',
    ]);

    const requiredNames = [
      'modelSettings',
      'inputQuestion',
      'toolCalls',
      'toolArguments',
      'toolResults',
      'providerNativeTranscript',
      'errors',
      'retries',
      'timings',
      'tokenUsage',
      'costEstimate',
      'stopReason',
      'statusReason',
      'finalAnswer',
      'judgeScores',
    ];

    for (const name of requiredNames) {
      const contract = field(name);
      expect(contract.required).toBe(true);
      expect(allowedTargets.has(contract.langfuseTarget)).toBe(true);
      expect(contract.debugCategory).not.toBe('filter');
    }
  });

  it('keeps provider-native transcript data out of app conversation history', () => {
    expect(field('providerNativeTranscript')).toMatchObject({
      required: true,
      includeInAppConversationHistory: false,
    });
  });

  it('redacts secrets and future user or campaign state before trace writes', () => {
    expect(TRACE_REDACTION_DENYLIST).toEqual([
      'apiKey',
      'authorization',
      'bearer',
      'cookie',
      'setCookie',
      'session',
      'sessionId',
      'csrf',
      'oauth',
      'accessToken',
      'refreshToken',
      'userId',
      'userEmail',
      'campaignId',
      'characterId',
      'playerId',
    ]);
  });

  it('has a checked-in markdown contract that names the current schema version', () => {
    const doc = readFileSync(DOC_PATH, 'utf8');
    expect(doc).toContain(`# SQR-125 Side-by-Side Trace Artifact Contract`);
    expect(doc).toContain(TRACE_CONTRACT_VERSION);
    expect(doc).toContain('Langfuse Placement Legend');
    expect(doc).toContain('Provider-Native Transcript Rules');
    expect(doc).toContain('Redaction Rules');
  });
});
