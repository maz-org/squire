import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockMessagesStream, mockMessagesCreate, mockSearchKnowledge, mockLookupEntity } =
  vi.hoisted(() => ({
    mockMessagesStream: vi.fn(),
    mockMessagesCreate: vi.fn(),
    mockSearchKnowledge: vi.fn(),
    mockLookupEntity: vi.fn(),
  }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockMessagesCreate, stream: mockMessagesStream };
  },
}));

vi.mock('../src/tools.ts', () => ({
  inspectSources: vi.fn(),
  getSchema: vi.fn(),
  resolveEntity: vi.fn(),
  lookupEntity: mockLookupEntity,
  openEntity: vi.fn(),
  searchKnowledge: mockSearchKnowledge,
  neighbors: vi.fn(),
  searchRules: vi.fn(),
  searchCards: vi.fn(),
  listCardTypes: vi.fn(),
  listCards: vi.fn(),
  getCard: vi.fn(),
  findScenario: vi.fn(),
  getScenario: vi.fn(),
  getSection: vi.fn(),
  followLinks: vi.fn(),
}));

vi.mock('../src/campaign/write-tools.ts', () => ({
  writeCampaignState: vi.fn(),
  writeCharacterState: vi.fn(),
  proposeStateChange: vi.fn(),
  confirmStateChange: vi.fn(),
  cancelStateChange: vi.fn(),
  createCampaign: vi.fn(),
  createCharacter: vi.fn(),
  inviteMember: vi.fn(),
}));

import {
  classifyQuestionLane,
  classifyTraversalShape,
  INSUFFICIENT_EVIDENCE_SENTINEL,
  monsterStatLines,
  projectRecordContent,
  projectSearchContent,
  runFastLane,
} from '../src/agent-fastlane.ts';
import type { CampaignContextView } from '../src/campaign/context.ts';

function streamResponse(text: string, deltas?: string[]) {
  const handlers: Record<string, (payload: string) => void> = {};
  return {
    on(event: string, handler: (payload: string) => void) {
      handlers[event] = handler;
    },
    async finalMessage() {
      for (const delta of deltas ?? [text]) handlers.text?.(delta);
      return {
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 900, output_tokens: 120 },
      };
    },
  };
}

const searchHit = JSON.stringify({
  ok: true,
  results: [
    {
      ref: 'rules:frosthaven/fh-rule-book.pdf#chunk=84',
      text: 'At the end of every round, all infused elements wane, moving one column to the left.',
      citations: [{ sourceLabel: 'Rulebook' }],
    },
  ],
});

const lookupHit = JSON.stringify({
  ok: true,
  entity: {
    kind: 'card',
    ref: 'card:frosthaven/items/gloomhavensecretariat:item/002',
    title: 'Crude Helmet',
    data: { type: 'items', name: 'Crude Helmet', number: '002' },
  },
  citations: [{ sourceLabel: 'Card Index' }],
});

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SQUIRE_DISABLE_FAST_LANE;
  // Default: the unconditional parallel lookup misses unless a test primes it.
  mockLookupEntity.mockResolvedValue({ ok: false, error: { code: 'not_found' } });
});

