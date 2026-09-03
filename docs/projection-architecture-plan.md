# Projection architecture plan and anti-drift contract

## Status

This document fixes the behavior and evidence baseline for the projection refactor. It is an acceptance contract, not permission to change projection behavior. Every implementation PR must remain independently reviewable, releasable, and reversible.

| Step | Scope | Status |
| --- | --- | --- |
| Baseline | Record production state and a recovery point before the four-PR sequence | Complete |
| PR1 | Document the contract and add characterization coverage without changing runtime code | Implementation complete; full-PR validation pending |
| PR2 | Mechanically split the projection store behind its stable facade | Planned |
| PR3 | Mechanically split the projection worker behind its stable entry point | Planned |
| PR4 | Cut the canonical pipeline over to provider-neutral ports and concrete adapters | Planned |

The four PRs must remain separate. Each one needs a green verification result and reviewable evidence before the next begins.

## Pre-PR recovery baseline

- Starting revision: `c9e82040d41359bd7dc1348951a893fcfc1c507f` (PR #158, **Consolidate league matchup data paths**).
- Recovery tag: `backup/pre-projection-refactor-2026-09-02-c9e8204`, pushed to the remote repository.
- Production deployment: `DvNQV2nb4d2jeZ21nLsnSwXyrsVq`, Ready, sourced from `c9e8204`.
- Production deployment alias: `leagueonefantasy-ml8oxynhv-robert-finchums-projects.vercel.app`.
- Production environment variable names: `CRON_SECRET`, `DATABASE_URL`, `TANK01_API_KEY`, and `ENABLE_EXPERIMENTAL_COREPACK`. Legacy unrelated names present at baseline are `NEXT_PUBLIC_SITE_NAMW`, `NEXT_PUBLIC_SITE_NAME`, `ADMIN_KEY`, and `NEXT_PUBLIC_TAGLINE`. This document deliberately records no values.
- Baseline verification: 385 unit tests and 13 browser tests passed.
- Both production matchup routes were healthy.

The production league IDs are not duplicated here. The authoritative values are `LEAGUE_IDS.league1` and `LEAGUE_IDS.league2` in `apps/site/lib/config.ts`.

### Stored production snapshot evidence

| League | Season/week | Snapshot | Model | Content hash | Published (UTC) | Verified (UTC) |
| --- | --- | --- | --- | --- | --- | --- |
| League One | 2026 Week 1 | `873f3c61-13c2-46d5-8ea6-01cb9a0344bf` | `clock-v1` | `59515bae72715028113e842663ee4b41f005bd1d2210582b11aaa243cf479d2a` | 2026-09-03 00:00:19.295412 | 2026-09-03 03:00:18.456 |
| League 2 | 2026 Week 1 | `5f4175a3-19a4-467b-acfa-29d1364439b2` | `clock-v1` | `a5342a58f0df4be114ba36e320e54af2e467f72fe0e299070072490c0c9554d8` | 2026-09-03 00:00:19.316991 | 2026-09-03 03:00:18.456 |

These identifiers and hashes are compatibility anchors for confirming that later code can still read the stored baseline format. The recovery tag is the code rollback point. The snapshot rows are not database restore points: reverting code does not move a Neon current-snapshot pointer back to one of these rows or delete snapshots written after the baseline. None of these values is application configuration, and they must not be copied into source code.

## Current architecture

The current system has one production writer and one shared stored-snapshot reader:

1. Sleeper supplies league identity, rosters, lineups, official fantasy points, scoring settings, player metadata, and schedule context.
2. Tank01 supplies pregame projected statistics, its crosswalk to Sleeper player IDs, and live NFL game states.
3. The scheduled worker validates both inputs, scores the pregame statistics, freezes eligible baselines at kickoff, applies `clock-v1`, and asks the store to accept a complete snapshot as either newly published or materially unchanged.
4. Neon stores provider identities, observations, immutable baselines, worker leases, immutable snapshot history, and current snapshot pointers.
5. The server-rendered matchup page and polling API use the same snapshot reader. When a snapshot cannot safely be used, the page falls back to official Sleeper matchup data without projections.

Existing useful seams include the pure live projection calculation, injectable worker dependencies, Tank01 provider factories, generic external-identity database tables, and the shared snapshot reader. The main refactor target is provider knowledge that currently leaks into orchestration and TypeScript persistence contracts.

## Behavior that must not drift

### Projection calculation

- Before kickoff, use the latest eligible pregame baseline.
- Freeze the eligible pregame baseline when the associated NFL game starts.
- For a live offensive player or kicker, calculate `official points + frozen baseline × remaining game fraction` at full precision.
- Hold a live team defense at its frozen baseline because combining provisional Sleeper D/ST points with a partial baseline can double-count points-allowed scoring.
- At final, use the player's official Sleeper result.
- Retain the previously published player projection when a live observation cannot safely produce a new value and the existing policy permits retention.
- Empty lineup slots do not require or receive invented projections.
- Duplicate real starters cannot produce a complete team total.
- A team projection is the full-precision sum of every real starter projection and is unavailable when that set is incomplete.

### Missing and partial source data

- A broadly truncated, internally contradictory, or unsafe Tank01 slate must fail the whole-slate gate and must not replace a valid snapshot.
- Once the whole-slate gate has established that the weekly slate is trustworthy, an isolated missing player or defense projection uses the existing explicit zero policy.
- After kickoff, if no eligible pregame candidate was frozen for a starter, the calculation substitutes a zero baseline. The worker records the aggregate `missingFrozenBaselineCount` and `missingBaselinePolicy: "zero"` in the league observation source metadata, and includes the count in the revision input. It does not insert a synthetic frozen-baseline row or add that calculated per-player missing-baseline quality to the public snapshot. The complete result may still be accepted as published or materially unchanged.
- Unsafe identity matches, invalid league scoring settings, missing required active-starter game identity, incomplete live clocks, and missing final official starter points fail closed.
- A failed Sleeper league load and a later per-league publication failure are isolated from other leagues. A schedule/slate assessment failure inside a shared season/week provider group currently rejects that whole provider group; the refactor must not silently claim or introduce stronger isolation.

### Timing, cadence, and provider calls

- Current Sleeper matchup observations, Tank01 game-state observations, and calculation time remain subject to the 90-second synchronization limit.
- Tank01 pregame projection data is separate from that live skew rule and may legitimately come from its one-hour success cache.
- The worker invokes the projection provider once and the game-state provider once for each distinct eligible season/week group. On a cold projection-provider cache, that invocation may make one weekly projection request and one player-crosswalk request.
- The worker uses one database lease to prevent overlapping publication work.
- The existing `publishedLeagues` worker and cron field counts every league whose complete snapshot was accepted, including a store result of either `published` or `unchanged`. Its name must not be reinterpreted as a count of newly inserted snapshot rows during this refactor.
- Live activity windows remain two hours before through seven hours after each scheduled kickoff. Hourly preparation, missing-kickoff recovery behavior, force behavior, offseason behavior, and history pruning remain unchanged.
- The browser polls the compact matchup API once per minute only for the displayed current week while the document is visible. Its request timeout remains 15 seconds.

### Freshness, HTTP, and fallback

- A current snapshot is usable for at most three minutes during an active window and 75 minutes outside an active window. A verification timestamp more than five minutes in the future is invalid.
- A historical snapshot remains usable after its timestamps age, and current-week navigation may be advanced from the latest snapshot for the same season.
- An invalid page week is treated as an omitted week and resolves through the current league week. An invalid matchup API week remains a client error.
- A non-usable polling response causes the browser to refresh the server route. For both the current-week path and an explicit historical week, the server route uses official Sleeper data for that same selected week if the shared snapshot reader does not return `usable`.

The matchup API response contract is:

| Condition | Status | Body status | Cache-Control |
| --- | ---: | --- | --- |
| Unknown league key | 404 | `not-found` | `no-store` |
| Missing or invalid week | 400 | `invalid-week` | `no-store` |
| Missing stored snapshot | 404 | `not-found` | `no-store` |
| Disabled storage | 503 | `unavailable` | `no-store` |
| Stale current snapshot | 503 | `unavailable` | `no-store` |
| Malformed snapshot | 503 | `unavailable` | `no-store` |
| Database failure | 503 | `unavailable` | `no-store` |
| Usable current snapshot | 200 | Matchup payload | `public, s-maxage=15, stale-while-revalidate=30` |
| Usable historical snapshot | 200 | Matchup payload | `public, s-maxage=300, stale-while-revalidate=3600` |

The cron API remains bearer-authenticated and no-store. Missing configuration or a disabled worker returns 503, authorization failure returns 401, worker failure or an unexpected throw returns 500, a legitimate skip returns 200, a complete fleet success returns 200, and a completed run with one or more failed leagues returns 503.

## Known provider coupling

The following coupling is real and must be moved deliberately rather than hidden by renamed files:

1. `Player.id` is a Sleeper player ID throughout the current read model.
2. `Team.id` and manager route parameters are Sleeper roster IDs.
3. Tank01's crosswalk depends on `sleeperBotID` from its player-list response.
4. Sleeper currently owns the projection synchronization input and the active scoring-rule representation.
5. Several normalized projection and scoring types still carry Tank01 or Sleeper names.
6. The worker imports both concrete providers and repeats provider identifiers.
7. TypeScript persistence contracts expose Sleeper-player and Tank01-game names even though the underlying external-ID tables are provider-keyed.
8. Store queries currently select Sleeper as the official source and Tank01 as the projection/game source.
9. The public matchup payload retains Sleeper-derived player and roster IDs.
10. Schedule reconciliation uses canonical teams and opponents because the presentation game type has no canonical internal game ID.
11. D/ST projection behavior depends on Sleeper's provisional score behavior and the statistics Tank01 supplies.
12. The MVP assumes regular-season Weeks 1–18, one global worker lease, and the currently configured league set.

Removing Sleeper from public identity and league administration is a later data-model project. It is not achieved merely by introducing provider interfaces.

## Four-PR refactor scope

### PR1: contract and characterization only

- Record this contract and baseline evidence.
- Characterize the exact matchup and cron HTTP response contracts.
- Characterize all five safe page fallback outcomes: missing, stale, disabled, malformed, and database error.
- Characterize invalid page-week handling.
- Record the current direct-import boundary that keeps Tank01 out of the page, official Sleeper fallback, and stored-snapshot reader modules. This is a narrow source boundary, not a claim that a regex can prove every possible transitive runtime call.
- Make no runtime, schema, deployment, environment, provider, or model change.

### PR2: mechanical projection-store split

- Split the projection store into focused identity, projection/baseline, observation/job, and snapshot modules behind the unchanged `ProjectionStore` interface.
- Keep `projection-store.ts` as the stable public facade and composition boundary where needed. A facade that re-exports the one canonical implementation is allowed; a compatibility wrapper that preserves a second implementation or a second runnable path is not.
- Move store code without changing normalized inputs, SQL text and parameters, query count, result and error outcomes, validation order, or call order where order is observable.
- Update imports atomically and delete superseded store implementations. Do not change the database schema, migrations, runtime role, or snapshot format.

### PR3: mechanical projection-worker split

- Split the projection worker into focused orchestration, calculation-input, persistence-coordination, and composition modules behind the unchanged worker entry point and injectable dependency contract.
- Move worker code without changing normalized inputs, provider and store call counts, call order, concurrency, structured log stages and outcomes, constants, cadence decisions, result shapes, or failure isolation.
- Keep the existing concrete Sleeper, Tank01, and Neon dependencies during this mechanical split. Provider-neutral cutover belongs only in PR4.
- Update imports atomically and delete superseded worker implementations. Do not retain a second runnable worker pipeline.

### PR4: canonical provider-boundary cutover

- Define normalized official-league, projection-slate, game-state, identity-resolution, and persistence ports.
- Keep Sleeper normalization and Sleeper-specific scoring-key interpretation in a Sleeper adapter.
- Keep Tank01 HTTP fields, envelope validation, crosswalk behavior, and credentials in Tank01 adapters.
- Keep Neon SQL and database mechanics in the persistence adapter.
- Make orchestration depend on normalized ports, not concrete provider modules.
- Rename TypeScript-only persistence inputs to provider-neutral terms only when the rename is behaviorally mechanical. Preserve the database schema and queries in PR4.
- Centralize provider identifiers and operational constants rather than repeating string literals.
- Cut every production writer, page reader, polling reader, and cron entry point to the one canonical composition path in the same PR. Delete superseded provider-coupled runnable paths after cutover; do not leave dual reads, dual writes, shadow publication, or permanent forwarding wrappers.
- Preserve the public matchup payload, `ProjectionStore` facade, worker result and HTTP contracts, stored snapshot compatibility, calculation behavior, provider call counts, persistence behavior, logging, cadence, and failure isolation defined above.

The intended dependency direction is:

```text
UI and HTTP routes -> orchestration -> provider-neutral ports and domain policy
                                      ^
                         Sleeper, Tank01, and Neon adapters
```

After PR4, domain policy must not import concrete provider clients, HTTP/cache frameworks, environment variables, or database implementations. Provider-specific validation is allowed and required inside the relevant adapter.

## Explicit non-goals

- Adding or switching an official-score, projection, game-state, or database provider.
- Removing Sleeper IDs from public URLs or the current UI data model.
- Changing the projection formula, projection quality rules, supported scoring categories, or `clock-v1` model version.
- Adding matchup win probabilities, historical backfill, earlier seasons, or league-hosting administration.
- Changing the database schema, stored snapshot format, existing data, migrations, or runtime roles.
- Adding dual reads, dual writes, shadow publication, or compatibility fallbacks that create a second source of truth.
- Changing league IDs, league count, season configuration, URLs, navigation, copy, visual design, or browser interaction.
- Changing worker cadence, cache periods, concurrency, leases, source-skew limits, freshness periods, API authentication, or history retention.
- Expanding beyond the existing regular-season Week 1–18 contract.
- Forcing a production synchronization solely to create release evidence while the worker is legitimately idle.

## Acceptance evidence for every implementation PR

1. Run lint, TypeScript checks, unit tests, the production build, and browser tests.
2. Record the resulting test counts and compare them with the pre-PR baseline. Explain every removed or replaced test.
3. Record an import-boundary check showing that domain modules do not acquire concrete provider or infrastructure imports.
4. Exercise pregame, live, halftime, final, bye, empty-slot, missing-baseline, retained-prior, D/ST, duplicate-starter, and exact-team-sum cases.
5. Exercise broadly truncated slates, isolated missing projections, unsafe identity matches, invalid scoring rules, missing active-starter games, contradictory clocks, final scores missing, and game-state regressions.
6. Exercise both leagues sharing one season/week provider group, a failed Sleeper league load, a per-league publication failure, and a shared-group schedule/slate failure.
7. Verify cold-cache and warm-cache provider calls separately. Compare Sleeper, Tank01, and Neon call/query counts with the baseline.
8. Preserve job lease idempotency, immutable baselines and snapshots, regression rejection, atomic current-pointer publication, and history-retention safeguards.
9. Verify the complete matchup and cron HTTP status, body, and cache matrix.
10. Verify all shared-reader outcomes and server fallback behavior for both current and explicit historical weeks.
11. Verify credentials never enter cache keys, browser bundles, response bodies, or logs.
12. Compare structured worker stages, outcomes, and the existing `publishedLeagues`/`failedLeagues` values with the baseline, using the accepted-outcome meaning defined above.
13. Confirm there is no migration, schema, runtime-role, environment-name, snapshot-format, or model-version change.

Exact byte comparison is inappropriate for timestamps and generated identifiers. Compare normalized semantic payloads, observable calls, persistence outcomes, and HTTP behavior.

## Safe release and rollback

Never run an authenticated preview synchronization against the production Neon connection. Integration publication in preview requires an isolated Neon branch and separate preview credentials; otherwise use mocked providers and a test store.

Before production release:

1. Complete every acceptance gate for the applicable PR.
2. Confirm existing pre-PR snapshots are still readable.
3. Verify both league routes and current/historical matchup requests in the deployed preview.
4. Confirm the preview did not write to production Neon and did not expose provider or database credentials.
5. Confirm the release contains no schema, snapshot-format, or model-version change.

After production release, a normal idle result is healthy when no synchronization window is active. On the first eligible worker run, both healthy leagues must complete with a store outcome of either `published` or `unchanged`. A controlled forced run may be used only when its season/week inputs are valid and the release operator intends the resulting production writes and provider usage.

Code rollback remains a normal reviewed revert because the four PRs do not change the schema or snapshot format. It is not a Neon data rollback: compatible snapshots and the current-snapshot pointers written after release remain in place and must stay readable by the reverted code. Any need to restore or repoint database state requires a separate reviewed database-recovery procedure. Revert the code if either healthy league cannot produce an accepted `published` or `unchanged` result during an eligible window, provider or database call counts unexpectedly increase, current snapshots become stale despite successful jobs, stored snapshots fail validation, the official Sleeper fallback fails, secrets appear in output, or HTTP/cache behavior changes.

After rollback, confirm that the pre-PR snapshot format and any compatible post-release snapshots are readable, both league matchup routes are healthy, and the next eligible worker result is accepted or legitimately idle.

## Progress record

Update this table in the pull request evidence without rewriting the behavioral contract. PR1 brings the freshly verified unit suite to 434 tests across 26 files, including the HTTP/page matrices and the expanded store characterization gate.

| Step | Revision/PR | Verification | Runtime/schema drift | Deployment evidence |
| --- | --- | --- | --- | --- |
| Baseline | `c9e8204`, PR #158 | 385 unit; 13 browser | Baseline | Production Ready; both routes healthy |
| PR1 | `35f8649`, PR #159 | 434 unit tests across 26 files, 36 focused HTTP/page cases, full lint/TypeScript/build verification, 13 local browser tests, and both GitHub jobs passed. | None; tests and documentation only | Vercel production `8AnBRLi7eb6dK7u8EdLeNha8Zdvm`; both live league routes verified |
| PR2 | `3f9273f`, PR #160 | 434 unit tests across 26 files, 13 browser tests, 13 isolated Neon integration cases, store/SQL parity audit, full lint/TypeScript/build verification, and both GitHub jobs passed. | None; mechanical store extraction and test infrastructure only | Vercel production `5MQN1L9t1SyCLhMZA4RhhR6ftpAb`; both live league routes verified |
| PR3 | Current worker split | 441 unit tests across 27 files, 13 browser tests, 13 isolated Neon integration cases, worker concurrency/revision parity, full lint/TypeScript/build verification, and independent review. | Must be none | Preview and production verification pending |
| PR4 | Planned canonical cutover | Provider-contract, import-boundary, end-to-end parity, and full verification gates | Must be none | Preview and first eligible production run |
