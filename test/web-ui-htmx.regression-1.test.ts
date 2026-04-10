import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const squireJs = readFileSync(new URL('../src/web-ui/squire.js', import.meta.url), 'utf8');

describe('squire.js HTMX first-turn submit regression', () => {
  it('generates and forwards an idempotency key during htmx request configuration', () => {
    // Regression: ISSUE-001 — first authenticated chat submit 400s because the
    // HTMX request omitted idempotencyKey.
    // Found by /qa on 2026-04-10
    // Report: .gstack/qa-reports/qa-report-localhost-2026-04-10.md
    expect(squireJs).toContain("document.addEventListener('htmx:configRequest'");
    expect(squireJs).toContain('event.detail.parameters.idempotencyKey = idempotencyKey');
    expect(squireJs).toContain('ensureIdempotencyKey(form)');
  });
});
