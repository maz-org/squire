/**
 * Campaign journal surface (SQR-278) — the session timeline on
 * `/campaigns/:id`, rendered from the SQR-266 read-model.
 *
 * Redaction is upstream and structural: `listJournal` whitelists payload
 * keys per entity type, so nothing rendered here can carry private-tier
 * values. This module only turns redacted entries into the ledger
 * vocabulary (DESIGN.md §Journal entries): date heading in Fraunces,
 * Geist small-caps entry lines like `SCENARIO 14 · PLAYED`.
 */
import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

import type { JournalDay, JournalEntry } from '../campaign/journal.ts';

function addedKeys(entry: JournalEntry, field: string): string[] {
  const before = (entry.before?.[field] as string[] | undefined) ?? [];
  const after = (entry.after?.[field] as string[] | undefined) ?? [];
  return after.filter((key) => !before.includes(key));
}

function shortKey(qualified: string): string {
  return (qualified.split(':')[1] ?? qualified).toUpperCase();
}

/**
 * One small-caps line per entry. Falls back to the raw mutation type when
 * no specific phrasing applies — never invents detail.
 */
export function journalEntryLine(entry: JournalEntry): string {
  if (entry.mutationType === 'campaign.update') {
    const played = addedKeys(entry, 'playedScenarios');
    if (played.length > 0) {
      return played.map((key) => `SCENARIO ${shortKey(key)} · PLAYED`).join(' · ');
    }
    const drawn = addedKeys(entry, 'drawnScenarios');
    if (drawn.length > 0) {
      return drawn.map((key) => `SCENARIO ${shortKey(key)} · UNLOCKED`).join(' · ');
    }
    const beforeProsperity = entry.before?.prosperity;
    const afterProsperity = entry.after?.prosperity;
    if (typeof afterProsperity === 'number' && afterProsperity !== beforeProsperity) {
      return `PROSPERITY → ${afterProsperity}`;
    }
    return 'CAMPAIGN UPDATED';
  }
  if (entry.mutationType === 'character.update') {
    const name = typeof entry.after?.name === 'string' ? entry.after.name : null;
    const level = entry.after?.level;
    if (typeof level === 'number') {
      return `${(name ?? 'CHARACTER').toUpperCase()} → L${level}`;
    }
    return `${(name ?? 'CHARACTER').toUpperCase()} UPDATED`;
  }
  if (entry.mutationType === 'character.create') {
    const name = typeof entry.after?.name === 'string' ? entry.after.name : 'CHARACTER';
    const className = typeof entry.after?.className === 'string' ? entry.after.className : '';
    return `${name.toUpperCase()} JOINS THE PARTY${className ? ` · ${className.toUpperCase()}` : ''}`;
  }
  if (entry.mutationType === 'member.join') {
    const email = typeof entry.after?.email === 'string' ? entry.after.email : 'A MEMBER';
    return `${email.toUpperCase()} JOINED`;
  }
  if (entry.mutationType === 'campaign.create') return 'CAMPAIGN FOUNDED';
  // Generic fallback: the typed mutation name, ledger-cased.
  return entry.mutationType.replace(/[._]/g, ' ').toUpperCase();
}

function formatDayHeading(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return `Session of ${parsed.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })}`;
}

export function renderCampaignJournal(days: JournalDay[]): HtmlEscapedString {
  return html`<section class="squire-campaign-journal" aria-label="Campaign journal">
    <h2 class="squire-campaign-dashboard__section-title">Journal</h2>
    ${
      days.length === 0
        ? html`<p class="squire-campaign-journal__empty">
            No sessions recorded yet — finish a scenario and tell Squire about it.
          </p>`
        : days.map(
            (day) =>
              html`<section class="squire-campaign-journal__day">
                <h3 class="squire-campaign-journal__date">${formatDayHeading(day.date)}</h3>
                <ul class="squire-campaign-journal__entries">
                  ${day.entries.map(
                    (entry) =>
                      html`<li class="squire-campaign-journal__entry">
                        <span class="squire-campaign-journal__line"
                          >${journalEntryLine(entry)}</span
                        >
                        ${
                          entry.actorName
                            ? html`<span class="squire-campaign-journal__actor"
                                >${entry.actorName.toUpperCase()}</span
                              >`
                            : html``
                        }
                      </li>`,
                  )}
                </ul>
              </section>`,
          )
    }
  </section>` as HtmlEscapedString;
}
