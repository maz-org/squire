import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const scriptSource = readFileSync(new URL('../src/web-ui/squire.js', import.meta.url), 'utf8');

class FakeClassList {
  private readonly tokens = new Set<string>();
  private readonly owner: FakeElement;

  constructor(owner: FakeElement, initial = '') {
    this.owner = owner;
    for (const token of initial.split(/\s+/).filter(Boolean)) {
      this.tokens.add(token);
    }
    this.sync();
  }

  private readFromOwner() {
    this.tokens.clear();
    for (const token of this.owner.className.split(/\s+/).filter(Boolean)) {
      this.tokens.add(token);
    }
  }

  add(...tokens: string[]) {
    this.readFromOwner();
    for (const token of tokens) this.tokens.add(token);
    this.sync();
  }

  remove(...tokens: string[]) {
    this.readFromOwner();
    for (const token of tokens) this.tokens.delete(token);
    this.sync();
  }

  contains(token: string) {
    this.readFromOwner();
    return this.tokens.has(token);
  }

  private sync() {
    this.owner.className = [...this.tokens].join(' ');
  }
}

class FakeElement {
  className = '';
  textContent = '';
  innerHTML = '';
  hidden = false;
  dataset: Record<string, string> = {};
  parentNode: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly classList = new FakeClassList(this);
  readonly tagName: string;

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  appendChild(child: FakeElement) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]) {
    this.children.length = 0;
    for (const child of children) {
      child.parentNode = this;
      this.children.push(child);
    }
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  querySelector(selector: string): FakeElement | null {
    if (selector === 'p') {
      return this.find((node) => node.tagName === 'p');
    }

    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      return this.find(
        (node) =>
          node.classList.contains(className) || node.className.split(/\s+/).includes(className),
      );
    }

    return null;
  }

  private find(predicate: (node: FakeElement) => boolean): FakeElement | null {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const nested = child.find(predicate);
      if (nested) return nested;
    }
    return null;
  }
}

class FakeEventSource {
  static latest: FakeEventSource | null = null;

  readonly listeners = new Map<string, Array<(event: { data?: string }) => void>>();
  closed = false;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.latest = this;
  }

  addEventListener(event: string, callback: (event: { data?: string }) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), callback]);
  }

  emit(event: string, data: unknown) {
    for (const callback of this.listeners.get(event) ?? []) {
      callback({ data: JSON.stringify(data) });
    }
  }

  close() {
    this.closed = true;
  }
}

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

