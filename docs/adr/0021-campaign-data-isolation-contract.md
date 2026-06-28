---
type: ADR
id: '0021'
title: 'Campaign data isolation contract'
status: active
date: 2026-06-12
---

## Context

Phase 4 adds shared campaigns with multiple members, per-member characters,
and — for the first time — agent-initiated **writes**. SECURITY.md §3 rates
horizontal privilege escalation a HIGH risk and requires the isolation design
to come before the campaign data model. The LLM is an extra leak path: even
with correct API authorization, anything loaded into the context window can be
elicited by prompting, and member-authored text in context becomes an
injection surface once the agent holds mutation tools.

This ADR is the contract that SQR-18 (schema), SQR-21/22 (CRUD), SQR-19/269
(agent context and tools), and SQR-279/280 (write path) implement, and that
SQR-270/288 (isolation proof suite, write evals) verify. Plan of record:
`docs/plans/phase-4-campaign-character-state-initiative-plan.md`.

## Decision

**Two roles, three visibility tiers, structural context scoping, and
propose→confirm for an enumerated destructive set.** Membership is checked on
every campaign-scoped request; non-members receive indistinguishable 404s;
other members' private fields are excluded from API responses and LLM context
at the type level, not by convention or prompt instruction.

### Roles

`campaign_members.role` is `owner` or `member`. The creator is the owner.
Exactly one owner per campaign in v1 (transfer is a future mutation, not
modeled now).

### Field classification

| Tier                     | Fields                                                                                                     | Read               | Write                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------- |
| Shared campaign state    | name, game, modules, prosperity, played/drawn scenarios, unlocked classes/items/buildings, active scenario | all members        | any member (destructive subset gated) |
| Member-visible character | name, class, level, XP, gold, items, ability cards, perks, status, successor link                          | all members        | owning member only                    |
| Private character        | personal quest, battle goals, private notes                                                                | owning member only | owning member only                    |

Items, gold, cards, and perks are deliberately member-visible: at a physical
table this is open information, and Phase 5 party-aware recommendations
(pre-combat hand selection) require it. Frosthaven's actual secrecy mechanics
are personal quests and battle goals — those, plus freeform private notes, are
the private tier.

### Permission matrix

| Mutation                                                      | Who                                                 | Destructive (propose→confirm)?   |
| ------------------------------------------------------------- | --------------------------------------------------- | -------------------------------- |
| Create campaign                                               | any allowlisted user                                | no                               |
| Invite member                                                 | owner                                               | no                               |
| Join (accept invite)                                          | invitee                                             | no                               |
| Leave campaign                                                | the member themself                                 | no (blocked for last member)     |
| Remove member                                                 | owner                                               | **yes**                          |
| Delete campaign                                               | owner                                               | **yes**                          |
| Edit shared state (mark played/drawn, prosperity up, unlocks) | any member                                          | no                               |
| Un-play a scenario / decrease prosperity                      | any member                                          | **yes** (reverses derived state) |
| Create own character                                          | the member                                          | no                               |
| Edit own character                                            | owning member                                       | no                               |
| Delete / retire own character                                 | owning member                                       | **yes**                          |
| Edit another member's character                               | nobody                                              | —                                |
| Create placeholder character for an invitee                   | owner                                               | no                               |
| Edit/delete unclaimed placeholder                             | its creator                                         | no (scratch data)                |
| Claim placeholder                                             | the joining member it names                         | no                               |
| Edit journal entries                                          | nobody — corrections are new compensating mutations | —                                |

The destructive set is **enumerated, closed, and lives in code as a typed
list**: campaign delete, member removal, character delete, character
retirement, scenario un-play, prosperity decrease. Adding to it is a contract
change. Destructive mutations are impossible in one shot on every channel —
they require a persisted proposal confirmed by id (ADR for the mechanism lives
with SQR-279; this ADR fixes only _which_ mutations are gated).

### Leave / delete semantics

- **Leave:** the leaver's characters are retained read-only for campaign
  history (audit and journal attribution intact); ownership stays bound to the
  user, so rejoining restores edit rights. Private-tier fields of a departed
  member remain unreadable to everyone.
- **Last member cannot leave** — the API returns a structured error directing
  to campaign delete, so campaigns are never silently orphaned.
- **Campaign delete** cascades all domain rows (members, characters, child
  tables, pending mutations). **Audit rows are exempt**: the audit table keys
  campaigns by plain UUID with no cascading FK and is append-only, so the
  security trail survives deletion.

### Non-member access and invites

- Non-member requests for any campaign-scoped resource return **404
  indistinguishable from absent** (the SECURITY.md §7 conversation-lookup
  convention). UUIDs are unguessable; this removes the existence oracle.
- **Carve-out:** a user with a pending invite sees a minimal invite record
  (campaign name, game, inviter) **only via their own invite list**, never via
  campaign routes.
