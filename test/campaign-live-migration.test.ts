/**
 * Live GH2e campaign import tests (SQR-273).
 *
 * Runs the real migration against the checked-in prototype capture and
 * cross-checks the imported campaign's derived statuses against the
 * SQR-268 golden fixture — the same statuses the live prototype rendered
 * for this exact state, computed independently at capture time.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.SESSION_SECRET = 'test-session-secret-must-be-at-least-32-characters-long';

import { getDb, shutdownServerPool } from '../src/db.ts';
import {
  LiveCaptureSchema,
  mapPrototypeId,
  migrateLiveCampaign,
} from '../src/campaign/live-migration.ts';
import { deriveAvailability } from '../src/campaign/availability.ts';
import { loadModuleGraphs } from '../src/campaign/unlock-graph-loader.ts';
import * as CampaignRepository from '../src/db/repositories/campaign-repository.ts';
import { seedUnlockGraphs } from '../src/seed/seed-unlock-graphs.ts';
import { users } from '../src/db/schema/core.ts';
import { resetTestDb, setupTestDb, teardownTestDb } from './helpers/db.ts';

const OWNER_EMAIL = 'bcm@maz.org';

const capture = LiveCaptureSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), 'test/fixtures/gh2e-campaign-live.json'), 'utf8')),
);

const golden = JSON.parse(
  readFileSync(join(process.cwd(), 'test/fixtures/unlock-graphs/gh2e-live-campaign.json'), 'utf8'),
) as { played: string[]; drawn: string[]; expectedStatuses: Record<string, string> };

beforeAll(async () => {
  await setupTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  process.env.SQUIRE_ALLOWED_EMAILS = OWNER_EMAIL;
  const { db } = getDb('server');
  await seedUnlockGraphs(db);
  await db.insert(users).values({
    email: OWNER_EMAIL,
    googleSub: 'google-sub-bcm',
    name: 'Brian',
  });
});

afterAll(async () => {
  delete process.env.SQUIRE_ALLOWED_EMAILS;
  await teardownTestDb();
  await shutdownServerPool();
});

describe('mapPrototypeId', () => {
  it('maps main and solo ids through the SQR-267 scheme', () => {
    const solo2eKeys = ['bruiser', 'spellweaver'];
    expect(mapPrototypeId(4014, solo2eKeys)).toBe('gh2e:14');
    expect(mapPrototypeId(4001, solo2eKeys)).toBe('gh2e:1');
    expect(mapPrototypeId(3001, solo2eKeys)).toBe('solo2e:bruiser');
    expect(() => mapPrototypeId(3099, solo2eKeys)).toThrow('no solo2e extract entry');
    expect(() => mapPrototypeId(123, solo2eKeys)).toThrow('Unmappable');
  });
});

describe('migrateLiveCampaign', () => {
  it('imports the capture and reproduces the live prototype statuses exactly', async () => {
    const result = await migrateLiveCampaign(capture, OWNER_EMAIL);
    expect(result.created).toBe(true);
    expect(result.updated).toBe(true);
    expect(result.unknownKeys).toEqual([]);
    expect(result.playedScenarios.sort()).toEqual([...golden.played].sort());
    expect(result.drawnScenarios.sort()).toEqual([...golden.drawn].sort());

    const campaign = await CampaignRepository.findById(result.campaignId);
    expect(campaign?.game).toBe('gloomhaven-2e');
    expect(campaign?.modules).toEqual(['gh2e', 'solo2e']);

    // The cutover proof: the imported campaign derives the exact statuses
    // the prototype rendered (independently captured golden fixture).
    const graphs = await loadModuleGraphs('gloomhaven-2e', campaign!.modules);
    const { statuses } = deriveAvailability(
      graphs,
      new Set(campaign!.playedScenarios),
      new Set(campaign!.drawnScenarios),
    );
    expect(Object.fromEntries([...statuses.entries()].sort())).toEqual(golden.expectedStatuses);
  });

  it('is idempotent on campaign identity', async () => {
    const first = await migrateLiveCampaign(capture, OWNER_EMAIL);
    const second = await migrateLiveCampaign(capture, OWNER_EMAIL);
    expect(second.campaignId).toBe(first.campaignId);
    expect(second.created).toBe(false);
    expect(second.updated).toBe(false);

    // A fresh export with new progress updates the same campaign in place.
    const progressed = { ...capture, played: [...capture.played, 4006] };
    const third = await migrateLiveCampaign(progressed, OWNER_EMAIL);
    expect(third.campaignId).toBe(first.campaignId);
    expect(third.updated).toBe(true);
    expect(third.playedScenarios).toContain('gh2e:6');
  });

  it('fails clearly when the owner has never logged in', async () => {
    await expect(migrateLiveCampaign(capture, 'stranger@example.com')).rejects.toThrow(
      'must have logged in once',
    );
  });
});
