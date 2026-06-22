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
var browserTelemetryConfig = null;
var lastBrowserTelemetryEventId = null;
var BUG_REPORT_SCREENSHOT_MAX_BYTES = 1500000;
var DASHBOARD_TOAST_TIMEOUT_MS = 4000;
var dashboardToastTimer = null;

var MASKED_REPLAY_MASK_SELECTORS = [
  '.squire-transcript',
  '.squire-question',
  '.squire-answer',
  '.squire-answer__content',
  '.squire-answer__artifacts',
  '.squire-answer-work',
  '.squire-input-dock',
  '.squire-input-dock textarea',
  '.squire-history-row',
  '.squire-campaign-strip',
  '.squire-campaign-dashboard',
  '.squire-character-sheet',
];
var MASKED_REPLAY_BLOCK_SELECTORS = [
  '.squire-account-menu',
  '.squire-account-menu__panel',
  '.squire-account-menu__avatar',
];
var ALLOWED_BROWSER_FEEDBACK_KINDS = {
  wrong_answer: true,
  stream_failed: true,
  ui_broken: true,
  source_problem: true,
  other: true,
};
var ALLOWED_BUG_REPORT_KINDS = {
  bad_answer: true,
  broken_stream: true,
  visual_issue: true,
  wrong_source: true,
  other: true,
};
var BUG_REPORT_FEEDBACK_KIND = {
  bad_answer: 'wrong_answer',
  broken_stream: 'stream_failed',
  visual_issue: 'ui_broken',
  wrong_source: 'source_problem',
  other: 'other',
};

function safePathOnly(raw) {
  if (typeof raw !== 'string') return null;
  var value = raw.trim();
  if (!value) return null;
  var withoutHash = value.split('#')[0];
  var withoutQuery = withoutHash.split('?')[0];
  if (withoutQuery.charAt(0) === '/') return withoutQuery || '/';

  var absoluteMatch = withoutQuery.match(/^https?:\/\/[^/]+(\/.*)?$/i);
  if (absoluteMatch) return absoluteMatch[1] || '/';
  return null;
}

function readBrowserTelemetryConfig() {
  if (browserTelemetryConfig) return browserTelemetryConfig;

  browserTelemetryConfig = { enabled: false, endpoint: null };
  if (!document.querySelector) return browserTelemetryConfig;

  var meta = document.querySelector('meta[name="squire-browser-telemetry"]');
  var content = meta && meta.getAttribute ? meta.getAttribute('content') : null;
  if (!content) return browserTelemetryConfig;

  try {
    var parsed = JSON.parse(content);
    if (
      parsed &&
      parsed.enabled === true &&
      typeof parsed.endpoint === 'string' &&
      parsed.endpoint.charAt(0) === '/'
    ) {
      browserTelemetryConfig = { enabled: true, endpoint: parsed.endpoint };
    }
  } catch {
    browserTelemetryConfig = { enabled: false, endpoint: null };
  }

  return browserTelemetryConfig;
}

function currentRoutePath() {
  var pathname =
    window.location && typeof window.location.pathname === 'string'
      ? window.location.pathname
      : '/';
  return safePathOnly(pathname) || '/';
}

function conversationIdFromPath(path) {
  var match = path && path.match(/^\/chat\/([^/]+)$/);
  return match ? match[1] : null;
}

function streamIdsFromUrl(streamUrl) {
  var path = safePathOnly(streamUrl);
  var match = path && path.match(/^\/chat\/([^/]+)\/messages\/([^/]+)\/stream$/);
  return match ? { conversationId: match[1], userMessageId: match[2] } : {};
}

function telemetryToken(value, fallback) {
  if (typeof value !== 'string') return fallback;
  var trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 128) || fallback;
}

function errorNameFromValue(value, fallback) {
  if (value && typeof value === 'object' && typeof value.name === 'string') {
    return telemetryToken(value.name, fallback);
  }
  return fallback;
}

function reasonTypeFromValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'Array';
  if (value && typeof value === 'object' && typeof value.name === 'string') {
    return telemetryToken(value.name, 'object');
  }
  return typeof value;
}

function positiveTelemetryNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function telemetryNowMs() {
  return Date.now();
}

function elapsedTelemetryMs(startedAt) {
  // Preserve zero for immediate events; dashboards can distinguish it from an
  // omitted field, which means timing was not captured.
  return positiveTelemetryNumber(telemetryNowMs() - startedAt) || 0;
}

function viewportTelemetry() {
  var width = positiveTelemetryNumber(window.innerWidth);
  var height = positiveTelemetryNumber(window.innerHeight);
  return width && height ? { width: width, height: height } : null;
}

function userAgentTelemetry() {
  var navigatorLike = window.navigator;
  if (!navigatorLike || typeof navigatorLike.userAgent !== 'string') return null;
  return navigatorLike.userAgent.slice(0, 512);
}

function boundedSelectorCount(selector) {
  if (!document.querySelectorAll) return 0;
  try {
    var nodes = document.querySelectorAll(selector);
    return Math.min(1000, positiveTelemetryNumber(nodes.length) || 0);
  } catch {
    return 0;
  }
}

function inputValueLengthBucket() {
  var input = document.querySelector ? document.querySelector('.squire-input-dock textarea') : null;
  var value = input && typeof input.value === 'string' ? input.value : '';
  var length = value.length;
  if (length === 0) return '0';
  if (length <= 80) return '1-80';
  if (length <= 240) return '81-240';
  return '241+';
}

function activeHistoryStatus() {
  var row = document.querySelector ? document.querySelector('.squire-history-row.is-active') : null;
  var value = row && row.getAttribute ? row.getAttribute('data-history-status') : null;
  if (value === 'idle' || value === 'running' || value === 'error') return value;
  return 'unknown';
}

function maskedReplaySnapshotId() {
  var cryptoLike = window.crypto;
  if (cryptoLike && typeof cryptoLike.randomUUID === 'function') {
    return telemetryToken(cryptoLike.randomUUID(), 'masked-replay-snapshot');
  }
  return 'masked-replay-snapshot';
}

function buildMaskedReplaySnapshot() {
  // This is intentionally structural, not DOM/text capture. Sentry gets enough
  // shape to debug layout and stream state without transcript, prompt, or input text.
  return {
    version: 1,
    textMasked: true,
    attributesMasked: true,
    snapshotId: maskedReplaySnapshotId(),
    maskSelectors: MASKED_REPLAY_MASK_SELECTORS.slice(),
    blockSelectors: MASKED_REPLAY_BLOCK_SELECTORS.slice(),
    turns: {
      userTurnCount: boundedSelectorCount('.squire-question'),
      assistantTurnCount: boundedSelectorCount('.squire-answer'),
      pendingTurnCount: boundedSelectorCount('.squire-answer--pending'),
      workLogCount: boundedSelectorCount('.squire-answer-work'),
      errorBannerCount: boundedSelectorCount('.squire-banner--error'),
    },
    input: {
      present: Boolean(
        document.querySelector && document.querySelector('.squire-input-dock textarea'),
      ),
      valueLengthBucket: inputValueLengthBucket(),
    },
    history: {
      rowCount: boundedSelectorCount('.squire-history-row'),
      activeStatus: activeHistoryStatus(),
    },
  };
}

