/**
 * Accordion character sheet (SQR-277): owner vs non-owner rendering,
 * deep-linkable anchors, single-field saves with optimistic versions, the
 * save-failure banner, claim banner, and inline rules-legality warnings.
 */
import { generateSignedCookie } from 'hono/cookie';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';

process.env.SESSION_SECRET = 'test-session-secret-must-be-at-least-32-characters-long';

import { app } from '../src/server.ts';
import { getDb, shutdownServerPool } from '../src/db.ts';
import { createCsrfToken } from '../src/auth/csrf.ts';
import { SESSION_COOKIE_NAME, getSessionSecret } from '../src/auth/session-middleware.ts';
import * as SessionRepository from '../src/db/repositories/session-repository.ts';
import { SESSION_LIFETIME_MS } from '../src/db/repositories/session-repository.ts';
import * as CampaignService from '../src/campaign/campaign-service.ts';
import * as CharacterService from '../src/campaign/character-service.ts';
import { identityFromSessionUser } from '../src/campaign/identity.ts';
import { listCardOptionsForClass } from '../src/campaign/character-sheet-data.ts';
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

function formPost(user: TestUser, fields: Record<string, string>) {
  const body = new URLSearchParams({ _csrf: createCsrfToken(user.sessionId), ...fields });
  return {
    method: 'POST',
    headers: {
      Cookie: user.cookie,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
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
    level: 3,
    xp: 120,
    gold: 15,
    personalQuest: 'SHEET-PQ-SECRET',
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
    level: 3,
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
      'level',
      'gold',
      'perks',
      'items',
      'cards',
      'quest',
      'goals',
      'notes',
    ]) {
      expect(body).toContain(`data-sheet-section="${anchor}"`);
    }
    expect(body).toContain('SHEET-PQ-SECRET');
    expect(body).toContain('Sheet Hero');
    expect(body).toContain('action="/characters/' + character.id + '/update"');
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
    expect(body).toContain('Artwork: Cephalofair Games');
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
      level: 3,
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
    expect(body).toContain('data-sheet-section="gold"');
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

  it('surfaces the SQR-285 rules check inline when a save is rules-suspect', async () => {
    const { owner, ownerIdentity, character } = await setupSheetFixture();
    const res = await app.request(
      `/characters/${character.id}/update`,
      formPost(owner, {
        section: 'level',
        expectedVersion: String(character.version),
        level: '5',
        xp: '100',
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('RULES CHECK');
    expect(body).toContain('210 XP');
    // Soft warning — the save itself applied.
    const detail = await CharacterService.getCharacterDetail(ownerIdentity, character.id);
    expect(detail.character.level).toBe(5);
  });
});

describe('items section', () => {
  it('adds by item number from GHS data, warns on gold, rejects unknown numbers', async () => {
    const { owner, ownerIdentity, character } = await setupSheetFixture();
    const { db } = getDb('server');
    const sourceIds = ['test-sheet-item'];
    await db
      .insert(cardItems)
      .values([
        {
          game: 'frosthaven',
          sourceId: sourceIds[0],
          number: '777',
          name: 'Sheet Testblade',
          slot: 'one hand',
          cost: 90,
          effect: 'Test effect',
          spent: false,
          lost: false,
        },
      ])
      .onConflictDoNothing();
    try {
      // Costs 90, the character has 15 — added anyway, warned inline.
      const added = await app.request(
        `/characters/${character.id}/items/add`,
        formPost(owner, { number: '777' }),
      );
      expect(added.status).toBe(200);
      const body = await added.text();
      expect(body).toContain('RULES CHECK');
      expect(body).toContain('costs 90 gold');
      const detail = await CharacterService.getCharacterDetail(ownerIdentity, character.id);
      expect(detail.items.map((item) => item.sourceId)).toContain(sourceIds[0]);

      const unknown = await app.request(
        `/characters/${character.id}/items/add`,
        formPost(owner, { number: '999' }),
      );
      expect(unknown.status).toBe(400);
      expect(await unknown.text()).toContain('No frosthaven item numbered');
    } finally {
      await db.delete(cardItems).where(inArray(cardItems.sourceId, sourceIds));
    }
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
    expect(body.replace(/\s+/g, ' ')).toContain('Drifter 3');
    expect(body).not.toContain('squire-campaign-dashboard__member-role');
    expect(body).not.toContain('OWNER');
    expect(body).not.toContain('>Characters</h2>');
  });
});
