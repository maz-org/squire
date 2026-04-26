// Squire web UI — vanilla JS islands. Loaded by layout.ts via
// `<script src="/squire.js" defer>`. Served on-demand by the asset
// pipeline in src/web-ui/assets.ts (SQR-71). Keeping this file in `src/`
// instead of a build output means it ships from a single source of truth
// and the CSP work in SQR-61 can drop 'unsafe-inline' for script-src.

// SQR-66 cite tap-toggle (plan-design-review Decision #4). Tap on a
// .squire-answer .cite adds .is-active; tap anywhere else clears it.
// Five lines of vanilla JS — no framework, no dependency. Keyboard
// focus is already covered by the global :focus-visible ring.
document.addEventListener('click', function (e) {
  var t = e.target;
  var cite = t && t.closest ? t.closest('.squire-answer .cite') : null;
  document.querySelectorAll('.squire-answer .cite.is-active').forEach(function (el) {
    if (el !== cite) el.classList.remove('is-active');
  });
  if (cite) {
    e.preventDefault();
    cite.classList.toggle('is-active');
  }
});

document.addEventListener('submit', function (e) {
  var form = e.target;
  if (!form || !form.matches || !form.matches('.squire-input-dock')) return;

  var questionInput = form.querySelector('input[name="question"]');
  var submitButton = form.querySelector('button[type="submit"]');
  ensureIdempotencyKey(form);

  form.dataset.submitting = 'true';
  if (questionInput) questionInput.setAttribute('readonly', 'true');
  if (submitButton) submitButton.setAttribute('disabled', 'true');
  if (submitButton) {
    submitButton.textContent = '...';
  }

  // SQR-108 / ADR 0012 D-3: arm the scroll controller for the new turn.
  // The pending answer hasn't been swapped in yet — `htmx:afterSwap` will
  // do that — but flagging "the user just submitted" lets the post-swap
  // path scroll to the new pending turn and re-enable pin-to-bottom in
  // case the user had scrolled away on a prior turn.
  pinToBottom = true;
  pendingScrollOnNextSwap = true;
});

var activeStream = null;
// SQR-108 / ADR 0012 D-3: scroll controller state. `pinToBottom` is true
// while the user is at (or near) the bottom of the transcript; while pinned,
// streaming text auto-scrolls to keep up. The user scrolling up by more
// than `SCROLL_PIN_THRESHOLD_PX` disables pin so they can re-read prior
// turns without snap-back; scrolling back near the bottom re-enables it.
var SCROLL_PIN_THRESHOLD_PX = 80;
var pinToBottom = true;
var pendingScrollOnNextSwap = false;

function generateIdempotencyKey() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return String(Date.now()) + '-' + Math.random().toString(16).slice(2);
}

function ensureIdempotencyKey(form) {
  if (!form || !form.querySelector) return null;
  var idempotencyInput = form.querySelector('input[name="idempotencyKey"]');
  if (!idempotencyInput) return null;
  if (!idempotencyInput.value) {
    idempotencyInput.value = generateIdempotencyKey();
  }
  return idempotencyInput.value;
}

function setFormPendingState(form, pending) {
  if (!form) return;
  var questionInput = form.querySelector('input[name="question"]');
  var submitButton = form.querySelector('button[type="submit"]');

  if (pending) {
    form.dataset.submitting = 'true';
    if (questionInput) questionInput.setAttribute('readonly', 'true');
    if (submitButton) submitButton.setAttribute('disabled', 'true');
    if (submitButton) submitButton.textContent = '...';
    return;
  }

  delete form.dataset.submitting;
  if (questionInput) questionInput.removeAttribute('readonly');
  if (submitButton) submitButton.removeAttribute('disabled');
  if (submitButton) submitButton.textContent = 'Ask';
}

