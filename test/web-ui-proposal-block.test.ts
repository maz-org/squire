/**
 * Confirmation block behavior (SQR-286): the consent chrome rendered for a
 * `proposal-staged` SSE event. Runs the REAL squire.js in a vm with a fake
 * DOM and a stubbed fetch, then drives the confirm / reject / expiry /
 * cancel paths through the same click handlers the browser uses.
 */
import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const scriptSource = readFileSync(new URL('../src/web-ui/squire.js', import.meta.url), 'utf8');

class FakeClassList {
  private readonly tokens = new Set<string>();

  add(...tokens: string[]) {
    for (const token of tokens) this.tokens.add(token);
  }

  remove(...tokens: string[]) {
    for (const token of tokens) this.tokens.delete(token);
  }

  contains(token: string) {
    return this.tokens.has(token);
  }

  toString() {
    return [...this.tokens].join(' ');
  }
}

class FakeElement {
  textContent = '';
  hidden = false;
  disabled = false;
  dataset: Record<string, string> = {};
  parentNode: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly classList = new FakeClassList();
  readonly listeners = new Map<string, Array<() => void>>();
  readonly tagName: string;

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  get className() {
    return this.classList.toString();
  }

  set className(value: string) {
    for (const token of this.className.split(/\s+/).filter(Boolean)) this.classList.remove(token);
    for (const token of value.split(/\s+/).filter(Boolean)) this.classList.add(token);
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child: FakeElement) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addEventListener(event: string, callback: () => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), callback]);
  }

  click() {
    for (const callback of this.listeners.get('click') ?? []) callback();
  }

  matches(selector: string): boolean {
    // Supports the selectors the block uses: .class and .class[attr="value"].
    const attrMatch = selector.match(/^([^[]+)\[([^=\]]+)="([^"]*)"\]$/);
    const classPart = attrMatch ? attrMatch[1] : selector;
    for (const token of classPart.split('.').filter(Boolean)) {
      if (!this.classList.contains(token)) return false;
    }
    if (attrMatch) {
      const [, , attr, value] = attrMatch;
      if (this.getAttribute(attr) !== value) return false;
    }
    return true;
  }

  querySelector(selector: string): FakeElement | null {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const results: FakeElement[] = [];
    for (const child of this.children) {
      if (child.matches(selector)) results.push(child);
      results.push(...child.querySelectorAll(selector));
    }
    return results;
  }
}

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

interface Harness {
  context: vm.Context & {
    renderProposalBlock: (answerEl: FakeElement, payload: unknown) => FakeElement | null;
  };
  answerEl: FakeElement;
  fetchCalls: FetchCall[];
  timers: Array<{ callback: () => void; delayMs: number }>;
}

function createHarness(fetchResult: () => Promise<unknown>): Harness {
  const fetchCalls: FetchCall[] = [];
  const timers: Array<{ callback: () => void; delayMs: number }> = [];
  const answerEl = new FakeElement('article');

  const csrfMeta = new FakeElement('meta');
  csrfMeta.setAttribute('content', 'csrf-test-token');

  const documentStub = {
    createElement: (tagName: string) => new FakeElement(tagName),
    createTextNode: (text: string) => {
      const node = new FakeElement('#text');
      node.textContent = text;
      return node;
    },
    addEventListener: () => {},
    querySelector: (selector: string) => (selector === 'meta[name="csrf-token"]' ? csrfMeta : null),
    querySelectorAll: () => [],
    documentElement: { scrollHeight: 0 },
  };

  const context = vm.createContext({
    document: documentStub,
    window: {
      location: { pathname: '/chat' },
      crypto: {},
      EventSource: function () {},
      addEventListener: () => {},
      scrollY: 0,
      innerHeight: 0,
      scrollTo: () => {},
      fetch: (url: string, init: { method: string; headers: Record<string, string> }) => {
        fetchCalls.push({ url, method: init.method, headers: init.headers });
        return fetchResult();
      },
    },
    setTimeout: (callback: () => void, delayMs: number) => {
      timers.push({ callback, delayMs });
      return timers.length;
    },
  });
  vm.runInContext(scriptSource, context);
  return { context: context as Harness['context'], answerEl, fetchCalls, timers };
}

const futureExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();

