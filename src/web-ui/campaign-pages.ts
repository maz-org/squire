/**
 * Phase 4 campaign surfaces (SQR-275): the route shells and the header
 * context strip that bridges them.
 *
 * DESIGN.md §Phase 4 Components is authoritative: dedicated routes under
 * the ledger shell; the strip shows the active campaign (campaign name
 * outranks the Squire brand on campaign surfaces) or `NO CAMPAIGN ·
 * SET UP`; it never shows fake state. The dashboard content itself
 * (threads, statuses) lands in SQR-276 — this module owns the shells.
 */
import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

import type { CampaignDetail } from '../campaign/campaign-service.ts';
import type { Campaign } from '../db/repositories/types.ts';
import { gameDefinitionFor, isGameId } from '../game.ts';

/** Header context-strip state. Null = signed-in user with no campaigns. */
export interface CampaignStripState {
  campaignId: string;
  campaignName: string;
  game: string;
  /** e.g. 'DRIFTER L4' once an active character exists (SQR-277 scope). */
  characterLabel?: string;
}

function gameLabel(game: string): string {
  return isGameId(game) ? gameDefinitionFor(game).sourcePrefix.toUpperCase() : game.toUpperCase();
}

/**
 * The persistent bridge: tap → campaign dashboard. `prominent` marks
 * campaign surfaces, where the campaign name outranks the brand.
 */
export function renderCampaignStrip(
  strip: CampaignStripState | null,
  options: { prominent?: boolean } = {},
): HtmlEscapedString {
  if (!strip) {
    return html`<a class="squire-campaign-strip squire-campaign-strip--empty" href="/campaigns"
      >NO CAMPAIGN · SET UP</a
    >` as HtmlEscapedString;
  }
  const classes = options.prominent
    ? 'squire-campaign-strip squire-campaign-strip--prominent'
    : 'squire-campaign-strip';
  // One string so the template can never wrap mid-label.
  const label = [gameLabel(strip.game), strip.campaignName.toUpperCase(), strip.characterLabel]
    .filter(Boolean)
    .join(' · ');
  return html`<a
    class="${classes}"
    href="/campaigns/${strip.campaignId}"
    aria-label="Open campaign ${strip.campaignName}"
    >${label}</a
  >` as HtmlEscapedString;
}

/** `/campaigns` — the picker shell (create/join forms land in SQR-11). */
export function renderCampaignListContent(campaigns: Campaign[]): HtmlEscapedString {
  return html`<section class="squire-campaigns">
    <h1 class="squire-campaigns__title">Campaigns</h1>
    ${campaigns.length === 0
      ? html`<p class="squire-campaigns__empty">
          No campaigns yet — create one and Squire keeps the ledger.
        </p>`
      : html`<ul class="squire-campaigns__list">
          ${campaigns.map(
            (campaign) =>
              html`<li class="squire-campaigns__row">
                <a class="squire-campaigns__link" href="/campaigns/${campaign.id}">
                  <span class="squire-campaigns__name">${campaign.name}</span>
                  <span class="squire-campaigns__meta"
                    >${gameLabel(campaign.game)} · PROSPERITY ${campaign.prosperity} · PLAYED
                    ${campaign.playedScenarios.length}</span
                  >
                </a>
              </li>`,
          )}
        </ul>`}
  </section>` as HtmlEscapedString;
}

/** `/campaigns/:id` — dashboard shell: header, stats line, roster. */
export function renderCampaignDashboardContent(detail: CampaignDetail): HtmlEscapedString {
  const { campaign } = detail;
  const activeMembers = detail.members.filter((member) => member.status === 'active');
  return html`<section class="squire-campaign-dashboard" data-campaign-id="${campaign.id}">
    <header class="squire-campaign-dashboard__header">
      <h1 class="squire-campaign-dashboard__name">${campaign.name}</h1>
      <p class="squire-campaign-dashboard__stats">
        ${gameLabel(campaign.game)} · PROSPERITY ${campaign.prosperity} · PLAYED
        ${campaign.playedScenarios.length} · DRAWN ${campaign.drawnScenarios.length}
      </p>
    </header>
    <section class="squire-campaign-dashboard__roster" aria-label="Party roster">
      <h2 class="squire-campaign-dashboard__section-title">Party</h2>
      <ul class="squire-campaign-dashboard__members">
        ${activeMembers.map(
          (member) =>
            html`<li class="squire-campaign-dashboard__member">
              ${member.name ?? member.email}
              <span class="squire-campaign-dashboard__member-role"
                >${member.role.toUpperCase()}</span
              >
            </li>`,
        )}
      </ul>
    </section>
    <section
      class="squire-campaign-dashboard__threads"
      id="squire-dashboard-threads"
      aria-label="Scenario progression"
    >
      <!-- SQR-276 renders thread sections + derived statuses here. -->
      <p class="squire-campaign-dashboard__placeholder">
        Scenario progression arrives with the dashboard build-out.
      </p>
    </section>
  </section>` as HtmlEscapedString;
}