// SQR-108 / ADR 0012: keep the form's HTMX swap contract aligned with
// the current page. On the home page the form replaces the whole
// `#squire-surface` (which gets replaced by the new transcript). On any
// page that already has a `<section class="squire-transcript">` in the
// DOM — including the legacy `/messages/:mid` selected-message route
// that keeps shipping until PR 3 — each submit appends one new turn via
// `.squire-transcript` + `beforeend`. The selected-message renderer
// emits the same `.squire-transcript` wrapper, so the append-fragment
// response from `POST /chat/:id/messages` lands cleanly without wiping
// the surrounding surface.
function syncChatFormAction() {
  var form = document.querySelector('.squire-input-dock');
  if (!form) return;

  var pathname = window.location.pathname;
  var conversationMatch = pathname.match(/^\/chat\/([0-9a-f-]+)$/);
  var selectedMessageMatch = pathname.match(/^\/chat\/([0-9a-f-]+)\/messages\/[0-9a-f-]+$/);

  if (conversationMatch || selectedMessageMatch) {
    var match = conversationMatch || selectedMessageMatch;
    var convAction = '/chat/' + match[1] + '/messages';
    form.setAttribute('action', convAction);
    form.setAttribute('hx-post', convAction);
    form.setAttribute('hx-target', '.squire-transcript');
    form.setAttribute('hx-swap', 'beforeend');
    return;
  }

  form.setAttribute('action', '/chat');
  form.setAttribute('hx-post', '/chat');
  form.setAttribute('hx-target', '#squire-surface');
  form.setAttribute('hx-swap', 'innerHTML');
}

function closeActiveStream() {
  if (!activeStream) return;
  activeStream.source.close();
  activeStream = null;
}

function ensureAnswerParagraph(contentEl) {
  var paragraph = contentEl.querySelector('p');
  if (paragraph) return paragraph;

  paragraph = document.createElement('p');
  contentEl.appendChild(paragraph);
  return paragraph;
}

function renderPendingError(answerEl, label, message) {
  answerEl.classList.remove('squire-answer--pending');
  answerEl.setAttribute('data-stream-state', 'error');
  answerEl.replaceChildren();

  var banner = document.createElement('div');
  banner.className = 'squire-banner squire-banner--error';
  banner.setAttribute('role', 'alert');

  var labelEl = document.createElement('span');
  labelEl.className = 'squire-banner__label';
  labelEl.textContent = label;

  var messageEl = document.createElement('p');
  messageEl.className = 'squire-banner__body';
  messageEl.textContent = message;

  banner.appendChild(labelEl);
  banner.appendChild(messageEl);
  answerEl.appendChild(banner);
}

var PRE_TOOL_STARTERS = ['let me', "i'll", 'i will', "i'm going to", 'i am going to'];
var PRE_TOOL_LOOKUP_VERBS = [
  'check',
  'look',
  'pull',
  'find',
  'confirm',
  'verify',
  'consult',
  'search',
];
var PRE_TOOL_ANSWER_BOUNDARIES = [/:\s+/, /[.!?]\s+/, /\s[—-]\s+/];
var PRE_TOOL_SCAFFOLDING_TAIL_PATTERNS = [
  /^(?:that|this|it)\b(?:\s+(?:up|for|carefully|specifically|before|first|more|real|out)\b)?/i,
  /^the\s+(?:quick|short|exact|specific)\b/i,
  /^(?:up|carefully|specifically|before|first|more|real)\b/i,
  /^(?:whether|if)\b/i,
];
var PRE_TOOL_SUPPRESSED_ANSWER_PATTERN = new RegExp(
  '^\\s*(?:' +
    PRE_TOOL_STARTERS.map(escapeRegExp).join('|') +
    ')\\s+(?:' +
    PRE_TOOL_LOOKUP_VERBS.map(escapeRegExp).join('|') +
    ')\\b([\\s\\S]*)$',
  'i',
);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getPreToolLookupRemainder(delta) {
  var normalized = delta.trim().toLowerCase().replace(/\s+/g, ' ');

  for (var index = 0; index < PRE_TOOL_STARTERS.length; index += 1) {
    var starter = PRE_TOOL_STARTERS[index];
    if (normalized === starter || normalized.indexOf(starter + ' ') === 0) {
      return normalized.slice(starter.length).trim();
    }
  }

  return null;
}

function shouldDelayPreToolDelta(delta) {
  var remainder = getPreToolLookupRemainder(delta);
  if (remainder === null) return false;
  if (!remainder) return true;

  for (var index = 0; index < PRE_TOOL_LOOKUP_VERBS.length; index += 1) {
    if (PRE_TOOL_LOOKUP_VERBS[index].indexOf(remainder) === 0) {
      return true;
    }
  }

  return false;
}

