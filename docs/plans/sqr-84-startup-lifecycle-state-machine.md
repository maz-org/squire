# SQR-84 Startup Lifecycle State Machine

## Problem

SQR-84 started as a narrow change: bind the server port before embeddings and
card seed warmup complete. The first implementation got the basic behavior, but
the follow-up bugs all pointed at the same root cause: startup state was spread
across multiple overlapping truths.

Examples:

- the process could be listening while health still behaved like startup was
  blocking
- search and card endpoints could succeed while health still reported not ready
- route gating depended on string-matching error text instead of typed state

This is not a one-line bug. It is a lifecycle-modeling problem.

## Recommendation

Model bootstrap explicitly in `src/service.ts` and make that module the single
owner of startup/readiness state.

```
LIFECYCLE
=========
starting
  Process is listening, but the bootstrap loop has not produced the first
  dependency snapshot yet. Health may report this briefly after bind.

boot_blocked
  Dependencies reachable, but required bootstrap data is missing.
  Example: embeddings table empty or cards not seeded.

warming_up
  Dependencies reachable, bootstrap data exists, initialization is in flight.

ready
  Warmup complete. Full service is available.

dependency_failed
  A required dependency is unavailable right now.
  Example: Postgres cannot be reached.

init_failed
  Dependencies are reachable and bootstrap data exists, but warmup failed.
  Example: embedder warmup crashes.
```

## Why This Matters

Health checks and route gating are answering different questions:

1. Is the process listening?
2. Are dependencies reachable?
3. Is bootstrap data present?
4. Has warmup completed?

Trying to answer all four with one `ready` boolean creates ambiguous behavior.
An explicit lifecycle snapshot makes those questions separable and testable.

## Capability Model

Routes should consume typed capability state, not parse prose from `errors[]`.

```
capabilities:
  rules -> allowed + reason + message
  cards -> allowed + reason + message
  ask   -> allowed + reason + message
```

Suggested typed reasons:

- `missing_index`
- `missing_cards`
- `dependency_unavailable`
- `warming_up`
- `init_failed`

This is the important part. `errors[]` is diagnostics. It should never be
control flow.

Capability design rule:

- A capability is allowed only if every dependency exercised on that request
  path is healthy right now.

Examples:

- `rules` requires retrieval data plus the embedder, because each request calls
  `embed(query)` before vector search.
- `cards` depends on card tables, but not on embedder warmup.
- `ask` depends on both retrieval and card bootstrap, plus successful warmup.

This is the easiest place to make subtle mistakes. If a new route or tool calls
into a dependency on the request path, that dependency must be reflected in the
capability decision table. Do not infer capability from "related" data being
present if the request still touches another subsystem at runtime.

## Endpoint Policy

```
STATE              /api/health   rules   cards   ask
----------------------------------------------------
starting              yes         wait    wait    wait
boot_blocked          yes        maybe   maybe   no
warming_up            yes        yes*    yes*    no
ready                 yes        yes     yes     yes
dependency_failed     yes        maybe   maybe   no
init_failed           yes        no      yes*    no
```

`yes*` means the capability can be served if its own prerequisites are already
valid. Example: card endpoints can still work while ask remains blocked.
`wait` means admission-control paths may await the first live probe, while
health still returns the cached `starting` snapshot immediately.

## Health Rules

`/api/health` should be a pure snapshot read:

- never start warmup
- never perform bootstrap probes
- never wait on warmup
- always return immediately

If the state machine is modeled correctly, health can report:

- `lifecycle`
- `ready`
- `warming_up`

without doing work on the request path. Richer capability details stay in the
service snapshot for route gating and logs, not the public health payload.

## Writer / Reader Split

The service layer owns state transitions.

```
WRITERS
=======
- startup bootstrap loop
- initialize() beginning warmup
- initialize() success
- initialize() failure
- explicit refresh / retry hooks

READERS
=======
- /api/health
- route gating
- ask()
```

That split is the whole game. Readers observe. Writers transition.

## Database Reachability

`"I can't reach the database"` is not the same problem as `"you forgot to run
npm run index"`.

- Missing bootstrap data means the dependency is up, but the required content is
  absent. State: `boot_blocked`.
- Unreachable Postgres means the dependency itself is down. State:
  `dependency_failed`.

Do not hide DB failure inside `errors[]` and keep pretending the service is just
"not bootstrapped yet". That gives operators the wrong fix.

## Test Matrix

The lifecycle model needs an executable test matrix:

- `boot_blocked`
- `warming_up`
- `ready`
- `dependency_failed`
- `init_failed`

And these regressions need dedicated coverage:

- `/api/health` returns immediately during `warming_up`
- `startServer()` binds before warmup completes
- `startServer()` binds even when bootstrap prerequisites are absent
- route gating is driven by typed capability reasons, not error-string parsing

For future feature work:

- when adding a new capability, add at least one test for each lifecycle that
  should block it
- add one test proving malformed requests still return their normal `400`
  validation errors before bootstrap gating
- add one test for any partial-availability claim, for example "cards still
  work while ask is blocked"

## Minimal Implementation Plan

1. Add a typed lifecycle snapshot to `src/service.ts`.
2. Move bootstrap probing into writer-side refresh logic.
3. Make `/api/health` read the snapshot only.
4. Make route gating consume typed capability status.
5. Keep background bootstrap attempts in the service layer, not in health.
6. Add lifecycle-matrix tests and startup regressions.

## Future Development Checklist

When adding a new capability, endpoint, or dependency:

1. Identify every runtime dependency that endpoint touches on the request path.
2. Decide which lifecycle states should block it and which should allow it.
3. Update `ServiceBootstrapStatus.capabilities` in `src/service.ts`.
4. Update the endpoint policy table in this doc if the public contract changes.
5. Keep `/api/health` snapshot-only. If you need richer diagnostics, use logs or
   a separate internal surface instead of adding probes to health.
6. Add regression tests for:
   - startup / `starting`
   - blocked bootstrap
   - dependency failure
   - init failure
   - malformed-request validation order when applicable

## Not In Scope

- introducing a generic external state-machine library
- changing user-facing API semantics beyond clearer lifecycle fields/reasons
- redesigning retrieval or card-search internals
- production deployment orchestration changes
