/**
 * Character CRUD API integration tests (SQR-22, ADR 0021).
 *
 * Covers the SQR-22 acceptance criteria against real Postgres: owner CRUD
 * paths, non-owner reads showing public fields only (private tier absent at
 * the API boundary, never nulled), non-owner mutations denied, the
 * placeholder claim flow, and multi-character members.
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
import { users } from '../src/db/schema/core.ts';
import { resetTestDb, setupTestDb, teardownTestDb } from './helpers/db.ts';

interface TestUser {
  cookie: string;
  sessionId: string;
  userId: string;
  email: string;
}

const OWNER_EMAIL = 'owner@example.com';
const MEMBER_EMAIL = 'member@example.com';
const INVITEE_EMAIL = 'invitee@example.com';
const ALL_EMAILS = [OWNER_EMAIL, MEMBER_EMAIL, INVITEE_EMAIL].join(',');

const PRIVATE_FIELDS = ['personalQuest', 'battleGoals', 'privateNotes'] as const;

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
  return { cookie: signedCookie.split(';')[0], sessionId, userId: user.id, email };
}

async function request(
  user: TestUser,
  method: string,
  url: string,
  body?: unknown,
): Promise<Response> {
  const headers = new Headers({ Cookie: user.cookie });
  if (!['GET', 'HEAD'].includes(method)) {
    headers.set('x-csrf-token', createCsrfToken(user.sessionId));
  }
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  return app.request(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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

/** Owner + member in one campaign; the third user stays an outsider. */
async function setupCampaign(): Promise<{
  owner: TestUser;
  member: TestUser;
  campaignId: string;
}> {
  const owner = await createTestUser(OWNER_EMAIL);
  const member = await createTestUser(MEMBER_EMAIL);
  const createRes = await request(owner, 'POST', '/api/campaigns', {
    name: 'Character Test Campaign',
    game: 'frosthaven',
    modules: ['fh'],
  });
  expect(createRes.status).toBe(201);
  const { campaign } = (await createRes.json()) as { campaign: { id: string } };
  const inviteRes = await request(owner, 'POST', `/api/campaigns/${campaign.id}/invites`, {
    email: MEMBER_EMAIL,
  });
  expect(inviteRes.status).toBe(201);
  const { member: invite } = (await inviteRes.json()) as { member: { memberId: string } };
  const acceptRes = await request(member, 'POST', `/api/invites/${invite.memberId}/accept`);
  expect(acceptRes.status).toBe(200);
  return { owner, member, campaignId: campaign.id };
}

async function createCharacter(
  user: TestUser,
  campaignId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; version: number }> {
  const res = await request(user, 'POST', `/api/campaigns/${campaignId}/characters`, {
    name: 'Snowdancer',
    className: 'Drifter',
    level: 3,
    personalQuest: 'Retire honorably',
    privateNotes: 'Hoarding gold for item 42',
    ...overrides,
  });
  expect(res.status).toBe(201);
  const { character } = (await res.json()) as { character: { id: string; version: number } };
  return character;
}

beforeAll(async () => {
  await setupTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  process.env.SQUIRE_ALLOWED_EMAILS = ALL_EMAILS;
});

afterAll(async () => {
  delete process.env.SQUIRE_ALLOWED_EMAILS;
  await teardownTestDb();
  await shutdownServerPool();
});

describe('owner character CRUD', () => {
  it('creates, reads (with private tier), updates, and deletes own characters', async () => {
    const { owner, campaignId } = await setupCampaign();
    const character = await createCharacter(owner, campaignId);

    const detailRes = await request(owner, 'GET', `/api/characters/${character.id}`);
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as {
      character: Record<string, unknown>;
      own: boolean;
    };
    expect(detail.own).toBe(true);
    expect(detail.character.personalQuest).toBe('Retire honorably');
    expect(detail.character.privateNotes).toBe('Hoarding gold for item 42');

    const patchRes = await request(owner, 'PATCH', `/api/characters/${character.id}`, {
      expectedVersion: character.version,
      level: 4,
      xp: 150,
      perks: [1, 3],
    });
    expect(patchRes.status).toBe(200);
    const { character: updated } = (await patchRes.json()) as {
      character: { level: number; version: number; perks: number[] };
    };
    expect(updated.level).toBe(4);
    expect(updated.perks).toEqual([1, 3]);
    expect(updated.version).toBe(character.version + 1);

    const staleRes = await request(owner, 'PATCH', `/api/characters/${character.id}`, {
      expectedVersion: character.version,
      gold: 99,
    });
    expect(staleRes.status).toBe(409);
    const conflict = (await staleRes.json()) as { error: string; currentVersion: number };
    expect(conflict.error).toBe('version_conflict');
    expect(conflict.currentVersion).toBe(updated.version);

    // One-shot character delete is impossible (SQR-279); the proposal
    // dance executes it.
    const oneShot = await request(owner, 'DELETE', `/api/characters/${character.id}`);
    expect(oneShot.status).toBe(409);
    const deleteRes = await proposeAndConfirm(owner, campaignId, {
      type: 'character.delete',
      characterId: character.id,
    });
    expect(deleteRes.status).toBe(200);
    const goneRes = await request(owner, 'GET', `/api/characters/${character.id}`);
    expect(goneRes.status).toBe(404);
  });

  it('supports multiple characters per member', async () => {
    const { owner, member, campaignId } = await setupCampaign();
    await createCharacter(member, campaignId, { name: 'First' });
    await createCharacter(member, campaignId, { name: 'Second', className: 'Banner Spear' });
    await createCharacter(owner, campaignId, { name: 'Owners' });

    const listRes = await request(member, 'GET', `/api/campaigns/${campaignId}/characters`);
    expect(listRes.status).toBe(200);
    const { characters } = (await listRes.json()) as {
      characters: Array<Record<string, unknown>>;
    };
    expect(characters.map((ch) => ch.name).sort()).toEqual(['First', 'Owners', 'Second']);
  });
});