function shouldSuppressPreToolDelta(delta) {
  var remainder = getPreToolLookupRemainder(delta);
  if (remainder === null || !remainder) return false;

  for (var index = 0; index < PRE_TOOL_LOOKUP_VERBS.length; index += 1) {
    var verb = PRE_TOOL_LOOKUP_VERBS[index];
    if (remainder === verb || remainder.indexOf(verb + ' ') === 0) {
      return true;
    }
  }

  return false;
}

function extractToolFreeAnswerFromSuppressedPreToolDelta(delta) {
  var match = delta.match(PRE_TOOL_SUPPRESSED_ANSWER_PATTERN);
  if (!match) return null;

  var tail = (match[1] || '').trim();
  if (!tail) return null;
  var earliestBoundary = null;

  for (var index = 0; index < PRE_TOOL_ANSWER_BOUNDARIES.length; index += 1) {
    var boundary = PRE_TOOL_ANSWER_BOUNDARIES[index].exec(tail);
    if (!boundary) continue;
    if (!earliestBoundary || boundary.index < earliestBoundary.index) {
      earliestBoundary = boundary;
    }
  }

  if (earliestBoundary) {
    var answer = tail.slice(earliestBoundary.index + earliestBoundary[0].length).trim();
    return answer || null;
  }

  for (
    var patternIndex = 0;
    patternIndex < PRE_TOOL_SCAFFOLDING_TAIL_PATTERNS.length;
    patternIndex += 1
  ) {
    if (PRE_TOOL_SCAFFOLDING_TAIL_PATTERNS[patternIndex].test(tail)) {
      return null;
    }
  }

  return tail;
}

// SQR-98: the set of provenance labels that are allowed to appear in the
// consulted footer. Keep this in sync with ToolSourceLabel in
// src/web-ui/consulted-footer.ts. REFERENCE is intentionally excluded —
// it's the wire-level fallback for utility/traversal tools and isn't a
// real source. Anything else (e.g. a typo or a server-side drift) is
// silently dropped rather than leaked into the UI.
var KNOWN_CONSULTED_LABELS = {
  RULEBOOK: true,
  'PUZZLE BOOK': true,
  'CARD INDEX': true,
  'SCENARIO BOOK': true,
  'SECTION BOOK': true,
};

function isKnownConsultedLabel(label) {
  return (
    typeof label === 'string' && Object.prototype.hasOwnProperty.call(KNOWN_CONSULTED_LABELS, label)
  );
}

// Mirrors TOOL_SOURCE_LABELS in src/web-ui/consulted-footer.ts. Only used
// on the replay path (done event carrying payload.consultedSources for an
// already-persisted assistant message — duplicate /stream hits, reconnects).
// The live-stream path aggregates from the tool-result event's `label`
// field instead. The JS/TS drift test in test/consulted-footer.test.ts
// keeps both sides honest.
var TOOL_NAME_TO_LABEL = {
  search_rules: 'RULEBOOK',
  search_cards: 'CARD INDEX',
  list_card_types: 'CARD INDEX',
  list_cards: 'CARD INDEX',
  get_card: 'CARD INDEX',
  find_scenario: 'SCENARIO BOOK',
  get_scenario: 'SCENARIO BOOK',
  get_section: 'SECTION BOOK',
};

function toolNameToConsultedLabel(name) {
  if (typeof name !== 'string') return null;
  // Post-SQR-105: new rows store ToolSourceLabel strings directly in
  // consultedSources. Pass them through unchanged.
  if (isKnownConsultedLabel(name)) return name;
  return Object.prototype.hasOwnProperty.call(TOOL_NAME_TO_LABEL, name)
    ? TOOL_NAME_TO_LABEL[name]
    : null;
}

function ensureToolStatusRow(toolsEl, toolEntries, toolId) {
  var row = toolEntries[toolId];
  if (row) return row;

  row = document.createElement('div');
  row.className = 'squire-answer__tool';
  row.dataset.toolId = toolId;

  var labelEl = document.createElement('span');
  labelEl.className = 'squire-answer__tool-label';
  row.appendChild(labelEl);

  var stateEl = document.createElement('span');
  stateEl.className = 'squire-answer__tool-state';
  row.appendChild(stateEl);

  toolEntries[toolId] = row;
  toolsEl.appendChild(row);
  return row;
}

