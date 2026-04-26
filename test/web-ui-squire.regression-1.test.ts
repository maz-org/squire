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
    documentElement: { scrollHeight: 0 },
  };

  const context = vm.createContext({
    document,
    window: {
      location: { pathname },
      crypto: {},
      EventSource: function () {},
      addEventListener: () => {},
      scrollY: 0,
      innerHeight: 0,
      scrollTo: () => {},
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

  // SQR-108: setFormPendingState writes to form.dataset and reads back
  // form.querySelector('input[name="question"]'/'button[type="submit"]'),
  // so the fake form needs both. We don't care about the input/button
  // pendingState transitions in these tests — just give them no-op
  // setAttribute/removeAttribute so the lock+unlock path doesn't blow up.
  const noopElement = {
    setAttribute() {},
    removeAttribute() {},
    textContent: '',
  };
  const form = {
    setAttribute() {},
    dataset: {} as Record<string, string>,
    querySelector(selector: string) {
      if (selector === 'input[name="question"]') return noopElement;
      if (selector === 'button[type="submit"]') return noopElement;
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
  // SQR-108 / ADR 0012: stream URL lives on the pending answer article,
  // not on the (now-deleted) `.squire-transcript--pending` wrapper.
  answerEl.setAttribute('data-stream-url', '/chat/stream');
  answerEl.appendChild(contentEl);
  answerEl.appendChild(toolsEl);
  answerEl.appendChild(skeletonEl);

  const transcript = new FakeElement('section');
  transcript.classList.add('squire-transcript');
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
      return null;
    },
    querySelectorAll(selector: string) {
      // SQR-108: squire.js looks for `.squire-answer--pending[data-stream-url]`
      // to attach the EventSource. Match that selector directly — both the
      // class and attribute must be present, so post-error/post-done answers
      // (where renderPendingError / done strip the class) drop out and the
      // multi-pending drain path doesn't loop.
      if (selector === '.squire-answer--pending[data-stream-url]') {
        if (!answerEl.classList.contains('squire-answer--pending')) return [];
        return answerEl.getAttribute('data-stream-url') ? [answerEl] : [];
      }
      return [];
    },
    documentElement: { scrollHeight: 0 },
  };

  const context = vm.createContext({
    document,
    window: {
      location: { pathname: '/chat/test' },
      crypto: {},
      EventSource: FakeEventSource,
      addEventListener: () => {},
      scrollY: 0,
      innerHeight: 0,
      scrollTo: () => {},
      // SQR-108: the `done` handler uses requestAnimationFrame to
      // wrap the streamed→final-HTML swap in aria-busy. Run callbacks
      // synchronously in tests so the assertions on contentEl /
      // footerEl don't need to wait for paint.
      requestAnimationFrame: (cb: () => void) => {
        cb();
        return 0;
      },
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
    form,
    skeletonEl,
    source,
    toolsEl,
  };
}

describe('squire.js chat form retargeting', () => {
  it('SQR-108: /chat/:id sets the append-fragment swap contract', () => {
    const attributes = runSquireScript('/chat/c7b7ac29-2173-48c5-9f6f-4d618e555db5');

    expect(attributes.action).toBe('/chat/c7b7ac29-2173-48c5-9f6f-4d618e555db5/messages');
    expect(attributes['hx-target']).toBe('.squire-transcript');
    expect(attributes['hx-swap']).toBe('beforeend');
  });

  it('SQR-108: home page keeps #squire-surface + innerHTML so the first submit replaces the landing with the transcript shell', () => {
    const attributes = runSquireScript('/');

    expect(attributes.action).toBe('/chat');
    expect(attributes['hx-target']).toBe('#squire-surface');
    expect(attributes['hx-swap']).toBe('innerHTML');
  });

  it('SQR-108: form retargets stay correct across consecutive htmx:afterSwap events (chat-ui-qa-must-include-second-turn-submit)', () => {
    // Strengthens the second-turn regression: after the first append
    // swap completes, syncChatFormAction must keep the form pointing
    // at .squire-transcript + beforeend so the next submit appends
    // cleanly. Earlier the function was only fired in DOMContentLoaded;
    // any afterSwap drift would silently break the second submit.
    const docListeners = new Map<string, Array<(event?: { detail?: unknown }) => void>>();
    const attributes: Record<string, string> = {};
    const form = {
      setAttribute(name: string, value: string) {
        attributes[name] = value;
      },
      dataset: {} as Record<string, string>,
      querySelector() {
        return null;
      },
    };
    const document = {
      addEventListener(event: string, cb: (e?: { detail?: unknown }) => void) {
        docListeners.set(event, [...(docListeners.get(event) ?? []), cb]);
      },
      createElement(t: string) {
        return new FakeElement(t);
      },
      querySelector(sel: string) {
        return sel === '.squire-input-dock' ? form : null;
      },
      querySelectorAll() {
        return [];
      },
      documentElement: { scrollHeight: 0 },
    };
    const ctx = vm.createContext({
      document,
      window: {
        location: { pathname: '/chat/c7b7ac29-2173-48c5-9f6f-4d618e555db5' },
        crypto: {},
        EventSource: function () {},
        scrollY: 0,
        innerHeight: 0,
        scrollTo: () => {},
        addEventListener: () => {},
        requestAnimationFrame: (cb: () => void) => {
          cb();
          return 0;
        },
      },
    });
    vm.runInContext(scriptSource, ctx);
    for (const cb of docListeners.get('DOMContentLoaded') ?? []) cb();

    expect(attributes['hx-target']).toBe('.squire-transcript');
    expect(attributes['hx-swap']).toBe('beforeend');

    // First afterSwap (e.g. response from POST returned and was appended).
    for (const cb of docListeners.get('htmx:afterSwap') ?? []) cb({ detail: {} });
    expect(attributes['hx-target']).toBe('.squire-transcript');
    expect(attributes['hx-swap']).toBe('beforeend');

    // Second afterSwap (next response from a follow-up submit).
    for (const cb of docListeners.get('htmx:afterSwap') ?? []) cb({ detail: {} });
    expect(attributes['hx-target']).toBe('.squire-transcript');
    expect(attributes['hx-swap']).toBe('beforeend');
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
      source.emit('done', { html: '<p>Answer.</p>' });

      expect(footerEl.textContent).toBe('CONSULTED · RULEBOOK · CARD INDEX');
      expect(footerEl.hidden).toBe(false);
    });

    it('dedupes repeated labels and preserves first-seen order', () => {
      const { footerEl, source } = bootPendingTranscript();

      source.emit('tool-result', { id: 'search_rules', labels: ['RULEBOOK'], ok: true });
      source.emit('tool-result', { id: 'card-index', labels: ['CARD INDEX'], ok: true });
      source.emit('tool-result', { id: 'search_rules', labels: ['RULEBOOK'], ok: true });
      source.emit('done', { html: '<p>Answer.</p>' });

      expect(footerEl.textContent).toBe('CONSULTED · RULEBOOK · CARD INDEX');
    });

    it('excludes labels from failed tool calls', () => {
      const { footerEl, source } = bootPendingTranscript();

      source.emit('tool-result', { id: 'search_rules', labels: ['RULEBOOK'], ok: false });
      source.emit('tool-result', { id: 'card-index', labels: ['CARD INDEX'], ok: true });
      source.emit('done', { html: '<p>Answer.</p>' });

      expect(footerEl.textContent).toBe('CONSULTED · CARD INDEX');
    });

    it('ignores the REFERENCE fallback label (utility/traversal tools)', () => {
      const { footerEl, source } = bootPendingTranscript();

      // follow_links emits label=REFERENCE on the wire — our footer
      // aggregator should treat that as "not a real source".
      source.emit('tool-result', { id: 'follow_links', labels: ['REFERENCE'], ok: true });
      source.emit('done', { html: '<p>Answer.</p>' });

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
      source.emit('done', { html: '<p>Answer.</p>' });

      expect(footerEl.textContent).toBe('CONSULTED · RULEBOOK · SECTION BOOK');
      expect(footerEl.hidden).toBe(false);
    });

    it('leaves the footer hidden on done when no tools fired', () => {
      const { footerEl, source } = bootPendingTranscript();

      source.emit('text-delta', { delta: 'Short direct answer.' });
      source.emit('done', { html: '<p>Short direct answer.</p>' });

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

  describe('SQR-108 aria-busy double-announce suppression (D-5)', () => {
    it('sets aria-busy=true before the innerHTML swap and clears it after, with at least one rAF gap', () => {
      // The synchronous-toggle version of this code (set true, swap, set
      // false in one tick) was a no-op on screen readers — browsers
      // don't paint between three synchronous attribute/innerHTML calls.
      // The fix wraps the swap in requestAnimationFrame so the browser
      // can actually paint the busy state before the swap happens. This
      // test pins the ordering: aria-busy=true must be set BEFORE the
      // innerHTML mutation, and aria-busy=false must come AFTER.
      const { answerEl, contentEl, source } = bootPendingTranscript();

      const events: Array<{ type: 'aria-busy'; value: string } | { type: 'innerHTML' }> = [];
      const origSetAttr = answerEl.setAttribute.bind(answerEl);
      answerEl.setAttribute = (name: string, value: string) => {
        if (name === 'aria-busy') events.push({ type: 'aria-busy', value });
        origSetAttr(name, value);
      };
      const origInnerHTMLSet = Object.getOwnPropertyDescriptor(contentEl, 'innerHTML')?.set;
      Object.defineProperty(contentEl, 'innerHTML', {
        set(v: string) {
          events.push({ type: 'innerHTML' });
          origInnerHTMLSet?.call(this, v);
        },
        get() {
          return '';
        },
      });

      source.emit('text-delta', { delta: 'streamed plaintext' });
      source.emit('done', { html: '<p>final</p>' });

      const ariaBusyEvents = events.filter((e) => e.type === 'aria-busy');
      const innerHTMLIdx = events.findIndex((e) => e.type === 'innerHTML');
      const trueIdx = events.findIndex((e) => e.type === 'aria-busy' && e.value === 'true');
      const falseIdx = events.findIndex((e) => e.type === 'aria-busy' && e.value === 'false');

      expect(ariaBusyEvents.map((e) => 'value' in e && e.value)).toEqual(['true', 'false']);
      expect(trueIdx).toBeLessThan(innerHTMLIdx);
      expect(innerHTMLIdx).toBeLessThan(falseIdx);
    });
  });

  describe('SQR-108 scroll controller', () => {
    function bootScrollHarness(initial: {
      scrollHeight: number;
      scrollY: number;
      innerHeight: number;
    }) {
      const docListeners = new Map<
        string,
        Array<(event?: { detail?: unknown; target?: unknown }) => void>
      >();
      const winListeners = new Map<string, Array<() => void>>();
      const noopElement = { setAttribute() {}, removeAttribute() {}, textContent: '' };

      const contentEl = new FakeElement('div');
      contentEl.classList.add('squire-answer__content');
      const toolsEl = new FakeElement('div');
      toolsEl.classList.add('squire-answer__tools');
      const skeletonEl = new FakeElement('div');
      skeletonEl.classList.add('squire-answer__skeleton');
      const footerEl = new FakeElement('footer');
      footerEl.classList.add('squire-toolcall');
      const answerEl = new FakeElement('article');
      answerEl.classList.add('squire-answer--pending');
      answerEl.setAttribute('data-stream-url', '/chat/scroll/messages/m1/stream');
      answerEl.appendChild(contentEl);
      answerEl.appendChild(toolsEl);
      answerEl.appendChild(skeletonEl);
      answerEl.appendChild(footerEl);

      const scrollIntoViewCalls: Array<unknown> = [];
      Object.defineProperty(answerEl, 'scrollIntoView', {
        value: (opts: unknown) => {
          scrollIntoViewCalls.push(opts);
        },
      });

      const form = {
        setAttribute() {},
        dataset: {} as Record<string, string>,
        matches(sel: string) {
          return sel === '.squire-input-dock';
        },
        querySelector(sel: string) {
          if (sel === 'input[name="question"]') return noopElement;
          if (sel === 'button[type="submit"]') return noopElement;
          if (sel === 'input[name="idempotencyKey"]') return null;
          return null;
        },
      };

      const document = {
        addEventListener(
          event: string,
          callback: (e?: { detail?: unknown; target?: unknown }) => void,
        ) {
          docListeners.set(event, [...(docListeners.get(event) ?? []), callback]);
        },
        createElement(tagName: string) {
          return new FakeElement(tagName);
        },
        querySelector(sel: string) {
          if (sel === '.squire-input-dock') return form;
          return null;
        },
        querySelectorAll(sel: string) {
          if (sel === '.squire-answer--pending[data-stream-url]') {
            return answerEl.classList.contains('squire-answer--pending') ? [answerEl] : [];
          }
          return [];
        },
        documentElement: { scrollHeight: initial.scrollHeight },
      };

      const scrollToCalls: Array<{ top?: number; behavior?: string }> = [];

      const win = {
        location: { pathname: '/chat/scroll' },
        crypto: {},
        EventSource: FakeEventSource,
        scrollY: initial.scrollY,
        innerHeight: initial.innerHeight,
        scrollTo: (opts: { top?: number; behavior?: string }) => {
          scrollToCalls.push(opts);
        },
        addEventListener(event: string, cb: () => void) {
          winListeners.set(event, [...(winListeners.get(event) ?? []), cb]);
        },
        // Run rAF callbacks synchronously so test assertions are deterministic.
        requestAnimationFrame: (cb: () => void) => {
          cb();
          return 0;
        },
      };

      const context = vm.createContext({
        document,
        window: win,
      });
      vm.runInContext(scriptSource, context);
      for (const callback of docListeners.get('DOMContentLoaded') ?? []) callback();

      return {
        answerEl,
        contentEl,
        docListeners,
        form,
        scrollIntoViewCalls,
        scrollToCalls,
        win,
        winListeners,
        source: FakeEventSource.latest!,
      };
    }

    it('disables pin-to-bottom when the user scrolls beyond the 80px threshold', () => {
      // Start near bottom (distance = 50px) so pin is on. Then jump up
      // 200px so distance becomes 250px > 80px threshold, and fire the
      // scroll event. Subsequent text-delta should NOT auto-scroll.
      const harness = bootScrollHarness({ scrollHeight: 2000, scrollY: 1150, innerHeight: 800 });
      // sanity: pin started true (DOMContentLoaded saw distance=50).
      expect(harness.scrollToCalls.length).toBe(0);

      harness.win.scrollY = 950; // distance now 250
      for (const cb of harness.winListeners.get('scroll') ?? []) cb();

      harness.source.emit('text-delta', { delta: 'New text streams while user is reading.' });
      expect(harness.scrollToCalls.length).toBe(0);
    });

    it('keeps pin-to-bottom on when the user is within the 80px threshold and auto-scrolls during text-delta', () => {
      const harness = bootScrollHarness({ scrollHeight: 2000, scrollY: 1150, innerHeight: 800 });
      // distance = 50, pin is on by default
      harness.source.emit('text-delta', { delta: 'Streaming text.' });
      expect(harness.scrollToCalls.length).toBeGreaterThan(0);
      expect(harness.scrollToCalls[0]).toMatchObject({ top: 2000, behavior: 'auto' });
    });

    it('coalesces multiple text-delta scrolls into a single scrollTo per animation frame (I5 perf fix)', () => {
      // With rAF-throttled scrollToBottom, ten deltas in one synchronous
      // batch should result in ONE scrollTo call (per frame), not ten.
      // We use a manually-batched rAF here so the schedule-and-fire
      // happens as a single batch.
      const docListeners = new Map<string, Array<() => void>>();
      const noopElement = { setAttribute() {}, removeAttribute() {}, textContent: '' };
      const contentEl = new FakeElement('div');
      contentEl.classList.add('squire-answer__content');
      const toolsEl = new FakeElement('div');
      toolsEl.classList.add('squire-answer__tools');
      const skeletonEl = new FakeElement('div');
      skeletonEl.classList.add('squire-answer__skeleton');
      const footerEl = new FakeElement('footer');
      footerEl.classList.add('squire-toolcall');
      const answerEl = new FakeElement('article');
      answerEl.classList.add('squire-answer--pending');
      answerEl.setAttribute('data-stream-url', '/chat/coalesce/messages/m1/stream');
      answerEl.appendChild(contentEl);
      answerEl.appendChild(toolsEl);
      answerEl.appendChild(skeletonEl);
      answerEl.appendChild(footerEl);

      const form = {
        setAttribute() {},
        dataset: {} as Record<string, string>,
        querySelector(sel: string) {
          if (sel === 'input[name="question"]') return noopElement;
          if (sel === 'button[type="submit"]') return noopElement;
          return null;
        },
      };
      const document = {
        addEventListener(event: string, cb: () => void) {
          docListeners.set(event, [...(docListeners.get(event) ?? []), cb]);
        },
        createElement(t: string) {
          return new FakeElement(t);
        },
        querySelector(sel: string) {
          if (sel === '.squire-input-dock') return form;
          return null;
        },
        querySelectorAll(sel: string) {
          return sel === '.squire-answer--pending[data-stream-url]' ? [answerEl] : [];
        },
        documentElement: { scrollHeight: 2000 },
      };

      const scrollToCalls: Array<unknown> = [];
      const rafQueue: Array<() => void> = [];
      const win = {
        location: { pathname: '/chat/coalesce' },
        crypto: {},
        EventSource: FakeEventSource,
        scrollY: 1150,
        innerHeight: 800,
        scrollTo: (opts: unknown) => {
          scrollToCalls.push(opts);
        },
        addEventListener: () => {},
        // Queue rAF callbacks instead of running them sync, so the test
        // can simulate a batch of deltas all sharing one frame.
        requestAnimationFrame: (cb: () => void) => {
          rafQueue.push(cb);
          return rafQueue.length;
        },
      };
      const ctx = vm.createContext({ document, window: win });
      vm.runInContext(scriptSource, ctx);
      for (const cb of docListeners.get('DOMContentLoaded') ?? []) cb();
      const source = FakeEventSource.latest!;

      // Ten rapid deltas in one batch. Each calls scrollToBottom but
      // only one rAF should be queued — the rest are coalesced.
      for (let i = 0; i < 10; i += 1) {
        source.emit('text-delta', { delta: 'chunk' + i + ' ' });
      }
      // No scrollTo until the rAF runs.
      expect(scrollToCalls.length).toBe(0);
      // Run the queued frame.
      while (rafQueue.length > 0) {
        const cb = rafQueue.shift()!;
        cb();
      }
      expect(scrollToCalls.length).toBe(1);
    });

    it('arms pendingScrollOnNextSwap on submit and scrolls the new pending into view on the next htmx:afterSwap', () => {
      // Real flow: page loads without a pending answer, user submits,
      // server response appends a new pending article, afterSwap fires
      // with the new pending in the DOM. We mirror that here by
      // building a harness whose pending article is "newly added" —
      // not present at DOMContentLoaded — so findActivePendingAnswer
      // doesn't skip it as the active stream.
      const docListeners = new Map<
        string,
        Array<(event?: { detail?: unknown; target?: unknown }) => void>
      >();
      const noopElement = { setAttribute() {}, removeAttribute() {}, textContent: '' };
      const contentEl = new FakeElement('div');
      contentEl.classList.add('squire-answer__content');
      const toolsEl = new FakeElement('div');
      toolsEl.classList.add('squire-answer__tools');
      const skeletonEl = new FakeElement('div');
      skeletonEl.classList.add('squire-answer__skeleton');
      const footerEl = new FakeElement('footer');
      footerEl.classList.add('squire-toolcall');
      const newPending = new FakeElement('article');
      newPending.classList.add('squire-answer--pending');
      newPending.setAttribute('data-stream-url', '/chat/scroll/messages/new/stream');
      newPending.appendChild(contentEl);
      newPending.appendChild(toolsEl);
      newPending.appendChild(skeletonEl);
      newPending.appendChild(footerEl);

      const scrollIntoViewCalls: Array<unknown> = [];
      Object.defineProperty(newPending, 'scrollIntoView', {
        value: (opts: unknown) => {
          scrollIntoViewCalls.push(opts);
        },
      });

      const form = {
        setAttribute() {},
        dataset: {} as Record<string, string>,
        matches(sel: string) {
          return sel === '.squire-input-dock';
        },
        querySelector(sel: string) {
          if (sel === 'input[name="question"]') return noopElement;
          if (sel === 'button[type="submit"]') return noopElement;
          return null;
        },
      };

      let pendingPresent = false;
      const document = {
        addEventListener(event: string, cb: (e?: { detail?: unknown; target?: unknown }) => void) {
          docListeners.set(event, [...(docListeners.get(event) ?? []), cb]);
        },
        createElement(t: string) {
          return new FakeElement(t);
        },
        querySelector(sel: string) {
          if (sel === '.squire-input-dock') return form;
          return null;
        },
        querySelectorAll(sel: string) {
          if (sel === '.squire-answer--pending[data-stream-url]' && pendingPresent) {
            return [newPending];
          }
          return [];
        },
        documentElement: { scrollHeight: 2000 },
      };
      const win = {
        location: { pathname: '/chat/scroll' },
        crypto: {},
        EventSource: FakeEventSource,
        scrollY: 1150,
        innerHeight: 800,
        scrollTo: () => {},
        addEventListener: () => {},
        requestAnimationFrame: (cb: () => void) => {
          cb();
          return 0;
        },
      };
      const ctx = vm.createContext({ document, window: win });
      vm.runInContext(scriptSource, ctx);
      // DOMContentLoaded: no pending yet. Nothing attaches.
      for (const cb of docListeners.get('DOMContentLoaded') ?? []) cb();

      // User submits — arms pendingScrollOnNextSwap.
      for (const cb of docListeners.get('submit') ?? []) cb({ target: form });

      // Server response appends a new pending article.
      pendingPresent = true;
      for (const cb of docListeners.get('htmx:afterSwap') ?? [])
        cb({ detail: { target: newPending } });

      expect(scrollIntoViewCalls.length).toBe(1);
      expect(scrollIntoViewCalls[0]).toMatchObject({ block: 'start', behavior: 'auto' });
    });
  });

  describe('SQR-108 multi-pending case — serial drain via finishStream', () => {
    it('does NOT open a second EventSource on htmx:afterSwap while one is active; drains to the next pending only after `done`', () => {
      // CodeRabbit (PR 274): a server-rendered transcript can include
      // multiple pending user-message turns (`pendingStreamUrls` is now a
      // Map). DOMContentLoaded attaches the FIRST pending. While that
      // stream is in flight, an htmx:afterSwap MUST NOT open a parallel
      // EventSource — the client supports exactly one active stream and
      // the second open would strand the first. The next pending is
      // drained from `finishStream()` after `done` (or `error`).
      const listeners = new Map<
        string,
        Array<(event: { detail?: { target?: unknown } }) => void>
      >();
      const noopElement = { setAttribute() {}, removeAttribute() {}, textContent: '' };

      function buildPending(streamUrl: string) {
        const contentEl = new FakeElement('div');
        contentEl.classList.add('squire-answer__content');
        const toolsEl = new FakeElement('div');
        toolsEl.classList.add('squire-answer__tools');
        const skeletonEl = new FakeElement('div');
        skeletonEl.classList.add('squire-answer__skeleton');
        const footerEl = new FakeElement('footer');
        footerEl.classList.add('squire-toolcall');
        const answerEl = new FakeElement('article');
        answerEl.classList.add('squire-answer--pending');
        answerEl.setAttribute('data-stream-url', streamUrl);
        answerEl.appendChild(contentEl);
        answerEl.appendChild(toolsEl);
        answerEl.appendChild(skeletonEl);
        answerEl.appendChild(footerEl);
        return answerEl;
      }

      const oldPending = buildPending('/chat/conv/messages/m1/stream');
      const newPending = buildPending('/chat/conv/messages/m2/stream');

      const transcript = new FakeElement('section');
      transcript.classList.add('squire-transcript');
      transcript.appendChild(oldPending);
      transcript.appendChild(newPending);

      const form = {
        setAttribute() {},
        dataset: {} as Record<string, string>,
        querySelector(selector: string) {
          if (selector === 'input[name="question"]') return noopElement;
          if (selector === 'button[type="submit"]') return noopElement;
          return null;
        },
      };

      const document = {
        addEventListener(
          event: string,
          callback: (event: { detail?: { target?: unknown } }) => void,
        ) {
          listeners.set(event, [...(listeners.get(event) ?? []), callback]);
        },
        createElement(tagName: string) {
          return new FakeElement(tagName);
        },
        querySelector(selector: string) {
          if (selector === '.squire-input-dock') return form;
          return null;
        },
        querySelectorAll(selector: string) {
          if (selector === '.squire-answer--pending[data-stream-url]') {
            return [oldPending, newPending].filter((el) =>
              el.classList.contains('squire-answer--pending'),
            );
          }
          return [];
        },
        documentElement: { scrollHeight: 0 },
      };

      const context = vm.createContext({
        document,
        window: {
          location: { pathname: '/chat/conv' },
          crypto: {},
          EventSource: FakeEventSource,
          addEventListener: () => {},
          scrollY: 0,
          innerHeight: 0,
          scrollTo: () => {},
          requestAnimationFrame: (cb: () => void) => {
            cb();
            return 0;
          },
        },
      });

      vm.runInContext(scriptSource, context);
      // DOMContentLoaded attaches to the FIRST pending answer.
      for (const callback of listeners.get('DOMContentLoaded') ?? []) {
        callback({});
      }
      const firstSource = FakeEventSource.latest;
      expect(firstSource?.url).toBe('/chat/conv/messages/m1/stream');

      // While m1 is in flight, an htmx:afterSwap fires. The handler
      // MUST NOT open a parallel EventSource — `attachPendingAnswerStream`
      // bails when `activeStream` is set so m1's stream isn't stranded.
      for (const callback of listeners.get('htmx:afterSwap') ?? []) {
        callback({ detail: { target: transcript } });
      }
      expect(FakeEventSource.latest).toBe(firstSource);

      // m1's stream finishes. `finishStream()` then drains the queue —
      // it re-scans the DOM, finds newPending, and attaches a fresh
      // EventSource pointing at m2.
      firstSource?.emit('done', { html: '<p>m1 answered</p>' });
      const secondSource = FakeEventSource.latest;
      expect(secondSource?.url).toBe('/chat/conv/messages/m2/stream');
      expect(secondSource).not.toBe(firstSource);
    });
  });

  describe('SQR-108 serialize submits — block follow-ups while a stream is active', () => {
    it('disables the input dock when a pending stream is attached and re-enables it on done', () => {
      // Prevents Codex's concurrent-submit stranding: if the form
      // re-enables on htmx:afterSwap (before SSE done), a fast user
      // can submit a second turn that strands the first turn's
      // EventSource and leaves a stuck pending skeleton in the DOM.
      const { form, source } = bootPendingTranscript();

      // The pending stream attached on DOMContentLoaded — form should
      // already be locked.
      expect(form.dataset.submitting).toBe('true');

      source.emit('done', { html: '<p>answer</p>' });
      expect(form.dataset.submitting).toBeUndefined();
    });

    it('re-enables the input dock when the stream errors', () => {
      const { form, source } = bootPendingTranscript();

      expect(form.dataset.submitting).toBe('true');

      source.emit('error', { kind: 'transport', message: 'Trouble.' });
      expect(form.dataset.submitting).toBeUndefined();
    });
  });
});
