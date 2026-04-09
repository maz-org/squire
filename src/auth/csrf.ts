import { createHmac, timingSafeEqual } from 'node:crypto';

import type { Context, Next } from 'hono';
import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

import { getSessionSecret } from './session-middleware.ts';
import { layoutShell } from '../web-ui/layout.ts';

export const CSRF_HEADER_NAME = 'x-csrf-token';
export const CSRF_META_NAME = 'csrf-token';
export const CSRF_FORM_FIELD_NAME = '_csrf';

const CSRF_ERROR_MESSAGE = 'Security check failed. Refresh the page and try again.';

export function createCsrfToken(sessionId: string): string {
  return createHmac('sha256', getSessionSecret())
    .update('squire-csrf:v1')
    .update(sessionId)
    .digest('base64url');
}

function timingSafeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

async function readFormToken(c: Context): Promise<string | null> {
  const contentType = c.req.header('content-type') ?? '';
  if (
    !contentType.includes('application/x-www-form-urlencoded') &&
    !contentType.includes('multipart/form-data')
  ) {
    return null;
  }

  try {
    const formData = await c.req.raw.clone().formData();
    const value = formData.get(CSRF_FORM_FIELD_NAME);
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function readJsonToken(c: Context): Promise<string | null> {
  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.includes('application/json')) return null;

  try {
    const body = (await c.req.raw.clone().json()) as Record<string, unknown>;
    const value = body[CSRF_FORM_FIELD_NAME] ?? body.csrfToken;
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function readProvidedCsrfToken(c: Context): Promise<string | null> {
  const headerToken = c.req.header(CSRF_HEADER_NAME);
  if (headerToken && headerToken.length > 0) return headerToken;

  return (await readFormToken(c)) ?? (await readJsonToken(c));
}

function csrfErrorFragment(): HtmlEscapedString {
  return html`<div class="squire-banner squire-banner--error" role="alert">
    <span class="squire-banner__label">SECURITY CHECK FAILED</span>
    <p class="squire-banner__body">${CSRF_ERROR_MESSAGE}</p>
  </div>` as HtmlEscapedString;
}

async function csrfErrorResponse(c: Context) {
  if (c.req.header('hx-request') === 'true') {
    return c.html(csrfErrorFragment(), 403);
  }

  const accept = c.req.header('accept') ?? '';
  if (accept.includes('text/html')) {
    return c.html(
      await layoutShell({
        mainContent: csrfErrorFragment(),
        session: c.get('session'),
      }),
      403,
    );
  }

  return c.json({ error: CSRF_ERROR_MESSAGE, status: 403 }, 403);
}

export function requireCsrf() {
  return async (c: Context, next: Next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
      await next();
      return;
    }

    const session = c.get('session');
    if (!session) {
      return c.json({ error: 'Authentication required', status: 401 }, 401);
    }

    const providedToken = await readProvidedCsrfToken(c);
    const expectedToken = createCsrfToken(session.id);

    if (providedToken && timingSafeEqualString(providedToken, expectedToken)) {
      await next();
      return;
    }

    return csrfErrorResponse(c);
  };
}