function renderToolStatusRow(row, label, state) {
  if (!row) return;

  row.classList.remove('is-error');
  row.dataset.toolState = state;

  var labelEl = row.querySelector('.squire-answer__tool-label');
  var stateEl = row.querySelector('.squire-answer__tool-state');
  if (!stateEl) return;

  if (state === 'running') {
    if (labelEl) labelEl.textContent = 'CONSULTING';
    stateEl.textContent = label || 'REFERENCE';
    return;
  }

  if (state === 'error') {
    row.classList.add('is-error');
    if (labelEl) labelEl.textContent = "COULDN'T CHECK";
    stateEl.textContent = 'ONE SOURCE';
    return;
  }

  if (labelEl) labelEl.textContent = label || 'REFERENCE';
  stateEl.textContent = '';
}

function clearToolStatusRows(toolsEl, toolEntries) {
  if (!toolsEl) return;

  toolsEl.replaceChildren();
  for (var toolId in toolEntries) {
    delete toolEntries[toolId];
  }
}

// SQR-108 / ADR 0012 D-3: pin-to-bottom helpers. Use page-level scroll
// (the conversation page scrolls the document body — `.squire-frame` is
// `min-height: 100vh` and the input dock sticky-pins to the viewport).
function isNearBottom(threshold) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return true;
  var doc = document.documentElement;
  if (!doc) return true;
  var distance = doc.scrollHeight - (window.scrollY + window.innerHeight);
  return distance <= (threshold == null ? SCROLL_PIN_THRESHOLD_PX : threshold);
}

// Scroll coalescing — text-delta events fire dozens of times per second
// while streaming. Each delta mutates the DOM (paragraph.textContent
// growing) and a naïve scrollToBottom() per delta forces a layout flush
// to read scrollHeight, then a second flush from the programmatic scroll
// itself, then a third when the listener re-reads scrollHeight. Coalesce
// all the per-frame scroll requests into a single rAF so the browser
// does one scroll per paint regardless of how many deltas fire.
var scrollToBottomScheduled = false;
function scrollToBottom() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (scrollToBottomScheduled) return;
  if (typeof window.requestAnimationFrame !== 'function') {
    var doc = document.documentElement;
    if (doc) window.scrollTo({ top: doc.scrollHeight, behavior: 'auto' });
    return;
  }
  scrollToBottomScheduled = true;
  window.requestAnimationFrame(function () {
    scrollToBottomScheduled = false;
    var doc = document.documentElement;
    if (!doc) return;
    window.scrollTo({ top: doc.scrollHeight, behavior: 'auto' });
  });
}

function scrollPendingAnswerIntoView(answerEl) {
  if (!answerEl || typeof answerEl.scrollIntoView !== 'function') return;
  answerEl.scrollIntoView({ block: 'start', behavior: 'auto' });
}

// User-driven scrolls (touchmove, wheel, scrollbar) update `pinToBottom`
// based on distance from bottom. Programmatic auto-scrolls also fire
// scroll events, but they leave us at the bottom — `isNearBottom`
// returns true and the pin stays on. Genuine user-initiated scroll-up
// drops below the threshold and disables pin.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener(
    'scroll',
    function () {
      pinToBottom = isNearBottom();
    },
    { passive: true },
  );
}

