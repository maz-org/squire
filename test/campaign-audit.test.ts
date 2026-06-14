/**
 * Audit log + journal read-model tests (SQR-266, ADR 0021 §Audit).
 *
 * Success rows commit in the same transaction as the mutation (a rolled-back
 * mutation leaves no success row); denials and version conflicts write
 * 'rejected' rows on the outer connection so the evidence survives. The
 * journal is a whitelist-redacted projection: private-tier values and failed
 * writes must never appear in it.
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
import * as CampaignAuditRepository from '../src/db/repositories/campaign-audit-repository.ts';
import { identityFromSessionUser } from '../src/campaign/identity.ts';
import { listJournal } from '../src/campaign/journal.ts';
import { CampaignNotFoundError } from '../src/campaign/campaign-service.ts';
import { seedUnlockGraphModule } from '../src/seed/seed-unlock-graphs.ts';
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

async function createCampaign(user: TestUser): Promise<{ id: string; version: number }> {
  const res = await request(user, 'POST', '/api/campaigns', {
    name: 'Audited Campaign',
    game: 'frosthaven',
    modules: ['fh'],
  });
  expect(res.status).toBe(201);
  const { campaign } = (await res.json()) as { campaign: { id: string; version: number } };
  return campaign;
}

beforeAll(async () => {
  await setupTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  process.env.SQUIRE_ALLOWED_EMAILS = [OWNER_EMAIL, MEMBER_EMAIL, OUTSIDER_EMAIL].join(',');
});

afterAll(async () => {
  delete process.env.SQUIRE_ALLOWED_EMAILS;
  await teardownTestDb();
  await shutdownServerPool();
});

describe('audit rows for confirmed mutations', () => {
  it('writes a success row for every mutating service path', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const member = await createTestUser(MEMBER_EMAIL);
    const campaign = await createCampaign(owner);

    const inviteRes = await request(owner, 'POST', `/api/campaigns/${campaign.id}/invites`, {
      email: MEMBER_EMAIL,
    });
    const { member: invite } = (await inviteRes.json()) as { member: { memberId: string } };
    await request(member, 'POST', `/api/invites/${invite.memberId}/accept`);
    await request(owner, 'PATCH', `/api/campaigns/${campaign.id}`, {
      expectedVersion: 1,
      prosperity: 2,
    });

    const charRes = await request(member, 'POST', `/api/campaigns/${campaign.id}/characters`, {
      name: 'Audit Subject',
      className: 'Drifter',
    });
    const { character } = (await charRes.json()) as {
      character: { id: string; version: number };
    };
    await request(member, 'PATCH', `/api/characters/${character.id}`, {
      expectedVersion: character.version,
      level: 2,
    });
    const itemRes = await request(member, 'POST', `/api/characters/${character.id}/items`, {
      sourceId: 'fh-item-001',
    });
    expect(itemRes.status).toBe(201);
    await request(member, 'POST', `/api/campaigns/${campaign.id}/leave`);

    const entries = await CampaignAuditRepository.listByCampaign(campaign.id);
    const types = entries.map((e) => `${e.mutationType}:${e.outcome}`);
    expect(types).toEqual(
      expect.arrayContaining([
        'campaign.create:success',
        'member.invite:success',
        'member.join:success',
        'campaign.update:success',
        'character.create:success',
        'character.update:success',
        'character.add_item:success',
        'member.leave:success',
      ]),
    );
    for (const entry of entries) {
      expect(entry.channel).toBe('web');
      expect([owner.userId, member.userId]).toContain(entry.actorUserId);
    }

    // The shared-state update recorded only the touched fields (campaigns
    // start at prosperity 1 — the schema default).
    const update = entries.find((e) => e.mutationType === 'campaign.update');
    expect(update?.payloadBefore).toEqual({ prosperity: 1 });
    expect(update?.payloadAfter).toEqual({ prosperity: 2 });
  });

  it('records rejected rows on the outer connection; rollbacks leave no success row', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const outsider = await createTestUser(OUTSIDER_EMAIL);
    const campaign = await createCampaign(owner);

    // Version conflict: the CAS throws inside the transaction (rollback),
    // and the rejected row is written after it unwinds.
    const conflict = await request(owner, 'PATCH', `/api/campaigns/${campaign.id}`, {
      expectedVersion: 99,
      prosperity: 7,
    });
    expect(conflict.status).toBe(409);

    // Non-member probe: denied before any state change.
    const probe = await request(outsider, 'PATCH', `/api/campaigns/${campaign.id}`, {
      expectedVersion: 1,
      prosperity: 9,
    });
    expect(probe.status).toBe(404);

    const entries = await CampaignAuditRepository.listByCampaign(campaign.id);
    const updates = entries.filter((e) => e.mutationType === 'campaign.update');
    expect(updates.map((e) => `${e.outcome}:${e.failureReason}`).sort()).toEqual([
      'rejected:not_found',
      'rejected:version_conflict',
    ]);
    expect(updates.every((e) => e.payloadAfter === null)).toBe(true);

    // Neither attempt changed state (prosperity stays at its default of 1).
    const detail = await request(owner, 'GET', `/api/campaigns/${campaign.id}`);
    const body = (await detail.json()) as { campaign: { prosperity: number; version: number } };
    expect(body.campaign.prosperity).toBe(1);
    expect(body.campaign.version).toBe(1);
  });

  it('audit rows survive campaign deletion and record the proposal lifecycle', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const campaign = await createCampaign(owner);

    const proposeRes = await request(owner, 'POST', `/api/campaigns/${campaign.id}/proposals`, {
      mutation: { type: 'campaign.delete' },
    });
    expect(proposeRes.status).toBe(201);
    const { proposal } = (await proposeRes.json()) as { proposal: { id: string } };
    const confirmRes = await request(owner, 'POST', `/api/proposals/${proposal.id}/confirm`);
    expect(confirmRes.status).toBe(200);

    const entries = await CampaignAuditRepository.listByCampaign(campaign.id);
    expect(entries.map((e) => e.mutationType)).toEqual(
      expect.arrayContaining(['campaign.create', 'proposal.proposed', 'campaign.delete']),
    );
  });

  it('snapshots derived availability when scenario state changes', async () => {
    const { db } = getDb('server');
    await seedUnlockGraphModule(db, {
      provenance: 'test',
      game: 'frosthaven',
      module: 'fh',
      scenarios: [
        {
          key: '1',
          name: 'One',
          prereqsAll: [],
          prereqsAny: [],
          mutex: [],
          lockedIf: [],
          manual: false,
          cond: null,
          hazard: false,
          skippable: false,
          unlockClass: null,
          unlockMinLevel: null,
        },
        {
          key: '2',
          name: 'Two',
          prereqsAll: ['1'],
          prereqsAny: [],
          mutex: [],
          lockedIf: [],
          manual: false,
          cond: null,
          hazard: false,
          skippable: false,
          unlockClass: null,
          unlockMinLevel: null,
        },
      ],
      threads: [],
    });

    const owner = await createTestUser(OWNER_EMAIL);
    const campaign = await createCampaign(owner);
    const res = await request(owner, 'PATCH', `/api/campaigns/${campaign.id}`, {
      expectedVersion: 1,
      playedScenarios: ['fh:1'],
    });
    expect(res.status).toBe(200);

    const entries = await CampaignAuditRepository.listByCampaign(campaign.id);
    const update = entries.find((e) => e.mutationType === 'campaign.update');
    const snapshot = update?.availabilitySnapshot as {
      statuses: Record<string, string>;
      unknownKeys: string[];
    };
    expect(snapshot.statuses['fh:1']).toBe('played');
    expect(snapshot.statuses['fh:2']).toBe('open');
    expect(snapshot.unknownKeys).toEqual([]);

    // Non-scenario updates do not snapshot.
    await request(owner, 'PATCH', `/api/campaigns/${campaign.id}`, {
      expectedVersion: 2,
      prosperity: 1,
    });
    const after = await CampaignAuditRepository.listByCampaign(campaign.id);
    const prosperityUpdate = after.find(
      (e) => e.mutationType === 'campaign.update' && e.payloadAfter?.prosperity === 1,
    );
    expect(prosperityUpdate?.availabilitySnapshot).toBeNull();
  });
});

describe('journal read-model', () => {
  it('redacts private-tier values and excludes failed writes', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const campaign = await createCampaign(owner);
    const charRes = await request(owner, 'POST', `/api/campaigns/${campaign.id}/characters`, {
      name: 'Journal Subject',
      className: 'Drifter',
      personalQuest: 'SECRET-PQ-TOKEN',
    });
    const { character } = (await charRes.json()) as {
      character: { id: string; version: number };
    };
    await request(owner, 'PATCH', `/api/characters/${character.id}`, {
      expectedVersion: character.version,
      level: 5,
      privateNotes: 'SECRET-NOTES-TOKEN',
    });
    // A failed write that must never surface in the journal.
    const conflict = await request(owner, 'PATCH', `/api/campaigns/${campaign.id}`, {
      expectedVersion: 99,
      prosperity: 7,
    });
    expect(conflict.status).toBe(409);

    const journal = await listJournal(identityFromSessionUser(owner.userId), campaign.id);
    const serialized = JSON.stringify(journal);
    expect(serialized).not.toContain('SECRET-PQ-TOKEN');
    expect(serialized).not.toContain('SECRET-NOTES-TOKEN');
    expect(serialized).not.toContain('personalQuest');
    expect(serialized).not.toContain('privateNotes');
    expect(serialized).not.toContain('rejected');

    // The non-private part of the same mutation IS visible.
    const allEntries = journal.flatMap((day) => day.entries);
    const update = allEntries.find((e) => e.mutationType === 'character.update');
    expect(update?.after).toEqual({ level: 5 });
    expect(update?.actorName).toBe('owner');

    // Grouped by day, today only.
    expect(journal).toHaveLength(1);
    expect(journal[0].date).toBe(new Date().toISOString().slice(0, 10));
  });

  it('is member-gated like every campaign read', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const outsider = await createTestUser(OUTSIDER_EMAIL);
    const campaign = await createCampaign(owner);
    await expect(
      listJournal(identityFromSessionUser(outsider.userId), campaign.id),
    ).rejects.toBeInstanceOf(CampaignNotFoundError);
  });
});
