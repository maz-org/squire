// Squire web UI — vanilla JS islands. Loaded by layout.ts via
// `<script src="/squire.js" defer>`. Served on-demand by the asset
// pipeline in src/web-ui/assets.ts (SQR-71). Keeping this file in `src/`
// instead of a build output means it ships from a single source of truth
// and the CSP work in SQR-61 can drop 'unsafe-inline' for script-src.

// SQR-66 cite tap-toggle (plan-design-review Decision #4). Tap on a
// .squire-answer .cite adds .is-active; tap anywhere else clears it.
// Five lines of vanilla JS — no framework, no dependency. Keyboard
// focus is already covered by the global :focus-visible ring.
var ACTIVE_GAME_STORAGE_KEY = 'squire.activeGame';
var FALLBACK_DEFAULT_ACTIVE_GAME = 'frosthaven';
var fallbackSupportedActiveGames = {
  frosthaven: true,
  'gloomhaven-2e': true,
};
var defaultActiveGame = FALLBACK_DEFAULT_ACTIVE_GAME;
var supportedActiveGames = fallbackSupportedActiveGames;
var activeGame = defaultActiveGame;
var activeGameInitialized = false;

function isSupportedActiveGame(value) {
  return (
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(supportedActiveGames, value)
  );
}

function firstSupportedActiveGame() {
  for (var key in supportedActiveGames) {
    if (Object.prototype.hasOwnProperty.call(supportedActiveGames, key)) return key;
  }
  return FALLBACK_DEFAULT_ACTIVE_GAME;
}

function hydrateActiveGameConfig() {
  var picker = document.querySelector ? document.querySelector('.squire-game-picker') : null;
  var supported = {};
  var defaultGame = '';

  if (picker && picker.dataset && picker.dataset.supportedGames) {
    var ids = picker.dataset.supportedGames.split(/\s+/);
    for (var i = 0; i < ids.length; i += 1) {
      if (ids[i]) supported[ids[i]] = true;
    }
    defaultGame = picker.dataset.defaultGame || '';
  }

  var radios = document.querySelectorAll
    ? document.querySelectorAll('input[name="activeGame"]')
    : [];
  if (Object.keys(supported).length === 0) {
    for (var j = 0; j < radios.length; j += 1) {
      if (radios[j].value) supported[radios[j].value] = true;
    }
  }
  if (!defaultGame) {
    for (var k = 0; k < radios.length; k += 1) {
      if (radios[k].checked && radios[k].value) {
        defaultGame = radios[k].value;
        break;
      }
    }
  }

  if (Object.keys(supported).length > 0) supportedActiveGames = supported;
  defaultActiveGame =
    typeof defaultGame === 'string' &&
    Object.prototype.hasOwnProperty.call(supportedActiveGames, defaultGame)
      ? defaultGame
      : firstSupportedActiveGame();
  if (!isSupportedActiveGame(activeGame)) activeGame = defaultActiveGame;
}

function readStoredActiveGame() {
  try {
    var stored = window.localStorage && window.localStorage.getItem(ACTIVE_GAME_STORAGE_KEY);
    return isSupportedActiveGame(stored) ? stored : defaultActiveGame;
  } catch {
    return defaultActiveGame;
  }
}

function persistActiveGame(value) {
  try {
    if (window.localStorage) window.localStorage.setItem(ACTIVE_GAME_STORAGE_KEY, value);
  } catch {
    // Storage can be blocked in private browsing. The hidden form field still
    // carries the current selection for this page view.
  }
}

function setHiddenGameInputs(value) {
  var inputs = document.querySelectorAll ? document.querySelectorAll('input[name="game"]') : [];
  for (var i = 0; i < inputs.length; i += 1) {
    inputs[i].value = value;
  }

  var form = document.querySelector('.squire-input-dock');
  var formInput = form && form.querySelector ? form.querySelector('input[name="game"]') : null;
  if (formInput) formInput.value = value;
}

function setActiveGame(value, persist) {
  activeGame = isSupportedActiveGame(value) ? value : defaultActiveGame;

  var radios = document.querySelectorAll
    ? document.querySelectorAll('input[name="activeGame"]')
    : [];
  for (var i = 0; i < radios.length; i += 1) {
    radios[i].checked = radios[i].value === activeGame;
  }
  setHiddenGameInputs(activeGame);

  if (persist) persistActiveGame(activeGame);
}

function bindActiveGameRadio(radio) {
  radio.addEventListener('change', function () {
    if (!radio.checked) return;
    setActiveGame(radio.value, true);
  });
}

function syncActiveGameControls() {
  hydrateActiveGameConfig();

  var radios = document.querySelectorAll
    ? document.querySelectorAll('input[name="activeGame"]')
    : [];

  if (!activeGameInitialized) {
    activeGame = readStoredActiveGame();
    activeGameInitialized = true;
  }
  setActiveGame(activeGame, false);

  for (var i = 0; i < radios.length; i += 1) {
    var radio = radios[i];
    if (radio.dataset && radio.dataset.squireGameBound === 'true') continue;
    if (radio.dataset) radio.dataset.squireGameBound = 'true';
    bindActiveGameRadio(radio);
  }
}

function preferredAnswerWorkOpen(container) {
  var state = container && container.getAttribute ? container.getAttribute('data-work-state') : '';
  if (state === 'error') return true;
  return state === 'running' || state === 'idle';
}

function syncAnswerWorkOpenState(container) {
  if (!container || container.hidden) return;
  container.open = preferredAnswerWorkOpen(container);
}

document.addEventListener('click', function (e) {
  var t = e.target;
  var historyToggle = t && t.closest ? t.closest('.squire-history-toggle') : null;
  if (historyToggle) {
    e.preventDefault();
    openHistoryDrawer(historyToggle);
    return;
  }
  var historyClose = t && t.closest ? t.closest('[data-history-close]') : null;
  if (historyClose) {
    e.preventDefault();
    closeHistoryDrawer();
    return;
  }
  var drawerRow = t && t.closest ? t.closest('#squire-history-drawer .squire-history-row') : null;
  if (drawerRow) {
    closeHistoryDrawer({ restoreFocus: false });
    return;
  }

  var cite = t && t.closest ? t.closest('.squire-answer .cite') : null;
  document.querySelectorAll('.squire-answer .cite.is-active').forEach(function (el) {
    if (el !== cite) el.classList.remove('is-active');
  });
  if (cite) {
    e.preventDefault();
    cite.classList.toggle('is-active');
  }
});

document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape') {
    closeHistoryDrawer();
    return;
  }
  trapHistoryDrawerFocus(event);
});

