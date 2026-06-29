/**
 * Structured character sheet — the `/characters/:id` surface for viewing and
 * editing real character state. Panels are deep-linkable (`#items`, `#quest`)
 * but are not disclosure rows; the controls use the campaign/catalog data the
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
import { LEVEL_XP_THRESHOLDS } from '../campaign/character-level.ts';
import {
  PERK_MARK_GROUP_SIZE,
  perkMarkGroupCountForGame,
} from '../campaign/character-progression.ts';
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

function panel(input: {
  id: string;
  title: string;
  summaryValue?: string | null;
  body: HtmlEscapedString;
  className?: string;
}): HtmlEscapedString {
  const className = input.className
    ? `squire-sheet__panel ${input.className}`
    : 'squire-sheet__panel';
  return html`<section class="${className}" id="${input.id}" data-sheet-section="${input.id}">
    <header class="squire-sheet__panel-head">
      <h2 class="squire-sheet__panel-title">${input.title}</h2>
      ${input.summaryValue
        ? html`<span class="squire-sheet__panel-value">${input.summaryValue}</span>`
        : html``}
    </header>
    <div class="squire-sheet__panel-body">${input.body}</div>
  </section>` as HtmlEscapedString;
}

function fieldForm(input: {
  action: string;
  csrfToken: string;
  version: number;
  sectionId: string;
  fields: HtmlEscapedString;
  submitLabel?: string;
  autosave?: boolean;
  autosaveDelayMs?: number;
}): HtmlEscapedString {
  return html`<form
    class="squire-sheet__form"
    method="post"
    action="${input.action}"
    ${input.autosave ? raw('data-sheet-autosave="update"') : raw('')}
    ${input.autosaveDelayMs !== undefined
      ? raw(`data-sheet-autosave-delay="${input.autosaveDelayMs}"`)
      : raw('')}
  >
    ${csrfField(input.csrfToken)} ${versionField(input.version)}
    <input type="hidden" name="section" value="${input.sectionId}" />
    ${input.fields}
    ${input.autosave
      ? html`<span class="sr-only" aria-live="polite">Changes save automatically.</span>`
      : html`<button
          type="submit"
          class="squire-button squire-button--primary squire-button--small"
        >
          ${input.submitLabel ?? 'Save'}
        </button>`}
  </form>` as HtmlEscapedString;
}

function toolIcon(kind: 'trash' | 'check' | 'archive'): HtmlEscapedString {
  if (kind === 'trash') {
    return html`<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm4 2v8h2v-8h-2Zm4 0v8h2v-8h-2Z" />
    </svg>` as HtmlEscapedString;
  }
  if (kind === 'archive') {
    return html`<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M4 4h16v5H4V4Zm2 2v1h12V6H6Zm1 5h10v9H7v-9Zm3 3v2h4v-2h-4Z" />
    </svg>` as HtmlEscapedString;
  }
  return html`<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
    <path d="m9.5 16.6-4.1-4.1L4 13.9l5.5 5.5L20.4 8.5 19 7.1 9.5 16.6Z" />
  </svg>` as HtmlEscapedString;
}

function toolbarButton(label: string, icon: 'trash' | 'check' | 'archive'): HtmlEscapedString {
  return html`<button
    type="submit"
    class="squire-sheet__tool"
    aria-label="${label}"
    title="${label}"
  >
    ${toolIcon(icon)}
    <span class="sr-only">${label}</span>
  </button>` as HtmlEscapedString;
}

function itemRow(
  item: CharacterItem,
  names: Map<string, ItemOption>,
  own: boolean,
  characterId: string,
  csrfToken: string,
): HtmlEscapedString {
  const known = names.get(item.sourceId);
  const label = known?.name ?? item.sourceId;
  const number = known?.number ?? '';
  return html`<li class="squire-sheet__row" data-sheet-item-row data-source-id="${item.sourceId}">
    <span class="squire-sheet__row-label">
      ${number ? html`<span class="squire-sheet__row-number">${number}</span>` : html``}
      <span>${label}</span>
    </span>
    ${own
      ? html`<form
          method="post"
          action="/characters/${characterId}/items/${item.id}/remove"
          data-sheet-row-action="remove-row"
        >
          ${csrfField(csrfToken)} ${toolbarButton('Remove item', 'trash')}
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
  return html`<li class="squire-sheet__row" data-sheet-card-row data-source-id="${card.sourceId}">
    <span class="squire-sheet__row-label">
      <span data-sheet-card-label>${label}</span>
      <span
        class="squire-sheet__badge ${card.role === 'active' ? 'is-active' : ''}"
        data-sheet-card-role
        >${card.role.toUpperCase()}</span
      >
    </span>
    ${own
      ? html`<span class="squire-sheet__toolbar">
          <form
            method="post"
            action="/characters/${characterId}/cards/${card.id}/role"
            data-sheet-row-action="card-role"
          >
            ${csrfField(csrfToken)}
            <input type="hidden" name="role" value="${nextRole}" />
            ${toolbarButton(
              nextRole === 'active' ? 'Make active' : 'Bench card',
              nextRole === 'active' ? 'check' : 'archive',
            )}
          </form>
          <form
            method="post"
            action="/characters/${characterId}/cards/${card.id}/remove"
            data-sheet-row-action="remove-row"
          >
            ${csrfField(csrfToken)} ${toolbarButton('Remove card', 'trash')}
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

function selectedMasteries(
  character: Character | CharacterSheetData['detail']['character'],
): Set<number> {
  return new Set(character.masteries);
}

function hpForLevel(mat: CharacterMatSummary | null | undefined, level: number): number | null {
  if (!mat) return null;
  return mat.hpByLevel[String(level)] ?? null;
}

function xpBand(
  level: number,
  xp: number,
): {
  current: number;
  next: number | null;
  value: number;
  label: string;
} {
  const current =
    LEVEL_XP_THRESHOLDS[Math.max(0, Math.min(level - 1, LEVEL_XP_THRESHOLDS.length - 1))];
  const next = LEVEL_XP_THRESHOLDS[level] ?? null;
  if (next === null) {
    return {
      current,
      next,
      value: Math.max(current, xp),
      label: 'Maximum sheet level',
    };
  }
  return {
    current,
    next,
    value: Math.max(current, Math.min(xp, next)),
    label: `Next: L${level + 1} at ${next} XP`,
  };
}

function renderXpMeter(level: number, xp: number): HtmlEscapedString {
  const band = xpBand(level, xp);
  const max = band.next ?? Math.max(band.current + 1, band.value);
  return html`<div class="squire-sheet__xp">
    <meter class="squire-sheet__xp-meter" min="${band.current}" max="${max}" value="${band.value}">
      ${band.value}
    </meter>
    <span data-sheet-xp-label>${band.label}</span>
  </div>` as HtmlEscapedString;
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

function inlineNameForm(input: {
  action: string;
  csrfToken: string;
  version: number;
  name: string;
  own: boolean;
}): HtmlEscapedString {
  if (!input.own) {
    return html`<h1 class="squire-sheet__name">${input.name}</h1>` as HtmlEscapedString;
  }
  return html`<form
    class="squire-sheet__inline-form squire-sheet__inline-form--name"
    id="identity"
    data-sheet-section="identity"
    data-sheet-autosave
    method="post"
    action="${input.action}"
  >
    ${csrfField(input.csrfToken)} ${versionField(input.version)}
    <input type="hidden" name="section" value="identity" />
    <label class="sr-only" for="character-name-inline">Character name</label>
    <input
      id="character-name-inline"
      class="squire-sheet__name-input"
      type="text"
      name="name"
      data-sheet-field="name"
      value="${input.name}"
      required
      maxlength="100"
      aria-label="Character name"
    />
    <button type="submit" class="sr-only">Save name</button>
  </form>` as HtmlEscapedString;
}

function inlineNumberForm(input: {
  action: string;
  csrfToken: string;
  version: number;
  sectionId: 'progress' | 'gold';
  name: 'xp' | 'gold';
  label: string;
  value: number;
  own: boolean;
  max?: number;
}): HtmlEscapedString {
  if (!input.own) {
    return html`<span class="squire-sheet__inline-readonly"
      >${input.value} ${input.label}</span
    >` as HtmlEscapedString;
  }
  return html`<form
    class="squire-sheet__inline-form squire-sheet__inline-form--stat"
    id="${input.sectionId}"
    data-sheet-section="${input.sectionId}"
    data-sheet-autosave
    method="post"
    action="${input.action}"
  >
    ${csrfField(input.csrfToken)} ${versionField(input.version)}
    <input type="hidden" name="section" value="${input.sectionId}" />
    <label>
      <span class="sr-only">${input.label}</span>
      <input
        type="number"
        name="${input.name}"
        data-sheet-field="${input.name}"
        value="${input.value}"
        min="0"
        ${input.max !== undefined ? raw(`max="${input.max}"`) : raw('')}
        required
        inputmode="numeric"
        aria-label="${input.label}"
      />
      <span aria-hidden="true">${input.label}</span>
    </label>
    <button type="submit" class="sr-only">Save ${input.label}</button>
  </form>` as HtmlEscapedString;
}

function renderPerkMarkTracker(input: {
  game: string;
  character: CharacterSheetData['detail']['character'];
}): HtmlEscapedString {
  const groups = perkMarkGroupCountForGame(input.game);
  const total = groups * PERK_MARK_GROUP_SIZE;
  const checked = Math.max(0, Math.min(input.character.perkMarks, total));
  return html`<fieldset class="squire-sheet__perk-marks">
    <legend class="sr-only">Advancement mark tracker</legend>
    ${Array.from({ length: groups }, (_, groupIndex) => {
      return html`<span
        class="squire-sheet__perk-mark-group"
        aria-label="Perk mark group ${groupIndex + 1}"
      >
        ${Array.from({ length: PERK_MARK_GROUP_SIZE }, (_, markIndex) => {
          const index = groupIndex * PERK_MARK_GROUP_SIZE + markIndex;
          return html`<label class="squire-sheet__pip">
            <input
              type="checkbox"
              name="perkMarks"
              value="${index}"
              ${index < checked ? raw('checked') : raw('')}
            />
            <span class="sr-only">Perk mark ${index + 1}</span>
          </label>`;
        })}
      </span>`;
    })}
  </fieldset>` as HtmlEscapedString;
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
    <legend class="sr-only">Perk checklist</legend>
    ${mat.perks.map((perk, index) => {
      return html`<label class="squire-sheet__check">
        <input
          type="checkbox"
          name="perks"
          value="${index}"
          ${picked.has(index) ? raw('checked') : raw('')}
        />
        <span>${perk}</span>
      </label>`;
    })}
  </fieldset>` as HtmlEscapedString;
}

function renderMasteryControls(
  character: CharacterSheetData['detail']['character'],
  mat: CharacterMatSummary | null | undefined,
): HtmlEscapedString {
  if (!mat) {
    return html`<p class="squire-sheet__empty">
      Class mastery data is not recorded for this class yet.
    </p>` as HtmlEscapedString;
  }
  const picked = selectedMasteries(character);
  return html`<fieldset class="squire-sheet__checklist">
    <legend class="sr-only">Mastery checklist</legend>
    ${mat.masteries.map((mastery, index) => {
      return html`<label class="squire-sheet__check">
        <input
          type="checkbox"
          name="masteries"
          value="${index}"
          ${picked.has(index) ? raw('checked') : raw('')}
        />
        <span>${mastery}</span>
      </label>`;
    })}
  </fieldset>` as HtmlEscapedString;
}

function itemStatusLabel(option: ItemOption, owned: boolean): string {
  if (owned) return 'owned';
  return option.status;
}

interface ComboboxOption {
  value: string;
  primary: string;
  number?: string;
  meta?: string;
  status?: string;
  disabled?: boolean;
}

function renderSearchCombobox(input: {
  id: string;
  name: string;
  label: string;
  placeholder: string;
  options: ComboboxOption[];
  selectedValue?: string | null;
  required?: boolean;
}): HtmlEscapedString {
  const selected = input.options.find((option) => option.value === input.selectedValue);
  const selectedLabel = selected?.primary ?? '';
  return html`<div class="squire-combobox" data-squire-combobox>
    <input
      type="hidden"
      name="${input.name}"
      value="${input.selectedValue ?? ''}"
      data-combobox-value
      ${input.required ? raw('required') : raw('')}
    />
    <label class="sr-only" for="${input.id}">${input.label}</label>
    <input
      id="${input.id}"
      class="squire-combobox__input"
      type="search"
      value="${selectedLabel}"
      placeholder="${input.placeholder}"
      autocomplete="off"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded="false"
      aria-controls="${input.id}-menu"
      data-combobox-input
    />
    <div
      id="${input.id}-menu"
      class="squire-combobox__menu"
      role="listbox"
      hidden
      data-combobox-menu
    >
      ${input.options.map((option) => {
        const searchText = [option.number, option.primary, option.meta, option.status]
          .filter(Boolean)
          .join(' ');
        return html`<button
          type="button"
          class="squire-combobox__option"
          role="option"
          data-combobox-option
          data-value="${option.value}"
          data-label="${option.primary}"
          data-number="${option.number ?? ''}"
          data-meta="${option.meta ?? ''}"
          data-status="${option.status ?? ''}"
          data-search="${searchText}"
          ${option.disabled ? raw('disabled aria-disabled="true"') : raw('')}
        >
          ${option.number
            ? html`<span class="squire-combobox__number">${option.number}</span>`
            : html``}
          <span class="squire-combobox__option-main">
            <strong>${option.primary}</strong>
            ${option.meta ? html`<span>${option.meta}</span>` : html``}
          </span>
          ${option.status
            ? html`<span class="squire-combobox__status">${option.status}</span>`
            : html``}
        </button>`;
      })}
    </div>
  </div>` as HtmlEscapedString;
}

function itemComboboxOptions(options: ItemOption[], ownedIds: Set<string>): ComboboxOption[] {
  return options
    .filter((option) => option.status === 'available' && !ownedIds.has(option.sourceId))
    .map((option) => {
      const owned = ownedIds.has(option.sourceId);
      const status = itemStatusLabel(option, owned);
      return {
        value: option.sourceId,
        number: option.number,
        primary: option.name,
        status,
      };
    });
}

function cardComboboxOptions(options: CardOption[], ownedIds: Set<string>): ComboboxOption[] {
  return options
    .filter((option) => !ownedIds.has(option.sourceId))
    .map((option) => {
      return {
        value: option.sourceId,
        primary: option.name,
        meta: option.level ? `Level ${option.level}` : 'Level 1',
      };
    });
}

function questComboboxOptions(input: {
  options: PersonalQuestOption[];
  characterId: string;
  selectedValue?: string | null;
}): ComboboxOption[] {
  return [
    {
      value: '',
      primary: 'No personal quest selected',
    },
    ...input.options
      .filter((option) => {
        const assignedElsewhere =
          option.assignedCharacterId !== null && option.assignedCharacterId !== input.characterId;
        return (
          option.sourceId === input.selectedValue ||
          (!assignedElsewhere && option.status === 'available')
        );
      })
      .map((option) => ({
        value: option.sourceId,
        primary: option.name,
      })),
  ];
}

function selectedQuestName(
  sourceId: string | null | undefined,
  names: Map<string, PersonalQuestOption>,
): string {
  if (!sourceId) return 'NOT RECORDED';
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

  return html`<section
    class="squire-sheet"
    data-character-id="${id}"
    data-level-thresholds="${LEVEL_XP_THRESHOLDS.join(',')}"
  >
    <header class="squire-sheet__hero">
      <div class="squire-sheet__identity">
        <p class="squire-sheet__breadcrumb">
          <a href="/campaigns/${data.campaign.id}">${data.campaign.name.toUpperCase()}</a>
        </p>
        ${inlineNameForm({
          action: updateAction,
          csrfToken,
          version: character.version,
          name: character.name,
          own,
        })}
        <div class="squire-sheet__class-line">
          <span>${character.className}</span>
          <span data-sheet-level>Level ${character.level}</span>
          ${inlineNumberForm({
            action: updateAction,
            csrfToken,
            version: character.version,
            sectionId: 'progress',
            name: 'xp',
            label: 'XP',
            value: character.xp,
            own,
            max: 999,
          })}
          ${inlineNumberForm({
            action: updateAction,
            csrfToken,
            version: character.version,
            sectionId: 'gold',
            name: 'gold',
            label: 'gp',
            value: character.gold,
            own,
          })}
          ${character.status === 'retired' ? html`<span>Retired</span>` : html``}
        </div>
        ${renderXpMeter(character.level, character.xp)}
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

    <div class="squire-sheet__workspace">
      <div class="squire-sheet__column squire-sheet__column--record">
        ${panel({
          id: 'items',
          title: 'Items',
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
                data-sheet-autosave="item-add"
              >
                ${csrfField(csrfToken)}
                ${renderSearchCombobox({
                  id: 'sheet-item-source',
                  name: 'sourceId',
                  label: 'Add item from catalog',
                  placeholder: 'Search item catalog',
                  options: itemComboboxOptions(data.itemOptions, ownedItemIds),
                  required: true,
                })}
                <span class="sr-only" aria-live="polite">Items save automatically.</span>
              </form>`
            : html``}` as HtmlEscapedString,
        })}
        ${privateTier
          ? panel({
              id: 'quest',
              title: 'Personal Quest',
              summaryValue: selectedQuestName(privateTier.personalQuestSourceId, data.questNames),
              body: fieldForm({
                action: updateAction,
                csrfToken,
                version: character.version,
                sectionId: 'quest',
                fields: renderSearchCombobox({
                  id: 'sheet-quest-source',
                  name: 'personalQuestSourceId',
                  label: 'Personal quest',
                  placeholder: 'Search personal quests',
                  options: questComboboxOptions({
                    options: data.questOptions,
                    characterId: id,
                    selectedValue: privateTier.personalQuestSourceId,
                  }),
                  selectedValue: privateTier.personalQuestSourceId,
                }),
                autosave: true,
              }),
            })
          : html``}
        ${privateTier
          ? panel({
              id: 'notes',
              title: 'Notes',
              body: fieldForm({
                action: updateAction,
                csrfToken,
                version: character.version,
                sectionId: 'notes',
                fields: html`<label class="squire-sheet__field">
                  <span class="sr-only">Notes</span>
                  <textarea name="privateNotes" maxlength="5000" rows="4" aria-label="Notes">
${privateValue(privateTier.privateNotes)}</textarea
                  >
                </label>` as HtmlEscapedString,
                autosave: true,
                autosaveDelayMs: 500,
              }),
            })
          : html``}
      </div>

      <div class="squire-sheet__column squire-sheet__column--build">
        ${panel({
          id: 'perks',
          title: 'Perks',
          className: 'squire-sheet__panel--wide',
          body: own
            ? fieldForm({
                action: updateAction,
                csrfToken,
                version: character.version,
                sectionId: 'perks',
                fields: html`${renderPerkMarkTracker({
                  game: data.campaign.game,
                  character,
                })}
                ${renderPerkControls(character, data.characterMat)}` as HtmlEscapedString,
                autosave: true,
              })
            : (html`<p class="squire-sheet__readonly">
                ${character.perks.length > 0 || character.perkMarks > 0
                  ? 'Perks recorded'
                  : 'Not recorded'}
              </p>` as HtmlEscapedString),
        })}
        ${panel({
          id: 'masteries',
          title: 'Masteries',
          className: 'squire-sheet__panel--wide',
          body: own
            ? fieldForm({
                action: updateAction,
                csrfToken,
                version: character.version,
                sectionId: 'masteries',
                fields: renderMasteryControls(character, data.characterMat),
                autosave: true,
              })
            : (html`<p class="squire-sheet__readonly">
                ${character.masteries.length > 0 ? 'Masteries recorded' : 'Not recorded'}
              </p>` as HtmlEscapedString),
        })}
        ${panel({
          id: 'cards',
          title: 'Ability Cards',
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
                data-sheet-autosave="card-add"
              >
                ${csrfField(csrfToken)}
                ${renderSearchCombobox({
                  id: 'sheet-card-source',
                  name: 'sourceId',
                  label: 'Add class card',
                  placeholder: 'Search ability cards',
                  options: cardComboboxOptions(data.cardOptions, ownedCardIds),
                  required: true,
                })}
                <span class="sr-only" aria-live="polite">Ability cards save automatically.</span>
              </form>`
            : html``}` as HtmlEscapedString,
        })}
      </div>
    </div>
  </section>` as HtmlEscapedString;
}
