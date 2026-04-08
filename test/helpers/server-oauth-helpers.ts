/**
 * Shared OAuth helpers for server test files.
 *
 * Why these aren't in `test/server.test.ts`: that file was split into
 * `test/server-api.test.ts` (content/search endpoints) and
 * `test/server-oauth.test.ts` (OAuth endpoints + bearer middleware) so
 * multiple agents can work on the HTTP surface in parallel without fighting
 * a single 900-line file. Both halves still need to mint an access token to
 * hit protected routes, so this helper lives here.
 *
 * Note: `vi.mock` calls can't be moved here — vitest's hoisting transform
 * only recognizes them at the top of the test file itself. Each test file
 * therefore owns its own mock preamble for `src/service.ts`, `src/db.ts`,
 * and `src/tools.ts`.
 */

import type { Hono } from 'hono';

/** PKCE verifier/challenge pair from RFC 7636 Appendix B. */
export const CODE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
export const CODE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

/** Parse SSE events from a response body string. */
export function parseSSE(text: string): Array<{ event?: string; data: string }> {
  return text
    .split('\n\n')
    .filter((block) => block.trim())
    .map((block) => {
      const lines = block.split('\n');
      const event = lines
        .find((l) => l.startsWith('event:'))
        ?.slice(6)
        .trim();
      const data =
        lines
          .find((l) => l.startsWith('data:'))
          ?.slice(5)
          .trim() ?? '';
      return { event, data };
    });
}

/**
 * Build auth helpers bound to a specific Hono app instance. Each test file
 * gets its own closure so the cached token doesn't leak across suites — the
 * `resetTestDb()` + `resetTestToken()` dance in OAuth tests wipes both in
 * the same `beforeEach` (post-SQR-69 the auth state lives in Postgres).
 */
export function makeAuthHelpers(app: Hono) {
  let testToken: string | null = null;

  async function getTestToken(): Promise<string> {
    const regRes = await app.request('http://localhost:3000/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: ['http://localhost:8080/callback'],
        token_endpoint_auth_method: 'none',
      }),
    });
    const { client_id: clientId } = (await regRes.json()) as { client_id: string };

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'http://localhost:8080/callback',
      response_type: 'code',
      code_challenge: CODE_CHALLENGE,
      code_challenge_method: 'S256',
    });
    const authRes = await app.request(`http://localhost:3000/authorize?${params}`, {
      redirect: 'manual',
    });
    const code = new URL(authRes.headers.get('location')!).searchParams.get('code')!;

    const tokenRes = await app.request('http://localhost:3000/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        code_verifier: CODE_VERIFIER,
        redirect_uri: 'http://localhost:8080/callback',
      }).toString(),
    });
    const { access_token } = (await tokenRes.json()) as { access_token: string };
    return access_token;
  }

  /** Get or create a valid access token. */
  async function auth(): Promise<Record<string, string>> {
    if (!testToken) testToken = await getTestToken();
    return { Authorization: `Bearer ${testToken}` };
  }

  /** Clear the cached token. Call after `resetTestDb()`. */
  function resetTestToken(): void {
    testToken = null;
  }

  return { getTestToken, auth, resetTestToken };
}
