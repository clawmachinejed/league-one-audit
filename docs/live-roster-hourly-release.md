# Live roster metrics and hourly collection

The September 13 user authorization covers production release of every rostered
player's supported Position Rank and PPG and automatic statistics collection
hourly from noon through midnight Eastern. The existing Neon connection and
existing Sleeper bulk statistics adapter supply the data. The user is upgrading
the Neon plan separately. No plan purchase or history deletion is authorized.

## Starting evidence

Before implementation, local/GitHub `main` and Vercel production matched
`6709dac71d38315893e3a3d115d5cdf93ad6f355`. The canonical repository is
`clawmachinejed/league-one-audit`; Vercel project `league_one_fantasy` uses `main`
and root `apps/site`. PR #198's reviewed head was
`f0f1f98fc87b0f4888a76ae93edf6dac9b2b551f`, with successful verification and browser
checks. No competing release owner was observed in available task, worktree,
pull-request and deployment evidence. The primary checkout remained clean.

Read-only Neon evidence at `2026-09-13T16:02:46.599619Z` identified project
`solitary-base-99261075`, main branch `br-rapid-boat-avgeevye`, database `neondb`,
owner session `neondb_owner`, PostgreSQL 18.6. The latest 2026 regular-season
Week 1 capture was still `2026-09-12T21:48:57.784Z`: 4,388 inventory entries,
96 observed provider rows, 63 appearances, no complete score pointers. Its job
was completed with outcome `partial` and no lease owner. These are starting
observations, not post-release results.

## Intended live behavior

- Every expanded roster section receives server-side database metrics for its
  selected league, season and week. There is no sample-player restriction.
- Supported partial current-week values are readable before the whole week is
  complete, and valid saved partial weeks continue contributing after rollover.
  Complete publication replaces only that week's partial contribution. A missing
  whole prior week keeps the result partial and withholds position rank.
  PPG uses confirmed appearance counts, including scoreless appearances;
  zero appearances display a dash. Unknown or contradictory participation cannot
  invent a denominator. Position ranks remain unavailable when the relevant
  comparison population is unverified.
- Existing roster responses are refreshed on visible pages after scheduled
  collection has had time to finish, at three minutes past each scheduled hour.
  Hidden pages cancel work and catch up when
  visible if due. Historical selections do not automatically poll. League/week
  navigation and response identity checks prevent stale cross-scope adoption.
  Expanded cards and My Team selection survive refreshes.
- The displayed statistics timestamp is the saved observation time, independent
  of the timestamp for roster metadata. Failed refreshes preserve the last good
  display and do not claim that stale statistics were newly collected.
- One shared bulk weekly-stat request serves both leagues. The existing three
  cron definitions are unchanged. No browser calls Tank01 or the statistics
  provider, and no new feed, scorer, database connection or recurring lane exists.

The schedule uses `America/New_York`, so local noon/midnight follows daylight
saving time. There are 13 scheduled hours per day: 12:00, 13:00 through 23:00,
and 00:00. First/second-minute cron opportunities share one durable hour slot.
SQL enforces a maximum of 13 actual requests per rolling 24 hours across periods
and explicit operators. A previous day's delayed request can postpone admission;
an outage or validation failure can leave an hour without new data. Failures
retain budget and prior verified data.

The existing batch writer uses one Neon HTTP transaction at `ReadCommitted`:
first acquire and validate the existing global job fence, then execute the
unchanged guarded batch statement. The second statement receives a fresh snapshot
after any lock wait, so it can recognize a concurrent exact replay. Both steps
share one connection and transaction, cancellation is propagated, and the batch
and deferred publication guards still reject expired or lost ownership. A client
without this atomic capability fails before writes. There is no independent
preliminary lock request, retry loop, new SQL function or grant expansion.

At rollover the previous week receives the first opportunity and bounded
correction opportunities, alternating with current-week work. Overdue complete
final verification stays visible after the finite correction window but does
not globally halt current-week raw capture. Partial observations do not become
complete score sets, move complete score pointers, or satisfy complete backfill.

