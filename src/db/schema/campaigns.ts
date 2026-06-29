/**
 * Campaign & character state schema (Phase 4, SQR-18).
 *
 * Shapes follow ADR 0021 (campaign data isolation contract):
 *
 * - `campaign_members` and `characters` are deliberately SEPARATE tables — a
 *   join table holding character state cannot model one player running two
 *   characters or retirement succession chains.
 * - Character ownership binds to the USER (not the membership row) so a
 *   member who leaves and rejoins regains edit rights over their characters.
 * - `campaign_audit_log` has NO foreign keys on purpose: it is append-only
 *   and must survive campaign deletion (ADR 0021 §Leave/delete). All other
 *   campaign-scoped tables cascade on campaign delete.
 * - `version` columns implement optimistic compare-and-set (eng decision E3);
 *   writers send the expected version and retry on conflict.
 * - `character_items` / `character_cards` reference GHS card data by
 *   `(game, source_id)` WITHOUT a hard FK: the card tables are reseeded with
 *   prune-then-upsert and a hard FK would block the seed. Rules-legality is
 *   enforced by the validation layer (D4.4), not referential integrity.
 * - Scenario identity in `played_scenarios` / `drawn_scenarios` uses the
 *   module-scoped scenario keys defined by the unlock-graph seed (SQR-267);
 *   this schema stores them as opaque strings.
 * - Optional import/provenance metadata: `external_ref` + `source_authority`
 *   on syncable records, `last_synced_at` + `sync_method` on campaigns
 *   (decision D12). Recurring third-party tracker sync is not on the roadmap.
 */

import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { users } from './core.ts';

// ─── Campaigns ──────────────────────────────────────────────────────────────

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** One campaign is one game ('frosthaven' | 'gloomhaven-2e'). */
    game: text('game').notNull(),
    /** Scenario-set selectors within the game, e.g. {gh2e,solo2e} (SQR-267). */
    modules: text('modules').array().notNull().default([]),
    prosperity: integer('prosperity').notNull().default(1),
    /** Module-scoped scenario key of the party's current focus, if any. */
    activeScenario: text('active_scenario'),
    /**
     * Shared progression state. Unlock/completion data is modeled completely
     * enough to drive Phase 6 spoiler filtering (decision D4.3): which
     * scenarios were played/drawn and which classes/items/buildings the
     * party has unlocked.
     */
    playedScenarios: text('played_scenarios').array().notNull().default([]),
    drawnScenarios: text('drawn_scenarios').array().notNull().default([]),
    /** Skippable scenarios the party chose to skip (GH2e scenario 0). Counts
     * as done for downstream prereqs but is never itself playable. */
    skippedScenarios: text('skipped_scenarios').array().notNull().default([]),
    unlockedClasses: text('unlocked_classes').array().notNull().default([]),
    unlockedItems: text('unlocked_items').array().notNull().default([]),
    unlockedBuildings: text('unlocked_buildings').array().notNull().default([]),
    /** Optimistic CAS counter (E3). Bumped on every shared-state write. */
    version: integer('version').notNull().default(1),
    // Optional import/provenance metadata (D12).
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    syncMethod: text('sync_method'),
    externalRef: text('external_ref'),
    sourceAuthority: text('source_authority'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('campaigns_game_idx').on(t.game)],
);

// ─── Campaign members (membership + invites) ────────────────────────────────

export const campaignMembers = pgTable(
  'campaign_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /**
     * Null while the row is a pending invite — the invitee may not have a
     * users row yet (first Google login creates it). Set on join.
     */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** Invite target. Allowlist-checked at invite AND join time (ADR 0021). */
    inviteEmail: text('invite_email').notNull(),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** 'owner' | 'member' (ADR 0021 §Roles — exactly one owner per campaign). */
    role: text('role').notNull().default('member'),
    /** 'invited' | 'active' | 'departed' (departed keeps history attribution). */
    status: text('status').notNull().default('invited'),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('campaign_members_campaign_idx').on(t.campaignId),
    index('campaign_members_user_idx').on(t.userId),
    uniqueIndex('campaign_members_campaign_email_idx').on(t.campaignId, t.inviteEmail),
    uniqueIndex('campaign_members_campaign_user_idx').on(t.campaignId, t.userId),
    // Exactly one owner per campaign (ADR 0021 §Roles), DB-enforced.
    uniqueIndex('campaign_members_single_owner_idx')
      .on(t.campaignId)
      .where(sql`${t.role} = 'owner'`),
  ],
);

