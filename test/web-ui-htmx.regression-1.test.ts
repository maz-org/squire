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

  it('retargets HTMX follow-up submits from the live form action', () => {
    // Regression: ISSUE-002 — follow-up chat submits kept posting to /chat
    // Found by /qa on 2026-04-11
    // Report: .gstack/qa-reports/qa-report-localhost-5018-2026-04-11.md
    expect(squireJs).toContain("document.addEventListener('htmx:configRequest'");
    expect(squireJs).toContain("var action = form.getAttribute('action');");
    expect(squireJs).toContain('event.detail.path = action;');
  });

  it('recognizes selected-message URLs when retargeting follow-up submits', () => {
    expect(squireJs).toContain(
      'window.location.pathname.match(/^\\/chat\\/([0-9a-f-]+)(?:\\/messages\\/[0-9a-f-]+)?$/)',
    );
    expect(squireJs).toContain("var action = match ? '/chat/' + match[1] + '/messages' : '/chat';");
  });

  it('keeps the submit button labeled Ask after pending state clears', () => {
    expect(squireJs).toContain("submitButton.textContent = 'Ask';");
    expect(squireJs).not.toContain("submitButton.textContent = '→';");
  });

  it('deduplicates tool status rows in place and clears them on the final swap', () => {
    expect(squireJs).toContain('var existing = toolEntries[payload.id];');
    expect(squireJs).toContain('if (existing) return;');
    expect(squireJs).toContain('toolsEl.replaceChildren();');
  });

  it('applies the terminal HTML swap even when the final fragment is empty', () => {
    expect(squireJs).toContain("source.addEventListener('done'");
    expect(squireJs).toContain("typeof payload.html === 'string'");
    expect(squireJs).toContain('contentEl.innerHTML = payload.html;');
  });
});
