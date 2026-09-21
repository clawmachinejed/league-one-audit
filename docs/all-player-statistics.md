# All-player statistics foundation

The [Week 1 recovery runbook](week-one-statistics-recovery.md) covers unresolved historical game context, dual-position roster metrics, verified pregame empty responses, and the additive 018 release/rollback procedure.

This foundation retains one shared Sleeper weekly response and scores its
validated immutable content for each distinct registered league scoring profile.
It derives per-player season total points and points per game from published
weekly score pointers. The server-side Rosters read model also derives provisional
position ranks and PPG from accepted raw observations. League / Rosters now uses
the [weekly 4 AM cutoff](weekly-roster-metrics.md) for those display values;
ongoing collection and complete-score publication retain their own cadence.
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
`current_all_player_score_sets`. For each permitted week without a published
pointer, the same read selects that week's newest accepted partial observation
and returns entries with confirmed appearances or
stored sparse stats that intersect an active scoring rule. Empty unplayed inventory
rows remain excluded. The browser never reads this storage directly.

The partial row is scored by the same canonical sparse-stat scorer used by the
all-player operation. Published and provisional records for the same week are
mutually exclusive, so a week/player cannot be counted twice. Newer immutable
partial corrections supersede older observations by observation, request, and
creation time. Valid partial weeks continue contributing after rollover and in
historical views; a later complete publication replaces only its own week's
partial contribution. Historical selection stops at the selected week; future
selection stops at the active scoring week. If a whole required prior week has
no accepted capture or publication, known metrics remain explicitly partial and
position ranks are withheld. No denominator is invented for that missing period.

PPG is confirmed cumulative fantasy points divided by confirmed appearances.
Unknown or conflicting partial participation contributes to neither the PPG
numerator nor denominator. An unusable later period cannot erase an earlier
valid contribution; the affected position's rank is withheld. A zero cumulative total, zero appearances, malformed
evidence, or unresolved identity yields `null` for display as an unavailable
dash. Confirmed negative totals and PPG remain valid.
Confirmed zero-point appearances remain in the cumulative denominator, including
when earlier published totals cancel to zero. For example, 10 points followed by
a zero-point appearance gives 5.0 PPG across two appearances.

Position rank uses nonzero cumulative fantasy points, independently for each
league scoring profile and for QB, RB, WR, TE, K, and DEF. The population is all
usable stored scoring identities, not only rostered players. Exact ties use
standard competition rank; provider identity supplies deterministic ordering
without breaking the shared rank. Rank comparison uses four decimal places per
weekly contribution, matching the existing published `numeric(14,4)` score
precision, with decimal halves rounded away from zero. Those weekly rank units
are summed across periods. This removes floating-point artifacts such as
`3.1000000000000005` versus `3.1` without changing the canonical scorer's totals
or PPG. A total that is zero at rank precision has no position rank and does not
shift the ranks of negative totals.
The accepted raw inventory already classifies official Sleeper player identities.
A provisional player may therefore compete by its Sleeper ID before a canonical
mapping has been registered. Its internal canonical ID remains null; the reader
does not create an identity, link providers, or write to the database. This applies
only to Sleeper player rows in accepted partial history. Published scores and
canonical defenses still require their canonical identities.

For partial rows, an existing mapping must be usable at the read transaction's
time. A legitimate registration after the original observation can enrich that
source-keyed record without rewriting it. Existing retired, unverified, expired,
future-valid, wrong-kind, or conflicting mappings cannot fall back to an absent
mapping. Distinct official identities sharing one canonical entity, or one
official identity conflicting with a published canonical target, fail the read
safely. Invalid scoring and unusable mappings continue to withhold the affected
position's rank.

Legacy `rankUnavailablePositions` raw coverage describes optional projection
identity gaps. It remains stored diagnostic evidence and does not govern actual
statistic ranks. An unresolved Tank01 projection cannot hide valid Sleeper actual
points. Participation uncertainty affects PPG independently from valid observed
point totals; contradictory known nonparticipation remains guarded.

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
before all-player database or provider work. The user-authorized hourly schedule
uses `America/New_York`, including daylight saving time: noon, 1–11 PM, and
midnight every day. The cron checks the first two minutes of each eligible hour;
the second opportunity allows recovery when existing projection work consumed
the first invocation's deadline. Other minutes and overnight hours perform no
all-player database or provider work. SQL remains the cross-invocation authority.

