# Campaign Workspace Redesign Design Plan

Status: in review  
Date: 2026-06-19  
Branch: `bcm/sqr-324-325-326-party-character-polish`

## Problem

The current campaign Party page does not read as a campaign workspace. It hides
wayfinding, mixes character-party work with player-invite work, treats campaign
settings as loose text labels, and frames scenario progress as a flat tab rather
than the campaign progression surface players expect.

## Root Decision

Campaign pages are a full Campaign workspace, not a two-tab dashboard.

The top-level workspace sections are:

- `Progress`: scenario flowchart/progression, scenario stats, and journal.
- `Party`: player characters only, including active and retired characters.
- `Players`: joined members, pending invites, roles, remove member, leave campaign.
- `Settings`: campaign name, optional content/modules, and other campaign setup.

## Approved Mockup

The build must use the approved mockup as the visual reference, not as disposable
concept art.

| Screen                   | Approved Mockup                                                                                | Direction                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Campaign workspace Party | `/Users/bcm/.gstack/projects/maz-org-squire/designs/campaign-workspace-20260619/variant-A.png` | Start with Variant A. Add Variant C's navigation tab icons and action button treatment. Include a visible way to view retired characters. |

Supporting artifact:
`/Users/bcm/.gstack/projects/maz-org-squire/designs/campaign-workspace-20260619/approved.json`

## Visual Parity Requirement

Before review or ship, the implementation must be compared against the approved
mockup.

Decision: visual parity with the approved mockup is strict. The mockup is not
only directional. Build from Variant A, add Variant C's icon-tab navigation and
action-button treatment, and keep the finished Party page visibly recognizable
as that approved design.

Required checks:

- Open the built Party page in the browser at desktop and mobile widths.
- Capture screenshots of the built page.
- Compare the desktop screenshot to the approved mockup with
  `gstack design verify` or an equivalent visual review.
- Compare the mobile screenshot against the same design direction, with special
  attention to visible icon tabs, row actions, and text fit.
- Document any intentional differences in the PR description or review notes.
- Do not accept a build that keeps the current confusing IA while only changing
  spacing, labels, or colors.

## Information Architecture

Campaign workspace shell:

```text
Squire / Campaigns / Travel Campaign
Campaign: Travel Campaign          GH2

Progress | Party | Players | Settings

[section content]
```

Decision: mobile keeps the same four workspace sections visible as compact icon
tabs under the campaign header. Each tab has a familiar icon plus label:
`Progress`, `Party`, `Players`, `Settings`. The bar may scroll horizontally only
on very narrow screens. Do not hide `Players` or `Settings` behind a vague
`More` menu, because those sections are what separate character work from
player/admin work.

Party section:

```text
Party                                      Add character

Active characters
Manual Bruiser        Bruiser 3        Open sheet  Level  Retire  Remove

Retired characters
Name                  Class level      Open sheet
```

Decision: Party shows `Active characters` first, then a visible `Retired
characters` section below it. Active characters are the live gameplay state and
must stay easiest to scan. Retired characters are campaign history and must stay
findable without moving them to Settings or requiring search.

Players section:

```text
Players                                   Invite player

Joined players
Name / email          Role             Remove

Pending invites
Email                 Invited          Cancel
```

Settings section:

```text
Settings

Campaign name
Optional content / modules
Danger zone, if needed later
```

Decision: `Players` and `Settings` ship as real basic pages in the workspace
redesign, not placeholders. Players must cover joined players, pending invites,
new invites, and basic remove/cancel actions. Settings must cover campaign name
and optional content/modules with clear labels. A workspace nav item must not be
dead or decorative.

## Routes And Entry Behavior

Decision: the campaign root opens Progress by default.

Required routes:

- `/campaigns/:id`: Progress, the scenario flow/progression surface.
- `/campaigns/:id/party`: Party, active and retired characters.
- `/campaigns/:id/players`: Players, joined members and pending invites.
- `/campaigns/:id/settings`: Settings, campaign name and optional content.

The workspace header must make the current campaign clear on every route and
must provide a visible path back to the campaign list/home surface. Direct links
to section routes should be stable enough for bug reports, support, and manual
testing.

## Progress Scope

Decision: Progress is a real campaign progression surface in this redesign.

The first version does not need to model every scenario dependency perfectly, but
it must stop presenting campaign progress as only a flat scenario list. The
page should make it obvious which scenarios are available, which are completed,
and where the campaign can move next.

Required first version:

- A progression-oriented layout at `/campaigns/:id`, not a generic table.
- Scenario nodes or grouped rows that visually distinguish available,
  completed, locked, and unavailable or unknown scenarios.
- A clear primary action for recording scenario progress.
- Recent campaign progress or journal context near the progression surface.
- Any open-scenario count or scenario-status summary belongs here, not on
  Party.
- If full flowchart data is incomplete, show a simplified progression view with
  explicit missing-data treatment rather than falling back to a plain list.

Non-goals for this pass:

- Full Gloomhaven/Frosthaven scenario dependency correctness if the current
  data model does not support it yet.
