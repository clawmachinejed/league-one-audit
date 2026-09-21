# Live defensive projections

The user-authorized policy keeps official Sleeper actual points, including earned
bonuses, and estimates only the remaining standard Tank01 defensive components.
It uses the existing scorer, `clock-v1` game clock, frozen candidate, worker,
official observation and snapshot publication. No new route, cron, public payload,
provider subscription, table or history writer is introduced.

## Calculation

For an in-progress defense with remaining regulation fraction `r`:

`live finish = official actual − observed PA tier + frozen additive projection × r + estimated final PA tier`

The estimated final allowance is Sleeper's observed `pts_allow` plus the frozen
Tank01 points-allowed projection times `r`. The existing scorer selects the tier
and applies that league's scoring settings. Use Sleeper's defensive points allowed,
not the opposing scoreboard total: defensive touchdowns can make them different.

Supported remaining components are sacks, interceptions, fumble recoveries,
defensive touchdowns, special-teams touchdowns, safeties and blocked kicks, as
already mapped by the shared Tank01 normalizer and scorer. Future three-and-outs,
fourth-down stops, long-TD bonuses and other unsupported bonuses remain excluded.
Earned bonuses remain in the official total. This change does not alter scoring
rules or expand the pregame provider's supported categories.

Example with half the game left: actual 13 consists of a temporary 10-point
shutout tier, one sack and two earned bonus points. Frozen additive expectation is
8.2; the projected final allowance belongs in a 4-point tier. The forecast is
`13 − 10 + 8.2 × 0.5 + 4 = 11.1`, not 17.1 or a held pregame number.

Existing frozen raw statistics are translated on read through the original Tank01
normalizer; immutable candidates and baselines are not rewritten. The frozen
component score must equal the frozen baseline. The observed full sparse record
must reproduce official actual points within the existing `0.000001` tolerance.
Exactly one consistent PA bracket must be present. An observed sparse row can
omit numeric `pts_allow` only when its exclusive zero-points-allowed bracket and
full official-score parity establish zero. A missing defense row is not a zero.
A no-PA scoring profile can use the ordinary additive formula without a weekly-stat
request.

Invalid, missing, stale, conflicting or unsupported evidence holds the affected
defense at the existing baseline and records the reason in private observation
metadata. It does not veto the other players, teams or leagues. Official points
are never changed. Pregame, missing-baseline, bye and final policies stay intact;
final team totals use official actuals while final player rows retain their
immutable pregame forecast. Live totals feed standings and win probability through
the existing payload. The conservative D/ST probability variance remains unchanged.

## Collection, ownership and freshness

Only the current worker requests detail, after it persists canonical game states
and identifies an in-progress rostered defense. One bulk Sleeper weekly-stat source
is shared across leagues. Browsers, observers and future-week workers do not fetch
this detail. `ALL_PLAYER_RECURRING_ENABLED` must be exactly `true` before defensive
collection accesses the database or provider.

Migration 019 extends the existing `all-player-ingestion:sleeper` job and advisory
lock. A new live claim requires a recently verified current-period authority and
a fresh canonical live game. Claim, request marking and completion all verify
ownership. A live-only fence cannot authorize all-player history or score writes.
The shared network reservation is spaced at least 60 seconds apart, globally
across periods, leagues, explicit operators and hourly ingestion. This bounds
reservations to 1,440 in a rolling day; real usage occurs only during eligible live
games. There is no per-player/team request fanout and no additional Tank01 call.

Hourly all-player capture retains its Eastern noon–midnight window, one capture
per hour, maximum 13 in a rolling day, and finite previous-week correction policy.
Minutes zero and one prioritize a due hourly capture. Minute-level live outcomes
cannot change which period the hourly collector selects next. A successfully
completed, matching capture may be reused within the invocation through a durable
receipt; it consumes an hourly ingestion slot without another network request.
There are no immediate failure retries or unlimited historical polling.

Defensive provider work ends by invocation second 40, with individual requests
limited to 10 seconds. Durable handling ends by second 45, reserving at least 15
seconds of the existing 60-second route for publication and handling. This does
not claim a new whole-run deadline for the older current-worker pipeline.

Applied detail must match the exact league period and remain within the existing
90-second source span alongside official points, canonical games and calculation
time. Publication SQL independently validates its period/timestamps and includes
its completion time in `verifiedAt`. Private source and snapshot revisions include
the applied component evidence and `defense-components-v1`. Frozen baseline keys
remain `clock-v1`. The official observation and its lineup acknowledgment use the
same augmented revision.

Only the relevant applied defense rows and compact diagnostics are retained in
the existing official observation. The full bulk response stays in invocation
memory, or enters the existing hourly all-player history path under its ordinary
guards. Per-minute full all-player raw and score copies are prohibited.

When a new request is not due or fails, the worker can reuse still-fresh compact
evidence from enrolled leagues' existing observations for that exact period. It
retains the original source timestamps and revision, combines only the same
retrieval, and rejects conflicts. This does not grant a new hourly receipt or
extend freshness. The worker repeats freshness and official-score parity checks.

## Release and recovery

1. Complete the repository verification, isolated migration/publication/ownership
   tests, independent review and actual Vercel preview check.
2. Revalidate canonical main, Vercel binding/root/branch/production SHA, approved
   Neon identity, and release ownership. Obtain production authorization for the
   reviewed additive migration and application release.
3. Use the guarded 019 release wrapper and PostgreSQL-version constraint manifest
   while the compatible old application remains installed. Do not edit installed
   migration files, checksums, history or score pointers.
4. Verify the installed checksum, exact function/ACL delta and old hourly caller
   compatibility. Then merge/deploy the reviewed code and verify its exact SHA.
5. Read all three league pages and revision/full endpoints. During a naturally
   eligible live game, verify applied detail or its precise fallback reason,
   arithmetic, ownership, request count and browser adoption. A synthetic test or
   pregame preview is not proof of a live provider capture.

For rollback, disable collection if needed and revert compatible application code
through a protected PR. Keep 019 and existing history/pointers intact; it preserves
the old hourly function signatures and guards. New live callers stop with the
code rollback. Verify the intended deployment and unchanged cron attachment before
reenabling the old hourly collector. No destructive down-migration is assumed safe.

Capacity and exact release evidence are recorded with the PR. Provider inbound
bytes, database writes, Neon outbound data, physical storage and compute are
different measurements; serialized JSON is not physical storage or compute cost.
