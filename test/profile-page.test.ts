/**
 * User profile page (SQR-40): identity facts from the user row, membership
 * list reflecting real campaign_members rows with roles.
 */
import { generateSignedCookie } from 'hono/cookie';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.SESSION_SECRET = 'test-session-secret-must-be-at-least-32-characters-long';

import { app } from '../src/server.ts';
import { getDb, shutdownServerPool } from '../src/db.ts';
import { SESSION_COOKIE_NAME, getSessionSecret } from '../src/auth/session-middleware.ts';
import * as SessionRepository from '../src/db/repositories/session-repository.ts';
import { SESSION_LIFETIME_MS } from '../src/db/repositories/session-repository.ts';
import * as CampaignService from '../src/campaign/campaign-service.ts';
import { identityFromSessionUser } from '../src/campaign/identity.ts';
import { users } from '../src/db/schema/core.ts';
import { resetTestDb, setupTestDb, teardownTestDb } from './helpers/db.ts';

const OWNER_EMAIL = 'owner@example.com';
const MEMBER_EMAIL = 'member@example.com';

async function createTestUser(email: string) {
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
  return { cookie: signedCookie.split(';')[0], userId: user.id };
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

describe('GET /profile', () => {
  it('shows identity facts and the real membership rows with roles', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const member = await createTestUser(MEMBER_EMAIL);
    const ownerIdentity = identityFromSessionUser(owner.userId);
    const owned = await CampaignService.createCampaign(ownerIdentity, {
      name: 'Owned Campaign',
      game: 'frosthaven',
    });
    const invite = await CampaignService.inviteMember(ownerIdentity, owned.id, MEMBER_EMAIL);
    await CampaignService.acceptInvite(identityFromSessionUser(member.userId), invite.memberId);

    const ownerView = await app.request('/profile', { headers: { Cookie: owner.cookie } });
    expect(ownerView.status).toBe(200);
    const ownerBody = await ownerView.text();
    expect(ownerBody).toContain(OWNER_EMAIL);
    expect(ownerBody).toContain('Owned Campaign');
    expect(ownerBody).toContain('OWNER');
    expect(ownerBody).toContain(`href="/campaigns/${owned.id}"`);

    const memberView = await app.request('/profile', { headers: { Cookie: member.cookie } });
    const memberBody = await memberView.text();
    expect(memberBody).toContain(MEMBER_EMAIL);
    expect(memberBody).toContain('Owned Campaign');
    expect(memberBody).toContain('MEMBER');
  });

  it('renders the no-campaign empty state without pretending', async () => {
    const lonely = await createTestUser(OWNER_EMAIL);
    const res = await app.request('/profile', { headers: { Cookie: lonely.cookie } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('No campaigns yet');
    expect(body).not.toContain('squire-profile__row');
  });

  it('redirects anonymous visitors to login', async () => {
    const res = await app.request('/profile');
    expect([302, 303]).toContain(res.status);
  });
});
