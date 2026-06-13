/**
 * Accordion character sheet (SQR-277, design decision G3) — the
 * `/characters/:id` surface, optimized for the everyday single-field
 * correction. Native `<details>` sections with deep-linkable anchors
 * (`#gold`) so agent work-log rows and validation warnings can link "fix it
 * here"; conversational onboarding owns the long create path.
 *
 * Non-owners see member-visible fields only — the private tier is absent
 * from their projection at the type level, so this renderer cannot leak
 * what it never receives. Unclaimed placeholders show the claim banner.
 */
import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

import type { CharacterDetail } from '../campaign/character-service.ts';
import type { Character, CharacterCard, CharacterItem } from '../db/repositories/types.ts';
import type { CardOption, ItemOption } from '../campaign/character-sheet-data.ts';

export interface CharacterSheetData {
  detail: CharacterDetail;
  campaign: { id: string; name: string; game: string };
  csrfToken: string;
  /** Placeholder claimable by the signed-in member (email matches). */
  canClaim: boolean;
  itemOptions: ItemOption[];
  cardOptions: CardOption[];
  itemNames: Map<string, ItemOption>;
  cardNames: Map<string, CardOption>;
  /** Save-failure banner; the named section renders open with it. */
  errorMessage?: string;
  /** Soft rules-legality warning (SQR-285) surfaced inline. */
  warningMessage?: string;
  openSection?: string;
}

function csrfField(token: string): HtmlEscapedString {
  return html`<input type="hidden" name="_csrf" value="${token}" />` as HtmlEscapedString;
}

function versionField(version: number): HtmlEscapedString {
  return html`<input
    type="hidden"
    name="expectedVersion"
    value="${version}"
  />` as HtmlEscapedString;
}

function section(input: {
  id: string;
  label: string;
  summaryValue: string;
  open: boolean;
  body: HtmlEscapedString;
}): HtmlEscapedString {
  return html`<details
    class="squire-sheet__section"
    id="${input.id}"
    data-sheet-section="${input.id}"
    ${input.open ? raw('open') : raw('')}
  >
    <summary class="squire-sheet__summary">
      <span class="squire-sheet__summary-label">${input.label}</span>
      <span class="squire-sheet__summary-value">${input.summaryValue}</span>
    </summary>
    <div class="squire-sheet__body">${input.body}</div>
  </details>` as HtmlEscapedString;
}

function fieldForm(input: {
  action: string;
  csrfToken: string;
  version: number;
  sectionId: string;
  fields: HtmlEscapedString;
  submitLabel?: string;
}): HtmlEscapedString {
  return html`<form class="squire-sheet__form" method="post" action="${input.action}">
    ${csrfField(input.csrfToken)} ${versionField(input.version)}
    <input type="hidden" name="section" value="${input.sectionId}" />
    ${input.fields}
    <button type="submit" class="squire-button squire-button--primary squire-button--small">
      ${input.submitLabel ?? 'Save'}
    </button>
  </form>` as HtmlEscapedString;
}

function itemRow(
  item: CharacterItem,
  names: Map<string, ItemOption>,
  own: boolean,
  characterId: string,
  csrfToken: string,
): HtmlEscapedString {
  const known = names.get(item.sourceId);
  const label = known ? `${known.name} · ${known.number}` : item.sourceId;
  return html`<li class="squire-sheet__row">
    <span class="squire-sheet__row-label">${label}</span>
    ${own
      ? html`<form method="post" action="/characters/${characterId}/items/${item.id}/remove">
          ${csrfField(csrfToken)}
          <button type="submit" class="squire-sheet__row-action">REMOVE</button>
        </form>`
      : html``}
  </li>` as HtmlEscapedString;
}

function cardRow(
  card: CharacterCard,
  names: Map<string, CardOption>,
  own: boolean,
  characterId: string,
  csrfToken: string,
): HtmlEscapedString {
  const known = names.get(card.sourceId);
  const label = known ? `${known.name}${known.level ? ` · L${known.level}` : ''}` : card.sourceId;
  const nextRole = card.role === 'active' ? 'owned' : 'active';
  return html`<li class="squire-sheet__row">
    <span class="squire-sheet__row-label">
      ${label}
      <span class="squire-sheet__badge ${card.role === 'active' ? 'is-active' : ''}"
        >${card.role.toUpperCase()}</span
      >
    </span>
    ${own
      ? html`<span class="squire-sheet__row-actions">
          <form method="post" action="/characters/${characterId}/cards/${card.id}/role">
            ${csrfField(csrfToken)}
            <input type="hidden" name="role" value="${nextRole}" />
            <button type="submit" class="squire-sheet__row-action">
              ${nextRole === 'active' ? 'MAKE ACTIVE' : 'BENCH'}
            </button>
          </form>
          <form method="post" action="/characters/${characterId}/cards/${card.id}/remove">
            ${csrfField(csrfToken)}
            <button type="submit" class="squire-sheet__row-action">REMOVE</button>
          </form>
        </span>`
      : html``}
  </li>` as HtmlEscapedString;
}

