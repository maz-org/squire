import { describe, expect, it } from 'vitest';

import { parseEvalArgs } from '../eval/cli.ts';

describe('parseEvalArgs', () => {
  it('defaults to the redesigned tool surface', () => {
    expect(parseEvalArgs([]).toolSurface).toBe('redesigned');
  });

  it('accepts the legacy tool surface', () => {
    expect(parseEvalArgs(['--tool-surface=legacy']).toolSurface).toBe('legacy');
  });

  it('rejects unknown tool surfaces', () => {
    expect(() => parseEvalArgs(['--tool-surface=old'])).toThrow(/Invalid --tool-surface/);
  });

  it('rejects an empty tool surface', () => {
    expect(() => parseEvalArgs(['--tool-surface='])).toThrow(
      /Invalid --tool-surface: value cannot be empty/,
    );
  });

  it('rejects an empty run name', () => {
    expect(() => parseEvalArgs(['--name='])).toThrow(/Invalid --name: value cannot be empty/);
  });

  it('parses the local report output path', () => {
    expect(parseEvalArgs(['--local-report=/tmp/eval.json']).localReportPath).toBe('/tmp/eval.json');
  });

  it('rejects an empty local report output path', () => {
    expect(() => parseEvalArgs(['--local-report='])).toThrow(
      /Invalid --local-report: value cannot be empty/,
    );
  });
});
