import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const scriptSource = readFileSync(new URL('../src/web-ui/squire.js', import.meta.url), 'utf8');

function runSquireScript(pathname: string): Record<string, string> {
  const listeners = new Map<string, Array<() => void>>();
  const attributes: Record<string, string> = {};
  const form = {
    setAttribute(name: string, value: string) {
      attributes[name] = value;
    },
    querySelector() {
      return null;
    },
  };

  const document = {
    addEventListener(event: string, callback: () => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), callback]);
    },
    querySelector(selector: string) {
      return selector === '.squire-input-dock' ? form : null;
    },
    querySelectorAll() {
      return [];
    },
  };

  const context = vm.createContext({
    document,
    window: {
      location: { pathname },
      crypto: {},
      EventSource: function () {},
    },
  });

  vm.runInContext(scriptSource, context);
  for (const callback of listeners.get('DOMContentLoaded') ?? []) {
    callback();
  }

  return attributes;
}

describe('squire.js selected-message retargeting', () => {
  it('retargets the ask form to the current conversation on selected-message URLs', () => {
    // Regression: ISSUE-QA-001 — selected-message pages posted follow-ups to /chat
    // Found by /qa on 2026-04-11
    // Report: .gstack/qa-reports/qa-report-localhost-4306-2026-04-11.md
    const attributes = runSquireScript(
      '/chat/c7b7ac29-2173-48c5-9f6f-4d618e555db5/messages/7b8eaa3a-7f08-4c2c-90cc-76ad1ce587ec',
    );

    expect(attributes.action).toBe('/chat/c7b7ac29-2173-48c5-9f6f-4d618e555db5/messages');
    expect(attributes['hx-post']).toBe('/chat/c7b7ac29-2173-48c5-9f6f-4d618e555db5/messages');
  });
});
