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
});

var activeStream = null;

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

function syncChatFormAction() {
  var form = document.querySelector('.squire-input-dock');
  if (!form) return;

  var match = window.location.pathname.match(/^\/chat\/([0-9a-f-]+)(?:\/messages\/[0-9a-f-]+)?$/);
  var action = match ? '/chat/' + match[1] + '/messages' : '/chat';
  form.setAttribute('action', action);
  form.setAttribute('hx-post', action);
}

function closeActiveStream() {
  if (!activeStream) return;
  activeStream.source.close();
  activeStream = null;
}

function updateRecentQuestionsNav(html) {
  if (typeof html !== 'string' || !html) return;

  var template = document.createElement('template');
  template.innerHTML = html.trim();
  var nextNav = template.content.firstElementChild;
  if (!nextNav) return;

  var currentNav = document.querySelector('#squire-recent-questions');
  if (currentNav && currentNav.parentNode) {
    currentNav.replaceWith(nextNav);
    return;
  }

  var form = document.querySelector('.squire-input-dock');
  if (form && form.parentNode) {
    form.parentNode.insertBefore(nextNav, form);
  }
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

function handlePendingTranscript(transcript) {
  if (!transcript) return;

  // Browser event expectations live in docs/SSE_CONTRACT.md. Text is rendered
  // only from text-delta, while done/error are terminal UI state changes.
  var streamUrl = transcript.getAttribute('data-stream-url');
  if (!streamUrl) return;
  if (activeStream && activeStream.url === streamUrl) return;

  closeActiveStream();

  var answerEl = transcript.querySelector('.squire-answer--pending');
  if (!answerEl) return;

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
    // SQR-98: accumulate provenance labels for the consulted footer. Only
    // successful tool calls contribute, only known provenance labels
    // (REFERENCE is the wire-level fallback for utility tools — treat it
    // as "no source"), and the Map preserves insertion order for the
    // render step on `done`.
    if (payload.ok !== false && isKnownConsultedLabel(payload.label)) {
      if (!consultedLabels.has(payload.label)) {
        consultedLabels.set(payload.label, true);
      }
    }
    if (!toolsEl) return;
    if (seenFirstDelta) {
      clearToolStatusRows(toolsEl, toolEntries);
      return;
    }
    var row = ensureToolStatusRow(toolsEl, toolEntries, payload.id);
    renderToolStatusRow(row, payload.label, payload.ok === false ? 'error' : 'running');
  });

  source.addEventListener('done', function (event) {
    answerEl.classList.remove('squire-answer--pending');
    answerEl.setAttribute('data-stream-state', 'done');
    if (skeletonEl) skeletonEl.hidden = true;
    if (toolsEl) toolsEl.replaceChildren();
    var payload = JSON.parse(event.data || '{}');
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
    updateRecentQuestionsNav(payload.recentQuestionsNavHtml);
    finishStream();
  });

  source.addEventListener('error', function (event) {
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
  var target = event.detail && event.detail.target;
  if (!target || target.id !== 'squire-surface') return;

  var form = document.querySelector('.squire-input-dock');
  var questionInput = form && form.querySelector('input[name="question"]');
  if (questionInput) questionInput.value = '';
  setFormPendingState(form, false);
  syncChatFormAction();
  handlePendingTranscript(target.querySelector('.squire-transcript--pending'));
});

document.addEventListener('DOMContentLoaded', function () {
  syncChatFormAction();
  handlePendingTranscript(document.querySelector('.squire-transcript--pending'));
});
