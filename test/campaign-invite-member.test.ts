/**
 * Invite-a-member web UI tests (SQR-319).
 *
 * The dashboard Party section carries an owner-only "Invite member" form.
 * Posting it creates a pending invite (shown distinctly in the roster);
 * non-owners never see the form and the route rejects them; invalid /
 * not-allowlisted / duplicate emails surface inline; a non-member gets the
 * indistinguishable 404.
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
const INVITEE_EMAIL = 'invitee@example.com';
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
    name: 'Party Campaign',
    game: 'frosthaven',
    modules: [],
  });
  return { owner, campaign };
}

/** Invite + accept so `email` is an active non-owner member. */
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

async function invite(user: TestUser, campaignId: string, email: string): Promise<Response> {
  const form = new FormData();
  form.set('_csrf', createCsrfToken(user.sessionId));
  form.set('email', email);
  return app.request(`/campaigns/${campaignId}/invites`, {
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
  process.env.SQUIRE_ALLOWED_EMAILS = [OWNER_EMAIL, MEMBER_EMAIL, INVITEE_EMAIL].join(',');
});

afterAll(async () => {
  delete process.env.SQUIRE_ALLOWED_EMAILS;
  await teardownTestDb();
  await shutdownServerPool();
});

describe('invite-member UI (SQR-319)', () => {
  it('shows the invite form to the owner but hides it from a non-owner member', async () => {
    const { owner, campaign } = await setupFixture();
    const member = await addActiveMember(owner, campaign.id, MEMBER_EMAIL);

    const ownerView = await (
      await app.request(`/campaigns/${campaign.id}`, { headers: { Cookie: owner.cookie } })
    ).text();
    expect(ownerView).toContain('squire-invite-member');
    expect(ownerView).toContain('INVITE BY EMAIL');

    const memberView = await (
      await app.request(`/campaigns/${campaign.id}`, { headers: { Cookie: member.cookie } })
    ).text();
    expect(memberView).not.toContain('squire-invite-member');
  });

  it('lets the owner invite a member, shown as INVITED in the roster', async () => {
    const { owner, campaign } = await setupFixture();
    const res = await invite(owner, campaign.id, INVITEE_EMAIL);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/campaigns/${campaign.id}`);

    const dash = await (
      await app.request(`/campaigns/${campaign.id}`, { headers: { Cookie: owner.cookie } })
    ).text();
    expect(dash).toContain(INVITEE_EMAIL);
    expect(dash).toContain('INVITED');
    expect(dash).toContain('squire-campaign-dashboard__member--invited');
  });

  it('rejects an invalid email with an inline error', async () => {
    const { owner, campaign } = await setupFixture();
    const res = await invite(owner, campaign.id, 'not-an-email');
    expect(res.status).toBe(422);
    const body = await res.text();
    expect(body).toContain('COULD NOT SAVE');
    expect(body).toContain('Enter a valid email address.');
  });

  it('rejects an email that is not on the allowlist', async () => {
    const { owner, campaign } = await setupFixture();
    const res = await invite(owner, campaign.id, 'stranger@nowhere.test');
    expect(res.status).toBe(422);
    expect(await res.text()).toContain('not on the invite allowlist');
  });

  it('rejects a duplicate invite', async () => {
    const { owner, campaign } = await setupFixture();
    await invite(owner, campaign.id, INVITEE_EMAIL);
    const dup = await invite(owner, campaign.id, INVITEE_EMAIL);
    expect(dup.status).toBe(422);
    expect(await dup.text()).toContain('Already invited');
  });

  it('rejects a non-owner member who posts the invite route', async () => {
    const { owner, campaign } = await setupFixture();
    const member = await addActiveMember(owner, campaign.id, MEMBER_EMAIL);
    const res = await invite(member, campaign.id, INVITEE_EMAIL);
    expect(res.status).toBe(422);
    expect(await res.text()).toContain('Only the owner can invite members');
  });

  it('authorizes before validating: a non-owner with a bad email still gets the owner rejection', async () => {
    const { owner, campaign } = await setupFixture();
    const member = await addActiveMember(owner, campaign.id, MEMBER_EMAIL);
    const res = await invite(member, campaign.id, 'not-an-email');
    expect(res.status).toBe(422);
    const body = await res.text();
    expect(body).toContain('Only the owner can invite members');
    expect(body).not.toContain('Enter a valid email address.');
  });

  it('404s a non-member who posts the invite route', async () => {
    const { campaign } = await setupFixture();
    const outsider = await createTestUser(OUTSIDER_EMAIL);
    const res = await invite(outsider, campaign.id, INVITEE_EMAIL);
    expect(res.status).toBe(404);
  });
});
