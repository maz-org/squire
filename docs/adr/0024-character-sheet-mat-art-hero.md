---
type: ADR
id: '0024'
title: 'Character sheet mat-art hero'
status: active
date: 2026-06-19
---

## Context

DESIGN.md G3 chose an accordion-only character sheet because the common action
is a single-field correction, not initial character creation. That still matters:
agent work-log rows and rules warnings need stable anchors like `#gold`, owners
need no-JS edit forms, and non-owners must never receive private fields. ADR
0025 now owns the structured edit fields and catalog validation for those
sections.

The accordion-only page treated every section at the same visual weight and had
no actual game artifact on the page. SQR-326 changes that direction: the sheet
should feel more like the physical character record while keeping the field-edit
contract that made G3 useful.

Brian accepted the non-commercial fan-use risk for Cephalofair artwork on
2026-06-14, with two constraints: attribute the source and mirror assets into
Squire instead of hot-linking GitHub raw URLs.

## Decision

**The character sheet uses a heavy identity/stat hero with mirrored class mat
artwork, followed by deep-linkable edit panels.**

The hero shows name, class, level, gold, class stats from
`card_character_mats`, and the mirrored mat artwork when Squire has a local
asset for that game/class. The edit panels keep stable ids (`#gold`,
`#progress`, `#items`, and so on), no-JS form posts, optimistic version tokens,
inline banners, and private-tier projection without rendering like accordion
summary rows. ADR 0025 replaces the old free-text/manual-level edit model with
structured selectors and XP-derived level.

Mat artwork is served from this app under `/assets/character-mats/...` with a
strict allowlist of mirrored files. The first mirrored set is GH2e from
`cmlenius/gloomhaven-card-browser`'s `images` branch.

## Options considered

- **Option A — keep accordion-only G3.** Preserves editing well, but leaves the
  page visually flat and disconnected from the physical sheet.
- **Option B — replace accordions with a custom sheet editor.** Could look more
  like the board-game artifact, but risks breaking no-JS edits, anchors, and
  private-field projection.
- **Option C — hero plus existing edit sections** (chosen). Adds hierarchy and
  real artwork while keeping the safe edit path intact.
- **Option D — hot-link remote mat images.** Less repo weight, but fragile,
  adds third-party runtime dependency, and weakens CSP/privacy posture.

## Consequences

Easier:

- Character pages have a clear first read: who this is, what class they are,
  and the important class stats.
- Future class-art additions only need a mirrored file and an allowlist entry.
- Existing form posts, anchors, and private-field behavior remain stable.

Harder:

- The repo now carries mirrored binary artwork and attribution duties.
- A missing local asset must degrade gracefully for games/classes not mirrored
  yet.
- Sheet visual QA needs to check both the hero art and the edit sections.

## Advice

Keep the hero as display/read-only state. Do not move the edit forms into the
artwork itself unless a later ADR replaces the no-JS and deep-link anchor
contract.