describe('classifyQuestionLane', () => {
  it('routes definition and lookup questions to the fast lane', () => {
    expect(classifyQuestionLane('What does the Poison condition do in Frosthaven?')).toBe('fast');
    expect(classifyQuestionLane('What does Frosthaven item #002, Crude Helmet, do?')).toBe('fast');
    expect(classifyQuestionLane('How does advantage work with attack modifier cards?')).toBe(
      'fast',
    );
    expect(classifyQuestionLane('What is the initiative value of a long rest?')).toBe('fast');
  });

  it('routes record-anchored traversal fast; unanchored, comparisons, and writes deep', () => {
    // SQR-404: link-following questions anchored to one numbered record ride
    // the fast traversal chain (open → neighbors → open targets).
    expect(
      classifyQuestionLane('Which scenario does the conclusion of Frosthaven scenario 10 unlock?'),
    ).toBe('fast');
    expect(
      classifyQuestionLane('In Gloomhaven 2e, which scenario is section 10.3 attached to?'),
    ).toBe('fast');
    expect(classifyQuestionLane('What unlocks the Meteor class?')).toBe('deep');
    expect(
      classifyQuestionLane('Compare the stats of all flying monsters at level 3 in Frosthaven'),
    ).toBe('deep');
    expect(classifyQuestionLane('Mark scenario 10 complete on my campaign scenario list')).toBe(
      'deep',
    );
  });

  it('extracts traversal shape from record-anchored link questions', () => {
    expect(classifyTraversalShape('What does the conclusion of scenario 10 unlock?')).toEqual({
      kind: 'scenario',
      id: '10',
      relationHint: 'conclusion',
    });
    expect(classifyTraversalShape('Which scenario is section 10.3 attached to?')).toEqual({
      kind: 'section',
      id: '10.3',
      relationHint: 'parent',
    });
    expect(classifyTraversalShape('Which section do you read now after scenario 2?')).toEqual({
      kind: 'scenario',
      id: '2',
      relationHint: 'read_now',
    });
    // Incoming direction: the record number follows "unlocks".
    expect(
      classifyTraversalShape('What section text unlocks scenario 61 (Life and Death)?'),
    ).toEqual({ kind: 'scenario', id: '61', relationHint: 'unlocked_by' });
    // No record number → no shape; plain lookups → no shape.
    expect(classifyTraversalShape('What unlocks the Meteor class?')).toBeNull();
    expect(classifyTraversalShape('What does scenario 61 give as rewards?')).toBeNull();
  });

  it('routes conditional and procedural FAQ phrasings to the fast lane', () => {
    // Recall gaps found in the first dev-split run (SQR-399): these went to
    // the deep lane and failed latency budgets despite being single-fact.
    expect(classifyQuestionLane('When I lose a card to avoid all damage, do I lose Ward?')).toBe(
      'fast',
    );
    expect(
      classifyQuestionLane(
        'In Gloomhaven 2e, if an attack’s range is reduced to 1, does it become a melee attack?',
      ),
    ).toBe('fast');
    expect(
      classifyQuestionLane(
        'When a monster is attacking more than one target, what order are those attacks made in?',
      ),
    ).toBe('fast');
    expect(
      classifyQuestionLane('What happens to the cards in my active area when I become exhausted?'),
    ).toBe('fast');
  });

  it('game-qualifies legacy refs so GH2e groundedness holds (SQR-381 parity)', async () => {
    mockSearchKnowledge.mockResolvedValueOnce({
      ok: true,
      results: [
        {
          sourceId: 'gloomhavensecretariat:item/009',
          text: 'Focusing Rod effect text',
          citations: [{ sourceLabel: 'Card Index' }],
        },
      ],
    });
    mockMessagesStream.mockReturnValueOnce(
      streamResponse('Focusing Rod is item #009. (Card Index)'),
    );

    const result = await runFastLane('What does Gloomhaven 2e item #009 do?', {
      game: 'gloomhaven-2e',
    });

    expect(result).not.toBeNull();
    const refs = result!.trajectory.toolCalls.flatMap((call) => call.canonicalRefs);
    expect(refs).toContain('card:gloomhaven-2e/items/gloomhavensecretariat:item/009');
    expect(refs).not.toContain('gloomhavensecretariat:item/009');
  });

  it('routes questions naming both games to the deep lane (SQR-412)', () => {
    // The fast lane retrieves in one game; cross-game comparisons need
    // per-game opens (gate-1 traj-invalid-cross-game-ref).
    expect(
      classifyQuestionLane(
        'Resolve section 67.1 in Frosthaven and then resolve section 67.1 with an explicit Gloomhaven 2e game. Explain whether they are the same section.',
      ),
    ).toBe('deep');
    expect(
      classifyQuestionLane('Is Frosthaven scenario 1 the same as Gloomhaven scenario 1?'),
    ).toBe('deep');
    // Single-game mentions keep their fast routing.
    expect(classifyQuestionLane('What does the Poison condition do in Frosthaven?')).toBe('fast');
    expect(classifyQuestionLane('What is the initiative of a long rest in Gloomhaven 2e?')).toBe(
      'fast',
    );
  });

  it('routes monster decision simulation deep, keeps capability questions fast (SQR-413)', () => {
    // Choosing between alternatives needs several rules synthesized (focus,
    // negative hexes, disadvantage) — deep lane work.
    expect(
      classifyQuestionLane(
        'If a monster has a choice between attacking at disadvantage or moving through hazardous terrain, which does it pick?',
      ),
    ).toBe('deep');
    expect(
      classifyQuestionLane(
        'A monster stands adjacent to my character with a ranged attack. What would it choose in Gloomhaven 2e?',
      ),
    ).toBe('deep');
    expect(
      classifyQuestionLane('Which target does the monster prioritize when two are tied?'),
    ).toBe('deep');
    // Single-rule capability and record questions keep their fast routing.
    expect(classifyQuestionLane('Can a monster focus a hidden character in Frosthaven?')).toBe(
      'fast',
    );
    expect(
      classifyQuestionLane(
        'For Gloomhaven 2e Bloated Victim, what initiative and abilities are on the Rotting Embrace monster ability card?',
      ),
    ).toBe('fast');
    expect(
      classifyQuestionLane(
        'When a monster is attacking more than one target, what order are those attacks made in?',
      ),
    ).toBe('fast');
  });

  it('routes campaign context and abstentions to the deep lane', () => {
    expect(
      classifyQuestionLane('What items can I afford?', {
        campaignContext: { campaign: { id: 'c1' } } as unknown as CampaignContextView,
      }),
    ).toBe('deep');
    expect(classifyQuestionLane('What items can I afford?', { campaignId: 'c1' })).toBe('deep');
    // No fast pattern, no deep pattern → abstain to deep.
    expect(classifyQuestionLane('Tell me about Frosthaven.')).toBe('deep');
  });
});

