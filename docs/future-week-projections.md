# Future-week projection operations

This document describes the production policy for preparing projected matchup scores after the active scoring week. It covers Weeks 2–18 of the 2026 regular season and later seasons that use the same 18-week format. It does not change `clock-v1`, current-week live scoring, the public matchup payload, URLs, or presentation.

## Period authority

Sleeper remains the active league authority during this phase of the product. Two values have distinct jobs:

- The league display week is the website's default matchup week.
- The active scoring week is the period eligible for official live points.

Both values are normalized into a durable `LeaguePeriodAuthority`. The future horizon begins after the authoritative current period and never before Week 2. The worker fails closed if the configured leagues disagree about the season, season type, lifecycle, display period, or active period. It never infers the current week from the largest week stored in Neon.

This boundary is portable: a future first-party league service can implement the same calendar and league-source ports without changing future scheduling, scoring, or snapshot publication.

## Two-stage preparation

Future preparation has two durable actions.

### Projection ingestion

The worker requests the selected weekly projection response from Tank01, validates the full provider slate, normalizes it once, and records it as immutable content plus an observed version in Neon. A current pointer advances only to a complete and chronologically valid observation. Equal normalized content creates a new observation for freshness proof while reusing the same content identity.

The stored slate is provider-native and league-independent. Both leagues, and leagues added later, share the same weekly slate. This action does not load fantasy lineups or calculate team totals.

### League materialization

The worker reads the current stored slate, loads the selected week's lineup and scoring settings from Sleeper, and requests one fresh Tank01 game-state slate shared by all ready leagues. It validates matchup completeness, lineup slots, schedule coverage, source identity, and the exact selected period. It then:

1. Resolves player, defense, and NFL-game identities.
2. Stores the shared game-state and provider observations.
3. Normalizes each distinct raw Sleeper scoring profile once.
4. Scores each provider stat line for that profile.
5. Freezes eligible baselines under the existing kickoff rules.
6. Builds the existing `MatchupsData` payload.
7. Publishes one immutable league snapshot and advances or verifies its current pointer atomically.

Materialization makes no Tank01 projection request. A missing participant projection becomes zero only after the full slate has passed its provider-level and schedule-aware validation. Incomplete fantasy matchups or unresolved playoff pairings do not publish a fabricated team snapshot.

## Freshness and lineage

Future snapshots are last-known-good data. Their usability is not determined by a fixed snapshot-age rule.

A future materialization is current only when its durable state proves all of the following:

- It uses the active projection provider, normalizer version, and `clock-v1` model identity.
- Its recorded projection observation and content match the current provider-slate pointer.
- Its recorded Sleeper source revision matches the official observation used by the snapshot.
- Its recorded snapshot revision matches the current league/week pointer.
- The current pointer was published or reverified after that official observation.
- No attempt is currently active and its next refresh date has not arrived.

If refreshed sources produce identical public content, publication returns `unchanged` and advances `verifiedAt`; this new verification is still required before the durable materialization is marked complete. A failed, partial, stale, or contradictory run leaves the previous valid snapshot intact and records a bounded retry state.

## Scheduling policy

Current-week work always has priority. The worker may perform at most one future action after the current period is idle or its hourly job has already completed.

Week 2 is the initial canary. No later week is eligible until all configured leagues have completed one Week 2 materialization.

| Distance from authoritative period | Projection slate | League materialization |
| --- | --- | --- |
| Week + 1 | Every 6 hours | Every hour |
| Weeks + 2 through + 4 | Every 24 hours | Every 24 hours |
| Week + 5 and farther | Every 7 days | Every 7 days |

Initial work for later periods is staggered by 15 minutes per week of distance. A failed action retries after 5 minutes, 15 minutes, 1 hour, and then 6 hours for subsequent failures. Durable claims make duplicate cron delivery safe and allow expired attempts to recover.

## Execution safety

The Vercel route has a 60-second execution limit. Future work uses stricter internal limits:

- No new future stage may begin after 45 seconds of total worker time.
- The whole future operation is aborted at 50 seconds using a monotonic clock.
- Every Neon query in that future operation receives the same abort signal.
- Provider promises are raced by the whole-operation deadline even when a cached provider interface cannot accept that signal directly.
- A separate cleanup attempt is limited to four seconds.
- Individual future claims expire after 55 seconds; the global job lease remains 120 seconds.

The timeout cannot publish partial state. Immutable observations already completed before a timeout may remain safely stored, while the current snapshot pointer moves only through the existing atomic publication check.

## Failure boundaries and logging

One league's Sleeper, scoring, observation, or publication failure does not block a healthy peer league. A shared projection-slate, game-state, identity, or provider-persistence failure rejects every league that depends on that provider group.

Logs retain the existing stage and outcome fields and add safe future-action context: run ID, selected period and distance, provider group, durations, provider outcome, coverage, game count, league counts, starter and candidate counts, baseline counts, source skew, identity conflicts, snapshot revision, publication outcome, lease result, and stable failure code. Logs never include credentials, database URLs, authorization headers, raw provider payloads, or provider error bodies.

## Verification and capacity limits

The isolated Neon suite validates migrations, permissions, immutable slate content, observation lineage, claims, retries, snapshot verification, unchanged publication, kickoff protection, retention, and safe reads against a disposable database.

Synthetic future-path tests use twelve managers, six matchups per league, and all 16 NFL games. They cover 2, 3, 50, and 300 leagues and verify one projection feed per period, one shared game-state feed for materialization, zero materialization projection calls, one stored-slate read, bounded concurrency, bounded outstanding work, and deterministic results.

These tests prove the shape of the work, not production capacity. Production remains configured for two leagues. Supporting approximately 50 or 300 active leagues requires later remote load testing, provider-rate validation, a database-backed registry, partitioned durable tasks, renewable and fenced leases, and backlog monitoring.

Before operating across multiple completed seasons, add a reviewed retirement policy for old provider-slate pointers, current-candidate pointers, and durable future-refresh state. Their immutable history is safe for the 2026 two-league launch, but the current pruning path does not retire every season-scoped pointer during future-only or offseason runs.

Real-game validation remains an operational follow-up for the first available 2026 games: kickoff, live clock movement, halftime, final convergence, missing-player behavior, D/ST behavior, team sums, both leagues, provider-call counts, source skew, worker duration, publication, and browser polling.
