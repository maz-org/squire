/**
 * User profile (SQR-40) — identity facts and campaign memberships under
 * the ledger shell. Deliberately minimal: identity is read-only (Google
 * re-asserts name and email on every login, so an editable display name
 * would silently revert), and there are no speculative settings.
 */
import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

import { campaignGameDefinitionFor, normalizeCampaignGameId } from '../game.ts';

export interface ProfileMembershipRow {
  campaignId: string;
  campaignName: string;
  game: string;
  role: string;
}

export interface ProfilePageData {
  name: string | null;
  email: string;
  memberships: ProfileMembershipRow[];
}

function gameLabel(game: string): string {
  const campaignGame = normalizeCampaignGameId(game);
  return campaignGame ? campaignGameDefinitionFor(campaignGame).sourcePrefix.toUpperCase() : game;
}

export function renderProfileContent(data: ProfilePageData): HtmlEscapedString {
  return html`<section class="squire-profile">
    <h1 class="squire-profile__title">Profile</h1>
    <section class="squire-profile__identity" aria-label="Identity">
      <h2 class="squire-profile__section-title">Identity</h2>
      <dl class="squire-profile__facts">
        <dt>NAME</dt>
        <dd>${data.name ?? '—'}</dd>
        <dt>EMAIL</dt>
        <dd>${data.email}</dd>
      </dl>
      <p class="squire-profile__note">Both come from your Google account and update at sign-in.</p>
    </section>
    <section class="squire-profile__memberships" aria-label="Campaign memberships">
      <h2 class="squire-profile__section-title">Campaigns</h2>
      ${data.memberships.length === 0
        ? html`<p class="squire-profile__empty">
            No campaigns yet — <a href="/campaigns">set one up</a> or tell Squire about your table
            in chat.
          </p>`
        : html`<ul class="squire-profile__list">
            ${data.memberships.map(
              (membership) =>
                html`<li class="squire-profile__row">
                  <a class="squire-profile__link" href="/campaigns/${membership.campaignId}"
                    >${membership.campaignName}</a
                  >
                  <span class="squire-profile__meta"
                    >${gameLabel(membership.game)} · ${membership.role.toUpperCase()}</span
                  >
                </li>`,
            )}
          </ul>`}
    </section>
    <section class="squire-profile__settings" aria-label="Settings">
      <h2 class="squire-profile__section-title">Settings</h2>
      <p class="squire-profile__empty">
        Nothing to configure yet — the active game lives in the chat header, and campaign state
        lives on each campaign page.
      </p>
    </section>
  </section>` as HtmlEscapedString;
}
