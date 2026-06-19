---
type: ADR
id: '0022'
title: 'Campaign dashboard segmented views'
status: superseded
superseded_by: '0023'
date: 2026-06-18
---

## Context

DESIGN.md G2 chose dedicated campaign routes plus the header context-strip
bridge. That remains right: `/campaigns/:id` is a full dashboard route, and chat
stays the home conversation surface. The part that no longer fits lived use is
the dashboard's internal order.

The default dashboard rendered party roster, invites, characters, character
creation, scenario progression, and journal in one vertical stack. In real
table use, the common task is to find the next scenario, inspect what opened, or
mark a scenario played. Party management is secondary. Stacking Party and
Characters above the scenario flow makes the primary task start below the fold,
especially on a phone.

SQR-322 re-opens only the internal dashboard IA, not the route-level IA.

## Decision

**`/campaigns/:id` uses URL-backed segmented views: Scenarios is the default,
and Party is available at `?view=party`.**

Scenarios renders the scenario flowchart, scenario stats, and journal. Party
renders member roster, invite controls, character links, and character creation.
The segment links are normal anchors, so JavaScript is not required and links
from agents or bug reports can target either view.

## Options considered

- **Option A — keep one dense stack.** Minimum code and matches the first Phase
  4 mockup. Rejected because the party and character controls push the primary
  scenario task below the fold.
- **Option B — client-side tabs only.** Fast-feeling interaction, but no-JS
  users and agent links cannot target the Party view without client state.
  Rejected.
- **Option C — URL-backed segmented views** (chosen). Slightly more server
  routing and tests, but it preserves no-JS access, keeps links precise, and
  makes Scenarios the first screen without hiding Party permanently.
- **Option D — split Party into a separate route.** Cleanest separation, but it
  makes basic campaign maintenance feel farther away than one gesture and adds
  another Phase 4 route before there is enough surface area to justify it.
  Rejected.

## Consequences

Easier:

- The default dashboard opens on the scenario flow, matching the most common
  at-table task.
- Party management remains reachable by one link without JavaScript.
- Bug reports and agent replies can link to the exact view.
- Character and invite validation errors can re-render directly on Party.

Harder:

- Tests that previously assumed Party content existed on the default dashboard
  must request `?view=party`.
- POST redirects for Party forms should return to `?view=party` so successful
  writes do not drop the user back on Scenarios.
- Future dashboard sections need an explicit home: Scenarios, Party, or a new
  segment.

Re-evaluate if Party becomes the dominant dashboard task or if the dashboard
adds enough campaign-management sections that Party needs its own route.

## Advice

This decision comes from SQR-322 and Brian's dashboard bug log from
2026-06-14. It narrows DESIGN.md G2; it does not supersede ADR 0020 or the
route/context-strip part of G2.
