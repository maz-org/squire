# Frosthaven Unlock Graph — Curation Notes

Curation record for `fh.json` (SQR-281). Unlike `gh2e.json`/`solo2e.json`
(exfiltrated from the campaign-tracker prototype), the Frosthaven graph was
curated from scratch; this file documents the sources, methodology, and the
judgment calls a future maintainer would otherwise have to re-derive.

Curated in the prototype's conventions (`prereqs {all/any}`, `mutex`,
`lockedIf`, `manual` + `cond`, `caution`), then converted mechanically to the
extract format in `src/unlock-graph-schemas.ts` — `prereqs.all/any` become the
always-materialized `prereqsAll`/`prereqsAny`, and `caution` maps to `hazard`
(a hidden permanent choice inside the scenario; edge-visible closures need no
flag because availability derives warnings from inverted `mutex`/`lockedIf`).
All scenario keys are strings (Frosthaven has lettered variants: `4A`, `74B`,
`93A`…). Solo scenarios are keyed `solo-20`…`solo-36` because their printed
numbers (20–36) collide with main-campaign numbers; they live in this one
`fh` module rather than a separate solo module because Frosthaven prints them
in the same scenario book with the same numbering space.

## Methodology

1. **Book skeleton (primary).** Parsed
   `data/extracted/scenario-section-books.json`
   (144 main + 17 solo + 1 random-dungeon entries; 1104 links). Three signals were
   combined:
   - `metadata.unlocks` per scenario (GHS-derived forward edges),
   - `section → scenario` links of type `unlock` (83 edges), traced backwards
     through `scenario conclusion → section` and `section → section read_now`
     chains to find the granting scenario,
   - a raw-text scan of all 731 sections for the printed `New Scenarios: …`
     reward phrasing (102 grants), whose **section labels** identify the unlock
     mechanism (e.g. `Job Posting`, `Random Scenario`, `Puzzle Solution`,
     `Tavern Upgraded`, `Opening the Pass`, `Bathysphere Plans`).
   The three signals agree wherever they overlap.
