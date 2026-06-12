# Phase 4: Campaign & Character State — Initiative Plan

**Status:** CEO-reviewed (2026-06-12); pending eng + design review
**Date:** 2026-06-12
**Initiative:** [Squire · Phase 4: Campaign & Character State](https://linear.app/maz-org/initiative/squire-phase-4-campaign-and-character-state-8cf1a4106ea0)
**CEO plan:** `~/.gstack/projects/maz-org-squire/ceo-plans/2026-06-12-phase-4-campaign-character-state.md`
**Lifecycle:** staging artifact per `docs/agent/planning-artifacts.md` — promote
durable decisions to ADRs / ARCHITECTURE.md / SPEC.md post-merge, then delete.

## Why now

Phases 1–3 shipped the walking skeleton: rules Q&A at the table (FH + GH2),
multi-user-safe public access, rate/cost controls, regression gates, and — as
of this week — an agentic chat shell (history rail, agent work log, progress
visibility). The knowledge agent is a production LangGraph graph (ADR 0019)
behind a stable `ask()` boundary with a self-describing tool contract that
already reserves `campaign`, `character`, and `party` entity kinds.

Phase 4 is the pivot from _generic rules reference_ to _personalized
companion_: Squire knows who you are, what your party looks like, and which
character you're playing. It is the prerequisite for Phase 5 (recommendations),
Phase 6 (automated ingestion), and Phase 7 (spoiler protection).

Landscape (2026-06-12): the tracker space is crowded and good — Gloomhaven
Secretariat, Gloomhaven Campaign Tracker, the official Frosthaven companion
app, frosthaven-storyline. None has an agent layer. Squire does not try to
out-tracker the trackers; its wedge is conversational state entry plus
rules-grounded personalization, with Phase 6 later syncing from the trackers
people already use.

## CEO scope decisions (2026-06-12)

| #    | Decision                                                                                             | Outcome                                                                                              |
| ---- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| D1   | Implementation approach: A = forms-only (SPEC-literal), B = agent-first writes, C = dual write paths | C ACCEPTED                                                                                           |
| D2   | Review mode: selective expansion (hold four-pillar baseline, cherry-pick expansions individually)    | SELECTED                                                                                             |
| D3   | Multi-user campaign membership (invite/join/leave) in v1                                             | ACCEPTED                                                                                             |
| D4.1 | Conversational campaign onboarding interview                                                         | ACCEPTED                                                                                             |
| D4.2 | Campaign journal / session timeline                                                                  | ACCEPTED                                                                                             |
| D4.3 | Spoiler-protection data hooks (schema-only, Phase 7 input)                                           | ACCEPTED                                                                                             |
| D4.4 | Rules-legal validation on state writes (soft warnings)                                               | ACCEPTED                                                                                             |
| D4.5 | Character retirement & legacy flow                                                                   | DEFERRED — `status` field + successor link ship in v1 schema; guided flow tracked as follow-up issue |

## Goal (initiative-level)

A player can sign in, create or join a campaign, enter their character (by
form or by conversation), and Squire's answers reflect that context — "what
items can I afford?" knows their gold and prosperity; "we finished scenario
14, record it" updates shared campaign state. The agent can both **read**
state to personalize answers and **write** state on instruction, headlessly,
through the same atomic-tools architecture every channel shares.

## Product shape — four pillars

### 1. Campaign data foundation (isolation-first)

Per SECURITY.md §3 and SQR-28, the **data isolation contract comes first** and
gates all implementation:

- Entities: `campaigns`, `campaign_members` (membership + permissions), and
  `characters` (member 1→N over time — supports one player running two
  characters and retirement succession), referencing the existing `users`
  table. UUID PKs. `game` column on campaigns (one campaign is one game).
  The campaign audit log table is part of this schema scope — it is both a
  SECURITY.md §3 requirement and the substrate for the journal read-model.
  Membership and character identity are deliberately **separate tables** —
  a join table holding character state cannot model multi-character players
  or retirement chains.
- Characters carry `status` (`active` / `retired`) and a nullable
  `successor_id` self-reference from day one (D4.5). The guided retirement
  flow is deferred; the model is not.
- Field classification: **shared campaign state** (prosperity, completed
  scenarios, unlocked classes/items/buildings, active scenario), **public
  player state** (class, level), **private player state** (personal quest,
  battle goals; visibility of items/gold/cards/perks decided by the
  contract).
- Spoiler-protection hook (D4.3): unlock + completion state is modeled
  completely enough that Phase 7 spoiler filtering is a filter, not a
  migration. Acceptance criterion on the schema issue.
- Campaign membership check on every request; LLM context scoped to the
  requesting player's data + shared state; other players' private fields
  never enter the context window.
- Mutation permissions + audit logging for campaign state changes. The
  isolation contract (SQR-28) must also specify **leave/delete semantics**:
  what happens to a leaver's characters, journal, and audit entries; rejoin
  behavior; last-member-leaves; and explicit campaign delete.
- **Non-member access returns indistinguishable 404s** (matching the
  conversation-lookup convention in SECURITY.md §7) so campaign IDs are not
  an existence oracle; invited-but-not-joined states get an explicit
  carve-out in the contract.
- **Campaign write endpoints join the ADR 0018 app-rate-limit inventory**;
  policy numbers are set at eng review; acceptance criterion on the CRUD
  issues.
- Isolation proven by deterministic integration tests AND adversarial evals
  (see success metrics for the split).
- Schema ships `lastSyncedAt` + `syncMethod`, plus nullable `externalRef` +
  `sourceAuthority` columns on every syncable record, so Phase 6 ingestion
  lands without migration. Conflict/merge/tombstone semantics stay Phase 6
  scope — they depend on which ingestion option wins.
- The SQR-28 contract includes an explicit **permission matrix**: who can
  delete a campaign, remove a member, edit shared state, edit another
  member's character, and correct journal entries.
- **Invite semantics:** allowlist membership is checked at invite time AND
  join time; the not-allowlisted path is defined (invite blocked with clear
  copy, not a silent failure).

### 1b. Scenario progression model (prototype exfil — eng D1, 2026-06-12)

The Replit prototype (`github.com/maz-org/squire-campaign-tracker`, live at
`squire-campaign-tracker.replit.app`) is integrated as data + concept:

- **Unlock graph seed:** the prototype's curated per-scenario graph —
  `prereqs {all/any}`, `mutex`, `lockedIf`/locks-out, `manual` unlock
  conditions (human-readable), hazard/caution flags, and thematic thread
  groupings — imports as Squire seed data (checked-in extract per ADR 0005,
  module-namespaced). This is curated community knowledge GHS alone doesn't
  provide and enriches the existing `book_references` relations.
- **Graph coverage:** GH2e + solo2e import from the prototype (SQR-267);
  **Frosthaven gets its own curated graph** (SQR-281 — no prototype source
  exists; skeleton derived from `book_references`, community-flowchart layer
  curated on top) so both real campaigns get the dashboard; GH1e/JotL graphs
  exist in the prototype but stay out per SPEC — tracked as deferred future
  work (SQR-282).
- **Campaign scenario state:** per-campaign `played` + `drawn` sets (the
  prototype proved this minimal mutable state suffices); all availability
  statuses (open / locked / blocked / via-event / drew-it) are **derived**,
  never stored. Event scenarios cycle drew→played→clear.
- **Modules:** a campaign carries a module set (e.g. `{gh2e, solo2e}`)
  refining the `game` column — game stays the isolation/retrieval
  dimension; modules select which scenario sets are active.
- **Hazard/missable warnings** ("playing 27 permanently closes 10, 21, 35,
  36") ship with the graph — they serve the table today and are the
  concrete first consumers of the D4.3 spoiler-hook data.
- **Migration:** Brian's live GH2e campaign state (played/drawn) imports at
  cutover so Squire starts with the real campaign, not an empty state.
- **Advisory posture** carries over verbatim: derived unlock logic is
  advisory; the game is truth; one tap/sentence corrects Squire.

### 2. Knowledge-agent integration (read path)

- New contract tools (extending `KNOWLEDGE_TOOL_CONTRACT.md`, not a parallel
  surface): campaign/character/party entity kinds become real — resolvable,
  openable, traversable; plus dedicated state tools per SPEC
  (`getCampaign`, `getCharacterState`, `getPartyInfo`). SPEC's fourth tool,
  `updateCampaign`, is subsumed by pillar 4's write-tool family — not
  dropped.
- Journal addressability (D4.2): journal entries are reachable via
  `open_entity(campaign:…)` / `neighbors` traversal, not a new top-level
  entity kind, unless eng review concludes otherwise.
- Identity propagation: request context carries caller identity from web
  session or OAuth token into the graph (SQR-20).
- Campaign context loading in the LangGraph graph. **Proposed:** the active
  campaign supplies the `game` dimension; the existing per-session game
  selector remains only as the no-campaign fallback (open question 7
  confirms the fallback shape, not the replacement).
- Campaign-switch hygiene: switching active campaign mid-session must not
  bleed prior campaign state from conversation history into answers — the
  switch re-anchors scoping (mechanism decided in eng review) and a
  cross-campaign-switch eval case ships with it.
- MCP projection: same tools exposed at `/mcp` with identity from the bearer
  token — Claude Code/Desktop get personalized answers too. **State access
  requires user-bound tokens:** client-credential tokens (no `userId`) get
  no campaign/character access; write tools additionally require the
  confirmation contract regardless of channel.
- **Per-message campaign binding:** messages record the campaign they were
  answered under (like the existing `game` column), so campaign switches
  and history filtering are deterministic rather than "re-anchored"
  heuristically. Legacy conversations keep selector behavior — campaign
  binding applies to new messages only.
- **Active-character rule:** a member with multiple active characters in a
  campaign either has an explicit active-character selection or the agent
  asks which character a personal question refers to — never silently
  guesses.
- Eval expansion: personalized-answer evals + isolation evals + campaign-
  switch evals join the regression suite.

### 3. Campaign & character UI (traditional surfaces)

The IA question design review must answer: campaign and character state need
a rendering home — candidate shapes are dedicated routes (`/campaigns`,
`/campaigns/:id`, `/characters/:id`), a panel within the chat shell, or
both. Constraint: the desktop rail is now occupied by conversation history
(June 2026 agentic-chat refresh), so Phase 4 surfaces cannot assume it.
Components specced in DESIGN.md already: header context strip
(`DRIFTER L4 · PARTY OF 4 · SCEN 14`), character sheet and party/campaign
surfaces as first-class modes, ledger aesthetic.

- Campaign CRUD UI: create, invite (allowlisted users), join, leave, switch
  active campaign. SQR-11 acceptance criterion: with the user a member of
  both an FH and a GH2 campaign, "what items can I afford?" resolves to the
  right campaign or asks — the selection mechanism (explicit picker vs.
  implicit last-active) is a design-review decision.
- Manual character entry: class, level, XP, gold, items, cards, perks,
  personal quest — complete edit forms, GHS-data-backed autocomplete,
  designed for phone-at-the-table plus desktop. Forms are also the
  documented repair path when conversational writes go wrong.
- Campaign dashboard: the **scenario progression tracker is the
  centerpiece** (prototype concept rebuilt in Hono JSX + HTMX with the
  ledger aesthetic): tap a scenario to mark it played, derived statuses
  recalculate, thread groupings + hazard warnings render. Shared state and
  party roster (public fields only) accompany it.
- Campaign journal surface (D4.2): human-readable session timeline derived
  from the audit log. Coupling is one-directional — the journal is a
  read-model that _selects from_ the audit log; journal needs never reshape
  the security artifact. The projection carries **redaction rules**: private
  fields, failed writes, and operational metadata never appear in the
  journal. Design review sizes the surface.
- Context/memory transparency panel (SQR-258): show what state Squire is
  using; let the user inspect/correct it.
- User profile & settings (SQR-40).
- Every Phase 4 UI issue carries a browser-E2E acceptance criterion (happy
  path + one failure path), extending the Phase 3 Playwright suite.

### 4. Conversational state management (write path — the deep-agent slice)

The differentiator vs. a plain tracker app: state updates flow through
conversation, with the traditional UI as the always-available fallback and
inspection surface.

- Write tools with guardrails: campaign/character mutations scoped by the
  isolation contract's permission rules; agent work log shows every mutation
  (no silent writes).
- **Destructive-write semantics are channel-agnostic:** mutations classified
  destructive (the contract enumerates them — e.g. character delete,
  campaign delete, member removal, large negative adjustments) require a
  two-phase propose→confirm tool contract. Web chat renders the confirm
  affordance; MCP/REST clients must pass the explicit confirmation
  parameter. No channel can destroy state in one shot. **Pending proposed
  mutations persist server-side, addressable across channels, with expiry**
  — the mechanism (table vs. work-log rows) is an eng-review decision.
- **Concurrency:** shared-state mutations must prevent silent lost updates
  across members, and conversational batches carry idempotency keys so a
  session-end flow cannot double-apply. Mechanism (optimistic version vs.
  advisory lock) is an eng-review decision; a concurrent-write test case is
  required.
- **Batch mutation semantics (Codex-revised):** session-end and onboarding
  batches show a complete staged preview, then commit atomically in one
  transaction — shared campaign state is never half-wrong. A rejected-batch
  case ships in the eval set; the forms UI remains the repair path for
  rejected batches. Eng review may exempt truly independent per-character
  mutations from the single-transaction rule.
- **Prompt-injection exposure of the write path:** SECURITY.md §1 was
  assessed against a read-only agent. Phase 4 puts mutation tools behind the
  LLM while the context window gains other members' user-generated content
  (character names, journal text) — a channel for injection-induced writes
  on the requesting user's behalf. The SQR-28 contract scope includes an
  injection-induced-write assessment; the eval set includes at least one
  injection-resistance write case; SECURITY.md §1/§3 get a write-path
  update as part of this initiative.
- Rules-legal validation (D4.4): soft warnings on writes from both paths,
  validated against data Squire already holds. **v1 validation set
  (enumerated):** gold ≥ item cost, prosperity-gated item availability, and
  level-vs-XP threshold checks. Everything else (perk counts, card-pool
  legality, scenario unlock chains) is explicitly out of the v1 validator.
  House-rule override always allowed; eval-covered. Warning copy explicitly
  states the limited scope of what was checked, so "no warnings" is never
  read as "fully rules-legal."
- Conversational campaign onboarding (D4.1): first-run interview ("Which
  game? Who's in the party? What scenario?") creates campaign + characters
  conversationally, each record visible as it lands. Forms remain the
  alternate path. Other members' characters created during onboarding are
  **claimable placeholders** (public fields only, owned by the campaign
  creator until the member joins and claims them).
- Session-end flow: "we finished scenario 14 — 12 gold each, Drifter hit
  level 5, prosperity ticked" → agent decomposes, shows, applies (per batch
  semantics above).
- Headless operation: same flows work via MCP/REST channels, not just web
  chat.
- Deep Agents runtime stays OFF the critical path per ADR 0019 — Phase 4
  uses the production graph with new tools. A longer-running
  campaign-management agent (durable multi-step work) is evaluated only if
  the simple tool loop proves insufficient.

## Explicitly out of scope

- Automated ingestion from external trackers (Phase 6). Schema hedges only
  (`lastSyncedAt`, `syncMethod`).
- Recommendations (Phase 5). Phase 4 ends where personalization of _lookup_
  answers ends; "which card should I pick?" reasoning is Phase 5.
  Rules-legal _validation_ (deterministic legality warnings) is
  distinguishable from _recommendation_ (judgment) and stays.
- Spoiler protection UI/filtering (Phase 7) — Phase 4 ships only the data
  model hooks (D4.3).
- Guided character retirement & legacy flow (D4.5 deferral — tracked issue).
- Real-time party sync / live multiplayer presence.
- Public self-serve signup (allowlist remains; Phase 4 widens _who can form
  campaigns_ within the allowlist, not who can sign in).

## Success metrics

1. **Personalization works:** Brian's table campaign (FH) and the GH2
   campaign are both entered; "what items can I afford?" answers from real
   gold + prosperity with correct game scoping — including after switching
   active campaign mid-session.
2. **Zero isolation leaks, honestly measured:** deterministic integration
   tests (private fields never enter another player's context or API
   responses) at 100%, blocking, in CI. Adversarial prompt evals run against
   a fixed seed-set at 100%, with any failure triaged as a real leak —
   because isolation is structural, a prompt-eval failure means a context
   assembly bug, not flake.
3. **Conversational writes are trustworthy:** state mutations from
   conversation are visible in the work log, correctly applied in ≥95% of
   eval cases (including the partial-failure case), and destructive
   mutations are impossible in one shot on every channel.
4. **No rules-Q&A regression:** existing eval correctness and p95 latency
   hold (within the noise bands used in SQR-116/118 migrations).
5. **Channel parity:** the same personalized answer is reachable from web
   chat and from Claude Code via MCP with a bearer token.
6. **Real use:** Brian runs a real session week with Squire tracking both
   campaigns. Manual-entry friction is mitigated by conversational
   onboarding (D4.1) — if entry still feels like homework, that's a Phase 4
   bug to fix, not a Phase 6 wait.

## Engineering decisions (eng review, 2026-06-12)

| #   | Decision                      | Outcome                                                                                                                                                                     |
| --- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Prototype integration         | Exfil data + concept: unlock-graph seed, played/drawn state, derived statuses, progression dashboard centerpiece, live GH2e state migration                                 |
| E2  | Pending propose→confirm store | Dedicated `pending_mutations` table (proposal id, payload jsonb, proposer, campaign, expiry, status); swept like expired sessions; confirm-by-id from any channel           |
| E3  | Concurrency                   | Optimistic `version` column on campaigns/characters; compare-and-set; 409 + re-read retry; batch idempotency keys deduped in-transaction                                    |
| E4  | Character schema              | Hybrid: scalar columns; `character_items`/`character_cards` child tables referencing GHS `(game, source_id)`; perks as jsonb index array; notes text                        |
| E5  | Tool surface                  | Reads join the six-tool contract (campaign/character/party kinds; availability via `neighbors`); writes are a separate `propose_state_change`/`confirm_state_change` family |
| E6  | Per-message campaign binding  | `campaign_id` column on `messages` (mirrors the existing `game` column); null for legacy/no-campaign messages                                                               |
| E7  | Rate limits (proposal)        | State writes 60/min, state reads 120/min per token user — same Redis limiter family as ADR 0018; final numbers tunable at implementation                                    |
| E8  | Game-selector fallback        | Active campaign supplies `game` and hides the selector; no-campaign sessions keep the current selector unchanged                                                            |
| E9  | Availability derivation       | Computed in a TypeScript service from the seeded unlock graph + played/drawn (graph ≤ ~110 nodes/game — trivial); never stored, never in SQL                                |

### Implementation constraints (Codex-verified against the codebase, absorbed 2026-06-12)

1. **REST identity wiring is real work:** `/api/ask` currently strips body
   `userId` and does not pass bearer-token identity into `ask()`
   (`src/server.ts` ~1842, ~1873) — SQR-20 must wire this before membership
   checks can exist on REST.
2. **MCP handlers need caller context:** `createMcpServer()` registers tools
   without `authInfo`/`userId` (`src/mcp.ts` ~29) — state tools require the
   handler signature change; client-only tokens (no `userId`,
   `src/server.ts` ~321) are hard-rejected at every state handler.
3. **Contract kind expansion is real scope:** the entity-kind union in
   `src/tools.ts` (~188, ~1316) is closed over four kinds today; adding
   campaign/character/party touches validators, schemas, and the kind
   registry — budget it in the read-tools issue.
4. **History filtering, not just tagging:** history assembly loads by
   conversation and strips to `{role, content}`
   (`src/chat/conversation-service.ts` ~43) — campaign-switch hygiene
   requires filtering/redacting history to the active campaign, with the
   `campaign_id` column (E6) as the filter key.
5. **Never hold DB locks across LLM calls:** the existing chat path's
   transaction shape (advisory lock around the LLM call,
   `conversation-service.ts` ~153) must NOT be copied for state writes —
   propose/confirm transactions are short and LLM-free.
6. **Confirm-time revalidation:** `pending_mutations` stores a payload hash
   - expected entity versions; confirmation re-checks membership,
     permissions, expiry, versions, and hash — stale previews never become
     valid writes.
7. **Atomic batch CAS:** every expected-update in a batch checks affected
   row counts; any miss aborts the whole transaction.
8. **Idempotency keys are scoped:** unique key includes actor + campaign +
   tool family, and binds a payload hash, so reused keys can't smuggle
   different writes.
9. **State rate limits live in the state service:** web in-process tools
   never traverse `/mcp` middleware, so E7's limits are enforced at the
   state-service layer (Hono middleware remains for HTTP surfaces).
10. **Audit rows commit with the mutation** (same transaction); the SSE work
    log is presentation, never the audit source. Audit/preview rows snapshot
    the derived availability statuses used at write time so journal entries
    stay true when the seed graph evolves.
11. **Module namespace before seed import:** `GameId` is a closed two-value
    union (`src/game.ts`); modules are scenario-set selectors within a game.
    v1 seeds GH2e + solo2e only — GH1e/JotL stay out per SPEC; the seed
    format remains module-extensible.
12. **Prosperity-gating data check:** `card_items` has `cost`/`craftCost`
    but no explicit prosperity-availability field — the D4.4 validator issue
    confirms the data source first and trims the v1 validation set if the
    data isn't there.

## Design decisions (design review, 2026-06-12)

| #   | Decision                   | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Dashboard visual direction | Variant C layout + brand logo; consider variant B's storyline art; lockout warnings adjacent to the affected storyline/scenario; campaign name more prominent than the Squire brand; no italics for statuses. Approved mockup (build reference): `docs/artifacts/phase-4-dashboard-mockup-approved.png` (variant C, promoted from the 2026-06-12 gstack design session; rejected variants and the comparison board were deliberately not committed)                                            |
| G2  | IA                         | Dedicated routes (`/campaigns`, `/campaigns/:id` dashboard+journal, `/characters/:id`) sharing the ledger shell; the header context strip is the persistent bridge (tap → campaign dashboard); chat stays home. No-campaign state shows `NO CAMPAIGN · SET UP` in the strip — never fake state                                                                                                                                                                                                 |
| G3  | Character entry            | Accordion-section character sheet (one route, collapsible ledger sections, in-place edits, GHS autocomplete, deep-linkable section anchors so the agent can link "fix it here")                                                                                                                                                                                                                                                                                                                |
| G4  | Transparency (SQR-258)     | Per-answer work-log rows name the state fields used (tap-through to correct); campaign/character routes carry the full "what Squire knows" inspect/correct view; no new chat chrome                                                                                                                                                                                                                                                                                                            |
| G5  | Component vocabulary       | Statuses = sepia small-caps (PLAYED sage, OPEN parchment, LOCKED sepia-dim, VIA EVENT sepia, DREW IT amber — no italics); hazard warnings = `.squire-banner` amber variant placed adjacent to the affected thread/scenario; thread headings = Fraunces + hairline rules; stats line = Geist tabular-nums; confirmation block = surface panel + work-log rows + wax primary button (distinct from the Phase 5 verdict block). DESIGN.md gains a Phase 4 component section before implementation |
| G6  | Responsive & a11y          | 44px touch targets on scenario rows; keyboard row-focus with Enter-to-toggle (hazard rows always confirm); `aria-live=polite` status-recalc announcements; dashboard uses a desktop multi-column thread grid (640px column is for prose, not data surfaces); WCAG-AA contrast holds at label sizes                                                                                                                                                                                             |

### Screen map

```text
              ┌──────────── header: monogram · context strip ───────────┐
              │   strip: GH2E · TRAVEL CAMPAIGN · DRIFTER L4  (tap ↓)   │
   / (home) ──┤                                                          │
   /chat/:id ─┤  chat shell (rail/drawer = conversation history)         │
              │                                                          │
              ├── /campaigns ──────── campaign list + create/join        │
              ├── /campaigns/:id ──── progression dashboard (centerpiece)│
              │                       + shared state, roster, journal    │
              └── /characters/:id ─── accordion character sheet          │
```

### Interaction state coverage

| Surface                   | Loading                 | Empty                                                                   | Error                                                   | Success                                              | Partial                                                             |
| ------------------------- | ----------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------- |
| Progression dashboard     | skeleton thread rows    | no campaign → `SET UP` invite (conversational or form)                  | load failure banner + retry                             | statuses render; tap recalcs with aria-live announce | seed gaps render as `UNKNOWN` status with "trust the game" footnote |
| Character sheet           | section skeletons       | new character → sections show "not recorded" + add affordance           | save failure keeps edit open with error banner          | in-place save confirms quietly                       | placeholder (unclaimed) characters show claim banner                |
| Campaign list             | row skeletons           | "No campaigns yet" + create/join actions                                | —                                                       | —                                                    | pending invites listed distinctly                                   |
| Journal                   | row skeletons           | "No sessions recorded yet — finish a scenario and tell Squire about it" | —                                                       | session entries grouped by date                      | redacted entries never render (not "hidden", absent)                |
| Confirmation block (chat) | proposing… work-log row | —                                                                       | rejected batch → visibly failed row + forms repair link | applied rows turn sage with audit link               | n/a — batches are atomic (no partial)                               |

### Journey storyboard (emotional arc)

1. **Onboarding interview** — user talks, records visibly appear (delight,
   "it heard me"). Forms always one tap away.
2. **First personalized answer** — work-log row shows the state used (trust,
   "I can see why it said that").
3. **Session end** — one spoken paragraph → staged preview → confirm
   (relief, "bookkeeping took 20 seconds").
4. **Next session** — "what's open?" → dashboard statuses + hazard warnings
   (confidence, "Squire knows our campaign").

## Milestones (reads-first sequencing, D10)

- **M1 — Read personalization (vertical slice):** isolation contract +
  schema + identity + CRUD + forms + active campaign/character selection +
  read tools + agent context + isolation evals. Ends with a real-table
  checkpoint: Brian uses read-personalized answers in a live session before
  M2 starts in earnest.
- **M2 — Conversational writes:** write tools + confirmation contract +
  staged-batch flows (onboarding, session-end) + journal surface +
  validation warnings + write-path evals + MCP write parity.

## Dependencies & sequencing

```text
SQR-28 isolation contract (design gate, produces ADR; now includes
 leave/delete semantics + destructive-mutation enumeration)
  → schema (SQR-18: campaigns, campaign_members, characters)
    → identity propagation (SQR-20)
      → campaign/member/character CRUD service + API (SQR-21, SQR-22)
        → read tools + agent context (SQR-19 + new) → UI surfaces (SQR-11, SQR-258, sheets, journal)
        → write tools + confirmation contract       → conversational flows (onboarding, session-end)
        → evals (isolation, personalization, switch, partial-failure)
```

Cross-initiative: Phase 5/6/7 consume this data model. The GH2 campaign
arriving mid-2026 makes campaign-per-game a day-one requirement, not a
future enhancement.

**Existing-issue rewrites required when cutting Linear issues:** the nine
pre-existing issues predate this plan and several contradict it. SQR-18's
"Player joins a user to a campaign with character state" entity model and
SQR-22's "Player CRUD" routes are superseded by the campaign_members +
characters split. SQR-19's write half (`update_campaign`, `reset_campaign`)
migrates to the pillar-4 write-tool family under the confirmation contract
(reset/delete are destructive). SQR-21 gains explicit campaign-delete per
the SQR-28 leave/delete semantics. Rewrite descriptions rather than letting
stale text mislead implementers.

## Resolved questions (formerly open)

1. **Multi-user membership in v1?** — RESOLVED by D3: yes, full
   invite/join/leave membership ships in Phase 4.
2. **Manual-entry friction vs Phase 6?** — RESOLVED by D4.1: conversational
   onboarding is the friction mitigation; no further friction budget is
   allocated. If entry still stalls real use, treat as a Phase 4 bug
   (metric 6).

## Open questions for design review

1. **Design:** Routes vs. panel vs. both for campaign/character surfaces
   (the desktop rail is taken by conversation history); how chat and the
   scenario-progression dashboard interrelate; mobile entry ergonomics.
2. **Design:** How do conversational writes _look_? (Proposed: agent work
   log rows + a confirmation block, reusing SQR-255/259 vocabulary.)

(Former eng questions 5–7 are resolved by eng decisions E5, E4, and E8.)

## Inputs unavailable this session

The Replit campaign-tracker prototype
(`https://replit.com/@bmoseley/Squire-Campaign-Tracker`) could not be read:
the Replit MCP connector fails auth ("Could not extract user ID from
authorization token") and replit.com Cloudflare-blocks the headless browser.
Plan drafted from SPEC/ARCHITECTURE instead. If the prototype's data model or
UX should influence the schema or UI issues, re-auth the connector and fold
findings in before implementation starts.

## Linear build-out record (2026-06-12)

Initiative updated (Active) with four projects:

| Project                            | Issues                                                                                                                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Campaign Data Foundation           | SQR-28 (gate), SQR-18, SQR-20, SQR-21, SQR-22, SQR-266 (audit+journal), SQR-270 (isolation proof)                                                                                                                                                                              |
| Campaign Knowledge & Agent Context | SQR-267 (graph seed GH2e), SQR-281 (FH graph curation), SQR-268 (availability), SQR-269 (contract kinds), SQR-19 (read tools+context), SQR-271 (MCP read), SQR-272 (evals), SQR-273 (live migration), SQR-282 (GH1e/JotL — deferred future work)                               |
| Campaign & Character Web UI        | SQR-274 (DESIGN.md section), SQR-275 (route shell+strip), SQR-276 (dashboard), SQR-277 (character sheet), SQR-11 (campaign list), SQR-258 (transparency), SQR-40 (profile), SQR-278 (journal, M2)                                                                              |
| Conversational Campaign Management | SQR-279 (pending_mutations contract), SQR-280 (write tools), SQR-283 (session-end flow), SQR-284 (onboarding), SQR-285 (validation warnings), SQR-286 (confirmation UX), SQR-287 (MCP write parity), SQR-288 (write evals + SECURITY.md), SQR-289 (retirement — deferred D4.5) |

Dependencies recorded in both Linear relations and description text per
docs/agent/issue-workflow.md. P3 milestones: "M1 · Read surfaces",
"M2 · Journal & write-adjacent surfaces".

## GSTACK REVIEW REPORT

| Review        | Trigger                         | Why                             | Runs | Status   | Findings                                                                                                                                                                 |
| ------------- | ------------------------------- | ------------------------------- | ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CEO Review    | `/plan-ceo-review`              | Scope & strategy                | 1    | CLEAR    | 7 proposals, 6 accepted, 1 deferred; spec loop 2 iterations (20 issues fixed, 8/10); 5 section findings resolved (D5–D9)                                                 |
| Codex Review  | `codex exec` (outside voice ×2) | Independent 2nd opinion         | 2    | ABSORBED | CEO pass: 24 findings (3 tensions D10–D12, 9 gap-fills D13). Eng pass: 15 code-grounded hardening findings, all absorbed (D6-eng)                                        |
| Eng Review    | `/plan-eng-review`              | Architecture & tests (required) | 1    | CLEAR    | 9 decisions locked (E1–E9 incl. prototype exfil); 12 implementation constraints absorbed; test map complete; 0 critical gaps                                             |
| Design Review | `/plan-design-review`           | UI/UX gaps                      | 1    | CLEAR    | score 5/10 → 9/10; 6 decisions (G1–G6); approved dashboard mockups (variant C); 7 passes complete; outside design voices skipped (2 Codex passes already absorbed today) |
| DX Review     | `/plan-devex-review`            | Developer experience gaps       | 0    | —        | not planned for this initiative                                                                                                                                          |

**CODEX:** two passes — strategy pass shaped milestones and batch atomicity; eng pass verified the chosen mechanisms against the codebase (file:line) and contributed 12 implementation constraints now in the plan.

**CROSS-MODEL:** no tensions in the eng pass — all findings strengthened locked decisions. CEO-pass tensions were resolved by user decisions D10–D12.

**VERDICT:** CEO + ENG + DESIGN CLEARED — ready for Linear build-out.

NO UNRESOLVED DECISIONS
