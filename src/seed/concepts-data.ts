/**
 * Curated concept seed lists (ADR 0027, SQR-402).
 *
 * Source of record for `knowledge_concepts` — each entry becomes a
 * `concept:<game>/<slug>` node. Curation rules: every concept must have a
 * printed rulebook definition (the ingest quality report flags any that
 * fail to match one), and aliases are surface forms a player would type,
 * matched on word boundaries. Terms too generic to match usefully
 * ("attack", "move") stay out.
 */

import { FROSTHAVEN_GAME_ID, GLOOMHAVEN_2E_GAME_ID, type GameId } from '../game.ts';

export interface ConceptSeed {
  slug: string;
  name: string;
  category: 'condition' | 'keyword' | 'mechanic';
  aliases: string[];
}

const SHARED_CONDITIONS: ConceptSeed[] = [
  { slug: 'muddle', name: 'Muddle', category: 'condition', aliases: ['muddled'] },
  { slug: 'poison', name: 'Poison', category: 'condition', aliases: ['poisoned'] },
  { slug: 'wound', name: 'Wound', category: 'condition', aliases: ['wounded'] },
  { slug: 'immobilize', name: 'Immobilize', category: 'condition', aliases: ['immobilized'] },
  { slug: 'disarm', name: 'Disarm', category: 'condition', aliases: ['disarmed'] },
  { slug: 'stun', name: 'Stun', category: 'condition', aliases: ['stunned'] },
  { slug: 'curse', name: 'Curse', category: 'condition', aliases: ['cursed'] },
  { slug: 'bless', name: 'Bless', category: 'condition', aliases: ['blessed'] },
  {
    slug: 'strengthen',
    name: 'Strengthen',
    category: 'condition',
    aliases: ['strengthened'],
  },
  { slug: 'invisible', name: 'Invisible', category: 'condition', aliases: ['invisibility'] },
  { slug: 'regenerate', name: 'Regenerate', category: 'condition', aliases: ['regeneration'] },
  { slug: 'brittle', name: 'Brittle', category: 'condition', aliases: [] },
  { slug: 'bane', name: 'Bane', category: 'condition', aliases: [] },
  { slug: 'ward', name: 'Ward', category: 'condition', aliases: ['warded'] },
  { slug: 'impair', name: 'Impair', category: 'condition', aliases: ['impaired'] },
];

const SHARED_KEYWORDS: ConceptSeed[] = [
  { slug: 'advantage', name: 'Advantage', category: 'keyword', aliases: [] },
  { slug: 'disadvantage', name: 'Disadvantage', category: 'keyword', aliases: [] },
  { slug: 'retaliate', name: 'Retaliate', category: 'keyword', aliases: [] },
  { slug: 'shield', name: 'Shield', category: 'keyword', aliases: [] },
  { slug: 'pierce', name: 'Pierce', category: 'keyword', aliases: [] },
  { slug: 'push', name: 'Push', category: 'keyword', aliases: [] },
  { slug: 'pull', name: 'Pull', category: 'keyword', aliases: [] },
  { slug: 'loot', name: 'Loot', category: 'keyword', aliases: ['looting'] },
  { slug: 'jump', name: 'Jump', category: 'keyword', aliases: [] },
  { slug: 'flying', name: 'Flying', category: 'keyword', aliases: ['fly'] },
  { slug: 'teleport', name: 'Teleport', category: 'keyword', aliases: [] },
  { slug: 'target', name: 'Target', category: 'keyword', aliases: ['targets', 'targeting'] },
];

const SHARED_MECHANICS: ConceptSeed[] = [
  {
    slug: 'line-of-sight',
    name: 'Line of Sight',
    category: 'mechanic',
    aliases: ['line-of-sight'],
  },
  { slug: 'initiative', name: 'Initiative', category: 'mechanic', aliases: [] },
  { slug: 'long-rest', name: 'Long Rest', category: 'mechanic', aliases: ['long resting'] },
  { slug: 'short-rest', name: 'Short Rest', category: 'mechanic', aliases: ['short resting'] },
  { slug: 'exhaustion', name: 'Exhaustion', category: 'mechanic', aliases: ['exhausted'] },
  // The rulebooks write card loss as "loss"; "lost card" never appears
  // verbatim in the corpus.
  { slug: 'lost-card', name: 'Lost Card', category: 'mechanic', aliases: ['lost cards', 'loss'] },
  {
    slug: 'persistent',
    name: 'Persistent',
    category: 'mechanic',
    aliases: ['persistent bonus'],
  },
  { slug: 'focus', name: 'Focus', category: 'mechanic', aliases: [] },
  { slug: 'elements', name: 'Elements', category: 'mechanic', aliases: ['element', 'infuse'] },
];

export const CONCEPT_SEEDS: Record<GameId, ConceptSeed[]> = {
  [FROSTHAVEN_GAME_ID]: [
    ...SHARED_CONDITIONS,
    ...SHARED_KEYWORDS,
    ...SHARED_MECHANICS,
    {
      slug: 'two-speed-initiative',
      name: 'Two-Speed Initiative',
      category: 'mechanic',
      // Blinkblade's fast/slow tempo choice; players ask with these words.
      aliases: ['fast or slow', 'time tokens'],
    },
  ],
  [GLOOMHAVEN_2E_GAME_ID]: [
    // Regenerate, bane, and impair have zero presence in the indexed GH2e
    // corpus (rulebook, FAQ, errata, cards), so they get no node there.
    // Brittle stays: its rulebook chunk lacks the word (icon-table
    // extraction gap) but the FAQ clarifies it — the seed report flags the
    // missing definition rather than hiding it.
    ...SHARED_CONDITIONS.filter(
      (concept) => !['regenerate', 'bane', 'impair'].includes(concept.slug),
    ),
    ...SHARED_KEYWORDS,
    ...SHARED_MECHANICS,
  ],
};
