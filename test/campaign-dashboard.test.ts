/**
 * Scenario-progression dashboard tests (SQR-276).
 *
 * Seeded against a tiny module graph: thread sections render with derived
 * statuses and the DESIGN.md status vocabulary; hazard banners sit inside
 * the affected thread; the toggle route advances unlocked→played and the
 * manual unlock→unlocked→played cycle with toast announcements;
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

function dashboardHeaderStats(body: string): string {
  const match = body.match(
    /<p\b[^>]*class="squire-campaign-dashboard__stats"[^>]*>\s*([\s\S]*?)\s*<\/p>/,
  );
  if (!match) throw new Error('Dashboard header stats not found');
  return match[1]!.replace(/\s+/g, ' ').trim();
}

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
  mode?: 'skip' | 'undo-draw',
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
  it('renders the campaign workspace shell with breadcrumb and four stable section tabs', async () => {
    const { owner, campaign } = await setupFixture();
    const res = await app.request(`/campaigns/${campaign.id}`, {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.text();

    expect(body).toContain('squire-column squire-column--wide');
    expect(body).toContain('class="squire-campaign-workspace"');
    expect(body).toContain('squire-campaign-dashboard squire-campaign-dashboard--progress');
    expect(body).toContain('Dashboard Campaign');
    expect(body).toContain('aria-label="Breadcrumb"');
    expect(body).toContain('href="/campaigns"');
    expect(body).toContain('squire-campaign-workspace__breadcrumb-link');
    expect(body).toContain('aria-current="page"');
    expect(body).not.toContain('class="squire-campaign-workspace__breadcrumb-link" href="/"');
    expect(body).not.toContain('squire-campaign-workspace__switcher');
    expect(body).not.toContain('Switch campaign');
    expect(dashboardHeaderStats(body)).toBe('Frosthaven · Prosperity 1');
    expect(dashboardHeaderStats(body)).not.toContain('OPEN');
    expect(body).toContain('aria-label="Campaign workspace sections"');
    expect(body).toMatch(new RegExp(`href="/campaigns/${campaign.id}"[^>]*aria-current="page"`));
    expect(body).toContain(`href="/campaigns/${campaign.id}/party"`);
    expect(body).toContain(`href="/campaigns/${campaign.id}/players"`);
    expect(body).toContain(`href="/campaigns/${campaign.id}/settings"`);
    expect(body).toContain('Progress');
    expect(body).toContain('Party');
    expect(body).toContain('Players');
    expect(body).toContain('Settings');
    expect(body).not.toContain('>Scenarios</a>');
    expect(body).not.toContain('>More</');
    expect(body).toContain('aria-label="Scenario progression"');
    expect(body).toContain('<h2 class="squire-campaign-dashboard__section-title">Progress</h2>');
    expect(body).toContain('Record progress');
    expect(body).not.toContain('aria-label="Party roster"');
    expect(body).not.toContain('squire-character-create');
  });

  it('renders the deep-linked Party view in the same workspace shell', async () => {
    const { owner, campaign } = await setupFixture();
    const res = await app.request(`/campaigns/${campaign.id}/party`, {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.text();

    expect(body).toMatch(
      new RegExp(`href="/campaigns/${campaign.id}/party"[^>]*aria-current="page"`),
    );
    expect(body).toContain(`href="/campaigns/${campaign.id}"`);
    expect(body).toContain('squire-campaign-dashboard squire-campaign-dashboard--party');
    expect(body).toContain('class="squire-campaign-dashboard__party"');
    expect(body).toContain('aria-label="Party"');
    expect(body).toContain('squire-section-reveal__summary">Add character</summary>');
    expect(body).not.toContain('aria-label="Scenario progression"');
    expect(body).not.toContain('squire-dashboard-grid');
  });

  it.each([
    ['players', 'Players'],
    ['settings', 'Settings'],
  ])('renders the %s route with workspace shell navigation', async (path, label) => {
    const { owner, campaign } = await setupFixture();
    const res = await app.request(`/campaigns/${campaign.id}/${path}`, {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.text();

    expect(body).toContain('class="squire-campaign-workspace"');
    expect(body).toContain('Dashboard Campaign');
    expect(body).toMatch(
      new RegExp(`href="/campaigns/${campaign.id}/${path}"[^>]*aria-current="page"`),
    );
    expect(body).toContain(`href="/campaigns/${campaign.id}"`);
    expect(body).toContain(`href="/campaigns/${campaign.id}/party"`);
    expect(body).toContain(`href="/campaigns/${campaign.id}/players"`);
    expect(body).toContain(`href="/campaigns/${campaign.id}/settings"`);
    expect(body).toContain(`<h2 class="squire-campaign-dashboard__section-title">${label}</h2>`);
  });

  it('renders threads, statuses, stats, and adjacent hazard banners', async () => {
    const { owner, campaign } = await setupFixture();
    const res = await app.request(`/campaigns/${campaign.id}`, {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.text();

    expect(body).toContain('Main Thread');
    expect(body).toContain('The opening arc');
    expect(body).toContain('UNLOCKED'); // scenario 1
    expect(body).toContain('LOCKED'); // 2 and 3 gated on 1
    expect(body).toContain('EVENT'); // manual 4 with cond note before unlock
    expect(body).toContain('Drawn from the event deck');
    expect(body).toContain('Record progress');
    expect(body).toContain('id="squire-dashboard-progress-loading"');
    expect(body).toContain('hx-indicator="#squire-dashboard-progress-loading"');
    expect(body).not.toContain('squire-dashboard-toast-payload');
    expect(body).toContain('aria-live="polite"');
    expect(body).toContain('squire-dashboard-stats');
    expect(body).toContain('<dt class="squire-dashboard-stats__label">UNLOCKED</dt>');

    const headerStats = dashboardHeaderStats(body);
    expect(headerStats).toBe('Frosthaven · Prosperity 1');
    expect(headerStats).not.toContain('PLAYED');
    expect(headerStats).not.toContain('DRAWN');

    // No hazard banner yet: 2/3 close each other but neither is reachable
    // (locked culprits still project warnings — both unplayed, so the
    // banner SHOULD render inside Main Thread).
    expect(body).toContain('HAZARD');
    const mainThread = body.slice(body.indexOf('Main Thread'), body.indexOf('Event Thread'));
    expect(mainThread).toContain('permanently closes');
  });

  it('surfaces unknown scenario state as partial advisory data', async () => {
    const { owner, campaign } = await setupFixture();
    await CampaignService.updateSharedState(identityFromSessionUser(owner.userId), campaign.id, {
      expectedVersion: campaign.version,
      drawnScenarios: ['fh:999'],
    });

    const res = await app.request(`/campaigns/${campaign.id}`, {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('MISSING FLOWCHART DATA');
    expect(body).toContain('Squire cannot place these recorded scenarios on the graph yet:');
    expect(body).toContain('999.');
    expect(body).toContain('Keep tracking them with the scenario book.');
  });
});

describe('toggle route', () => {
  it('advances unlocked→played and the manual unlock cycle with toast announcements', async () => {
    const { owner, campaign } = await setupFixture();

    const played = await toggle(owner, campaign.id, 'fh:1');
    expect(played.status).toBe(200);
    const playedBody = await played.text();
    expect(playedBody).toContain('data-squire-toast-message="Scenario 1 marked played."');
    expect(playedBody).toContain('data-squire-toast-kind="success"');
    expect(playedBody).toContain('class="squire-dashboard-toast-payload"');
    expect(playedBody).not.toContain('class="squire-dashboard-toast"');
    expect(playedBody).toContain('PLAYED ✓');
    // 2 and 3 opened by playing 1.
    expect(playedBody.match(/--open/g)?.length).toBeGreaterThanOrEqual(2);
    expect(playedBody).toContain('hx-swap-oob="true"');
    expect(dashboardHeaderStats(playedBody)).toBe('Frosthaven · Prosperity 1');

    // Manual cycle: unlock source → unlocked → played, with correction available
    // after the easy-to-misclick unlock step.
    const unlocked = await toggle(owner, campaign.id, 'fh:4');
    const unlockedBody = await unlocked.text();
    expect(unlockedBody).toContain('data-squire-toast-message="Scenario 4 marked unlocked."');
    expect(unlockedBody).toContain('UNLOCKED');
    expect(unlockedBody).not.toContain('DREW IT');
    expect(unlockedBody).not.toContain('Undo draw');
    expect(unlockedBody).toContain('name="mode" value="undo-draw"');
    expect(unlockedBody).toContain('aria-label="Undo unlock for scenario 4 Scenario 4"');
    expect(unlockedBody).toContain('squire-scenario-row__undo-icon');
    const playedManual = await toggle(owner, campaign.id, 'fh:4');
    const manualBody = await playedManual.text();
    expect(manualBody).toContain('data-squire-toast-message="Scenario 4 marked played."');

    // Played rows are not tappable in v1 (un-play is destructive).
    expect(manualBody).not.toContain('name="key" value="fh:4"');
  });

  it('undoes an accidental manual unlock and returns the scenario to its unlock source label', async () => {
    const { owner, campaign } = await setupFixture();

    await toggle(owner, campaign.id, 'fh:4');
    const undo = await toggle(owner, campaign.id, 'fh:4', 'undo-draw');
    expect(undo.status).toBe(200);
    const body = await undo.text();
    expect(body).toContain('Scenario 4 returned to locked.');
    const eventThread = body.slice(body.indexOf('Event Thread'));
    expect(eventThread).toContain('EVENT');
    expect(eventThread).toContain('Drawn from the event deck');
    expect(eventThread).not.toContain('UNLOCKED');
    expect(eventThread).not.toContain('Undo unlock');
    expect(eventThread).not.toContain('name="mode" value="undo-draw"');
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
    // The Skip button has a scenario-specific accessible name so assistive
    // control lists never expose indistinguishable "Skip" actions.
    expect(body).toContain('aria-label="Skip scenario 0 Training Course"');
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
    const body = await denied.text();
    expect(body).toContain('data-squire-toast-message="Scenario 1 cannot be skipped."');
    expect(body).toContain('data-squire-toast-kind="error"');
  });
});
