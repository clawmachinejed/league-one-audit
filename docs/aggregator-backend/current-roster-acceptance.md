# Scoped current held-player acceptance

The implementation plan was written before code changes. This slice adds a persisted shadow
`AcceptedResource` for public Sleeper current held-player membership (`players`
only). It does not complete package 2 or change public readers, v1 acceptance,
scoring, projections, account selection, reserve/taxi qualification, or history.

## Boundary and design

- Reuse the existing administration collector, normalizer, immutable content,
  season-team UUIDs and writer. Add migration 027; never modify installed migrations.
- Qualify exactly one immutable policy: public audience, all season roster teams,
  current display (null entity/period), players field, complete pagination,
  `sleeper-current-players-v1` canonical normalization and
  `latest-network-attempt-v1` acceptance. Every dimension is part of head identity.
  A nonnullable canonical scope document avoids SQL nullable-UNIQUE ambiguity.
- Reserve a durable attempt before explicitly uncached roster acquisition in
  maintenance/write operator and the existing changed-cache verification path.
  Reservations serialize under the existing season source lock, capture the
  mapping revision and accepted-head generation, and increment database order.
  Cached collectors do not reserve or suppress in-flight network captures.
- Only the latest-started network attempt may publish. Failed/crashed newest
  attempts leave the previous accepted resource intact and continue to fence
  older attempts. Normal collection starts a new attempt to recover. Database
  order, never application/database clock comparison, defines precedence.
- Extend the existing writer transaction while preserving its v1 implementation
  and result. Store a separate immutable exact capture receipt even when v1
  returns an old observation ID for unchanged content. Receipt provenance is the
  new acquisition's evidence; old observations never receive new timestamps.
  An exact receipt retry is idempotent; reused attempt IDs with changed evidence
  fail closed. Mapping, latest-attempt and head-generation checks share the source
  lock and transaction with acceptance. No alternate public writer is introduced.
- Full population requires an independent league configuration team count with
  stored evidence, unique roster identities, every players array, exact normalized
  content/team linkage and complete collection. Missing/null players is unknown;
  `[]` is complete empty membership. Missing reserve/taxi does not block players.
- Read accepted evidence through an internal scoped store method for comparison,
  using the existing normalized teams and UUIDs. No page/API cutover or extra
  provider request. A remapped head is unavailable for the new revision until a
  new qualified capture; historical receipts and acceptances stay immutable.

## Qualification plan

Pure/transport tests cover qualification, fail-closed scope/version/audience,
pre-acquisition reservation, cache neutrality, receipt forwarding, disabled
persistence and unchanged v1 results/fallbacks. Real disposable SQL tests cover
publication/readback, both overlap completion orders, newer failure, retry and
restart, equal-content exact receipts, stale replay, A-B-A mapping, incomplete and
invalid inventories, explicit empty players, null scope uniqueness, league/season
isolation, permissions/immutable guards and original-caller rollback. Independently
review implementation, run targeted checks and complete `verify:full` including
public and account browser suites. SQL is unverified until the exact reviewed
commit's protected workflow run receives maintainer approval and passes with all
cleanup receipts. Publish an unmerged PR; coordinator owns preview qualification
and later release authorization. Do not apply migrations to production.

## Starting evidence

Clean isolated HEAD and local/GitHub main matched
`a671cfa70f6b8a91ee70d8c8ebfdd057621f3546`. The coordinator freshly verified Ready
Vercel Production `HiFjh6VZG8jYUW3zdkuZoSuDnwcL`, canonical repository
`clawmachinejed/league-one-audit`, `main`, root `apps/site`, project
`league_one_fantasy` under `robert-finchums-projects`. GitHub had no open PR.
No competing owner observed in inspected worktree/branch/PR/deployment evidence;
production database leases were not inspected. This task owns implementation and
PR publication only, not production writing or release.

## Implemented policy and operational limits

“Latest” means **latest durably reserved acquisition**, not provider edit order.
An earlier reservation can stall before its HTTP request begins. The policy
intentionally refuses that attempt after another reservation, regardless of
completion time or content. There is no retry queue or new collector: a subsequent
normal network collection recovers. A cache check never reserves. Reservation
requires the original mapping; changed-cache verification cannot substitute a
new mapping revision. Each network request gets a new UUID; retrying a reservation
or the exact receipt reuses its original UUID without advancing order. A crash
after reservation is treated like failure and does not erase the last acceptance.

Migration 027 preserves the exact 026 v1 writer as a private implementation,
revokes its runtime/PUBLIC execution, and keeps the original public writer name
and JSON signature. The wrapper calls it in the same transaction. Shadow status
is an additional internal result field and does not replace v1 status, generation,
replay, cached-change verification or completion-time ordering. Shadow acceptance
can therefore deliberately differ from the v1 current roster. Public pages still
read v1. No source/API/caching/cron/scoring configuration changes are included.

Reservations and completions bind an optional existing worker fence exactly.
They acquire job, source and head locks in that order and recheck expiry after
waiting. An unfenced existing verification path stays explicitly unfenced; a
fenced attempt cannot omit or replace its fence at completion. Case variants of
internal UUIDs are rejected to prevent duplicate JSON scope identities. Opaque
provider IDs remain case-sensitive and unchanged.

The independent population evidence is the core batch's normalized, successfully
retained network league document, with exact configuration content/observation
references and separate real acquisition provenance. SQL checks source identity,
network times, stored count and the current accepted configuration. Content
deduplication may reuse an old configuration observation; the receipt preserves
new acquisition evidence without changing that observation. The existing
changed-cache network verification can reuse population evidence from the last
shadow acceptance only on the same mapping revision and unchanged accepted
configuration content. If that evidence is absent or the configuration changes,
shadow publication waits for a complete normal network batch.

