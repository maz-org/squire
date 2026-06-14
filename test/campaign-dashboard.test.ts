/**
 * Scenario-progression dashboard tests (SQR-276).
 *
 * Seeded against a tiny module graph: thread sections render with derived
 * statuses and the DESIGN.md status vocabulary; hazard banners sit inside
 * the affected thread; the toggle route advances open→played and the
 * manual via-event→drew-it→played cycle with aria-live announcements;
 * played rows are not tappable in v1 (un-play is destructive, SQR-279);
 * non-members get the indistinguishable 404.
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
import { seedUnlockGraphModule } from '../src/seed/seed-unlock-graphs.ts';
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

const scenario = (key: string, overrides: Record<string, unknown> = {}) => ({
  key,
  name: `Scenario ${key}`,
  prereqsAll: [] as string[],
  prereqsAny: [] as string[],
  mutex: [] as string[],
  lockedIf: [] as string[],
  manual: false,
  cond: null as string | null,
  hazard: false,
  skippable: false,
  unlockClass: null as string | null,
  unlockMinLevel: null as number | null,
  ...overrides,
});

async function setupFixture() {
  const { db } = getDb('server');
  await seedUnlockGraphModule(db, {
    provenance: 'test',
    game: 'frosthaven',
    module: 'fh',
    scenarios: [
      scenario('1'),
      scenario('2', { prereqsAll: ['1'], mutex: ['3'] }),
      scenario('3', { prereqsAll: ['1'], mutex: ['2'] }),
      scenario('4', { manual: true, cond: 'Drawn from the event deck' }),
    ],
    threads: [
      {
        id: 'fh_main',
        label: 'Main Thread',
        note: 'The opening arc',
        position: 0,
        keys: ['1', '2', '3'],
      },
      { id: 'fh_events', label: 'Event Thread', note: 'Event unlocks', position: 1, keys: ['4'] },
    ],
  });
  const owner = await createTestUser(OWNER_EMAIL);
  const campaign = await CampaignService.createCampaign(identityFromSessionUser(owner.userId), {
    name: 'Dashboard Campaign',
    game: 'frosthaven',
    modules: ['fh'],
  });
  return { owner, campaign };
}

async function toggle(
  user: TestUser,
  campaignId: string,
  key: string,
  mode?: 'skip',
): Promise<Response> {
  const form = new FormData();
  form.set('_csrf', createCsrfToken(user.sessionId));
  form.set('key', key);
  if (mode) form.set('mode', mode);
  return app.request(`/campaigns/${campaignId}/scenarios/toggle`, {
    method: 'POST',
    headers: { Cookie: user.cookie, 'HX-Request': 'true' },
    body: form,
  });
}

/** A module with a skippable intro (scenario 0) gating scenario 1 (SQR-317). */
async function setupSkipFixture() {
  const { db } = getDb('server');
  await seedUnlockGraphModule(db, {
    provenance: 'test',
    game: 'frosthaven',
    module: 'fh',
    scenarios: [
      scenario('0', { name: 'Training Course', skippable: true }),
      scenario('1', { prereqsAll: ['0'] }),
    ],
    threads: [
      { id: 'fh_intro', label: 'Prologue', note: 'The opening', position: 0, keys: ['0', '1'] },
    ],
  });
  const owner = await createTestUser(OWNER_EMAIL);
  const campaign = await CampaignService.createCampaign(identityFromSessionUser(owner.userId), {
    name: 'Skip Campaign',
    game: 'frosthaven',
    modules: ['fh'],
  });
  return { owner, campaign };
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

describe('dashboard rendering', () => {
  it('renders threads, statuses, stats, and adjacent hazard banners', async () => {
    const { owner, campaign } = await setupFixture();
    const res = await app.request(`/campaigns/${campaign.id}`, {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.text();

    expect(body).toContain('Main Thread');
    expect(body).toContain('The opening arc');
    expect(body).toContain('OPEN'); // scenario 1
    expect(body).toContain('LOCKED'); // 2 and 3 gated on 1
    expect(body).toContain('VIA EVENT'); // manual 4 with cond note
    expect(body).toContain('Drawn from the event deck');
    expect(body).toContain('aria-live="polite"');
    expect(body).toContain('squire-dashboard-stats');

    // No hazard banner yet: 2/3 close each other but neither is reachable
    // (locked culprits still project warnings — both unplayed, so the
    // banner SHOULD render inside Main Thread).
    expect(body).toContain('HAZARD');
    const mainThread = body.slice(body.indexOf('Main Thread'), body.indexOf('Event Thread'));
    expect(mainThread).toContain('permanently closes');
  });
});

describe('toggle route', () => {
  it('advances open→played and the manual cycle with announcements', async () => {
    const { owner, campaign } = await setupFixture();

    const played = await toggle(owner, campaign.id, 'fh:1');
    expect(played.status).toBe(200);
    const playedBody = await played.text();
    expect(playedBody).toContain('Scenario 1 marked played.');
    expect(playedBody).toContain('PLAYED ✓');
    // 2 and 3 opened by playing 1.
    expect(playedBody.match(/--open/g)?.length).toBeGreaterThanOrEqual(2);

    // Manual cycle: via-event → drew-it → played.
    const drew = await toggle(owner, campaign.id, 'fh:4');
    expect(await drew.text()).toContain('Scenario 4 marked drawn.');
    const playedManual = await toggle(owner, campaign.id, 'fh:4');
    const manualBody = await playedManual.text();
    expect(manualBody).toContain('Scenario 4 marked played.');

    // Played rows are not tappable in v1 (un-play is destructive).
    expect(manualBody).not.toContain('name="key" value="fh:4"');
  });

  it('confirms hazardous taps and 404s non-members', async () => {
    const { owner, campaign } = await setupFixture();
    await toggle(owner, campaign.id, 'fh:1'); // open the mutex pair

    const res = await app.request(`/campaigns/${campaign.id}`, {
      headers: { Cookie: owner.cookie },
    });
    const body = await res.text();
    // Scenarios 2/3 are an unplayed mutex pair → their rows carry hx-confirm.
    expect(body).toContain('hx-confirm');
    expect(body).toContain('permanently closes');

    const outsider = await createTestUser(OUTSIDER_EMAIL);
    const denied = await toggle(outsider, campaign.id, 'fh:2');
    expect(denied.status).toBe(404);
  });
});

describe('skippable intro (SQR-317)', () => {
  it('offers a Skip control only on a skippable open scenario', async () => {
    const { owner, campaign } = await setupSkipFixture();
    const res = await app.request(`/campaigns/${campaign.id}`, {
      headers: { Cookie: owner.cookie },
    });
    const body = await res.text();
    // Scenario 0 is skippable + open → carries the quiet Skip control.
    expect(body).toContain('squire-scenario-row__skip');
    expect(body).toContain('squire-scenario-row--skippable');
    expect(body).toContain('name="mode" value="skip"');
    // Scenario 1 is locked (gated on 0) → only scenario 0 offers skip.
    expect(body.match(/name="mode" value="skip"/g)?.length).toBe(1);
  });

  it('marks a skippable scenario skipped and opens what it gated', async () => {
    const { owner, campaign } = await setupSkipFixture();
    const skipped = await toggle(owner, campaign.id, 'fh:0', 'skip');
    expect(skipped.status).toBe(200);
    const body = await skipped.text();
    expect(body).toContain('Scenario 0 marked skipped.');
    expect(body).toContain('SKIPPED');
    // Scenario 1 (gated on 0) opens now that 0 is done.
    expect(body).toContain('--open');
    // Skip is terminal — scenario 0 no longer offers a skip control.
    expect(body).not.toContain('name="mode" value="skip"');
  });

  it('refuses to skip a non-skippable scenario', async () => {
    const { owner, campaign } = await setupSkipFixture();
    await toggle(owner, campaign.id, 'fh:0', 'skip'); // 1 becomes open
    const denied = await toggle(owner, campaign.id, 'fh:1', 'skip');
    expect(denied.status).toBe(200);
    expect(await denied.text()).toContain('Scenario 1 cannot be skipped.');
  });
});