## Capacity gate

The user's Neon Launch upgrade was verified on September 13 before activation.
The existing project includes 500 GB monthly public network transfer; storage
is metered at the displayed $0.35/GB-month and restore history at $0.20/GB-month.
The billing window is September 13–October 1. Reset usage counters can lag an
hour and do not mean the database is empty: its measured physical size was
266,756,096 bytes at 17:46:53 UTC. Existing compute settings and the six-hour
restore window were retained; no plan purchase or billing setting was performed.

Fresh isolated measurements use the unchanged application at
`8eeba4be098b7f64935cc1b26c0ef8384dbe1a05`, migration 014, and the existing guarded
harness. The retained partial fixture remains partial. A separate synthetic
complete inventory contains 4,385 entries, all 32 canonical defenses, the actual
37 active scoring rules shared by both leagues, 336 official player occurrences,
24 roster occurrences and 179 distinct parity comparisons. Its statistics, teams
and completed-game evidence are constructed for testing, not production Week 1
completion or live parity evidence. The sanitized measurement summary is
`apps/site/release/014-capacity.launch.json`.

| Fresh measured shape | Physical relation growth |
| --- | ---: |
| Retained partial first batch | 2,760,704 B |
| Retained partial statistics correction | 2,596,864 B |
| Full shared 37-rule profile, first complete batch | 6,356,992 B |
| Full shared 37-rule profile, exact replay | 0 B; no new rows |
| Full shared 37-rule profile, later unchanged retrieval | 114,688 B |
| Full shared 37-rule profile, statistics correction | 6,168,576 B |

The later unchanged complete retrieval adds one observation, one verification,
336 official player rows and 24 roster rows, with no duplicate raw entries or
scores. The separate divergent-profile stress test measured 20 unchanged runs
at 53,248 bytes per run on average, preserving their smaller parity lineage.
The 114,688-byte full-profile result is a single observed allocation, not an
amortized marginal coefficient; allocated pages can be reused by later runs.
These different shapes must not be substituted for one another. Full-profile
preparation plus each writer operation took 20.079–22.910 seconds; these timings
exclude provider retrieval, composition and repeated identity lookups and do
not measure compute. Production retains its 50-second work deadline. The stress
test's 480-second outer allowance covers 27 independent batches and stays below
its 550-second fixture deadline; it does not extend production execution.

Each league's one-week metrics reader returned 169 SQL rows and 93,995 decoded
bytes in 52–78 milliseconds. The sparse fixture has only 20 nonzero score
candidates; the existing cumulative zero-score exclusion explains that output.
This does not measure an entire season, all 4,385 players scoring nonzero,
concurrent visitor traffic, or multiple retained partial weeks.

At 13 hourly opportunities daily, an illustrative 18-week/126-day horizon allows
at most 1,638 total requests across current, correction and explicit operator
work. Applying measured first/corrected complete coefficients to 18 first captures
and 1,620 changed captures gives 10.107 GB of physical relation growth; applying
the unchanged coefficient instead gives 0.300 GB. These are sensitivity cases,
not bounds on source distributions or billed storage. Partial historical weeks,
reader traffic, identity growth, normal application history and restore history
remain separate. No retention deletion or weaker completeness policy is assumed.

For bounded initial activation, reserve 100 GB of the 500 GB transfer allowance
for ordinary activity and 2 GB of near-term ordinary physical growth. These are
planning assumptions, not measured demand or a fixed storage quota. The prior
4.95 GB over approximately 11 days averaged 0.45 GB/day; the 100 GB reserve over
the remaining 18-day billing window is about 12 times that average. Additional
CU-hours remain unmeasured. Provider inbound, client-to-database parameters,
decoded Neon responses, billed outbound and physical table/index/TOAST
allocation are distinct quantities. Compare actual physical growth, duration,
request counts and both readers after the first natural scheduled capture;
inspect delayed billing metrics before making a sustained-cost claim.
Unexpected growth or ownership/deadline failures require disabling recurrence
while preserving data.


