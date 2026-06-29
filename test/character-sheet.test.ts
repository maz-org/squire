/**
 * Structured character sheet: owner vs non-owner rendering, deep-linkable
 * anchors, single-field saves with optimistic versions, save-failure banner,
 * claim banner, and catalog-backed selectors.
 */
import { generateSignedCookie } from 'hono/cookie';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, gt, inArray } from 'drizzle-orm';

process.env.SESSION_SECRET = 'test-session-secret-must-be-at-least-32-characters-long';

import { app } from '../src/server.ts';
import { getDb, shutdownServerPool } from '../src/db.ts';
import { createCsrfToken } from '../src/auth/csrf.ts';
import { SESSION_COOKIE_NAME, getSessionSecret } from '../src/auth/session-middleware.ts';
import * as SessionRepository from '../src/db/repositories/session-repository.ts';
import { SESSION_LIFETIME_MS } from '../src/db/repositories/session-repository.ts';
import * as CampaignService from '../src/campaign/campaign-service.ts';
import * as CharacterService from '../src/campaign/character-service.ts';
import {
  updateItemCatalogStatus,
  updatePersonalQuestCatalogStatus,
} from '../src/campaign/character-catalog.ts';
import { identityFromSessionUser } from '../src/campaign/identity.ts';
import {
  listCardOptionsForClass,
  listPersonalQuestOptions,
} from '../src/campaign/character-sheet-data.ts';
import { cardItems } from '../src/db/schema/cards.ts';
import { cardCharacterMats } from '../src/db/schema/cards.ts';
import { users } from '../src/db/schema/core.ts';
import { resetTestDb, setupTestDb, teardownTestDb } from './helpers/db.ts';

const OWNER_EMAIL = 'owner@example.com';
const MEMBER_EMAIL = 'member@example.com';
const OUTSIDER_EMAIL = 'outsider@example.com';
const SHEET_MAT_SOURCE_IDS = ['test-sheet-drifter', 'test-sheet-bruiser'];

interface TestUser {
  cookie: string;
  sessionId: string;
  userId: string;
}

async function createTestUser(email: string): Promise<TestUser> {
  const { db } = getDb('server');
  const [user] = await db
    .insert(users)
    .values({ email, googleSub: `google-sub-${email}`, name: email.split('@')[0] })
    .returning();
  const { sessionId } = await SessionRepository.create(db, { userId: user.id });
  const signedCookie = await generateSignedCookie(
    SESSION_COOKIE_NAME,
    sessionId,
    getSessionSecret(),
    { path: '/', httpOnly: true, sameSite: 'Lax', maxAge: SESSION_LIFETIME_MS / 1000 },
  );
  return { cookie: signedCookie.split(';')[0], sessionId, userId: user.id };
}

function formPost(user: TestUser, fields: Record<string, string | string[]>) {
  const body = new URLSearchParams({ _csrf: createCsrfToken(user.sessionId) });
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const entry of value) body.append(key, entry);
    } else {
      body.set(key, value);
    }
  }
  return {
    method: 'POST',
    headers: {
      Cookie: user.cookie,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  };
}

function autosavePost(user: TestUser, fields: Record<string, string | string[]>) {
  const request = formPost(user, fields);
  return {
    ...request,
    headers: {
      ...request.headers,
      accept: 'application/json',
      'x-squire-autosave': 'true',
    },
  };
}

async function setupSheetFixture() {
  const owner = await createTestUser(OWNER_EMAIL);
  const member = await createTestUser(MEMBER_EMAIL);
  const ownerIdentity = identityFromSessionUser(owner.userId);
  const memberIdentity = identityFromSessionUser(member.userId);
  const campaign = await CampaignService.createCampaign(ownerIdentity, {
    name: 'Sheet Campaign',
    game: 'frosthaven',
    modules: [],
  });
  const invite = await CampaignService.inviteMember(ownerIdentity, campaign.id, MEMBER_EMAIL);
  await CampaignService.acceptInvite(memberIdentity, invite.memberId);
  const character = await CharacterService.createCharacter(ownerIdentity, campaign.id, {
    name: 'Sheet Hero',
    className: 'Drifter',
    xp: 120,
    gold: 15,
    privateNotes: 'SHEET-PQ-SECRET',
  });
  return { owner, member, ownerIdentity, campaign, character };
}