- Large custom canvas or pan/zoom flowchart behavior.
- Optimizing the scenario graph for every expansion/module.

## Campaign Switching

Decision: the workspace header includes a campaign switcher.

The header must show:

- The current campaign name as a first-viewport signal.
- A compact switcher/dropdown for other campaigns.
- A visible `Campaigns` or `Home` link that returns to the campaign list/home
  surface.
- The campaign system, such as `GH2`, as metadata near the campaign name
  instead of as a detached page fact.

The switcher is for changing campaign context. It must not replace the section
navigation. The user should always be able to answer: which campaign am I in,
where are the campaign sections, and how do I get back to my campaign list?

## Component System

Decision: the campaign workspace uses explicit shared components, not ad hoc
forms and loose text controls.

Required components:

- **Campaign workspace header**: campaign name, campaign system metadata,
  campaign switcher, and `Campaigns`/`Home` return link. The campaign name is
  the dominant signal on campaign routes; the Squire brand is secondary.
- **Workspace icon tabs**: four visible tabs for `Progress`, `Party`,
  `Players`, and `Settings`. Each tab has an icon plus text label, 44px minimum
  tap target, clear active state, and stable URL. Do not use a vague `More`
  menu for core sections.
- **Section action bar**: section heading on the left, primary section action on
  the right. Examples: `Add character`, `Invite player`, `Save settings`,
  `Record progress`. These must read as buttons, not detached small-caps text.
- **Character rows**: fixed-format rows with visible actions. Active rows show
  character name, compact class/level text such as `Bruiser 3`, `Open sheet`,
  `Level`, `Retire`, and `Remove`. Retired rows stay visible below active rows
  and use quieter treatment without disappearing into Settings.
- **Player rows**: joined-player rows and pending-invite rows are separate.
  Joined rows show display name/email, role, and remove action. Pending rows
  show email, invited state, and cancel action.
- **Scenario progress items**: use the scenario status vocabulary from
  `DESIGN.md`. Progress states should be clear but restrained; avoid loud badge
  piles that compete with the flow.
- **Inline errors**: validation and action failures render next to the failed
  control or row. Do not pool unrelated failures at the top of the page.
- **Destructive confirmations**: removing a character, retiring a character, or
  removing a player requires explicit confirmation with cancel and confirm
  actions. The confirmation must name the thing being changed.

## Interaction State Coverage

Every campaign workspace section needs designed states before implementation.
Do not leave empty, loading, or failure states to generic framework output.

| Section  | Loading                                                                                  | Empty                                                                                                                                                 | Success                                                                                                                              | Partial                                                                                                                        | Error                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Progress | Preserve the workspace shell and show a compact loading row where the flowchart belongs. | New campaign shows a clear start state with no open-scenario count on Party.                                                                          | Show campaign progression as the primary surface, with flowchart/journal framing rather than a flat scenario list.                   | If only some scenario metadata is available, keep the page usable and mark missing details inline.                             | Show a recoverable error with retry; keep campaign navigation and header visible.                                                               |
| Party    | Preserve the workspace shell and reserve stable row height for character lists.          | Active characters says no active characters yet and puts `Add character` in the section action position. Retired characters can say none retired yet. | Active characters first, retired characters second, visible row actions without hover. Compact class/level text such as `Bruiser 3`. | If retired characters fail but active characters load, show active characters and an inline retired-section error.             | Failed add/edit/level/retire/remove actions keep the user on Party, preserve entered values, and show the failure next to the relevant control. |
| Players  | Preserve joined and pending sections so layout does not jump.                            | Joined players still shows the current user/owner where available. Pending invites says none pending.                                                 | Joined players, pending invites, invite action, remove/cancel actions are all visible and labeled as campaign membership work.       | If pending invites fail but joined players load, joined players remain usable and pending invites shows an inline retry.       | Failed invite/remove/cancel actions preserve the email or row state and show the failure next to the action.                                    |
| Settings | Preserve form layout with disabled controls while loading existing campaign settings.    | Settings still renders campaign name and optional content controls with current defaults.                                                             | Campaign name and optional content save independently where possible, with explicit saved/error feedback.                            | If optional content metadata fails but campaign name loads, campaign name remains editable and optional content shows a retry. | Failed save keeps edited values in place and explains which setting was not saved.                                                              |

Shared requirements:

- Workspace header and section navigation stay visible in every state.
- Primary actions show a pending/submitting state and cannot be double-submitted.
- Errors use plain language and do not expose database IDs, stack traces, or
  raw provider payloads.
- Destructive actions require an explicit confirmation pattern before removing
  a player or character.
- Success feedback must be quiet and local to the changed control; do not use
  disruptive page-level banners for routine saves.

## Implementation Strategy

Decision: implement this as a dedicated campaign workspace redesign track, not
as incidental Party polish on the current SQR-324/SQR-325/SQR-326 branch.

The implementation work should be split into scoped issues and a dedicated
branch or small branch series. The current Party polish work can inform the
redesign, but it should not be treated as complete just because it improves the
existing Party page.