describe('visibility enforcement (private tier, ADR 0021)', () => {
  it('non-owner reads omit private keys entirely — list and detail', async () => {
    const { owner, member, campaignId } = await setupCampaign();
    const character = await createCharacter(owner, campaignId);

    const detailRes = await request(member, 'GET', `/api/characters/${character.id}`);
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as {
      character: Record<string, unknown>;
      own: boolean;
    };
    expect(detail.own).toBe(false);
    expect(detail.character.name).toBe('Snowdancer');
    expect(detail.character.level).toBe(3);
    for (const field of PRIVATE_FIELDS) {
      expect(detail.character, `${field} must not serialize to non-owners`).not.toHaveProperty(
        field,
      );
    }

    const listRes = await request(member, 'GET', `/api/campaigns/${campaignId}/characters`);
    const { characters } = (await listRes.json()) as {
      characters: Array<Record<string, unknown>>;
    };
    for (const ch of characters) {
      for (const field of PRIVATE_FIELDS) {
        expect(ch, `${field} must not serialize in roster lists`).not.toHaveProperty(field);
      }
    }
  });

  it('denies non-owner mutations and hides characters from non-members', async () => {
    const { owner, member, campaignId } = await setupCampaign();
    const outsider = await createTestUser(INVITEE_EMAIL);
    const character = await createCharacter(owner, campaignId);

    const memberPatch = await request(member, 'PATCH', `/api/characters/${character.id}`, {
      expectedVersion: 1,
      gold: 1000,
    });
    expect(memberPatch.status).toBe(403);

    const memberDelete = await request(member, 'DELETE', `/api/characters/${character.id}`);
    expect(memberDelete.status).toBe(403);

    const memberItem = await request(member, 'POST', `/api/characters/${character.id}/items`, {
      sourceId: 'fh-item-001',
    });
    expect(memberItem.status).toBe(403);

    // Non-members get the indistinguishable 404 on reads AND writes.
    const outsiderRead = await request(outsider, 'GET', `/api/characters/${character.id}`);
    expect(outsiderRead.status).toBe(404);
    const outsiderPatch = await request(outsider, 'PATCH', `/api/characters/${character.id}`, {
      expectedVersion: 1,
      gold: 1000,
    });
    expect(outsiderPatch.status).toBe(404);
  });
});