async function seedSheetMats() {
  const { db } = getDb('server');
  await db
    .insert(cardCharacterMats)
    .values([
      {
        game: 'frosthaven',
        sourceId: SHEET_MAT_SOURCE_IDS[0],
        name: 'Drifter',
        characterClass: 'Inox',
        handSize: 9,
        traits: ['durable', 'resourceful'],
        hp: { '1': 10, '2': 12, '3': 14 },
        perks: ['Ignore negative item effects'],
        masteries: ['Never drop below half health'],
      },
      {
        game: 'gloomhaven-2e',
        sourceId: SHEET_MAT_SOURCE_IDS[1],
        name: 'Bruiser',
        characterClass: 'Inox',
        handSize: 10,
        traits: ['strong', 'armored'],
        hp: { '1': 10, '2': 12, '3': 14 },
        perks: ['Replace 2 -1 cards with +1 cards'],
        masteries: ['Push a foe into danger'],
      },
    ])
    .onConflictDoNothing();
}

async function setupGh2SheetFixture() {
  const owner = await createTestUser(OWNER_EMAIL);
  const ownerIdentity = identityFromSessionUser(owner.userId);
  const campaign = await CampaignService.createCampaign(ownerIdentity, {
    name: 'Mat Campaign',
    game: 'gloomhaven-2e',
    modules: [],
  });
  const character = await CharacterService.createCharacter(ownerIdentity, campaign.id, {
    name: 'Mat Hero',
    className: 'Bruiser',
    xp: 120,
    gold: 15,
  });
  return { owner, campaign, character };
}

beforeAll(async () => {
  await setupTestDb();
  await seedSheetMats();
});

beforeEach(async () => {
  await resetTestDb();
  await seedSheetMats();
  process.env.SQUIRE_ALLOWED_EMAILS = [OWNER_EMAIL, MEMBER_EMAIL, OUTSIDER_EMAIL].join(',');
});

afterAll(async () => {
  delete process.env.SQUIRE_ALLOWED_EMAILS;
  const { db } = getDb('server');
  await db
    .delete(cardCharacterMats)
    .where(inArray(cardCharacterMats.sourceId, SHEET_MAT_SOURCE_IDS));
  await teardownTestDb();
  await shutdownServerPool();
});

