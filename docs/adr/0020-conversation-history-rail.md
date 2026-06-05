---
type: ADR
id: '0020'
title: 'Conversation history rail for the chat shell'
status: active
supersedes: '0012'
date: 2026-06-04
---

## Context

[ADR 0012](0012-split-home-and-scrolling-chat-ia.md) fixed a real product
problem: Squire had placeholder chrome that looked populated before real
conversation or campaign state existed. It split the authenticated home from
the conversation page, deleted the fake recent-question chips, and made
`/chat/:id` a standard scrolling transcript. Those decisions still hold.

The one part that no longer holds is the blanket Phase 1 ban on a desktop rail.
ADR 0012 removed a brand-only placeholder rail that had no user data. After
using Squire longer, the missing affordance is different: the user cannot easily
return to earlier rules trails. The agent apps the user likes most, especially
Codex, make prior conversations and current run state visible as part of the
main shell.

This is not a return to the old campaign/party placeholder rail. It is a real
conversation-history surface backed by owned conversation rows.

## Decision

**Squire will render a conversation-history rail on desktop and a History drawer
on mobile as part of the Phase 1 chat shell.** The home page remains a
purpose-built landing, and `/chat/:id` remains a scrolling transcript. The rail
contains recent conversations, a New chat affordance, active selection, and only
current browser-known running/error state for the active stream.

Slice one keeps the scope narrow:

- Row title comes from the first user message, normalized, with `Untitled chat`
  as the fallback.
- Row preview comes from the latest message.
- Game marker appears only when real message game context exists.
- Rows are ordered by `last_message_at desc`.
- The desktop rail appears at wide viewport sizes.
- Mobile uses a left History drawer.
- Old rows do not show persisted running/error badges.
- Progress density, historical stream replay, generated titles, search, pins,
  campaign memory, character goals, and build planning are deferred.

## Options considered

- **Option A — keep ADR 0012 unchanged.** Least code and no docs churn. Rejected
  because it leaves repeated personal use without a way to recover earlier
  conversations.
- **Option B — conversation history only.** Adds the rail/drawer but no active
  state. Reasonable, but too static for an agent surface when an answer is
  running.
- **Option C — conversation history with current active run state** (chosen).
  Adds a small amount of life to the shell without pulling in the progress
  panel. The running/error marker is client state for the current browser stream,
  not persisted conversation state.
- **Option D — full three-zone workbench now.** Adds history, transcript, and a
  right progress/context panel in one release. Rejected because it pulls progress
  density, historical replay, and future memory questions into the first slice.

## Consequences

Easier:

- The user can return to earlier conversations without relying on browser
  history.
- The current conversation is visible as part of the shell on desktop.
- The later progress/context panel has a clear destination without needing to
  redesign the transcript.

Harder:

- Chat routes that currently swap only the transcript need an out-of-band
  history refresh so the rail does not go stale.
- Mobile needs drawer focus management.
- The rail can imply durable run state if old rows show stale badges, so slice
  one limits running/error state to the active current stream.

Re-evaluate if:

- The rail competes with table-time reading on narrow desktop widths.
- Conversation history becomes long enough that search or pins are required.
- Campaign/character state lands and needs a different persistent shell slot.

## Advice

- `/browse` research on 2026-06-04 found Codex to be the best shell reference:
  conversation list first, active work state second, progress/context later.
- `/plan-ceo-review` selected conversation history with active run state as the
  first slice and deferred the full progress panel.
- `/plan-design-review` required this rail to keep Squire's current design
  tokens unless `DESIGN.md` changes first.
- `/plan-eng-review` required one owned summary query and HTMX out-of-band
  history refreshes instead of per-row message loads.
