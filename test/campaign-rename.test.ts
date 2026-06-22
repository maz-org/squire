/**
 * Rename-a-campaign web UI tests (SQR-320).
 *
 * A quiet rename disclosure in the Settings view. The campaign name is shared
 * state, so any active member may rename (matching updateSharedState's
 * authorization and the scenario-toggle control) — not owner-gated. Renaming
 * updates the workspace title while the global header remains generic; empty/over-long names and
 * stale version tokens surface inline; a non-member gets the 404.
 */
import { generateSignedCookie } from 'hono/cookie';
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
import { resetTestDb, setupTestDb, teardownTestDb } from './helpers/db.ts';

interface TestUser {
  cookie: string;
  sessionId: string;
  userId: string;
}

const OWNER_EMAIL = 'owner@example.com';
const MEMBER_EMAIL = 'member@example.com';
const OUTSIDER_EMAIL = 'outsider@example.com';

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

async function setupFixture() {
  const owner = await createTestUser(OWNER_EMAIL);
  const campaign = await CampaignService.createCampaign(identityFromSessionUser(owner.userId), {
    name: 'Original Name',
    game: 'frosthaven',
    modules: [],
  });
  return { owner, campaign };
}

async function addActiveMember(
  owner: TestUser,
  campaignId: string,
  email: string,
): Promise<TestUser> {
  const invite = await CampaignService.inviteMember(
    identityFromSessionUser(owner.userId),
    campaignId,
    email,
  );
  const user = await createTestUser(email);
  await CampaignService.acceptInvite(identityFromSessionUser(user.userId), invite.memberId);
  return user;
}

async function rename(
  user: TestUser,
  campaignId: string,
  name: string,
  expectedVersion: number | string,
): Promise<Response> {
  const form = new FormData();
  form.set('_csrf', createCsrfToken(user.sessionId));
  form.set('name', name);
  form.set('expectedVersion', String(expectedVersion));
  return app.request(`/campaigns/${campaignId}/rename`, {
    method: 'POST',
    headers: { Cookie: user.cookie, 'HX-Request': 'true' },
    body: form,
  });
}

beforeAll(async () => {
  await setupTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  process.env.SQUIRE_ALLOWED_EMAILS = [OWNER_EMAIL, MEMBER_EMAIL].join(',');
});

afterAll(async () => {
  delete process.env.SQUIRE_ALLOWED_EMAILS;
  await teardownTestDb();
  await shutdownServerPool();
});

describe('rename-campaign UI (SQR-320)', () => {
  it('renders the campaign-name settings form', async () => {
    const { owner, campaign } = await setupFixture();
    const body = await (
      await app.request(`/campaigns/${campaign.id}/settings`, {
        headers: { Cookie: owner.cookie },
      })
    ).text();
    expect(body).toContain('action="/campaigns/' + campaign.id + '/rename"');
    expect(body).toContain('Campaign name');
    // The current name pre-fills the input.
    expect(body).toContain('value="Original Name"');
  });

  it('renders campaign naming as an explicit Settings field, not a loose Rename control', async () => {
    const { owner, campaign } = await setupFixture();
    const body = await (
      await app.request(`/campaigns/${campaign.id}/settings`, {
        headers: { Cookie: owner.cookie },
      })
    ).text();

    expect(body).toMatch(
      /<label class="sr-only" for="squire-campaign-name-[^"]+">\s*Campaign name\s*<\/label>/,
    );
    expect(body).toContain('squire-campaign-settings__group-body');
    expect(body).toContain('squire-campaign-settings__form--name');
    expect(body).toContain('squire-campaign-settings__field--with-action');
    expect(body).toContain('aria-label="Save campaign name"');
    expect(body).toMatch(/>\s*Save\s*<\/button>/);
    expect(body).not.toMatch(/>\s*Save campaign name\s*<\/button>/);
    expect(body).not.toContain('squire-campaign-rename__toggle">Rename</summary>');
  });

  it('renames the campaign and updates the workspace title without changing the global header', async () => {
    const { owner, campaign } = await setupFixture();
    const res = await rename(owner, campaign.id, 'Renamed Quest', campaign.version);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/campaigns/${campaign.id}/settings`);

    const body = await (
      await app.request(`/campaigns/${campaign.id}`, { headers: { Cookie: owner.cookie } })
    ).text();
    expect(body).toContain('>Renamed Quest</h1>');
    const globalHeader = body.match(/<header class="squire-header">[\s\S]*?<\/header>/)?.[0] ?? '';
    expect(globalHeader).not.toContain('Renamed Quest');
    expect(body).not.toContain('>Original Name</h1>');
  });

  it('lets any active member rename (name is shared state, not owner-gated)', async () => {
    const { owner, campaign } = await setupFixture();
    const member = await addActiveMember(owner, campaign.id, MEMBER_EMAIL);
    const res = await rename(member, campaign.id, 'Member Renamed', campaign.version);
    expect(res.status).toBe(303);
    const body = await (
      await app.request(`/campaigns/${campaign.id}`, { headers: { Cookie: member.cookie } })
    ).text();
    expect(body).toContain('>Member Renamed</h1>');
  });

  it('rejects an empty name with an inline error', async () => {
    const { owner, campaign } = await setupFixture();
    const res = await rename(owner, campaign.id, '   ', campaign.version);
    expect(res.status).toBe(422);
    const body = await res.text();
    expect(body).toContain('COULD NOT SAVE');
    expect(body).toContain('Campaign name is required.');
  });

  it('rejects an over-long name', async () => {
    const { owner, campaign } = await setupFixture();
    const res = await rename(owner, campaign.id, 'x'.repeat(201), campaign.version);
    expect(res.status).toBe(422);
    expect(await res.text()).toContain('200 characters or fewer');
  });

  it('keeps the edited campaign name visible after a failed save', async () => {
    const { owner, campaign } = await setupFixture();
    const edited = 'x'.repeat(201);
    const res = await rename(owner, campaign.id, edited, campaign.version);

    expect(res.status).toBe(422);
    const body = await res.text();
    expect(body).toContain('Campaign name must be 200 characters or fewer.');
    expect(body).toContain(`value="${edited}"`);
    expect(body).not.toContain('value="Original Name"');
  });

  it('surfaces a version conflict (stale expectedVersion)', async () => {
    const { owner, campaign } = await setupFixture();
    // First rename succeeds and bumps the version.
    await rename(owner, campaign.id, 'First', campaign.version);
    // Second rename reuses the now-stale original version.
    const conflict = await rename(owner, campaign.id, 'Second', campaign.version);
    expect(conflict.status).toBe(422);
    const body = await conflict.text();
    expect(body).toContain('Updated elsewhere — review your change and try again.');
    expect(body).toContain('value="Second"');
  });

  it('rejects a malformed version token instead of parsing it leniently', async () => {
    const { owner, campaign } = await setupFixture();
    // "7abc" must not parse to 7 (Number.parseInt would); strict /^\d+$/ rejects.
    const res = await rename(owner, campaign.id, 'New Name', '7abc');
    expect(res.status).toBe(422);
    expect(await res.text()).toContain('Could not save');
  });

  it('404s a non-member who posts the rename route', async () => {
    const { campaign } = await setupFixture();
    const outsider = await createTestUser(OUTSIDER_EMAIL);
    const res = await rename(outsider, campaign.id, 'Hijack', campaign.version);
    expect(res.status).toBe(404);
  });
});
