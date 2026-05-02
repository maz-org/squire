import { describe, expect, it } from 'vitest';

import { passFromTraceScores } from '../eval/scoring.ts';

describe('eval scoring summaries', () => {
  it('requires both answer and trajectory verdicts to pass when both are present', () => {
    expect(
      passFromTraceScores([
        { name: 'pass', value: 'pass' },
        { name: 'trajectory_pass', value: 'fail' },
      ]),
    ).toBe(false);
    expect(
      passFromTraceScores([
        { name: 'pass', value: 'pass' },
        { name: 'trajectory_pass', value: 'pass' },
      ]),
    ).toBe(true);
  });
});
