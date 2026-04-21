<!-- Indexed from agent-baseline.md — see the routing table there. -->

# Preview-tab manual testing

Claude Code's preview tab runs the live app inside a localhost-only
sandbox. For any branch that touches the web UI, it is the fastest way
to drive real browser behaviour without switching windows. This doc is
the runbook for doing that well — it exists so we do not re-derive the
same three quirks (OAuth blocked, no DevTools, dev-server port matters)
every time.

This is the preview-specific companion to [qa.md](./qa.md). That doc
describes the full Squire QA sweep; this one covers how to execute it
inside preview.

## Start the dev server

`.claude/launch.json` ships three named configurations, one per
Google-OAuth-authorised port (3000, 4450, 5018). Pick whichever port
is free on your machine and call `preview_start` with that config
name, e.g.:

```text
preview_start → "Squire dev server — port 3000 (OAuth)"
```

The wrapper script at [../../scripts/preview-serve.sh](../../scripts/preview-serve.sh)
sources nvm, activates `.nvmrc` (Node 24), exports `PORT`, and execs
`npm run serve`. No environment plumbing in `launch.json` — just a
single port argument per config.

Run parallel preview sessions on different ports when testing multiple
branches side-by-side. They share the one `squire-postgres` container
but isolate per-worktree dev DBs (see [../DEVELOPMENT.md](../DEVELOPMENT.md)).

## Sign in without Google

The preview sandbox refuses to follow the Google OAuth redirect:

> Link to accounts.google.com was blocked. Preview only supports
> localhost URLs.

`/login` exposes a second button — **"Sign in as Dev User (local only)"**
— that posts to `POST /dev/login`. The route mints a session for
`DEV_USER` (seeded by `npm run seed:dev`) and sets the signed cookie
directly. No round-trip to Google.

Production safety is enforced at registration time by
`shouldRegisterDevLogin()` in [../../src/auth/dev-login.ts](../../src/auth/dev-login.ts).
The route is only attached to the app when **all three** conditions hold:

1. `SQUIRE_DEV_LOGIN=1` is explicitly set in the environment.
2. `NODE_ENV` is exactly `development` or `test`.
3. `DATABASE_URL` resolves to a managed-local DB.

`scripts/preview-serve.sh` exports `SQUIRE_DEV_LOGIN=1` automatically, so
preview mode works without any extra config. Plain `npm run serve` does
**not** set it — a developer on a shared/exposed host won't accidentally
open the route. A same-origin `Origin` header check stands in for CSRF.
See the module header for the full security argument.

If the dev-login button is missing, the gate refused to register the route
on startup. The server only logs a `[dev]` line when the route IS live — no
log line means one of the three conditions failed. Check:

```sh
echo $SQUIRE_DEV_LOGIN   # must be "1"
echo $NODE_ENV           # must be "development" or "test"
cat .env | grep DATABASE_URL
```

If you're running via `preview-serve.sh` this is handled for you. If running
`npm run serve` directly, add `SQUIRE_DEV_LOGIN=1` to your `.env` (see
`.env.example` for the commented-out template).

## Verify without browser DevTools

The preview pane does not expose Chromium DevTools. Use these MCP
tools instead — they drive the same underlying page:

| Goal                                                       | Tool                                                             |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| Read DOM state (e.g., footer text, URL, element structure) | `preview_eval` with a `(() => { ... })()` IIFE that returns JSON |
| Check for console errors/warnings                          | `preview_console_logs` with `level: 'warn'`                      |
| Find and click elements by role/text                       | `preview_snapshot` followed by `preview_click`                   |
| See the page                                               | `preview_screenshot`                                             |

Prefer `preview_eval` for assertions. A single expression can return
exactly the state you need without a screenshot-and-diff cycle. Example
that covers "footer text + parent element + URL + any console noise":

```js
(() => {
  const footer = document.querySelector('.squire-toolcall');
  const parent = footer?.parentElement;
  return {
    url: location.href,
    footerText: (footer?.textContent || '').trim(),
    footerHidden: footer?.hidden,
    parentTag: parent?.tagName,
    parentClass: parent?.className,
  };
})();
```

Any server-rendered assertion (raw HTML, absence of a string, redirect
behaviour) is easier via `curl` with the dev-session cookie than via
preview tools. Mint a cookie by calling `POST /dev/login` with `curl`
and same-origin headers; the response's `Set-Cookie` is reusable.

## Shared-product regression sweep

Run [qa.md](./qa.md)'s six-step sweep every time. In preview:

1. **Unauthenticated entry** — `/login` renders; no console noise;
   the old `CONSULTED · RULEBOOK P.47` placeholder is absent (for
   legacy-bug-regression defence).
2. **Authenticated landing** — click the Dev User button, land at
   `/`, transcript is clean.
3. **First-turn chat** — ask one simple question, stream completes,
   UI is not stuck pending.
4. **Follow-up chat** — ask a second question in the same conversation,
   URL stays the same, stream completes.
5. **Existing transcript** — click a prior question's chip in the
   recent-questions nav; the `EARLIER QUESTION` eyebrow appears.
6. **Branch-specific scenario** — whatever the ticket was actually about.

After each step, an `preview_eval` against the relevant DOM path
confirms the expected state in one shot. `preview_console_logs --level warn`
after any interaction catches JS noise that would not surface visually.

## When to skip preview and use a real browser

Preview is fine for anything that stays on localhost. It is not fine for:

- Real Google OAuth end-to-end (sandbox blocks accounts.google.com)
- External fetches the app initiates that hit non-localhost origins
- Multi-origin flows (e.g., embedded third-party iframes)

Drop to Safari/Chrome for those. Everything else — streaming chat, HTMX
swaps, DOM assertions, CSS polish — belongs in preview.

## Capturing evidence

For a QA report (`.gstack/qa-reports/…`), three artefacts are enough:

- `preview_screenshot` into `.gstack/qa-reports/screenshots/<name>.png`
- `preview_eval` JSON output pasted verbatim into the report
- `preview_console_logs` output, if any, as a separate codeblock

The `/qa` skill already writes to that directory; preview-sourced
evidence drops in alongside anything the skill captured.