2. **Community layer.** `scenarios-fh.json` from
   [teamducro/gloomhaven-storyline](https://github.com/teamducro/gloomhaven-storyline)
   (the data behind [frosthaven-storyline.com](https://frosthaven-storyline.com/)) —
   `links_to`/`linked_from` (unlock edges), `blocks_on` (mutex/lockedIf),
   `required_by` (boat/sled/climbing-gear travel gear, `calendar` time-gates,
   `puzzle` book, campaign stickers `CSS` Shard Seeker / `CITF` Into the Forest /
   `CFFK` Friend of the Fish King). The repo's flowchart SVG
   (`resources/svg/storylines/fh.svg`) was checked too — its
   `blocked`/`required` markers match the JSON exactly.
3. **Event layer.** `data/extracted/events.json`:
   direct "Unlock scenario N" rewards found on 7 event cards
   (→ scenarios 105, 113, 120, 122, 124, 128, 131).
4. **Spot checks.** Cephalofair FAQ repo
   (github.com/CephalofairGames/frosthaven-faq — flowchart errata: travel icons
   missing for 10, 22, 42, 49/50/53/54/60, 132) and The Boardgames Chronicle
   scenario reports (confirm 2↔3 permanent lockout, 4A/4B as entrance variants,
   and that scenario 4's conclusion granted "5, 7 and 8" on one path).

Conventions used:
- **Travel-gear requirements** (boat/sled/climbing gear) are *play* requirements,
  not unlock conditions → recorded only as `cond` annotations, no `manual`.
- **Sticker / puzzle / calendar / choice gates** → `manual: true` (+ prereqs when a
  parent scenario is also required), matching the prototype's
  "manual + prereqs = locked until parent, then toggled by the player" semantics.
- `hazard: true` (the draft's `caution`) marks scenarios containing a hidden
  permanent choice (4, 44, 51, 73) rather than the mutex pairs themselves —
  edge-visible closures already produce warnings via inverted `mutex`/`lockedIf`
  projection in the availability service. Frosthaven has no Ruinous-Rift-style
  scenario that closes content outside its own branch pair.

## Provenance breakdown (162 entries)

| provenance | count | meaning |
|---|---|---|
| book | 88 | derived from printed-book links/grants in the squire extract |
| book+community | 32 | book edge, with gating detail (calendar/sticker/mutex) from frosthaven-storyline |
| community | 29 | edge or condition only in frosthaven-storyline data (incl. 17 solos, rnd) |
| event | 6 | direct unlock on an event card in events.json |
| book+event | 1 | scenario 105 — both a random-scenario section and a road event unlock it |
| unknown | 6 | no trigger found in any source — flagged "not yet curated" |

Coverage: **162 scenarios total** (138 numbered mains incl. 0, 6 A/B variants,
1 random dungeon, 17 solos). **95 have scenario prereq edges; 156 have a curated
unlock condition or prereq; 6 are unknown** (84, 89, 90, 96, 132, 134).

## Findings that differ from naive readings (worth knowing)

- **Scenario 4 → 5 vs 6.** Scenario 4 has two conclusions (sections 22.1 and
  15.2): one grants Frozen Crypt (5), the other leads to Avalanche (6). Both then
  chain to section 63.1, granting 7 and 8 and adding section 156.1 ("Opening the
  Pass" → scenario 114) to the calendar four weeks out. I encoded 5/6 as
  `manual` + `mutex` — the storyline tracker does *not* mark them blocked, but
  since 4 cannot be replayed, only one ever unlocks. This mutex is my inference
  from the book text (each grant lives in a different mutually-exclusive
  conclusion); the community tracker handles it as a post-scenario prompt instead.
- **4A/4B (and 93A/93B, 74A/74B)** are variants, not separate unlocks: 4A/4B are
  different entrances depending on whether you came from 3 or 2; 74A/74B depend
  on the "Friend of the Fish King" sticker; 93A/93B on a negotiation outcome.
  The umbrella number carries the real graph edges; variants carry `cond` notes.
- **33 "Thawed Wood" reconciliation.** The extract's unlock link says section
  62.2 "Bathysphere Plans" grants 33, while the storyline says 22 → 33 with
  Into-the-Forest + calendar gating. These agree: 22's conclusion starts the
  bathysphere build (Craftsman level 3, weeks of delay, special wood from the
  forest), which grants 33, whose completion ("Bathysphere Ready", 135.1)
  grants 42.
- **52 "Fleeting Permanence" needs BOTH 45 and 46** (GHS requirement
  `[['45','46']]`; storyline text "Living Glacier COMPLETE and Dead Pass
  COMPLETE") — encoded as `all`, not `any`.
- **114 "Work Freeze"** is calendar-triggered four weeks after scenario 4
  (book-derived, easy to miss): encoded `prereqs {all:['4']}` + manual.

## Discrepancies between extract and community sources

1. **6/7/8 unlock edges are absent from the extract's GHS `unlocks` metadata**
   (scenario 4's grants live in section-book text the link extractor only
   partially captured: 22.1 grants 5; 63.1 grants 7 & 8; 15.2's reward text for
   6 was cut off by OCR). Community + raw-text scan supplied them.
2. **Section 119.3 ("Random Scenario")**: the extract's unlock link points at
   131 The Dancing Iceberg, but the section's raw text grants "Furious
   Factory 109". Probable extraction off-by-one. 131 also unlocks from road
   event SR-41, so both are encoded at category level (109 random card,
   131 event/random).
3. **Section 149.5 ("Artificer Recovered") grants 72 A Giant Block of Ice**, but
   the storyline chain is 71 → 72. Likely an alternate/fallback section for the
   personal-quest chain; kept storyline's 71 → 72 and noted here.
4. **Section 33.4 ("Pylon Problems") grants Orphan's Core 58** — a crossover from
   the side-scenario Pass chain into the Unfettered finale not present in any
   community flowchart. Not encoded (58/59 already unlock from 44/51); needs a
   book check.
5. **29/30 "War of the Spire A/B"**: storyline blocks each only against 28 (not
   against each other). Encoded as data says — `lockedIf ['28']` each — though
   completing both 29 and 30 in one campaign looks practically impossible since
   each line (5- vs 6-side) only opens one of 18/19. Left un-mutexed to avoid
   inventing a lock.
6. **Scenario 105** unlocks both via the random-scenario deck (book) and road
   event WR-49 (events.json), and storyline additionally chains it from 104.
   Encoded manual with a both-paths cond and no hard prereq on 104.
7. **Extract has placeholder rows `4`, `74`, `93`** (flowChartGroup `None`)
   alongside the A/B variants — treated as the canonical umbrella nodes, matching
   the storyline tracker's single-node treatment.

## Unknown / most uncertain entries

1. **84 Here There Be Oozes** — Job Postings group, but no granting section,
   event, or storyline edge found anywhere. Not curated.
2. **89 A Contained Fire** — same as 84.
3. **90 Frozen Treasure** — same (its *continuation* 90 → 91 is book-confirmed).
4. **96 Underground Station / 132 Temple of Feline Power** — Job Postings group
   roots with travel-gear requirements known (climbing gear) but no unlock
   trigger in any source. (Their continuations 96→97→98 and 132→133 are
   book-confirmed.)
5. **134 Tower of Knowledge** — only known gate is the "Into the Forest"
   campaign sticker; the actual granting section/event was not found.

Honorable mentions: the 5/6 mutex (inferred, see above), and 123 The Titan
(granting section "Portal of Pain" 125.1 is known, but what triggers *it* is not).

## Sources

- `data/extracted/scenario-section-books.json` (primary, printed-book extract)
- `data/extracted/events.json` (event-card unlocks)
- https://github.com/teamducro/gloomhaven-storyline — `resources/js/scenarios-fh.json` @ master (community flowchart data) and `resources/svg/storylines/fh.svg` (flowchart SVG)
- https://frosthaven-storyline.com/ (the tracker built on the above)
- https://github.com/CephalofairGames/frosthaven-faq (official FAQ/errata — flowchart icon corrections)
- https://theboardgameschronicle.com/2023/02/14/frosthaven-scenario-4-heart-of-ice/ (2↔3 lockout, 4 entrances, post-4 unlocks)
- https://theboardgameschronicle.com/2023/03/02/frosthaven-scenario-7-edge-of-the-world/ (7 unlocked after 4)
- BGG file/threads located but not retrievable without auth (HTTP 403): flowchart filepage 252367, threads 3028873 ("Unlocking Scenario 6"), 3088295, 3200566 ("Job Postings")
