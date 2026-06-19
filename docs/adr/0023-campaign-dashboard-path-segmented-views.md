---
type: ADR
id: '0023'
title: 'Campaign dashboard path-segmented views'
status: active
date: 2026-06-19
---

## Context

ADR 0022 split the campaign dashboard into Scenarios and Party, but encoded the
secondary Party view with `?view=party`. That solved no-JS reachability, but it
made Party feel like state on the Scenarios page instead of a named dashboard
section.

The user-facing contract should be simple enough to read aloud, paste into a
bug report, and recognize in server logs. `/campaigns/:id/party` is clearer
than a query-param tab state and matches the rest of the Phase 4 route style.

## Decision

**The campaign dashboard uses path-backed segmented views: `/campaigns/:id`
opens Scenarios, and `/campaigns/:id/party` opens Party.**

Scenarios renders the scenario flowchart, scenario stats, and journal. Party
renders member roster, invite controls, character links, and character creation.
The segment links are normal anchors, so JavaScript is not required and links
from agents or bug reports can target either view.

## Options considered

- **Option A — query-param tab state.** Works without JavaScript and keeps one
  route handler, but `?view=party` reads as presentation state rather than an
  addressable campaign section. Superseded.
- **Option B — path-backed Party view** (chosen). Slightly more routing, but it
  gives Party a stable readable URL and keeps the Scenarios default clean.
- **Option C — keep one dense stack.** Still rejected for the same reason as
  ADR 0022: party and character controls push the primary scenario task below
  the fold.
- **Option D — client-side tabs only.** Still rejected because no-JS users and
  agent links cannot target Party without client state.

## Consequences

Easier:

- User reports, Sentry tags, and agent-generated links can refer to a readable
  Party URL.
- The default campaign URL remains the scenario workflow.
- Party form redirects can return to a canonical path instead of preserving tab
  query state.

Harder:

- Tests that previously assumed Party content existed on the default dashboard
  must request `/campaigns/:id/party`.
- Route changes need to preserve the member/404 indistinguishability contract on
  both dashboard paths.
- Future dashboard sections need an explicit path if they become first-class
  sections.

Re-evaluate if Party becomes the dominant dashboard task or if the dashboard
adds enough campaign-management sections that `/campaigns/:id/manage` would be
clearer than additional sibling paths.

## Advice

Brian explicitly chose path routing over query-param routing on 2026-06-19 while
reviewing SQR-322. This supersedes ADR 0022 and still narrows DESIGN.md G2
without changing ADR 0020 or the route/context-strip part of G2.