document.addEventListener('submit', function (e) {
  var form = e.target;
  if (!form || !form.matches || !form.matches('.squire-input-dock')) return;

  var questionInput = form.querySelector('input[name="question"]');
  var submitButton = form.querySelector('button[type="submit"]');
  setHiddenGameInputs(activeGame);
  ensureIdempotencyKey(form);

  // SQR-108 QA: do NOT mutate `submitButton.textContent` here. The
  // submit button renders the Squire seal monogram via an inner
  // `<span aria-hidden="true">S</span>` (SQR-99). Setting textContent
  // destroys the span and leaves a literal "..." (then "Ask" on
  // re-enable) where the wax-seal mark should be. The `disabled`
  // attribute + `data-submitting='true'` on the form already convey
  // the pending visual via `.squire-input-dock[data-submitting='true']
  // .squire-input-dock__submit { opacity: 0.8 }` in styles.css.
  form.dataset.submitting = 'true';
  if (questionInput) questionInput.setAttribute('readonly', 'true');
  if (submitButton) submitButton.setAttribute('disabled', 'true');

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
var historyDrawerReturnFocus = null;

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
    return;
  }

  delete form.dataset.submitting;
  if (questionInput) questionInput.removeAttribute('readonly');
  if (submitButton) submitButton.removeAttribute('disabled');
  // SQR-108 QA: do NOT touch `submitButton.textContent`. See the
  // matching comment in the document-level submit handler — the
  // button's inner `<span>S</span>` renders the wax-seal monogram and
  // textContent assignment destroys it.
}

function activeConversationHistoryRows() {
  return document.querySelectorAll
    ? Array.prototype.slice.call(
        document.querySelectorAll('.squire-history-row[aria-current="page"]'),
      )
    : [];
}

function setActiveConversationHistoryStatus(status) {
  var rows = activeConversationHistoryRows();
  for (var i = 0; i < rows.length; i += 1) {
    var row = rows[i];
    row.setAttribute('data-history-status', status);
    var statusEl = row.querySelector ? row.querySelector('.squire-history-row__status') : null;
    if (!statusEl) continue;
    if (status === 'running') {
      statusEl.textContent = 'Running';
      statusEl.hidden = false;
      continue;
    }
    if (status === 'error') {
      statusEl.textContent = 'Error';
      statusEl.hidden = false;
      continue;
    }
    statusEl.textContent = '';
    statusEl.hidden = true;
  }
}

function historyDrawerElements() {
  return {
    drawer: document.querySelector ? document.querySelector('#squire-history-drawer') : null,
    backdrop: document.querySelector ? document.querySelector('.squire-history-backdrop') : null,
    toggle: document.querySelector ? document.querySelector('.squire-history-toggle') : null,
  };
}

function focusableHistoryDrawerElements(drawer) {
  if (!drawer || !drawer.querySelectorAll) return [];
  return Array.prototype.slice.call(
    drawer.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
  );
}

function openHistoryDrawer(trigger) {
  var elements = historyDrawerElements();
  if (!elements.drawer) return;
  historyDrawerReturnFocus = trigger || elements.toggle || document.activeElement || null;
  elements.drawer.hidden = false;
  elements.drawer.setAttribute('aria-hidden', 'false');
  if (elements.backdrop) elements.backdrop.hidden = false;
  if (elements.toggle) elements.toggle.setAttribute('aria-expanded', 'true');
  var focusable = focusableHistoryDrawerElements(elements.drawer);
  if (focusable[0] && typeof focusable[0].focus === 'function') {
    focusable[0].focus();
  }
}

function closeHistoryDrawer(options) {
  var elements = historyDrawerElements();
  if (!elements.drawer || elements.drawer.hidden) return;
  elements.drawer.hidden = true;
  elements.drawer.setAttribute('aria-hidden', 'true');
  if (elements.backdrop) elements.backdrop.hidden = true;
  if (elements.toggle) elements.toggle.setAttribute('aria-expanded', 'false');
  var shouldRestoreFocus = !options || options.restoreFocus !== false;
  if (
    shouldRestoreFocus &&
    historyDrawerReturnFocus &&
    typeof historyDrawerReturnFocus.focus === 'function'
  ) {
    historyDrawerReturnFocus.focus();
  }
  historyDrawerReturnFocus = null;
}

