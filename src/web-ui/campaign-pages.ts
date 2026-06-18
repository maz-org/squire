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
import { allOptionalModuleOptions, gameDefinitionFor, isGameId, moduleLabel } from '../game.ts';

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
        ${allOptionalModuleOptions().length > 0
          ? html`<fieldset class="squire-campaigns__field squire-campaigns__modules">
              <legend class="squire-campaigns__field-label">OPTIONAL CONTENT</legend>
              ${allOptionalModuleOptions().map(
                (option) =>
                  html`<label class="squire-campaigns__module">
                    <input type="checkbox" name="module" value="${option.module}" checked />
                    ${moduleLabel(option.module)}
                    <span class="squire-campaigns__module-game">${option.gameLabel}</span>
                  </label>`,
              )}
            </fieldset>`
          : html``}
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

/** The "New character" create form on the dashboard (SQR-318). */
export interface CharacterCreateForm {
  csrfToken: string;
  /**
   * Valid class names for the campaign's game (real names only, never
   * codenames). A populated list renders a select — structurally preventing
   * an invalid class. Empty (no imported mats) degrades to a free-text input.
   */
  classOptions: string[];
  /** Inline error rendered above the form after a failed create attempt. */
  errorMessage?: string;
}

/** The dashboard Characters section: existing sheet links + the create form. */
function renderCharacterCreateForm(
  campaignId: string,
  data: CharacterCreateForm,
): HtmlEscapedString {
  return html`${data.errorMessage
      ? html`<div class="squire-banner squire-banner--error" role="alert">
          <span class="squire-banner__label">COULD NOT SAVE</span>
          <p class="squire-banner__body">${data.errorMessage}</p>
        </div>`
      : html``}
    <form
      method="post"
      action="/campaigns/${campaignId}/characters"
      class="squire-character-create"
      aria-label="Add a character"
    >
      <input type="hidden" name="_csrf" value="${data.csrfToken}" />
      <label class="squire-character-create__field">
        <span class="squire-character-create__field-label">NAME</span>
        <input name="name" type="text" required maxlength="100" autocomplete="off" />
      </label>
      <label class="squire-character-create__field">
        <span class="squire-character-create__field-label">CLASS</span>
        ${data.classOptions.length > 0
          ? html`<select name="className" required>
              ${data.classOptions.map((cls) => html`<option value="${cls}">${cls}</option>`)}
            </select>`
          : html`<input
              name="className"
              type="text"
              required
              maxlength="100"
              autocomplete="off"
            />`}
      </label>
      <label class="squire-character-create__field">
        <span class="squire-character-create__field-label">LEVEL</span>
        <input name="level" type="number" min="1" max="20" value="1" />
      </label>
      <button type="submit" class="squire-character-create__submit">ADD CHARACTER</button>
    </form>` as HtmlEscapedString;
}

/** The dashboard "Invite member" affordance state (SQR-319). */
export interface InviteMemberForm {
  csrfToken: string;
  /** Owner sees the form inputs; non-owners only ever see an error (if any). */
  canInvite: boolean;
  /** Inline error rendered after a failed invite attempt. */
  errorMessage?: string;
}

/**
 * The Party-section invite affordance. The error banner renders independently
 * of the form so a non-owner who tampers the route still sees the rejection,
 * while only the owner ever sees the form inputs.
 */
function renderInviteMemberForm(campaignId: string, data: InviteMemberForm): HtmlEscapedString {
  return html`${data.errorMessage
    ? html`<div class="squire-banner squire-banner--error" role="alert">
        <span class="squire-banner__label">COULD NOT SAVE</span>
        <p class="squire-banner__body">${data.errorMessage}</p>
      </div>`
    : html``}
  ${data.canInvite
    ? html`<form
        method="post"
        action="/campaigns/${campaignId}/invites"
        class="squire-invite-member"
        aria-label="Invite a member"
      >
        <input type="hidden" name="_csrf" value="${data.csrfToken}" />
        <label class="squire-invite-member__field">
          <span class="squire-invite-member__field-label">INVITE BY EMAIL</span>
          <input name="email" type="email" required maxlength="320" autocomplete="off" />
        </label>
        <button type="submit" class="squire-invite-member__submit">INVITE</button>
      </form>`
    : html``}` as HtmlEscapedString;
}

