/**
 * Scenario-progression dashboard threads (SQR-276) — the prototype's
 * tracker rebuilt in the ledger design system.
 *
 * Build reference: docs/artifacts/phase-4-dashboard-mockup-approved.png
 * (variant C). DESIGN.md §Phase 4 status vocabulary is authoritative:
 * sepia small-caps labels, PLAYED is the only status with a glyph (✓),
 * hazard warnings sit ADJACENT to the affected thread, never pooled.
 *
 * Statuses are derived per request (never stored); tapping an actionable
 * row posts to the toggle route, which re-renders this fragment with an
 * aria-live announcement. Marking played is one-way in v1 — un-play is a
 * destructive mutation and joins the propose→confirm gate.
 * TODO(SQR-279): allow un-play through a confirmed proposal.
 */
import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

import type { AvailabilityResult, ModuleGraph, ScenarioStatus } from '../campaign/availability.ts';
import { qualifiedKey } from '../campaign/availability.ts';
import type { Campaign } from '../db/repositories/types.ts';

const STATUS_LABEL: Record<ScenarioStatus, string> = {
  played: 'PLAYED ✓',
  skipped: 'SKIPPED',
  open: 'OPEN',
  locked: 'LOCKED',
  blocked: 'BLOCKED',
  'via-event': 'VIA EVENT',
  'drew-it': 'DREW IT',
};

/** Statuses a tap can advance (played is one-way in v1; see header note). */
const ACTIONABLE: ReadonlySet<ScenarioStatus> = new Set(['open', 'via-event', 'drew-it']);

export interface DashboardThreadsInput {
  campaign: Campaign;
  graphs: ModuleGraph[];
  availability: AvailabilityResult;
  csrfToken: string;
  /** aria-live announcement after a toggle ("Scenario 19 now open"). */
  announcement?: string;
}

function statsLine(availability: AvailabilityResult): HtmlEscapedString {
  const counts: Partial<Record<ScenarioStatus, number>> = {};
  for (const status of availability.statuses.values()) {
    counts[status] = (counts[status] ?? 0) + 1;
  }
  const stats: Array<[string, number]> = [
    ['PLAYED', counts.played ?? 0],
    ['OPEN', counts.open ?? 0],
    ['LOCKED', counts.locked ?? 0],
    ['BLOCKED', counts.blocked ?? 0],
  ];
  // Only surface SKIPPED once the party has skipped something (GH2e intro).
  if (counts.skipped) stats.splice(1, 0, ['SKIPPED', counts.skipped]);
  return html`<dl class="squire-dashboard-stats">
    ${stats.map(
      ([label, value]) =>
        html`<div class="squire-dashboard-stats__item">
          <dd class="squire-dashboard-stats__value">${value}</dd>
          <dt class="squire-dashboard-stats__label">${label}</dt>
        </div>`,
    )}
  </dl>` as HtmlEscapedString;
}

function scenarioRow(input: {
  campaignId: string;
  csrfToken: string;
  qualified: string;
  scenarioKey: string;
  name: string;
  status: ScenarioStatus;
  cond: string | null;
  /** Character-gate requirement ("NEEDS BRUISER L5") for a locked solo. */
  requirement?: string;
  /** True for a skippable intro (GH2e scenario 0): offers a Skip action. */
  skippable?: boolean;
  confirmText?: string;
}): HtmlEscapedString {
  const label = STATUS_LABEL[input.status];
  // Skip is offered only for a skippable intro that is currently open — the
  // single moment the party can decline to play it. Never on other rows.
  const showSkip = Boolean(input.skippable) && input.status === 'open';
  // A manual scenario explains itself via its event cond; a character-gated
  // solo via its class requirement. Never event language for the latter.
  const subLabel = input.status === 'via-event' && input.cond ? input.cond : input.requirement;
  const rowBody = html`<span class="squire-scenario-row__number">${input.scenarioKey}</span>
    <span class="squire-scenario-row__name"
      >${input.name}${subLabel
        ? html`<span class="squire-scenario-row__cond">${subLabel}</span>`
        : html``}</span
    >
    <span class="squire-scenario-row__status squire-scenario-row__status--${input.status}"
      >${label}</span
    >`;

  if (!ACTIONABLE.has(input.status)) {
    return html`<li class="squire-scenario-row squire-scenario-row--${input.status}">
      ${rowBody}
    </li>` as HtmlEscapedString;
  }

  // Skippable intros carry a quiet secondary Skip control beside the play tap.
  const skipForm = showSkip
    ? html`<form
        method="post"
        action="/campaigns/${input.campaignId}/scenarios/toggle"
        hx-post="/campaigns/${input.campaignId}/scenarios/toggle"
        hx-target="#squire-dashboard-threads"
        hx-swap="outerHTML"
        class="squire-scenario-row__skip-form"
      >
        <input type="hidden" name="_csrf" value="${input.csrfToken}" />
        <input type="hidden" name="key" value="${input.qualified}" />
        <input type="hidden" name="mode" value="skip" />
        <button
          type="submit"
          class="squire-scenario-row__skip"
          aria-label="Skip scenario ${input.scenarioKey} ${input.name}"
        >
          Skip
        </button>
      </form>`
    : html``;

  // Actionable rows are real forms: plain-POST safe, HTMX-enhanced swap.
  return html`<li
    class="squire-scenario-row squire-scenario-row--${input.status}${showSkip
      ? ' squire-scenario-row--skippable'
      : ''}"
  >
    <form
      method="post"
      action="/campaigns/${input.campaignId}/scenarios/toggle"
      hx-post="/campaigns/${input.campaignId}/scenarios/toggle"
      hx-target="#squire-dashboard-threads"
      hx-swap="outerHTML"
      ${input.confirmText ? html`hx-confirm="${input.confirmText}"` : html``}
    >
      <input type="hidden" name="_csrf" value="${input.csrfToken}" />
      <input type="hidden" name="key" value="${input.qualified}" />
      <button type="submit" class="squire-scenario-row__tap">${rowBody}</button>
    </form>
    ${skipForm}
  </li>` as HtmlEscapedString;
}