function attachPendingAnswerStream(answerEl) {
  if (!answerEl) return;

  // Browser event expectations live in docs/SSE_CONTRACT.md. Text is rendered
  // only from text-delta, while done/error are terminal UI state changes.
  var streamUrl = answerEl.getAttribute('data-stream-url');
  if (!streamUrl) return;
  if (activeStream && activeStream.url === streamUrl) return;

  closeActiveStream();

  // SQR-108: serialize submits — keep the input dock disabled while a
  // stream is active so the user can't append a second pending turn that
  // would strand the first one (the client only supports one
  // EventSource at a time, and the message DB ordering can scramble Q+A
  // pairs if turn N+1 finishes before turn N). The form re-enables in
  // the SSE `done` and `error` handlers below. Server-side stranded
  // pending turns (e.g. a stranded HTMX retry) trigger the same
  // disabled state on initial page load.
  var formEl = document.querySelector('.squire-input-dock');
  setFormPendingState(formEl, true);

  var contentEl = answerEl.querySelector('.squire-answer__content');
  var toolsEl = answerEl.querySelector('.squire-answer__tools');
  var skeletonEl = answerEl.querySelector('.squire-answer__skeleton');
  // SQR-98: the consulted footer now lives inside the answer element so
  // each turn owns its own provenance slot. Historical turns render the
  // footer server-side from messages.consulted_sources; this stream-side
  // path populates the footer for the live turn only.
  var footerEl = answerEl.querySelector('.squire-toolcall');
  var toolEntries = {};
  var preToolBuffer = '';
  var seenFirstDelta = false;
  var toolPhaseStarted = false;
  // Ordered-dedup set of provenance labels collected from tool-result
  // events during this turn. `Map` preserves insertion order, which we
  // rely on so the footer reads "CONSULTED · RULEBOOK · CARD INDEX" in
  // the order the agent actually consulted the sources.
  var consultedLabels = new Map();
  var source = new window.EventSource(streamUrl);

  activeStream = {
    url: streamUrl,
    source: source,
  };

  if (footerEl) footerEl.hidden = true;

  function finishStream() {
    if (activeStream && activeStream.source === source) {
      activeStream = null;
    }
    source.close();
    // SQR-108: re-enable the input dock once the stream terminates so
    // the user can submit the next turn. Mirrors the lock applied in
    // attachPendingAnswerStream.
    setFormPendingState(document.querySelector('.squire-input-dock'), false);
  }

  function materializeStreamingDelta(delta) {
    if (!seenFirstDelta) {
      seenFirstDelta = true;
      answerEl.setAttribute('data-stream-state', 'streaming');
      if (skeletonEl) skeletonEl.hidden = true;
      if (toolPhaseStarted) clearToolStatusRows(toolsEl, toolEntries);
    }

    if (!contentEl) return;
    contentEl.classList.add('squire-markdown');
    var paragraph = ensureAnswerParagraph(contentEl);
    paragraph.textContent += delta;
    if (pinToBottom) scrollToBottom();
  }

  source.addEventListener('text-delta', function (event) {
    var payload = JSON.parse(event.data || '{}');
    var delta = payload.delta || '';
    if (!delta) return;

    if (!toolPhaseStarted && !seenFirstDelta) {
      preToolBuffer += delta;

      // Keep obvious lookup throat-clearing off-screen until a tool event
      // confirms it was scaffolding, but preserve real tool-free answers even
      // when their opening phrase arrives across multiple deltas.
      if (shouldDelayPreToolDelta(preToolBuffer)) {
        return;
      }

      if (shouldSuppressPreToolDelta(preToolBuffer)) {
        delta = extractToolFreeAnswerFromSuppressedPreToolDelta(preToolBuffer);
        if (!delta) return;
      } else {
        delta = preToolBuffer;
      }

      preToolBuffer = '';
    }

    materializeStreamingDelta(delta);
  });

  // tool-start sends a single `label` (static tool-name label, pre-result).
  // tool-result sends `labels[]` (actual books hit, post-SQR-105). The
  // asymmetry is intentional: at start time we don't yet know which books
  // search_rules will hit; at result time we do.
  source.addEventListener('tool-start', function (event) {
    if (!toolsEl) return;
    if (seenFirstDelta) {
      clearToolStatusRows(toolsEl, toolEntries);
      return;
    }
    var payload = JSON.parse(event.data || '{}');
    preToolBuffer = '';
    toolPhaseStarted = true;
    var row = ensureToolStatusRow(toolsEl, toolEntries, payload.id);
    renderToolStatusRow(row, payload.label, 'running');
  });

  source.addEventListener('tool-result', function (event) {
    var payload = JSON.parse(event.data || '{}');
    // SQR-98: once the answer text has started streaming, any subsequent
    // tool events are late-arriving stragglers (agent loop finishing
    // up), not actual sources for this answer. Ignore them both for the
    // tool-indicator row AND for the consulted-footer accumulator —
    // otherwise the footer would show stale labels that weren't really
    // consulted for the answer the user is reading. CodeRabbit caught
    // the accumulator leak on 2026-04-21.
    if (seenFirstDelta) {
      if (toolsEl) clearToolStatusRows(toolsEl, toolEntries);
      return;
    }
    // Accumulate provenance labels for the consulted footer. Only successful
    // tool calls contribute, only known provenance labels (REFERENCE is the
    // wire-level fallback for utility tools — treat it as "no source"), and
    // the Map preserves insertion order for the render step on `done`.
    // Post-SQR-105: payload.labels is an array (search_rules may return
    // multiple book labels); all other tools send a single-element array.
    var resultLabels = Array.isArray(payload.labels) ? payload.labels : [];
    if (payload.ok !== false) {
      for (var li = 0; li < resultLabels.length; li += 1) {
        if (isKnownConsultedLabel(resultLabels[li]) && !consultedLabels.has(resultLabels[li])) {
          consultedLabels.set(resultLabels[li], true);
        }
      }
    }
    if (!toolsEl) return;
    var row = ensureToolStatusRow(toolsEl, toolEntries, payload.id);
    renderToolStatusRow(row, resultLabels[0] || null, payload.ok === false ? 'error' : 'running');
  });

  source.addEventListener('done', function (event) {
    answerEl.classList.remove('squire-answer--pending');
    answerEl.setAttribute('data-stream-state', 'done');
    if (skeletonEl) skeletonEl.hidden = true;
    if (toolsEl) toolsEl.replaceChildren();
    // SQR-108 QA: close the EventSource SYNCHRONOUSLY before deferring
    // the HTML swap. The server ends its handler after sending `done`,
    // which closes the TCP connection from the server side; the
    // browser then synthesizes an `error` event for the close. If we
    // defer source.close() (e.g. inside a rAF callback), the
    // browser's connection-close error fires FIRST and stomps the
    // answer with the "Trouble connecting" banner. Closing
    // immediately and dropping `activeStream` here means the
    // subsequent error handler can short-circuit on
    // `source.readyState === EventSource.CLOSED`.
    if (activeStream && activeStream.source === source) {
      activeStream = null;
    }
    source.close();
    setFormPendingState(document.querySelector('.squire-input-dock'), false);

    var payload = JSON.parse(event.data || '{}');
    // SQR-108 / ADR 0012 D-5: wrap the streamed-plaintext → final-HTML
    // swap in `aria-busy="true"` so screen readers (notably VoiceOver on
    // iOS Safari) don't double-announce the same answer once as the
    // streamed paragraph and again when the rendered HTML lands. The
    // toggle has to span at least one paint to be observable: setting
    // true and false synchronously in the same tick means AT never
    // notices the busy state. We use a double-rAF — set busy now, swap
    // the HTML on the next frame, clear busy on the frame after — so
    // the browser actually paints the busy state before the swap and
    // the live region is ready for the next turn's announcement.
    answerEl.setAttribute('aria-busy', 'true');
    var applyDoneSwap = function () {
      if (contentEl && typeof payload.html === 'string') {
        contentEl.classList.add('squire-markdown');
        contentEl.innerHTML = payload.html;
      }
      // SQR-98: write the accumulated provenance labels into the footer.
      // Empty map → leave the footer hidden (AC #3: no source data, no lie).
      //
      // Replay fallback: if the stream completed without emitting any
      // tool_result events (e.g., duplicate /stream hit that hit the
      // idempotent already-persisted path), the server now includes the
      // row's persisted consultedSources in the done payload so we can
      // still rebuild the footer. Live-stream labels take precedence — if
      // consultedLabels has entries, they came from this actual turn.
      if (footerEl) {
        var labels = [];
        if (consultedLabels.size > 0) {
          consultedLabels.forEach(function (_value, label) {
            labels.push(label);
          });
        } else if (Array.isArray(payload.consultedSources)) {
          for (var i = 0; i < payload.consultedSources.length; i += 1) {
            var mapped = toolNameToConsultedLabel(payload.consultedSources[i]);
            if (mapped && labels.indexOf(mapped) === -1) labels.push(mapped);
          }
        }
        if (labels.length > 0) {
          footerEl.textContent = ['CONSULTED'].concat(labels).join(' · ');
          footerEl.hidden = false;
        } else {
          footerEl.hidden = true;
        }
      }
      if (pinToBottom) scrollToBottom();
      var clearAriaBusy = function () {
        answerEl.setAttribute('aria-busy', 'false');
      };
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(clearAriaBusy);
      } else {
        clearAriaBusy();
      }
    };
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(applyDoneSwap);
    } else {
      applyDoneSwap();
    }
  });

  source.addEventListener('error', function (event) {
    // SQR-108 QA: ignore the EventSource `error` that browsers
    // synthesize when the SERVER cleanly closes the connection after
    // sending `done`. The done handler closes the source synchronously
    // before deferring its visual swap, so any error fired against an
    // already-closed source is the natural connection-close — not a
    // real transport failure. Surfacing that as "Trouble connecting"
    // would stomp the answer the user just received.
    //
    // EventSource.CLOSED is `2` per the WHATWG spec; we hard-code it
    // because the `EventSource` constructor isn't in scope under the
    // module-script lint rule even though it's a global at runtime.
    if (source.readyState === 2) {
      return;
    }
    var payload = { kind: 'transport', message: 'Trouble connecting. Please try again.' };
    if (event.data) {
      payload = JSON.parse(event.data);
    }
    renderPendingError(
      answerEl,
      payload.kind === 'session' ? 'SESSION ENDED' : 'TROUBLE CONNECTING',
      payload.message || 'Trouble connecting. Please try again.',
    );
    finishStream();
  });
}