function trapHistoryDrawerFocus(event) {
  if (event.key !== 'Tab') return;
  var drawer = document.querySelector ? document.querySelector('#squire-history-drawer') : null;
  if (!drawer || drawer.hidden) return;
  var focusable = focusableHistoryDrawerElements(drawer);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  var first = focusable[0];
  var last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

// SQR-108 / ADR 0012: keep the form's HTMX swap contract aligned with
// the current page. On the home page the form replaces the whole
// `#squire-surface` (which gets replaced by the new transcript). On any
// conversation page, each submit appends one new turn via
// `.squire-transcript` + `beforeend`.
function syncChatFormAction() {
  var form = document.querySelector('.squire-input-dock');
  if (!form) return;

  var pathname = window.location.pathname;
  var conversationMatch = pathname.match(/^\/chat\/([0-9a-f-]+)$/);

  if (conversationMatch) {
    var convAction = '/chat/' + conversationMatch[1] + '/messages';
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

function ensureAnswerParagraph(contentEl) {
  var paragraph = contentEl.querySelector('p');
  if (paragraph) return paragraph;

  paragraph = document.createElement('p');
  contentEl.appendChild(paragraph);
  return paragraph;
}

function renderPendingError(answerEl, label, message) {
  var workEl = answerEl.querySelector ? answerEl.querySelector('.squire-answer-work') : null;
  answerEl.classList.remove('squire-answer--pending');
  answerEl.setAttribute('data-stream-state', 'error');
  answerEl.replaceChildren();
  if (workEl) answerEl.appendChild(workEl);

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

function answerWorkElements(answerEl) {
  var container = answerEl.querySelector ? answerEl.querySelector('.squire-answer-work') : null;
  if (!container || !container.querySelector) return null;

  return {
    container: container,
    rowsEl: container.querySelector('.squire-answer-work__rows'),
    statusEl: container.querySelector('.squire-answer-work__status'),
  };
}

function formatWorkLogDuration(durationMs) {
  var totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  var seconds = totalSeconds % 60;
  var totalMinutes = Math.floor(totalSeconds / 60);
  var minutes = totalMinutes % 60;
  var hours = Math.floor(totalMinutes / 60);

  if (hours > 0) return hours + 'h ' + minutes + 'm ' + seconds + 's';
  if (totalMinutes > 0) return totalMinutes + 'm ' + seconds + 's';
  return seconds + 's';
}

function answerWorkNowMs() {
  return Date.now();
}

function updateAnswerWorkElapsedStatus(elements, state, endMs) {
  if (!elements || !elements.container || !elements.statusEl) return;
  var startedAt = Number.parseInt(
    (elements.container.dataset && elements.container.dataset.answerWorkStartedAtMs) || '',
    10,
  );
  if (!Number.isFinite(startedAt)) {
    startedAt = answerWorkNowMs();
    if (elements.container.dataset) {
      elements.container.dataset.answerWorkStartedAtMs = String(startedAt);
    }
  }
  var elapsed = (endMs == null ? answerWorkNowMs() : endMs) - startedAt;
  elements.statusEl.textContent =
    (state === 'complete' ? 'Worked for ' : 'Working for ') + formatWorkLogDuration(elapsed);
}

function clearAnswerWorkTimer(elements) {
  if (!elements || !elements.container || !elements.container.dataset) return;
  var timerId = elements.container.dataset.answerWorkTimerId;
  if (!timerId) return;
  if (
    typeof window !== 'undefined' &&
    window.clearInterval &&
    Number.isFinite(Number.parseInt(timerId, 10))
  ) {
    window.clearInterval(Number.parseInt(timerId, 10));
  }
  delete elements.container.dataset.answerWorkTimerId;
}

function startAnswerWorkTimer(elements) {
  if (!elements || !elements.container || !elements.container.dataset) return;
  if (!elements.container.dataset.answerWorkStartedAtMs) {
    elements.container.dataset.answerWorkStartedAtMs = String(answerWorkNowMs());
  }
  updateAnswerWorkElapsedStatus(elements, 'running');
  if (elements.container.dataset.answerWorkTimerId) return;
  if (typeof window === 'undefined' || typeof window.setInterval !== 'function') return;
  var timerId = window.setInterval(function () {
    if (elements.container.getAttribute('data-work-state') !== 'running') {
      clearAnswerWorkTimer(elements);
      return;
    }
    updateAnswerWorkElapsedStatus(elements, 'running');
  }, 1000);
  elements.container.dataset.answerWorkTimerId = String(timerId);
}

function completeAnswerWorkTimer(elements) {
  if (!elements.container) return;
  var endedAt = answerWorkNowMs();
  clearAnswerWorkTimer(elements);
  updateAnswerWorkElapsedStatus(elements, 'complete', endedAt);
}

function resetAnswerWork(elements, entries) {
  if (!elements || !elements.container) return;
  if (elements.rowsEl) {
    elements.rowsEl.replaceChildren();
    if (elements.rowsEl.dataset) elements.rowsEl.dataset.answerWorkNextOrdinal = '0';
  }
  if (entries) {
    for (var id in entries) {
      delete entries[id];
    }
  }
  elements.container.hidden = false;
  elements.container.setAttribute('data-work-state', 'running');
  syncAnswerWorkOpenState(elements.container);
  if (elements.container.dataset) {
    delete elements.container.dataset.answerWorkStartedAtMs;
  }
  clearAnswerWorkTimer(elements);
  startAnswerWorkTimer(elements);
}

function setAnswerWorkRunning(elements) {
  if (!elements || !elements.container) return;
  elements.container.hidden = false;
  elements.container.setAttribute('data-work-state', 'running');
  elements.container.open = true;
  startAnswerWorkTimer(elements);
}

function baseAnswerWorkId(rowId) {
  return typeof rowId === 'string' ? rowId.replace(/-progress-\d+$/, '') : rowId;
}

function answerWorkSlug(value, fallback) {
  var slug =
    typeof value === 'string'
      ? value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
      : '';
  return slug || fallback;
}

function displaySourceLabel(label) {
  switch (label) {
    case 'RULEBOOK':
      return 'Rulebook';
    case 'PUZZLE BOOK':
      return 'Puzzle Book';
    case 'CARD INDEX':
      return 'Card Index';
    case 'SCENARIO BOOK':
      return 'Scenario Book';
    case 'SECTION BOOK':
      return 'Section Book';
    case 'REFERENCE':
      return '';
    default:
      return typeof label === 'string' ? label : '';
  }
}

function sentenceSourceLabel(label) {
  var display = displaySourceLabel(label);
  return display ? display.toLowerCase() : '';
}

function answerWorkSourceEntries(labels) {
  var entries = [];
  for (var i = 0; i < labels.length; i += 1) {
    var label = labels[i];
    var display = displaySourceLabel(label);
    if (!display) continue;
    var exists = false;
    for (var j = 0; j < entries.length; j += 1) {
      if (entries[j].label === label) {
        exists = true;
        break;
      }
    }
    if (!exists) entries.push({ label: label, display: display });
  }
  return entries;
}

function answerWorkCheckedSourceRowId(label, ok, index) {
  return (
    (ok === false ? 'failed-source-' : 'checked-source-') + answerWorkSlug(label, String(index))
  );
}

function rememberAnswerWorkSourceLabels(row, labels) {
  if (!row || !row.dataset) return;
  var existing = row.dataset.answerWorkSourceLabels
    ? row.dataset.answerWorkSourceLabels.split('|').filter(Boolean)
    : [];
  for (var i = 0; i < labels.length; i += 1) {
    var label = labels[i];
    if (isKnownConsultedLabel(label) && existing.indexOf(label) === -1) existing.push(label);
  }
  row.dataset.answerWorkSourceLabels = existing.join('|');
}

function titleizeWorkLogSlug(value) {
  return String(value || '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(function (part) {
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

function displayWorkLogScenarioNumber(value) {
  return String(value || '').replace(/^0+(\d)/, '$1');
}

function removeLeadingWorkLogArticle(value) {
  return String(value || '').replace(/^the\s+/i, '');
}

function humanizeWorkLogCardRef(ref) {
  var match = String(ref || '').match(/^card:[^/]+\/([^/]+)\/gloomhavensecretariat:([^/]+)\/(.+)$/);
  if (!match) return null;
  var type = match[1];
  var sourceKind = match[2];
  var path = match[3];
  var pathParts = path.split('/').filter(Boolean);
  if (pathParts.length === 0) return null;

  if (type === 'monster-stats' && sourceKind === 'monster-stat') {
    var nameParts = pathParts.slice(0, -1);
    var name = titleizeWorkLogSlug((nameParts.length > 0 ? nameParts : pathParts).join('-'));
    return 'the ' + name + ' stat card';
  }

  var lastPathPart = pathParts[pathParts.length - 1];
  var fallbackName = titleizeWorkLogSlug(lastPathPart || pathParts.join('-'));
  if (type === 'items') {
    return /^\d+$/.test(fallbackName)
      ? 'the item ' + fallbackName + ' card'
      : 'the ' + fallbackName + ' item card';
  }
  if (type === 'monster-abilities') return 'the ' + fallbackName + ' monster ability card';
  if (type === 'character-abilities') return 'the ' + fallbackName + ' ability card';
  if (type === 'buildings') return 'the ' + fallbackName + ' building card';
  return 'the ' + fallbackName + ' card';
}

function workLogSourceActionFromRef(ref) {
  var bareSection = String(ref || '').match(/^(?:section\s+)?(\d+(?:\.\d+)+)$/i);
  if (bareSection) {
    return {
      label: 'SECTION BOOK',
      detail: 'Looked up section ' + bareSection[1].trim() + ' in the section book',
    };
  }

  var bareScenario = String(ref || '').match(/^(?:scenario\s+)?(\d+)$/i);
  if (bareScenario) {
    return {
      label: 'SCENARIO BOOK',
      detail:
        'Looked up scenario ' +
        displayWorkLogScenarioNumber(bareScenario[1].trim()) +
        ' in the scenario book',
    };
  }

  var card = humanizeWorkLogCardRef(ref);
  if (card) return { label: 'CARD INDEX', detail: 'Checked ' + removeLeadingWorkLogArticle(card) };

  var scenario = String(ref || '').match(/^scenario:[^/]+\/(.+)$/);
  if (scenario) {
    return {
      label: 'SCENARIO BOOK',
      detail:
        'Looked up scenario ' +
        displayWorkLogScenarioNumber(scenario[1].trim()) +
        ' in the scenario book',
    };
  }

  var legacyScenario = String(ref || '').match(/^gloomhavensecretariat:scenario\/(.+)$/);
  if (legacyScenario) {
    return {
      label: 'SCENARIO BOOK',
      detail:
        'Looked up scenario ' +
        displayWorkLogScenarioNumber(legacyScenario[1].trim()) +
        ' in the scenario book',
    };
  }

  var section = String(ref || '').match(/^section:[^/]+\/(.+)$/);
  if (section) {
    return {
      label: 'SECTION BOOK',
      detail: 'Looked up section ' + section[1].trim() + ' in the section book',
    };
  }

  var rules = String(ref || '').match(/^rules:[^/]+\/(.+)#chunk=\d+$/);
  if (rules) {
    var source = rules[1].toLowerCase();
    if (source.indexOf('puzzle') !== -1) {
      return { label: 'PUZZLE BOOK', detail: 'Checked the puzzle book' };
    }
    if (source.indexOf('section') !== -1) {
      return { label: 'SECTION BOOK', detail: 'Checked the section book' };
    }
    if (source.indexOf('scenario') !== -1) {
      return { label: 'SCENARIO BOOK', detail: 'Checked the scenario book' };
    }
    return { label: 'RULEBOOK', detail: 'Checked the rulebook' };
  }

  return null;
}

function workLogSearchActionFromBookLabel(label) {
  var normalized = removeLeadingWorkLogArticle(
    String(label || '')
      .trim()
      .toLowerCase(),
  );
  if (normalized === 'rulebook') {
    return { label: 'RULEBOOK', detail: 'Searched the rulebook' };
  }
  if (normalized === 'puzzle book') {
    return { label: 'PUZZLE BOOK', detail: 'Searched the puzzle book' };
  }
  if (normalized === 'scenario book') {
    return { label: 'SCENARIO BOOK', detail: 'Searched the scenario book' };
  }
  if (normalized === 'section book') {
    return { label: 'SECTION BOOK', detail: 'Searched the section book' };
  }
  if (normalized === 'card index' || normalized === 'cards') {
    return { label: 'CARD INDEX', detail: 'Searched cards' };
  }
  return null;
}

function genericProgressDetail(message) {
  var checkingCard = message.match(/^Checking\s+the\s+(.+\s+card)$/i);
  if (checkingCard) return 'Checked ' + checkingCard[1].trim();

  var lookingUpSectionInBook = message.match(
    /^Looking up\s+section\s+(.+?)\s+in the section book$/i,
  );
  if (lookingUpSectionInBook) {
    return 'Looked up section ' + lookingUpSectionInBook[1].trim() + ' in the section book';
  }
  var lookingUpScenarioInBook = message.match(
    /^Looking up\s+scenario\s+(.+?)\s+in the scenario book$/i,
  );
  if (lookingUpScenarioInBook) {
    return (
      'Looked up scenario ' +
      displayWorkLogScenarioNumber(lookingUpScenarioInBook[1].trim()) +
      ' in the scenario book'
    );
  }
  if (/^Looking up\s+.+\s+in the rulebook$/i.test(message)) return 'Searched the rulebook';
  if (/^Looking up\s+.+\s+in the puzzle book$/i.test(message)) return 'Searched the puzzle book';
  if (/^Looking up\s+.+\s+in the scenario book$/i.test(message)) {
    return 'Searched the scenario book';
  }
  if (/^Looking up\s+.+\s+in the section book$/i.test(message)) {
    return 'Searched the section book';
  }

  var opening = message.match(/^Opening\s+(.+)$/i);
  if (opening) {
    var openedSource = workLogSourceActionFromRef(opening[1].trim());
    if (openedSource) return openedSource.detail;
  }
  var checkingLinks = message.match(/^Checking links from\s+(.+)$/i);
  if (checkingLinks) {
    var linkedSource = workLogSourceActionFromRef(checkingLinks[1].trim());
    if (linkedSource)
      return 'Followed links from ' + linkedSource.detail.replace(/^Checked\s+/, '');
  }
  var checking = message.match(/^Checking\s+(.+)$/i);
  if (checking) return 'Checked ' + checking[1].trim();
  var resolvingMonster = message.match(/^Resolving\s+(.+?)\s+monster(?:\s+stat(?:\s+card)?)?$/i);
  if (resolvingMonster) {
    return 'Checked ' + titleizeWorkLogSlug(resolvingMonster[1].trim()) + ' stat card';
  }
  var resolvingStats = message.match(/^Resolving\s+(.+?)\s+stats$/i);
  if (resolvingStats) {
    return 'Checked ' + titleizeWorkLogSlug(resolvingStats[1].trim()) + ' stat card';
  }
  var resolving = message.match(/^Resolving\s+(.+)$/i);
  if (resolving) return 'Looked up ' + resolving[1].trim();
  var searchingBook = message.match(/^Searching\s+(.+)$/i);
  if (searchingBook) {
    var searchAction = workLogSearchActionFromBookLabel(searchingBook[1]);
    if (searchAction) return searchAction.detail;
    if (searchingBook[1].indexOf(',') !== -1) return 'Searched available sources';
  }
  if (message === 'Searching selected sources') return 'Searched available sources';
  if (message === 'Searching knowledge') return 'Searched available sources';
  return message;
}

function activeProgressDetail(message) {
  var checked = String(message || '').match(/^Checked\s+(.+)$/i);
  if (checked) return 'Checking ' + checked[1].trim();
  var searched = String(message || '').match(/^Searched\s+(.+)$/i);
  if (searched) return 'Searching ' + searched[1].trim();
  var lookedUp = String(message || '').match(/^Looked up\s+(.+)$/i);
  if (lookedUp) return 'Looking up ' + lookedUp[1].trim();
  var followedLinks = String(message || '').match(/^Followed links from\s+(.+)$/i);
  if (followedLinks) return 'Following links from ' + followedLinks[1].trim();
  return message;
}

function answerWorkSourceActionFromProgress(detail, sourceLabel) {
  if (/^Checked .+ card$/i.test(detail) || detail === 'Searched cards') {
    return { label: 'CARD INDEX', detail: detail };
  }
  if (
    detail === 'Searched the rulebook' ||
    detail === 'Checked the rulebook' ||
    / in the rulebook$/i.test(detail)
  ) {
    return { label: 'RULEBOOK', detail: detail };
  }
  if (
    detail === 'Searched the puzzle book' ||
    detail === 'Checked the puzzle book' ||
    / in the puzzle book$/i.test(detail)
  ) {
    return { label: 'PUZZLE BOOK', detail: detail };
  }
  if (
    detail === 'Searched the scenario book' ||
    detail === 'Checked the scenario book' ||
    / in the scenario book$/i.test(detail)
  ) {
    return { label: 'SCENARIO BOOK', detail: detail };
  }
  if (
    detail === 'Searched the section book' ||
    detail === 'Checked the section book' ||
    / in the section book$/i.test(detail)
  ) {
    return { label: 'SECTION BOOK', detail: detail };
  }
  var sectionLookup = detail.match(/^Looked up\s+section\s+(.+)$/i);
  if (sectionLookup) {
    return {
      label: 'SECTION BOOK',
      detail: 'Looked up section ' + sectionLookup[1].trim() + ' in the section book',
    };
  }
  var scenarioLookup = detail.match(/^Looked up\s+scenario\s+(.+)$/i);
  if (scenarioLookup) {
    return {
      label: 'SCENARIO BOOK',
      detail:
        'Looked up scenario ' +
        displayWorkLogScenarioNumber(scenarioLookup[1].trim()) +
        ' in the scenario book',
    };
  }
  if (sourceLabel === 'RULEBOOK' && detail !== 'Searched available sources') {
    return { label: 'RULEBOOK', detail: detail + ' in the rulebook' };
  }
  if (sourceLabel === 'PUZZLE BOOK' && detail !== 'Searched available sources') {
    return { label: 'PUZZLE BOOK', detail: detail + ' in the puzzle book' };
  }
  if (sourceLabel === 'SCENARIO BOOK' && detail !== 'Searched available sources') {
    return { label: 'SCENARIO BOOK', detail: detail + ' in the scenario book' };
  }
  if (sourceLabel === 'SECTION BOOK' && detail !== 'Searched available sources') {
    return { label: 'SECTION BOOK', detail: detail + ' in the section book' };
  }
  return null;
}

function answerWorkPhysicalSourceLabel(label) {
  switch (label) {
    case 'RULEBOOK':
      return 'the rulebook';
    case 'PUZZLE BOOK':
      return 'the puzzle book';
    case 'CARD INDEX':
      return 'the cards';
    case 'SCENARIO BOOK':
      return 'the scenario book';
    case 'SECTION BOOK':
      return 'the section book';
    default:
      return sentenceSourceLabel(label);
  }
}

function answerWorkProgressRowId(rowId, detail) {
  var baseId = baseAnswerWorkId(rowId) || 'progress';
  var normalizedDetail = typeof detail === 'string' ? detail.toLowerCase() : '';
  if (
    normalizedDetail.indexOf('resolving ') === 0 ||
    normalizedDetail.indexOf('looked up ') === 0
  ) {
    return 'progress-resolving-' + answerWorkSlug(detail, 'event');
  }
  if (
    normalizedDetail === 'searching available sources' ||
    normalizedDetail === 'searched available sources'
  ) {
    return 'progress-searched-available-sources';
  }
  return baseId + '-progress-' + answerWorkSlug(detail, 'event');
}

function answerWorkProgressSort(detail) {
  var normalizedDetail = typeof detail === 'string' ? detail.toLowerCase() : '';
  if (normalizedDetail.indexOf('looked up ') === 0) return 10;
  if (normalizedDetail.indexOf('checked ') === 0 && normalizedDetail.indexOf(' card') !== -1) {
    return 10;
  }
  if (normalizedDetail.indexOf('resolving ') === 0) return 10;
  if (normalizedDetail === 'searched available sources') return 20;
  return 30;
}

function answerWorkPlanRowId(rowId, detail) {
  return 'plan-' + answerWorkSlug(rowId || detail, 'event');
}

function answerWorkPlanSort(detail) {
  var normalizedDetail = typeof detail === 'string' ? detail.toLowerCase() : '';
  if (
    normalizedDetail.indexOf("i'll look that up ") === 0 ||
    normalizedDetail.indexOf("i'll look up ") === 0 ||
    normalizedDetail.indexOf("i'm looking up ") === 0 ||
    normalizedDetail.indexOf("i'm checking ") === 0 ||
    normalizedDetail.indexOf(' stat card') !== -1
  ) {
    return 9;
  }
  if (
    normalizedDetail.indexOf('available sources') !== -1 ||
    normalizedDetail.indexOf(',') !== -1 ||
    normalizedDetail.indexOf(' and ') !== -1
  ) {
    return 20;
  }
  return 30;
}

function answerWorkRowMessage(label, detail, sourceLabel) {
  var source = answerWorkPhysicalSourceLabel(sourceLabel);
  var detailText = typeof detail === 'string' ? detail : '';
  if (label === 'CHECKED') return 'Checked ' + (detailText || source || 'source');
  if (label === "COULDN'T CHECK") {
    return "Couldn't check " + (detailText || source || 'source');
  }
  if (label === 'FOUND') {
    return 'Found ' + (detailText || 'source') + (source ? ' in ' + source : '');
  }
  if (detailText === 'Searched available sources' || detailText === 'Searching available sources')
    return detailText;
  if (source && detailText && detailText.toLowerCase().indexOf(source) === -1) {
    return detailText + ' in ' + source;
  }
  return detailText || 'Checking sources';
}

function sortAnswerWorkRows(rowsEl) {
  if (!rowsEl || !rowsEl.children || rowsEl.children.length < 2) return;
  var rows = Array.prototype.slice.call(rowsEl.children);
  rows.sort(function (a, b) {
    var aSort = Number.parseInt((a.dataset && a.dataset.answerWorkSort) || '50', 10);
    var bSort = Number.parseInt((b.dataset && b.dataset.answerWorkSort) || '50', 10);
    if (aSort !== bSort) return aSort - bSort;
    var aOrdinal = Number.parseInt((a.dataset && a.dataset.answerWorkOrdinal) || '0', 10);
    var bOrdinal = Number.parseInt((b.dataset && b.dataset.answerWorkOrdinal) || '0', 10);
    return aOrdinal - bOrdinal;
  });
  for (var i = 0; i < rows.length; i += 1) {
    rowsEl.appendChild(rows[i]);
  }
}

function setAnswerWorkRowOrder(elements, row, sort) {
  if (!row || !row.dataset) return;
  if (!row.dataset.answerWorkOrdinal) {
    var rowsEl = elements && elements.rowsEl;
    var nextOrdinal = rowsEl && rowsEl.dataset ? rowsEl.dataset.answerWorkNextOrdinal : '';
    var ordinal = Number.parseInt(nextOrdinal || '0', 10);
    row.dataset.answerWorkOrdinal = String(ordinal);
    if (rowsEl && rowsEl.dataset) rowsEl.dataset.answerWorkNextOrdinal = String(ordinal + 1);
  }
  row.dataset.answerWorkSort = String(sort == null ? 50 : sort);
  if (elements && elements.rowsEl) sortAnswerWorkRows(elements.rowsEl);
}

function completeAnswerWork(elements) {
  if (!elements || !elements.container) return;
  var rowCount = elements.rowsEl ? elements.rowsEl.children.length : 0;
  if (rowCount === 0) {
    elements.container.hidden = true;
    elements.container.open = false;
    elements.container.setAttribute('data-work-state', 'complete');
    clearAnswerWorkTimer(elements);
    if (elements.statusEl) elements.statusEl.textContent = 'Answered directly';
    return;
  }

  elements.container.hidden = false;
  elements.container.setAttribute('data-work-state', 'complete');
  syncAnswerWorkOpenState(elements.container);
  completeAnswerWorkTimer(elements);
}

function markAnswerWorkError(elements) {
  if (!elements || !elements.container) return;
  elements.container.hidden = false;
  elements.container.open = true;
  elements.container.setAttribute('data-work-state', 'error');
  clearAnswerWorkTimer(elements);
  if (elements.statusEl) elements.statusEl.textContent = 'Stopped before answer';
}

function ensureAnswerWorkRow(elements, entries, rowId) {
  var baseId = baseAnswerWorkId(rowId);
  if (!elements || !elements.rowsEl || !baseId) return null;
  var row = entries[baseId];
  if (row) return row;

  row = document.createElement('div');
  row.className = 'squire-answer-work__row';
  row.dataset.answerWorkId = baseId;

  var detailEl = document.createElement('span');
  detailEl.className = 'squire-answer-work__row-detail';
  row.appendChild(detailEl);

  entries[baseId] = row;
  elements.rowsEl.appendChild(row);
  return row;
}

function ensureAnswerWorkRowIcon(row) {
  if (!row || !row.querySelector) return;
  if (row.querySelector('.squire-answer-work__row-icon')) return;
  var detailEl = row.querySelector('.squire-answer-work__row-detail');
  var iconEl = document.createElement('span');
  iconEl.className = 'squire-answer-work__row-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  if (detailEl && typeof row.insertBefore === 'function') {
    row.insertBefore(iconEl, detailEl);
  } else {
    row.appendChild(iconEl);
  }
}

function removeAnswerWorkRowIcon(row) {
  if (!row || !row.querySelector) return;
  var iconEl = row.querySelector('.squire-answer-work__row-icon');
  if (iconEl && iconEl.parentNode && typeof iconEl.parentNode.removeChild === 'function') {
    iconEl.parentNode.removeChild(iconEl);
  }
}

function removeAnswerWorkRow(elements, entries, rowId) {
  var baseId = baseAnswerWorkId(rowId);
  if (!baseId || !entries || !entries[baseId]) return;
  var row = entries[baseId];
  if (row.parentNode && typeof row.parentNode.removeChild === 'function') {
    row.parentNode.removeChild(row);
  } else if (row.parentNode && row.parentNode.children) {
    var index = row.parentNode.children.indexOf(row);
    if (index !== -1) row.parentNode.children.splice(index, 1);
    row.parentNode = null;
  } else if (elements && elements.rowsEl && elements.rowsEl.children) {
    var fallbackIndex = elements.rowsEl.children.indexOf(row);
    if (fallbackIndex !== -1) elements.rowsEl.children.splice(fallbackIndex, 1);
  }
  delete entries[baseId];
}

function answerWorkSourceActionRowId(action) {
  return (
    'source-action-' +
    answerWorkSlug(action.label, 'source') +
    '-' +
    answerWorkSlug(action.detail, 'event')
  );
}

function answerWorkGenericLookupSubject(detail) {
  var match = String(detail || '').match(/^Look(?:ed|ing) up\s+(.+)$/i);
  if (!match || /\s+in the\s+/i.test(detail)) return '';
  return match[1].trim().toLowerCase();
}

function sourceActionSupersedesGenericLookup(action, lookup) {
  var subject = answerWorkGenericLookupSubject(lookup && lookup.detail);
  if (!subject) return false;
  return (
    String(action && action.detail)
      .toLowerCase()
      .indexOf(subject) !== -1
  );
}

function rememberGenericLookupRow(context, rowId, detail) {
  if (!context) return;
  if (!answerWorkGenericLookupSubject(detail)) return;
  context.genericLookupRows.push({ rowId: rowId, detail: detail });
}

function removeSupersededGenericLookupRows(elements, entries, context, action) {
  if (!context || !context.genericLookupRows.length) return;
  var remaining = [];
  for (var i = 0; i < context.genericLookupRows.length; i += 1) {
    var lookup = context.genericLookupRows[i];
    if (sourceActionSupersedesGenericLookup(action, lookup)) {
      removeAnswerWorkRow(elements, entries, lookup.rowId);
    } else {
      remaining.push(lookup);
    }
  }
  context.genericLookupRows = remaining;
}

function rememberArtifactRow(context, rowId, sourceLabel) {
  if (!context || !isKnownConsultedLabel(sourceLabel)) return;
  if (!context.artifactRowsByLabel[sourceLabel]) context.artifactRowsByLabel[sourceLabel] = [];
  context.artifactRowsByLabel[sourceLabel].push(rowId);
}

function removeArtifactRowsForSourceAction(elements, entries, context, action) {
  if (!context || !action || !context.artifactRowsByLabel[action.label]) return;
  var rows = context.artifactRowsByLabel[action.label];
  for (var i = 0; i < rows.length; i += 1) {
    removeAnswerWorkRow(elements, entries, rows[i]);
  }
  delete context.artifactRowsByLabel[action.label];
}

function renderAnswerWorkRow(elements, entries, rowId, label, detail, sourceLabel, state, sort) {
  var row = ensureAnswerWorkRow(elements, entries, rowId);
  if (!row) return;
  if (row.dataset && row.dataset.answerWorkFrozen === 'true') {
    if (state === 'complete' || state === 'error') {
      var frozenDetailEl = row.querySelector('.squire-answer-work__row-detail');
      row.dataset.workState = state;
      if (row.classList && typeof row.classList.remove === 'function') {
        row.classList.remove('squire-answer-work__row--narrative');
        row.classList.add('squire-answer-work__row--event');
        row.classList.remove('is-error');
        if (state === 'error') row.classList.add('is-error');
      }
      ensureAnswerWorkRowIcon(row);
      if (frozenDetailEl)
        frozenDetailEl.textContent = answerWorkRowMessage(label, detail, sourceLabel);
    }
    setAnswerWorkRowOrder(elements, row, sort);
    setAnswerWorkRunning(elements);
    return row;
  }
  rememberAnswerWorkSourceLabels(row, [sourceLabel]);

  row.dataset.workState = state || 'running';
  row.dataset.answerWorkFrozen = 'true';
  if (row.classList && typeof row.classList.remove === 'function') {
    row.classList.remove('squire-answer-work__row--narrative');
    row.classList.add('squire-answer-work__row--event');
  } else {
    row.className = row.className.replace(/\bsquire-answer-work__row--narrative\b/g, '').trim();
    if (row.className.indexOf('squire-answer-work__row--event') === -1) {
      row.className += ' squire-answer-work__row--event';
    }
  }
  ensureAnswerWorkRowIcon(row);
  row.classList.remove('is-error');
  if (state === 'error') row.classList.add('is-error');

  var detailEl = row.querySelector('.squire-answer-work__row-detail');

  if (detailEl) detailEl.textContent = answerWorkRowMessage(label, detail, sourceLabel);

  setAnswerWorkRowOrder(elements, row, sort);
  setAnswerWorkRunning(elements);
  return row;
}

function renderAnswerWorkNarrative(elements, entries, rowId, detail, sort) {
  var row = ensureAnswerWorkRow(elements, entries, rowId);
  if (!row) return null;
  if (row.classList && typeof row.classList.add === 'function') {
    row.classList.remove('squire-answer-work__row--event');
    row.classList.add('squire-answer-work__row--narrative');
  } else {
    row.className = row.className.replace(/\bsquire-answer-work__row--event\b/g, '').trim();
    if (row.className.indexOf('squire-answer-work__row--narrative') === -1) {
      row.className += ' squire-answer-work__row--narrative';
    }
  }
  row.dataset.workState = 'running';
  row.dataset.answerWorkFrozen = 'true';
  removeAnswerWorkRowIcon(row);
  var detailEl = row.querySelector('.squire-answer-work__row-detail');
  if (detailEl) detailEl.textContent = detail;
  setAnswerWorkRowOrder(elements, row, sort);
  setAnswerWorkRunning(elements);
  return row;
}

function rememberAnswerWorkSourceAction(elements, entries, context, action, sort, detail, state) {
  if (!action || !isKnownConsultedLabel(action.label)) return null;
  removeSupersededGenericLookupRows(elements, entries, context, action);
  removeArtifactRowsForSourceAction(elements, entries, context, action);
  if (context && context.checkedRowsByLabel[action.label]) {
    removeAnswerWorkRow(elements, entries, context.checkedRowsByLabel[action.label]);
    delete context.checkedRowsByLabel[action.label];
  }
  var rowId = answerWorkSourceActionRowId(action);
  var row = renderAnswerWorkRow(
    elements,
    entries,
    rowId,
    'SEARCHING',
    detail || action.detail,
    '',
    state || 'running',
    sort,
  );
  if (row) rememberAnswerWorkSourceLabels(row, [action.label]);
  if (context) context.sourceActionRowsByLabel[action.label] = rowId;
  return row;
}

function renderAnswerWorkResult(elements, entries, context, rowId, labels, ok, detail) {
  var sourceEntries = answerWorkSourceEntries(labels);
  var resultAction = detail
    ? answerWorkSourceActionFromProgress(genericProgressDetail(detail))
    : null;
  if (ok !== false && resultAction) {
    rememberAnswerWorkSourceAction(
      elements,
      entries,
      context,
      resultAction,
      answerWorkProgressSort(resultAction.detail),
      resultAction.detail,
      'complete',
    );
  }
  if (ok !== false && entries && entries['progress-searched-available-sources']) {
    var genericSearchRow = entries['progress-searched-available-sources'];
    var genericSearchDetailEl = genericSearchRow.querySelector
      ? genericSearchRow.querySelector('.squire-answer-work__row-detail')
      : null;
    if (genericSearchDetailEl) genericSearchDetailEl.textContent = 'Searched available sources';
    genericSearchRow.dataset.workState = 'complete';
  }
  if (sourceEntries.length === 0) {
    if (ok !== false) return;
    renderAnswerWorkRow(
      elements,
      entries,
      rowId,
      ok === false ? "COULDN'T CHECK" : 'CHECKED',
      'Source index',
      '',
      ok === false ? 'error' : 'running',
      ok === false ? 90 : 50,
    );
    return;
  }
  for (var i = 0; i < sourceEntries.length; i += 1) {
    var entry = sourceEntries[i];
    var checkedRowId = answerWorkCheckedSourceRowId(entry.label, ok, i);
    if (
      context &&
      context.checkedRowsByLabel[entry.label] &&
      context.checkedRowsByLabel[entry.label] !== checkedRowId
    ) {
      removeAnswerWorkRow(elements, entries, context.checkedRowsByLabel[entry.label]);
      delete context.checkedRowsByLabel[entry.label];
    }
    if (ok !== false && context && context.sourceActionRowsByLabel[entry.label]) {
      var actionRow = entries[baseAnswerWorkId(context.sourceActionRowsByLabel[entry.label])];
      if (actionRow) {
        var actionDetailEl = actionRow.querySelector
          ? actionRow.querySelector('.squire-answer-work__row-detail')
          : null;
        var completedDetail = actionDetailEl
          ? genericProgressDetail(actionDetailEl.textContent || '')
          : '';
        var completedAction = completedDetail
          ? answerWorkSourceActionFromProgress(completedDetail, entry.label)
          : null;
        if (completedAction) completedDetail = completedAction.detail;
        if (completedDetail && actionDetailEl) {
          actionDetailEl.textContent = completedDetail;
          actionRow.dataset.workState = 'complete';
        }
        rememberAnswerWorkSourceLabels(actionRow, [entry.label]);
      }
      delete context.checkedRowsByLabel[entry.label];
      continue;
    }
    var row = renderAnswerWorkRow(
      elements,
      entries,
      checkedRowId,
      ok === false ? "COULDN'T CHECK" : 'CHECKED',
      answerWorkPhysicalSourceLabel(entry.label),
      '',
      ok === false ? 'error' : 'running',
      ok === false ? 90 : 50,
    );
    if (context) context.checkedRowsByLabel[entry.label] = checkedRowId;
    if (ok !== false) rememberAnswerWorkSourceLabels(row, [entry.label]);
  }
}

function renderAnswerArtifact(artifactsEl, artifactEntries, payload) {
  if (!artifactsEl || !payload || payload.kind !== 'section-quote') return;
  if (!payload.id || !payload.title || !payload.body) return;

  var row = artifactEntries[payload.id];
  if (!row) {
    row = document.createElement('figure');
    row.className = 'squire-answer__artifact';
    row.dataset.artifactId = payload.id;

    var heading = document.createElement('figcaption');
    heading.className = 'squire-answer__artifact-title';
    row.appendChild(heading);

    var quote = document.createElement('blockquote');
    quote.className = 'squire-answer__artifact-body squire-markdown';
    row.appendChild(quote);

    artifactEntries[payload.id] = row;
    artifactsEl.appendChild(row);
  }

  var titleEl = row.querySelector('.squire-answer__artifact-title');
  if (titleEl) {
    titleEl.replaceChildren();
    var titleText = document.createElement('span');
    titleText.textContent = payload.title;
    titleEl.appendChild(titleText);
    if (payload.sourceLabel) {
      var sourceEl = document.createElement('span');
      sourceEl.className = 'squire-answer__artifact-source';
      sourceEl.textContent = payload.sourceLabel;
      titleEl.appendChild(sourceEl);
    }
  }

  var bodyEl = row.querySelector('.squire-answer__artifact-body');
  if (bodyEl) bodyEl.textContent = payload.body;
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

  // CodeRabbit (PR 274): if a different stream is already in flight, do
  // NOT close it just to start a new one — that strands the older
  // pending turn (its `done`/`error` will never reach the browser). The
  // multi-pending case (server-rendered transcript with several
  // unanswered user messages) is drained serially: when the active
  // stream finishes, `finishStream()` re-scans the DOM and attaches to
  // the next pending answer.
  if (activeStream) return;

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
  var answerWork = answerWorkElements(answerEl);
  var answerWorkEntries = {};
  var artifactsEl = answerEl.querySelector('.squire-answer__artifacts');
  var skeletonEl = answerEl.querySelector('.squire-answer__skeleton');
  resetAnswerWork(answerWork, answerWorkEntries);
  var preToolBuffer = '';
  var seenFirstDelta = false;
  var toolPhaseStarted = false;
  var artifactEntries = {};
  var answerWorkContext = {
    sourceActionRowsByLabel: {},
    checkedRowsByLabel: {},
    artifactRowsByLabel: {},
    genericLookupRows: [],
  };
  // Ordered-dedup set of provenance labels collected from tool-result
  // events during this turn. `Map` preserves insertion order, which we
  // use for the completed work-log source count and replay fallback.
  var consultedLabels = new Map();
  var source = new window.EventSource(streamUrl);

  activeStream = {
    url: streamUrl,
    source: source,
  };
  setActiveConversationHistoryStatus('running');

  function finishStream() {
    if (activeStream && activeStream.source === source) {
      activeStream = null;
    }
    source.close();
    // CodeRabbit (PR 274): drain the multi-pending queue. If the DOM
    // has another unattached pending answer (e.g. a server-rendered
    // transcript with multiple unanswered user messages — the case
    // `pairConversationTurns` was added to defend against), attach to
    // it now. Only re-enable the input dock when no pending remains —
    // otherwise the next turn's pending skeleton would be undefended
    // against a fast user submitting a third turn before the chain
    // completes.
    var nextPending = findActivePendingAnswer(document);
    if (nextPending) {
      attachPendingAnswerStream(nextPending);
    } else {
      setFormPendingState(document.querySelector('.squire-input-dock'), false);
    }
  }

  function materializeStreamingDelta(delta) {
    if (!seenFirstDelta) {
      seenFirstDelta = true;
      answerEl.setAttribute('data-stream-state', 'streaming');
      if (skeletonEl) skeletonEl.hidden = true;
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
  source.addEventListener('tool-start', function () {
    if (seenFirstDelta) {
      return;
    }
    preToolBuffer = '';
    toolPhaseStarted = true;
    setAnswerWorkRunning(answerWork);
  });

  source.addEventListener('tool-plan', function (event) {
    var payload = JSON.parse(event.data || '{}');
    if (!payload.message) return;
    if (seenFirstDelta) {
      return;
    }
    preToolBuffer = '';
    toolPhaseStarted = true;
    renderAnswerWorkNarrative(
      answerWork,
      answerWorkEntries,
      answerWorkPlanRowId(payload.id, payload.message),
      payload.message,
      answerWorkPlanSort(payload.message),
    );
  });

  source.addEventListener('tool-progress', function (event) {
    var payload = JSON.parse(event.data || '{}');
    if (!payload.message) return;
    if (seenFirstDelta) {
      return;
    }
    preToolBuffer = '';
    toolPhaseStarted = true;
    var detail = genericProgressDetail(payload.message);
    var activeDetail = activeProgressDetail(detail);
    var sourceAction = answerWorkSourceActionFromProgress(detail, payload.label);
    if (sourceAction) {
      rememberAnswerWorkSourceAction(
        answerWork,
        answerWorkEntries,
        answerWorkContext,
        sourceAction,
        answerWorkProgressSort(detail),
        activeDetail,
        'running',
      );
    } else {
      renderAnswerWorkRow(
        answerWork,
        answerWorkEntries,
        answerWorkProgressRowId(payload.id, detail),
        'SEARCHING',
        activeDetail,
        payload.label,
        'running',
        answerWorkProgressSort(detail),
      );
      rememberGenericLookupRow(
        answerWorkContext,
        answerWorkProgressRowId(payload.id, detail),
        activeDetail,
      );
    }
  });

  source.addEventListener('tool-result', function (event) {
    var payload = JSON.parse(event.data || '{}');
    // SQR-98: once the answer text has started streaming, any subsequent
    // tool events are late-arriving stragglers (agent loop finishing
    // up), not actual sources for this answer. Ignore them both for the
    // work-log row AND for the source-label accumulator — otherwise the
    // answer would show stale labels that weren't really checked for the
    // answer the user is reading. CodeRabbit caught the accumulator leak
    // on 2026-04-21.
    if (seenFirstDelta) {
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
    renderAnswerWorkResult(
      answerWork,
      answerWorkEntries,
      answerWorkContext,
      payload.id,
      resultLabels,
      payload.ok,
      payload.message,
    );
  });

  source.addEventListener('answer-artifact', function (event) {
    if (!artifactsEl || seenFirstDelta) return;
    var payload = JSON.parse(event.data || '{}');
    if (!payload.id || payload.kind !== 'section-quote' || !payload.title || !payload.body) return;
    preToolBuffer = '';
    toolPhaseStarted = true;
    if (!answerWorkContext.sourceActionRowsByLabel[payload.sourceLabel]) {
      renderAnswerWorkRow(
        answerWork,
        answerWorkEntries,
        payload.id,
        'FOUND',
        payload.title,
        payload.sourceLabel,
        'running',
        40,
      );
      rememberArtifactRow(answerWorkContext, payload.id, payload.sourceLabel);
    }
    renderAnswerArtifact(artifactsEl, artifactEntries, payload);
    if (skeletonEl) skeletonEl.hidden = true;
    if (pinToBottom) scrollToBottom();
  });

  source.addEventListener('done', function (event) {
    answerEl.classList.remove('squire-answer--pending');
    answerEl.setAttribute('data-stream-state', 'done');
    if (skeletonEl) skeletonEl.hidden = true;
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
    setActiveConversationHistoryStatus('idle');
    // CodeRabbit (PR 274): drain the multi-pending queue. If the
    // server-rendered transcript had several unanswered user messages,
    // attach to the next pending now instead of re-enabling the dock —
    // otherwise a fast user could submit a third turn before the chain
    // completes. attachPendingAnswerStream sets the form to pending
    // again on its own.
    var nextPending = findActivePendingAnswer(document);
    if (nextPending) {
      attachPendingAnswerStream(nextPending);
    } else {
      setFormPendingState(document.querySelector('.squire-input-dock'), false);
    }

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
      // Replay fallback: if the stream completed without emitting any
      // tool_result events (e.g., duplicate /stream hit that hit the
      // idempotent already-persisted path), the server now includes the
      // row's persisted consultedSources in the done payload so we can
      // still rebuild the work log. Live-stream labels take precedence — if
      // consultedLabels has entries, they came from this actual turn.
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
        if (
          labels.length > 0 &&
          answerWork &&
          answerWork.rowsEl &&
          answerWork.rowsEl.children.length === 0
        ) {
          renderAnswerWorkResult(
            answerWork,
            answerWorkEntries,
            answerWorkContext,
            'persisted-sources',
            labels,
            true,
          );
        }
      }
      completeAnswerWork(answerWork);
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
    setActiveConversationHistoryStatus('error');
    markAnswerWorkError(answerWork);
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
  if (event.detail && event.detail.parameters) {
    event.detail.parameters.game = activeGame;
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
  syncActiveGameControls();

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
  } else if (!activeStream) {
    // No pending stream after this swap (e.g., a non-chat swap) AND
    // nothing is currently streaming. Re-enable the form so the user
    // can submit again. CodeRabbit (PR 274): the `!activeStream` guard
    // matters because `findActivePendingAnswer()` intentionally skips
    // the currently attached stream's URL; an unrelated swap during
    // streaming would otherwise fall into this branch and re-enable
    // the form before `done`/`error` fires, reopening the
    // concurrent-submit race.
    setFormPendingState(form, false);
  }
});

document.addEventListener('DOMContentLoaded', function () {
  syncChatFormAction();
  syncActiveGameControls();
  // SQR-108 / ADR 0012 D-2: the browser preserves last scroll natively on
  // back/forward navigation and refresh, so we don't pin or auto-scroll on
  // initial load. We only flag pin on submit (above) and re-evaluate it
  // from the current scroll position on the user's first scroll event.
  pinToBottom = isNearBottom();
  attachPendingAnswerStream(findActivePendingAnswer(document));
});
