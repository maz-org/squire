/**
 * Edit-campaign-modules web UI tests (SQR-321).
 *
 * Module choice on the create form (GH2e "Include solo scenarios") and a
 * post-creation editor on the dashboard. Modules are shared state, so any
 * active member may edit; removal is non-destructive (a removed module's
 * scenario keys persist); validation runs in the service; a non-member 404s.
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

/** Create a campaign via the web form (returns the new id). `solo` toggles solo2e. */
async function createViaForm(
  user: TestUser,
  name: string,
  game: string,
  opts: { solo: boolean },
): Promise<string> {
  const form = new FormData();
  form.set('_csrf', createCsrfToken(user.sessionId));
  form.set('name', name);
  form.set('game', game);
  if (opts.solo) form.append('module', 'solo2e');
  const res = await app.request('/campaigns', {
    method: 'POST',
    headers: { Cookie: user.cookie },
    body: form,
    redirect: 'manual',
  });
  const location = res.headers.get('location') ?? '';
  return location.replace('/campaigns/', '');
}

async function editModules(
  user: TestUser,
  campaignId: string,
  optionalModules: string[],
  expectedVersion: number | string,
): Promise<Response> {
  const form = new FormData();
  form.set('_csrf', createCsrfToken(user.sessionId));
  form.set('expectedVersion', String(expectedVersion));
  for (const module of optionalModules) form.append('module', module);
  return app.request(`/campaigns/${campaignId}/modules`, {
    method: 'POST',
    headers: { Cookie: user.cookie, 'HX-Request': 'true' },
    body: form,
  });
}

async function modulesOf(user: TestUser, campaignId: string): Promise<string[]> {
  const detail = await CampaignService.getCampaignDetail(
    identityFromSessionUser(user.userId),
    campaignId,
  );
  return detail.campaign.modules;
}

beforeAll(async () => {
  await setupTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  process.env.SQUIRE_ALLOWED_EMAILS = [OWNER_EMAIL, OUTSIDER_EMAIL].join(',');
});

afterAll(async () => {
  delete process.env.SQUIRE_ALLOWED_EMAILS;
  await teardownTestDb();
  await shutdownServerPool();
});

describe('edit-modules UI (SQR-321)', () => {
  it('create form: GH2e with solo checked includes solo2e; unchecked omits it', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const withSolo = await createViaForm(owner, 'With Solo', 'gloomhaven-2e', { solo: true });
    expect(await modulesOf(owner, withSolo)).toEqual(['gh2e', 'solo2e']);

    const noSolo = await createViaForm(owner, 'No Solo', 'gloomhaven-2e', { solo: false });
    expect(await modulesOf(owner, noSolo)).toEqual(['gh2e']);
  });

  it('create form: Frosthaven always gets just fh', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const fh = await createViaForm(owner, 'Frost', 'frosthaven', { solo: true });
    expect(await modulesOf(owner, fh)).toEqual(['fh']);
  });

  it('dashboard shows the modules editor for GH2e but not Frosthaven', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const gh2e = await createViaForm(owner, 'GH2', 'gloomhaven-2e', { solo: true });
    const fh = await createViaForm(owner, 'FH', 'frosthaven', { solo: false });

    const gh2eBody = await (
      await app.request(`/campaigns/${gh2e}`, { headers: { Cookie: owner.cookie } })
    ).text();
    expect(gh2eBody).toContain('squire-campaign-modules');
    expect(gh2eBody).toContain('value="solo2e"');

    const fhBody = await (
      await app.request(`/campaigns/${fh}`, { headers: { Cookie: owner.cookie } })
    ).text();
    expect(fhBody).not.toContain('squire-campaign-modules');
  });

  it('removing then re-adding a module is non-destructive to played keys', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const id = await createViaForm(owner, 'Toggle', 'gloomhaven-2e', { solo: true });
    const identity = identityFromSessionUser(owner.userId);

    // Mark a solo scenario played, then remove solo2e.
    let detail = await CampaignService.getCampaignDetail(identity, id);
    await CampaignService.updateSharedState(identity, id, {
      expectedVersion: detail.campaign.version,
      playedScenarios: ['solo2e:bruiser'],
    });
    detail = await CampaignService.getCampaignDetail(identity, id);

    const removed = await editModules(owner, id, [], detail.campaign.version);
    expect(removed.status).toBe(303);
    detail = await CampaignService.getCampaignDetail(identity, id);
    expect(detail.campaign.modules).toEqual(['gh2e']);
    // The played key persists even though its module is gone.
    expect(detail.campaign.playedScenarios).toContain('solo2e:bruiser');

    // Re-adding solo2e restores the module; the key was never lost.
    const readded = await editModules(owner, id, ['solo2e'], detail.campaign.version);
    expect(readded.status).toBe(303);
    detail = await CampaignService.getCampaignDetail(identity, id);
    expect(detail.campaign.modules).toEqual(['gh2e', 'solo2e']);
    expect(detail.campaign.playedScenarios).toContain('solo2e:bruiser');
  });

  it('the service rejects an invalid module set (missing base)', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const id = await createViaForm(owner, 'Bad', 'gloomhaven-2e', { solo: true });
    const identity = identityFromSessionUser(owner.userId);
    const detail = await CampaignService.getCampaignDetail(identity, id);
    await expect(
      CampaignService.updateSharedState(identity, id, {
        expectedVersion: detail.campaign.version,
        modules: ['solo2e'], // no base gh2e
      }),
    ).rejects.toMatchObject({ code: 'invalid_modules' });
  });

  it('surfaces a version conflict', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const id = await createViaForm(owner, 'Conflict', 'gloomhaven-2e', { solo: true });
    const stale = (
      await CampaignService.getCampaignDetail(identityFromSessionUser(owner.userId), id)
    ).campaign.version;
    await editModules(owner, id, [], stale); // bumps version
    const conflict = await editModules(owner, id, ['solo2e'], stale);
    expect(conflict.status).toBe(422);
    expect(await conflict.text()).toContain('Updated elsewhere');
  });

  it('404s a non-member posting the modules route', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const id = await createViaForm(owner, 'Private', 'gloomhaven-2e', { solo: true });
    const outsider = await createTestUser(OUTSIDER_EMAIL);
    const res = await editModules(outsider, id, [], 0);
    expect(res.status).toBe(404);
  });
});
