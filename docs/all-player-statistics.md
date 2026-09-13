# All-player statistics foundation

This foundation retains one shared Sleeper weekly response and scores its
validated immutable content for each distinct registered league scoring profile.
It derives per-player season total points and points per game from published
weekly score pointers. The server-side Rosters read model also derives provisional
current-week position ranks and PPG from the latest accepted partial observation.
It adds no public all-player API, Tank01 feed, ingestion call, or cron schedule.

The September 12 repair and partial production capture are not an operational
completion claim. The retained 2026 Week 1 evidence is incomplete. Complete
Week 1 scoring, backfill, and recurring activation remain separate gates.
See [eligibility](all-player-eligibility.md),
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

## Participation from existing providers

The selected production policy uses the existing Sleeper and stored Tank01
inputs. It adds no connection, gamebook feed, player request, or roster feed.
Sleeper's requested-week statistics supply observed participation; Tank01's
existing stored game states supply exact-game phase and finality. The user has
also selected an explicit product assumption: when an individual player's clean
participation values are zero or missing and no positive appearance is recorded,
record an assumed appearance count of zero. This replaces the previous policy
that left such appearances unknown. It does not create a provider fact, an
injury designation, or an eligible denominator for an entirely missing row.

`sleeper-weekly-stats-v4` retains exact individual offensive, defensive, and
special-teams snap counts (`off_snp`, `def_snp`, `st_snp`) as weekly evidence.
At least one positive individual snap count proves an appearance when the row
contains no contrary participation flag or malformed participation value. Counts
must be nonnegative safe integers. Clean `gp=1` continues to establish appearance
even if individual snap fields are absent or zero. Team totals (`tm_*_snp`) and
fantasy points alone do not establish participation. The new assumption applies
only to players; canonical defense evidence and missing-row rules are unchanged.

| Requested-week evidence | Eligible | Appearances |
| --- | ---: | ---: |
| `gp=1`, with no contradictory participation evidence | 1 | 1 |
| Positive individual snaps, with no contradictory participation evidence | 1 | 1 |
| `gms_active=1,gp=0`, with no positive individual snaps | 1 | 0 |
| `gms_active=0`, with no appearance evidence | 0 | 0 |
| Clean `gms_active=1`, missing `gp` and no positive individual snaps | 1 | 0, assumed |
| Entirely missing player row without separate period evidence | Unknown | 0, assumed |
| Clean player row without `gms_active` or positive appearance evidence | Unknown | 0, assumed |
| Positive individual snaps with `gp=0` or `gms_active=0` | Unknown | Unknown |
| Malformed, conflicting, or reviewed ambiguous participation evidence | Unknown | Unknown |

An assumption is stored as `assumed-nonparticipation`, policy
`missing-participation-as-zero-v1`, source `product-policy`, and the requested
effective period. Its basis retains the untouched weekly evidence or the
original missing-row inventory fingerprint. Coverage separately counts assumed
nonappearances, unknown eligibility, and unknown appearances. The adapter never
inserts an artificial `gp=0` into the source record or erases observed statistics.

Current status and injury designations are retained as dated provider context,
separate from the evidence that sets these counts. Observation time records when
the label was obtained; it does not establish that the label applied to the
requested game. Current Inactive metadata cannot undo an earlier appearance.
An active roster label cannot establish game-day availability. A healthy scratch
requires explicit evidence of non-injury inactivity for that game; neither
missing statistics nor a generic Inactive label supplies the reason. Dressed but
unused and inactive are different states.

The existing integration does not retain exact-game player inactive reasons
from Tank01. The approved appearance assumption therefore leaves the cause of a
missing row unresolved. Separate valid exact-period inactive/injury evidence
could establish eligible 0 / appearance 0; the product policy itself supplies no
injury reason. It never hardcodes an exception for Henderson or any other player.

## Eligibility and finality

An authoritative appearance yields eligible 1 / appearance 1. Exact-game
dressed-but-unused evidence yields 1 / 0 and permits a legitimate zero; contradictory
nonzero points fail validation. Period-specific ineligibility and canonical bye
evidence yield 0 / 0 with source, observation time and effective period retained.
Ambiguous, contradictory or malformed participation retains null counts even
under the new policy. A clean missing player row instead retains unknown
eligibility and an explicitly assumed appearance zero.

`gms_active=1` without `gp` or positive individual snaps receives the policy's
eligible 1 / appearance 0 assumption. Sparse numeric statistics keep their
existing scorer behavior; the assumption does not replace a missing source row
with an observed numeric record. Nonzero calculated or official points must not
be zeroed to fit a nonappearance. If those points contradict an assumption, the
runtime withdraws that assumption, restores its unchanged original evidence and
unknown counts, and retains a valid partial observation with scoped diagnostics.
It never scores an entirely missing row. Confirmed nonappearance contradictions
still fail scoring validation. The v4 writer validates that raw flags and snaps
agree with the nested original basis. Installed v2/v3 observations and exact
replays retain their original contracts; corrections create new immutable content.

