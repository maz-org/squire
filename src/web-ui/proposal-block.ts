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
 * Compact field summary for a staged character patch ("XP 150 · GOLD 24").
 * Shared with the write tools, which prefix the resolved
 * character name when they have one.
 */
export function characterPatchSummary(patch: {
  name?: string;
  className?: string;
  xp?: number;
  gold?: number;
  perks?: number[];
  perkMarks?: number;
  masteries?: number[];
}): string {
  const parts: string[] = [];
  if (patch.name !== undefined) parts.push(`RENAME → ${patch.name.toUpperCase()}`);
  if (patch.className !== undefined) parts.push(patch.className.toUpperCase());
  if (patch.xp !== undefined) parts.push(`XP ${patch.xp}`);
  if (patch.gold !== undefined) parts.push(`GOLD ${patch.gold}`);
  if (patch.perks !== undefined) parts.push(`PERKS ${patch.perks.length}`);
  if (patch.perkMarks !== undefined) parts.push(`PERK MARKS ${patch.perkMarks}`);
  if (patch.masteries !== undefined) parts.push(`MASTERIES ${patch.masteries.length}`);
  return parts.join(' · ') || 'UPDATED';
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
    case 'character.update':
      return [`CHARACTER → ${characterPatchSummary(staged.patch)}`];
    case 'batch':
      // One line per member, in staged order — the whole session at a glance.
      return staged.mutations.flatMap((member) => stagedMutationLines(member));
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
