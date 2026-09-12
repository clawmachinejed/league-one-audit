# All-player statistics foundation

This foundation retains one shared Sleeper weekly response and scores its
validated immutable content for each distinct registered league scoring profile.
It adds no rankings, PPG, UI, public API, Tank01 feed, or cron schedule.

The September 12 repair is not an operational-completion claim. The retained
2026 Week 1 evidence is incomplete. Production release, backfill, and recurring
activation remain separate gates. See [eligibility](all-player-eligibility.md),
[identity correction](all-player-identity-repair.md), and the repair release
record for exact evidence and pending decisions.

## Authority and inventory

Sleeper is the official identity, roster, lineup, schedule, scoring, and actual
point authority. Tank01 supplies projections and game state through the existing
worker; this operation reads stored projection/game evidence and never calls
Tank01. Neon retains snapshots and immutable statistical history.

The existing shared catalog boundary loads one unfiltered official catalog for
an all-player invocation. Both league loads reuse that same promise. Weekly
response identities are classified by their official catalog identity, including
IDP, punters, offensive linemen, fantasy-relevant fullbacks, and unusual stat
rows. Stat-key shape never proves identity. TEAM_ aggregates remain distinct
source evidence. The ordinary website catalog path retains its existing behavior.

The period inventory is separate from current catalog metadata. It records the
requested season/week, source revision, observation time, scope exclusions,
period-specific team context and participation evidence. Current active status,
team membership, or absence from a filtered catalog cannot prove historical
eligibility or justify an exclusion. All required roster, reserve, taxi, starter,
and canonical defense identities remain required even without a weekly stat row.
The registry independently constructs exactly one entry for each of the 32
canonical defenses; filtered DEF catalog rows are not the defense authority.

Without reviewed period inventory evidence, the adapter retains a conservative
catalog inventory and marks period completeness unproven. This is an honest
partial observation, not a claim that every historical catalog player belongs
in the requested season. Unknown identities and missing requested-period
evidence cannot be removed to manufacture complete coverage.

Identity provenance distinguishes required official identities, catalog
inventory, and optional projection aliases. Missing official mappings may be
proposed only from validated inventory. A stored verified flag is insufficient
semantic proof: explicit provider crosswalk evidence, official classification,
entity kinds, canonical consistency and validity intervals must agree.
Distinct official identities may not collapse onto one canonical target.

Unusable optional aliases remain unresolved source evidence with scoped
diagnostics. They do not veto valid official statistics. Required identities
remain strict. The reviewed Tank01 4429835 / Sleeper 8063 pairing is quarantined in
the shared boundary and cannot create future aliases or candidates. No
replacement is guessed from a name or current team.

## Eligibility and finality

An authoritative appearance yields eligible 1 / appearance 1. Exact-game
dressed-but-unused evidence yields 1 / 0 and permits a legitimate zero; contradictory
nonzero points fail validation. Period-specific ineligibility and canonical bye
evidence yield 0 / 0 with source, observation time and effective period retained.
Missing rows and ambiguous or malformed participation flags retain null counts.

gms_active=1 without gp is unknown. Sparse numeric statistics may default to
zero only inside a valid observed record. A missing row is not such a record.
gms_active=0/gp=1 and malformed flags retain their original evidence and null
counts through adapter, domain validation and raw persistence.

Completed backfill independently requires every distinct game in the exact
canonical requested-week schedule to be final. A zero count of nonfinal eligible
entries cannot establish schedule completion. Recurring current-week capture
may retain nonfinal observations, subject to the same inventory, eligibility,
scoring and identity requirements.

The sanitized audit fixture is deliberately partial. It retains Jones and
DeVito's reviewed unused zeros, Willis's ambiguity, Brown's historical
appearance and 4.1 points despite current Inactive metadata, and Henderson's
missing row. Its 49 matching official arithmetic comparisons prove a subset only.

## One operation and substantive preflight

runAllPlayerIngestion is shared by operator, composition and recurrence.
It checks period, required inventory/mappings, registered profiles, supported
active rules and official point readiness before the weekly GET where loaded
inputs permit. It then validates complete input shape, eligibility, canonical
game context, scorer arithmetic, every rostered official point including bench,
and the exact writer serializer before ancillary identity or parity writes.

The pure batch preparer is shared with the SQL writer. Official observation
preparation also uses the writer's pure serializer before identity writes.
Identical profiles share one score set; divergent profiles each require a
complete score set. Duplicate official targets, canonical targets, rosters and
conflicting evidence are rejected.