- Invites are issued by email. The allowlist is checked **at invite time and
  again at join time**; a non-allowlisted email is rejected with clear copy at
  invite, and a lapsed allowlist entry blocks the join.

### Placeholder characters

Characters created on behalf of a not-yet-joined member (conversational
onboarding's party setup) carry shared and member-visible fields only —
private-tier fields cannot be recorded on a placeholder. The creator owns and
may edit or delete it until the named invitee joins and claims it, at which
point ownership transfers and the private tier unlocks for the new owner.

### LLM context scoping (structural, not behavioral)

Context assembly for a request by member M may include: M's own characters in
full, all members' member-visible character fields, shared campaign state, and
redacted journal entries. Other members' private-tier fields **never enter the
context window**. Enforcement is structural: a single projection type
(`CampaignContextView`) built by one repository function omits non-owner
private fields at the type level — there is no code path that loads them and
filters later. Prompt instructions are not an isolation mechanism.

### Injection-induced writes

Member-authored strings (character names, notes, journal text) reach the
context window of _other_ members' requests while the agent holds write tools.
Mitigations, layered:

1. Write tools validate the mutation target against the **requester's**
   permission scope server-side — prompt content cannot widen scope.
2. Agent-initiated writes are work-log visible always, and destructive ones
   are propose→confirm always, so injected instructions cannot silently
   destroy state.
3. Member-authored content is delimited as data in prompts per SECURITY.md §1.
4. Injection-induced-write eval cases gate the write path (SQR-288); a failure
   is triaged as a release blocker.

### Audit requirements

Successful mutations write an audit row in the same transaction as the
state change: actor, campaign, mutation type, before/after payload, channel,
and a derived-availability snapshot when scenario state changed. **Failed and
rejected attempts write their audit row outside the transaction** (on the
outer connection, after rollback) so the evidence survives — mirroring the
existing failure-audit pattern in `src/auth/provider.ts`. Append-only;
immutable; retained past entity deletion. The journal is a redacted projection that selects from audit
(one-directional coupling); private-tier values, failed writes, and
operational metadata never appear in it.

### Test obligations

The contract is accepted only with these proofs (SQR-270, SQR-288):

- API denial tests for every "no" cell in the permission matrix, plus
  404-indistinguishability and invite allowlist paths.
- Context-assembly tests asserting non-owner private fields are absent from
  the assembled prompt input.
- Adversarial prompt evals (fixed seed-set) attempting cross-member private
  extraction — 100%, failures triaged as context-assembly bugs.
- Adversarial write evals (fixed seed-set, `eval/suites/campaign-writes.json`)
  attempting injection-induced writes from member-authored content — 100%, any
  induced write triaged as a release blocker. The corresponding threat model
  and mitigations live in SECURITY.md §1 (write path) and §3 (SQR-288).
- Placeholder claim transfer and leave/rejoin ownership tests.

## Options considered

- **Two roles, owner/member** (chosen): matches a friends-at-a-table party;
  every matrix cell is decidable without role administration UI. Rich RBAC
  (GM/scribe/viewer roles) rejected as speculative complexity for a party of
  2–4 friends.
- **Member-visible-by-default character fields with an enumerated private
  tier** (chosen) vs private-by-default: private-by-default would break party
  questions ("what is our Banner Spear carrying?") and Phase 5 party-aware
  recommendations, while protecting nothing the game itself treats as secret.
- **Compensating mutations for journal corrections** (chosen) vs editable
  journal: editing a projection of the audit log either desynchronizes it from
  audit or requires mutable audit — both worse than "fix it with a new write."
- **Soft-delete campaigns** vs hard delete with audit exemption (chosen):
  soft-delete adds filtered-query complexity everywhere for a recovery story
  nobody asked for; the audit trail already preserves the security-relevant
  history.

## Consequences

Easier: every implementation issue downstream has a decidable answer for
visibility, permission, and gating questions; the isolation proof suite has an
enumerable test matrix; the LLM leak path is closed by construction rather
than by prompt discipline.

Harder: the single-projection rule means new context needs (for example,
Phase 5 recommendations) must extend `CampaignContextView` rather than
querying ad hoc — deliberate friction. One-owner-per-campaign means owner
departure requires campaign delete or a future ownership-transfer mutation;
re-evaluate if a real party hits this.

Re-evaluation triggers: a second campaign role genuinely needed in practice;
spoiler protection (Phase 6) needing per-member visibility of _shared_ state;
or a future import feature requiring a service identity that doesn't map to a
member.

## Advice

From the 2026-06-12 plan reviews: Codex (eng pass) pushed confirm-time
revalidation, payload hashes, and service-layer scope checks into the write
path — absorbed here as matrix enforcement being server-side and
prompt-independent. The CEO review fixed full multi-user membership in v1
(D3), which is why this contract is written for real members rather than a
single-user shortcut.
