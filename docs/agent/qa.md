<!-- Indexed from agent-baseline.md — see the routing table there. -->

# QA Workflow

QA in Squire has two separate jobs. Do both.

1. **Issue-specific exploratory QA**
   - Exercise the scenario the ticket or branch actually changes.
   - Try the obvious success path, the failure path, and the edge that motivated
     the fix.
2. **Always-run regression QA**
   - Re-run a small shared-product sweep so we do not miss adjacent regressions
     in auth, chat flow, or browser wiring.

Do not treat exploratory QA as a substitute for the regression sweep. The
SQR-88 follow-up-submit bug is the exact failure mode this doc is meant to
prevent: the branch-fixed behavior worked, but a nearby shared chat path broke
and would only show up if you asked a second question in the same conversation.

## Preconditions

Before authenticated browser QA in a fresh linked worktree, follow the
bootstrap in [../DEVELOPMENT.md](../DEVELOPMENT.md):

```bash
npm install
docker compose up -d
npm run db:migrate
npm run db:migrate:test
npm run index
npm run seed:dev
```

Also make sure:

- the worktree `.env` includes `SESSION_SECRET`
- local commands use Node 24 if your shell defaults to another version
- the dev server is running on the current worktree's port

## Mandatory regression sweep

Run these in addition to issue-specific QA unless the branch is purely
documentation or process-only.

### 1. Unauthenticated entry

- Open `/login`
- Confirm the page renders cleanly
- Confirm there are no browser console errors
- Open `/`
- Confirm unauthenticated users redirect back to `/login`

### 2. Authenticated landing

- Sign in with a valid allowed account or equivalent local dev session
- Confirm the authenticated home page loads
- Confirm there are no browser console errors

### 3. First-turn chat flow

- Ask one simple question from the home page
- Confirm the app moves onto a conversation URL
- Confirm the user message appears
- Confirm the assistant response appears
- Confirm the UI does not remain stuck in a pending state

### 4. Follow-up chat flow

- Ask a second question in the same conversation
- Confirm the request stays on the same conversation page
- Confirm the second user message appears
- Confirm the second assistant response appears
- Confirm the UI does not silently no-op

If the branch touches form submission, HTMX wiring, keyboard handling, or input
components, exercise both:

- Enter-key submit
- submit-button click

### 5. Existing transcript rendering

- Open an existing conversation directly, either via a seeded transcript or a
  conversation created during QA
- Confirm persisted user and assistant turns render correctly

### 6. Branch-specific scenario

- Run the ticket-specific flow that motivated the change
- If the branch changes retry, streaming, auth, routing, or other shared
  infrastructure, include the adjacent user flow most likely to break

## When to widen the sweep

Broaden QA beyond the minimum matrix when the branch touches shared boundaries:

- `src/web-ui/squire.js` or other browser event wiring
  - re-run first-turn and follow-up chat flows
- `src/server.ts` route handling or SSE/event translation
  - re-run chat creation, follow-up messages, and stream completion behavior
- auth/session/CSRF code
  - re-run login, logout, redirect behavior, and an authenticated POST
- layout or rendering primitives
  - re-run the key pages affected by those primitives, not just the target page

The rule is simple: if the changed code is shared, QA the neighboring flow, not
just the ticket flow.

## Evidence expectations

Capture enough evidence that another engineer can trust the result:

- screenshots for the key verified states
- console errors if anything fails
- network evidence when browser behavior contradicts the visible DOM
- the exact local port and branch under test

When a bug appears browser-side, inspect both:

- the DOM state after the action
- the actual request sent on submit/stream start

Do not assume the DOM and the request path match.

## Testing versus QA

Automated tests and manual QA are different gates:

- automated tests prove known contracts
- QA catches integration and browser-state failures that tests may not model yet

If QA finds a regression that should never recur, add an automated regression
test before shipping.