Valid partial observations may be retained as raw content and retrieval
history, with zero complete score sets and no pointer movement. Invalid
observations are rejected. Complete observations may proceed only after every
profile's parity succeeds under the existing tolerance.

Shadow must execute the substantive preflight with zero production data writes.
Its live-request budget policy is a pending release decision: a reusable
read-only reservation cannot safely authorize repeated live GETs. A supported
production procedure must either replay one separately budgeted capture or
explicitly authorize only durable budget/lease bookkeeping for shadow. Do not
run a live shadow until that decision and its implementation evidence are
recorded.

## Persistence and publication

Installed migration 010 remains unchanged. Its six tables retain raw content,
entries, observations, score sets, score rows and current pointers. Additive 011
hardens ownership, evidence and sealed-child insertion boundaries. It also adds
one immutable score-verification relation so unchanged score content can be
reused while a later retrieval retains its own official parity lineage.

A later unchanged response may add retrieval and verification evidence without
copying every raw entry or score. Corrections to meaningful statistics,
eligibility or official parity material create new content where required.
Exact replay remains idempotent. Both original and later verification lineage
must remain protected from retention.

The single all-player SQL batch verifies physical counts, supported scorer and
rules, current usable mappings, exact period/game context, full official parity
and the complete peer-profile group. Pointer advancement atomically verifies the
existing job's live owner, generation, expiry, period and deadline. A stale
worker cannot publish after takeover or expiry. Completion also rejects lost
ownership. Child insertion guards reject new entries/scores after the parent is
sealed or published while preserving initial creation and exact replay.

Ancillary identity and official observations are not in the same transaction as
the final batch. Known deterministic failures must occur before them; valid
ancillary writes are idempotent and observable if a later database failure
occurs. A durable-outcome failure must retain evidence of any already-confirmed
publication rather than report that no write occurred.

## Recurrence and request budget

The existing authenticated live-projections route remains the only cron
attachment. ALL_PLAYER_RECURRING_ENABLED must equal true; disabled mode returns
before all-player database or provider work. A fifteen-minute in-process
opportunity check avoids minute-level all-player queries. SQL remains the
cross-invocation budget authority.

One global Sleeper all-player job covers all periods and explicit operators.
It permits at least 12 hours between weekly requests and no more than 2 requests in
a rolling 24 hours. Claiming chooses one period; marking the request is atomic and
one-use for that generation. Provider failures retain the request budget.
Failures before a weekly request receive a safe cooldown.

Previous-week final capture receives the first opportunity at rollover, then
alternates with current-week work inside a finite schedule-derived correction
window. A missed final capture remains an explicit overdue obligation across
later rollovers; there is no unlimited historical polling. A successful final
capture is not erased by a later failed correction.

The all-player execution deadline is at most 50 seconds from the shared
invocation start, with time reserved inside the existing Vercel limit for
durable outcome handling. Abort signals reach supported database/provider calls.
Checkpoints reject late work, and SQL independently rejects late publication.
A recurring opportunity with insufficient remaining invocation time returns an
explicit failure without starting another request.

Durable outcomes distinguish publication, retained partial data, validation or
provider failure, timeout, and lost ownership. Busy/not-due state must remain
observable without turning cooldown polling into another write or retry storm.

## Release, capacity and recovery

Use the actual checksummed release wrapper and PostgreSQL 18 constraint manifest
for additive 011. Never edit installed 010 or use a destructive down-migration.
Keep recurrence disabled through migration, alias correction, deployment,
complete Week 1 shadow and verified guarded backfill. Verify the exact merged SHA
in production and both leagues' existing readers before activation.

Do not infer capacity from JSON byte counts or query counts. Measure isolated
table/index/TOAST growth for complete/partial batches, replay, later unchanged
retrieval, corrected stats/eligibility, both profile shapes, identity additions
and official parity history. Separate provider inbound bytes, client database
writes, Neon outbound responses, physical storage and compute. Recheck actual
allowances and ordinary workload growth before asserting season fit.

No paid upgrade or history deletion is authorized. The first actual backfill
must be compared with measured estimates before recurrence is enabled.
Operational completion requires an actual scheduled success and subsequent
not-due behavior; local rollover tests do not prove future live events.

Recovery starts by disabling recurrence and preventing stale ownership from
publishing. Preserve the last verified pointers and all immutable history.
Roll back only to reviewed compatible code/configuration. Follow the narrow
alias correction's compensating procedure, abort on changed references or
unproven identity, and retain additive database guards unless a separately
reviewed safe migration says otherwise.