function sentryEventId(value) {
  if (typeof value !== 'string') return null;
  var trimmed = value.trim();
  return /^[a-f0-9]{32}$/i.test(trimmed) ? trimmed : null;
}

function browserFeedbackKind(value) {
  if (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(ALLOWED_BROWSER_FEEDBACK_KINDS, value)
  ) {
    return value;
  }
  return 'other';
}

function bugReportKind(value) {
  if (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(ALLOWED_BUG_REPORT_KINDS, value)
  ) {
    return value;
  }
  return 'other';
}

function rememberBrowserTelemetryEventId(response, rememberEventId) {
  if (!response || typeof response.json !== 'function') return null;
  try {
    var parsed = response.json();
    if (!parsed || typeof parsed.then !== 'function') return null;
    return parsed
      .then(function (body) {
        var eventId = sentryEventId(body && body.eventId);
        if (eventId && rememberEventId) lastBrowserTelemetryEventId = eventId;
        return eventId;
      })
      .catch(function () {
        return null;
      });
  } catch {
    return null;
  }
}

function assignTelemetryValue(target, key, value) {
  if (typeof value === 'string') {
    var trimmed = value.trim();
    if (trimmed) target[key] = trimmed;
    return;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    target[key] = value;
    return;
  }
  if (value && typeof value === 'object') {
    target[key] = value;
  }
}

function sendBrowserTelemetry(type, details) {
  var config = readBrowserTelemetryConfig();
  if (!config.enabled || !config.endpoint) return;

  var route = currentRoutePath();
  var payload = {
    type: type,
    route: route,
  };
  var routeConversationId = conversationIdFromPath(route);
  if (routeConversationId) payload.conversationId = routeConversationId;

  if (details && details.streamUrl) {
    var streamIds = streamIdsFromUrl(details.streamUrl);
    if (streamIds.conversationId) payload.conversationId = streamIds.conversationId;
    if (streamIds.userMessageId) payload.userMessageId = streamIds.userMessageId;
  }

  var viewport = viewportTelemetry();
  if (viewport) payload.viewport = viewport;
  var userAgent = userAgentTelemetry();
  if (userAgent) payload.userAgent = userAgent;

  if (details) {
    assignTelemetryValue(payload, 'errorName', details.errorName);
    assignTelemetryValue(payload, 'reasonType', details.reasonType);
    assignTelemetryValue(payload, 'source', details.source);
    assignTelemetryValue(payload, 'line', details.line);
    assignTelemetryValue(payload, 'column', details.column);
    assignTelemetryValue(payload, 'streamErrorKind', details.streamErrorKind);
    assignTelemetryValue(payload, 'streamReadyState', details.streamReadyState);
    assignTelemetryValue(payload, 'streamDurationMs', details.streamDurationMs);
    assignTelemetryValue(payload, 'streamFirstEventMs', details.streamFirstEventMs);
    assignTelemetryValue(payload, 'streamEventCount', details.streamEventCount);
    assignTelemetryValue(payload, 'streamTextEventCount', details.streamTextEventCount);
    assignTelemetryValue(payload, 'streamToolEventCount', details.streamToolEventCount);
    assignTelemetryValue(payload, 'htmxEvent', details.htmxEvent);
    assignTelemetryValue(payload, 'htmxStatus', details.htmxStatus);
    assignTelemetryValue(payload, 'feedbackKind', details.feedbackKind);
    assignTelemetryValue(payload, 'associatedEventId', details.associatedEventId);
  }
  if (!details || details.includeMaskedReplay !== false) {
    payload.maskedReplay = buildMaskedReplaySnapshot();
  }

  var fetchFn = window.fetch;
  if (typeof fetchFn !== 'function') return;

  try {
    var rememberEventId = !details || details.rememberEventId !== false;
    var result = fetchFn.call(window, config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    if (result && typeof result.then === 'function') {
      var handled = result.then(function (response) {
        return rememberBrowserTelemetryEventId(response, rememberEventId);
      });
      if (handled && typeof handled.catch === 'function') handled.catch(function () {});
      return handled;
    }
    if (result && typeof result.catch === 'function') result.catch(function () {});
    return result;
  } catch {
    // Browser telemetry must never affect the app UI.
  }
}

function reportBrowserFeedback(details) {
  var eventId =
    sentryEventId(details && details.eventId) ||
    sentryEventId(details && details.associatedEventId) ||
    lastBrowserTelemetryEventId;
  var payload = {
    feedbackKind: browserFeedbackKind(details && details.feedbackKind),
    rememberEventId: false,
  };
  if (eventId) payload.associatedEventId = eventId;
  if (details && details.streamUrl) payload.streamUrl = details.streamUrl;
  return sendBrowserTelemetry('browser_feedback', payload);
}

function bugReportCsrfToken() {
  var meta = document.querySelector ? document.querySelector('meta[name="csrf-token"]') : null;
  return meta && typeof meta.getAttribute === 'function' ? meta.getAttribute('content') || '' : '';
}

function currentBrowserUrl() {
  if (window.location && typeof window.location.href === 'string') {
    return window.location.href.split('#')[0].split('?')[0] || currentRoutePath();
  }
  return currentRoutePath();
}

function browserTimezone() {
  try {
    var formatter =
      window.Intl && typeof window.Intl.DateTimeFormat === 'function'
        ? window.Intl.DateTimeFormat()
        : null;
    var options = formatter && formatter.resolvedOptions ? formatter.resolvedOptions() : null;
    return typeof (options && options.timeZone) === 'string' ? options.timeZone : null;
  } catch {
    return null;
  }
}

function bugReportText(value) {
  if (typeof value !== 'string') return null;
  var trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 2000) : null;
}

function bugReportUrl(value) {
  if (typeof value !== 'string') return null;
  var trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 2048) : null;
}

function bugReportToken(value) {
  return telemetryToken(value, '');
}

