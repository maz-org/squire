/**
 * Eval campaign fixture seeding (SQR-272): idempotent, and the planted
 * private-tier canary stays owner-only through the context projection.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.SESSION_SECRET = 'test-session-secret-must-be-at-least-32-characters-long';

import { shutdownServerPool } from '../src/db.ts';
import {
  ensureCampaignFixture,
  EVAL_INJECTION_CHARACTER_NAME,
  EVAL_ONBOARDER_EMAIL,
  EVAL_PRIVATE_PQ_CANARY,
} from '../eval/campaign-fixture.ts';
import * as CampaignService from '../src/campaign/campaign-service.ts';
import { loadCampaignContext, renderCampaignContextBlock } from '../src/campaign/context.ts';
import { identityFromSessionUser } from '../src/campaign/identity.ts';
import { resetTestDb, setupTestDb, teardownTestDb } from './helpers/db.ts';

beforeAll(async () => {
  await setupTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

afterAll(async () => {
  await teardownTestDb();
  await shutdownServerPool();
});

describe('ensureCampaignFixture', () => {
  it('seeds idempotently and keeps the canary out of the owner context block', async () => {
    const first = await ensureCampaignFixture('gh2e-personalization');
    const second = await ensureCampaignFixture('gh2e-personalization');
    expect(second).toEqual(first);

    const fh = await ensureCampaignFixture('fh-personalization');
    expect(fh.campaignId).not.toBe(first.campaignId);
    expect(fh.userId).toBe(first.userId);

    await expect(ensureCampaignFixture('nope')).rejects.toThrow('Unknown campaign fixture');

    // The eval owner's context contains the companion character only through
    // the member-visible projection — the canary cannot enter the prompt.
    const view = await loadCampaignContext(
      identityFromSessionUser(first.userId),
      first.campaignId!,
      first.activeCharacterId,
    );
    expect(view.otherCharacters.map((c) => c.name)).toContain('Eval Companion');
    expect(renderCampaignContextBlock(view)).not.toContain(EVAL_PRIVATE_PQ_CANARY);
    expect(view.ownCharacters[0]?.gold).toBe(25);
  });

  it('keeps the writes-fixture injection name inside the data fence (SQR-288)', async () => {
    const writes = await ensureCampaignFixture('gh2e-writes');
    expect(writes.campaignId).toBeDefined();
    const view = await loadCampaignContext(
      identityFromSessionUser(writes.userId),
      writes.campaignId!,
      writes.activeCharacterId,
    );
    expect(view.otherCharacters.map((c) => c.name)).toContain(EVAL_INJECTION_CHARACTER_NAME);
    // Member-authored content rides INSIDE <campaign_data>, after the
    // instructions that declare it data — never in instruction position.
    const block = renderCampaignContextBlock(view);
    expect(block.indexOf(EVAL_INJECTION_CHARACTER_NAME)).toBeGreaterThan(
      block.indexOf('<campaign_data>'),
    );
  });

  it('onboarding-fresh starts from zero, allowlisted, and cleans up prior runs', async () => {
    const savedAllowlist = process.env.SQUIRE_ALLOWED_EMAILS;
    process.env.SQUIRE_ALLOWED_EMAILS = 'someone@else.com';
    try {
      const fixture = await ensureCampaignFixture('onboarding-fresh');
      expect(fixture.campaignId).toBeUndefined();
      expect(process.env.SQUIRE_ALLOWED_EMAILS).toContain(EVAL_ONBOARDER_EMAIL);

      // A campaign the previous eval run created is removed on re-seed.
      const identity = identityFromSessionUser(fixture.userId);
      await CampaignService.createCampaign(identity, { name: 'Leftover Run', game: 'frosthaven' });
      const again = await ensureCampaignFixture('onboarding-fresh');
      expect(again.userId).toBe(fixture.userId);
      expect(await CampaignService.listMyCampaigns(identity)).toEqual([]);
    } finally {
      if (savedAllowlist === undefined) delete process.env.SQUIRE_ALLOWED_EMAILS;
      else process.env.SQUIRE_ALLOWED_EMAILS = savedAllowlist;
    }
  });
});
