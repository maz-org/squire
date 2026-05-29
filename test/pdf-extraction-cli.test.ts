import { describe, expect, it } from 'vitest';

import { parsePdfExtractionArgs } from '../eval/pdf-extraction/cli.ts';

describe('parsePdfExtractionArgs', () => {
  it('parses selected-page provider runs with explicit output paths', () => {
    expect(
      parsePdfExtractionArgs([
        '--provider=aws-textract',
        '--source=data/pdfs/gh2-rule-book.pdf',
        '--pages=30,31,40',
        '--output-dir=eval/results/pdf-extraction',
        '--run-label=textract-smoke',
        '--retry-count=2',
        '--max-estimated-cost-usd=0.50',
        '--provider-concurrency=1',
        '--timeout-ms=60000',
      ]),
    ).toEqual({
      provider: 'aws-textract',
      sourcePath: 'data/pdfs/gh2-rule-book.pdf',
      pages: [30, 31, 40],
      outputDir: 'eval/results/pdf-extraction',
      runLabel: 'textract-smoke',
      retryCount: 2,
      allowFullRulebook: false,
      allowEstimatedCostOverride: false,
      maxEstimatedCostUsd: 0.5,
      providerConcurrency: 1,
      refreshProviderOutput: false,
      timeoutMs: 60000,
    });
  });

  it('parses explicit full-rulebook and cost override flags', () => {
    expect(
      parsePdfExtractionArgs([
        '--provider=aws-textract',
        '--source=data/pdfs/gh2-rule-book.pdf',
        '--allow-full-rulebook',
        '--allow-estimated-cost',
        '--max-estimated-cost-usd=1',
      ]),
    ).toMatchObject({
      pages: [],
      allowFullRulebook: true,
      allowEstimatedCostOverride: true,
      maxEstimatedCostUsd: 1,
    });
  });

  it('rejects empty and unsupported providers', () => {
    expect(() => parsePdfExtractionArgs(['--provider='])).toThrow(
      /Invalid --provider: value cannot be empty/,
    );
    expect(() => parsePdfExtractionArgs(['--provider=pdf-parse'])).toThrow(
      /Invalid --provider: pdf-parse/,
    );
  });

  it('rejects unknown flags so typos cannot silently fall back to defaults', () => {
    expect(() =>
      parsePdfExtractionArgs([
        '--provider=aws-textract',
        '--source=data/pdfs/gh2-rule-book.pdf',
        '--pages=30',
        '--retrycount=2',
      ]),
    ).toThrow(/Unknown argument: --retrycount=2/);
  });

  it('requires selected pages until the guarded full-rulebook runner exists', () => {
    expect(() =>
      parsePdfExtractionArgs(['--provider=llamaparse', '--source=data/pdfs/gh2-rule-book.pdf']),
    ).toThrow(/Selected pages are required unless --allow-full-rulebook is set/);
  });

  it('rejects invalid guardrail values', () => {
    expect(() =>
      parsePdfExtractionArgs([
        '--provider=llamaparse',
        '--source=data/pdfs/gh2-rule-book.pdf',
        '--pages=30',
        '--max-estimated-cost-usd=-1',
      ]),
    ).toThrow(/Invalid --max-estimated-cost-usd/);

    expect(() =>
      parsePdfExtractionArgs([
        '--provider=llamaparse',
        '--source=data/pdfs/gh2-rule-book.pdf',
        '--pages=30',
        '--provider-concurrency=0',
      ]),
    ).toThrow(/Invalid --provider-concurrency/);
  });
});