/**
 * The threads fragment — swap target for toggle posts. Hazard warnings
 * render inside the thread whose keys they affect.
 */
export function renderDashboardThreads(input: DashboardThreadsInput): HtmlEscapedString {
  const { availability, csrfToken, campaign } = input;
  const scenarioByQualified = new Map(
    input.graphs.flatMap((graph) =>
      graph.scenarios.map((scenario) => [qualifiedKey(graph.module, scenario.key), scenario]),
    ),
  );
  const warningByQualified = new Map(
    availability.hazardWarnings.map((warning) => [warning.key, warning]),
  );

  const threads = input.graphs
    .flatMap((graph) =>
      graph.threads.map((thread) => ({
        graph,
        thread,
        qualifiedKeys: thread.keys.map((key) => qualifiedKey(graph.module, key)),
      })),
    )
    .sort((a, b) => a.thread.position - b.thread.position);

  return html`<section
    class="squire-campaign-dashboard__threads"
    id="squire-dashboard-threads"
    aria-label="Scenario progression"
  >
    <p class="squire-dashboard-announce" aria-live="polite" role="status">
      ${input.announcement ?? ''}
    </p>
    ${statsLine(availability)}
    <div class="squire-dashboard-grid">
      ${threads.map(({ thread, qualifiedKeys }) => {
        // Skipped scenarios are done too — count them toward thread progress.
        const playedCount = qualifiedKeys.filter((key) => {
          const status = availability.statuses.get(key);
          return status === 'played' || status === 'skipped';
        }).length;
        const threadWarnings = qualifiedKeys
          .map((key) => warningByQualified.get(key))
          .filter((warning): warning is NonNullable<typeof warning> => warning !== undefined);
        return html`<section class="squire-dashboard-thread">
          <header class="squire-dashboard-thread__header">
            <h2 class="squire-dashboard-thread__title">${thread.label}</h2>
            <p class="squire-dashboard-thread__note">
              ${thread.note}
              <span class="squire-dashboard-thread__progress"
                >${playedCount}/${qualifiedKeys.length}</span
              >
            </p>
          </header>
          <ul class="squire-dashboard-thread__rows">
            ${qualifiedKeys.map((qualified) => {
              const scenario = scenarioByQualified.get(qualified);
              const status = availability.statuses.get(qualified);
              if (!scenario || !status) return html``;
              const warning = warningByQualified.get(qualified);
              return scenarioRow({
                campaignId: campaign.id,
                csrfToken,
                qualified,
                scenarioKey: scenario.key,
                name: scenario.name,
                status,
                cond: scenario.cond,
                skippable: scenario.skippable,
                requirement:
                  status === 'locked' && scenario.unlockClass
                    ? `NEEDS ${scenario.unlockClass.toUpperCase()} L${scenario.unlockMinLevel ?? 1}`
                    : undefined,
                confirmText:
                  warning || scenario.hazard
                    ? warning
                      ? `Playing ${scenario.key} permanently closes ${warning.closes
                          .map((key) => key.split(':')[1])
                          .join(', ')}. Mark it played?`
                      : `Scenario ${scenario.key} contains a permanent choice. Mark it played?`
                    : undefined,
              });
            })}
          </ul>
          ${threadWarnings.map(
            (warning) =>
              html`<div class="squire-banner squire-banner--amber" role="note">
                <span class="squire-banner__label">HAZARD</span>
                <p class="squire-banner__body">
                  Playing ${warning.key.split(':')[1]} permanently closes
                  ${warning.closes.map((key) => key.split(':')[1]).join(', ')}.
                </p>
              </div>`,
          )}
        </section>`;
      })}
    </div>
    ${availability.unknownKeys.length > 0
      ? html`<p class="squire-dashboard-footnote">
          UNKNOWN: ${availability.unknownKeys.join(', ')} — not in the curated graph yet. The graph
          is advisory; trust the game.
        </p>`
      : html``}
  </section>` as HtmlEscapedString;
}