The receipt references existing immutable roster content, including rejected
evidence. Its coverage qualifies all returned roster identities against the
independently evidenced count and immutable team entries. The accepted resource's
`observationIds` identify exact roster capture receipts in this slice, not v1's
possibly reused observation. Internal readback reads the receipt's content and
team UUIDs, validates the complete requested/captured mapping, policy, coverage,
normalization and hash, and never rebuilds membership from the v1 head. Its qualified resource covers
held players only, with unresolved native scoring-entity identities and unknown
effective dates; this resource is not historical lineup or analytics evidence.

## Bundle 1 follow-on: current group evidence

The internal accepted-roster read now adds `currentGroups` per team, projected
from the same receipt-linked content after the existing mapping, UUID, hash and
normalizer checks. This is `current-roster-field-evidence` with projection version
`sleeper-current-groups-v1`; it is not a second `AcceptedResource`. Immutable SQL
coverage remains `players` only. No migration, query, writer, normalizer,
acquisition or public presenter changes are required for this extension.

Ordered starters preserve native indexes and repeated literal `"0"` vacancy
markers. Reserve and taxi preserve their native lists. Missing/null lists remain
unknown; an explicit empty list is known empty. Membership outside held players
or across conflicting groups withholds only the affected group fields. A vacancy
marker cannot become a reserve, taxi or bench player. Derived bench membership
requires all exclusion groups to be known and a usable held inventory. Raw lists
remain available for inspection even when placements are withheld. Existing v1
rejection of structurally invalid or duplicate optional arrays is unchanged.

Every field is labeled `current-display`, copies the accepted capture's receipt
reference and actual source provenance, and reports unknown freshness and
unverified historical applicability. No slot rule, canonical player identity,
current injury status or historical roster status is inferred. Equal-content
reacquisition uses its new receipt's timestamps without restamping the original
observation; legacy-head changes cannot substitute another capture's groups.

Adapter and isolated-SQL cases cover these limits, group-only corrections with
unchanged held players, immutable evidence and comparison with the existing
presenter on complete non-conflicting captures. Qualification and release are
recorded in the existing [Step 2 ledger](step-2-checklist.md). PR271 is qualified at
`caab634883d44aa907d14dd00a8cd57a627f97f2`: protected SQL run 36608760918 passes
40 files / 640 tests / zero skips, including both new group cases. Its sanitized
receipt verifies process closure, schema cleanup, credential revocation and
branch deletion, with no failures or production writes. Hosted CI and exact-SHA
Preview also pass. This follow-on remains unmerged and unreleased; PR270's earlier
receipt remains separate evidence for its own commit.

## Bundle 1 follow-on: dated current player metadata

The A2 metadata continuation composes optional metadata with the internal accepted-roster
read using an already-loaded player catalog. It adds no catalog request or public
reader switch. Current player names, NFL team, position, eligibility and
injury/status evidence are separate from accepted roster membership and groups;
missing or invalid metadata must not make those official roster facts unavailable.

The existing filtered catalog merger preserves each supplying position slice's
revision and original retrieval date. Different cached ages remain separate, and
missing/invalid dates stay unknown. It must preserve the existing aggregate
`sourceRevision`, completeness, warning and player-selection behavior. In
particular it must not add global `observedAt` or `identityRevision` to that merged
path: existing all-player workers use those fields to select lineage and provider
context. The existing bulk catalog path retains its own behavior.

Metadata uses its source revision, including injury/status changes, rather than
an identity-only revision. It is current-display evidence with unverified
historical applicability; a player name does not prove historical NFL membership,
a missing team does not mean a bye, and absent injury data does not mean healthy.
The accepted roster receipt retains its original time even when supplied metadata
is newer. Conflicting catalog identities remain excluded. Equal rows from
multiple positions retain all supplying evidence; a merge must not silently pick
the newest timestamp as if it dated every source field.

This increment does not finish A2 historical slot applicability. The existing
`resolveConfigurationComponent` accepts explicit exact-period bindings, but
ordinary `observed_current` collection does not create such proof and there is no
qualified history-store binding reader yet. Existing exact-matchup facts remain
usable without slot labels or historical injury/team metadata. Broader retained
comparison and applicability qualification remain open in the Step 2 ledger.
Existing evidenced-period configuration activations can support a conservative
reader without a new schema, but their period domain and source linkage must be
proved against the requested native matchup period first. Period mapping therefore
precedes consuming those bindings; current configuration is not a substitute.

## Rollout, rollback and validation status

Authoring 027 does not install it. Apply only after separate production migration
authorization and exact-head SQL qualification. The new application requires 027
before activation. Old callers against 027 preserve their original writer result
and cannot create shadow acceptances. Application rollback retains all new tables,
receipts, attempts and history; old callers continue v1 operation and shadow
inventory stops updating. Do not remove guards, rewind heads, widen grants or
delete history to roll back. Preview/database-disabled behavior remains unchanged.

Network capture adds one scoped reservation round trip; persistence remains one
call through the existing administration writer. Cached checks add no reservation
round trip. Internal readback is one statement and is not attached to pages. New
receipt/history storage is additive; fleet cost and latency are unmeasured. Record
targeted/full local totals, CI, preview, exact SQL run and cleanup separately in the
PR/task. Tests committed here do not constitute SQL qualification, production
installation or completion of package 2.
