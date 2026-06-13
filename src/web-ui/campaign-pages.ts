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

import type { CampaignDetail, PendingInvite } from '../campaign/campaign-service.ts';
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

export interface CampaignListRow {
  campaign: Campaign;
  memberCount: number;
  role: 'owner' | 'member';
  active: boolean;
}

export interface CampaignListPageData {
  rows: CampaignListRow[];
  invites: PendingInvite[];
  csrfToken: string;
  /** Rendered above the list after a failed form post. */
  errorMessage?: string;
}

/** `/campaigns` — list, create, accept, leave, switch (SQR-11). */
export function renderCampaignListContent(data: CampaignListPageData): HtmlEscapedString {
  return html`<section class="squire-campaigns">
    <h1 class="squire-campaigns__title">Campaigns</h1>
    ${data.errorMessage
      ? html`<div class="squire-banner squire-banner--error" role="alert">
          <span class="squire-banner__label">COULD NOT SAVE</span>
          <p class="squire-banner__body">${data.errorMessage}</p>
        </div>`
      : html``}
    ${data.invites.length > 0
      ? html`<section class="squire-campaigns__invites" aria-label="Pending invites">
          <h2 class="squire-campaigns__section-title">Invitations</h2>
          <ul class="squire-campaigns__list">
            ${data.invites.map(
              (invite) =>
                html`<li class="squire-campaigns__row squire-campaigns__row--invite">
                  <span class="squire-campaigns__name">${invite.campaignName}</span>
                  <span class="squire-campaigns__meta"
                    >${gameLabel(invite.game)}${invite.inviterName
                      ? html` · INVITED BY ${invite.inviterName.toUpperCase()}`
                      : html``}</span
                  >
                  <form method="post" action="/campaigns/invites/${invite.memberId}/accept">
                    <input type="hidden" name="_csrf" value="${data.csrfToken}" />
                    <button type="submit" class="squire-campaigns__action">ACCEPT</button>
                  </form>
                </li>`,
            )}
          </ul>
        </section>`
      : html``}
    ${data.rows.length === 0
      ? html`<p class="squire-campaigns__empty">
          No campaigns yet — create one below, or just
          <a href="/">tell Squire about your table in chat</a>.
        </p>`
      : html`<ul class="squire-campaigns__list">
          ${data.rows.map(
            (row) =>
              html`<li class="squire-campaigns__row">
                <a class="squire-campaigns__link" href="/campaigns/${row.campaign.id}">
                  <span class="squire-campaigns__name">${row.campaign.name}</span>
                  <span class="squire-campaigns__meta"
                    >${gameLabel(row.campaign.game)} ·
                    ${row.campaign.modules.join(' + ').toUpperCase() || 'NO MODULES'} ·
                    ${row.memberCount} ${row.memberCount === 1 ? 'MEMBER' : 'MEMBERS'} ·
                    ${row.role.toUpperCase()}</span
                  >
                </a>
                <div class="squire-campaigns__row-actions">
                  ${row.active
                    ? html`<span class="squire-campaigns__active" aria-current="true">ACTIVE</span>`
                    : html`<form method="post" action="/campaigns/${row.campaign.id}/activate">
                        <input type="hidden" name="_csrf" value="${data.csrfToken}" />
                        <button type="submit" class="squire-campaigns__action">MAKE ACTIVE</button>
                      </form>`}
                  ${row.role === 'member'
                    ? html`<form method="post" action="/campaigns/${row.campaign.id}/leave-web">
                        <input type="hidden" name="_csrf" value="${data.csrfToken}" />
                        <button type="submit" class="squire-campaigns__action">LEAVE</button>
                      </form>`
                    : html``}
                </div>
              </li>`,
          )}
        </ul>`}
    <section class="squire-campaigns__create" aria-label="Create a campaign">
      <h2 class="squire-campaigns__section-title">New campaign</h2>
      <form method="post" action="/campaigns" class="squire-campaigns__create-form">
        <input type="hidden" name="_csrf" value="${data.csrfToken}" />
        <label class="squire-campaigns__field">
          <span class="squire-campaigns__field-label">NAME</span>
          <input name="name" type="text" required maxlength="200" autocomplete="off" />
        </label>
        <label class="squire-campaigns__field">
          <span class="squire-campaigns__field-label">GAME</span>
          <select name="game">
            <option value="frosthaven">Frosthaven</option>
            <option value="gloomhaven-2e">Gloomhaven (2nd Edition)</option>
          </select>
        </label>
        <button type="submit" class="squire-campaigns__submit">CREATE</button>
      </form>
    </section>
  </section>` as HtmlEscapedString;
}

/** Sheet links on the dashboard (SQR-277): name · class · level rows. */
export interface DashboardCharacterRow {
  id: string;
  name: string;
  className: string;
  level: number;
  placeholder: boolean;
}

/** `/campaigns/:id` — dashboard: header, threads (SQR-276), roster. */
export function renderCampaignDashboardContent(
  detail: CampaignDetail,
  threadsFragment?: HtmlEscapedString,
  journalFragment?: HtmlEscapedString,
  characters?: DashboardCharacterRow[],
): HtmlEscapedString {
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
    ${characters && characters.length > 0
      ? html`<section class="squire-campaign-dashboard__characters" aria-label="Characters">
          <h2 class="squire-campaign-dashboard__section-title">Characters</h2>
          <ul class="squire-campaign-dashboard__members">
            ${characters.map(
              (character) =>
                html`<li class="squire-campaign-dashboard__member">
                  <a
                    class="squire-campaign-dashboard__character-link"
                    href="/characters/${character.id}"
                    >${character.name}</a
                  >
                  <span class="squire-campaign-dashboard__member-role"
                    >${character.className.toUpperCase()} ·
                    L${character.level}${character.placeholder ? ' · UNCLAIMED' : ''}</span
                  >
                </li>`,
            )}
          </ul>
        </section>`
      : html``}
    ${threadsFragment ??
    html`<section
      class="squire-campaign-dashboard__threads"
      id="squire-dashboard-threads"
      aria-label="Scenario progression"
    >
      <p class="squire-campaign-dashboard__placeholder">
        No scenario data for this campaign's modules yet.
      </p>
    </section>`}
    ${journalFragment ?? html``}
  </section>` as HtmlEscapedString;
}