// Find the pending answer that needs a stream attached. Used both on page
// load (initial server-rendered transcript may include one) and after every
// HTMX swap (a follow-up appended one new pending turn, or a first submit
// from home replaced #squire-surface with the new transcript).
function findActivePendingAnswer(root) {
  var scope = root || document;
  var candidates = scope.querySelectorAll
    ? scope.querySelectorAll('.squire-answer--pending[data-stream-url]')
    : null;
  if (!candidates || candidates.length === 0) return null;
  for (var i = 0; i < candidates.length; i += 1) {
    var candidate = candidates[i];
    var url = candidate.getAttribute('data-stream-url');
    if (!url) continue;
    if (activeStream && activeStream.url === url) continue;
    return candidate;
  }
  return null;
}

document.addEventListener('htmx:configRequest', function (event) {
  var form = event.detail && event.detail.elt;
  if (!form || !form.matches || !form.matches('.squire-input-dock')) return;

  // HTMX can hold onto the original hx-post path even after the form action is
  // retargeted from "/chat" to "/chat/:conversationId/messages". Force the
  // request path from the live DOM action on every submit so Enter-key follow-ups
  // hit the current conversation instead of starting over.
  var action = form.getAttribute('action');
  if (action && event.detail) {
    event.detail.path = action;
  }

  var idempotencyKey = ensureIdempotencyKey(form);
  if (idempotencyKey && event.detail && event.detail.parameters) {
    event.detail.parameters.idempotencyKey = idempotencyKey;
  }
});

