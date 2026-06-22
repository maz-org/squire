/**
 * Campaign route shell + chat context tests (SQR-275, SQR-364).
 *
 * Campaign pages share the same app header as chat. Chat renders campaign
 * context in the ask area so the next turn's binding is visible and changeable
 * immediately before asking. Non-member campaign pages are the indistinguishable
 * 404.
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
import * as MessageRepository from '../src/db/repositories/message-repository.ts';
import * as CampaignService from '../src/campaign/campaign-service.ts';
import { identityFromSessionUser } from '../src/campaign/identity.ts';
import { users } from '../src/db/schema/core.ts';
import { resetTestDb, setupTestDb, teardownTestDb } from './helpers/db.ts';

interface TestUser {
  cookie: string;
  sessionId: string;
  userId: string;
  email: string;
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
  return { cookie: signedCookie.split(';')[0], sessionId, userId: user.id, email };
}

async function pageRequest(user: TestUser, url: string): Promise<Response> {
  return app.request(url, { headers: { Cookie: user.cookie } });
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

describe('chat context states', () => {
  it('renders campaigns without campaign context in the app header for users without campaigns', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const res = await pageRequest(owner, '/campaigns');
    expect(res.status).toBe(200);
    const body = await res.text();
    const header = body.match(/<header class="squire-header">[\s\S]*?<\/header>/)?.[0] ?? '';
    expect(header).not.toContain('NO CAMPAIGN');
    expect(header).not.toContain('squire-campaign-strip');
    expect(body).toContain('No campaigns yet');
  });

  it('shows the campaign on chat home and binds the chat form to it', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const campaign = await CampaignService.createCampaign(identityFromSessionUser(owner.userId), {
      name: 'Travel Campaign',
      game: 'gh2e',
    });

    const res = await pageRequest(owner, '/');
    expect(res.status).toBe(200);
    const body = await res.text();
    const header = body.match(/<header class="squire-header">[\s\S]*?<\/header>/)?.[0] ?? '';
    const context = body.match(/<section[^>]*class="squire-chat-context"[\s\S]*?<\/section>/)?.[0];
    expect(header).not.toContain('TRAVEL CAMPAIGN');
    expect(context).toContain('Current campaign');
    expect(context).toContain('Travel Campaign');
    expect(context).toContain(`/campaigns/${campaign.id}`);
    // E6: the chat form carries the binding as a hidden field.
    expect(body).toContain(`name="campaignId" value="${campaign.id}"`);
    expect(body).not.toContain('class="squire-game-picker"');
  });
});

describe('campaign routes', () => {
  it('renders the dashboard shell for members without campaign context in the app header', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const campaign = await CampaignService.createCampaign(identityFromSessionUser(owner.userId), {
      name: 'Travel Campaign',
      game: 'frosthaven',
    });

    const res = await pageRequest(owner, `/campaigns/${campaign.id}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    const header = body.match(/<header class="squire-header">[\s\S]*?<\/header>/)?.[0] ?? '';
    expect(body).toContain('Travel Campaign');
    expect(body).toContain('squire-column squire-column--wide');
    expect(body).toContain('squire-campaign-dashboard squire-campaign-dashboard--progress');
    expect(header).toMatch(/<a[^>]*href="\/"[^>]*>\s*Chat\s*<\/a>/);
    expect(header).toMatch(
      /<a[^>]*href="\/campaigns"[^>]*aria-current="page"[^>]*>\s*Campaigns\s*<\/a>/,
    );
    expect(header).not.toContain('HAVEN · RULES');
    expect(header).not.toContain('Travel Campaign');
    expect(header).not.toContain('squire-campaign-strip');
    expect(body).toContain('Frosthaven · Prosperity 1');
    expect(body).toContain('<h2 class="squire-campaign-dashboard__section-title">Progress</h2>');
    expect(body).toContain(
      'Track unlocked, played, skipped, and blocked scenarios for this campaign.',
    );
    expect(body).toContain('No scenario progress is available for this campaign yet.');
    expect(body).not.toContain('Record progress');
  });

  it('serves the indistinguishable 404 to non-members and for absent ids', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const outsider = await createTestUser(OUTSIDER_EMAIL);
    const campaign = await CampaignService.createCampaign(identityFromSessionUser(owner.userId), {
      name: 'Private Campaign',
      game: 'frosthaven',
    });

    const nonMember = await pageRequest(outsider, `/campaigns/${campaign.id}`);
    const absent = await pageRequest(outsider, '/campaigns/00000000-0000-4000-8000-000000000000');
    const malformed = await pageRequest(outsider, '/campaigns/not-a-uuid');
    expect(nonMember.status).toBe(404);
    expect(absent.status).toBe(404);
    expect(malformed.status).toBe(404);
  });
});

describe('campaign picker (SQR-11)', () => {
  const formPost = async (user: TestUser, url: string, fields: Record<string, string> = {}) => {
    const form = new FormData();
    form.set('_csrf', createCsrfToken(user.sessionId));
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return app.request(url, {
      method: 'POST',
      headers: { Cookie: user.cookie },
      body: form,
    });
  };

  it('creates a campaign from the form and activates it', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const res = await formPost(owner, '/campaigns', {
      name: 'Form Campaign',
      game: 'gloomhaven-2e',
      // The "Include solo scenarios" checkbox is checked by default (SQR-321).
      module: 'solo2e',
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/\/campaigns\/[0-9a-f-]{36}/);

    // The page now lists it as ACTIVE with the chosen modules + role.
    const page = await pageRequest(owner, '/campaigns');
    const body = await page.text();
    expect(body).toContain('Form Campaign');
    expect(body).toContain('GH2E + SOLO2E');
    expect(body).toContain('OWNER');
    expect(body).toContain('ACTIVE');
  });

  it('re-renders with a banner when creation fails (not allowlisted)', async () => {
    process.env.SQUIRE_ALLOWED_EMAILS = 'someone-else@example.com';
    const owner = await createTestUser(OWNER_EMAIL);
    const res = await formPost(owner, '/campaigns', { name: 'Nope', game: 'frosthaven' });
    expect(res.status).toBe(422);
    expect(await res.text()).toContain('COULD NOT SAVE');
  });

  it('switches the active campaign via MAKE ACTIVE and updates the strip', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const identity = identityFromSessionUser(owner.userId);
    const first = await CampaignService.createCampaign(identity, {
      name: 'First Campaign',
      game: 'frosthaven',
    });
    const second = await CampaignService.createCampaign(identity, {
      name: 'Second Campaign',
      game: 'gloomhaven-2e',
    });
    void first;

    const activate = await formPost(owner, `/campaigns/${second.id}/activate`);
    expect(activate.status).toBe(303);
    const cookie = activate.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('squire_active_campaign');

    // Subsequent pages carry the cookie → strip shows the selection.
    const home = await app.request('/', {
      headers: { Cookie: `${owner.cookie}; ${cookie.split(';')[0]}` },
    });
    const body = await home.text();
    const context = body.match(/<section[^>]*class="squire-chat-context"[\s\S]*?<\/section>/)?.[0];
    expect(context).toContain('Second Campaign');
    // E8: an active campaign hides the per-session game selector.
    expect(body).not.toContain('squire-game-picker');
  });

  it('switches active campaign from the chat context panel and returns to chat', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const identity = identityFromSessionUser(owner.userId);
    await CampaignService.createCampaign(identity, {
      name: 'First Campaign',
      game: 'frosthaven',
    });
    const second = await CampaignService.createCampaign(identity, {
      name: 'Second Campaign',
      game: 'gloomhaven-2e',
    });

    const switchRes = await formPost(owner, '/chat/campaign-context', {
      campaignId: second.id,
      returnTo: '/',
    });
    expect(switchRes.status).toBe(303);
    expect(switchRes.headers.get('location')).toBe('/');
    const cookie = switchRes.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('squire_active_campaign');

    const home = await app.request('/', {
      headers: { Cookie: `${owner.cookie}; ${cookie.split(';')[0]}` },
    });
    const body = await home.text();
    const context = body.match(/<section[^>]*class="squire-chat-context"[\s\S]*?<\/section>/)?.[0];
    expect(context).toContain('Second Campaign');
    expect(body).toContain(`name="campaignId" value="${second.id}"`);
  });

  it('can switch chat to no-campaign mode and exposes the game picker in the ask area', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    await CampaignService.createCampaign(identityFromSessionUser(owner.userId), {
      name: 'Travel Campaign',
      game: 'frosthaven',
    });

    const switchRes = await formPost(owner, '/chat/campaign-context', {
      campaignId: '__none',
      returnTo: '/',
    });
    expect(switchRes.status).toBe(303);
    const cookie = switchRes.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('squire_active_campaign');

    const home = await app.request('/', {
      headers: { Cookie: `${owner.cookie}; ${cookie.split(';')[0]}` },
    });
    const body = await home.text();
    const header = body.match(/<header class="squire-header">[\s\S]*?<\/header>/)?.[0] ?? '';
    const context = body.match(/<section[^>]*class="squire-chat-context"[\s\S]*?<\/section>/)?.[0];
    const askForm = body.match(/<form[^>]*class="squire-input-dock"[\s\S]*?<\/form>/)?.[0];
    expect(header).not.toContain('Travel Campaign');
    expect(context).toContain('No campaign selected');
    expect(context).toContain('class="squire-game-picker"');
    expect(askForm).toContain(`name="game" value="frosthaven"`);
    expect(askForm).not.toContain('name="campaignId"');
  });

  it('lists pending invites distinctly and accepts via form post', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const member = await createTestUser(OUTSIDER_EMAIL);
    const identity = identityFromSessionUser(owner.userId);
    const campaign = await CampaignService.createCampaign(identity, {
      name: 'Invite Campaign',
      game: 'frosthaven',
    });
    const invite = await CampaignService.inviteMember(identity, campaign.id, OUTSIDER_EMAIL);

    const page = await pageRequest(member, '/campaigns');
    const body = await page.text();
    expect(body).toContain('Invitations');
    expect(body).toContain('Invite Campaign');

    const accept = await formPost(member, `/campaigns/invites/${invite.memberId}/accept`);
    expect(accept.status).toBe(303);
    expect(accept.headers.get('location')).toBe(`/campaigns/${campaign.id}`);
  });
});

describe('chat campaign binding (E6 web channel)', () => {
  it('stores the bound campaign on the user message; foreign ids unbind', async () => {
    const owner = await createTestUser(OWNER_EMAIL);
    const outsider = await createTestUser(OUTSIDER_EMAIL);
    const campaign = await CampaignService.createCampaign(identityFromSessionUser(owner.userId), {
      name: 'Bind Campaign',
      game: 'frosthaven',
    });

    const post = async (user: TestUser) => {
      const form = new FormData();
      form.set('question', 'What scenarios are open?');
      form.set('idempotencyKey', `key-${user.userId}`);
      form.set('campaignId', campaign.id);
      form.set('_csrf', createCsrfToken(user.sessionId));
      const res = await app.request('/chat', {
        method: 'POST',
        headers: { Cookie: user.cookie, 'HX-Request': 'true' },
        body: form,
      });
      return res;
    };

    const memberRes = await post(owner);
    expect(memberRes.status).toBe(200);
    // Assert via the persisted message: find the conversation through the
    // rendered transcript id embedded in the response HTML.
    const html = await memberRes.text();
    const match = html.match(/data-conversation-id="([0-9a-f-]{36})"/);
    expect(match).not.toBeNull();
    const messages = await MessageRepository.listByConversationId(match![1]);
    expect(messages[0]?.campaignId).toBe(campaign.id);

    // A non-member posting the same campaignId gets silently unbound.
    const outsiderRes = await post(outsider);
    expect(outsiderRes.status).toBe(200);
    const outsiderHtml = await outsiderRes.text();
    const outsiderMatch = outsiderHtml.match(/data-conversation-id="([0-9a-f-]{36})"/);
    expect(outsiderMatch).not.toBeNull();
    const outsiderMessages = await MessageRepository.listByConversationId(outsiderMatch![1]);
    expect(outsiderMessages[0]?.campaignId).toBeNull();
  });
});
