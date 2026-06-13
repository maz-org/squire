/**
 * Campaign CRUD + membership API integration tests (SQR-21, ADR 0021).
 *
 * Runs against the real test Postgres (ADR 0007). Covers the SQR-21
 * acceptance criteria: 404-indistinguishability for non-members, allowlist
 * rejection at create/invite/join, optimistic-version conflicts, rate-limit
 * denial, the permission matrix's "no" cells, and both auth channels
 * (session cookie + CSRF, bearer tokens with client-only rejection).
 */
import { generateSignedCookie } from 'hono/cookie';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.SESSION_SECRET = 'test-session-secret-must-be-at-least-32-characters-long';

import { app } from '../src/server.ts';
import { getDb, shutdownServerPool } from '../src/db.ts';
import { createCsrfToken } from '../src/auth/csrf.ts';
import { SESSION_COOKIE_NAME, getSessionSecret } from '../src/auth/session-middleware.ts';
import * as SessionRepository from '../src/db/repositories/session-repository.ts';
import { SESSION_LIFETIME_MS } from '../src/db/repositories/session-repository.ts';
import * as CampaignMemberRepository from '../src/db/repositories/campaign-member-repository.ts';
import { hashSecret } from '../src/security/hashing.ts';
import {
  hashRateLimitIdentity,
  resetRateLimiterForTesting,
  setRateLimiterForTesting,
  type RateLimiter,
  type RateLimitConsumeInput,
  type RateLimitDecision,
} from '../src/rate-limit.ts';
import { users } from '../src/db/schema/core.ts';
import { oauthTokens } from '../src/db/schema/auth.ts';
import { makeAuthHelpers } from './helpers/server-oauth-helpers.ts';
import { resetTestDb, setupTestDb, teardownTestDb } from './helpers/db.ts';

interface TestUser {
  cookie: string;
  sessionId: string;
  userId: string;
  email: string;
}

const OWNER_EMAIL = 'owner@example.com';
const MEMBER_EMAIL = 'member@example.com';
const OUTSIDER_EMAIL = 'outsider@example.com';
const ALL_EMAILS = [OWNER_EMAIL, MEMBER_EMAIL, OUTSIDER_EMAIL].join(',');

const { getTestToken, resetTestToken } = makeAuthHelpers(app);

async function createTestUser(email: string, name = email.split('@')[0]): Promise<TestUser> {
  const { db } = getDb('server');
  const [user] = await db
    .insert(users)
    .values({ email, googleSub: `google-sub-${email}`, name })
    .returning();
  const { sessionId } = await SessionRepository.create(db, { userId: user.id });
  const signedCookie = await generateSignedCookie(
    SESSION_COOKIE_NAME,
    sessionId,
    getSessionSecret(),
    {
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: SESSION_LIFETIME_MS / 1000,
    },
  );
  return { cookie: signedCookie.split(';')[0], sessionId, userId: user.id, email };
}