function stagedPayload(overrides: Record<string, unknown> = {}) {
  return {
    proposalId: 'proposal-1',
    campaignId: 'campaign-1',
    lines: ['SCENARIOS PLAYED → 1', 'PROSPERITY → 2'],
    expiresAt: futureExpiry,
    ...overrides,
  };
}

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('confirmation block (SQR-286)', () => {
  it('renders the staged panel with preview rows, actions, and aria-live status', () => {
    const { context, answerEl } = createHarness(() => Promise.resolve({ ok: true }));
    const block = context.renderProposalBlock(answerEl, stagedPayload());

    expect(block).not.toBeNull();
    expect(block!.dataset.proposalState).toBe('staged');
    const rows = block!.querySelectorAll('.squire-proposal__row');
    expect(rows.map((row) => row.textContent)).toEqual(['SCENARIOS PLAYED → 1', 'PROSPERITY → 2']);
    const confirm = block!.querySelector('.squire-proposal__confirm');
    expect(confirm!.classList.contains('squire-button--primary')).toBe(true);
    expect(confirm!.getAttribute('type')).toBe('button');
    const status = block!.querySelector('.squire-proposal__status');
    expect(status!.getAttribute('aria-live')).toBe('polite');
    expect(status!.getAttribute('role')).toBe('status');
  });

  it('is idempotent per proposal id for replayed events', () => {
    const { context, answerEl } = createHarness(() => Promise.resolve({ ok: true }));
    const first = context.renderProposalBlock(answerEl, stagedPayload());
    const second = context.renderProposalBlock(answerEl, stagedPayload());
    expect(second).toBe(first);
    expect(answerEl.querySelectorAll('.squire-proposal')).toHaveLength(1);
  });

  it('confirm path: posts with CSRF, turns rows applied, links the journal', async () => {
    const { context, answerEl, fetchCalls } = createHarness(() => Promise.resolve({ ok: true }));
    const block = context.renderProposalBlock(answerEl, stagedPayload())!;

    block.querySelector('.squire-proposal__confirm')!.click();
    await flushPromises();

    expect(fetchCalls).toEqual([
      {
        url: '/api/proposals/proposal-1/confirm',
        method: 'POST',
        headers: { 'x-csrf-token': 'csrf-test-token' },
      },
    ]);
    expect(block.dataset.proposalState).toBe('applied');
    for (const row of block.querySelectorAll('.squire-proposal__row')) {
      expect(row.classList.contains('is-applied')).toBe(true);
    }
    const status = block.querySelector('.squire-proposal__status')!;
    expect(status.textContent).toContain('Applied');
    const link = status.querySelector('.squire-proposal__link')!;
    expect(link.getAttribute('href')).toBe('/campaigns/campaign-1');
    expect(link.textContent).toBe('VIEW JOURNAL');
  });

  it('reject path: stale proposals turn rows failed with a dashboard repair link', async () => {
    const { context, answerEl } = createHarness(() =>
      Promise.resolve({
        ok: false,
        json: () =>
          Promise.resolve({ error: 'stale_proposal', message: 'State changed', status: 409 }),
      }),
    );
    const block = context.renderProposalBlock(answerEl, stagedPayload())!;

    block.querySelector('.squire-proposal__confirm')!.click();
    await flushPromises();

    expect(block.dataset.proposalState).toBe('failed');
    for (const row of block.querySelectorAll('.squire-proposal__row')) {
      expect(row.classList.contains('is-failed')).toBe(true);
    }
    const status = block.querySelector('.squire-proposal__status')!;
    expect(status.textContent).toContain('nothing was applied');
    expect(status.querySelector('.squire-proposal__link')!.textContent).toBe('REVIEW ON DASHBOARD');
  });

  it('expiry rendering: lapsed proposals flip to expired, never silently disappear', () => {
    const { context, answerEl, timers } = createHarness(() => Promise.resolve({ ok: true }));

    // Already-lapsed (replayed event): expired immediately.
    const lapsed = context.renderProposalBlock(
      answerEl,
      stagedPayload({
        proposalId: 'proposal-lapsed',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    )!;
    expect(lapsed.dataset.proposalState).toBe('expired');
    expect(lapsed.querySelector('.squire-proposal__status')!.textContent).toContain('expired');

    // Live block: the TTL timer flips it in place.
    const live = context.renderProposalBlock(answerEl, stagedPayload())!;
    expect(live.dataset.proposalState).toBe('staged');
    expect(timers.length).toBeGreaterThan(0);
    timers[timers.length - 1].callback();
    expect(live.dataset.proposalState).toBe('expired');
    expect(live.querySelector('.squire-proposal__confirm')!.disabled).toBe(true);
  });

  it('server-side proposal_expired confirms render as expired too', async () => {
    const { context, answerEl } = createHarness(() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ error: 'proposal_expired', message: 'Expired' }),
      }),
    );
    const block = context.renderProposalBlock(answerEl, stagedPayload())!;
    block.querySelector('.squire-proposal__confirm')!.click();
    await flushPromises();
    expect(block.dataset.proposalState).toBe('expired');
  });

  it('cancel path: deletes the proposal and mutes the block', async () => {
    const { context, answerEl, fetchCalls } = createHarness(() => Promise.resolve({ ok: true }));
    const block = context.renderProposalBlock(answerEl, stagedPayload())!;

    block.querySelector('.squire-proposal__cancel')!.click();
    await flushPromises();

    expect(fetchCalls[0]).toMatchObject({ url: '/api/proposals/proposal-1', method: 'DELETE' });
    expect(block.dataset.proposalState).toBe('cancelled');
    expect(block.querySelector('.squire-proposal__status')!.textContent).toContain('Cancelled');
  });

  it('transport failure returns the block to actionable with a retry notice', async () => {
    const { context, answerEl } = createHarness(() => Promise.reject(new Error('offline')));
    const block = context.renderProposalBlock(answerEl, stagedPayload())!;

    block.querySelector('.squire-proposal__confirm')!.click();
    await flushPromises();

    expect(block.dataset.proposalState).toBe('staged');
    expect(block.querySelector('.squire-proposal__confirm')!.disabled).toBe(false);
    expect(block.querySelector('.squire-proposal__status')!.textContent).toContain('try again');
  });
});