describe('evidence projection (SQR-411)', () => {
  it('projects search hits to ref, source, and capped text', () => {
    const content = JSON.stringify({
      ok: true,
      results: [
        {
          entity: {
            kind: 'rules_passage',
            ref: 'rules:frosthaven/x#chunk=1',
            title: 'Loot',
            sourceLabel: 'Rulebook',
          },
          score: 0.91,
          snippet: 'S'.repeat(2000),
          citations: [
            {
              sourceRef: 'source:frosthaven/rulebook',
              sourceLabel: 'Rulebook',
              locator: 'passage 42',
            },
          ],
          nextRefs: [{ kind: 'section', ref: 'section:frosthaven/1.1' }],
        },
      ],
    });
    const projected = JSON.parse(projectSearchContent(content)) as Array<Record<string, unknown>>;
    expect(projected).toHaveLength(1);
    expect(projected[0].ref).toBe('rules:frosthaven/x#chunk=1');
    expect(projected[0].source).toBe('Rulebook, passage 42');
    expect((projected[0].text as string).length).toBe(2000);
    expect(JSON.stringify(projected)).not.toContain('nextRefs');
    expect(JSON.stringify(projected)).not.toContain('0.91');
  });

  it('keeps structured entity data on search hits and trims snippets at sentence boundaries', () => {
    const sentence = 'The Long Shot card grants Attack 3 with Range 7. ';
    const content = JSON.stringify({
      ok: true,
      results: [
        {
          entity: {
            kind: 'card',
            ref: 'card:gloomhaven-2e/monster-abilities/long-shot',
            sourceLabel: 'Ability Deck',
            data: {
              initiative: 46,
              abilities: ['Attack 3', 'Range 7'],
              rawText: 'R'.repeat(3000),
            },
          },
          snippet: sentence.repeat(60),
        },
      ],
    });
    const projected = JSON.parse(projectSearchContent(content)) as Array<{
      text: string;
      data?: Record<string, unknown>;
    }>;
    expect(projected[0].data?.initiative).toBe(46);
    expect(projected[0].data?.abilities).toEqual(['Attack 3', 'Range 7']);
    expect(projected[0].data?.rawText).toBeUndefined();
    // Sentence-boundary trim: ends on a full sentence, never mid-claim.
    expect(projected[0].text.length).toBeLessThanOrEqual(2000);
    expect(projected[0].text.endsWith('Range 7.')).toBe(true);
  });

  it('keeps record data fields intact while capping prose and dropping links', () => {
    const content = JSON.stringify({
      ok: true,
      entity: {
        kind: 'card',
        ref: 'card:frosthaven/items/1',
        title: 'Boots',
        data: { lost: false, spent: true, cost: 20, rawText: 'R'.repeat(6000) },
      },
      citations: [{ sourceLabel: 'Card Index' }],
      links: [{ relation: 'x', target: {} }],
      related: [],
    });
    const projected = JSON.parse(projectRecordContent(content)) as {
      entity: { data: Record<string, unknown> };
      links?: unknown;
    };
    expect(projected.entity.data.lost).toBe(false);
    expect(projected.entity.data.spent).toBe(true);
    expect(projected.entity.data.cost).toBe(20);
    expect((projected.entity.data.rawText as string).length).toBe(4000);
    expect(projected.links).toBeUndefined();
  });

  it('renders monster-stat level tables as prose lines (SQR-414)', () => {
    const content = JSON.stringify({
      ok: true,
      entity: {
        kind: 'card',
        ref: 'card:gloomhaven-2e/monster-stats/x:monster-stat/living-bones/0-3',
        data: {
          name: 'Living Bones',
          levelRange: '0-3',
          normal: { '0': { hp: 5, move: 2, attack: 1 }, '1': { hp: 5, move: 3, attack: 1 } },
          elite: { '0': { hp: 6, move: 4, attack: 2 }, '1': { hp: 6, move: 4, attack: 2 } },
          notes: 'elite L1: Shield 1, Target 3',
        },
      },
      citations: [],
    });
    const projected = JSON.parse(projectRecordContent(content)) as {
      entity: { data: Record<string, unknown> };
    };
    // Nested tables replaced by explicit lines the model cannot cross-read.
    expect(projected.entity.data.normal).toBeUndefined();
    expect(projected.entity.data.elite).toBeUndefined();
    expect(projected.entity.data.statsByLevel).toEqual([
      'normal L0: Hp 5, Move 2, Attack 1',
      'normal L1: Hp 5, Move 3, Attack 1',
      'elite L0: Hp 6, Move 4, Attack 2',
      'elite L1: Hp 6, Move 4, Attack 2',
    ]);
    // Non-stat records are untouched.
    expect(monsterStatLines({ name: 'Boots', cost: 20 })).toBeNull();
  });

  it('rejects partial or malformed stat tables so no data is dropped (SQR-414 review)', () => {
    // Malformed sibling rank: valid normal + string elite → null.
    expect(monsterStatLines({ normal: { '0': { hp: 5 } }, elite: 'corrupted' })).toBeNull();
    // Array where a level's stat map belongs → null.
    expect(monsterStatLines({ normal: { '0': [5, 2, 1] } })).toBeNull();
    // Non-scalar stat value → null (nothing silently dropped).
    expect(monsterStatLines({ elite: { '1': { hp: 6, modifiers: { shield: 1 } } } })).toBeNull();
    // Empty stat map → null.
    expect(monsterStatLines({ normal: { '0': {} } })).toBeNull();
    // Single valid rank alone is fine.
    expect(monsterStatLines({ elite: { '1': { hp: 6, attack: 2 } } })).toEqual([
      'elite L1: Hp 6, Attack 2',
    ]);
    // Malformed table must leave the projected record intact.
    const content = JSON.stringify({
      ok: true,
      entity: {
        kind: 'card',
        ref: 'card:g/monster-stats/x/y/0-3',
        data: { normal: { '0': { hp: 5 } }, elite: 'corrupted' },
      },
      citations: [],
    });
    const projected = JSON.parse(projectRecordContent(content)) as {
      entity: { data: Record<string, unknown> };
    };
    expect(projected.entity.data.normal).toEqual({ '0': { hp: 5 } });
    expect(projected.entity.data.elite).toBe('corrupted');
    expect(projected.entity.data.statsByLevel).toBeUndefined();
  });

  it('passes malformed content through compacted', () => {
    expect(projectSearchContent('not json')).toBe('not json');
    expect(projectRecordContent('{"ok":false,"error":{"code":"not_found"}}')).toBe(
      '{"ok":false,"error":{"code":"not_found"}}',
    );
  });
});