function bugReportBase64ByteSize(value) {
  if (typeof value !== 'string') return 0;
  var padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

function bugReportScreenshot(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.contentType !== 'image/jpeg' && value.contentType !== 'image/png') return null;
  if (
    typeof value.filename !== 'string' ||
    !/^[A-Za-z0-9._-]{1,96}\.(?:jpe?g|png)$/i.test(value.filename)
  ) {
    return null;
  }
  if (
    typeof value.base64Content !== 'string' ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value.base64Content)
  ) {
    return null;
  }
  var byteSize = bugReportBase64ByteSize(value.base64Content);
  if (byteSize <= 0 || byteSize > BUG_REPORT_SCREENSHOT_MAX_BYTES) return null;
  var screenshot = {
    filename: value.filename,
    contentType: value.contentType,
    base64Content: value.base64Content,
    byteSize: byteSize,
  };
  if (Number.isInteger(value.width) && value.width > 0 && value.width <= 4000) {
    screenshot.width = value.width;
  }
  if (Number.isInteger(value.height) && value.height > 0 && value.height <= 4000) {
    screenshot.height = value.height;
  }
  return screenshot;
}

function bugReportScreenshotFilename() {
  var suffix = Date.now().toString(36);
  return 'squire-bug-' + suffix + '.jpg';
}

function hideDuringScreenshot(element, callback) {
  if (!element || !element.style) return callback();
  var previousVisibility = element.style.visibility;
  element.style.visibility = 'hidden';
  return Promise.resolve()
    .then(callback)
    .finally(function () {
      element.style.visibility = previousVisibility;
    });
}

function screenshotAttempts(sourceWidth, sourceHeight) {
  var attempts = [
    { edge: 1280, quality: 0.72 },
    { edge: 960, quality: 0.66 },
    { edge: 720, quality: 0.6 },
  ];
  return attempts.map(function (attempt) {
    var scale = Math.min(1, attempt.edge / Math.max(sourceWidth, sourceHeight));
    return {
      width: Math.max(1, Math.round(sourceWidth * scale)),
      height: Math.max(1, Math.round(sourceHeight * scale)),
      quality: attempt.quality,
    };
  });
}

function screenshotFromLoadedImage(image, sourceWidth, sourceHeight) {
  var attempts = screenshotAttempts(sourceWidth, sourceHeight);
  for (var i = 0; i < attempts.length; i += 1) {
    var attempt = attempts[i];
    var canvas = document.createElement('canvas');
    canvas.width = attempt.width;
    canvas.height = attempt.height;
    var context = canvas.getContext && canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, attempt.width, attempt.height);
    var dataUrl = canvas.toDataURL('image/jpeg', attempt.quality);
    var match = dataUrl.match(/^data:(image\/jpeg);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) continue;
    var byteSize = bugReportBase64ByteSize(match[2]);
    if (byteSize > 0 && byteSize <= BUG_REPORT_SCREENSHOT_MAX_BYTES) {
      return {
        filename: bugReportScreenshotFilename(),
        contentType: match[1],
        base64Content: match[2],
        width: attempt.width,
        height: attempt.height,
        byteSize: byteSize,
      };
    }
  }
  return null;
}

function screenshotStyles() {
  if (!document.styleSheets) return '';
  var chunks = [];
  for (var i = 0; i < document.styleSheets.length; i += 1) {
    var sheet = document.styleSheets[i];
    var rules;
    try {
      rules = sheet.cssRules;
    } catch {
      rules = null;
    }
    if (!rules) continue;
    for (var j = 0; j < rules.length; j += 1) {
      var cssText = rules[j] && rules[j].cssText;
      if (!cssText || /^@font-face\b/i.test(cssText) || /^@import\b/i.test(cssText)) continue;
      chunks.push(cssText);
    }
  }
  return chunks.join('\n');
}

function removeScreenshotExternalResources(clone) {
  if (!clone || typeof clone.querySelectorAll !== 'function') return;
  clone.querySelectorAll('script,link[rel="stylesheet"],style').forEach(function (node) {
    if (node.parentNode) node.parentNode.removeChild(node);
  });
}

function screenshotViewportCss(width, height) {
  var scrollX = Math.max(0, Math.round(window.scrollX || window.pageXOffset || 0));
  var scrollY = Math.max(0, Math.round(window.scrollY || window.pageYOffset || 0));
  var doc = document.documentElement;
  var body = document.body;
  var pageWidth = Math.max(width, doc?.scrollWidth || 0, body?.scrollWidth || 0);
  var pageHeight = Math.max(height, doc?.scrollHeight || 0, body?.scrollHeight || 0);
  return [
    `html{width:${pageWidth}px!important;min-height:${pageHeight}px!important;overflow:hidden!important;}`,
    `body{width:${pageWidth}px!important;min-height:${pageHeight}px!important;margin:0!important;transform:translate(${-scrollX}px,${-scrollY}px);transform-origin:top left;}`,
  ].join('\n');
}

