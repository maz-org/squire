/**
 * Confirmation-block vocabulary (SQR-286) — ledger-voiced preview lines for
 * a staged destructive mutation, rendered in chat as consent chrome
 * (DESIGN.md §Confirmation block).
 *
 * The preview describes the PATCH (the requested end state), not a diff —
 * the proposal does not carry before-state, and the confirmation block must
 * never invent detail. Diff-voiced lines ("SCENARIO 14 · PLAYED") remain the
 * journal's job after the write applies.
 */
import { StagedMutationSchema } from '../campaign/pending-mutations.ts';

function shortKey(qualified: string): string {
  return (qualified.split(':')[1] ?? qualified).toUpperCase();
}

function listLine(label: string, keys: string[]): string {
  if (keys.length === 0) return `${label} → NONE`;
  return `${label} → ${keys.map(shortKey).join(', ')}`;
}

/**
 * One small-caps line per staged change. Unknown shapes fall back to the
 * ledger-cased mutation type rather than throwing — the block is consent
 * chrome and must render something honest for anything the store accepted.
 */
export function stagedMutationLines(mutation: unknown): string[] {
  const parsed = StagedMutationSchema.safeParse(mutation);
  if (!parsed.success) {
    const type =
      mutation && typeof mutation === 'object' && 'type' in mutation
        ? String((mutation as { type: unknown }).type)
        : 'unknown change';
    return [type.replace(/[._]/g, ' ').toUpperCase()];
  }

  const staged = parsed.data;
  switch (staged.type) {
    case 'campaign.delete':
      return ['CAMPAIGN · DELETE'];
    case 'member.remove':
      return ['MEMBER · REMOVE'];
    case 'character.delete':
      return ['CHARACTER · DELETE'];
    case 'character.retire':
      return ['CHARACTER · RETIRE'];
    case 'campaign.update': {
      // The staged patch schema only admits the destructive-capable fields
      // (prosperity decrease, scenario list shrink) — mirror it exactly.
      const lines: string[] = [];
      const patch = staged.patch;
      if (patch.prosperity !== undefined) lines.push(`PROSPERITY → ${patch.prosperity}`);
      if (patch.playedScenarios !== undefined) {
        lines.push(listLine('SCENARIOS PLAYED', patch.playedScenarios));
      }
      if (patch.drawnScenarios !== undefined) {
        lines.push(listLine('SCENARIOS DRAWN', patch.drawnScenarios));
      }
      return lines.length > 0 ? lines : ['CAMPAIGN UPDATE'];
    }
  }
}