## Reviewed migration artifact

The actual guarded PostgreSQL 18 capture at `2026-09-13T16:36:50.771Z` produced
`apps/site/release/014-catalog.integration.json`. Independent comparison to the
reviewed 013 catalog found unchanged table, trigger and constraint fingerprints,
two owner-only helper functions, and exactly three changed existing function
bodies (`all_player_next_request_at`, `claim_all_player_job`,
`mark_all_player_request`). Existing publication and immutable-history functions
were unchanged. The actual wrapper committed successfully; a deliberately corrupt
constraint manifest rolled back both the catalog and migration ledger.

- Normalized migration SHA-256: `3aa6e19555c1e38bf7805199d401b0c6acd3ada00716950e04e54573867b1fc3`.
- Rendered production wrapper SHA-256: `547e4299a514d48764d4d6b2db278f3607638e2f0369ec026a4e4bb02a86fd67`.
- Eight isolated hourly SQL cases passed, including concurrent independent
  connections, actual-timestamp rolling limits, DST and lost ownership.
- Thirteen release-wrapper unit cases passed, including exact binding of the
  rendered production file to the reviewed catalog and migration.

These artifacts are prepared and tested; this paragraph does not claim that 014
has been installed in production.

## Compatible release sequence

1. Revalidate canonical source, exact current production SHA, Vercel binding,
   project/branch/database/roles, installed migration checksums, relevant job
   ownership and effective capacity. Stop on unexplained identity disagreement.
2. Keep `ALL_PLAYER_RECURRING_ENABLED` absent/false. Use the actual release wrapper
   and PostgreSQL-version manifest to install only reviewed additive migration
   014 after unchanged migrations 001–013. Verify the exact checksum, owner,
   runtime grants, schedule functions and immutable-history guards. No data repair
   or identity mutation is part of this release.
3. Confirm old-application compatibility while recurrence remains disabled.
   Merge the independently reviewed, fully verified PR through the protected
   branch. Confirm production runs the exact merged SHA and both league readers
   remain healthy. Normal Vercel Preview remains database-disabled and proves
   presentation only; isolated SQL tests prove database behavior.
4. Verify both production roster responses use the existing restricted Neon
   runtime connection, with supported values and truthful observation timestamps.
   Compare representative values with a compact read-only SQL calculation using
   the registered scoring rules. No live-provider diagnostic requests are needed.
5. After effective plan/capacity verification, enable the existing lane with
   `ALL_PLAYER_RECURRING_ENABLED=true` and deploy that configuration with the exact
   reviewed application. Observe the next naturally scheduled hourly opportunity;
   do not force an authenticated worker merely to create evidence.
6. Verify the durable outcome, request count, selected period, observation time,
   physical row additions/reuse, appearance counts and unchanged complete score
   pointers for partial data. Compare actual growth to the measured case before
   continuing sustained activation. Verify both league roster values, source
   timestamps, browser adoption and subsequent not-due behavior.

Never report full Week 1 backfill or complete foundation operation from a valid
partial capture. Record local checks, branch publication, preview, migration,
merge, deployment and live scheduled evidence separately with exact timestamps.

## Recovery

Disable the recurring flag and redeploy compatible configuration first. Existing
lease/generation/expiry and work-deadline guards prevent stale ownership from
publishing. Preserve raw history, existing complete score pointers and stored
identity evidence. Restore compatible application code through a reviewed Git
revert if needed; recheck both leagues and active cron definitions.

Migration 014 preserves signatures used by the old application, so ordinary code
rollback can retain it with recurrence disabled. If the hourly policy itself
must be withdrawn, use a separately reviewed additive compensating migration
that restores the prior budget bodies while preserving grants, live ownership
guards and historical job/request evidence. Do not edit installed checksums,
delete request history to reset the budget, or run a destructive down-migration.