One global Sleeper all-player job covers all periods and explicit operators.
It permits one weekly request per scheduled Eastern hour and no more than 13
actual request starts in a rolling 24 hours. This replaces the former 12-hour,
two-request policy through additive migration 014. Wall-clock slots tolerate
ordinary cron jitter; they are not a sliding sixty-minute delay between starts.
Claiming chooses one period; marking the request is atomic and one-use for that
generation. Explicit operators share the same window, ownership and budget.
Provider failures retain their consumed slot. Failures before a weekly request
receive a safe cooldown. These are bounded opportunities, not a guarantee that
every request succeeds; late prior-day requests can delay admission under the
rolling cap.

Migration 019 shares the same job and bulk source with current live D/ST projections.
The global network reservation is spaced at least 60 seconds apart (at most 1,440
in a rolling day), while `requestStarts` retains the independent 13-slot hourly
history budget. A successfully fenced same-period response can be reused without
another network reservation. Live-only fences cannot write all-player history or
change its outcomes. Minutes zero and one prioritize a due hourly capture, and
period alternation follows the last all-player outcome rather than intervening
live captures. Compact recent defensive evidence may be reused from existing
official observations with its original times and full score-parity/freshness
checks; it is not another history/cache subsystem. See
[live defensive projections](live-defense-projections.md) for the complete policy.
Previous-week final capture receives the first opportunity at rollover, then
alternates with current-week work inside a finite schedule-derived correction
window. A missed final capture remains an explicit overdue obligation across
later rollovers. It does not halt valid current-week raw collection after that
window: the operation retains the overdue diagnostics for review. There is no
unlimited historical polling. A successful final capture is not erased by a
later failed correction, and a partial capture never counts as complete final
scoring or backfill.

The all-player execution deadline is at most 50 seconds from the shared
invocation start, with time reserved inside the existing Vercel limit for
durable outcome handling. Abort signals reach supported database/provider calls.
Checkpoints reject late work, and SQL independently rejects late publication.
A recurring opportunity with insufficient remaining invocation time returns an
explicit failure without starting another request.

Durable outcomes distinguish publication, successful retained partial data,
validation or provider failure, timeout, and lost ownership. A valid recurring
partial capture reports `partial`, preserves the observation and makes supported
player metrics readable without claiming complete score publication. Busy/not-due state must remain
observable without turning cooldown polling into another write or retry storm.

## Release, capacity and recovery

Use the actual checksummed release wrapper and PostgreSQL 18 constraint manifest
for the reviewed additive migration. Never edit installed 010–013 or use a
destructive down-migration. The September 13 authorization permits hourly capture
of valid current-week partial observations and their roster metrics independently
of complete Week 1 backfill. Keep recurrence disabled through migration,
deployment, identity/capacity verification and reader checks. Follow the
[hourly release runbook](live-roster-hourly-release.md) before activation and
verify an actual scheduled capture. Complete shadow, scoring and backfill retain
their independent inventory, eligibility, finality and full-parity requirements.

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

The user plans to upgrade Neon separately; this does not authorize the agent to
purchase a plan. No history deletion is authorized. Verify effective capacity
before enabling the hourly lane, then compare the first actual capture with
measured estimates. Complete backfill requires its separate capacity evidence.
Operational completion requires an actual scheduled success and subsequent
not-due behavior; local rollover tests do not prove future live events.

Recovery starts by disabling recurrence and preventing stale ownership from
publishing. Preserve the last verified pointers and all immutable history.
Roll back only to reviewed compatible code/configuration. Follow the narrow
alias correction's compensating procedure, abort on changed references or
unproven identity, and retain additive database guards unless a separately
reviewed safe migration says otherwise.