function bootPendingTranscript() {
  const listeners = new Map<string, Array<() => void>>();

  const form = {
    setAttribute() {},
    querySelector() {
      return null;
    },
  };

  const contentEl = new FakeElement('div');
  contentEl.classList.add('squire-answer__content');
  const toolsEl = new FakeElement('div');
  toolsEl.classList.add('squire-answer__tools');
  const skeletonEl = new FakeElement('div');
  skeletonEl.classList.add('squire-answer__skeleton');

  const answerEl = new FakeElement('article');
  answerEl.classList.add('squire-answer--pending');
  answerEl.appendChild(contentEl);
  answerEl.appendChild(toolsEl);
  answerEl.appendChild(skeletonEl);

  const transcript = new FakeElement('section');
  transcript.classList.add('squire-transcript--pending');
  transcript.setAttribute('data-stream-url', '/chat/stream');
  transcript.appendChild(answerEl);

  // SQR-98: the footer now lives inside the answer element, not page
  // chrome. Attach it to answerEl so `answerEl.querySelector('.squire-toolcall')`
  // in squire.js resolves the same way the real render path does.
  const footerEl = new FakeElement('footer');
  footerEl.classList.add('squire-toolcall');
  answerEl.appendChild(footerEl);

  const document = {
    addEventListener(event: string, callback: () => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), callback]);
    },
    createElement(tagName: string) {
      return new FakeElement(tagName);
    },
    querySelector(selector: string) {
      if (selector === '.squire-input-dock') return form;
      if (selector === '.squire-transcript--pending') return transcript;
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  const context = vm.createContext({
    document,
    window: {
      location: { pathname: '/chat/test' },
      crypto: {},
      EventSource: FakeEventSource,
    },
  });

  vm.runInContext(scriptSource, context);
  for (const callback of listeners.get('DOMContentLoaded') ?? []) {
    callback();
  }

  const source = FakeEventSource.latest;
  if (!source) throw new Error('pending transcript did not start an EventSource');

  return {
    answerEl,
    contentEl,
    footerEl,
    skeletonEl,
    source,
    toolsEl,
  };
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

  it('suppresses pre-tool filler, keeps lookup metadata present-tense, and clears it when the answer starts', () => {
    const { contentEl, footerEl, skeletonEl, source, toolsEl } = bootPendingTranscript();

    source.emit('text-delta', { delta: 'Let me ' });
    source.emit('text-delta', { delta: 'look that up carefully before answering.' });
    expect(contentEl.querySelector('p')).toBeNull();
    expect(footerEl.hidden).toBe(true);

    source.emit('tool-start', { id: 'search_rules', label: 'RULEBOOK' });

    const row = toolsEl.children[0];
    expect(row).toBeTruthy();
    expect(row.querySelector('.squire-answer__tool-label')?.textContent).toBe('CONSULTING');
    expect(row.querySelector('.squire-answer__tool-state')?.textContent).toBe('RULEBOOK');

    source.emit('tool-result', { id: 'search_rules', labels: ['RULEBOOK'], ok: true });
    expect(row.querySelector('.squire-answer__tool-label')?.textContent).toBe('CONSULTING');
    expect(row.querySelector('.squire-answer__tool-state')?.textContent).toBe('RULEBOOK');

    source.emit('text-delta', { delta: 'Loot 2 can reach up to two hexes away.' });
    expect(skeletonEl.hidden).toBe(true);
    expect(toolsEl.children).toHaveLength(0);
    expect(contentEl.querySelector('p')?.textContent).toBe(
      'Loot 2 can reach up to two hexes away.',
    );

    source.emit('done', {
      html: '<p>Loot 2 can reach up to two hexes away.</p>',
      recentQuestionsNavHtml: '',
    });
    // SQR-98: the single successful tool-result fed RULEBOOK into the
    // consulted set. The done handler writes the real provenance line.
    expect(footerEl.hidden).toBe(false);
    expect(footerEl.textContent).toBe('CONSULTED · RULEBOOK');
    expect(source.closed).toBe(true);
  });

  // SQR-98: the consulted footer must reflect the actual tool calls this
  // turn made — never placeholder text, never stale data from a prior
  // turn. These tests cover the ok:false exclusion, dedup + insertion
  // order, the REFERENCE fallback filter (utility tools shouldn't leak
  // into the footer), and the empty/error paths.
  describe('SQR-98 consulted footer', () => {
    it('renders CONSULTED · RULEBOOK · CARD INDEX in insertion order', () => {
      const { footerEl, source } = bootPendingTranscript();

      source.emit('tool-start', { id: 'search_rules', label: 'RULEBOOK' });
      source.emit('tool-result', { id: 'search_rules', labels: ['RULEBOOK'], ok: true });
      source.emit('tool-start', { id: 'card-index', label: 'CARD INDEX' });
      source.emit('tool-result', { id: 'card-index', labels: ['CARD INDEX'], ok: true });
      source.emit('done', { html: '<p>Answer.</p>', recentQuestionsNavHtml: '' });

      expect(footerEl.textContent).toBe('CONSULTED · RULEBOOK · CARD INDEX');
      expect(footerEl.hidden).toBe(false);
    });

    it('dedupes repeated labels and preserves first-seen order', () => {
      const { footerEl, source } = bootPendingTranscript();

      source.emit('tool-result', { id: 'search_rules', labels: ['RULEBOOK'], ok: true });
      source.emit('tool-result', { id: 'card-index', labels: ['CARD INDEX'], ok: true });
      source.emit('tool-result', { id: 'search_rules', labels: ['RULEBOOK'], ok: true });
      source.emit('done', { html: '<p>Answer.</p>', recentQuestionsNavHtml: '' });

      expect(footerEl.textContent).toBe('CONSULTED · RULEBOOK · CARD INDEX');
    });

    it('excludes labels from failed tool calls', () => {
      const { footerEl, source } = bootPendingTranscript();

      source.emit('tool-result', { id: 'search_rules', labels: ['RULEBOOK'], ok: false });
      source.emit('tool-result', { id: 'card-index', labels: ['CARD INDEX'], ok: true });
      source.emit('done', { html: '<p>Answer.</p>', recentQuestionsNavHtml: '' });

      expect(footerEl.textContent).toBe('CONSULTED · CARD INDEX');
    });

    it('ignores the REFERENCE fallback label (utility/traversal tools)', () => {
      const { footerEl, source } = bootPendingTranscript();

      // follow_links emits label=REFERENCE on the wire — our footer
      // aggregator should treat that as "not a real source".
      source.emit('tool-result', { id: 'follow_links', labels: ['REFERENCE'], ok: true });
      source.emit('done', { html: '<p>Answer.</p>', recentQuestionsNavHtml: '' });

      expect(footerEl.textContent).toBe('');
      expect(footerEl.hidden).toBe(true);
    });

    it('accumulates multiple labels from a single tool-result (post-SQR-105 search_rules)', () => {
      const { footerEl, source } = bootPendingTranscript();

      // search_rules hit both the rulebook and section book in one call
      source.emit('tool-result', {
        id: 'search_rules',
        labels: ['RULEBOOK', 'SECTION BOOK'],
        ok: true,
      });
      source.emit('done', { html: '<p>Answer.</p>', recentQuestionsNavHtml: '' });

      expect(footerEl.textContent).toBe('CONSULTED · RULEBOOK · SECTION BOOK');
      expect(footerEl.hidden).toBe(false);
    });

    it('leaves the footer hidden on done when no tools fired', () => {
      const { footerEl, source } = bootPendingTranscript();

      source.emit('text-delta', { delta: 'Short direct answer.' });
      source.emit('done', { html: '<p>Short direct answer.</p>', recentQuestionsNavHtml: '' });

      expect(footerEl.hidden).toBe(true);
      expect(footerEl.textContent).toBe('');
    });

    it('leaves the footer hidden when the stream errors', () => {
      const { footerEl, source } = bootPendingTranscript();

      source.emit('tool-result', { id: 'search_rules', labels: ['RULEBOOK'], ok: true });
      source.emit('error', { kind: 'transport', message: 'Trouble connecting.' });

      expect(footerEl.hidden).toBe(true);
    });
  });

  it('streams tool-free answers immediately instead of waiting for done', () => {
    const { contentEl, skeletonEl, source, toolsEl } = bootPendingTranscript();

    source.emit('text-delta', { delta: 'Closed doors block line-of-sight for looting.' });

    expect(skeletonEl.hidden).toBe(true);
    expect(toolsEl.children).toHaveLength(0);
    expect(contentEl.querySelector('p')?.textContent).toBe(
      'Closed doors block line-of-sight for looting.',
    );
  });

  it('does not suppress normal tool-free answers that open with a conversational phrase', () => {
    const { contentEl, skeletonEl, source, toolsEl } = bootPendingTranscript();

    source.emit('text-delta', { delta: "Here's how looting works." });

    expect(skeletonEl.hidden).toBe(true);
    expect(toolsEl.children).toHaveLength(0);
    expect(contentEl.querySelector('p')?.textContent).toBe("Here's how looting works.");
  });

  it('strips lookupy filler once a tool-free answer reveals itself', () => {
    const { contentEl, skeletonEl, source, toolsEl } = bootPendingTranscript();

    // Question: What game is this assistant for?
    source.emit('text-delta', { delta: 'Let me check the quick version: ' });
    expect(contentEl.querySelector('p')).toBeNull();

    source.emit('text-delta', { delta: 'This assistant is for Frosthaven.' });

    expect(skeletonEl.hidden).toBe(true);
    expect(toolsEl.children).toHaveLength(0);
    expect(contentEl.querySelector('p')?.textContent).toBe('This assistant is for Frosthaven.');
  });

  it('treats a one-sentence tool-free lookupy opening as answer text', () => {
    const { contentEl, skeletonEl, source, toolsEl } = bootPendingTranscript();

    source.emit('text-delta', { delta: "I'll confirm monsters cannot loot treasure tiles." });

    expect(skeletonEl.hidden).toBe(true);
    expect(toolsEl.children).toHaveLength(0);
    expect(contentEl.querySelector('p')?.textContent).toBe('monsters cannot loot treasure tiles.');
  });

  it('renders error state when tool-result reports failure', () => {
    const { source, toolsEl } = bootPendingTranscript();

    source.emit('tool-start', { id: 'search_rules', label: 'RULEBOOK' });
    source.emit('tool-result', { id: 'search_rules', labels: ['RULEBOOK'], ok: false });

    const row = toolsEl.children[0];
    expect(row?.classList.contains('is-error')).toBe(true);
    expect(row?.querySelector('.squire-answer__tool-label')?.textContent).toBe("COULDN'T CHECK");
    expect(row?.querySelector('.squire-answer__tool-state')?.textContent).toBe('ONE SOURCE');
  });

  it('ignores late tool-status events once answer prose is already on screen', () => {
    const { contentEl, source, toolsEl } = bootPendingTranscript();

    source.emit('text-delta', { delta: 'Monsters cannot loot treasure tiles.' });
    source.emit('tool-start', { id: 'rulebook', label: 'RULEBOOK' });
    source.emit('tool-result', { id: 'rulebook', labels: ['RULEBOOK'], ok: true });

    expect(toolsEl.children).toHaveLength(0);
    expect(contentEl.querySelector('p')?.textContent).toBe('Monsters cannot loot treasure tiles.');
  });
});
