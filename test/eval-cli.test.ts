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

  it('parses the local report output path', () => {
    expect(parseEvalArgs(['--local-report=/tmp/eval.json']).localReportPath).toBe('/tmp/eval.json');
  });
});
