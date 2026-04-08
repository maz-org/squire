# Web UI Eng Review — Interactive Walkthrough

**Status:** ✅ APPLIED 2026-04-08 — all 20 decisions landed in Linear + docs. See "Applied changes summary" at the bottom.

**Superseded in part by** [`web-ui-f4481c1cff1d-design-review-walkthrough.md`](web-ui-f4481c1cff1d-design-review-walkthrough.md) (2026-04-08, same day). The design review rewrote the chat surface as a current-turn ledger rather than a message list, so the "HTMX `hx-swap` regions do not reflow the visible message list" AC under concern #17 below is obsolete — SQR-5 no longer has a visible message list to reflow. All other decisions here still stand. When in doubt, the design walkthrough is the newer source of truth for UI surface behavior.

**Started:** 2026-04-08
**Branch:** `claude/eager-mccarthy`
**Reviewer:** plan-eng-review skill, Claude Opus 4.6
**Scope:** Squire Web UI Linear project + sibling projects in the Phase 1 initiative
**Initiative:** [Squire · Phase 1: MVP Rules Q&A at the Table](https://linear.app/maz-org/initiative/squire-phase-1-mvp-rules-qanda-at-the-table-7e1f0057e448)
**Related file:** `/Users/bcm/.claude/plans/hidden-fluttering-phoenix.md` — the initial narrower plan-eng-review writeup (now partly superseded by this walkthrough — this is the durable record).

This file is a crash-resilient record of the concerns surfaced, the decisions taken for each, and the Linear/doc changes that need to be applied when the walkthrough finishes. **Source of truth during the walkthrough.** If the session crashes or compacts, resume from the last "RESOLVED" decision and continue walking down the list.

---

## Context loaded before the walkthrough

**Full initiative contents (Phase 1: MVP Rules Q&A at the Table):**

| Project | Status | Issues |
| --- | --- | --- |
| Squire · Storage & Data Migration | In Progress | SQR-31 (done), SQR-32 (done), SQR-33 (done), SQR-34 (done), SQR-55 (done), SQR-56 (in progress), SQR-57 (todo), SQR-35 (todo), SQR-36 (todo), SQR-50 (todo) |
| Squire · User Accounts | Planned | SQR-13, SQR-37, SQR-38, SQR-39, SQR-40 |
| Squire · Web UI | In Progress | SQR-5, SQR-6, SQR-7, SQR-8, SQR-9, SQR-10, SQR-11, SQR-12 |
| Squire · Deployment | Planned | SQR-41, SQR-42, SQR-43, SQR-44, SQR-45, SQR-46, SQR-51 |
| Squire · Production Readiness | Planned | SQR-52, SQR-53 (done), SQR-54 (done) |

**Docs read:**

- `docs/SPEC.md` v3.0.1 (2026-04-07)
- `docs/ARCHITECTURE.md` v1.0.1 (2026-04-07)
- `docs/SECURITY.md` (2026-04-07)
- `docs/agent/code-quality.md`
- `docs/agent/testing.md`

**Key spec facts guiding every decision below:**

- Phase 1 is single-user by policy ("auth is real so it's not bypassable")
- Web identity is **Google OAuth only** (extends existing `@modelcontextprotocol/sdk` auth handlers)
- Campaign/character state is Phase 4 — not Phase 1
- Conversation agent calls knowledge agent **in-process**, not HTTP self-call
- Long-lived (30-day) OAuth tokens are a deliberate DX choice (see feedback memory)
- Tests: tiered coverage, 100% on core business logic, TDD red-green-refactor
- `game` column already on all tables, filtering lands in Phase 2

---

## Correction to the initial narrow review

My first pass (see `hidden-fluttering-phoenix.md`) flagged "auth is missing entirely" as a P0. That was wrong — I only read the Web UI project and missed User Accounts, Deployment, Production Readiness, and Storage. Auth work lives in User Accounts (SQR-37/38/39/40/13), health checks in Deployment (SQR-46), Docker in Deployment (SQR-42), etc. The **real** problems after reading the whole initiative are worse: the User Accounts project is based on the pre-v2.0 email+password design and never got refreshed when SPEC v2.0 moved to Google OAuth. The Web UI project still has real issues but they're smaller than originally flagged.

---

## Concern list (20 items)

Each concern has:

- **Status:** OPEN / RESOLVED / DEFERRED
- **Decision:** (filled in as we walk)
- **Actions:** concrete Linear/doc edits to apply when walkthrough finishes

### P0 — Scope / spec contradictions

---

#### 1. Auth mechanism contradiction *(RESOLVED)*

**Problem:** SPEC v3.0.1 + ARCHITECTURE.md both explicitly say "Google OAuth as the only identity provider for the web channel" and justify the choice (reuses MCP OAuth, no per-MAU pricing, no SaaS vendor dependency). But SQR-37 says "Email + password (hashed with bcrypt or argon2)", SQR-38 says "POST /auth/login endpoint (email + password)", SQR-13 says "Login page (email + password), Registration page". The whole User Accounts project is based on the pre-v2.0 design.

**Decision:** **A — Rewrite tickets to Google OAuth.** Align the User Accounts project to SPEC/ARCHITECTURE. Single "Sign in with Google" button. Callback creates a Postgres session. No password store.

**Actions:**

- Rewrite/replace SQR-37 (see concern #2 for the specific disposition)
- Rewrite SQR-38 from "email+password login" to "Google OAuth flow + session management"
- Rewrite SQR-13 from "Login/Registration pages" to "Frosthaven-themed sign-in page with Google button + logout"
- SQR-39 (CSRF) is already correct; minor wording polish only
- SQR-40 (user profile) — see concern #5

---

#### 2. SQR-37 public registration is Phase 3 work *(RESOLVED)*

**Problem:** With Google OAuth (decision #1), there's no self-serve registration form. Identity creation becomes: Sign in with Google → OAuth callback → allowlist check → upsert user row → create session. SQR-37's "POST /auth/register, email validation, duplicate detection" is Phase 3 multi-user work.

**Decision:** **A — Delete SQR-37; fold the "upsert on first sign-in" logic into a new Google OAuth callback ticket.**

**Actions:**

- Delete SQR-37 from Linear
- Create a new ticket in User Accounts: **"Google OAuth web login flow + user upsert + allowlist check"** (or rename SQR-38 to cover this — see concern #1's SQR-38 action)

---

#### 3. Email allowlist for single-user MVP *(RESOLVED)*

**Problem:** SPEC Phase 1 says "single-user, but auth is real so it's not bypassable." Google OAuth by itself isn't single-user; anyone with a Google account could sign in. We need an allowlist check in the callback that rejects non-allowlisted emails. Nothing in Linear covers this.

**Decision:** **C — Hard-coded single email constant in the auth callback.** Fastest, single-user MVP has one entry. Swap to env var or DB-backed list in Phase 3 when multi-user lands.

**Actions:**

- Add to the new Google OAuth callback ticket (concern #2): "Reject any OAuth callback whose email doesn't match the hard-coded `ALLOWED_EMAIL` constant. Return a clean 'not authorized' page."
- Document the constant's location (likely `src/auth.ts` or a new `src/web-auth.ts`) in the ticket acceptance criteria

---

#### 4. SQR-11 Campaign picker is Phase 4 work *(RESOLVED)*

**Problem:** SPEC §"Phase 1 — Out of scope" explicitly lists "Any campaign or character state". SPEC §"Character State Management": "Campaign and character state lands in Phase 4." SQR-11's description ("Show user's campaigns on login, Allow switching campaigns mid-session, Pass selected campaignId to /api/ask") directly contradicts Phase 1 scope.

**Decision:** **A — Move SQR-11 to a future Phase 4 project.** Preserve the ticket for when Phase 4 work starts. Remove from Phase 1 initiative and from Web UI project.

**Actions:**

- Remove SQR-11 from the Squire · Web UI project
- If a Phase 4 project exists, move there; otherwise park in the team backlog with no project and a `phase-4` label or reference in the description
- Update SQR-11's description to note the Phase 4 dependency on data isolation design (per SECURITY.md §3)

---

#### 5. SQR-40 User profile/settings is coupled to Phase 4 *(RESOLVED)*

**Problem:** SQR-40 says "Campaign membership list" as one of the profile fields. No campaigns in Phase 1. Plus for a single-user Google-OAuth MVP, display name and email come from the Google ID token and there are no settings to configure.

**Decision:** **A — Move SQR-40 to Phase 4 alongside SQR-11.** Profile UI only makes sense once there are campaigns, characters, and multi-user concerns.

**Actions:**

- Remove SQR-40 from the User Accounts project
- Move to Phase 4 project (same destination as SQR-11)

---

### P1 — Architecture / clarity

---

#### 6. SQR-7 wording contradicts ARCHITECTURE.md *(RESOLVED)*

**Problem:** SQR-7 says "The conversation agent calls `/api/ask`." ARCHITECTURE.md says: "The conversation agent calls this entry point via in-process function call, not HTTP. The HTTP endpoint exists for testing and for other channels."

**Decision:** **A — Update SQR-7 description to say 'in-process function call to the knowledge agent'.**

**Actions:**

- Edit SQR-7 description: replace `/api/ask` reference with "the knowledge agent's in-process entry point (direct function call, not HTTP)"
- Add explicit note: "Self-HTTP is NOT the pattern. See ARCHITECTURE.md §Two-agent split."

---

#### 7. SQR-8/9/10 SSE wire protocol split across three tickets *(RESOLVED)*

**Problem:** Three tickets but one design problem: what events the SSE stream emits and how HTMX renders them. Splitting invites incompatible event vocabularies and conflicts on shared rendering targets.

**Decision:** **A — Bundle SQR-8 + SQR-9 + SQR-10 into one ticket "Streaming chat protocol: deltas, tool indicators, citations".** One wire format, one implementer, one test suite.

**Actions:**

- Keep SQR-8 as the retained ticket; retitle to "Streaming chat protocol: text deltas, tool indicators, citations"
- Fold SQR-9's and SQR-10's content into SQR-8's description as explicit deliverables
- Delete SQR-9 and SQR-10 (or close as "moved into SQR-8")
- SQR-8's acceptance criteria must specify: (a) the SSE event vocabulary (event types, payload shapes), (b) HTMX rendering strategy per event type, (c) text-delta accumulation policy, (d) error event semantics, (e) mid-stream disconnect handling

---

#### 8. SQR-12 context compaction may be premature *(RESOLVED)*

**Problem:** Sonnet 4.6 has 200k context. MVP sessions are short (phone at the table, typically <20 turns). LLM summarization adds 1–3s latency on the turn that crosses the threshold. The problem SQR-12 solves doesn't exist for single-user Phase 1.

**Decision:** **A — Defer SQR-12 to Phase 3 multi-user.** Multi-user brings concurrent long sessions and cost pressure. For single-user MVP, don't build it.

**Actions:**

- Remove SQR-12 from the Web UI project
- Move to the Phase 3 "Multi-user platform" project if one exists; otherwise park in the team backlog with a phase-3 reference
- Update SQR-12's description to note the deferral reason (context budget is not the bottleneck in single-user MVP)

---

#### 9. SQR-13 cross-project dependency on SQR-5 not captured *(RESOLVED)*

**Problem:** SQR-13 (auth UI, in User Accounts) says "consistent with chat UI" — but the chat UI shell lives in SQR-5 (Web UI). Cross-project dependency not captured in either ticket.

**Decision:** **A — Move SQR-13 into the Web UI project; add explicit dependency on SQR-5.** All UI work lives in Web UI; User Accounts becomes strictly backend (sessions, OAuth flow, middleware).

**Actions:**

- Move SQR-13 from User Accounts → Web UI project
- Rewrite SQR-13 description for Google OAuth (per decision #1): single "Sign in with Google" button, logout button, "access denied" page for non-allowlisted emails, "current user" display in chat header
- Add explicit "Blocked by: SQR-5" relation
- Remove "Login page (email + password), Registration page" — no longer applicable post-decision #1 and #2

---

### P1 — Missing tickets

---

#### 10. No Cloudflare WAF configuration ticket *(RESOLVED)*

**Problem:** SPEC Phase 1 mandates 'Hosted publicly behind Cloudflare WAF'. ARCHITECTURE.md §'Edge layer' specifies DDoS protection, edge rate limiting, bot mitigation. Production Readiness project description mentions WAF but no ticket exists.

**Decision:** **A — Create new ticket in Production Readiness project.** Matches the project's stated purpose.

**Actions:**

- Create SQR-NEW in Production Readiness: "Cloudflare WAF configuration"
- Scope: DNS setup, origin cert/mode (Full Strict), WAF managed ruleset selection, edge rate-limit rules, bot fight mode, challenge page config, page rules if any
- Depends on: hosting platform decision (concern #11) for origin address
- Depends on: at least a staging environment existing (concern #11 / Deployment project)

---

#### 11. No hosting platform decision ticket *(RESOLVED)*

**Problem:** ARCHITECTURE.md open tech question. Fly.io vs Railway vs Render vs self-hosted VPS. Deployment project can't start until this is decided — Dockerfile and CI/CD pipeline shape are host-specific.

**Decision:** **A — Create a Decision ticket in Production Readiness: 'Decide Phase 1 hosting platform'.** Short ticket producing an ADR-style decision doc.

**Actions:**

- Create SQR-NEW in Production Readiness: "Decide Phase 1 hosting platform"
- Output: `docs/decisions/hosting-platform.md` (ADR format) with chosen host, rationale, cost estimate, migration path if wrong
- Blocks: SQR-42 (Docker), SQR-44 (CI/CD), and the new Cloudflare WAF ticket from concern #10
- Update ARCHITECTURE.md §"Open Tech Questions" to reference the decision ticket once created; update §"Deployment" once resolved

---

#### 12. No web-chat rate limiting ticket *(RESOLVED)*

**Problem:** SECURITY.md §5 calls for per-user rate limits on `/api/ask` and daily cost budget circuit breaker. SQR-52 covers `/register` only.

**Decision:** **A — Create one ticket in Production Readiness covering both rate limit and cost budget.**

**Actions:**

- Create SQR-NEW in Production Readiness: "Per-user rate limit + daily cost budget circuit breaker"
- Scope: (a) Hono middleware token bucket on `/api/ask` and chat endpoints, generous default for single user (e.g. 30 req/min), (b) daily $ budget for Claude API calls with hard circuit-break when exceeded, (c) Langfuse integration for budget tracking, (d) clear user-visible error when budget tripped
- Acceptance: integration test that 31 req in a minute produces a 429; unit test that cost tracking increments correctly

---

#### 13. No CSP / LLM-output XSS ticket *(RESOLVED)*

**Problem:** SECURITY.md §7 explicitly calls out that prompt injection can become stored XSS if LLM output is rendered unsanitized. Mitigations listed: escape LLM output, CSP headers, sanitizing markdown renderer. Nothing in Linear covers this.

**Decision:** **A — Create ticket in Web UI project: 'CSP headers + LLM output sanitization'.**

**Actions:**

- Create SQR-NEW in Web UI: "CSP headers + LLM output sanitization"
- Scope: (a) CSP middleware emitting `default-src 'self'`, `script-src` allowlist (including Tailwind CDN if retained — see concern #18), `object-src 'none'`, no inline scripts, (b) HTML-escape all LLM text output by default in JSX rendering, (c) if using markdown: sanitizing renderer (strip tags or use a safelist), (d) unit test for a prompt-injection-via-tool-result case, (e) integration test asserting CSP header present on all responses
- Blocked by: SQR-8 (streaming protocol) — needs the event rendering path to exist before you can sanitize it

---

### P2 — Project hygiene

---

#### 14. Production Readiness project is thin / misfiled *(RESOLVED)*

**Problem:** SQR-53/54 (CLAUDE.md split, Done) don't belong in Production Readiness semantically — they're docs housekeeping. SQR-52 is real. The project description claims health checks (live in Deployment) and CSRF (lives in User Accounts).

**Decision:** **A — Move SQR-53/54 out of Production Readiness and out of the Phase 1 initiative.** Project gains 3 new tickets from concerns #10–12 (Cloudflare WAF, hosting decision, rate limit + budget) and stays focused on its stated purpose.

**Actions:**

- Remove SQR-53 and SQR-54 from Production Readiness project (set project to none or create a "Dev Experience / Tooling" catch-all)
- Remove SQR-53 and SQR-54 from Phase 1 initiative
- Update Production Readiness project description to reflect the new ticket set (Cloudflare, hosting, rate limit + budget; plus SQR-52 already there)

---

#### 15. SQR-43 (Database migration scripts) likely redundant *(RESOLVED)*

**Problem:** Drizzle-kit is already the chosen migration tool (SQR-31/32). SQR-43 says "node-pg-migrate, Drizzle migrations, or similar" — that decision is made.

**Decision:** **A — Rescope SQR-43 to "Wire drizzle-kit migrate into deploy pipeline".**

**Actions:**

- Rewrite SQR-43 description: scope is running `drizzle-kit migrate` automatically on deploy (via Dockerfile entrypoint or CI/CD pre-deploy step, whichever fits the host)
- Acceptance criteria: migrations run automatically on deploy, failure aborts deploy, rollback procedure documented
- Depends on: hosting decision (concern #11) and SQR-42 Dockerfile

---

#### 16. Tests missing from all Web UI ticket acceptance criteria *(RESOLVED)*

**Problem:** Uniform gap. `docs/agent/testing.md` requires TDD + tiered coverage.

**Decision:** **A — Add explicit 'Tests' section to each Web UI ticket as part of the apply phase.**

**Actions:** For each Web UI ticket, add a "Tests" acceptance criteria block:

- **SQR-5:** snapshot test on JSX render; viewport meta present; Frosthaven theme class presence
- **SQR-6:** integration test on HTMX POST/render cycle; empty input handling; swap target correctness
- **SQR-7:** 100% unit coverage (core business logic). Mock the knowledge agent. Integration test against a real test DB for session persistence. Error from knowledge agent. Reference resolution NOT performed here (boundary assertion)
- **SQR-8 bundle:** integration test for SSE event sequence (text → tool-start → tool-result → text → done); citation event render; mid-stream error; client disconnect cleanup; no silent text leak across tool boundary
- **SQR-13 (after move):** integration test for sign-in redirect, allowlist rejection page, logout, current-user-in-header
- **New CSP/XSS ticket (from concern #13):** unit tests for escaping; integration asserting CSP header present; adversarial prompt pass (per concern #20)

---

#### 17. SQR-5 mobile responsiveness has no acceptance criteria *(RESOLVED)*

**Problem:** "Responsive layout" without a concrete bar.

**Decision:** **B — Use the proposed bar PLUS Lighthouse mobile score ≥90.**

**Actions:** Add to SQR-5 acceptance criteria:

- Tested at 375×812 (iPhone class)
- Body text ≥16px (prevents iOS focus-zoom on inputs)
- Tap targets ≥44×44px
- No horizontal scroll at 375px
- HTMX `hx-swap` regions do not reflow the visible message list
- Lighthouse mobile score ≥90 (with the specific category bars relaxed/tightened as the design review dictates)

---

#### 18. Tailwind CDN production strategy undecided *(RESOLVED)*

**Problem:** The real tradeoff is cdn.tailwindcss.com JIT-runtime (~350KB JS blob that runs Tailwind's JIT in the browser) vs. pre-built CSS via Tailwind CLI (10–30KB static file with only the classes you use). Origin host doesn't matter because Cloudflare fronts everything.

**Decision:** **C — Use Tailwind CLI; serve pre-built `/public/app.css` through Cloudflare; update ARCHITECTURE.md to document the 'no bundler, one CSS build command' stance.**

**Actions:**

- Add to SQR-5 acceptance criteria: `npm run build:css` via Tailwind CLI emits `public/app.css`; layout loads local CSS, not the CDN JIT runtime; build step runs as part of CI and Docker image build
- Update ARCHITECTURE.md §"Stack → Web channel": replace "Tailwind CSS via CDN" with "Tailwind CSS pre-built via Tailwind CLI into `public/app.css`; no bundler, single-command build". Explain the rationale inline (CDN is JIT-runtime, not static; smaller file, no FOUC, CSP stays on 'self', same Cloudflare edge-cache benefit)

---

#### 19. Dependency ordering (originally "dates") *(RESOLVED)*

**Problem:** Web UI project has hard dependencies on User Accounts (sessions + Google OAuth) that aren't captured in Linear Relations OR "Depends on:" description lines. (Original "unrealistic dates" framing retracted — dates reflect intentional AI-velocity planning per user feedback.)

**Retracted sub-point:** Do not flag stacked/close project dates in this repo as unrealistic — see `feedback_dates_are_ai_velocity.md`.

**Correction:** Initially inferred that the repo "doesn't use Linear Relations" based on absence of evidence in `get_issue` responses. That was wrong — `get_issue` hides relations by default; you must pass `includeRelations: true`. Actual convention (verified): repo uses **both** Linear Relations (blockedBy/blocks) AND "Depends on:" text lines in descriptions. See `feedback_check_linear_relations.md`.

**Decision:** **A — Add both Linear blockedBy relations AND "Depends on:" text lines** to Web UI tickets.

**Actions:**

- **SQR-6** blockedBy the User Accounts Google OAuth + sessions ticket (SQR-38 after rewrite). Add "Depends on:" line in description.
- **SQR-7** blockedBy SQR-38 (sessions + userId). Add "Depends on:" line.
- **SQR-8-bundle** (the retained SQR-8 after merging SQR-9/10) blockedBy SQR-7. Add "Depends on:" line.
- **New CSP/XSS ticket** blockedBy SQR-8-bundle. Add "Depends on:" line.
- SQR-5 remains unblocked (can run in parallel with User Accounts from the start).
- **SQR-13** (after move to Web UI, concern #9) blockedBy SQR-5 + SQR-38.

---

#### 20. Prompt injection test suite — Phase 1 or Phase 3? *(RESOLVED)*

**Problem:** SPEC Phase 3 lists it explicitly; SECURITY.md calls it out without naming a phase. The CSP/XSS ticket lands in Phase 1 but doesn't include adversarial tests.

**Decision:** **A — Minimal Phase 1 adversarial test pass folded into the CSP/XSS ticket's acceptance criteria.** 5–10 hand-curated prompts, not a full suite. Full suite stays Phase 3.

**Actions:**

- Add to the new CSP/XSS ticket: "Adversarial test pass: 5–10 hand-curated prompts cover: (a) `<script>` in LLM output, (b) `<img onerror>`, (c) markdown link with `javascript:` URL, (d) prompt-injection-via-tool-result (adversarial card name that contains HTML), (e) stored-XSS on re-render from history. Run on every PR that touches the agent loop or rendering path. Not the full SPEC Phase 3 resistance suite — just enough to prove the escape path works."

---

## Decisions summary

| # | Concern | Status | Decision |
| --- | --- | --- | --- |
| 1 | Auth mechanism contradiction | RESOLVED | Rewrite User Accounts to Google OAuth |
| 2 | SQR-37 public registration | RESOLVED | Delete SQR-37; fold upsert into the Google OAuth callback ticket |
| 3 | Email allowlist | RESOLVED | Hard-coded constant in auth callback |
| 4 | SQR-11 Campaign picker | RESOLVED | Move to Phase 4 project (or backlog w/ phase-4 label) |
| 5 | SQR-40 profile coupling | RESOLVED | Move to Phase 4 alongside SQR-11 |
| 6 | SQR-7 wording | RESOLVED | Rewrite to "in-process function call" |
| 7 | SQR-8/9/10 SSE protocol | RESOLVED | Bundle into one SQR-8 "Streaming chat protocol"; delete SQR-9 and SQR-10 |
| 8 | SQR-12 compaction | RESOLVED | Defer to Phase 3 multi-user |
| 9 | SQR-13 cross-project dep | RESOLVED | Move SQR-13 to Web UI; rewrite for Google OAuth |
| 10 | Cloudflare WAF ticket | RESOLVED | Create new ticket in Production Readiness |
| 11 | Hosting platform decision | RESOLVED | Create decision ticket in Production Readiness |
| 12 | Web-chat rate limit + budget | RESOLVED | One ticket in Production Readiness (rate limit + cost budget) |
| 13 | CSP / XSS ticket | RESOLVED | New ticket in Web UI for CSP + sanitization |
| 14 | Production Readiness hygiene | RESOLVED | Move SQR-53/54 out of Phase 1 initiative and this project |
| 15 | SQR-43 redundancy | RESOLVED | Rescope to "Wire drizzle-kit migrate into deploy pipeline" |
| 16 | Tests missing from Web UI tickets | RESOLVED | Add explicit Tests section to each Web UI ticket |
| 17 | SQR-5 mobile AC | RESOLVED | Proposed bar + Lighthouse mobile ≥90 |
| 18 | Tailwind CDN production | RESOLVED | Tailwind CLI pre-build; update ARCHITECTURE.md |
| 19 | Dependency capture (was "dates") | RESOLVED | Add blockedBy relations AND "Depends on:" lines |
| 20 | Prompt injection tests | RESOLVED | Minimal 5–10 adversarial tests folded into CSP ticket |

---

## Consolidated Linear actions (apply phase)

### Delete

- **SQR-9** — "Tool visibility in chat UI" — content folded into SQR-8
- **SQR-10** — "Citations and source display" — content folded into SQR-8
- **SQR-37** — "User registration and signup" — no-self-serve-registration under Google OAuth

### Move (project change)

- **SQR-11** — Web UI → Phase 4 project (create if missing) or backlog w/ phase-4 label
- **SQR-40** — User Accounts → same Phase 4 destination
- **SQR-12** — Web UI → Phase 3 "Multi-user platform" project (create if missing) or backlog w/ phase-3 label
- **SQR-13** — User Accounts → Web UI
- **SQR-53, SQR-54** — Production Readiness → null (or a "Dev Experience / Tooling" catch-all); also remove from Phase 1 initiative

### Rewrite (description update)

- **SQR-5** — Add Tailwind CLI build step, mobile AC (375×812, ≥16px body, ≥44px taps, no horizontal scroll, stable HTMX swaps, Lighthouse ≥90), Tests section (JSX snapshot + viewport meta)
- **SQR-6** — Add "Depends on: SQR-38", Tests section (HTMX integration)
- **SQR-7** — Replace "/api/ask" reference with "in-process function call to the knowledge agent"; add Tests section (100% unit + real-DB persistence integration); add "Depends on: SQR-38"; define chat_sessions / chat_messages schema as part of ticket scope
- **SQR-8** — Retitle to "Streaming chat protocol: text deltas, tool indicators, citations"; fold SQR-9 and SQR-10 content into description; define SSE event vocabulary, HTMX rendering strategy, error/disconnect semantics; add "Depends on: SQR-7"; add Tests section (SSE integration)
- **SQR-13** — Rewrite for Google OAuth: sign-in page with "Sign in with Google" button, logout, "not authorized" page for non-allowlisted emails, current-user-in-header. Remove email+password language. Add "Depends on: SQR-5 + SQR-38". Add Tests section
- **SQR-38** — Rewrite for Google OAuth + allowlist: `/auth/google/start`, `/auth/google/callback`, allowlist check via hard-coded `ALLOWED_EMAIL` constant, upsert user on first sign-in, Postgres-backed session creation, `/auth/logout`, `/auth/me`. Keep HttpOnly+Secure+SameSite cookies requirement. Reuses `@modelcontextprotocol/sdk` OAuth handlers where applicable. Remove email+password language
- **SQR-39** — Minor: confirm wording matches the new Google OAuth + HTMX world; CSRF strategy should explicitly mention HTMX token injection
- **SQR-43** — Rescope to "Wire drizzle-kit migrate into deploy pipeline"; acceptance: migrations run on deploy, failure aborts deploy, rollback procedure documented. Depends on: hosting decision + SQR-42
- **SQR-11** — Add note that Phase 4 dependency is the data isolation design (SECURITY.md §3)
- **SQR-12** — Add note that deferral reason is "context budget not the bottleneck in single-user MVP"

### Create

- **NEW-1 (Production Readiness)** — "Cloudflare WAF configuration"
  - DNS setup, origin cert/mode (Full Strict), WAF managed ruleset, edge rate-limit rules, bot fight mode, challenge page config
  - Depends on: hosting platform decision (NEW-2)
- **NEW-2 (Production Readiness)** — "Decide Phase 1 hosting platform"
  - ADR output at `docs/decisions/hosting-platform.md`: chosen host, rationale, cost estimate, migration path
  - Blocks: SQR-42 Docker, SQR-44 CI/CD, NEW-1 Cloudflare
- **NEW-3 (Production Readiness)** — "Per-user rate limit + daily cost budget circuit breaker"
  - Hono middleware token bucket on `/api/ask` and chat endpoints (30 req/min default)
  - Daily $ budget for Claude API with hard circuit-break when exceeded
  - Langfuse integration for spend tracking
  - Acceptance: integration test for 429 on 31 req/min; unit test for cost tracking
- **NEW-4 (Web UI)** — "CSP headers + LLM output sanitization + adversarial test pass"
  - CSP middleware (`default-src 'self'`, `script-src` allowlist, `object-src 'none'`, no inline scripts)
  - HTML-escape all LLM text output in JSX rendering by default
  - If using markdown: sanitizing renderer
  - Unit test for injection-via-tool-result
  - Integration test asserting CSP header on all responses
  - Adversarial 5–10 prompt pass: `<script>`, `<img onerror>`, `javascript:` URL, poisoned card name, stored-XSS re-render
  - Depends on: SQR-8 (rendering path must exist first)

### Add Linear Relations (blockedBy/blocks)

- SQR-6 blockedBy SQR-38
- SQR-7 blockedBy SQR-38
- SQR-8 blockedBy SQR-7 (after retitle)
- SQR-13 blockedBy SQR-5, SQR-38 (after move)
- NEW-4 (CSP ticket) blockedBy SQR-8
- NEW-1 (Cloudflare) blockedBy NEW-2 (hosting decision)
- NEW-1, NEW-2 each blocks SQR-42 (Docker) and SQR-44 (CI/CD)

### Project description updates

- **Squire · User Accounts** — Rewrite goal from "multiplayer campaigns, registration, login" to "Google OAuth web login, Postgres-backed sessions, CSRF for the single-user MVP. Registration and multi-user are explicitly Phase 3."
- **Squire · Web UI** — Add dependency ordering paragraph showing: SQR-5 parallel with User Accounts; SQR-6/7/8/NEW-4 blocked on SQR-38. Note that SQR-11/12 have been moved to later phase projects.
- **Squire · Production Readiness** — Update description to reflect new ticket set (SQR-52 + NEW-1 + NEW-2 + NEW-3). Remove "health checks" (lives in Deployment SQR-46) and "CSRF protection" (lives in User Accounts SQR-39) from the scope claims. Note that SQR-53/54 have been removed as docs housekeeping.

---

## Consolidated doc actions (apply phase)

### Update `docs/ARCHITECTURE.md`

- §"Stack → Web channel": replace "Tailwind CSS via CDN" with "Tailwind CSS pre-built via Tailwind CLI into `public/app.css` — no bundler, one CSS build command; see rationale below." Add a short paragraph explaining the CDN-is-JIT-runtime vs pre-built-CSS tradeoff.
- §"Open Tech Questions": update the hosting platform bullet to reference the NEW-2 decision ticket.
- §"Two-agent split" / §"Agent Architecture": no content changes, but the SQR-7 wording fix aligns the ticket with what's already there — noting here in case a future refresh wants to add a pointer.

### Create `docs/decisions/hosting-platform.md`

- ADR skeleton: context, options considered (Fly/Railway/Render/VPS), decision, rationale, consequences, cost estimate, migration path if wrong. Filled by NEW-2.

### No changes to `docs/SECURITY.md`

- SECURITY §2 update is already scoped under SQR-50 (Storage project). Don't duplicate.

---

## Memory files added during walkthrough (may promote to repo docs)

1. **`~/.claude/projects/-Users-bcm-Projects-maz-squire/memory/feedback_dates_are_ai_velocity.md`** — Don't flag stacked/close Linear project dates in squire as unrealistic; they reflect intentional AI-assisted velocity planning.
2. **`~/.claude/projects/-Users-bcm-Projects-maz-squire/memory/feedback_check_linear_relations.md`** — Always pass `includeRelations: true` to Linear `get_issue` before asserting repo dependency conventions; don't infer from absence.

User asked me to reconsider whether to also document these in the repo. Revisit after the apply phase.

---

## Applied changes summary (2026-04-08)

### Linear — tickets updated in place

- **SQR-5** (layout): Tailwind CLI build step, mobile AC (375×812, ≥16 px body, ≥44 px taps, Lighthouse mobile ≥90), tests section
- **SQR-6** (chat UI): deps on SQR-5/SQR-7/SQR-38, error + empty states, CSRF coordination, integration tests
- **SQR-7** (conversation agent): in-process-vs-HTTP wording fix, chat_sessions/chat_messages schema ownership, 100 % coverage tests
- **SQR-8** (streaming): retitled "Streaming chat protocol: text deltas, tool indicators, citations"; folded SQR-9 + SQR-10; defined SSE event vocabulary + boundary rules
- **SQR-11** (campaign picker): deferred note → Phase 4 Campaign State (also moved)
- **SQR-12** (compaction): deferred → Phase 3; reasoning recorded (200 k context headroom, latency cost)
- **SQR-13** (sign-in UI): rewritten for Google OAuth; moved to Web UI; deps on SQR-5 + SQR-38
- **SQR-38** (auth): rewritten for Google OAuth + Postgres sessions + hard-coded allowlist; moved to Web UI
- **SQR-39** (CSRF): HTMX integration pattern spelled out; depends on SQR-38
- **SQR-43** (migrations): rescoped to "Wire drizzle-kit migrate into deploy pipeline"

### Linear — tickets canceled (folded or obsolete)

- **SQR-9** (tool visibility) — folded into SQR-8
- **SQR-10** (citations) — folded into SQR-8
- **SQR-37** (registration) — Google OAuth handles upsert, no self-serve

### Linear — tickets moved

- **SQR-11**, **SQR-40** → Phase 4 Campaign State project
- **SQR-13**, **SQR-38** → Web UI project

### Linear — tickets created

- **SQR-58** — Cloudflare WAF configuration for Phase 1 MVP (Production Readiness)
- **SQR-59** — Decide Phase 1 hosting platform (ADR) (Production Readiness)
- **SQR-60** — Per-user rate limit + daily cost budget circuit breaker (Production Readiness)
- **SQR-61** — CSP headers + LLM output sanitization + adversarial test pass (Web UI)

### Linear — `blockedBy` relations wired

- SQR-6 ← SQR-5, SQR-38, SQR-7
- SQR-7 ← SQR-38
- SQR-8 ← SQR-7
- SQR-13 ← SQR-5, SQR-38
- SQR-38 ← SQR-34
- SQR-39 ← SQR-38
- SQR-60 ← SQR-38
- SQR-61 ← SQR-8
- SQR-58 ← SQR-59
- SQR-42 ← SQR-59
- SQR-44 ← SQR-59

### Linear — project descriptions rewritten

- **Squire · User Accounts** — scope reframed around Google OAuth + allowlist
- **Squire · Web UI** — explicit dependency order + ticket list + out-of-scope callouts
- **Squire · Production Readiness** — updated ticket set + SQR-59 as project gate

### Docs

- `docs/ARCHITECTURE.md` §"Web channel" — Tailwind CDN → Tailwind CLI, with rationale
- `docs/decisions/hosting-platform.md` — ADR stub created (filled in by SQR-59)

### Memory files added

- `feedback_dates_are_ai_velocity.md`
- `feedback_check_linear_relations.md`
