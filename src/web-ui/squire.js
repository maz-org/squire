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
var PROGRESS_VISIBILITY_STORAGE_KEY = 'squire.progressVisibility';
var DEFAULT_PROGRESS_VISIBILITY = 'normal';
var fallbackSupportedActiveGames = {
  frosthaven: true,
  'gloomhaven-2e': true,
};
var defaultActiveGame = FALLBACK_DEFAULT_ACTIVE_GAME;
var supportedActiveGames = fallbackSupportedActiveGames;
var activeGame = defaultActiveGame;
var activeGameInitialized = false;
var progressVisibility = DEFAULT_PROGRESS_VISIBILITY;
var progressVisibilityInitialized = false;
var supportedProgressVisibility = {
  compact: true,
  normal: true,
  expanded: true,
};

function isSupportedActiveGame(value) {
  return (
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(supportedActiveGames, value)
  );
}

function isSupportedProgressVisibility(value) {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(supportedProgressVisibility, value)
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

function readStoredProgressVisibility() {
  try {
    var stored =
      window.localStorage && window.localStorage.getItem(PROGRESS_VISIBILITY_STORAGE_KEY);
    return isSupportedProgressVisibility(stored) ? stored : DEFAULT_PROGRESS_VISIBILITY;
  } catch {
    return DEFAULT_PROGRESS_VISIBILITY;
  }
}

function persistProgressVisibility(value) {
  try {
    if (window.localStorage) window.localStorage.setItem(PROGRESS_VISIBILITY_STORAGE_KEY, value);
  } catch {
    // Storage can be blocked in private browsing; keep the in-page setting.
  }
}

function setDocumentProgressVisibility(value) {
  if (!document.documentElement) return;
  if (typeof document.documentElement.setAttribute === 'function') {
    document.documentElement.setAttribute('data-progress-visibility', value);
    return;
  }
  if (document.documentElement.dataset) {
    document.documentElement.dataset.progressVisibility = value;
  }
}

function preferredAnswerWorkOpen(container) {
  var state = container && container.getAttribute ? container.getAttribute('data-work-state') : '';
  if (state === 'error') return true;
  if (progressVisibility === 'expanded') return true;
  if (progressVisibility === 'compact') return false;
  return state === 'running' || state === 'idle';
}

function syncAnswerWorkOpenState(container) {
  if (!container || container.hidden) return;
  container.open = preferredAnswerWorkOpen(container);
}

function syncAnswerWorkOpenStates() {
  var workLogs = document.querySelectorAll ? document.querySelectorAll('.squire-answer-work') : [];
  for (var i = 0; i < workLogs.length; i += 1) {
    syncAnswerWorkOpenState(workLogs[i]);
  }
}

function syncProgressVisibilityControls() {
  if (!progressVisibilityInitialized) {
    progressVisibility = readStoredProgressVisibility();
    progressVisibilityInitialized = true;
  }
  if (!isSupportedProgressVisibility(progressVisibility)) {
    progressVisibility = DEFAULT_PROGRESS_VISIBILITY;
  }
  setDocumentProgressVisibility(progressVisibility);

  var controls = document.querySelectorAll
    ? document.querySelectorAll('[data-progress-visibility-choice]')
    : [];
  for (var i = 0; i < controls.length; i += 1) {
    var control = controls[i];
    var selected =
      control.dataset && control.dataset.progressVisibilityChoice === progressVisibility;
    control.setAttribute('aria-pressed', selected ? 'true' : 'false');
  }
  syncAnswerWorkOpenStates();
}

function setProgressVisibility(value, persist) {
  progressVisibility = isSupportedProgressVisibility(value) ? value : DEFAULT_PROGRESS_VISIBILITY;
  if (persist) persistProgressVisibility(progressVisibility);
  syncProgressVisibilityControls();
}

document.addEventListener('click', function (e) {
  var t = e.target;
  var progressChoice = t && t.closest ? t.closest('[data-progress-visibility-choice]') : null;
  if (progressChoice && progressChoice.dataset) {
    e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
    setProgressVisibility(progressChoice.dataset.progressVisibilityChoice, true);
    return;
  }

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
    titleEl: container.querySelector('.squire-answer-work__title'),
  };
}

function resetAnswerWork(elements, entries) {
  if (!elements || !elements.container) return;
  if (elements.rowsEl) elements.rowsEl.replaceChildren();
  if (entries) {
    for (var id in entries) {
      delete entries[id];
    }
  }
  elements.container.hidden = false;
  elements.container.setAttribute('data-work-state', 'running');
  syncAnswerWorkOpenState(elements.container);
  if (elements.titleEl) elements.titleEl.textContent = 'Working';
  if (elements.statusEl) elements.statusEl.textContent = 'Working';
}

function setAnswerWorkRunning(elements) {
  if (!elements || !elements.container) return;
  elements.container.hidden = false;
  elements.container.setAttribute('data-work-state', 'running');
  if (progressVisibility !== 'compact') {
    elements.container.open = true;
  }
  if (elements.titleEl) elements.titleEl.textContent = 'Working';
  if (elements.statusEl) elements.statusEl.textContent = 'Checking sources';
}

function baseAnswerWorkId(rowId) {
  return typeof rowId === 'string' ? rowId.replace(/-progress-\d+$/, '') : rowId;
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

function answerWorkSourceRowId(rowId, label, index) {
  var suffix =
    typeof label === 'string'
      ? label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
      : String(index);
  return baseAnswerWorkId(rowId) + '-source-' + suffix;
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

function genericProgressDetail(message) {
  if (message === 'Searching selected sources') return 'Source index';
  if (message === 'Searching knowledge') return 'Knowledge index';
  return message;
}

function inferredAnswerWorkSourceCount(elements) {
  if (!elements.rowsEl || !elements.rowsEl.children) return 0;
  var labels = new Map();
  for (var i = 0; i < elements.rowsEl.children.length; i += 1) {
    var row = elements.rowsEl.children[i];
    var rowLabels =
      row.dataset && row.dataset.answerWorkSourceLabels
        ? row.dataset.answerWorkSourceLabels.split('|').filter(Boolean)
        : [];
    for (var rowLabelIndex = 0; rowLabelIndex < rowLabels.length; rowLabelIndex += 1) {
      var rowLabel = rowLabels[rowLabelIndex];
      if (isKnownConsultedLabel(rowLabel) && !labels.has(rowLabel)) labels.set(rowLabel, true);
    }
    var detailEl = row.querySelector ? row.querySelector('.squire-answer-work__row-detail') : null;
    var sourceEl = row.querySelector ? row.querySelector('.squire-answer-work__row-source') : null;
    var candidates = [detailEl ? detailEl.textContent : '', sourceEl ? sourceEl.textContent : ''];
    for (var j = 0; j < candidates.length; j += 1) {
      var label = candidates[j];
      if (isKnownConsultedLabel(label) && !labels.has(label)) labels.set(label, true);
    }
  }
  return labels.size;
}

function completeAnswerWork(elements, sourceCount) {
  if (!elements || !elements.container) return;
  var rowCount = elements.rowsEl ? elements.rowsEl.children.length : 0;
  if (rowCount === 0) {
    elements.container.hidden = true;
    elements.container.open = false;
    elements.container.setAttribute('data-work-state', 'complete');
    if (elements.statusEl) elements.statusEl.textContent = 'Answered directly';
    return;
  }

  elements.container.hidden = false;
  elements.container.setAttribute('data-work-state', 'complete');
  syncAnswerWorkOpenState(elements.container);
  if (elements.titleEl) elements.titleEl.textContent = 'Work log';
  if (elements.statusEl) {
    var effectiveSourceCount =
      sourceCount > 0 ? sourceCount : inferredAnswerWorkSourceCount(elements);
    if (effectiveSourceCount > 0) {
      elements.statusEl.textContent =
        'Checked ' +
        effectiveSourceCount +
        ' ' +
        (effectiveSourceCount === 1 ? 'source' : 'sources');
    } else {
      elements.statusEl.textContent =
        'Recorded ' + rowCount + ' ' + (rowCount === 1 ? 'step' : 'steps');
    }
  }
}

function markAnswerWorkError(elements) {
  if (!elements || !elements.container) return;
  elements.container.hidden = false;
  elements.container.open = true;
  elements.container.setAttribute('data-work-state', 'error');
  if (elements.titleEl) elements.titleEl.textContent = 'Work log';
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

  var labelEl = document.createElement('span');
  labelEl.className = 'squire-answer-work__row-label';
  row.appendChild(labelEl);

  var detailEl = document.createElement('span');
  detailEl.className = 'squire-answer-work__row-detail';
  row.appendChild(detailEl);

  var sourceEl = document.createElement('span');
  sourceEl.className = 'squire-answer-work__row-source';
  row.appendChild(sourceEl);

  entries[baseId] = row;
  elements.rowsEl.appendChild(row);
  return row;
}

function renderAnswerWorkRow(elements, entries, rowId, label, detail, sourceLabel, state) {
  var row = ensureAnswerWorkRow(elements, entries, rowId);
  if (!row) return;
  rememberAnswerWorkSourceLabels(row, [sourceLabel]);

  row.dataset.workState = state || 'running';
  row.classList.remove('is-error');
  if (state === 'error') row.classList.add('is-error');

  var labelEl = row.querySelector('.squire-answer-work__row-label');
  var detailEl = row.querySelector('.squire-answer-work__row-detail');
  var sourceEl = row.querySelector('.squire-answer-work__row-source');

  if (labelEl) labelEl.textContent = label || 'CHECKING';
  if (detailEl) detailEl.textContent = detail || 'Source index';
  if (sourceEl) sourceEl.textContent = displaySourceLabel(sourceLabel);

  setAnswerWorkRunning(elements);
  return row;
}

function renderAnswerWorkResult(elements, entries, rowId, labels, ok) {
  var sourceEntries = answerWorkSourceEntries(labels);
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
    );
    return;
  }
  for (var i = 0; i < sourceEntries.length; i += 1) {
    var entry = sourceEntries[i];
    var row = renderAnswerWorkRow(
      elements,
      entries,
      i === 0 ? rowId : answerWorkSourceRowId(rowId, entry.label, i),
      ok === false ? "COULDN'T CHECK" : 'CHECKED',
      entry.display,
      '',
      ok === false ? 'error' : 'running',
    );
    rememberAnswerWorkSourceLabels(row, [entry.label]);
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
  source.addEventListener('tool-start', function (event) {
    if (seenFirstDelta) {
      return;
    }
    var payload = JSON.parse(event.data || '{}');
    preToolBuffer = '';
    toolPhaseStarted = true;
    if (payload.label === 'REFERENCE') return;
    renderAnswerWorkRow(
      answerWork,
      answerWorkEntries,
      payload.id,
      'CHECKING',
      displaySourceLabel(payload.label) || 'Source index',
      '',
      'running',
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
    renderAnswerWorkRow(
      answerWork,
      answerWorkEntries,
      payload.id,
      'SEARCHING',
      genericProgressDetail(payload.message),
      payload.label,
      'running',
    );
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
    renderAnswerWorkResult(answerWork, answerWorkEntries, payload.id, resultLabels, payload.ok);
  });

  source.addEventListener('answer-artifact', function (event) {
    if (!artifactsEl || seenFirstDelta) return;
    var payload = JSON.parse(event.data || '{}');
    if (!payload.id || payload.kind !== 'section-quote' || !payload.title || !payload.body) return;
    preToolBuffer = '';
    toolPhaseStarted = true;
    renderAnswerWorkRow(
      answerWork,
      answerWorkEntries,
      payload.id,
      'FOUND',
      payload.title,
      payload.sourceLabel,
      'running',
    );
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
          renderAnswerWorkResult(answerWork, answerWorkEntries, 'persisted-sources', labels, true);
        }
      }
      completeAnswerWork(answerWork, labels.length);
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
  syncProgressVisibilityControls();

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
  syncProgressVisibilityControls();
  // SQR-108 / ADR 0012 D-2: the browser preserves last scroll natively on
  // back/forward navigation and refresh, so we don't pin or auto-scroll on
  // initial load. We only flag pin on submit (above) and re-evaluate it
  // from the current scroll position on the user's first scroll event.
  pinToBottom = isNearBottom();
  attachPendingAnswerStream(findActivePendingAnswer(document));
});
