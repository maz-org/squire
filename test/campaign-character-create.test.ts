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
  fields: { name?: string; className?: string; level?: string },
): Promise<Response> {
  const form = new FormData();
  form.set('_csrf', createCsrfToken(user.sessionId));
  if (fields.name !== undefined) form.set('name', fields.name);
  if (fields.className !== undefined) form.set('className', fields.className);
  if (fields.level !== undefined) form.set('level', fields.level);
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
      /<details[^>]*class="squire-section-reveal squire-character-create-reveal"[^>]*>/,
    )?.[0];
    expect(revealTag).toBeDefined();
    expect(revealTag).not.toContain('open');
    expect(body).toContain('squire-section-reveal__summary">Add character</summary>');
    expect(body).toContain('squire-character-create');
    expect(body).toContain('action="/campaigns/' + campaign.id + '/characters"');
    // Class select offers the seeded real class names.
    expect(body).toContain('<option value="Banner Spear">Banner Spear</option>');
    expect(body).toContain('<option value="Drifter">Drifter</option>');
    // Empty roster shows the create call-to-action, never fake values.
    expect(body).toContain('No characters yet');
  });

  it('creates a character and shows it in the roster', async () => {
    const { owner, campaign } = await setupFixture();
    const created = await createCharacter(owner, campaign.id, {
      name: 'Vesper',
      className: 'Drifter',
      level: '3',
    });
    expect(created.status).toBe(303);
    expect(created.headers.get('location')).toBe(`/campaigns/${campaign.id}/party`);

    const dash = await app.request(`/campaigns/${campaign.id}/party`, {
      headers: { Cookie: owner.cookie },
    });
    const body = await dash.text();
    expect(body).toContain('Vesper');
    expect(body).toContain('squire-campaign-dashboard__character-name');
    expect(body).toContain('squire-campaign-dashboard__character-class');
    expect(body).toContain('squire-campaign-dashboard__character-level');
    expect(body.replace(/\s+/g, ' ')).toContain('Drifter');
    expect(body.replace(/\s+/g, ' ')).toContain('Level 3');
    expect(body).toContain('/characters/'); // sheet link
  });

  it('normalizes case to the canonical class name', async () => {
    const { owner, campaign } = await setupFixture();
    const created = await createCharacter(owner, campaign.id, {
      name: 'Casing Hero',
      className: 'banner spear',
      level: '1',
    });
    expect(created.status).toBe(303);
    const dash = await app.request(`/campaigns/${campaign.id}/party`, {
      headers: { Cookie: owner.cookie },
    });
    const body = (await dash.text()).replace(/\s+/g, ' ');
    expect(body).toContain('Banner Spear');
    expect(body).toContain('Level 1');
  });

  it('rejects an unknown/codename class with an inline error and no create', async () => {
    const { owner, campaign } = await setupFixture();
    const res = await createCharacter(owner, campaign.id, {
      name: 'Bad Class',
      className: 'Eclipse', // a GH2e codename, not a Frosthaven class
      level: '1',
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
      /<details[^>]*class="squire-section-reveal squire-character-create-reveal"[^>]*>/,
    )?.[0];
    expect(revealTag).toContain('open');

    // Nothing was created — the roster is still empty.
    const dash = await app.request(`/campaigns/${campaign.id}/party`, {
      headers: { Cookie: owner.cookie },
    });
    expect(await dash.text()).toContain('No characters yet');
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