Implementation must preserve these gates:

- Start from the approved mockup and this plan.
- Keep route changes, data/model changes, UI components, and QA acceptance
  explicit in the issue set.
- Build Progress, Party, Players, Settings, campaign switching, state coverage,
  and visual parity as one coherent workspace.
- Review against `DESIGN.md` v0.13 and this plan before shipping.
- Include manual browser QA for desktop and mobile.

## Implementation Issue Split

Decision: split implementation by user-visible sections.

### Issue 1: SQR-358 - Build the campaign workspace shell and navigation

Scope:

- Create the shared campaign workspace shell.
- Add the campaign header, campaign switcher, campaign system metadata, and
  visible `Campaigns`/`Home` return link.
- Add path-backed icon tabs for `Progress`, `Party`, `Players`, and `Settings`.
- Ensure `/campaigns/:id` opens Progress and section routes remain stable.

Acceptance:

- Every campaign workspace route makes the current campaign obvious.
- Users can switch campaigns or return to the campaign list/home from the
  header.
- Mobile shows visible icon-plus-label tabs without hiding core sections behind
  `More`.
- Shell loading and error states keep header and navigation visible.
- Desktop and mobile screenshots are attached to review notes.

### Issue 2: SQR-359 - Build the Progress section

Scope:

- Replace the flat scenario-list mental model with a first-version progression
  surface at `/campaigns/:id`.
- Show available, completed, locked, and unknown scenarios with clear restrained
  status treatment.
- Move scenario counts and scenario progress summaries into Progress.
- Add the primary `Record progress` action and local feedback states.

Acceptance:

- `/campaigns/:id` reads as campaign progression, not a generic table.
- Scenario status treatment follows `DESIGN.md`.
- Progress supports loading, empty, partial-data, success, and recoverable error
  states.
- If full flowchart data is incomplete, the page shows a simplified progression
  view with explicit missing-data treatment.
- Party no longer carries open-scenario counts or scenario-management framing.

### Issue 3: SQR-360 - Build the Party section

Scope:

- Rebuild `/campaigns/:id/party` around active and retired characters.
- Keep active characters first and retired characters visible below.
- Use compact class/level text such as `Bruiser 3`.
- Make character row actions visible without hover.
- Add confirmations for retire/remove and local failure states.

Acceptance:

- Party is only character state, not campaign membership.
- Active rows show name, compact class/level, `Open sheet`, `Level`, `Retire`,
  and `Remove`.
- Retired characters are findable on the page without going to Settings.
- `Add character` appears in the section action position and has submitting and
  failure states.
- Desktop implementation is compared against the approved Party mockup.

### Issue 4: SQR-361 - Build the Players section

Scope:

- Add `/campaigns/:id/players`.
- Show joined players and pending invites as separate sections.
- Move invite creation, invite cancellation, and member removal out of Party.
- Add row-level errors and destructive confirmations.

Acceptance:

- Players clearly reads as campaign membership, not character management.
- Joined players show display name/email, role, and remove action.
- Pending invites show email, invited state, and cancel action.
- Invite, remove, and cancel actions have pending and failure states.
- Empty states are explicit for no pending invites and any missing membership
  data.

### Issue 5: SQR-362 - Build the Settings section

Scope:

- Add `/campaigns/:id/settings`.
- Move campaign name editing and optional content/modules management here.
- Replace loose `Rename` and `Modules` controls with explicit labels.
- Add local save feedback and partial metadata failure states.

Acceptance:

- Settings clearly owns campaign setup, not character or player work.
- `Campaign name` and `Optional content` are visible labels.
- Settings supports loading, empty/default, partial-data, success, and failed
  save states.
- Failed saves keep edited values in place and identify the setting that was not
  saved.

### Issue 6: SQR-363 - Final visual QA and workspace review

Scope:

- Run the final browser review after the shell and four sections are built.
- Compare the Party page to the approved mockup.
- Verify desktop and mobile layouts for every workspace section.
- Document intentional visual differences.

Acceptance:

- Desktop Party screenshot is compared to
  `/Users/bcm/.gstack/projects/maz-org-squire/designs/campaign-workspace-20260619/variant-A.png`.
- Mobile screenshots confirm icon tabs, row actions, text fit, and no overlap.
- Manual QA covers Progress, Party, Players, Settings, campaign switching, and
  destructive confirmations.
- PR notes list any intentional differences from the approved mockup and this
  plan.

## Design Notes

- Party is character state, not campaign membership.
- Invites and member removal belong to Players.
- Rename and modules belong to Settings and must use explicit labels:
  `Campaign name` and `Optional content`, not loose `Rename` / `Modules`
  toggles.
- Progress should be named for gameplay progression, not `Scenarios` as a flat
  list.
- Party does not need the open scenario count; that belongs to Progress.
- Clickable character rows and actions must be visible without hover.
- Character class and level should be compact, for example `Bruiser 3`.

## Open Design Questions

None for information architecture.
