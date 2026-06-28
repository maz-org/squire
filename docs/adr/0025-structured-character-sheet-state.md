---
type: ADR
id: '0025'
title: 'Structured character sheet state'
status: active
date: 2026-06-28
---

## Context

ADR 0024 improved the character page hierarchy with a mat-art hero, but the edit
sections still treated most game fields like plain text. That made it too easy
to enter impossible state: a manual level that disagreed with XP, ability cards
from another class, free-text perks, unavailable items, or battle goals stored on
the durable character row.

The redesign keeps ADR 0024's hero and no-JS edit contract, but tightens the
state model around the data Squire already imports from Gloomhaven Secretariat
and around campaign-managed availability.

## Decision

Character pages use structured sheet sections, not a generic accordion editor.

- Level is read-only derived state from XP using the shared XP threshold table.
  XP is the only editable progression field.
- Perks render from the selected class mat and save class-scoped perk indices.
- Ability cards render from the character's class list. Cross-class or
  cross-game card source ids are rejected at every write boundary.
- Items come from a campaign item catalog. Campaign Settings can mark each item
  available, locked, or unavailable; only available source ids can be added.
- Personal quests come from a campaign personal quest catalog and are stored as a
  source id. A quest can be assigned only when it is available and not assigned
  to another character.
- Battle goals are not durable character state. They belong to individual play
  sessions and need a separate session model before they return to the UI.

The same Zod patch schema and service validators are shared by form posts, REST,
write tools, MCP tool descriptions, and pending proposals. Removed fields such as
`level`, `personalQuest`, and `battleGoals` fail at the edge instead of being
silently ignored.

## Consequences

Easier:

- The character sheet can offer controls that match the physical game artifacts:
  class perk checklist, class ability-card picker, campaign item picker, and
  personal quest picker.
- UI state, REST writes, proposals, and agent tools agree on the same character
  contract.
- Roster level, hero HP, solo availability, and journal reads all derive from
  the same XP value.

Harder:

- Campaigns now need catalog management before some item choices are available.
- Tests that seed items, ability cards, or personal quests must seed real card
  data and catalog status, not arbitrary strings.
- Battle-goal tracking needs a future session-scoped design instead of a quick
  character text field.
