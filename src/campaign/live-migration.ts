/**
 * One-time import of the live prototype GH2e campaign (SQR-273).
 *
 * The Replit campaign tracker stores played/drawn scenarios as numeric ids:
 * 4xxx for GH2e mains (4014 = printed scenario 14) and 3xxx for solo
 * scenarios numbered by their position in the prototype's solo list — the
 * same order the solo2e extract preserved, so 3001 maps to the first
 * solo2e key ('bruiser'), 3008 to the eighth ('silent-knife').
 *
 * Idempotent on campaign identity: repeatable against fresh exports until
 * cutover (find by name + owner membership, else create). Writes ride
 * CampaignService with the owner's identity, so audit rows record the
 * import like any other mutation. Recurring sync is Phase 6 — this is a
 * one-time operational step (docs/runbooks/production-operations.md).
 */
import { z } from 'zod';

import * as UserRepository from '../db/repositories/user-repository.ts';
import { readUnlockGraphExtracts } from '../seed/seed-unlock-graphs.ts';
import * as CampaignService from './campaign-service.ts';
import { deriveAvailability } from './availability.ts';
import { identityFromSessionUser } from './identity.ts';
import { loadModuleGraphs } from './unlock-graph-loader.ts';

export const LiveCaptureSchema = z.object({
  name: z.string().min(1),
  modules: z.array(z.string().min(1)).min(1),
  played: z.array(z.number().int()),
  drawn: z.array(z.number().int()),
});

export type LiveCapture = z.infer<typeof LiveCaptureSchema>;

const GH2E_GAME = 'gloomhaven-2e';

/** Map one prototype numeric id to a module-qualified scenario key. */
export function mapPrototypeId(id: number, solo2eKeys: readonly string[]): string {
  if (id >= 4000 && id < 5000) return `gh2e:${id - 4000}`;
  if (id >= 3000 && id < 4000) {
    const key = solo2eKeys[id - 3001];
    if (!key) throw new Error(`Prototype solo id ${id} has no solo2e extract entry`);
    return `solo2e:${key}`;
  }
  throw new Error(`Unmappable prototype scenario id: ${id}`);
}

export interface LiveMigrationResult {
  campaignId: string;
  created: boolean;
  updated: boolean;
  playedScenarios: string[];
  drawnScenarios: string[];
  /** Mapped keys the seeded graphs do not know — must be empty at cutover. */
  unknownKeys: string[];
}

export async function migrateLiveCampaign(
  capture: LiveCapture,
  ownerEmail: string,
): Promise<LiveMigrationResult> {
  const owner = await UserRepository.findByEmail(ownerEmail);
  if (!owner) {
    throw new Error(
      `No user with email ${ownerEmail} — the owner must have logged in once before the import`,
    );
  }
  const identity = identityFromSessionUser(owner.id);

  const solo2eKeys =
    readUnlockGraphExtracts()
      .find((extract) => extract.module === 'solo2e')
      ?.scenarios.map((scenario) => scenario.key) ?? [];
  const playedScenarios = capture.played.map((id) => mapPrototypeId(id, solo2eKeys));
  const drawnScenarios = capture.drawn.map((id) => mapPrototypeId(id, solo2eKeys));

  let created = false;
  let campaign = (await CampaignService.listMyCampaigns(identity)).find(
    (candidate) => candidate.name === capture.name && candidate.game === GH2E_GAME,
  );
  if (!campaign) {
    campaign = await CampaignService.createCampaign(identity, {
      name: capture.name,
      game: GH2E_GAME,
      modules: capture.modules,
    });
    created = true;
  }

  const sameState =
    JSON.stringify([campaign.playedScenarios, campaign.drawnScenarios]) ===
    JSON.stringify([playedScenarios, drawnScenarios]);
  let updated = false;
  if (!sameState) {
    campaign = await CampaignService.updateSharedState(identity, campaign.id, {
      expectedVersion: campaign.version,
      playedScenarios,
      drawnScenarios,
    });
    updated = true;
  }

  const graphs = await loadModuleGraphs(GH2E_GAME, campaign.modules);
  const { unknownKeys } = deriveAvailability(
    graphs,
    new Set(playedScenarios),
    new Set(drawnScenarios),
  );

  return {
    campaignId: campaign.id,
    created,
    updated,
    playedScenarios,
    drawnScenarios,
    unknownKeys,
  };
}
