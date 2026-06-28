/**
 * Isolation proof gap-fills (SQR-270, ADR 0021 §Test obligations).
 *
 * Most contract clauses are proven where their surface lives (see the
 * coverage map in the SQR-270 PR); this file adds the two end-to-end
 * proofs no other suite pins: leave/rejoin restoring character EDIT
 * rights (ownership binds to the user, not the membership row), and a
 * departed member's private tier staying unreadable to everyone.
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

describe('leave/rejoin ownership (ADR 0021 §Leave / delete semantics)', () => {
  it('restores character edit rights on rejoin; blocks them while departed', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const member = await createTestUser(MEMBER_EMAIL);

    const createRes = await request(owner, 'POST', '/api/campaigns', {
      name: 'Rejoin Proof',
      game: 'frosthaven',
    });
    const { campaign } = (await createRes.json()) as { campaign: { id: string } };
    const inviteRes = await request(owner, 'POST', `/api/campaigns/${campaign.id}/invites`, {
      email: MEMBER_EMAIL,
    });
    const { member: invite } = (await inviteRes.json()) as { member: { memberId: string } };
    await request(member, 'POST', `/api/invites/${invite.memberId}/accept`);

    const charRes = await request(member, 'POST', `/api/campaigns/${campaign.id}/characters`, {
      name: 'Returning Hero',
      className: 'Drifter',
      privateNotes: 'SECRET-REJOIN-TOKEN',
    });
    expect(charRes.status).toBe(201);
    const { character } = (await charRes.json()) as { character: { id: string; version: number } };

    // Leave: the character is retained but the departed member loses access
    // entirely (same indistinguishable 404 as a non-member).
    const leaveRes = await request(member, 'POST', `/api/campaigns/${campaign.id}/leave`);
    expect(leaveRes.status).toBe(204);
    const departedPatch = await request(member, 'PATCH', `/api/characters/${character.id}`, {
      expectedVersion: character.version,
      gold: 10,
    });
    expect(departedPatch.status).toBe(404);

    // The departed member's private tier is unreadable to EVERYONE — the
    // remaining owner sees the member-visible projection only.
    const ownerView = await request(owner, 'GET', `/api/characters/${character.id}`);
    expect(ownerView.status).toBe(200);
    const ownerBody = (await ownerView.json()) as { character: Record<string, unknown> };
    expect(JSON.stringify(ownerBody)).not.toContain('SECRET-REJOIN-TOKEN');
    expect(ownerBody.character).not.toHaveProperty('privateNotes');

    // Re-invite + accept reactivates the same membership row; character
    // ownership was user-bound all along, so edit rights return intact.
    const reinviteRes = await request(owner, 'POST', `/api/campaigns/${campaign.id}/invites`, {
      email: MEMBER_EMAIL,
    });
    expect(reinviteRes.status).toBe(201);
    const { member: revived } = (await reinviteRes.json()) as { member: { memberId: string } };
    const acceptRes = await request(member, 'POST', `/api/invites/${revived.memberId}/accept`);
    expect(acceptRes.status).toBe(200);

    const rejoinPatch = await request(member, 'PATCH', `/api/characters/${character.id}`, {
      expectedVersion: character.version,
      gold: 10,
    });
    expect(rejoinPatch.status).toBe(200);

    // And the private tier is theirs again.
    const ownDetail = await request(member, 'GET', `/api/characters/${character.id}`);
    const ownBody = (await ownDetail.json()) as { character: { privateNotes: string } };
    expect(ownBody.character.privateNotes).toBe('SECRET-REJOIN-TOKEN');
  });
});
