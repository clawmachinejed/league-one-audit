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

At rollover the previous week receives the first opportunity and bounded
correction opportunities, alternating with current-week work. Overdue complete
final verification stays visible after the finite correction window but does
not globally halt current-week raw capture. Partial observations do not become
complete score sets, move complete score pointers, or satisfy complete backfill.

## Capacity gate

The preimplementation Neon console reported 98.9% of monthly network transfer
used (4.95 GB), with metrics potentially delayed by an hour. This is insufficient
evidence to activate additional sustained traffic on the existing Free plan.
The later September 13 check still showed Free, 4.95 / 5 GB transfer,
0.44 / 0.5 GB storage usage and 66.62 / 100 CU-hours. The project listing's
267.42 MB storage value differs from the dashboard usage figure; these scopes
must not be silently treated as interchangeable headroom. History was 0.25 GB
with a six-hour retention window. No plan change was performed.
Recheck the user's effective plan, allowance scope, spend controls, billing
window and ordinary-workload headroom before large capacity measurements and
production activation. Do not perform the plan purchase for the user. The bounded
014 wrapper and eight isolated job-only tests passed on September 13; their
decoded responses were estimated below 1 MB before execution, with no statistics
batches or provider requests. This estimate is not a measured Neon billing delta.
The remaining database correctness checks can run separately while the four
`measures ...` capacity benchmarks are explicitly deferred. This is partial
verification, not completion of the repository's full verification workflow.

The requested cadence permits at most 1,638 requests over 18 weeks/126 days,
shared by current, correction and explicit operator work. Reusing the historical
measured shapes gives the following sensitivity calculations, before ordinary
application reserve and before unmeasured source distribution:

| Historical measurement shape | 18-week distribution | Calculated physical growth |
| --- | --- | ---: |
| Retained partial | 18 first captures + 1,620 changed captures | 3.087 GB |
| Synthetic divergent complete, small parity population | 18 first + 1,620 unchanged | 0.220 GB |
| Synthetic divergent complete, small parity population | 18 first + 1,620 changed | 10.838–11.184 GB |

These are arithmetic applications of the retained physical measurements, not
fresh measurements, a bound on real data, or a season-fit claim. The source
context and assumption changes can alter row width. The complete synthetic
shape has far fewer official parity rows than the real leagues. Before release,
run the guarded measurements against the final migration/application and retain
separate provider-inbound, client-to-database, decoded database-response,
physical table/index/TOAST, and actual plan-usage evidence. Query counts do not
measure compute; parameter JSON is not Neon outbound transfer.

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