function screenshotSvgMarkup(width, height) {
  if (
    !document.documentElement ||
    typeof document.documentElement.cloneNode !== 'function' ||
    typeof window.XMLSerializer !== 'function'
  ) {
    return null;
  }
  var clone = document.documentElement.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  removeScreenshotExternalResources(clone);
  var head = clone.querySelector && clone.querySelector('head');
  if (!head) return null;
  var style = document.createElement('style');
  style.textContent = [screenshotStyles(), screenshotViewportCss(width, height)].join('\n');
  head.appendChild(style);

  var htmlMarkup = new window.XMLSerializer().serializeToString(clone);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<foreignObject x="0" y="0" width="${width}" height="${height}">`,
    htmlMarkup,
    '</foreignObject>',
    '</svg>',
  ].join('');
}

function loadScreenshotImage(svgMarkup, width, height) {
  return new Promise(function (resolve) {
    var ImageCtor = window.Image;
    if (typeof ImageCtor !== 'function') {
      resolve(null);
      return;
    }
    var image = new ImageCtor();
    image.onload = function () {
      try {
        resolve(screenshotFromLoadedImage(image, width, height));
      } catch {
        resolve(null);
      }
    };
    image.onerror = function () {
      resolve(null);
    };
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgMarkup);
  });
}

function nextScreenshotFrame() {
  return new Promise(function (resolve) {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(function () {
        resolve();
      });
      return;
    }
    window.setTimeout(resolve, 0);
  });
}

function captureCurrentPageScreenshot() {
  var width = Math.max(
    1,
    Math.round(window.innerWidth || document.documentElement?.clientWidth || 1),
  );
  var height = Math.max(
    1,
    Math.round(window.innerHeight || document.documentElement?.clientHeight || 1),
  );
  var svgMarkup = screenshotSvgMarkup(width, height);
  return svgMarkup ? loadScreenshotImage(svgMarkup, width, height) : Promise.resolve(null);
}

function captureBugReportScreenshot(hiddenElement) {
  if (
    !document ||
    !document.createElement ||
    !document.documentElement ||
    typeof window.XMLSerializer !== 'function'
  ) {
    return Promise.resolve(null);
  }

  return hideDuringScreenshot(hiddenElement, function () {
    return nextScreenshotFrame()
      .then(captureCurrentPageScreenshot)
      .catch(function () {
        return null;
      });
  });
}

function buildBugReportBrowserMetadata() {
  var metadata = {
    url: currentBrowserUrl(),
    replaySnapshotId: maskedReplaySnapshotId(),
  };
  var userAgent = userAgentTelemetry();
  if (userAgent) metadata.userAgent = userAgent;
  var viewport = viewportTelemetry();
  if (viewport) metadata.viewport = viewport;
  var timezone = browserTimezone();
  if (timezone) metadata.timezone = timezone;
  return metadata;
}

function assignBugReportToken(payload, key, value) {
  var token = bugReportToken(value);
  if (token) payload[key] = token;
}

function buildBugReportPayload(details, associatedEventId) {
  var routeConversationId = conversationIdFromPath(currentRoutePath());
  var payload = {
    kind: bugReportKind(details && details.kind),
    browser: buildBugReportBrowserMetadata(),
  };
  assignBugReportToken(
    payload,
    'conversationId',
    (details && details.conversationId) || routeConversationId,
  );
  assignBugReportToken(payload, 'userMessageId', details && details.userMessageId);
  assignBugReportToken(payload, 'assistantMessageId', details && details.assistantMessageId);
  assignBugReportToken(payload, 'langsmithRunId', details && details.langsmithRunId);
  var langsmithRunUrl = bugReportUrl(details && details.langsmithRunUrl);
  if (langsmithRunUrl) payload.langsmithRunUrl = langsmithRunUrl;
  var langsmithTraceUrl = bugReportUrl(details && details.langsmithTraceUrl);
  if (langsmithTraceUrl) payload.langsmithTraceUrl = langsmithTraceUrl;
  var observed = bugReportText(details && details.observed);
  if (observed) payload.observed = observed;
  var expected = bugReportText(details && details.expected);
  if (expected) payload.expected = expected;
  var eventId =
    sentryEventId(associatedEventId) || sentryEventId(details && details.associatedEventId);
  if (eventId) payload.associatedEventId = eventId;
  var screenshot = bugReportScreenshot(details && details.screenshot);
  if (screenshot) payload.screenshot = screenshot;
  return payload;
}

function postBugReportPayload(payload) {
  var fetchFn = window.fetch;
  if (typeof fetchFn !== 'function') return;
  try {
    return fetchFn.call(window, '/api/bug-reports', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': bugReportCsrfToken(),
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return null;
  }
}

function submitBugReport(details) {
  var kind = bugReportKind(details && details.kind);
  var feedbackResult = reportBrowserFeedback({
    feedbackKind: BUG_REPORT_FEEDBACK_KIND[kind],
    associatedEventId: details && details.associatedEventId,
  });
  var feedbackPromise =
    feedbackResult && typeof feedbackResult.then === 'function'
      ? feedbackResult
      : Promise.resolve(feedbackResult);
  var screenshotPromise =
    details && details.includeScreenshot
      ? captureBugReportScreenshot(details.captureElement)
      : Promise.resolve(null);

  return Promise.all([
    feedbackPromise.catch(function () {
      return null;
    }),
    screenshotPromise,
  ]).then(function (results) {
    var screenshot = results[1] || (details && details.screenshot);
    return postBugReportPayload(
      buildBugReportPayload({ ...(details || {}), kind: kind, screenshot: screenshot }, results[0]),
    );
  });
}

function closestBugReportButton(target) {
  var node = target;
  while (node) {
    if (node.getAttribute && node.getAttribute('data-squire-report-bug') !== null) {
      return node;
    }
    node = node.parentNode || null;
  }
  return null;
}

function bugReportButtonDetails(button) {
  var transcript =
    button && typeof button.closest === 'function' ? button.closest('.squire-transcript') : null;
  var dataset = button.dataset || null;
  return {
    kind: dataset ? dataset.bugReportDefaultKind : 'other',
    conversationId:
      (transcript && transcript.dataset && transcript.dataset.conversationId) ||
      conversationIdFromPath(currentRoutePath()),
    userMessageId: dataset ? dataset.userMessageId : null,
    assistantMessageId: dataset ? dataset.assistantMessageId : null,
    langsmithRunId: dataset ? dataset.langsmithRunId : null,
    langsmithRunUrl: dataset ? dataset.langsmithRunUrl : null,
    langsmithTraceUrl: dataset ? dataset.langsmithTraceUrl : null,
  };
}

function appendBugReportOption(select, value, label, selected) {
  var option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  if (selected) option.selected = true;
  select.appendChild(option);
}

function appendBugReportField(form, labelText, field) {
  var label = document.createElement('label');
  label.className = 'squire-bug-report__field';
  var span = document.createElement('span');
  span.textContent = labelText;
  label.appendChild(span);
  label.appendChild(field);
  form.appendChild(label);
}

function appendBugReportCheckbox(form, input, labelText, hintText) {
  var label = document.createElement('label');
  label.className = 'squire-bug-report__checkbox';
  label.appendChild(input);
  var text = document.createElement('span');
  text.textContent = labelText;
  label.appendChild(text);
  form.appendChild(label);
  if (hintText) {
    var hint = document.createElement('p');
    hint.className = 'squire-bug-report__hint';
    hint.textContent = hintText;
    form.appendChild(hint);
  }
}

function setBugReportStatus(status, message) {
  if (!status) return;
  status.textContent = message || '';
}

function bugReportResponseError(body) {
  if (body && typeof body.error === 'string' && body.error.trim()) return body.error.trim();
  if (body && typeof body.message === 'string' && body.message.trim()) return body.message.trim();
  return 'Could not create bug.';
}

function readBugReportResponse(response) {
  var bodyPromise =
    response && typeof response.json === 'function'
      ? response.json().catch(function () {
          return {};
        })
      : Promise.resolve({});
  return bodyPromise.then(function (body) {
    if (!response || !response.ok) throw new Error(bugReportResponseError(body));
    return body;
  });
}

function setBugReportControlsDisabled(controls, disabled) {
  var fields = controls.fields || [];
  for (var i = 0; i < fields.length; i += 1) {
    if (fields[i]) fields[i].disabled = disabled;
  }
}

function setBugReportSubmittingState(dialog, form, controls, submitting) {
  if (submitting) {
    form.dataset.submitting = 'true';
    delete form.dataset.submitted;
    dialog.setAttribute('aria-busy', 'true');
    setBugReportControlsDisabled(controls, true);
    controls.cancel.disabled = true;
    controls.submit.disabled = true;
    controls.submit.textContent = 'Creating...';
    return;
  }

  delete form.dataset.submitting;
  dialog.removeAttribute('aria-busy');
  setBugReportControlsDisabled(controls, false);
  controls.cancel.disabled = false;
  controls.submit.disabled = false;
  controls.submit.textContent = 'Create bug';
}

function setBugReportCreatedState(dialog, form, controls, status, identifier) {
  delete form.dataset.submitting;
  form.dataset.submitted = 'true';
  dialog.removeAttribute('aria-busy');
  setBugReportControlsDisabled(controls, true);
  controls.cancel.disabled = false;
  controls.cancel.textContent = 'Close';
  controls.submit.disabled = true;
  controls.submit.textContent = 'Created';
  setBugReportStatus(status, identifier ? 'Created ' + identifier + '.' : 'Bug created.');
}

function closeBugReportDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === 'function') dialog.close();
  if (typeof dialog.remove === 'function') dialog.remove();
}

function openBugReportDialog(button) {
  if (!document.createElement || !document.body) return;
  var baseDetails = bugReportButtonDetails(button);
  var dialog = document.createElement('dialog');
  dialog.className = 'squire-bug-report';
  var form = document.createElement('form');
  form.method = 'dialog';
  form.className = 'squire-bug-report__form';
  var title = document.createElement('h2');
  title.id = 'squire-bug-report-title';
  title.className = 'squire-bug-report__title';
  title.textContent = 'Report bug';
  dialog.setAttribute('aria-labelledby', title.id);
  form.appendChild(title);

  var kind = document.createElement('select');
  kind.name = 'kind';
  appendBugReportOption(kind, 'bad_answer', 'Bad answer', baseDetails.kind === 'bad_answer');
  appendBugReportOption(
    kind,
    'broken_stream',
    'Broken stream',
    baseDetails.kind === 'broken_stream',
  );
  appendBugReportOption(kind, 'visual_issue', 'Visual issue', baseDetails.kind === 'visual_issue');
  appendBugReportOption(kind, 'wrong_source', 'Wrong source', baseDetails.kind === 'wrong_source');
  appendBugReportOption(kind, 'other', 'Other', baseDetails.kind === 'other');
  appendBugReportField(form, 'Type', kind);

  var observed = document.createElement('textarea');
  observed.name = 'observed';
  observed.rows = 3;
  appendBugReportField(form, 'Observed', observed);

  var expected = document.createElement('textarea');
  expected.name = 'expected';
  expected.rows = 3;
  appendBugReportField(form, 'Expected', expected);

  var includeScreenshot = document.createElement('input');
  includeScreenshot.type = 'checkbox';
  includeScreenshot.name = 'includeScreenshot';
  appendBugReportCheckbox(
    form,
    includeScreenshot,
    'Attach screenshot',
    'Captures the current conversation view. Visible conversation text may be included.',
  );

  var status = document.createElement('p');
  status.className = 'squire-bug-report__status';
  status.setAttribute('role', 'status');
  form.appendChild(status);

  var actions = document.createElement('div');
  actions.className = 'squire-bug-report__actions';
  var cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'squire-button squire-button--ghost';
  cancel.textContent = 'Cancel';
  var submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'squire-button squire-button--primary';
  submit.textContent = 'Create bug';
  actions.appendChild(cancel);
  actions.appendChild(submit);
  form.appendChild(actions);
  dialog.appendChild(form);
  var controls = {
    cancel: cancel,
    submit: submit,
    fields: [kind, observed, expected, includeScreenshot],
  };

  cancel.addEventListener('click', function () {
    closeBugReportDialog(dialog);
  });
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    setBugReportSubmittingState(dialog, form, controls, true);
    setBugReportStatus(status, 'Creating bug...');
    var response = submitBugReport({
      ...baseDetails,
      kind: kind.value,
      observed: observed.value,
      expected: expected.value,
      includeScreenshot: includeScreenshot.checked,
      captureElement: dialog,
    });
    if (!response || typeof response.then !== 'function') {
      setBugReportSubmittingState(dialog, form, controls, false);
      setBugReportStatus(status, 'Could not create bug.');
      return;
    }
    response
      .then(readBugReportResponse)
      .then(function (body) {
        var identifier = body && body.issue && body.issue.identifier;
        if (button && identifier) button.textContent = 'Reported ' + identifier;
        setBugReportCreatedState(dialog, form, controls, status, identifier);
      })
      .catch(function (error) {
        setBugReportSubmittingState(dialog, form, controls, false);
        setBugReportStatus(
          status,
          error instanceof Error && error.message ? error.message : 'Could not create bug.',
        );
      });
  });

  document.body.appendChild(dialog);
  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
  if (typeof observed.focus === 'function') observed.focus();
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('error', function (event) {
    var line = positiveTelemetryNumber(event && event.lineno);
    var column = positiveTelemetryNumber(event && event.colno);
    sendBrowserTelemetry('browser_error', {
      errorName: errorNameFromValue(event && event.error, 'ErrorEvent'),
      source: safePathOnly(event && event.filename),
      line: line,
      column: column,
    });
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    sendBrowserTelemetry('browser_unhandledrejection', {
      errorName: errorNameFromValue(reason, 'UnhandledRejection'),
      reasonType: reasonTypeFromValue(reason),
    });
  });
}

function reportHtmxTransportError(eventName, event) {
  var detail = (event && event.detail) || {};
  var xhr = detail.xhr || {};
  var pathInfo = detail.pathInfo || {};
  var status = positiveTelemetryNumber(xhr.status);
  sendBrowserTelemetry('browser_htmx_error', {
    htmxEvent: eventName,
    htmxStatus: status,
    source: safePathOnly(xhr.responseURL || pathInfo.requestPath),
  });
}

function clearDashboardToastTimer() {
  if (
    dashboardToastTimer !== null &&
    typeof window !== 'undefined' &&
    typeof window.clearTimeout === 'function'
  ) {
    window.clearTimeout(dashboardToastTimer);
  }
  dashboardToastTimer = null;
}

function ensureDashboardToastRegion() {
  if (typeof document === 'undefined' || !document.createElement) return null;
  var existing = document.querySelector ? document.querySelector('.squire-dashboard-toast') : null;
  if (existing) return existing;

  var root = document.body || document.documentElement;
  if (!root || !root.appendChild) return null;

  var toast = document.createElement('p');
  toast.className = 'squire-dashboard-toast';
  toast.hidden = true;
  toast.setAttribute('hidden', '');
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  root.appendChild(toast);
  return toast;
}

function hideDashboardToast() {
  clearDashboardToastTimer();
  var toast = document.querySelector ? document.querySelector('.squire-dashboard-toast') : null;
  if (!toast) return;
  toast.textContent = '';
  toast.hidden = true;
  toast.setAttribute('hidden', '');
  toast.removeAttribute('data-toast-kind');
}

function showDashboardToast(message, kind) {
  var normalizedMessage = typeof message === 'string' ? message.trim() : '';
  if (!normalizedMessage) return;
  var toast = ensureDashboardToastRegion();
  if (!toast) return;

  clearDashboardToastTimer();
  toast.textContent = normalizedMessage;
  toast.setAttribute('data-toast-kind', kind === 'error' ? 'error' : 'success');
  toast.hidden = false;
  toast.removeAttribute('hidden');

  if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
    dashboardToastTimer = window.setTimeout(hideDashboardToast, DASHBOARD_TOAST_TIMEOUT_MS);
  }
}

function consumeDashboardToastPayload(root) {
  var scope = root && root.querySelector ? root : document;
  if (!scope || !scope.querySelector) return;

  var payload = scope.querySelector('.squire-dashboard-toast-payload');
  if (!payload && scope !== document && document.querySelector) {
    payload = document.querySelector('.squire-dashboard-toast-payload');
  }
  if (!payload) return;

  var message = payload.getAttribute ? payload.getAttribute('data-squire-toast-message') : '';
  var kind = payload.getAttribute ? payload.getAttribute('data-squire-toast-kind') : 'success';
  if (payload.remove) payload.remove();
  showDashboardToast(message, kind);
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('htmx:sendError', function (event) {
    reportHtmxTransportError('htmx:sendError', event);
  });
  document.addEventListener('htmx:responseError', function (event) {
    reportHtmxTransportError('htmx:responseError', event);
  });
  document.addEventListener('htmx:timeout', function (event) {
    reportHtmxTransportError('htmx:timeout', event);
  });
  document.addEventListener('squire:browser-feedback', function (event) {
    reportBrowserFeedback(event && event.detail);
  });
  document.addEventListener('squire:bug-report', function (event) {
    submitBugReport(event && event.detail);
  });
  document.addEventListener('click', function (event) {
    var button = closestBugReportButton(event && event.target);
    if (!button) return;
    event.preventDefault();
    openBugReportDialog(button);
  });
}

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

document.addEventListener('submit', function (event) {
  var form = event.target;
  if (
    !form ||
    !form.matches ||
    !form.matches(
      '.squire-character-create, .squire-invite-member, .squire-party-row__action form, .squire-player-row__action form',
    )
  ) {
    return;
  }
  if (form.dataset.submitting === 'true') {
    event.preventDefault();
    return;
  }
  form.dataset.submitting = 'true';
  form.setAttribute('aria-busy', 'true');
  var submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) submitButton.setAttribute('disabled', 'true');
});

document.addEventListener('submit', function (e) {
  var form = e.target;
  if (!form || !form.matches || !form.matches('.squire-input-dock')) return;

  var questionInput = form.querySelector('[name="question"]');
  var submitButton = form.querySelector('button[type="submit"]');
  setHiddenGameInputs(activeGame);
  ensureIdempotencyKey(form);

  // SQR-108 QA: do NOT mutate `submitButton.textContent` here. The
  // submit button renders the Squire seal as a CSS-backed image mark
  // (SQR-99). The `disabled` attribute + `data-submitting='true'` on the
  // form already convey the pending visual via
  // `.squire-input-dock[data-submitting='true'] .squire-input-dock__submit`
  // in styles.css.
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
  var questionInput = form.querySelector('[name="question"]');
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
  // matching comment in the document-level submit handler.
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

// SQR-108 / ADR 0012 D-3 plus SQR-297: pin-to-bottom helpers. Transcript
// pages scroll `.squire-surface` so the input dock does not overlay answer
// text; non-transcript pages still fall back to document-level scroll.
var transcriptScrollRoot = null;

function getTranscriptScrollRoot() {
  if (typeof document === 'undefined' || !document.querySelector) return null;
  var transcript = document.querySelector('.squire-transcript');
  if (!transcript || typeof transcript.closest !== 'function') return null;
  var surface = transcript.closest('.squire-surface');
  if (
    !surface ||
    typeof surface.scrollHeight !== 'number' ||
    typeof surface.scrollTop !== 'number' ||
    typeof surface.clientHeight !== 'number'
  ) {
    return null;
  }
  return surface;
}

function getScrollRoot() {
  return getTranscriptScrollRoot() || document.documentElement;
}

function updatePinToBottomFromScroll() {
  pinToBottom = isNearBottom();
}

function syncTranscriptScrollRoot() {
  var root = getTranscriptScrollRoot();
  if (!root || root === transcriptScrollRoot || typeof root.addEventListener !== 'function') return;
  transcriptScrollRoot = root;
  root.addEventListener('scroll', updatePinToBottomFromScroll, { passive: true });
}

function isNearBottom(threshold) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return true;
  var root = getScrollRoot();
  if (!root) return true;
  var distance =
    root === document.documentElement
      ? root.scrollHeight - (window.scrollY + window.innerHeight)
      : root.scrollHeight - (root.scrollTop + root.clientHeight);
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
    var immediateRoot = getScrollRoot();
    if (!immediateRoot) return;
    if (immediateRoot === document.documentElement) {
      window.scrollTo({ top: immediateRoot.scrollHeight, behavior: 'auto' });
    } else if (typeof immediateRoot.scrollTo === 'function') {
      immediateRoot.scrollTo({ top: immediateRoot.scrollHeight, behavior: 'auto' });
    } else {
      immediateRoot.scrollTop = immediateRoot.scrollHeight;
    }
    return;
  }
  scrollToBottomScheduled = true;
  window.requestAnimationFrame(function () {
    scrollToBottomScheduled = false;
    var root = getScrollRoot();
    if (!root) return;
    if (root === document.documentElement) {
      window.scrollTo({ top: root.scrollHeight, behavior: 'auto' });
    } else if (typeof root.scrollTo === 'function') {
      root.scrollTo({ top: root.scrollHeight, behavior: 'auto' });
    } else {
      root.scrollTop = root.scrollHeight;
    }
  });
}

function scrollPendingAnswerIntoView(answerEl) {
  if (!answerEl || typeof answerEl.scrollIntoView !== 'function') return;
  answerEl.scrollIntoView({ block: 'start', behavior: 'auto' });
}

// ─── Accordion character sheet (SQR-277) ─────────────────────────────────────
// Deep-link anchors: /characters/:id#gold opens the matching section so a
// work-log row or validation warning lands the user directly on the field.

function openSheetSectionFromHash() {
  if (!window.location || !window.location.hash) return;
  var sectionId = window.location.hash.slice(1);
  if (!sectionId || !document.querySelector) return;
  var section = document.querySelector(
    '.squire-sheet__section[data-sheet-section="' + sectionId + '"]',
  );
  if (!section) return;
  section.open = true;
  if (typeof section.scrollIntoView === 'function') {
    section.scrollIntoView({ block: 'start', behavior: 'auto' });
  }
}

// ─── Confirmation block (SQR-286) ────────────────────────────────────────────
// Consent chrome for a staged destructive mutation (DESIGN.md §Confirmation
// block): a --surface panel of server-derived ledger lines plus a wax primary
// confirm action. Explicitly NOT the Phase 5 verdict treatment — no wax rail.
// All payload fields render via DOM text APIs, never innerHTML.

function proposalCsrfToken() {
  var meta = document.querySelector ? document.querySelector('meta[name="csrf-token"]') : null;
  return meta && typeof meta.getAttribute === 'function' ? meta.getAttribute('content') || '' : '';
}

function markProposalRows(block, state) {
  if (!block || typeof block.querySelectorAll !== 'function') return;
  var rows = block.querySelectorAll('.squire-proposal__row');
  for (var i = 0; i < rows.length; i += 1) {
    rows[i].classList.remove('is-applied', 'is-failed');
    if (state === 'applied') rows[i].classList.add('is-applied');
    if (state === 'failed') rows[i].classList.add('is-failed');
  }
}

// States: staged (actionable) → working (in flight) → applied | failed |
// expired | cancelled (terminal). A network failure returns to staged so the
// user can retry. The status line is the aria-live announcement surface.
function setProposalBlockState(block, state, message, linkLabel) {
  if (!block) return;
  block.dataset.proposalState = state;
  var confirmBtn = block.querySelector('.squire-proposal__confirm');
  var cancelBtn = block.querySelector('.squire-proposal__cancel');
  var actionable = state === 'staged';
  if (confirmBtn) confirmBtn.disabled = !actionable;
  if (cancelBtn) cancelBtn.disabled = !actionable;
  var status = block.querySelector('.squire-proposal__status');
  if (!status) return;
  status.textContent = message || '';
  if (linkLabel && block.dataset.campaignId) {
    var link = document.createElement('a');
    link.className = 'squire-proposal__link';
    link.setAttribute('href', '/campaigns/' + block.dataset.campaignId);
    link.textContent = linkLabel;
    if (typeof status.appendChild === 'function') {
      if (typeof document.createTextNode === 'function') {
        status.appendChild(document.createTextNode(' '));
      }
      status.appendChild(link);
    }
  }
}

function expireProposalBlockIfStaged(block) {
  if (!block || block.dataset.proposalState !== 'staged') return;
  setProposalBlockState(
    block,
    'expired',
    'This staged change expired without being applied — ask Squire to stage it again.',
  );
}

function proposalFailureState(block, body) {
  var code = body && body.error;
  if (code === 'proposal_expired') {
    expireProposalBlockIfStaged(block);
    block.dataset.proposalState = 'expired';
    return;
  }
  var message =
    code === 'stale_proposal' || code === 'version_conflict'
      ? 'Campaign state changed since this was staged — nothing was applied.'
      : code === 'proposal_resolved'
        ? 'This staged change was already resolved — nothing further was applied.'
        : (body && body.message) || 'Could not apply the change — nothing was applied.';
  setProposalBlockState(block, 'failed', message, 'REVIEW ON DASHBOARD');
  markProposalRows(block, 'failed');
}

function sendProposalAction(block, method, url, onOk) {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  setProposalBlockState(block, 'working', 'Working…');
  window
    .fetch(url, {
      method: method,
      headers: { 'x-csrf-token': proposalCsrfToken() },
    })
    .then(function (res) {
      if (res.ok) {
        onOk();
        return null;
      }
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (body) {
          proposalFailureState(block, body);
        });
    })
    .catch(function () {
      // Transport failure is recoverable: back to actionable with a notice.
      setProposalBlockState(block, 'staged', 'Could not reach Squire — try again.');
    });
}

function wireProposalBlock(block, payload) {
  var proposalId = payload.proposalId;
  var confirmBtn = block.querySelector('.squire-proposal__confirm');
  var cancelBtn = block.querySelector('.squire-proposal__cancel');

  if (confirmBtn && typeof confirmBtn.addEventListener === 'function') {
    confirmBtn.addEventListener('click', function () {
      if (block.dataset.proposalState !== 'staged') return;
      sendProposalAction(
        block,
        'POST',
        '/api/proposals/' + encodeURIComponent(proposalId) + '/confirm',
        function () {
          setProposalBlockState(
            block,
            'applied',
            'Applied — recorded in the campaign journal.',
            'VIEW JOURNAL',
          );
          markProposalRows(block, 'applied');
        },
      );
    });
  }

  if (cancelBtn && typeof cancelBtn.addEventListener === 'function') {
    cancelBtn.addEventListener('click', function () {
      if (block.dataset.proposalState !== 'staged') return;
      sendProposalAction(
        block,
        'DELETE',
        '/api/proposals/' + encodeURIComponent(proposalId),
        function () {
          setProposalBlockState(block, 'cancelled', 'Cancelled — nothing was applied.');
        },
      );
    });
  }

  // Expired proposals render as expired, never as silent disappearance:
  // flip the block in place when the TTL passes (or immediately, when the
  // event replays after the proposal already lapsed).
  var expiresAtMs = Date.parse(payload.expiresAt || '');
  if (!isNaN(expiresAtMs)) {
    var remainingMs = expiresAtMs - Date.now();
    if (remainingMs <= 0) {
      expireProposalBlockIfStaged(block);
    } else if (typeof setTimeout === 'function') {
      setTimeout(function () {
        expireProposalBlockIfStaged(block);
      }, remainingMs);
    }
  }
}

function renderProposalBlock(answerEl, payload) {
  if (!answerEl || !payload || !payload.proposalId) return null;
  // Idempotent per proposal id: replayed streams re-send the event.
  if (typeof answerEl.querySelector === 'function') {
    var existing = answerEl.querySelector(
      '.squire-proposal[data-proposal-id="' + payload.proposalId + '"]',
    );
    if (existing) return existing;
  }

  var block = document.createElement('section');
  block.className = 'squire-proposal';
  block.dataset.proposalId = payload.proposalId;
  block.dataset.campaignId = payload.campaignId || '';
  block.dataset.proposalState = 'staged';
  block.setAttribute('data-proposal-id', payload.proposalId);
  block.setAttribute('aria-label', 'Staged change awaiting your confirmation');

  var title = document.createElement('h3');
  title.className = 'squire-proposal__title';
  title.textContent = 'STAGED CHANGE';
  block.appendChild(title);

  var rows = document.createElement('div');
  rows.className = 'squire-proposal__rows';
  var lines = Array.isArray(payload.lines) && payload.lines.length > 0 ? payload.lines : [];
  for (var i = 0; i < lines.length; i += 1) {
    var row = document.createElement('div');
    row.className = 'squire-proposal__row';
    row.textContent = String(lines[i]);
    rows.appendChild(row);
  }
  block.appendChild(rows);

  var actions = document.createElement('div');
  actions.className = 'squire-proposal__actions';
  var confirmBtn = document.createElement('button');
  confirmBtn.className = 'squire-button squire-button--primary squire-proposal__confirm';
  confirmBtn.setAttribute('type', 'button');
  confirmBtn.textContent = 'Confirm';
  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'squire-button squire-button--ghost squire-proposal__cancel';
  cancelBtn.setAttribute('type', 'button');
  cancelBtn.textContent = 'Not now';
  actions.appendChild(confirmBtn);
  actions.appendChild(cancelBtn);
  block.appendChild(actions);

  var status = document.createElement('p');
  status.className = 'squire-proposal__status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  block.appendChild(status);

  answerEl.appendChild(block);
  wireProposalBlock(block, payload);
  return block;
}

// User-driven scrolls (touchmove, wheel, scrollbar) update `pinToBottom`
// based on distance from bottom. Programmatic auto-scrolls also fire
// scroll events, but they leave us at the bottom — `isNearBottom`
// returns true and the pin stays on. Genuine user-initiated scroll-up
// drops below the threshold and disables pin.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('scroll', updatePinToBottomFromScroll, { passive: true });
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
  var streamStartedAt = telemetryNowMs();
  var streamFirstEventMs = null;
  var streamEventCount = 0;
  var streamTextEventCount = 0;
  var streamToolEventCount = 0;

  activeStream = {
    url: streamUrl,
    source: source,
  };
  setActiveConversationHistoryStatus('running');

  function markStreamEvent(kind) {
    // Count protocol terminal/error events too; this is a stream lifecycle
    // count, while streamTextEventCount and streamToolEventCount remain
    // content-specific.
    streamEventCount += 1;
    if (kind === 'text') streamTextEventCount += 1;
    if (kind === 'tool') streamToolEventCount += 1;
    if (streamFirstEventMs === null) {
      streamFirstEventMs = elapsedTelemetryMs(streamStartedAt);
    }
  }

  function streamTelemetryDetails(extra) {
    var details = {
      streamUrl: streamUrl,
      streamDurationMs: elapsedTelemetryMs(streamStartedAt),
      streamEventCount: streamEventCount,
      streamTextEventCount: streamTextEventCount,
      streamToolEventCount: streamToolEventCount,
      rememberEventId: false,
    };
    if (streamFirstEventMs !== null) details.streamFirstEventMs = streamFirstEventMs;
    if (extra) {
      for (var key in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, key)) details[key] = extra[key];
      }
    }
    return details;
  }

  sendBrowserTelemetry(
    'browser_stream_started',
    streamTelemetryDetails({ includeMaskedReplay: false }),
  );

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
    markStreamEvent('text');
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
    markStreamEvent('tool');
    if (seenFirstDelta) {
      return;
    }
    preToolBuffer = '';
    toolPhaseStarted = true;
    setAnswerWorkRunning(answerWork);
  });

  source.addEventListener('tool-plan', function (event) {
    markStreamEvent('tool');
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
    markStreamEvent('tool');
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
    markStreamEvent('tool');
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

  source.addEventListener('state-used', function (event) {
    markStreamEvent('tool');
    var payload = JSON.parse(event.data || '{}');
    if (!payload.message) return;
    if (seenFirstDelta) return;
    preToolBuffer = '';
    toolPhaseStarted = true;
    // SQR-258: the state snapshot row sorts first and carries the
    // fix-it-here deep link to the accordion edit surface.
    var row = renderAnswerWorkNarrative(
      answerWork,
      answerWorkEntries,
      payload.id || 'state-used',
      payload.message,
      1,
    );
    if (row && payload.href) {
      var link = document.createElement('a');
      link.className = 'squire-answer-work__state-link';
      link.setAttribute('href', payload.href);
      link.textContent = 'FIX IT HERE';
      row.appendChild(link);
    }
  });

  source.addEventListener('proposal-staged', function (event) {
    markStreamEvent('tool');
    var payload = JSON.parse(event.data || '{}');
    if (!payload || !payload.proposalId) return;
    // Consent chrome renders even after answer text starts streaming — the
    // SQR-98 straggler rule does not apply here, because dropping a consent
    // surface is worse than a late row. Rendering is idempotent by id.
    renderProposalBlock(answerEl, payload);
    if (pinToBottom) scrollToBottom();
  });

  source.addEventListener('answer-artifact', function (event) {
    markStreamEvent('tool');
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
    markStreamEvent('done');
    answerEl.classList.remove('squire-answer--pending');
    answerEl.setAttribute('data-stream-state', 'done');
    if (skeletonEl) skeletonEl.hidden = true;
    sendBrowserTelemetry(
      'browser_stream_completed',
      streamTelemetryDetails({ includeMaskedReplay: false }),
    );
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
    markStreamEvent('error');
    var payload = { kind: 'transport', message: 'Trouble connecting. Please try again.' };
    if (event.data) {
      payload = JSON.parse(event.data);
    }
    sendBrowserTelemetry(
      'browser_stream_error',
      streamTelemetryDetails({
        includeMaskedReplay: false,
        streamErrorKind: payload.kind === 'session' ? 'session' : 'transport',
        streamReadyState: positiveTelemetryNumber(source.readyState),
      }),
    );
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
  var questionInput = form && form.querySelector('[name="question"]');
  if (questionInput) questionInput.value = '';
  consumeDashboardToastPayload(event.detail && event.detail.target);
  syncChatFormAction();
  syncActiveGameControls();
  syncTranscriptScrollRoot();

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
  consumeDashboardToastPayload(document);
  syncChatFormAction();
  syncActiveGameControls();
  syncTranscriptScrollRoot();
  openSheetSectionFromHash();
  // SQR-108 / ADR 0012 D-2: the browser preserves last scroll natively on
  // back/forward navigation and refresh, so we don't pin or auto-scroll on
  // initial load. We only flag pin on submit (above) and re-evaluate it
  // from the current scroll position on the user's first scroll event.
  pinToBottom = isNearBottom();
  attachPendingAnswerStream(findActivePendingAnswer(document));
});
