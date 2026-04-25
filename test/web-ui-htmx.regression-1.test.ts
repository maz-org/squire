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

  it('recognizes selected-message URLs when retargeting follow-up submits (PR 3 will retire this)', () => {
    // SQR-108 / ADR 0012: home and conversation submits use different
    // swap contracts (`#squire-surface innerHTML` vs
    // `.squire-transcript beforeend`), and the legacy
    // `/chat/:id/messages/:mid` route stays on the replace-the-surface
    // contract until PR 3 removes it. The single regex was split into
    // separate matches so the retargeter can flip target/swap, not just
    // the action URL.
    expect(squireJs).toContain('pathname.match(/^\\/chat\\/([0-9a-f-]+)$/)');
    expect(squireJs).toContain(
      'pathname.match(/^\\/chat\\/([0-9a-f-]+)\\/messages\\/[0-9a-f-]+$/)',
    );
    expect(squireJs).toContain("form.setAttribute('hx-target', '.squire-transcript');");
    expect(squireJs).toContain("form.setAttribute('hx-swap', 'beforeend');");
  });

  it('keeps the submit button labeled Ask after pending state clears', () => {
    expect(squireJs).toContain("submitButton.textContent = 'Ask';");
    expect(squireJs).not.toContain("submitButton.textContent = '→';");
  });

  it('keeps lookup status present-tense and clears it once real answer prose starts', () => {
    expect(squireJs).toContain('function ensureToolStatusRow(toolsEl, toolEntries, toolId) {');
    expect(squireJs).toContain('var toolPhaseStarted = false;');
    expect(squireJs).toContain("var preToolBuffer = '';");
    expect(squireJs).toContain("labelEl.textContent = 'CONSULTING';");
    expect(squireJs).not.toContain("labelEl.textContent = 'CONSULTED';");
    expect(squireJs).toContain("stateEl.textContent = 'ONE SOURCE';");
    expect(squireJs).toContain('function shouldSuppressPreToolDelta(delta) {');
    expect(squireJs).toContain('preToolBuffer += delta;');
    expect(squireJs).toContain('delta = preToolBuffer;');
    expect(squireJs).toContain("preToolBuffer = '';");
    expect(squireJs).toContain('toolsEl.replaceChildren();');
  });

  it('applies the terminal HTML swap even when the final fragment is empty', () => {
    expect(squireJs).toContain("source.addEventListener('done'");
    expect(squireJs).toContain("typeof payload.html === 'string'");
    expect(squireJs).toContain("contentEl.classList.add('squire-markdown');");
    expect(squireJs).toContain('contentEl.innerHTML = payload.html;');
  });
});