describe('placeholder characters', () => {
  it('owner creates a placeholder for an invitee who later claims it', async () => {
    const { owner, campaignId } = await setupCampaign();
    const invitee = await createTestUser(INVITEE_EMAIL);

    const inviteRes = await request(owner, 'POST', `/api/campaigns/${campaignId}/invites`, {
      email: INVITEE_EMAIL,
    });
    const { member: invite } = (await inviteRes.json()) as { member: { memberId: string } };

    const placeholder = await createCharacter(owner, campaignId, {
      name: 'Reserved Seat',
      placeholderForEmail: INVITEE_EMAIL,
      personalQuest: undefined,
      privateNotes: undefined,
    });

    // The invitee cannot claim before joining (not yet a member → 404).
    const earlyClaim = await request(invitee, 'POST', `/api/characters/${placeholder.id}/claim`);
    expect(earlyClaim.status).toBe(404);

    const acceptRes = await request(invitee, 'POST', `/api/invites/${invite.memberId}/accept`);
    expect(acceptRes.status).toBe(200);

    const claimRes = await request(invitee, 'POST', `/api/characters/${placeholder.id}/claim`);
    expect(claimRes.status).toBe(200);
    const { character: claimed } = (await claimRes.json()) as {
      character: { ownerUserId: string; placeholderForEmail: string | null };
    };
    expect(claimed.ownerUserId).toBe(invitee.userId);
    expect(claimed.placeholderForEmail).toBeNull();

    // Ownership transferred: the creator can no longer edit it…
    const creatorPatch = await request(owner, 'PATCH', `/api/characters/${placeholder.id}`, {
      expectedVersion: 2,
      level: 9,
    });
    expect(creatorPatch.status).toBe(403);

    // …and the private tier unlocked for the new owner.
    const ownerPatch = await request(invitee, 'PATCH', `/api/characters/${placeholder.id}`, {
      expectedVersion: 2,
      personalQuest: 'My own quest now',
    });
    expect(ownerPatch.status).toBe(200);
  });

  it('rejects private fields on placeholders, non-owner creators, and wrong claimants', async () => {
    const { owner, member, campaignId } = await setupCampaign();

    const inviteRes = await request(owner, 'POST', `/api/campaigns/${campaignId}/invites`, {
      email: INVITEE_EMAIL,
    });
    expect(inviteRes.status).toBe(201);

    const withPrivate = await request(owner, 'POST', `/api/campaigns/${campaignId}/characters`, {
      name: 'Leaky',
      className: 'Drifter',
      placeholderForEmail: INVITEE_EMAIL,
      personalQuest: 'Should be rejected',
    });
    expect(withPrivate.status).toBe(422);

    const byMember = await request(member, 'POST', `/api/campaigns/${campaignId}/characters`, {
      name: 'Not Allowed',
      className: 'Drifter',
      placeholderForEmail: INVITEE_EMAIL,
    });
    expect(byMember.status).toBe(403);

    const noInvite = await request(owner, 'POST', `/api/campaigns/${campaignId}/characters`, {
      name: 'No Invite',
      className: 'Drifter',
      placeholderForEmail: 'owner@example.com',
    });
    expect(noInvite.status).toBe(403);

    // A member who is NOT the placeholder's named invitee cannot claim it.
    const placeholder = await createCharacter(owner, campaignId, {
      name: 'For Invitee',
      placeholderForEmail: INVITEE_EMAIL,
      personalQuest: undefined,
      privateNotes: undefined,
    });
    const wrongClaim = await request(member, 'POST', `/api/characters/${placeholder.id}/claim`);
    expect(wrongClaim.status).toBe(404);

    // Placeholder updates cannot smuggle private fields in before the claim.
    const privatePatch = await request(owner, 'PATCH', `/api/characters/${placeholder.id}`, {
      expectedVersion: 1,
      privateNotes: 'Smuggled',
    });
    expect(privatePatch.status).toBe(422);
  });
});

describe('items and cards', () => {
  it('owner manages items/cards tagged with the campaign game', async () => {
    const { owner, member, campaignId } = await setupCampaign();
    const character = await createCharacter(owner, campaignId);

    const itemRes = await request(owner, 'POST', `/api/characters/${character.id}/items`, {
      sourceId: 'fh-item-010',
    });
    expect(itemRes.status).toBe(201);
    const { item } = (await itemRes.json()) as { item: { id: string; game: string } };
    expect(item.game).toBe('frosthaven');

    const cardRes = await request(owner, 'POST', `/api/characters/${character.id}/cards`, {
      sourceId: 'fh-drifter-card-01',
      role: 'owned',
    });
    expect(cardRes.status).toBe(201);
    const { card } = (await cardRes.json()) as { card: { id: string; role: string } };
    expect(card.role).toBe('owned');

    const roleRes = await request(
      owner,
      'PATCH',
      `/api/characters/${character.id}/cards/${card.id}`,
      { role: 'active' },
    );
    expect(roleRes.status).toBe(204);

    const detailRes = await request(member, 'GET', `/api/characters/${character.id}`);
    const detail = (await detailRes.json()) as {
      items: Array<{ id: string }>;
      cards: Array<{ role: string }>;
    };
    expect(detail.items).toHaveLength(1);
    expect(detail.cards).toEqual([expect.objectContaining({ role: 'active' })]);

    const removeItem = await request(
      owner,
      'DELETE',
      `/api/characters/${character.id}/items/${item.id}`,
    );
    expect(removeItem.status).toBe(204);

    // A child id from another character is indistinguishable from absent.
    const bogusRemove = await request(
      owner,
      'DELETE',
      `/api/characters/${character.id}/items/${card.id}`,
    );
    expect(bogusRemove.status).toBe(404);
  });
});
