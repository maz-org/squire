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
      ]),
    ).toEqual({
      provider: 'aws-textract',
      sourcePath: 'data/pdfs/gh2-rule-book.pdf',
      pages: [30, 31, 40],
      outputDir: 'eval/results/pdf-extraction',
      runLabel: 'textract-smoke',
      retryCount: 2,
    });
  });

  it('rejects full-rulebook and cost guardrail flags reserved for SQR-250', () => {
    expect(() =>
      parsePdfExtractionArgs([
        '--provider=aws-textract',
        '--source=data/pdfs/gh2-rule-book.pdf',
        '--allow-full-rulebook',
      ]),
    ).toThrow(/Full-rulebook provider runs are implemented by SQR-250/);

    expect(() =>
      parsePdfExtractionArgs([
        '--provider=aws-textract',
        '--source=data/pdfs/gh2-rule-book.pdf',
        '--max-estimated-cost-usd=1',
      ]),
    ).toThrow(/Cost guardrails are implemented by SQR-250/);
  });

  it('rejects empty and unsupported providers', () => {
    expect(() => parsePdfExtractionArgs(['--provider='])).toThrow(
      /Invalid --provider: value cannot be empty/,
    );
    expect(() => parsePdfExtractionArgs(['--provider=pdf-parse'])).toThrow(
      /Invalid --provider: pdf-parse/,
    );
  });

  it('requires selected pages until the guarded full-rulebook runner exists', () => {
    expect(() =>
      parsePdfExtractionArgs(['--provider=llamaparse', '--source=data/pdfs/gh2-rule-book.pdf']),
    ).toThrow(/Selected pages are required/);
  });
});
