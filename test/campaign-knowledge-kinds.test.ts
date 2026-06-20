/**
 * Campaign entity kinds in the knowledge tool contract (SQR-269, ADR 0021).
 *
 * Tool-layer isolation proofs: campaign/character/party kinds light up only
 * for an identified caller and only within their memberships; a non-member
 * ref is indistinguishable from an absent one; other members' private-tier
 * fields never serialize. Agent and MCP surfaces share these definitions —
 * the registry under test here IS the shared one (parity at the definition
 * level; channel wiring is covered by SQR-19/271).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.SESSION_SECRET = 'test-session-secret-must-be-at-least-32-characters-long';

import { getDb, shutdownServerPool } from '../src/db.ts';
import * as CampaignService from '../src/campaign/campaign-service.ts';
import * as CharacterService from '../src/campaign/character-service.ts';
import { identityFromSessionUser, type CallerIdentity } from '../src/campaign/identity.ts';
import { seedUnlockGraphModule } from '../src/seed/seed-unlock-graphs.ts';
import {
  getSchema,
  inspectSources,
  lookupEntity,
  neighbors,
  openEntity,
  resolveEntity,
  searchKnowledge,
} from '../src/tools.ts';
import { users } from '../src/db/schema/core.ts';
import { resetTestDb, setupTestDb, teardownTestDb } from './helpers/db.ts';

const OWNER_EMAIL = 'owner@example.com';
const MEMBER_EMAIL = 'member@example.com';
const OUTSIDER_EMAIL = 'outsider@example.com';

const PRIVATE_FIELDS = ['personalQuest', 'battleGoals', 'privateNotes'];

async function createUser(email: string): Promise<CallerIdentity> {
  const { db } = getDb('server');
  const [user] = await db
    .insert(users)
    .values({ email, googleSub: `google-sub-${email}`, name: email.split('@')[0] })
    .returning();
  return identityFromSessionUser(user.id);
}

interface Fixture {
  owner: CallerIdentity;
  member: CallerIdentity;
  outsider: CallerIdentity;
  campaignId: string;
  ownerCharacterId: string;
}

async function setupFixture(): Promise<Fixture> {
  const { db } = getDb('server');
  await seedUnlockGraphModule(db, {
    provenance: 'test',
    game: 'frosthaven',
    module: 'fh',
    scenarios: [
      {
        key: '1',
        name: 'One',
        prereqsAll: [],
        prereqsAny: [],
        mutex: [],
        lockedIf: [],
        manual: false,
        cond: null,
        hazard: false,
        skippable: false,
        unlockClass: null,
        unlockMinLevel: null,
      },
      {
        key: '2',
        name: 'Two',
        prereqsAll: ['1'],
        prereqsAny: [],
        mutex: [],
        lockedIf: [],
        manual: false,
        cond: null,
        hazard: false,
        skippable: false,
        unlockClass: null,
        unlockMinLevel: null,
      },
    ],
    threads: [],
  });

  const owner = await createUser(OWNER_EMAIL);
  const member = await createUser(MEMBER_EMAIL);
  const outsider = await createUser(OUTSIDER_EMAIL);

  const campaign = await CampaignService.createCampaign(owner, {
    name: 'Thursday Night Frosthaven',
    game: 'frosthaven',
    modules: ['fh'],
  });
  const invite = await CampaignService.inviteMember(owner, campaign.id, MEMBER_EMAIL);
  await CampaignService.acceptInvite(member, invite.memberId);
  await CampaignService.updateSharedState(owner, campaign.id, {
    expectedVersion: campaign.version,
    playedScenarios: ['fh:1'],
  });

  const character = await CharacterService.createCharacter(owner, campaign.id, {
    name: 'Snowdancer',
    className: 'Drifter',
    personalQuest: 'SECRET-PQ-TOKEN',
    privateNotes: 'SECRET-NOTES-TOKEN',
  });

  return {
    owner,
    member,
    outsider,
    campaignId: campaign.id,
    ownerCharacterId: character.id,
  };
}

beforeAll(async () => {
  await setupTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  process.env.SQUIRE_ALLOWED_EMAILS = [OWNER_EMAIL, MEMBER_EMAIL, OUTSIDER_EMAIL].join(',');
});

afterAll(async () => {
  delete process.env.SQUIRE_ALLOWED_EMAILS;
  await teardownTestDb();
  await shutdownServerPool();
});

describe('inspect_sources and schema', () => {
  it('advertises the campaign-state source only for an identified caller', async () => {
    const fixture = await setupFixture();

    const anonymous = await inspectSources({ game: 'frosthaven' });
    expect(anonymous.sources.some((s) => s.ref.endsWith('/campaign-state'))).toBe(false);

    const identified = await inspectSources({ game: 'frosthaven', userId: fixture.owner.userId });
    const source = identified.sources.find((s) => s.ref === 'source:frosthaven/campaign-state');
    expect(source).toBeDefined();
    expect(source?.kinds).toEqual(['campaign', 'character', 'party']);
    expect(source?.searchable).toBe(false);
    expect(source?.counts).toEqual({ campaign: 1 });

    // Membership-scoped: an outsider with no campaigns sees a zero count.
    const outsiderView = await inspectSources({
      game: 'frosthaven',
      userId: fixture.outsider.userId,
    });
    const outsiderSource = outsiderView.sources.find((s) => s.ref.endsWith('/campaign-state'));
    expect(outsiderSource?.counts).toEqual({ campaign: 0 });
  });

  it('describes the three kinds, including aliases', () => {
    for (const kind of ['campaign', 'character', 'party', 'roster', 'characters']) {
      const schema = getSchema(kind);
      expect(schema.ok, `schema(${kind})`).toBe(true);
    }
    const party = getSchema('party');
    if (party.ok) expect(party.refPattern).toBe('party:<game>/<campaign-id>');
  });
});

describe('resolve_entity', () => {
  it('resolves campaign and character names within the caller memberships only', async () => {
    const fixture = await setupFixture();

    const resolved = await resolveEntity('Thursday Night Frosthaven', {
      game: 'frosthaven',
      userId: fixture.owner.userId,
      kinds: ['campaign', 'party'],
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const kinds = resolved.candidates.map((c) => c.entity.kind);
    expect(kinds).toContain('campaign');
    expect(kinds).toContain('party');
    expect(resolved.candidates[0].entity.ref).toBe(`campaign:frosthaven/${fixture.campaignId}`);

    const character = await resolveEntity('Snowdancer', {
      game: 'frosthaven',
      userId: fixture.member.userId,
      kinds: ['character'],
    });
    expect(character.ok && character.candidates[0]?.entity.kind).toBe('character');

    // Outsiders and anonymous callers resolve nothing.
    const outsider = await resolveEntity('Thursday Night Frosthaven', {
      game: 'frosthaven',
      userId: fixture.outsider.userId,
      kinds: ['campaign'],
    });
    expect(outsider.ok && outsider.candidates).toEqual([]);
    const anonymous = await resolveEntity('Thursday Night Frosthaven', {
      game: 'frosthaven',
      kinds: ['campaign'],
    });
    expect(anonymous.ok && anonymous.candidates).toEqual([]);
  });
});

describe('open_entity', () => {
  it('opens a campaign for a member with availability and redacted journal', async () => {
    const fixture = await setupFixture();
    const ref = `campaign:frosthaven/${fixture.campaignId}`;

    const opened = await openEntity(ref, { userId: fixture.member.userId });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.entity.kind).toBe('campaign');
    expect(opened.entity.title).toBe('Thursday Night Frosthaven');

    const data = opened.entity.data as {
      playedScenarios: string[];
      availability: { counts: Record<string, number>; unlockedKeys: string[] };
      recentJournal: unknown[];
      members: Array<{ role: string }>;
    };
    expect(data.playedScenarios).toEqual(['fh:1']);
    expect(data.availability.counts.played).toBe(1);
    expect(data.availability.unlockedKeys).toEqual(['fh:2']);
    expect(data.recentJournal.length).toBeGreaterThan(0);
    expect(data.members).toHaveLength(2);

    // The journal projection and the campaign payload never carry
    // private-tier values, no matter whose characters are in play.
    const serialized = JSON.stringify(opened);
    expect(serialized).not.toContain('SECRET-PQ-TOKEN');
    expect(serialized).not.toContain('SECRET-NOTES-TOKEN');

    const links = opened.links.map((link) => link.relation);
    expect(links).toContain('has_party');
    expect(links).toContain('has_character');
  });

  it('keeps non-member, anonymous, and absent refs indistinguishable', async () => {
    const fixture = await setupFixture();
    const realRef = `campaign:frosthaven/${fixture.campaignId}`;
    const absentRef = 'campaign:frosthaven/00000000-0000-4000-8000-000000000000';

    const nonMember = await openEntity(realRef, { userId: fixture.outsider.userId });
    const absent = await openEntity(absentRef, { userId: fixture.outsider.userId });
    const anonymous = await openEntity(realRef, {});

    expect(nonMember.ok).toBe(false);
    if (nonMember.ok || absent.ok || anonymous.ok) return;
    expect(nonMember.error.code).toBe('not_found');
    // Identical shape modulo the echoed ref.
    expect({ ...nonMember.error, message: '' }).toEqual({ ...absent.error, message: '' });
    expect(anonymous.error.code).toBe('not_found');
  });

  it('projects the private tier only for the owning member', async () => {
    const fixture = await setupFixture();
    const ref = `character:frosthaven/${fixture.ownerCharacterId}`;

    const own = await openEntity(ref, { userId: fixture.owner.userId });
    expect(own.ok && (own.entity.data as { personalQuest?: string }).personalQuest).toBe(
      'SECRET-PQ-TOKEN',
    );

    const other = await openEntity(ref, { userId: fixture.member.userId });
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    for (const field of PRIVATE_FIELDS) {
      expect(other.entity.data, `${field} must be absent for non-owners`).not.toHaveProperty(field);
    }
    expect((other.entity.data as { own: boolean }).own).toBe(false);
  });

  it('opens the party view with member-visible characters', async () => {
    const fixture = await setupFixture();
    const opened = await openEntity(`party:frosthaven/${fixture.campaignId}`, {
      userId: fixture.member.userId,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.entity.kind).toBe('party');
    const data = opened.entity.data as {
      characters: Array<Record<string, unknown>>;
      members: Array<Record<string, unknown>>;
    };
    expect(data.characters).toHaveLength(1);
    expect(data.members).toHaveLength(2);
    expect(JSON.stringify(opened)).not.toContain('SECRET-PQ-TOKEN');
  });
});

describe('lookup_entity', () => {
  // Regression: lookup_entity resolves a ref and then reopens it. The reopen
  // must carry the SAME identity that resolved it, or a membership-scoped
  // campaign/character/party ref reopens anonymously and 404s (CodeRabbit
  // caught the dropped userId on PR #522).
  it('resolves and opens a campaign ref under the membership scope', async () => {
    const fixture = await setupFixture();
    const opened = await lookupEntity('Thursday Night Frosthaven', {
      kinds: ['campaign'],
      game: 'frosthaven',
      userId: fixture.member.userId,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.entity.kind).toBe('campaign');
    expect(opened.entity.ref).toBe(`campaign:frosthaven/${fixture.campaignId}`);
  });

  it('opens a member-visible character ref without leaking the private tier', async () => {
    const fixture = await setupFixture();
    const opened = await lookupEntity('Snowdancer', {
      kinds: ['character'],
      game: 'frosthaven',
      userId: fixture.member.userId,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.entity.kind).toBe('character');
    expect(JSON.stringify(opened)).not.toContain('SECRET-PQ-TOKEN');
  });

  it('stays not_found for an anonymous caller — identity is never widened', async () => {
    const fixture = await setupFixture();
    void fixture;
    const anonymous = await lookupEntity('Thursday Night Frosthaven', {
      kinds: ['campaign'],
      game: 'frosthaven',
    });
    expect(anonymous.ok).toBe(false);
  });
});

describe('neighbors', () => {
  it('traverses campaign → characters and party, membership-gated', async () => {
    const fixture = await setupFixture();
    const ref = `campaign:frosthaven/${fixture.campaignId}`;

    const all = await neighbors(ref, { userId: fixture.member.userId });
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect(all.neighbors.map((n) => n.relation).sort()).toEqual(['has_character', 'has_party']);

    const filtered = await neighbors(ref, {
      userId: fixture.member.userId,
      relation: 'has_character',
    });
    expect(filtered.ok && filtered.neighbors).toHaveLength(1);

    const fromCharacter = await neighbors(`character:frosthaven/${fixture.ownerCharacterId}`, {
      userId: fixture.member.userId,
    });
    expect(fromCharacter.ok && fromCharacter.neighbors[0]?.relation).toBe('in_campaign');

    const outsider = await neighbors(ref, { userId: fixture.outsider.userId });
    expect(!outsider.ok && outsider.error.code).toBe('not_found');

    const badRelation = await neighbors(ref, {
      userId: fixture.member.userId,
      relation: 'unlock',
    });
    expect(!badRelation.ok && badRelation.error.code).toBe('unsupported_relation');
  });
});

describe('search_knowledge', () => {
  it('rejects campaign scopes with a redirect hint', async () => {
    const result = await searchKnowledge('what scenarios are open', { scope: ['campaign'] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid_filter');
    expect(result.error.hint).toContain('resolve_entity');
  });
});
