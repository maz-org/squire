/**
 * Structured character sheet — the `/characters/:id` surface for viewing and
 * editing real character state. Sections are deep-linkable (`#items`, `#quest`)
 * but not accordion-first; the controls use the campaign/catalog data the
 * service layer validates.
 *
 * Non-owners see member-visible fields only — the private tier is absent
 * from their projection at the type level, so this renderer cannot leak
 * what it never receives. Unclaimed placeholders show the claim banner.
 */
import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

import type { CharacterDetail } from '../campaign/character-service.ts';
import type { Character, CharacterCard, CharacterItem } from '../db/repositories/types.ts';
import type {
  CardOption,
  CharacterMatSummary,
  ItemOption,
  PersonalQuestOption,
} from '../campaign/character-sheet-data.ts';
import { characterMatArtworkFor } from './character-mat-assets.ts';

export interface CharacterSheetData {
  detail: CharacterDetail;
  campaign: { id: string; name: string; game: string };
  csrfToken: string;
  /** Placeholder claimable by the signed-in member (email matches). */
  canClaim: boolean;
  itemOptions: ItemOption[];
  cardOptions: CardOption[];
  questOptions: PersonalQuestOption[];
  itemNames: Map<string, ItemOption>;
  cardNames: Map<string, CardOption>;
  questNames: Map<string, PersonalQuestOption>;
  characterMat?: CharacterMatSummary | null;
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
  body: HtmlEscapedString;
}): HtmlEscapedString {
  return html`<section
    class="squire-sheet__section"
    id="${input.id}"
    data-sheet-section="${input.id}"
  >
    <header class="squire-sheet__summary">
      <span class="squire-sheet__summary-label">${input.label}</span>
      <span class="squire-sheet__summary-value">${input.summaryValue}</span>
    </header>
    <div class="squire-sheet__body">${input.body}</div>
  </section>` as HtmlEscapedString;
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

function selectedPerks(
  character: Character | CharacterSheetData['detail']['character'],
): Set<number> {
  return new Set(character.perks);
}

function hpForLevel(mat: CharacterMatSummary | null | undefined, level: number): number | null {
  if (!mat) return null;
  return mat.hpByLevel[String(level)] ?? null;
}

function renderHeroStat(label: string, value: string | number | null): HtmlEscapedString {
  if (value === null || value === '') return html`` as HtmlEscapedString;
  return html`<span class="squire-sheet__hero-stat">${label} ${value}</span>` as HtmlEscapedString;
}

function renderTraitList(mat: CharacterMatSummary | null | undefined): HtmlEscapedString {
  if (!mat || mat.traits.length === 0) return html`` as HtmlEscapedString;
  return html`<span class="squire-sheet__traits" aria-label="Class traits">
    ${mat.traits
      .slice(0, 3)
      .map((trait) => html`<span class="squire-sheet__trait">${trait.toUpperCase()}</span>`)}
  </span>` as HtmlEscapedString;
}

function renderHeroStats(
  mat: CharacterMatSummary | null | undefined,
  levelHp: number | null,
): HtmlEscapedString {
  if (!mat || levelHp === null) {
    return html`<span class="squire-sheet__hero-empty"
      >CLASS STATS NOT RECORDED</span
    >` as HtmlEscapedString;
  }
  return html`${renderHeroStat('HAND', mat.handSize)} ${renderHeroStat('HP', levelHp)}
  ${renderHeroStat('PERKS', mat.perks.length)} ${renderHeroStat('MASTERIES', mat.masteries.length)}
  ${renderTraitList(mat)}` as HtmlEscapedString;
}

function renderMatArtwork(input: { game: string; className: string }): HtmlEscapedString {
  const artwork = characterMatArtworkFor(input.game, input.className);
  if (!artwork) {
    return html`<div class="squire-sheet__mat squire-sheet__mat--placeholder">
      <p class="squire-sheet__mat-placeholder">Mat artwork not mirrored for this class yet.</p>
    </div>` as HtmlEscapedString;
  }
  return html`<figure class="squire-sheet__mat">
    <img class="squire-sheet__mat-art" src="${artwork.src}" alt="${artwork.alt}" loading="lazy" />
    <figcaption class="squire-sheet__mat-credit">${artwork.attribution}</figcaption>
  </figure>` as HtmlEscapedString;
}

function renderPerkControls(
  character: CharacterSheetData['detail']['character'],
  mat: CharacterMatSummary | null | undefined,
): HtmlEscapedString {
  if (!mat) {
    return html`<p class="squire-sheet__empty">
      Class perk data is not recorded for this class yet.
    </p>` as HtmlEscapedString;
  }
  const picked = selectedPerks(character);
  return html`<fieldset class="squire-sheet__checklist">
    <legend>Class perks</legend>
    ${mat.perks.map((perk, index) => {
      return html`<label class="squire-sheet__check">
        <input
          type="checkbox"
          name="perks"
          value="${index}"
          ${picked.has(index) ? raw('checked') : raw('')}
        />
        <span>
          <strong>Perk ${index + 1}</strong>
          ${perk}
        </span>
      </label>`;
    })}
  </fieldset>` as HtmlEscapedString;
}

function itemStatusLabel(option: ItemOption, owned: boolean): string {
  if (owned) return 'owned';
  return option.status;
}

function renderItemSelectOptions(
  options: ItemOption[],
  ownedIds: Set<string>,
): HtmlEscapedString[] {
  return options.map((option) => {
    const owned = ownedIds.has(option.sourceId);
    const disabled = owned || option.status !== 'available';
    return html`<option value="${option.sourceId}" ${disabled ? raw('disabled') : raw('')}>
      ${option.number} · ${option.name} · ${itemStatusLabel(option, owned)}
    </option>` as HtmlEscapedString;
  });
}

function renderCardSelectOptions(
  options: CardOption[],
  ownedIds: Set<string>,
): HtmlEscapedString[] {
  return options.map((option) => {
    const owned = ownedIds.has(option.sourceId);
    return html`<option value="${option.sourceId}" ${owned ? raw('disabled') : raw('')}>
      ${option.name}${option.level ? ` · L${option.level}` : ''}${owned ? ' · owned' : ''}
    </option>` as HtmlEscapedString;
  });
}

function questLabel(option: PersonalQuestOption): string {
  return `${option.cardId}${option.altId ? `/${option.altId}` : ''} · ${option.name}`;
}

function renderQuestSelectOptions(input: {
  options: PersonalQuestOption[];
  selected: string | null | undefined;
  characterId: string;
}): HtmlEscapedString[] {
  return input.options.map((option) => {
    const assignedElsewhere =
      option.assignedCharacterId !== null && option.assignedCharacterId !== input.characterId;
    const disabled = assignedElsewhere || option.status !== 'available';
    const suffix = assignedElsewhere
      ? ' · assigned'
      : option.status !== 'available'
        ? ` · ${option.status}`
        : '';
    return html`<option
      value="${option.sourceId}"
      ${input.selected === option.sourceId ? raw('selected') : raw('')}
      ${disabled ? raw('disabled') : raw('')}
    >
      ${questLabel(option)}${suffix}
    </option>` as HtmlEscapedString;
  });
}

function selectedQuestName(
  sourceId: string | null | undefined,
  names: Map<string, PersonalQuestOption>,
): string {
  if (!sourceId) return 'NOT SELECTED';
  return names.get(sourceId)?.name.toUpperCase() ?? 'SELECTED';
}

export function renderCharacterSheetContent(data: CharacterSheetData): HtmlEscapedString {
  const { detail, csrfToken } = data;
  const character = detail.character;
  const own = detail.own;
  const id = character.id;
  const updateAction = `/characters/${id}/update`;
  const privateTier = own ? (character as Character) : null;
  const levelHp = hpForLevel(data.characterMat, character.level);
  const ownedItemIds = new Set(detail.items.map((item) => item.sourceId));
  const ownedCardIds = new Set(detail.cards.map((card) => card.sourceId));

  return html`<section class="squire-sheet" data-character-id="${id}">
    <header class="squire-sheet__hero">
      <div class="squire-sheet__identity">
        <p class="squire-sheet__breadcrumb">
          <a href="/campaigns/${data.campaign.id}">${data.campaign.name.toUpperCase()}</a>
        </p>
        <h1 class="squire-sheet__name">${character.name}</h1>
        <p class="squire-sheet__class-line">
          <span>${character.className}</span>
          <span>Level ${character.level}</span>
          <span>${character.gold} gold</span>
          ${character.status === 'retired' ? html`<span>Retired</span>` : html``}
        </p>
        <div class="squire-sheet__hero-stats" aria-label="Class stats">
          ${renderHeroStats(data.characterMat, levelHp)}
        </div>
      </div>
      ${renderMatArtwork({ game: data.campaign.game, className: character.className })}
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
        id: 'progress',
        label: 'PROGRESS',
        summaryValue: `L${character.level} · ${character.xp} XP`,
        body: own
          ? fieldForm({
              action: updateAction,
              csrfToken,
              version: character.version,
              sectionId: 'progress',
              fields: html`<label class="squire-sheet__field">
                  <span>XP</span>
                  <input type="number" name="xp" value="${character.xp}" min="0" required />
                </label>
                <p class="squire-sheet__readonly">
                  Level is derived from XP.
                </p>` as HtmlEscapedString,
            })
          : (html`<p class="squire-sheet__readonly">
              L${character.level} · ${character.xp} XP
            </p>` as HtmlEscapedString),
      })}
      ${section({
        id: 'gold',
        label: 'GOLD',
        summaryValue: `${character.gold}`,
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
        body: own
          ? fieldForm({
              action: updateAction,
              csrfToken,
              version: character.version,
              sectionId: 'perks',
              fields: renderPerkControls(character, data.characterMat),
            })
          : (html`<p class="squire-sheet__readonly">
              ${character.perks.length > 0 ? `${character.perks.length} marked` : 'Not recorded'}
            </p>` as HtmlEscapedString),
      })}
      ${section({
        id: 'items',
        label: 'ITEMS',
        summaryValue: detail.items.length > 0 ? `${detail.items.length} CARRIED` : 'NOT RECORDED',
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
                <span>Add item from catalog</span>
                <select name="sourceId" required>
                  <option value="">Choose an available item</option>
                  ${renderItemSelectOptions(data.itemOptions, ownedItemIds)}
                </select>
              </label>
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
                <span>Add ${character.className} card</span>
                <select name="sourceId" required>
                  <option value="">Choose a class card</option>
                  ${renderCardSelectOptions(data.cardOptions, ownedCardIds)}
                </select>
              </label>
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
            summaryValue: selectedQuestName(privateTier.personalQuestSourceId, data.questNames),
            body: fieldForm({
              action: updateAction,
              csrfToken,
              version: character.version,
              sectionId: 'quest',
              fields: html`<label class="squire-sheet__field">
                <span>Personal quest</span>
                <select name="personalQuestSourceId">
                  <option value="">No personal quest selected</option>
                  ${renderQuestSelectOptions({
                    options: data.questOptions,
                    selected: privateTier.personalQuestSourceId,
                    characterId: id,
                  })}
                </select>
              </label>` as HtmlEscapedString,
            }),
          })}
          ${section({
            id: 'notes',
            label: 'NOTES',
            summaryValue: privateValue(privateTier.privateNotes) ? 'RECORDED' : 'NOT RECORDED',
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