async function request(
  user: TestUser | null,
  method: string,
  url: string,
  body?: unknown,
): Promise<Response> {
  const headers = new Headers();
  if (user) {
    headers.set('Cookie', user.cookie);
    if (!['GET', 'HEAD'].includes(method)) {
      headers.set('x-csrf-token', createCsrfToken(user.sessionId));
    }
  }
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  return app.request(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function createCampaign(
  user: TestUser,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; version: number }> {
  const res = await request(user, 'POST', '/api/campaigns', {
    name: 'Thursday Night Frosthaven',
    game: 'frosthaven',
    modules: ['fh'],
    ...overrides,
  });
  expect(res.status).toBe(201);
  const { campaign } = (await res.json()) as { campaign: { id: string; version: number } };
  return campaign;
}

/** Destructive mutations need the SQR-279 propose→confirm dance. */
async function proposeAndConfirm(
  user: TestUser,
  campaignId: string,
  mutation: Record<string, unknown>,
): Promise<Response> {
  const proposeRes = await request(user, 'POST', `/api/campaigns/${campaignId}/proposals`, {
    mutation,
  });
  expect(proposeRes.status).toBe(201);
  const { proposal } = (await proposeRes.json()) as { proposal: { id: string } };
  return request(user, 'POST', `/api/proposals/${proposal.id}/confirm`);
}

/** Invite + accept in one step: returns the activated member id. */
async function addMember(owner: TestUser, campaignId: string, member: TestUser): Promise<string> {
  const inviteRes = await request(owner, 'POST', `/api/campaigns/${campaignId}/invites`, {
    email: member.email,
  });
  expect(inviteRes.status).toBe(201);
  const { member: invite } = (await inviteRes.json()) as { member: { memberId: string } };
  const acceptRes = await request(member, 'POST', `/api/invites/${invite.memberId}/accept`);
  expect(acceptRes.status).toBe(200);
  return invite.memberId;
}

beforeAll(async () => {
  await setupTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  resetTestToken();
  process.env.SQUIRE_ALLOWED_EMAILS = ALL_EMAILS;
});

afterEach(() => {
  resetRateLimiterForTesting();
});

afterAll(async () => {
  delete process.env.SQUIRE_ALLOWED_EMAILS;
  await teardownTestDb();
  await shutdownServerPool();
});

describe('campaign API auth channels', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(null, 'GET', '/api/campaigns');
    expect(res.status).toBe(401);
  });

  it('rejects session writes without the CSRF header', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const headers = new Headers({ Cookie: owner.cookie, 'Content-Type': 'application/json' });
    const res = await app.request('/api/campaigns', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'No CSRF', game: 'frosthaven' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects client-credentials bearer tokens structurally (no user identity)', async () => {
    const token = await getTestToken();
    const res = await app.request('/api/campaigns', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('user_identity_required');
  });

  it('accepts a user-bound bearer token', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const campaign = await createCampaign(owner);

    // Bind a fresh token to the owner the way the provider stores them: the
    // DB holds only the SHA-256 hash of the raw token. getTestToken()
    // registers an OAuth client whose id the user-bound row reuses.
    await getTestToken();
    const { db } = getDb('server');
    const [{ clientId }] = await db
      .select({ clientId: oauthTokens.clientId })
      .from(oauthTokens)
      .limit(1);
    const rawToken = 'user-bound-test-token';
    await db.insert(oauthTokens).values({
      tokenHash: hashSecret(rawToken),
      clientId,
      userId: owner.userId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const res = await app.request(`/api/campaigns/${campaign.id}`, {
      headers: { Authorization: `Bearer ${rawToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { campaign: { id: string } };
    expect(body.campaign.id).toBe(campaign.id);
  });

  it('denies requests over the rate limit with 429', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const counts = new Map<string, number>();
    const limiter = {
      async consume(input: RateLimitConsumeInput): Promise<RateLimitDecision> {
        const used = (counts.get(input.identity) ?? 0) + 1;
        counts.set(input.identity, used);
        return {
          allowed: used <= 1,
          policy: input.policy,
          identityHash: hashRateLimitIdentity(input.identity, 'campaign-rate-limit-test'),
          remaining: 0,
          retryAfterSeconds: used <= 1 ? 0 : 30,
          resetAfterSeconds: 30,
        };
      },
    };
    setRateLimiterForTesting(limiter as unknown as RateLimiter);

    const first = await request(owner, 'GET', '/api/campaigns');
    expect(first.status).toBe(200);
    const second = await request(owner, 'GET', '/api/campaigns');
    expect(second.status).toBe(429);
    expect(second.headers.get('Retry-After')).toBe('30');
  });
});

describe('campaign lifecycle', () => {
  it('creates a campaign with the creator as owner and lists it', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const res = await request(owner, 'POST', '/api/campaigns', {
      name: 'GH2e Tuesday',
      game: 'gh2e', // alias normalizes to canonical id
      modules: ['gh2e', 'solo2e'],
    });
    expect(res.status).toBe(201);
    const { campaign } = (await res.json()) as {
      campaign: { id: string; game: string; version: number };
    };
    expect(campaign.game).toBe('gloomhaven-2e');
    expect(campaign.version).toBe(1);

    const listRes = await request(owner, 'GET', '/api/campaigns');
    const { campaigns } = (await listRes.json()) as { campaigns: Array<{ id: string }> };
    expect(campaigns.map((c) => c.id)).toEqual([campaign.id]);

    const detailRes = await request(owner, 'GET', `/api/campaigns/${campaign.id}`);
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as {
      members: Array<{ role: string; email: string; status: string }>;
      self: { role: string };
    };
    expect(detail.self.role).toBe('owner');
    expect(detail.members).toEqual([
      expect.objectContaining({ role: 'owner', email: OWNER_EMAIL, status: 'active' }),
    ]);
  });

  it('rejects campaign creation for non-allowlisted creators', async () => {
    process.env.SQUIRE_ALLOWED_EMAILS = 'someone-else@example.com';
    const owner = await createTestUser(OWNER_EMAIL);
    const res = await request(owner, 'POST', '/api/campaigns', {
      name: 'Nope',
      game: 'frosthaven',
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('not_allowlisted');
  });

  it('rejects unsupported games', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const res = await request(owner, 'POST', '/api/campaigns', {
      name: 'Wrong game',
      game: 'monopoly',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('unsupported_game');
  });

  it('deletes a campaign (owner only)', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const member = await createTestUser(MEMBER_EMAIL);
    const campaign = await createCampaign(owner);
    await addMember(owner, campaign.id, member);

    const memberDelete = await request(member, 'DELETE', `/api/campaigns/${campaign.id}`);
    expect(memberDelete.status).toBe(403);

    // One-shot delete is impossible at the service layer (SQR-279) — even
    // for the owner — and the proposal dance succeeds.
    const oneShot = await request(owner, 'DELETE', `/api/campaigns/${campaign.id}`);
    expect(oneShot.status).toBe(409);
    expect(((await oneShot.json()) as { error: string }).error).toBe('proposal_required');

    const confirmed = await proposeAndConfirm(owner, campaign.id, { type: 'campaign.delete' });
    expect(confirmed.status).toBe(200);

    const after = await request(owner, 'GET', `/api/campaigns/${campaign.id}`);
    expect(after.status).toBe(404);
  });
});

describe('404 indistinguishability (ADR 0021)', () => {
  it('non-members, invitees, malformed ids, and absent ids are identical', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const outsider = await createTestUser(OUTSIDER_EMAIL);
    const campaign = await createCampaign(owner);

    const absent = await request(
      outsider,
      'GET',
      '/api/campaigns/00000000-0000-4000-8000-000000000000',
    );
    const nonMember = await request(outsider, 'GET', `/api/campaigns/${campaign.id}`);
    const malformed = await request(outsider, 'GET', '/api/campaigns/not-a-uuid');

    expect(nonMember.status).toBe(404);
    expect(await nonMember.json()).toEqual(await absent.json());
    expect(malformed.status).toBe(404);

    // An invited-but-not-joined user gets the same 404 on campaign routes;
    // their only visibility is their own invite list (the carve-out).
    await request(owner, 'POST', `/api/campaigns/${campaign.id}/invites`, {
      email: OUTSIDER_EMAIL,
    });
    const invited = await request(outsider, 'GET', `/api/campaigns/${campaign.id}`);
    expect(invited.status).toBe(404);

    // Mutations are indistinguishable too.
    const patch = await request(outsider, 'PATCH', `/api/campaigns/${campaign.id}`, {
      expectedVersion: 0,
      prosperity: 5,
    });
    expect(patch.status).toBe(404);
    const del = await request(outsider, 'DELETE', `/api/campaigns/${campaign.id}`);
    expect(del.status).toBe(404);
  });
});

describe('shared-state writes (optimistic CAS, E3)', () => {
  it('applies member edits and bumps the version', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const member = await createTestUser(MEMBER_EMAIL);
    const campaign = await createCampaign(owner);
    await addMember(owner, campaign.id, member);

    const res = await request(member, 'PATCH', `/api/campaigns/${campaign.id}`, {
      expectedVersion: 1,
      playedScenarios: ['fh:1'],
      prosperity: 2,
    });
    expect(res.status).toBe(200);
    const { campaign: updated } = (await res.json()) as {
      campaign: { version: number; playedScenarios: string[]; prosperity: number };
    };
    expect(updated.version).toBe(2);
    expect(updated.playedScenarios).toEqual(['fh:1']);
    expect(updated.prosperity).toBe(2);
  });

  it('returns 409 with the current state on version conflict', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const campaign = await createCampaign(owner);

    const first = await request(owner, 'PATCH', `/api/campaigns/${campaign.id}`, {
      expectedVersion: 1,
      prosperity: 1,
    });
    expect(first.status).toBe(200);

    const stale = await request(owner, 'PATCH', `/api/campaigns/${campaign.id}`, {
      expectedVersion: 1,
      prosperity: 9,
    });
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as {
      error: string;
      currentVersion: number;
      campaign: { prosperity: number };
    };
    expect(body.error).toBe('version_conflict');
    expect(body.currentVersion).toBe(2);
    expect(body.campaign.prosperity).toBe(1);
  });
});

describe('invites and joining', () => {
  it('owner invites an allowlisted email; invitee sees and accepts it', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const member = await createTestUser(MEMBER_EMAIL);
    const campaign = await createCampaign(owner);

    const inviteRes = await request(owner, 'POST', `/api/campaigns/${campaign.id}/invites`, {
      email: MEMBER_EMAIL.toUpperCase(), // normalized at the boundary
    });
    expect(inviteRes.status).toBe(201);

    const listRes = await request(member, 'GET', '/api/invites');
    const { invites } = (await listRes.json()) as {
      invites: Array<{
        memberId: string;
        campaignName: string;
        game: string;
        inviterName: string | null;
      }>;
    };
    expect(invites).toEqual([
      {
        memberId: expect.any(String),
        campaignName: 'Thursday Night Frosthaven',
        game: 'frosthaven',
        inviterName: 'owner',
      },
    ]);

    const acceptRes = await request(member, 'POST', `/api/invites/${invites[0].memberId}/accept`);
    expect(acceptRes.status).toBe(200);

    const detail = await request(member, 'GET', `/api/campaigns/${campaign.id}`);
    expect(detail.status).toBe(200);
    const { self } = (await detail.json()) as { self: { role: string } };
    expect(self.role).toBe('member');
  });

  it('rejects invites for non-allowlisted emails', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const campaign = await createCampaign(owner);
    const res = await request(owner, 'POST', `/api/campaigns/${campaign.id}/invites`, {
      email: 'stranger@example.com',
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('not_allowlisted');
  });

  it('re-checks the allowlist at join time (lapsed entry blocks the join)', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const member = await createTestUser(MEMBER_EMAIL);
    const campaign = await createCampaign(owner);
    const inviteRes = await request(owner, 'POST', `/api/campaigns/${campaign.id}/invites`, {
      email: MEMBER_EMAIL,
    });
    const { member: invite } = (await inviteRes.json()) as { member: { memberId: string } };

    process.env.SQUIRE_ALLOWED_EMAILS = OWNER_EMAIL; // member's entry lapses
    const acceptRes = await request(member, 'POST', `/api/invites/${invite.memberId}/accept`);
    expect(acceptRes.status).toBe(403);
    expect(((await acceptRes.json()) as { error: string }).error).toBe('not_allowlisted');
  });

  it('only the owner can invite; duplicates conflict; foreign invites are 404', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const member = await createTestUser(MEMBER_EMAIL);
    const campaign = await createCampaign(owner);
    await addMember(owner, campaign.id, member);

    const memberInvite = await request(member, 'POST', `/api/campaigns/${campaign.id}/invites`, {
      email: OUTSIDER_EMAIL,
    });
    expect(memberInvite.status).toBe(403);

    const duplicate = await request(owner, 'POST', `/api/campaigns/${campaign.id}/invites`, {
      email: MEMBER_EMAIL,
    });
    expect(duplicate.status).toBe(409);

    // Accepting an invite addressed to someone else is indistinguishable
    // from a nonexistent invite id.
    const inviteRes = await request(owner, 'POST', `/api/campaigns/${campaign.id}/invites`, {
      email: OUTSIDER_EMAIL,
    });
    const { member: invite } = (await inviteRes.json()) as { member: { memberId: string } };
    const theft = await request(member, 'POST', `/api/invites/${invite.memberId}/accept`);
    expect(theft.status).toBe(404);
  });
});

describe('leave, remove, rejoin', () => {
  it('a member can leave; the owner cannot', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const member = await createTestUser(MEMBER_EMAIL);
    const campaign = await createCampaign(owner);
    await addMember(owner, campaign.id, member);

    const ownerLeave = await request(owner, 'POST', `/api/campaigns/${campaign.id}/leave`);
    expect(ownerLeave.status).toBe(409);
    expect(((await ownerLeave.json()) as { error: string }).error).toBe('owner_cannot_leave');

    const memberLeave = await request(member, 'POST', `/api/campaigns/${campaign.id}/leave`);
    expect(memberLeave.status).toBe(204);

    // Departed members lose access — same 404 as a non-member.
    const after = await request(member, 'GET', `/api/campaigns/${campaign.id}`);
    expect(after.status).toBe(404);
  });

  it('the sole member (the owner) cannot leave — directed to delete', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const campaign = await createCampaign(owner);
    const res = await request(owner, 'POST', `/api/campaigns/${campaign.id}/leave`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('owner_cannot_leave');
  });

  it('owner removes a member; members cannot remove anyone', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const member = await createTestUser(MEMBER_EMAIL);
    const outsider = await createTestUser(OUTSIDER_EMAIL);
    const campaign = await createCampaign(owner);
    const memberId = await addMember(owner, campaign.id, member);
    const outsiderMemberId = await addMember(owner, campaign.id, outsider);

    const memberRemove = await request(
      member,
      'DELETE',
      `/api/campaigns/${campaign.id}/members/${outsiderMemberId}`,
    );
    expect(memberRemove.status).toBe(403);

    const oneShotRemove = await request(
      owner,
      'DELETE',
      `/api/campaigns/${campaign.id}/members/${memberId}`,
    );
    expect(oneShotRemove.status).toBe(409);

    const ownerRemove = await proposeAndConfirm(owner, campaign.id, {
      type: 'member.remove',
      memberId,
    });
    expect(ownerRemove.status).toBe(200);

    const after = await request(member, 'GET', `/api/campaigns/${campaign.id}`);
    expect(after.status).toBe(404);
  });

  it('re-inviting a departed member reactivates their row on accept (rejoin)', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const member = await createTestUser(MEMBER_EMAIL);
    const campaign = await createCampaign(owner);
    const originalMemberId = await addMember(owner, campaign.id, member);
    await request(member, 'POST', `/api/campaigns/${campaign.id}/leave`);

    const reinvite = await request(owner, 'POST', `/api/campaigns/${campaign.id}/invites`, {
      email: MEMBER_EMAIL,
    });
    expect(reinvite.status).toBe(201);
    const { member: revived } = (await reinvite.json()) as { member: { memberId: string } };
    expect(revived.memberId).toBe(originalMemberId); // same row, user binding kept

    const accept = await request(member, 'POST', `/api/invites/${revived.memberId}/accept`);
    expect(accept.status).toBe(200);

    const active = await CampaignMemberRepository.findActiveMember(campaign.id, member.userId);
    expect(active?.id).toBe(originalMemberId);
  });
});