// ─── Characters ─────────────────────────────────────────────────────────────

export const characters = pgTable(
  'characters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /** Ownership binds to the user and survives leave/rejoin (ADR 0021). */
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * Set when this row is a claimable placeholder created for an invitee
     * (conversational onboarding). While set, private-tier fields stay empty
     * and the creator owns the row; claiming transfers ownership and clears
     * this (ADR 0021 §Placeholder characters).
     */
    placeholderForEmail: text('placeholder_for_email'),
    name: text('name').notNull(),
    /** GHS class identity within the campaign's game. */
    className: text('class_name').notNull(),
    level: integer('level').notNull().default(1),
    xp: integer('xp').notNull().default(0),
    gold: integer('gold').notNull().default(0),
    /**
     * Per-class perk sheet indices. GHS models perks positionally with no
     * stable entity to reference, so this stays jsonb (eng decision E4).
     */
    perks: jsonb('perks').$type<number[]>().notNull().default([]),
    /**
     * Perk-mark pips are earned independently from chosen perks. They are
     * rendered in game-system-sized groups of three on the sheet.
     */
    perkMarks: integer('perk_marks').notNull().default(0),
    /** Per-class mastery sheet indices from `card_character_mats.masteries`. */
    masteries: jsonb('masteries').$type<number[]>().notNull().default([]),
    /**
     * Private tier (ADR 0021 §Field classification) — owner-only.
     *
     * `personal_quest` / `battle_goals` are legacy text columns retained for
     * reversible migrations. New character state stores the quest by catalog
     * source id and session battle goals live outside durable character rows.
     */
    personalQuestSourceId: text('personal_quest_source_id'),
    personalQuest: text('personal_quest'),
    battleGoals: text('battle_goals'),
    privateNotes: text('private_notes'),
    /** 'active' | 'retired' (D4.5 — model ships now, guided flow deferred). */
    status: text('status').notNull().default('active'),
    successorId: uuid('successor_id').references((): AnyPgColumn => characters.id, {
      onDelete: 'set null',
    }),
    /** Optimistic CAS counter (E3). */
    version: integer('version').notNull().default(1),
    // Optional import/provenance metadata (D12).
    externalRef: text('external_ref'),
    sourceAuthority: text('source_authority'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('characters_campaign_idx').on(t.campaignId),
    index('characters_owner_idx').on(t.ownerUserId),
    index('characters_successor_idx').on(t.successorId),
    uniqueIndex('characters_campaign_personal_quest_source_idx')
      .on(t.campaignId, t.personalQuestSourceId)
      .where(sql`${t.personalQuestSourceId} IS NOT NULL`),
  ],
);

// ─── Campaign-managed character catalogs ─────────────────────────────────────

export const campaignItemCatalog = pgTable(
  'campaign_item_catalog',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    game: text('game').notNull(),
    /** Soft reference to card_items (game, source_id). */
    sourceId: text('source_id').notNull(),
    /** 'available' | 'locked' | 'unavailable'. */
    status: text('status').notNull().default('locked'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('campaign_item_catalog_campaign_idx').on(t.campaignId),
    index('campaign_item_catalog_status_idx').on(t.campaignId, t.status),
    uniqueIndex('campaign_item_catalog_campaign_source_idx').on(t.campaignId, t.game, t.sourceId),
  ],
);

export const campaignPersonalQuestCatalog = pgTable(
  'campaign_personal_quest_catalog',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    game: text('game').notNull(),
    /** Soft reference to card_personal_quests (game, source_id). */
    sourceId: text('source_id').notNull(),
    /** 'available' | 'locked' | 'unavailable'. Assignment is derived from characters. */
    status: text('status').notNull().default('available'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('campaign_personal_quest_catalog_campaign_idx').on(t.campaignId),
    index('campaign_personal_quest_catalog_status_idx').on(t.campaignId, t.status),
    uniqueIndex('campaign_personal_quest_catalog_campaign_source_idx').on(
      t.campaignId,
      t.game,
      t.sourceId,
    ),
  ],
);