describe('GET /characters/:id', () => {
  it('renders every owner section with deep-linkable anchors and private values', async () => {
    const { owner, character } = await setupSheetFixture();
    const res = await app.request(`/characters/${character.id}`, {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    for (const anchor of [
      'identity',
      'progress',
      'gold',
      'perks',
      'masteries',
      'items',
      'cards',
      'quest',
      'notes',
    ]) {
      expect(body).toContain(`data-sheet-section="${anchor}"`);
    }
    expect(body).not.toContain('data-sheet-section="goals"');
    expect(body).not.toContain('name="level"');
    expect(body).toContain('squire-sheet__workspace');
    expect(body).toContain('squire-sheet__panel');
    expect(body).not.toContain('squire-sheet__metrics');
    expect(body).not.toContain('squire-sheet__summary');
    expect(body).toContain('SHEET-PQ-SECRET');
    expect(body).toContain('NOT RECORDED');
    expect(body).toContain('Sheet Hero');
    expect(body).toContain('action="/characters/' + character.id + '/update"');
    expect(body).toContain('data-sheet-autosave');
    expect(body).toContain('name="xp"');
    expect(body).toContain('max="999"');
    expect(body).toContain('squire-combobox');
    expect(body).toContain('data-combobox-name="sourceId"');
    expect(body).toContain('data-combobox-name="personalQuestSourceId"');
    expect(body).toContain('<noscript>');
    expect(body).toContain('<select name="sourceId"');
    expect(body).toContain('<select name="personalQuestSourceId"');
  });

  it('renders the redesigned identity header with mat art and class stats', async () => {
    const { owner, character } = await setupGh2SheetFixture();
    const res = await app.request(`/characters/${character.id}`, {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('squire-sheet__hero');
    expect(body).toContain('squire-sheet__hero-stats');
    expect(body).toContain('squire-sheet__mat-art');
    expect(body).toContain('src="/assets/character-mats/gloomhaven-2e/gh2-bruiser.jpeg"');
    expect(body).toContain('HAND 10');
    expect(body).toContain('HP 14');
    expect(body).toContain('STRONG');
    expect(body).not.toContain('PERKS 1');
    expect(body).not.toContain('MASTERIES 1');
    expect(body).toContain('Artwork: Cephalofair Games');
  });

  it('renders autosaved sheet controls without visible save/add controls or helper legends', async () => {
    const { owner, character } = await setupSheetFixture();
    const res = await app.request(`/characters/${character.id}`, {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.text();

    expect(body).toContain('data-sheet-autosave="item-add"');
    expect(body).toContain('data-sheet-autosave="card-add"');
    expect(body).not.toContain('>Add item</button>');
    expect(body).not.toContain('>Add card</button>');
    expect(body).not.toContain('Private notes (only you can see this)');
    expect(body).not.toContain('Class perks');
    expect(body).not.toContain('Class masteries');
    expect(body).not.toContain('Perk marks');
  });

  it('filters item and personal quest dropdowns to actionable catalog entries', async () => {
    const { owner, ownerIdentity, campaign, character } = await setupSheetFixture();
    const { db } = getDb('server');
    const items = await db
      .select({ sourceId: cardItems.sourceId, name: cardItems.name })
      .from(cardItems)
      .where(eq(cardItems.game, 'frosthaven'))
      .limit(2);
    if (items.length < 2) throw new Error('Expected two seeded Frosthaven items.');
    await updateItemCatalogStatus({
      campaignId: campaign.id,
      game: 'frosthaven',
      sourceId: items[0].sourceId,
      status: 'available',
    });
    await updateItemCatalogStatus({
      campaignId: campaign.id,
      game: 'frosthaven',
      sourceId: items[1].sourceId,
      status: 'locked',
    });

    const quests = await listPersonalQuestOptions({
      campaignId: campaign.id,
      game: 'frosthaven',
    });
    const assignedQuest = quests.find((quest) => quest.status === 'available');
    if (!assignedQuest) throw new Error('Expected a seeded Frosthaven personal quest.');
    const otherCharacter = await CharacterService.createCharacter(ownerIdentity, campaign.id, {
      name: 'Other Sheet Hero',
      className: 'Drifter',
    });
    await CharacterService.updateCharacter(ownerIdentity, otherCharacter.id, {
      expectedVersion: otherCharacter.version,
      personalQuestSourceId: assignedQuest.sourceId,
    });

    const res = await app.request(`/characters/${character.id}`, {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(items[0].name);
    expect(body).not.toContain(items[1].name);
    expect(body).not.toContain(assignedQuest.name);

    await updatePersonalQuestCatalogStatus({
      campaignId: campaign.id,
      game: 'frosthaven',
      sourceId: assignedQuest.sourceId,
      status: 'locked',
    });
    const lockedQuest = await app.request(`/characters/${character.id}`, {
      headers: { Cookie: owner.cookie },
    });
    expect(await lockedQuest.text()).not.toContain(assignedQuest.name);
  });

  it('lists GH2e locked-class ability cards by real class name', async () => {
    const doomstalker = await listCardOptionsForClass('gloomhaven-2e', 'Doomstalker');
    const quartermaster = await listCardOptionsForClass('gloomhaven-2e', 'Quartermaster');
    const legacySymbol = await listCardOptionsForClass('gloomhaven-2e', 'Three Spears');

    expect(doomstalker.length).toBe(30);
    expect(doomstalker.map((card) => card.name)).toContain('Rain of Arrows');
    expect(quartermaster.length).toBe(30);
    expect(quartermaster.map((card) => card.name)).toContain('Booster Pack');
    expect(legacySymbol).toHaveLength(0);
  });

  it('renders an explicit class stats fallback when mat data is unavailable', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const ownerIdentity = identityFromSessionUser(owner.userId);
    const campaign = await CampaignService.createCampaign(ownerIdentity, {
      name: 'Unknown Class Campaign',
      game: 'gloomhaven-2e',
      modules: [],
    });
    const character = await CharacterService.createCharacter(ownerIdentity, campaign.id, {
      name: 'Unknown Hero',
      className: 'Unrecorded Class',
      allowHomebrewClass: true,
      xp: 120,
      gold: 15,
    });

    const res = await app.request(`/characters/${character.id}`, {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('squire-sheet__hero-stats');
    expect(body).toContain('CLASS STATS NOT RECORDED');
    expect(body).not.toContain('HAND 10');
  });

  it('serves mirrored character mat artwork from this app', async () => {
    const res = await app.request('/assets/character-mats/gloomhaven-2e/gh2-bruiser.jpeg');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('shows non-owners public fields only — no private sections, no edit forms', async () => {
    const { member, character } = await setupSheetFixture();
    const res = await app.request(`/characters/${character.id}`, {
      headers: { Cookie: member.cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Sheet Hero');
    expect(body).not.toContain('SHEET-PQ-SECRET');
    expect(body).not.toContain('data-sheet-section="quest"');
    expect(body).not.toContain('data-sheet-section="notes"');
    expect(body).not.toContain('action="/characters/' + character.id + '/update"');
  });

  it('404s outsiders, indistinguishable from absent', async () => {
    const { character } = await setupSheetFixture();
    const outsider = await createTestUser(OUTSIDER_EMAIL);
    const res = await app.request(`/characters/${character.id}`, {
      headers: { Cookie: outsider.cookie },
    });
    expect(res.status).toBe(404);
  });

  it('shows the claim banner only to the placeholder member', async () => {
    const { owner, ownerIdentity, campaign } = await setupSheetFixture();
    // Placeholders require a PENDING invite for the email (SQR-22 rule):
    // invite the outsider, hold their seat, then they join and claim.
    const invite = await CampaignService.inviteMember(ownerIdentity, campaign.id, OUTSIDER_EMAIL);
    const placeholder = await CharacterService.createCharacter(ownerIdentity, campaign.id, {
      name: 'Held Seat',
      className: 'Banner Spear',
      placeholderForEmail: OUTSIDER_EMAIL,
    });
    const joiner = await createTestUser(OUTSIDER_EMAIL);
    await CampaignService.acceptInvite(identityFromSessionUser(joiner.userId), invite.memberId);

    const forJoiner = await app.request(`/characters/${placeholder.id}`, {
      headers: { Cookie: joiner.cookie },
    });
    expect(await forJoiner.text()).toContain("THIS ONE'S YOURS");

    const forOwner = await app.request(`/characters/${placeholder.id}`, {
      headers: { Cookie: owner.cookie },
    });
    expect(await forOwner.text()).not.toContain("THIS ONE'S YOURS");

    // Claiming transfers ownership and lands back on the sheet.
    const claim = await app.request(`/characters/${placeholder.id}/claim`, formPost(joiner, {}));
    expect(claim.status).toBe(303);
    const claimed = await CharacterService.getCharacterDetail(
      identityFromSessionUser(joiner.userId),
      placeholder.id,
    );
    expect(claimed.own).toBe(true);
  });
});

describe('POST /characters/:id/update', () => {
  it('saves the everyday single-field edit and redirects to the section anchor', async () => {
    const { owner, ownerIdentity, character } = await setupSheetFixture();
    const res = await app.request(
      `/characters/${character.id}/update`,
      formPost(owner, {
        section: 'gold',
        expectedVersion: String(character.version),
        gold: '42',
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/characters/${character.id}#gold`);
    const detail = await CharacterService.getCharacterDetail(ownerIdentity, character.id);
    expect(detail.character.gold).toBe(42);
  });

  it('save-failure path: a stale version renders the banner and keeps the section open', async () => {
    const { owner, ownerIdentity, character } = await setupSheetFixture();
    // A concurrent save bumps the version first.
    await CharacterService.updateCharacter(ownerIdentity, character.id, {
      expectedVersion: character.version,
      gold: 99,
    });
    const res = await app.request(
      `/characters/${character.id}/update`,
      formPost(owner, {
        section: 'gold',
        expectedVersion: String(character.version), // stale
        gold: '1',
      }),
    );
    expect(res.status).toBe(409);
    const body = await res.text();
    expect(body).toContain('COULD NOT SAVE');
    expect(body).toContain('Someone else saved this sheet first');
    // The gold the conflicting save wrote survives; ours did not apply.
    const detail = await CharacterService.getCharacterDetail(ownerIdentity, character.id);
    expect(detail.character.gold).toBe(99);
  });

  it('saves XP from the progress section and derives the displayed level', async () => {
    const { owner, ownerIdentity, character } = await setupSheetFixture();
    const res = await app.request(
      `/characters/${character.id}/update`,
      formPost(owner, {
        section: 'progress',
        expectedVersion: String(character.version),
        xp: '210',
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/characters/${character.id}#progress`);
    const detail = await CharacterService.getCharacterDetail(ownerIdentity, character.id);
    expect(detail.character.level).toBe(5);
    expect(detail.character.xp).toBe(210);
  });

  it('returns JSON for optimistic header autosaves without redirecting', async () => {
    const { owner, ownerIdentity, character } = await setupSheetFixture();
    const res = await app.request(
      `/characters/${character.id}/update`,
      autosavePost(owner, {
        section: 'identity',
        expectedVersion: String(character.version),
        name: 'Inline Hero',
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    const body = (await res.json()) as {
      character: { name: string; level: number; xp: number; gold: number; version: number };
    };
    expect(body.character).toMatchObject({
      name: 'Inline Hero',
      level: character.level,
      xp: character.xp,
      gold: character.gold,
      version: character.version + 1,
    });
    const detail = await CharacterService.getCharacterDetail(ownerIdentity, character.id);
    expect(detail.character.name).toBe('Inline Hero');
  });

  it('rejects XP above the sheet range', async () => {
    const { owner, character } = await setupSheetFixture();
    const res = await app.request(
      `/characters/${character.id}/update`,
      formPost(owner, {
        section: 'progress',
        expectedVersion: String(character.version),
        xp: '1000',
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('XP must be a whole number from 0 to 999.');
  });

  it('returns JSON errors for invalid optimistic header autosaves', async () => {
    const { owner, character } = await setupSheetFixture();
    const res = await app.request(
      `/characters/${character.id}/update`,
      autosavePost(owner, {
        section: 'progress',
        expectedVersion: String(character.version),
        xp: '1000',
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body).toEqual({
      error: 'invalid_character_state',
      message: 'XP must be a whole number from 0 to 999.',
    });
  });

  it('saves perk marks and mastery checklist selections', async () => {
    const { owner, ownerIdentity, character } = await setupSheetFixture();
    const perkRes = await app.request(
      `/characters/${character.id}/update`,
      formPost(owner, {
        section: 'perks',
        expectedVersion: String(character.version),
        perks: ['0'],
        perkMarks: ['0', '1', '2'],
      }),
    );
    expect(perkRes.status).toBe(303);

    const afterPerks = await CharacterService.getCharacterDetail(ownerIdentity, character.id);
    expect(afterPerks.character.perks).toEqual([0]);
    expect(afterPerks.character.perkMarks).toBe(3);

    const masteryRes = await app.request(
      `/characters/${character.id}/update`,
      formPost(owner, {
        section: 'masteries',
        expectedVersion: String(afterPerks.character.version),
        masteries: ['0'],
      }),
    );
    expect(masteryRes.status).toBe(303);
    expect(masteryRes.headers.get('location')).toBe(`/characters/${character.id}#masteries`);

    const afterMasteries = await CharacterService.getCharacterDetail(ownerIdentity, character.id);
    expect(afterMasteries.character.masteries).toEqual([0]);
  });
});

describe('items section', () => {
  it('returns JSON for optimistic item add and remove autosaves', async () => {
    const { owner, campaign, character } = await setupSheetFixture();
    const { db } = getDb('server');
    const [seededItem] = await db
      .select({ sourceId: cardItems.sourceId, name: cardItems.name, number: cardItems.number })
      .from(cardItems)
      .where(eq(cardItems.game, 'frosthaven'))
      .limit(1);
    if (!seededItem) throw new Error('Expected seeded Frosthaven item.');
    await updateItemCatalogStatus({
      campaignId: campaign.id,
      game: 'frosthaven',
      sourceId: seededItem.sourceId,
      status: 'available',
    });

    const added = await app.request(
      `/characters/${character.id}/items/add`,
      autosavePost(owner, { sourceId: seededItem.sourceId }),
    );
    expect(added.status).toBe(200);
    expect(added.headers.get('location')).toBeNull();
    const addedBody = (await added.json()) as {
      item: { id: string; sourceId: string; number: string; name: string };
    };
    expect(addedBody.item).toMatchObject({
      sourceId: seededItem.sourceId,
      number: seededItem.number,
      name: seededItem.name,
    });

    const removed = await app.request(
      `/characters/${character.id}/items/${addedBody.item.id}/remove`,
      autosavePost(owner, {}),
    );
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true });
  });

  it('adds by catalog source id, warns on gold, and rejects unknown source ids', async () => {
    const { owner, ownerIdentity, campaign, character } = await setupSheetFixture();
    const { db } = getDb('server');
    const [seededItem] = await db
      .select({ sourceId: cardItems.sourceId, cost: cardItems.cost })
      .from(cardItems)
      .where(and(eq(cardItems.game, 'frosthaven'), gt(cardItems.cost, 15)))
      .limit(1);
    if (!seededItem || seededItem.cost === null) {
      throw new Error('Expected seeded Frosthaven item with cost above 15.');
    }
    await updateItemCatalogStatus({
      campaignId: campaign.id,
      game: 'frosthaven',
      sourceId: seededItem.sourceId,
      status: 'available',
    });
    const added = await app.request(
      `/characters/${character.id}/items/add`,
      formPost(owner, { sourceId: seededItem.sourceId }),
    );
    expect(added.status).toBe(200);
    const body = await added.text();
    expect(body).toContain('RULES CHECK');
    expect(body).toContain(`costs ${seededItem.cost} gold`);
    const detail = await CharacterService.getCharacterDetail(ownerIdentity, character.id);
    expect(detail.items.map((item) => item.sourceId)).toContain(seededItem.sourceId);

    const unknown = await app.request(
      `/characters/${character.id}/items/add`,
      formPost(owner, { sourceId: 'missing-item-source' }),
    );
    expect(unknown.status).toBe(422);
    expect(await unknown.text()).toContain('Item is not in this game catalog.');
  });
});

describe('ability card section', () => {
  it('returns JSON for optimistic card add, role, and remove autosaves', async () => {
    const { owner, character } = await setupSheetFixture();
    const [card] = await listCardOptionsForClass('frosthaven', 'Drifter');
    if (!card) throw new Error('Expected seeded Drifter ability card.');

    const added = await app.request(
      `/characters/${character.id}/cards/add`,
      autosavePost(owner, { sourceId: card.sourceId }),
    );
    expect(added.status).toBe(200);
    expect(added.headers.get('location')).toBeNull();
    const addedBody = (await added.json()) as {
      card: { id: string; sourceId: string; role: string; name: string; level: string | null };
    };
    expect(addedBody.card).toMatchObject({
      sourceId: card.sourceId,
      role: 'owned',
      name: card.name,
      level: card.level,
    });

    const role = await app.request(
      `/characters/${character.id}/cards/${addedBody.card.id}/role`,
      autosavePost(owner, { role: 'active' }),
    );
    expect(role.status).toBe(200);
    expect(await role.json()).toEqual({ card: { id: addedBody.card.id, role: 'active' } });

    const removed = await app.request(
      `/characters/${character.id}/cards/${addedBody.card.id}/remove`,
      autosavePost(owner, {}),
    );
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true });
  });
});

describe('dashboard reachability', () => {
  it('links each character from one Party section without owner-role roster chrome', async () => {
    const { owner, campaign, character } = await setupSheetFixture();
    const res = await app.request(`/campaigns/${campaign.id}/party`, {
      headers: { Cookie: owner.cookie },
    });
    const body = await res.text();
    expect(body).toContain(`href="/characters/${character.id}"`);
    expect(body).toContain('squire-campaign-dashboard__party');
    expect(body).toContain('squire-party-row__name');
    expect(body).toContain('squire-party-row__class');
    expect(body.replace(/\s+/g, ' ')).toContain('Drifter L3');
    expect(body).not.toContain('squire-campaign-dashboard__member-role');
    expect(body).not.toContain('OWNER');
    expect(body).not.toContain('>Characters</h2>');
  });
});
