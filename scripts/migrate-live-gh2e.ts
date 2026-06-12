/**
 * CLI: one-time import of the live prototype GH2e campaign (SQR-273).
 *
 * Usage: `npm run migrate:live-gh2e -- <capture.json> [owner-email]`
 * Repeatable against a fresh export until cutover — idempotent on
 * campaign identity. See docs/runbooks/production-operations.md.
 */
import 'dotenv/config';

import { readFileSync } from 'node:fs';

import { getDb } from '../src/db.ts';
import { LiveCaptureSchema, migrateLiveCampaign } from '../src/campaign/live-migration.ts';

const DEFAULT_OWNER_EMAIL = 'bcm@maz.org';

async function main(): Promise<void> {
  const [capturePath, ownerEmail = DEFAULT_OWNER_EMAIL] = process.argv.slice(2);
  if (!capturePath) {
    console.error('Usage: npm run migrate:live-gh2e -- <capture.json> [owner-email]');
    process.exit(2);
  }

  const capture = LiveCaptureSchema.parse(JSON.parse(readFileSync(capturePath, 'utf8')));
  const { close } = getDb('cli');
  try {
    const result = await migrateLiveCampaign(capture, ownerEmail);
    console.log(
      `✓ campaign ${result.campaignId} (${result.created ? 'created' : 'existing'}, ` +
        `${result.updated ? 'state updated' : 'state unchanged'})`,
    );
    console.log(`  played: ${result.playedScenarios.join(', ')}`);
    console.log(`  drawn:  ${result.drawnScenarios.join(', ')}`);
    if (result.unknownKeys.length > 0) {
      console.warn(`⚠ keys unknown to the seeded graphs: ${result.unknownKeys.join(', ')}`);
      process.exit(1);
    }
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