// ─── Character ↔ GHS card child tables (E4) ─────────────────────────────────

export const characterItems = pgTable(
  'character_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    /** Soft reference to card_items (game, source_id) — see header comment. */
    game: text('game').notNull(),
    sourceId: text('source_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('character_items_character_idx').on(t.characterId),
    uniqueIndex('character_items_character_card_idx').on(t.characterId, t.game, t.sourceId),
  ],
);

export const characterCards = pgTable(
  'character_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    /** Soft reference to card_character_abilities (game, source_id). */
    game: text('game').notNull(),
    sourceId: text('source_id').notNull(),
    /** 'owned' | 'active' — active = currently in the played deck. */
    role: text('role').notNull().default('owned'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('character_cards_character_idx').on(t.characterId),
    uniqueIndex('character_cards_character_card_idx').on(t.characterId, t.game, t.sourceId),
  ],
);

// ─── Audit log (no FKs — survives campaign deletion, ADR 0021) ──────────────

export const campaignAuditLog = pgTable(
  'campaign_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Plain UUID on purpose: rows outlive the campaign. */
    campaignId: uuid('campaign_id').notNull(),
    /** Plain UUID on purpose: attribution outlives membership. */
    actorUserId: uuid('actor_user_id').notNull(),
    /** Typed mutation name, e.g. 'scenario.mark_played', 'campaign.delete'. */
    mutationType: text('mutation_type').notNull(),
    /** 'web' | 'mcp' | 'rest' | 'system'. */
    channel: text('channel').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    payloadBefore: jsonb('payload_before').$type<Record<string, unknown> | null>().default(null),
    payloadAfter: jsonb('payload_after').$type<Record<string, unknown> | null>().default(null),
    /**
     * Derived scenario-availability snapshot at write time, recorded when
     * scenario state changed so journal entries stay true even after the
     * unlock-graph seed evolves (constraint 10).
     */
    availabilitySnapshot: jsonb('availability_snapshot')
      .$type<Record<string, unknown> | null>()
      .default(null),
    /**
     * 'success' rows commit inside the mutation's transaction; 'rejected'
     * rows are written on the outer connection after the denial/rollback so
     * the evidence survives (ADR 0021 §Audit requirements).
     */
    outcome: text('outcome').notNull().default('success'),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('campaign_audit_log_campaign_created_idx').on(t.campaignId, t.createdAt)],
);

// ─── Pending mutations (propose→confirm, E2) ────────────────────────────────

export const pendingMutations = pgTable(
  'pending_mutations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    proposerUserId: uuid('proposer_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The staged mutation batch, exactly as previewed. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    /** SHA-256 hex of the canonical payload — re-checked at confirm time. */
    payloadHash: text('payload_hash').notNull(),
    /** entityId → expected `version` map, re-checked at confirm time. */
    expectedVersions: jsonb('expected_versions').$type<Record<string, number>>().notNull(),
    /** 'proposed' | 'confirmed' | 'rejected' | 'expired'. */
    status: text('status').notNull().default('proposed'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('pending_mutations_campaign_idx').on(t.campaignId),
    index('pending_mutations_expires_idx').on(t.expiresAt),
  ],
);

// ─── Mutation idempotency keys (constraint 8) ───────────────────────────────

export const mutationIdempotencyKeys = pgTable(
  'mutation_idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    toolFamily: text('tool_family').notNull(),
    /** A reused key with a different payload hash is rejected, not deduped. */
    payloadHash: text('payload_hash').notNull(),
    /**
     * The proposal this key claimed, set in the same transaction that creates
     * it. Replay returns exactly this proposal (SQR-280 / CodeRabbit #533) —
     * never a fuzzy payload-hash match that could resolve to a different key's
     * proposal or a since-resolved one. Nullable only for the brief
     * in-transaction window before the proposal row exists.
     */
    proposalId: uuid('proposal_id').references(() => pendingMutations.id, {
      onDelete: 'cascade',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('mutation_idempotency_scope_key_idx').on(
      t.actorUserId,
      t.campaignId,
      t.toolFamily,
      t.key,
    ),
    index('mutation_idempotency_campaign_idx').on(t.campaignId),
  ],
);