Completed backfill independently requires every distinct game in the exact
canonical requested-week schedule to be final. A zero count of nonfinal eligible
entries cannot establish schedule completion. Recurring current-week capture
may retain nonfinal observations, subject to the same inventory, eligibility,
scoring and identity requirements. An assumed zero before a game is not a final
DNP conclusion. A later positive `gp` or snap observation supplies the normal
immutable correction; the policy never marks an unplayed game final.

The sanitized audit fixture is deliberately partial. Its original reviewed
gamebook cases remain archival regression evidence and are unchanged. A separate
provider-only policy replay omits those review overrides: Jones 7527, DeVito
11292, and Willis 10224 receive assumed 1 / 0 from clean weekly activity rows.
Henderson 12529's missing row receives unknown / 0, without an invented injury
or game-day inactive designation. Brown 5859 retains his
appearance, 31 offensive snaps, and 4.1 official points despite the captured
Inactive label. This does not erase the independently reviewed dressed-but-unused
facts about Jones and DeVito; those facts are outside the selected live input.

The retained 301-row response contains 187 rows with positive individual snaps;
all 187 already report `gp=1`. The new snap rule therefore resolves no additional
positive appearances in that capture. The v4 provider-only replay retains 4,385
inventory entries, including 32 canonical defenses: 96 known eligible entries,
63 appearances, 4,294 assumed nonappearances, 4,289 unknown eligibility counts,
and 28 unknown appearances from missing defense rows. These are historical
fixture counts, not current production totals.
Its 49 matching official arithmetic comparisons prove a subset only. Real Node
composition replays both leagues through one shared local weekly response with
no database writes or Tank01 requests; that is offline execution evidence, not
a completed production shadow or complete-period parity.

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

The server-only player metrics reader derives cumulative totals, position rank,
and PPG in the existing Rosters request. It selects the requested league's
scoring profile, season, season type, scorer version, and weeks through the
requested boundary. Compact published totals come from
`current_all_player_score_sets`. When the boundary includes the active week and
that week has no published pointer, the same read selects only the newest
accepted partial observation and returns entries with confirmed appearances or
stored sparse stats that intersect an active scoring rule. Empty unplayed inventory
rows remain excluded. The browser never reads this storage directly.

The partial row is scored by the same canonical sparse-stat scorer used by the
all-player operation. Published and provisional records for the same week are
mutually exclusive, so a week/player cannot be counted twice. Newer immutable
partial corrections supersede older observations by observation, request, and
creation time. Historical selection stops at the selected week; future selection
stops at the active scoring week.

PPG is confirmed cumulative fantasy points divided by confirmed appearances.
Unknown or conflicting partial participation contributes to neither the PPG
numerator nor denominator. A zero cumulative total, zero appearances, malformed
evidence, or unresolved identity yields `null` for display as an unavailable
dash. Confirmed negative totals and PPG remain valid.
Confirmed zero-point appearances remain in the cumulative denominator, including
when earlier published totals cancel to zero. For example, 10 points followed by
a zero-point appearance gives 5.0 PPG across two appearances.

Position rank uses nonzero cumulative fantasy points, independently for each
league scoring profile and for QB, RB, WR, TE, K, and DEF. The population is all
usable stored scoring identities, not only rostered players. Exact ties use
standard competition rank; provider identity supplies deterministic ordering
without breaking the shared rank.
Stored `rankUnavailablePositions` coverage and scoring rows without usable
identity mappings suppress the affected position's rank while preserving valid
individual PPG. Distinct official identities sharing one canonical entity fail
the metrics read safely; they cannot enter the ranking population twice.

Because the published side follows current pointers, a verified correction
replaces the superseded weekly score automatically. Immutable historical score
sets and partial observations remain unchanged. League One and League Two remain
isolated by their registered scoring profiles. The reader includes canonical team
defenses in the DEF ranking population and returns bounded status, observation
time, and through-week metadata. Storage or scoring failure leaves Rosters usable
with unavailable metrics.

Installed migration 010 remains unchanged. Its six tables retain raw content,
entries, observations, score sets, score rows and current pointers. Additive 011
hardens ownership, evidence and sealed-child insertion boundaries. It also adds
one immutable score-verification relation so unchanged score content can be
reused while a later retrieval retains its own official parity lineage.
Additive 012 extends evidence validation for v3 individual snaps and retains
dated provider context separately from reusable raw statistical content.
The additive v4 policy migration validates explicit assumptions and allows a
faithful unknown eligible count alongside an assumed appearance zero. Installed
migrations and historical v2/v3 counts remain unchanged.

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
for the reviewed additive migration. Never edit installed 010–012 or use a
destructive down-migration. Keep recurrence disabled through migration, deployment,
complete Week 1 shadow and verified guarded backfill. Verify the exact merged SHA
in production and both leagues' existing readers before activation.

The user's product decision resolves missing appearance values by an explicit
assumption. It does not resolve historical inventory, eligibility for entirely
missing rows, incomplete defense evidence, final schedule, full parity, or
capacity. Those gates still prevent incomplete score sets or pointer movement.

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