document.addEventListener('htmx:afterSwap', function (event) {
  // The form lives outside the swap target on the conversation page —
  // the append-fragment swap touches `.squire-transcript`, not the form
  // — so we manage form state here regardless of the swap target id.
  var form = document.querySelector('.squire-input-dock');
  var questionInput = form && form.querySelector('input[name="question"]');
  if (questionInput) questionInput.value = '';
  syncChatFormAction();

  var swapTarget = event.detail && event.detail.target;
  var pending = findActivePendingAnswer(swapTarget) || findActivePendingAnswer(document);
  if (pending) {
    if (pendingScrollOnNextSwap) {
      pendingScrollOnNextSwap = false;
      pinToBottom = true;
      scrollPendingAnswerIntoView(pending);
    }
    // SQR-108: attachPendingAnswerStream sets the form to disabled and
    // the SSE done/error handlers re-enable it. Don't pre-enable here
    // — that would let the user submit a second turn while the first
    // is still streaming.
    attachPendingAnswerStream(pending);
  } else {
    // No pending stream after this swap (e.g., a non-chat swap).
    // Re-enable the form so the user can submit again.
    setFormPendingState(form, false);
  }
});

document.addEventListener('DOMContentLoaded', function () {
  syncChatFormAction();
  // SQR-108 / ADR 0012 D-2: the browser preserves last scroll natively on
  // back/forward navigation and refresh, so we don't pin or auto-scroll on
  // initial load. We only flag pin on submit (above) and re-evaluate it
  // from the current scroll position on the user's first scroll event.
  pinToBottom = isNearBottom();
  attachPendingAnswerStream(findActivePendingAnswer(document));
});
