/**
 * Create-a-character web UI tests (SQR-318).
 *
 * The dashboard Party view renders a "New character" form (a class select
 * sourced from the game's real class names). Posting it creates the character
 * on the active campaign under the caller's identity; an unknown/codename
 * class is rejected with an inline banner; a non-member gets the
 * indistinguishable 404.
 */
import { generateSignedCookie } from 'hono/cookie';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
import { users } from '../src/db/schema/core.ts';
import { cardCharacterMats } from '../src/db/schema/cards.ts';
import { resetTestDb, setupTestDb, teardownTestDb } from './helpers/db.ts';

interface TestUser {
  cookie: string;
  sessionId: string;
  userId: string;
}

const OWNER_EMAIL = 'owner@example.com';
const OUTSIDER_EMAIL = 'outsider@example.com';

// Card tables are NOT reset between tests (resetTestDb only truncates campaign/
// auth state), so seed once and clean up in afterAll.
const MAT_SOURCE_IDS = ['test-create-drifter', 'test-create-banner-spear'];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expectSelectOption(body: string, value: string, selected = false) {
  const escapedValue = escapeRegExp(value);
  const optionPattern = new RegExp(
    `<option\\s+value="${escapedValue}"[\\s\\S]*?${selected ? 'selected' : ''}[\\s\\S]*?>\\s*${escapedValue}\\s*</option>`,
  );
  expect(body).toMatch(optionPattern);
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

async function seedMats() {
  const { db } = getDb('server');
  await db
    .insert(cardCharacterMats)
    .values([
      {
        game: 'frosthaven',
        sourceId: MAT_SOURCE_IDS[0],
        name: 'Drifter',
        characterClass: 'Inox',
        handSize: 9,
        traits: [],
        hp: {},
        perks: [],
        masteries: [],
      },
      {
        game: 'frosthaven',
        sourceId: MAT_SOURCE_IDS[1],
        name: 'Banner Spear',
        characterClass: 'Human',
        handSize: 10,
        traits: [],
        hp: {},
        perks: [],
        masteries: [],
      },
    ])
    .onConflictDoNothing();
}

async function setupFixture() {
  const owner = await createTestUser(OWNER_EMAIL);
  const campaign = await CampaignService.createCampaign(identityFromSessionUser(owner.userId), {
    name: 'Roster Campaign',
    game: 'frosthaven',
    modules: [],
  });
  return { owner, campaign };
}

async function createCharacter(
  user: TestUser,
  campaignId: string,
  fields: { name?: string; className?: string; xp?: string },
): Promise<Response> {
  const form = new FormData();
  form.set('_csrf', createCsrfToken(user.sessionId));
  if (fields.name !== undefined) form.set('name', fields.name);
  if (fields.className !== undefined) form.set('className', fields.className);
  if (fields.xp !== undefined) form.set('xp', fields.xp);
  return app.request(`/campaigns/${campaignId}/characters`, {
    method: 'POST',
    headers: { Cookie: user.cookie, 'HX-Request': 'true' },
    body: form,
  });
}

beforeAll(async () => {
  await setupTestDb();
  await seedMats();
});

beforeEach(async () => {
  await resetTestDb();
  await seedMats();
  process.env.SQUIRE_ALLOWED_EMAILS = [OWNER_EMAIL, OUTSIDER_EMAIL].join(',');
});

afterAll(async () => {
  delete process.env.SQUIRE_ALLOWED_EMAILS;
  const { db } = getDb('server');
  await db.delete(cardCharacterMats).where(inArray(cardCharacterMats.sourceId, MAT_SOURCE_IDS));
  await teardownTestDb();
  await shutdownServerPool();
});

describe('create-character UI (SQR-318)', () => {
  it('renders a New character form with a class select of real class names', async () => {
    const { owner, campaign } = await setupFixture();
    const res = await app.request(`/campaigns/${campaign.id}/party`, {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    const revealTag = body.match(
      /<details[^>]*class="squire-party-section__add squire-character-create-reveal"[^>]*>/,
    )?.[0];
    expect(revealTag).toBeDefined();
    expect(revealTag).not.toContain('open');
    expect(body).toContain(
      'squire-party-section__add-summary" role="button">Add character</summary>',
    );
    expect(body).toContain('squire-character-create');
    expect(body).toContain('action="/campaigns/' + campaign.id + '/characters"');
    // Class select offers the seeded real class names.
    expectSelectOption(body, 'Banner Spear');
    expectSelectOption(body, 'Drifter');
    // Empty roster shows the create call-to-action, never fake values.
    expect(body).toContain('No active characters yet');
  });

  it('renders the SQR-360 party roster with active and retired character sections', async () => {
    const { owner, campaign } = await setupFixture();
    const active = await CharacterService.createCharacter(
      identityFromSessionUser(owner.userId),
      campaign.id,
      {
        name: 'Manual Bruiser',
        className: 'Drifter',
        xp: 95,
      },
    );
    const retired = await CharacterService.createCharacter(
      identityFromSessionUser(owner.userId),
      campaign.id,
      {
        name: 'Old Bones',
        className: 'Banner Spear',
        xp: 210,
      },
    );
    const proposal = await import('../src/campaign/pending-mutations.ts').then((mod) =>
      mod.propose(identityFromSessionUser(owner.userId), campaign.id, {
        type: 'character.retire',
        characterId: retired.id,
      }),
    );
    await import('../src/campaign/pending-mutations.ts').then((mod) =>
      mod.confirm(identityFromSessionUser(owner.userId), proposal.id),
    );

    const res = await app.request(`/campaigns/${campaign.id}/party`, {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.text();

    expect(body).toContain('squire-party-roster');
    expect(body).toContain('Active characters');
    expect(body).toContain('Retired characters');
    expect(body).toContain('Manual Bruiser');
    expect(body.replace(/\s+/g, ' ')).toContain('Drifter L3');
    expect(body).toContain('Old Bones');
    expect(body.replace(/\s+/g, ' ')).toContain('Banner Spear L5');
    expect(body).toContain(`href="/characters/${active.id}"`);
    expect(body).toContain(`href="/characters/${retired.id}"`);
    expect(body).toContain('Open sheet');
    expect(body).toContain('Retire');
    expect(body).toContain('Remove');
    expect(body).not.toContain('aria-label="Level Manual Bruiser" role="button"');
    expect(body).toContain('aria-label="Retire Manual Bruiser" role="button"');
    expect(body).toContain('aria-label="Remove Manual Bruiser" role="button"');
    expect(body).toContain('aria-label="Remove Old Bones" role="button"');
    expect(body).toContain(`href="/campaigns/${campaign.id}/party"`);
    expect(body).toContain('Cancel');
    expect(body).not.toContain('Invite by email');
    expect(body).not.toContain('Pending invites');
  });

  it('keeps Add character in the party section action and opens it on validation failure', async () => {
    const { owner, campaign } = await setupFixture();
    const res = await createCharacter(owner, campaign.id, {
      name: '  ',
      className: 'Drifter',
      xp: '150',
    });
    expect(res.status).toBe(422);
    const body = await res.text();

    expect(body).toContain('squire-party-section__action');
    expect(body).toContain(
      'squire-party-section__add-summary" role="button">Add character</summary>',
    );
    const revealTag = body.match(
      /<details[^>]*class="squire-party-section__add squire-character-create-reveal"[^>]*>/,
    )?.[0];
    expect(revealTag).toContain('open');
    expect(body).toContain('Character name is required.');
    expectSelectOption(body, 'Drifter', true);
    expect(body).toContain('value="150"');
  });

  it('keeps XP-derived level editing on the character sheet, not the party row', async () => {
    const { owner, campaign } = await setupFixture();
    const character = await CharacterService.createCharacter(
      identityFromSessionUser(owner.userId),
      campaign.id,
      {
        name: 'Leveler',
        className: 'Drifter',
        xp: 45,
      },
    );

    const page = await app.request(`/campaigns/${campaign.id}/party`, {
      headers: { Cookie: owner.cookie },
    });
    const body = await page.text();
    expect(body.replace(/\s+/g, ' ')).toContain('Drifter L2');
    expect(body).not.toContain('squire-party-row__action--level');

    const form = new FormData();
    form.set('_csrf', createCsrfToken(owner.sessionId));
    form.set('expectedVersion', String(character.version));
    form.set('level', '4');
    const res = await app.request(`/campaigns/${campaign.id}/characters/${character.id}/level`, {
      method: 'POST',
      headers: { Cookie: owner.cookie },
      body: form,
    });
    expect(res.status).toBe(404);
  });

  it('retires and removes characters from explicit party row confirmations', async () => {
    const { owner, campaign } = await setupFixture();
    const retiree = await CharacterService.createCharacter(
      identityFromSessionUser(owner.userId),
      campaign.id,
      { name: 'Retire Me', className: 'Drifter', xp: 95 },
    );
    const doomed = await CharacterService.createCharacter(
      identityFromSessionUser(owner.userId),
      campaign.id,
      { name: 'Remove Me', className: 'Banner Spear', xp: 45 },
    );

    const retire = new FormData();
    retire.set('_csrf', createCsrfToken(owner.sessionId));
    retire.set('confirm', 'retire');
    let res = await app.request(`/campaigns/${campaign.id}/characters/${retiree.id}/retire`, {
      method: 'POST',
      headers: { Cookie: owner.cookie },
      body: retire,
    });
    expect(res.status).toBe(303);

    let page = await app.request(`/campaigns/${campaign.id}/party`, {
      headers: { Cookie: owner.cookie },
    });
    let body = await page.text();
    expect(body).toContain('Retired characters');
    expect(body).toContain('Retire Me');

    const remove = new FormData();
    remove.set('_csrf', createCsrfToken(owner.sessionId));
    remove.set('confirm', 'remove');
    res = await app.request(`/campaigns/${campaign.id}/characters/${doomed.id}/remove`, {
      method: 'POST',
      headers: { Cookie: owner.cookie },
      body: remove,
    });
    expect(res.status).toBe(303);

    page = await app.request(`/campaigns/${campaign.id}/party`, {
      headers: { Cookie: owner.cookie },
    });
    body = await page.text();
    expect(body).not.toContain('Remove Me');
  });

  it('removes retired characters from explicit party row confirmations', async () => {
    const { owner, campaign } = await setupFixture();
    const retired = await CharacterService.createCharacter(
      identityFromSessionUser(owner.userId),
      campaign.id,
      { name: 'Remove Retired', className: 'Banner Spear', xp: 45 },
    );
    const proposal = await import('../src/campaign/pending-mutations.ts').then((mod) =>
      mod.propose(identityFromSessionUser(owner.userId), campaign.id, {
        type: 'character.retire',
        characterId: retired.id,
      }),
    );
    await import('../src/campaign/pending-mutations.ts').then((mod) =>
      mod.confirm(identityFromSessionUser(owner.userId), proposal.id),
    );

    let page = await app.request(`/campaigns/${campaign.id}/party`, {
      headers: { Cookie: owner.cookie },
    });
    let body = await page.text();
    expect(body).toContain('aria-label="Remove Remove Retired" role="button"');

    const remove = new FormData();
    remove.set('_csrf', createCsrfToken(owner.sessionId));
    remove.set('confirm', 'remove');
    const res = await app.request(`/campaigns/${campaign.id}/characters/${retired.id}/remove`, {
      method: 'POST',
      headers: { Cookie: owner.cookie },
      body: remove,
    });
    expect(res.status).toBe(303);

    page = await app.request(`/campaigns/${campaign.id}/party`, {
      headers: { Cookie: owner.cookie },
    });
    body = await page.text();
    expect(body).not.toContain('Remove Retired');
  });

  it('rejects party row actions when the character belongs to another campaign', async () => {
    const { owner, campaign } = await setupFixture();
    const other = await CampaignService.createCampaign(identityFromSessionUser(owner.userId), {
      name: 'Other Roster Campaign',
      game: 'frosthaven',
      modules: [],
    });
    const character = await CharacterService.createCharacter(
      identityFromSessionUser(owner.userId),
      campaign.id,
      { name: 'Wrong Campaign Hero', className: 'Drifter', xp: 45 },
    );

    const retire = new FormData();
    retire.set('_csrf', createCsrfToken(owner.sessionId));
    retire.set('confirm', 'retire');
    let res = await app.request(`/campaigns/${other.id}/characters/${character.id}/retire`, {
      method: 'POST',
      headers: { Cookie: owner.cookie },
      body: retire,
    });
    expect(res.status).toBe(404);

    const remove = new FormData();
    remove.set('_csrf', createCsrfToken(owner.sessionId));
    remove.set('confirm', 'remove');
    res = await app.request(`/campaigns/${other.id}/characters/${character.id}/remove`, {
      method: 'POST',
      headers: { Cookie: owner.cookie },
      body: remove,
    });
    expect(res.status).toBe(404);

    const detail = await CharacterService.getCharacterDetail(
      identityFromSessionUser(owner.userId),
      character.id,
    );
    expect(detail.character.level).toBe(2);
    expect(detail.character.status).toBe('active');
  });

  it('creates a character and shows it in the roster', async () => {
    const { owner, campaign } = await setupFixture();
    const created = await createCharacter(owner, campaign.id, {
      name: 'Vesper',
      className: 'Drifter',
      xp: '95',
    });
    expect(created.status).toBe(303);
    expect(created.headers.get('location')).toBe(`/campaigns/${campaign.id}/party`);

    const dash = await app.request(`/campaigns/${campaign.id}/party`, {
      headers: { Cookie: owner.cookie },
    });
    const body = await dash.text();
    expect(body).toContain('Vesper');
    expect(body).toContain('squire-party-row__name');
    expect(body).toContain('squire-party-row__class');
    expect(body.replace(/\s+/g, ' ')).toContain('Drifter');
    expect(body.replace(/\s+/g, ' ')).toContain('Drifter L3');
    expect(body).toContain('/characters/'); // sheet link
  });

  it('normalizes case to the canonical class name', async () => {
    const { owner, campaign } = await setupFixture();
    const created = await createCharacter(owner, campaign.id, {
      name: 'Casing Hero',
      className: 'banner spear',
      xp: '0',
    });
    expect(created.status).toBe(303);
    const dash = await app.request(`/campaigns/${campaign.id}/party`, {
      headers: { Cookie: owner.cookie },
    });
    const body = (await dash.text()).replace(/\s+/g, ' ');
    expect(body).toContain('Banner Spear');
    expect(body).toContain('Banner Spear L1');
  });

  it('rejects an unknown/codename class with an inline error and no create', async () => {
    const { owner, campaign } = await setupFixture();
    const res = await createCharacter(owner, campaign.id, {
      name: 'Bad Class',
      className: 'Eclipse', // a GH2e codename, not a Frosthaven class
      xp: '0',
    });
    expect(res.status).toBe(422);
    const body = await res.text();
    expect(body).toContain('class="squire-campaign-workspace"');
    expect(body).toMatch(
      new RegExp(`href="/campaigns/${campaign.id}/party"[^>]*aria-current="page"`),
    );
    expect(body).toContain(`href="/campaigns/${campaign.id}/players"`);
    expect(body).toContain(`href="/campaigns/${campaign.id}/settings"`);
    expect(body).toContain('COULD NOT SAVE');
    expect(body).toContain('not a class in this game');
    const revealTag = body.match(
      /<details[^>]*class="squire-party-section__add squire-character-create-reveal"[^>]*>/,
    )?.[0];
    expect(revealTag).toContain('open');

    // Nothing was created — the roster is still empty.
    const dash = await app.request(`/campaigns/${campaign.id}/party`, {
      headers: { Cookie: owner.cookie },
    });
    expect(await dash.text()).toContain('No active characters yet');
  });

  it('requires a name', async () => {
    const { owner, campaign } = await setupFixture();
    const res = await createCharacter(owner, campaign.id, { name: '  ', className: 'Drifter' });
    expect(res.status).toBe(422);
    expect(await res.text()).toContain('Character name is required.');
  });

  it('requires a class (the guard runs before class-name canonicalization)', async () => {
    const { owner, campaign } = await setupFixture();
    // A blank/whitespace class is rejected before checkClassName — which in
    // no-materials mode would otherwise accept anything.
    const res = await createCharacter(owner, campaign.id, { name: 'No Class', className: '   ' });
    expect(res.status).toBe(422);
    expect(await res.text()).toContain('Class is required.');
  });

  it('404s a non-member who tries to create on a campaign they cannot see', async () => {
    const { campaign } = await setupFixture();
    const outsider = await createTestUser(OUTSIDER_EMAIL);
    const res = await createCharacter(outsider, campaign.id, {
      name: 'Intruder',
      className: 'Drifter',
    });
    expect(res.status).toBe(404);
  });
});
