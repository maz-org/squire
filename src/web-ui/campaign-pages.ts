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
import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

import type { CampaignDetail, PendingInvite } from '../campaign/campaign-service.ts';
import type { Campaign, CharacterStatus } from '../db/repositories/types.ts';
import { allOptionalModuleOptions, gameDefinitionFor, isGameId, moduleLabel } from '../game.ts';
import { renderDashboardProgressEmpty } from './campaign-dashboard.ts';

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
  status: CharacterStatus;
  version: number;
  placeholder: boolean;
  own: boolean;
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

export interface CharacterActionError {
  characterId: string;
  message: string;
  action: 'level' | 'retire' | 'remove';
  levelValue?: string;
}

/** The dashboard Characters section: existing sheet links + the create form. */
function renderCharacterCreateForm(
  campaignId: string,
  data: CharacterCreateForm,
): HtmlEscapedString {
  return html`<details
    class="squire-party-section__add squire-character-create-reveal"
    ${data.errorMessage ? raw('open') : raw('')}
  >
    <summary class="squire-party-section__add-summary">Add character</summary>
    <div class="squire-party-section__add-body">
      ${data.errorMessage
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
      </form>
    </div>
  </details>` as HtmlEscapedString;
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

function compactCharacterClass(character: DashboardCharacterRow): string {
  return `${character.className} ${character.level}`;
}

function renderCharacterActionError(
  character: DashboardCharacterRow,
  actionError?: CharacterActionError,
): HtmlEscapedString {
  if (!actionError || actionError.characterId !== character.id) return html`` as HtmlEscapedString;
  return html`<div class="squire-party-row__error" role="alert">
    ${actionError.message}
  </div>` as HtmlEscapedString;
}

function renderCharacterLevelAction(
  campaignId: string,
  csrfToken: string,
  character: DashboardCharacterRow,
  actionError?: CharacterActionError,
): HtmlEscapedString {
  const open = actionError?.characterId === character.id && actionError.action === 'level';
  const value =
    open && actionError.levelValue !== undefined ? actionError.levelValue : character.level;
  return html`<details
    class="squire-party-row__action squire-party-row__action--level"
    ${open ? raw('open') : raw('')}
  >
    <summary aria-label="Level ${character.name}">Level</summary>
    <form method="post" action="/campaigns/${campaignId}/characters/${character.id}/level">
      <input type="hidden" name="_csrf" value="${csrfToken}" />
      <input type="hidden" name="expectedVersion" value="${character.version}" />
      ${open ? renderCharacterActionError(character, actionError) : html``}
      <label>
        <span>Level</span>
        <input name="level" type="number" min="1" max="20" value="${value}" />
      </label>
      <button type="submit">Save</button>
    </form>
  </details>` as HtmlEscapedString;
}

function renderCharacterConfirmAction(input: {
  campaignId: string;
  csrfToken: string;
  character: DashboardCharacterRow;
  action: 'retire' | 'remove';
  label: string;
  confirmValue: string;
  actionError?: CharacterActionError;
}): HtmlEscapedString {
  const open =
    input.actionError?.characterId === input.character.id &&
    input.actionError.action === input.action;
  return html`<details
    class="squire-party-row__action squire-party-row__action--${input.action}"
    ${open ? raw('open') : raw('')}
  >
    <summary aria-label="${input.label} ${input.character.name}">${input.label}</summary>
    <div class="squire-party-row__confirm">
      <p>${input.label} ${input.character.name}?</p>
      ${open ? renderCharacterActionError(input.character, input.actionError) : html``}
      <form
        method="post"
        action="/campaigns/${input.campaignId}/characters/${input.character.id}/${input.action}"
      >
        <input type="hidden" name="_csrf" value="${input.csrfToken}" />
        <input type="hidden" name="confirm" value="${input.confirmValue}" />
        <button type="submit">Confirm ${input.label.toLowerCase()}</button>
        <a class="squire-party-row__cancel" href="/campaigns/${input.campaignId}/party"> Cancel </a>
      </form>
    </div>
  </details>` as HtmlEscapedString;
}

function renderPartyCharacterRow(input: {
  campaignId: string;
  csrfToken: string;
  character: DashboardCharacterRow;
  actionError?: CharacterActionError;
}): HtmlEscapedString {
  const { character } = input;
  const inactive = character.status !== 'active';
  return html`<li
    class="squire-party-row ${inactive ? 'squire-party-row--retired' : 'squire-party-row--active'}"
  >
    <div class="squire-party-row__identity">
      <span class="squire-party-row__name">${character.name}</span>
      ${character.placeholder
        ? html`<span class="squire-party-row__note">Unclaimed</span>`
        : html``}
    </div>
    <span class="squire-party-row__class">${compactCharacterClass(character)}</span>
    <div class="squire-party-row__actions">
      <a class="squire-party-row__link" href="/characters/${character.id}">Open sheet</a>
      ${character.status === 'active'
        ? html`${renderCharacterLevelAction(
            input.campaignId,
            input.csrfToken,
            character,
            input.actionError,
          )}
          ${renderCharacterConfirmAction({
            campaignId: input.campaignId,
            csrfToken: input.csrfToken,
            character,
            action: 'retire',
            label: 'Retire',
            confirmValue: 'retire',
            actionError: input.actionError,
          })}`
        : html``}
      ${renderCharacterConfirmAction({
        campaignId: input.campaignId,
        csrfToken: input.csrfToken,
        character,
        action: 'remove',
        label: 'Remove',
        confirmValue: 'remove',
        actionError: input.actionError,
      })}
    </div>
  </li>` as HtmlEscapedString;
}

function renderPartyCharacterSection(input: {
  campaignId: string;
  csrfToken: string;
  title: string;
  characters: DashboardCharacterRow[];
  empty: string;
  actionError?: CharacterActionError;
}): HtmlEscapedString {
  return html`<section class="squire-party-roster__group" aria-label="${input.title}">
    <h3 class="squire-party-roster__group-title">${input.title}</h3>
    ${input.characters.length === 0
      ? html`<p class="squire-party-roster__empty">${input.empty}</p>`
      : html`<ul class="squire-party-roster__rows">
          ${input.characters.map((character) =>
            renderPartyCharacterRow({
              campaignId: input.campaignId,
              csrfToken: input.csrfToken,
              character,
              actionError: input.actionError,
            }),
          )}
        </ul>`}
  </section>` as HtmlEscapedString;
}

function renderPartyRoster(input: {
  campaignId: string;
  csrfToken: string;
  characters?: DashboardCharacterRow[];
  actionError?: CharacterActionError;
}): HtmlEscapedString {
  const characters = input.characters ?? [];
  const active = characters.filter((character) => character.status === 'active');
  const retired = characters.filter((character) => character.status === 'retired');
  return html`<div class="squire-party-roster">
    ${renderPartyCharacterSection({
      campaignId: input.campaignId,
      csrfToken: input.csrfToken,
      title: 'Active characters',
      characters: active,
      empty: 'No active characters yet.',
      actionError: input.actionError,
    })}
    ${renderPartyCharacterSection({
      campaignId: input.campaignId,
      csrfToken: input.csrfToken,
      title: 'Retired characters',
      characters: retired,
      empty: 'No retired characters yet.',
      actionError: input.actionError,
    })}
  </div>` as HtmlEscapedString;
}

function renderPendingInvites(pendingInvites: CampaignDetail['members']): HtmlEscapedString {
  if (pendingInvites.length === 0) return html`` as HtmlEscapedString;
  return html`<section
    class="squire-campaign-dashboard__pending-invites"
    aria-label="Pending invites"
  >
    <h3 class="squire-campaign-dashboard__subsection-title">Pending invites</h3>
    <ul class="squire-campaign-dashboard__invite-list">
      ${pendingInvites.map(
        (member) =>
          html`<li class="squire-campaign-dashboard__invite-row">
            <span>${member.email}</span>
            <span class="squire-campaign-dashboard__invite-status">Invited</span>
          </li>`,
      )}
    </ul>
  </section>` as HtmlEscapedString;
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

export type CampaignDashboardHeaderStats = Record<string, never>;

export type CampaignDashboardView = 'progress' | 'party' | 'players' | 'settings';

function gameSystemLabel(game: string): string {
  if (!isGameId(game)) return game;
  return gameDefinitionFor(game).label.replace(' (', ' ').replace(')', '');
}

function campaignDashboardHeaderStatsLine(
  campaign: Campaign,
  _headerStats?: CampaignDashboardHeaderStats,
): string {
  return [gameSystemLabel(campaign.game), `Prosperity ${campaign.prosperity}`].join(' · ');
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

function campaignWorkspacePath(campaignId: string, view: CampaignDashboardView): string {
  if (view === 'progress') return `/campaigns/${campaignId}`;
  return `/campaigns/${campaignId}/${view}`;
}

function renderCampaignWorkspaceTabIcon(view: CampaignDashboardView): HtmlEscapedString {
  if (view === 'progress') {
    return html`<svg
      class="squire-campaign-workspace__tab-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 18V6l4 2 6-3 4 2v12l-4-2-6 3-4-2Z"></path>
      <path d="M9 8v12"></path>
      <path d="M15 5v12"></path>
    </svg>` as HtmlEscapedString;
  }
  if (view === 'party') {
    return html`<svg
      class="squire-campaign-workspace__tab-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"></path>
      <path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"></path>
      <path d="M4 19a4 4 0 0 1 8 0"></path>
      <path d="M12 19a4 4 0 0 1 8 0"></path>
    </svg>` as HtmlEscapedString;
  }
  if (view === 'players') {
    return html`<svg
      class="squire-campaign-workspace__tab-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"></path>
      <path d="M5 20a7 7 0 0 1 14 0"></path>
      <path d="M19 8h3"></path>
      <path d="M20.5 6.5v3"></path>
    </svg>` as HtmlEscapedString;
  }
  return html`<svg
    class="squire-campaign-workspace__tab-icon"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"></path>
    <path d="M19 12h2"></path>
    <path d="M3 12h2"></path>
    <path d="M12 3v2"></path>
    <path d="M12 19v2"></path>
    <path d="m17 7 1.5-1.5"></path>
    <path d="m5.5 18.5 1.5-1.5"></path>
    <path d="m7 7-1.5-1.5"></path>
    <path d="m18.5 18.5-1.5-1.5"></path>
  </svg>` as HtmlEscapedString;
}

function renderCampaignWorkspaceNav(
  campaignId: string,
  activeView: CampaignDashboardView,
): HtmlEscapedString {
  const tabs: { view: CampaignDashboardView; label: string }[] = [
    { view: 'progress', label: 'Progress' },
    { view: 'party', label: 'Party' },
    { view: 'players', label: 'Players' },
    { view: 'settings', label: 'Settings' },
  ];
  return html`<nav class="squire-campaign-workspace__tabs" aria-label="Campaign workspace sections">
    ${tabs.map(
      (tab) =>
        html`<a
          class="squire-campaign-workspace__tab ${activeView === tab.view
            ? 'squire-campaign-workspace__tab--active'
            : ''}"
          href="${campaignWorkspacePath(campaignId, tab.view)}"
          ${activeView === tab.view ? html`aria-current="page"` : html``}
        >
          ${renderCampaignWorkspaceTabIcon(tab.view)}
          <span class="squire-campaign-workspace__tab-label">${tab.label}</span>
        </a>`,
    )}
  </nav>` as HtmlEscapedString;
}

function renderCampaignWorkspaceHeader(
  campaign: Campaign,
  headerStats?: CampaignDashboardHeaderStats,
): HtmlEscapedString {
  return html`<header class="squire-campaign-workspace__header">
    <nav class="squire-campaign-workspace__breadcrumbs" aria-label="Breadcrumb">
      <ol class="squire-campaign-workspace__breadcrumb-list">
        <li class="squire-campaign-workspace__breadcrumb-item">
          <a class="squire-campaign-workspace__breadcrumb-link" href="/campaigns">Campaigns</a>
        </li>
        <li class="squire-campaign-workspace__breadcrumb-item" aria-current="page">
          ${campaign.name}
        </li>
      </ol>
    </nav>
    <div class="squire-campaign-workspace__header-main">
      <div class="squire-campaign-workspace__identity">
        <h1 class="squire-campaign-dashboard__name">${campaign.name}</h1>
        ${renderCampaignDashboardHeaderStats(campaign, headerStats)}
      </div>
    </div>
  </header>` as HtmlEscapedString;
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
  characterActionError?: CharacterActionError,
  inviteForm?: InviteMemberForm,
  renameForm?: CampaignRenameForm,
  modulesForm?: CampaignModulesForm,
  headerStats?: CampaignDashboardHeaderStats,
  activeView: CampaignDashboardView = 'progress',
): HtmlEscapedString {
  const { campaign } = detail;
  // Pending invites are real state — shown distinctly, never as fake rows.
  const pendingInvites = detail.members.filter((member) => member.status === 'invited');
  return html`<section class="squire-campaign-workspace" data-campaign-id="${campaign.id}">
    ${renderCampaignWorkspaceHeader(campaign, headerStats)}
    ${renderCampaignWorkspaceNav(campaign.id, activeView)}
    <div class="squire-campaign-dashboard squire-campaign-dashboard--${activeView}">
      ${activeView === 'progress'
        ? html`${threadsFragment ?? renderDashboardProgressEmpty()} ${journalFragment ?? html``}`
        : html``}
      ${activeView === 'party'
        ? html`<section class="squire-campaign-dashboard__party" aria-label="Party">
            <header class="squire-party-section__header">
              <div>
                <h2 class="squire-campaign-dashboard__section-title">Party</h2>
                <p class="squire-party-section__lede">
                  Manage active and retired player characters for this campaign.
                </p>
              </div>
              <div class="squire-party-section__action">
                ${characterCreate
                  ? renderCharacterCreateForm(campaign.id, characterCreate)
                  : html``}
              </div>
            </header>
            ${renderPartyRoster({
              campaignId: campaign.id,
              csrfToken: characterCreate?.csrfToken ?? '',
              characters,
              actionError: characterActionError,
            })}
          </section>`
        : html``}
      ${activeView === 'players'
        ? html`<section class="squire-campaign-dashboard__players" aria-label="Players">
            <h2 class="squire-campaign-dashboard__section-title">Players</h2>
            <ul class="squire-campaign-dashboard__members">
              ${detail.members.map(
                (member) =>
                  html`<li class="squire-campaign-dashboard__member">
                    <span>${member.email}</span>
                    <span class="squire-campaign-dashboard__member-role"
                      >${member.status === 'active' ? member.role : member.status}</span
                    >
                  </li>`,
              )}
            </ul>
            ${renderPendingInvites(pendingInvites)}
            ${inviteForm ? renderInviteMemberForm(campaign.id, inviteForm) : html``}
          </section>`
        : html``}
      ${activeView === 'settings'
        ? html`<section class="squire-campaign-dashboard__settings" aria-label="Settings">
            <h2 class="squire-campaign-dashboard__section-title">Settings</h2>
            ${renameForm ? renderCampaignRenameForm(campaign, renameForm) : html``}
            ${modulesForm ? renderCampaignModulesForm(campaign, modulesForm) : html``}
          </section>`
        : html``}
    </div>
  </section>` as HtmlEscapedString;
}