/** The dashboard "Rename campaign" affordance (SQR-320). */
export interface CampaignRenameForm {
  csrfToken: string;
  /** Optimistic-concurrency token; submitted as expectedVersion. */
  version: number;
  /** Inline error/notice after a failed rename (validation or version race). */
  errorMessage?: string;
}

/** The dashboard "Modules" editor affordance (SQR-321). */
export interface CampaignModulesForm {
  csrfToken: string;
  version: number;
  /** The game's base module — always on, never removable. */
  baseModule: string;
  /** Optional module ids the game offers (e.g. solo scenarios). */
  optionalModules: readonly string[];
  /** The campaign's current module set (to seed the checkboxes). */
  current: readonly string[];
  errorMessage?: string;
}

export interface CampaignDashboardHeaderStats {
  openScenarioCount?: number;
}

function campaignDashboardHeaderStatsLine(
  campaign: Campaign,
  headerStats?: CampaignDashboardHeaderStats,
): string {
  return [
    gameLabel(campaign.game),
    `PROSPERITY ${campaign.prosperity}`,
    typeof headerStats?.openScenarioCount === 'number'
      ? `OPEN ${headerStats.openScenarioCount}`
      : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function renderCampaignDashboardHeaderStats(
  campaign: Campaign,
  headerStats?: CampaignDashboardHeaderStats,
  options: { outOfBand?: boolean } = {},
): HtmlEscapedString {
  return html`<p
    class="squire-campaign-dashboard__stats"
    id="squire-campaign-dashboard-stats"
    ${options.outOfBand ? html`hx-swap-oob="true"` : html``}
  >
    ${campaignDashboardHeaderStatsLine(campaign, headerStats)}
  </p>` as HtmlEscapedString;
}

export function renderCampaignDashboardThreadsSwap(input: {
  campaign: Campaign;
  headerStats: CampaignDashboardHeaderStats;
  threadsFragment: HtmlEscapedString;
}): HtmlEscapedString {
  return html`${renderCampaignDashboardHeaderStats(input.campaign, input.headerStats, {
    outOfBand: true,
  })}${input.threadsFragment}` as HtmlEscapedString;
}

/**
 * A quiet modules disclosure. Toggling changes which scenario set the dashboard
 * shows; removal is non-destructive (a removed module's played/skipped keys
 * persist and return if it is re-added). Any active member may edit — modules
 * are shared state. Only rendered for games that have optional modules.
 */
function renderCampaignModulesForm(
  campaign: Campaign,
  data: CampaignModulesForm,
): HtmlEscapedString {
  const checked = new Set(data.current);
  return html`<details class="squire-campaign-modules" ${data.errorMessage ? 'open' : ''}>
    <summary class="squire-campaign-modules__toggle">Modules</summary>
    ${data.errorMessage
      ? html`<div class="squire-banner squire-banner--error" role="alert">
          <span class="squire-banner__label">COULD NOT SAVE</span>
          <p class="squire-banner__body">${data.errorMessage}</p>
        </div>`
      : html``}
    <form
      method="post"
      action="/campaigns/${campaign.id}/modules"
      class="squire-campaign-modules__form"
      aria-label="Edit campaign modules"
    >
      <input type="hidden" name="_csrf" value="${data.csrfToken}" />
      <input type="hidden" name="expectedVersion" value="${data.version}" />
      <label class="squire-campaign-modules__option">
        <input type="checkbox" checked disabled />
        ${moduleLabel(data.baseModule)}
        <span class="squire-campaign-modules__required">required</span>
      </label>
      ${data.optionalModules.map(
        (module) =>
          html`<label class="squire-campaign-modules__option">
            <input
              type="checkbox"
              name="module"
              value="${module}"
              ${checked.has(module) ? 'checked' : ''}
            />
            ${moduleLabel(module)}
          </label>`,
      )}
      <button type="submit" class="squire-campaign-modules__submit">SAVE MODULES</button>
    </form>
  </details>` as HtmlEscapedString;
}

/**
 * A quiet rename disclosure under the campaign title. Any active member may
 * rename (campaign name is shared state, like the scenario toggles), so the
 * affordance is not owner-gated. The disclosure opens automatically when a
 * prior attempt failed so the error and form are visible.
 */
function renderCampaignRenameForm(campaign: Campaign, data: CampaignRenameForm): HtmlEscapedString {
  return html`<details class="squire-campaign-rename" ${data.errorMessage ? 'open' : ''}>
    <summary class="squire-campaign-rename__toggle">Rename</summary>
    ${data.errorMessage
      ? html`<div class="squire-banner squire-banner--error" role="alert">
          <span class="squire-banner__label">COULD NOT SAVE</span>
          <p class="squire-banner__body">${data.errorMessage}</p>
        </div>`
      : html``}
    <form
      method="post"
      action="/campaigns/${campaign.id}/rename"
      class="squire-campaign-rename__form"
      aria-label="Rename campaign"
    >
      <input type="hidden" name="_csrf" value="${data.csrfToken}" />
      <input type="hidden" name="expectedVersion" value="${data.version}" />
      <label class="squire-campaign-rename__field">
        <span class="squire-campaign-rename__field-label">CAMPAIGN NAME</span>
        <input
          name="name"
          type="text"
          required
          maxlength="200"
          autocomplete="off"
          value="${campaign.name}"
        />
      </label>
      <button type="submit" class="squire-campaign-rename__submit">SAVE</button>
    </form>
  </details>` as HtmlEscapedString;
}

/** `/campaigns/:id` — dashboard: header, threads (SQR-276), roster. */
export function renderCampaignDashboardContent(
  detail: CampaignDetail,
  threadsFragment?: HtmlEscapedString,
  journalFragment?: HtmlEscapedString,
  characters?: DashboardCharacterRow[],
  characterCreate?: CharacterCreateForm,
  inviteForm?: InviteMemberForm,
  renameForm?: CampaignRenameForm,
  modulesForm?: CampaignModulesForm,
  headerStats?: CampaignDashboardHeaderStats,
): HtmlEscapedString {
  const { campaign } = detail;
  const activeMembers = detail.members.filter((member) => member.status === 'active');
  // Pending invites are real state — shown distinctly, never as fake rows.
  const pendingInvites = detail.members.filter((member) => member.status === 'invited');
  return html`<section class="squire-campaign-dashboard" data-campaign-id="${campaign.id}">
    <header class="squire-campaign-dashboard__header">
      <h1 class="squire-campaign-dashboard__name">${campaign.name}</h1>
      ${renderCampaignDashboardHeaderStats(campaign, headerStats)}
      ${renameForm ? renderCampaignRenameForm(campaign, renameForm) : html``}
      ${modulesForm ? renderCampaignModulesForm(campaign, modulesForm) : html``}
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
        ${pendingInvites.map(
          (member) =>
            html`<li
              class="squire-campaign-dashboard__member squire-campaign-dashboard__member--invited"
            >
              ${member.email}
              <span class="squire-campaign-dashboard__member-role">INVITED</span>
            </li>`,
        )}
      </ul>
      ${inviteForm ? renderInviteMemberForm(campaign.id, inviteForm) : html``}
    </section>
    <section class="squire-campaign-dashboard__characters" aria-label="Characters">
      <h2 class="squire-campaign-dashboard__section-title">Characters</h2>
      ${characters && characters.length > 0
        ? html`<ul class="squire-campaign-dashboard__members">
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
          </ul>`
        : html`<p class="squire-campaign-dashboard__empty">
            No characters yet — add your first below.
          </p>`}
      ${characterCreate ? renderCharacterCreateForm(campaign.id, characterCreate) : html``}
    </section>
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
