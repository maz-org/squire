/**
 * Confirmation-block preview vocabulary (SQR-286). The lines are consent
 * chrome — they must describe the staged patch exactly and never invent
 * detail, and unknown shapes must still render something honest.
 */
import { describe, expect, it } from 'vitest';

import { stagedMutationLines } from '../src/web-ui/proposal-block.ts';

describe('stagedMutationLines', () => {
  it('renders the enumerated destructive set', () => {
    expect(stagedMutationLines({ type: 'campaign.delete' })).toEqual(['CAMPAIGN · DELETE']);
    expect(
      stagedMutationLines({
        type: 'member.remove',
        memberId: '00000000-0000-4000-8000-000000000001',
      }),
    ).toEqual(['MEMBER · REMOVE']);
    expect(
      stagedMutationLines({
        type: 'character.delete',
        characterId: '00000000-0000-4000-8000-000000000002',
      }),
    ).toEqual(['CHARACTER · DELETE']);
    expect(
      stagedMutationLines({
        type: 'character.retire',
        characterId: '00000000-0000-4000-8000-000000000002',
      }),
    ).toEqual(['CHARACTER · RETIRE']);
  });

  it('describes campaign.update patches field by field', () => {
    expect(
      stagedMutationLines({
        type: 'campaign.update',
        patch: { prosperity: 2, playedScenarios: ['fh:1', 'fh:14'] },
      }),
    ).toEqual(['PROSPERITY → 2', 'SCENARIOS PLAYED → 1, 14']);
    expect(stagedMutationLines({ type: 'campaign.update', patch: { drawnScenarios: [] } })).toEqual(
      ['SCENARIOS DRAWN → NONE'],
    );
  });

  it('falls back to a ledger-cased type for unknown shapes instead of throwing', () => {
    expect(stagedMutationLines({ type: 'campaign.nuke' })).toEqual(['CAMPAIGN NUKE']);
    expect(stagedMutationLines(null)).toEqual(['UNKNOWN CHANGE']);
    expect(stagedMutationLines('garbage')).toEqual(['UNKNOWN CHANGE']);
  });
});
