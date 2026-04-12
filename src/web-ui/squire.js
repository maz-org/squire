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
  var toolEntries = {};
  var seenFirstDelta = false;
  var source = new window.EventSource(streamUrl);

  activeStream = {
    url: streamUrl,
    source: source,
  };

  function finishStream() {
    if (activeStream && activeStream.source === source) {
      activeStream = null;
    }
    source.close();
  }

  source.addEventListener('text-delta', function (event) {
    var payload = JSON.parse(event.data || '{}');
    if (!seenFirstDelta) {
      seenFirstDelta = true;
      answerEl.setAttribute('data-stream-state', 'streaming');
      if (skeletonEl) skeletonEl.hidden = true;
    }

    if (!contentEl) return;
    contentEl.classList.add('squire-markdown');
    var paragraph = ensureAnswerParagraph(contentEl);
    paragraph.textContent += payload.delta || '';
  });

  source.addEventListener('tool-start', function (event) {
    if (!toolsEl) return;
    var payload = JSON.parse(event.data || '{}');
    var existing = toolEntries[payload.id];
    if (existing) return;
    var row = document.createElement('div');
    row.className = 'squire-answer__tool';
    row.dataset.toolId = payload.id;
    row.textContent = payload.label + '...';
    toolEntries[payload.id] = row;
    toolsEl.appendChild(row);
  });

  source.addEventListener('tool-result', function (event) {
    if (!toolsEl) return;
    var payload = JSON.parse(event.data || '{}');
    var row = toolEntries[payload.id];
    if (!row) {
      row = document.createElement('div');
      row.className = 'squire-answer__tool';
      row.dataset.toolId = payload.id;
      toolsEl.appendChild(row);
      toolEntries[payload.id] = row;
    }
    row.classList.add(payload.ok ? 'is-complete' : 'is-error');
    row.textContent = payload.label + (payload.ok ? ' done' : ' failed');
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