describe('runFastLane', () => {
  it('falls through to the deep lane on an unsupported game id', async () => {
    const result = await runFastLane('What does the Poison condition do?', {
      game: 'not-a-game',
    });
    expect(result).toBeNull();
    expect(mockSearchKnowledge).not.toHaveBeenCalled();
  });

  it('fires speculative retrieval, streams live, and records a full trajectory', async () => {
    mockSearchKnowledge.mockResolvedValueOnce(JSON.parse(searchHit));
    mockLookupEntity.mockResolvedValueOnce({ ok: false, error: { code: 'not_found' } });
    mockMessagesStream.mockReturnValueOnce(
      streamResponse(
        'Infused elements wane at the end of every round, moving one column left. (Rulebook)',
        ['Infused elements wane at the end of every round, ', 'moving one column left. (Rulebook)'],
      ),
    );

    const events: Array<{ event: string; data: unknown }> = [];
    const result = await runFastLane('When do infused elements wane in Frosthaven?', {
      game: 'frosthaven',
      emit: async (event, data) => {
        events.push({ event, data });
      },
    });

    expect(result).not.toBeNull();
    expect(result!.answer).toContain('wane at the end of every round');
    expect(result!.trajectory.model).toBe('fastlane:claude-haiku-4-5');
    expect(result!.trajectory.iterations).toBe(1);
    // Search + the unconditional parallel lookup (a miss here, still logged).
    expect(result!.trajectory.toolCalls).toHaveLength(2);
    expect(result!.trajectory.toolCalls[0]).toMatchObject({
      name: 'search_knowledge',
      ok: true,
      // Provenance labels flow through for groundedness + consulted-sources.
      sourceLabels: ['Rulebook'],
    });
    expect(result!.trajectory.toolCalls[0]!.canonicalRefs).toContain(
      'rules:frosthaven/fh-rule-book.pdf#chunk=84',
    );
    expect(result!.trajectory.modelCalls).toHaveLength(1);
    expect(result!.trajectory.firstAnswerTokenLatencyMs).not.toBeNull();

    const eventNames = events.map((candidate) => candidate.event);
    expect(eventNames).toContain('tool_call');
    expect(eventNames).toContain('tool_result');
    expect(eventNames.filter((name) => name === 'text').length).toBeGreaterThan(0);
    expect(eventNames[eventNames.length - 1]).toBe('done');
    // Text deltas must reconstruct the full answer (live streaming, gated).
    const streamed = events
      .filter((candidate) => candidate.event === 'text')
      .map((candidate) => (candidate.data as { delta: string }).delta)
      .join('');
    expect(streamed).toBe(result!.answer);
  });

  it('adds a parallel exact lookup for reference-shaped questions', async () => {
    mockSearchKnowledge.mockResolvedValueOnce(JSON.parse(searchHit));
    mockLookupEntity.mockResolvedValueOnce(JSON.parse(lookupHit));
    mockMessagesStream.mockReturnValueOnce(
      streamResponse('Crude Helmet is item #002; it downgrades Double draws to +1. (Card Index)'),
    );

    const result = await runFastLane('What does Frosthaven item #002, Crude Helmet, do?', {
      game: 'frosthaven',
    });

    expect(result).not.toBeNull();
    expect(mockLookupEntity).toHaveBeenCalledTimes(1);
    expect(result!.trajectory.toolCalls.map((call) => call.name)).toEqual([
      'search_knowledge',
      'lookup_entity',
    ]);
  });

  it('falls through to the deep lane when retrieval finds nothing', async () => {
    mockSearchKnowledge.mockResolvedValueOnce({ ok: true, results: [] });

    const result = await runFastLane('What is the initiative of a made-up card?', {
      game: 'frosthaven',
    });

    expect(result).toBeNull();
    expect(mockMessagesStream).not.toHaveBeenCalled();
  });

  it('suppresses the sentinel and falls through when evidence is insufficient', async () => {
    mockSearchKnowledge.mockResolvedValueOnce(JSON.parse(searchHit));
    mockMessagesStream.mockReturnValueOnce(
      streamResponse(INSUFFICIENT_EVIDENCE_SENTINEL, ['INSUFFICIENT', '_EVIDENCE']),
    );

    const textEvents: string[] = [];
    const result = await runFastLane('When do infused elements wane in Frosthaven?', {
      game: 'frosthaven',
      emit: async (event, data) => {
        if (event === 'text') textEvents.push((data as { delta: string }).delta);
      },
    });

    expect(result).toBeNull();
    // The sentinel must never reach the browser.
    expect(textEvents).toEqual([]);
  });

  it('falls through silently when synthesis fails before any text is emitted', async () => {
    mockSearchKnowledge.mockResolvedValueOnce(JSON.parse(searchHit));
    mockMessagesStream.mockReturnValueOnce({
      on() {},
      async finalMessage() {
        throw new Error('overloaded_error: transient');
      },
    });

    const textEvents: string[] = [];
    const result = await runFastLane('When do infused elements wane in Frosthaven?', {
      game: 'frosthaven',
      emit: async (event, data) => {
        if (event === 'text') textEvents.push((data as { delta: string }).delta);
      },
    });

    // Transient synthesis failure with nothing emitted: silent deep-lane
    // fallthrough (CodeRabbit, PR 665).
    expect(result).toBeNull();
    expect(textEvents).toEqual([]);
  });

  it('rethrows a synthesis failure after answer text already streamed', async () => {
    mockSearchKnowledge.mockResolvedValueOnce(JSON.parse(searchHit));
    mockMessagesStream.mockReturnValueOnce({
      on(event: string, handler: (payload: string) => void) {
        if (event === 'text') handler('Infused elements wane at the end of every round, ');
      },
      async finalMessage() {
        throw new Error('stream dropped mid-answer');
      },
    });

    await expect(
      runFastLane('When do infused elements wane in Frosthaven?', {
        game: 'frosthaven',
        emit: async () => undefined,
      }),
    ).rejects.toThrow('stream dropped mid-answer');
  });

  it('respects the kill switch', async () => {
    process.env.SQUIRE_DISABLE_FAST_LANE = '1';
    const result = await runFastLane('What does the Poison condition do?', {
      game: 'frosthaven',
    });
    expect(result).toBeNull();
    expect(mockSearchKnowledge).not.toHaveBeenCalled();
  });
});