function privateValue(value: string | null): string {
  return value && value.trim().length > 0 ? value : '';
}

export function renderCharacterSheetContent(data: CharacterSheetData): HtmlEscapedString {
  const { detail, csrfToken } = data;
  const character = detail.character;
  const own = detail.own;
  const id = character.id;
  const open = (sectionId: string) => data.openSection === sectionId;
  const updateAction = `/characters/${id}/update`;
  const privateTier = own ? (character as Character) : null;

  return html`<section class="squire-sheet" data-character-id="${id}">
    <header class="squire-sheet__header">
      <p class="squire-sheet__breadcrumb">
        <a href="/campaigns/${data.campaign.id}">${data.campaign.name.toUpperCase()}</a>
      </p>
      <h1 class="squire-sheet__name">${character.name}</h1>
      <p class="squire-sheet__stats">
        ${character.className.toUpperCase()} · L${character.level} · ${character.gold} GOLD
        ${character.status === 'retired' ? ' · RETIRED' : ''}
      </p>
    </header>

    ${data.errorMessage
      ? html`<div class="squire-banner squire-banner--error" role="alert">
          <span class="squire-banner__label">COULD NOT SAVE</span>
          <p class="squire-banner__body">${data.errorMessage}</p>
        </div>`
      : html``}
    ${data.warningMessage
      ? html`<div class="squire-banner squire-banner--amber" role="status">
          <span class="squire-banner__label">RULES CHECK</span>
          <p class="squire-banner__body">${data.warningMessage}</p>
        </div>`
      : html``}
    ${character.placeholderForEmail && data.canClaim
      ? html`<div class="squire-banner squire-banner--claim" role="status">
          <span class="squire-banner__label">THIS ONE'S YOURS</span>
          <p class="squire-banner__body">
            ${character.name} was set up for ${character.placeholderForEmail}.
          </p>
          <form method="post" action="/characters/${id}/claim">
            ${csrfField(csrfToken)}
            <button type="submit" class="squire-button squire-button--primary squire-button--small">
              Claim character
            </button>
          </form>
        </div>`
      : html``}

    <div class="squire-sheet__sections">
      ${section({
        id: 'identity',
        label: 'IDENTITY',
        summaryValue: `${character.name} · ${character.className.toUpperCase()}`,
        open: open('identity'),
        body: own
          ? fieldForm({
              action: updateAction,
              csrfToken,
              version: character.version,
              sectionId: 'identity',
              fields: html`<label class="squire-sheet__field">
                <span>Name</span>
                <input type="text" name="name" value="${character.name}" required maxlength="100" />
              </label>` as HtmlEscapedString,
            })
          : (html`<p class="squire-sheet__readonly">
              ${character.name} · ${character.className}
            </p>` as HtmlEscapedString),
      })}
      ${section({
        id: 'level',
        label: 'LEVEL / XP',
        summaryValue: `L${character.level} · ${character.xp} XP`,
        open: open('level'),
        body: own
          ? fieldForm({
              action: updateAction,
              csrfToken,
              version: character.version,
              sectionId: 'level',
              fields: html`<label class="squire-sheet__field">
                  <span>Level</span>
                  <input
                    type="number"
                    name="level"
                    value="${character.level}"
                    min="1"
                    max="20"
                    required
                  />
                </label>
                <label class="squire-sheet__field">
                  <span>XP</span>
                  <input type="number" name="xp" value="${character.xp}" min="0" required />
                </label>` as HtmlEscapedString,
            })
          : (html`<p class="squire-sheet__readonly">
              L${character.level} · ${character.xp} XP
            </p>` as HtmlEscapedString),
      })}
      ${section({
        id: 'gold',
        label: 'GOLD',
        summaryValue: `${character.gold}`,
        open: open('gold'),
        body: own
          ? fieldForm({
              action: updateAction,
              csrfToken,
              version: character.version,
              sectionId: 'gold',
              fields: html`<label class="squire-sheet__field">
                <span>Gold</span>
                <input type="number" name="gold" value="${character.gold}" min="0" required />
              </label>` as HtmlEscapedString,
            })
          : (html`<p class="squire-sheet__readonly">
              ${character.gold} gold
            </p>` as HtmlEscapedString),
      })}
      ${section({
        id: 'perks',
        label: 'PERKS',
        summaryValue:
          character.perks.length > 0 ? `${character.perks.length} MARKED` : 'NOT RECORDED',
        open: open('perks'),
        body: own
          ? fieldForm({
              action: updateAction,
              csrfToken,
              version: character.version,
              sectionId: 'perks',
              fields: html`<label class="squire-sheet__field">
                <span>Marked perk numbers (comma-separated)</span>
                <input
                  type="text"
                  name="perks"
                  value="${character.perks.join(', ')}"
                  inputmode="numeric"
                  placeholder="e.g. 1, 2, 5"
                />
              </label>` as HtmlEscapedString,
            })
          : (html`<p class="squire-sheet__readonly">
              ${character.perks.length > 0
                ? `Perks marked: ${character.perks.join(', ')}`
                : 'Not recorded'}
            </p>` as HtmlEscapedString),
      })}
      ${section({
        id: 'items',
        label: 'ITEMS',
        summaryValue: detail.items.length > 0 ? `${detail.items.length} CARRIED` : 'NOT RECORDED',
        open: open('items'),
        body: html`${detail.items.length > 0
          ? html`<ul class="squire-sheet__rows">
              ${detail.items.map((item) => itemRow(item, data.itemNames, own, id, csrfToken))}
            </ul>`
          : html`<p class="squire-sheet__empty">Not recorded.</p>`}
        ${own
          ? html`<form
              class="squire-sheet__form"
              method="post"
              action="/characters/${id}/items/add"
            >
              ${csrfField(csrfToken)}
              <label class="squire-sheet__field">
                <span>Add item by number</span>
                <input
                  type="text"
                  name="number"
                  list="squire-sheet-item-options"
                  placeholder="e.g. 042"
                  required
                />
              </label>
              <datalist id="squire-sheet-item-options">
                ${data.itemOptions.map(
                  (option) =>
                    html`<option value="${option.number}">
                      ${option.name} · ${option.number}
                    </option>`,
                )}
              </datalist>
              <button
                type="submit"
                class="squire-button squire-button--primary squire-button--small"
              >
                Add item
              </button>
            </form>`
          : html``}` as HtmlEscapedString,
      })}
      ${section({
        id: 'cards',
        label: 'ABILITY CARDS',
        summaryValue: detail.cards.length > 0 ? `${detail.cards.length} IN POOL` : 'NOT RECORDED',
        open: open('cards'),
        body: html`${detail.cards.length > 0
          ? html`<ul class="squire-sheet__rows">
              ${detail.cards.map((card) => cardRow(card, data.cardNames, own, id, csrfToken))}
            </ul>`
          : html`<p class="squire-sheet__empty">Not recorded.</p>`}
        ${own
          ? html`<form
              class="squire-sheet__form"
              method="post"
              action="/characters/${id}/cards/add"
            >
              ${csrfField(csrfToken)}
              <label class="squire-sheet__field">
                <span>Add card by name</span>
                <input
                  type="text"
                  name="name"
                  list="squire-sheet-card-options"
                  placeholder="Start typing a ${character.className} card"
                  required
                />
              </label>
              <datalist id="squire-sheet-card-options">
                ${data.cardOptions.map(
                  (option) =>
                    html`<option value="${option.name}">
                      ${option.name}${option.level ? ` · L${option.level}` : ''}
                    </option>`,
                )}
              </datalist>
              <button
                type="submit"
                class="squire-button squire-button--primary squire-button--small"
              >
                Add card
              </button>
            </form>`
          : html``}` as HtmlEscapedString,
      })}
      ${privateTier
        ? html`${section({
            id: 'quest',
            label: 'PERSONAL QUEST',
            summaryValue: privateValue(privateTier.personalQuest) ? 'RECORDED' : 'NOT RECORDED',
            open: open('quest'),
            body: fieldForm({
              action: updateAction,
              csrfToken,
              version: character.version,
              sectionId: 'quest',
              fields: html`<label class="squire-sheet__field">
                <span>Personal quest (only you can see this)</span>
                <textarea name="personalQuest" maxlength="5000" rows="3">
${privateValue(privateTier.personalQuest)}</textarea
                >
              </label>` as HtmlEscapedString,
            }),
          })}
          ${section({
            id: 'goals',
            label: 'BATTLE GOALS',
            summaryValue: privateValue(privateTier.battleGoals) ? 'RECORDED' : 'NOT RECORDED',
            open: open('goals'),
            body: fieldForm({
              action: updateAction,
              csrfToken,
              version: character.version,
              sectionId: 'goals',
              fields: html`<label class="squire-sheet__field">
                <span>Battle goals (only you can see this)</span>
                <textarea name="battleGoals" maxlength="5000" rows="3">
${privateValue(privateTier.battleGoals)}</textarea
                >
              </label>` as HtmlEscapedString,
            }),
          })}
          ${section({
            id: 'notes',
            label: 'NOTES',
            summaryValue: privateValue(privateTier.privateNotes) ? 'RECORDED' : 'NOT RECORDED',
            open: open('notes'),
            body: fieldForm({
              action: updateAction,
              csrfToken,
              version: character.version,
              sectionId: 'notes',
              fields: html`<label class="squire-sheet__field">
                <span>Private notes (only you can see this)</span>
                <textarea name="privateNotes" maxlength="5000" rows="4">
${privateValue(privateTier.privateNotes)}</textarea
                >
              </label>` as HtmlEscapedString,
            }),
          })}`
        : html``}
    </div>
  </section>` as HtmlEscapedString;
}
