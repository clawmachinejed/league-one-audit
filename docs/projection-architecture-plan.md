# Projection architecture plan and anti-drift contract

## Status

This document fixes the behavior and evidence baseline for the projection refactor. It is an acceptance contract, not permission to change projection behavior. Every implementation PR must remain independently reviewable, releasable, and reversible.

| Step | Scope | Status |
| --- | --- | --- |
| Baseline | Record production state and a recovery point before the four-PR sequence | Complete |
| PR1 | Document the contract and add characterization coverage without changing runtime code | Complete and released |
| PR2 | Mechanically split the projection store behind its stable facade | Complete and released |
| PR3 | Mechanically split the projection worker behind its stable entry point | Complete and released |
| PR4 | Cut the canonical pipeline over to provider-neutral ports and concrete adapters | Implementation and local/isolated-data gates complete; remote preview and release pending |

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

The PR4 working tree has one canonical writer path and retains one shared reader path. The canonical worker is provider-neutral; concrete configuration and adapters are assembled only by the production runtime. The existing public matchup DTO, worker facade, low-level store facade, database schema, SQL behavior, and snapshot format remain the compatibility boundaries.

### Current module boundaries

| Boundary | Current responsibility |
| --- | --- |
| `projections/domain` | Provider-neutral league, schedule, lineup, projection, game-state, scoring, and snapshot types; canonical scoring; the sole `clock-v1` calculation. |
| `projections/ports` | Interfaces for league registry, NFL calendar, official league source, projection feed, game-state feed, identity resolution, projection repository, clock, ID generation, and structured logging. |
| `projections/shared` | Resource-scoped provider references, deterministic stable JSON, and compatibility hashing/identity helpers shared by canonical boundaries. |
| `projections/adapters/configuration` | Builds the active-league registry from configurations supplied by runtime; it does not import branding, environment variables, or the application's `LeagueKey`. |
| `projections/adapters/sleeper` | Calls injected low-level Sleeper loaders and translates calendar, league-week, roster, lineup, official-point, and raw scoring data to canonical contracts. It owns Sleeper scoring-key interpretation. |
| `projections/adapters/tank01` | Owns Tank01 HTTP shapes, requests, success caches, failure backoff, envelope validation, player crosswalk, schedule-aware slate assessment, game-state parsing, and canonical feed output. |
| `projections/adapters/neon` | Translates canonical identity and repository operations to the unchanged low-level store. Provider-specific SQL columns, filters, and existing DTOs remain private compatibility details in this package. |
| `projections/worker` | Owns provider-neutral cadence, bounded orchestration, provider grouping, identity and observation coordination, per-league scoring/publication, and canonical snapshot construction. It imports no concrete provider client, environment, application config, Next/React, or database module. |
| `projections/runtime/projection-composition.ts` | Sole production composition root. It supplies golden league configuration, provider keys, concrete adapters, server-only environment values, UUID generation, system time, and the monotonic duration clock. |
| `live-projection-worker.ts` | Stable worker facade and public entry point over the canonical orchestrator. |
| `projection-store.ts` | Stable low-level store facade used by existing consumers and wrapped by the canonical Neon adapters. It does not represent a second projection pipeline. |
| `projection-reader.ts` | Shared website boundary for selecting, validating, and freshness-checking stored snapshots through the stable store facade. |

The architecture test enforces these dependency directions, prevents the deleted provider-coupled pipeline from returning, confines projection-store SQL to the low-level Neon package, and checks production TypeScript modules for cycles. Its passing result is a PR4 gate, not a substitute for the behavioral and release gates later in this contract.

### Provider responsibilities and identities

- Sleeper remains authoritative for the league, participants, rosters, starters, official fantasy points, scoring settings, player metadata, and schedule/cadence context.
- Tank01 supplies raw weekly projected statistics, the `sleeperBotID` player crosswalk, and NFL game phase and clock observations. It does not supply the league's scoring result.
- Neon resolves external aliases to canonical identities and persists provider observations, immutable kickoff baselines, job leases, immutable snapshot history, and current pointers. It does not decide scoring policy.
- Canonical external references are scoped by resource, provider, and opaque external ID. Roster references additionally carry their league, and scoring-entity references distinguish players from team defenses. This prevents a roster ID from colliding across leagues and prevents identical strings from colliding across resource or provider domains.
- The Tank01 player crosswalk may attach a proven Sleeper player alias. Tank01's team-defense feed supplies no equivalent proven alias, so defenses reconcile by canonical NFL team through the identity layer rather than by inventing a Sleeper ID.
- The public matchup payload intentionally retains Sleeper player and roster IDs. Removing that public dependency requires a later route/read-model migration and is outside this refactor.

### Raw scoring, canonical calculation, and compatibility

The Sleeper league source carries raw scoring settings without validating or rewriting them. At the per-league publication stage, the Sleeper scoring adapter validates that source object and maps supported Sleeper keys to canonical scoring events. The canonical scorer then applies those rules to normalized Tank01 statistics. Unsupported active source keys remain recorded in provenance. The adapter also records whether the three source two-point-conversion weights can be represented by Tank01's aggregate statistic and whether defense scoring uses the rounded points-allowed bucket proxy.

The exact validated numeric Sleeper rules remain the audit and persistence input, including the existing stable scoring-rules hash. Unsupported active rules remain in provenance but are excluded from the calculation. The canonical profile is an in-memory calculation shape, not another persisted source of truth. `compatibleRevision` and the shared stable-JSON rules deliberately retain the pre-cutover source and snapshot revision algorithms. The Neon adapter translates canonical references to the existing store DTOs, SQL, provider fields, and deterministic identity values. The snapshot builder first constructs a `ProjectedMatchupSnapshot`, then performs one canonical-to-public conversion to the unchanged `MatchupsData` payload. These measures keep existing Neon snapshots readable and prevent the refactor from creating a parallel format.

### Isolated Neon integration safety

The destructive store integration suite is excluded from normal unit tests and can run only through `pnpm test:integration`. It requires a local, ignored `.env.integration.local`, an exact reset-authorization phrase, TLS, distinct schema-owner and restricted `league_one_runtime` credentials, explicit test database and branch names, a production identity denylist, and matching owner/runtime targets. Before either setup or teardown can reset `public`, the harness compares normalized URL identities with server-reported database and role identities and verifies a durable JSON database comment containing the expected purpose, random sentinel, Neon branch ID, and branch name. It rejects production-like names, configured production URLs, denylisted database/endpoint/branch identities, role reuse, and identity mismatch.

The final PR4 isolated run passed all 13 grouped integration cases, mapping every one of the contract's 42 database scenarios. That evidence covers empty-schema migration, restricted-role privileges, identity concurrency, immutable scoring/baseline/snapshot data, source-set and skew rejection, snapshot deduplication and pointer ordering, leases, observation replay, malformed JSON handling, revision/scoring parity, credential-safe logs, and pruning. Safety preflight and teardown both passed, and the disposable database's `public` schema contained zero relations afterward. This database evidence does not replace provider, worker, browser, preview, or live-game verification. An authenticated preview synchronization must never point at production Neon.

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
- Once the whole-slate gate has established that the weekly slate is trustworthy and identity matching is safe, an isolated absent or unscorable player or defense projection uses the existing explicit zero policy. Ambiguous or conflicting identities do not become zeroes.
- After kickoff, if no eligible pregame candidate was frozen for a starter, the calculation substitutes a zero baseline. The worker records the aggregate `missingFrozenBaselineCount` and `missingBaselinePolicy: "zero"` in the league observation source metadata, and includes the count in the revision input. It does not insert a synthetic frozen-baseline row or add that calculated per-player missing-baseline quality to the public snapshot. The complete result may still be accepted as published or materially unchanged.
- Unsafe identity matches, invalid league scoring settings, missing required active-starter game identity, incomplete live clocks, and missing final official starter points fail closed.
- A failed Sleeper league load and a later per-league scoring, observation, or publication failure are isolated from other leagues. A projection/game-state load, schedule/slate assessment, shared identity, or provider-persistence failure rejects that whole provider group. A completed run with at least one accepted league retains its failed-league count and makes cron return 503; zero accepted leagues fails the run. The refactor must not silently claim or introduce stronger isolation.

### Timing, cadence, and provider calls

- Current Sleeper matchup observations, every applicable Tank01 game-state observation, and calculation time remain subject to the 90-second synchronization limit. `calculatedAt` is captured at run start before preflight, lease acquisition, and source work, so a slow run can be rejected at publication even when the provider reads are mutually close.
- Tank01 pregame projection data is separate from that live skew rule and may legitimately come from its one-hour success cache.
- The worker invokes the projection provider once and the game-state provider once for each distinct eligible season/season-type/week group. On a cold projection-provider cache, that invocation may make one weekly projection request and one player-crosswalk request.
- Eligible sources are filtered to the one selected period before grouping, so the current run has at most one provider group. The four-group concurrency cap is future-facing.
- A fully cold group can have the weekly projection, player-crosswalk, and uncached game-state requests in flight together. Each Tank01 request retains its 15-second timeout. Projection-side successes retain separate one-hour caches; failures use a 60-second process-local backoff, rejected persistent loaders are not retained, and sibling projection/crosswalk requests settle before an unavailable result is returned.
- The worker uses one fixed 120-second database lease to suppress overlapping runs while the lease remains valid. It has no renewal and does not fence publication by lease owner, so it must not be treated as an absolute overlapping-write guarantee.
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

## Current scale-readiness evidence and limits

The PR4 working tree includes deterministic canonical-orchestrator scenarios for 3, 50, and 300 leagues, with 12 managers and one starter per manager. They use fixed clocks and provider data and repeat each run to compare complete publication inputs, league-specific revisions, identities, output counts, and stable hashes. The suite records actual local execution duration and structured per-stage duration fields but deliberately sets no performance threshold.

| Leagues | Managers | League-source calls | Projection/game feed calls | Repository calls | Crosswalk calls | Peak source/publish concurrency | Peak outstanding async port calls | Retained provider-group slate pairs |
| ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 3 | 36 | 3 | 1 / 1 | 27 | 2 | 3 / 3 | 9 | 1 |
| 50 | 600 | 50 | 1 / 1 | 403 | 2 | 8 / 8 | 24 | 1 |
| 300 | 3,600 | 300 | 1 / 1 | 2,403 | 2 | 8 / 8 | 24 | 1 |

The repository count is `8 × leagues + 3`: one lease acquisition, one shared game-state write, eight store operations per league, and one lease completion. Two shared identity-resolution calls bring the total observed persistence/crosswalk operations to `8 × leagues + 5`. The scenario's eligible leagues all share one selected regular-season week, so one projection slate and one game-state slate are fetched concurrently and only one group pair is retained. The test separately verifies 16 shared game rows, 12 shared scoring identities, 12 projection candidates per league, and one schedule assessment and scoring normalization per league. The same 12 scoring identities are reused across every synthetic league. Its first configured league supplies the current period, so calendar preflight is one call; production preflight remains sequential and can inspect more configurations when earlier calendars fail or report a stale period.

This port-level scale suite does not simulate Tank01's HTTP cache. Tank01 adapter tests independently lock the current behavior: a cold projection-feed call can make two requests, one weekly projection and one player crosswalk, while a warm success-cache call makes zero additional HTTP requests. The uncached game-state feed makes one request. The scale suite also does not benchmark complete fantasy rosters, distinct player pools per league, bench/reserve/taxi collections, the unchunked fleet identity-resolution batch, repeated linear projection-slate scans for every rostered entity, Sleeper latency, Neon throughput, Vercel cold starts, or Vercel capacity.

These results prove bounded concurrency, shared provider work, linear repository work, and deterministic outputs. They do not prove that 50 or 300 leagues can finish within the current 60-second Vercel function limit or fixed, non-renewing 120-second global lease. At 300 leagues, the eight-league publication cap requires about 38 waves, each with several sequential database stages. The current worker also has no whole-run deadline, cancellation, repository timeout, or lease renewal. Sharded or partitioned durable jobs, renewable and publication-fenced lease ownership, explicit deadlines, backpressure, bounded identity work, more efficient projection lookup, and real remote-load measurements remain required before supporting that fleet size. No production concurrency, cadence, or lease behavior is changed by the synthetic tests.

Real 2026 game traffic also remains an explicit deferred gate. Synthetic cases cover pregame, live quarters, halftime, overtime, final, missing baselines, byes, empty slots, and failure paths, but they cannot establish Tank01's actual status/clock transition quality or end-to-end provider timing during NFL games. The first real-game validation must observe those transitions without changing the `clock-v1` policy or forcing an otherwise idle production write. Live matchup win probabilities and opportunity-based projection adjustments remain outside the MVP.

## Provider-coupling baseline and current disposition

The following list records the coupling that existed when this contract was approved. It remains part of the acceptance baseline rather than being rewritten after implementation:

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

In the PR4 working tree, items 4 through 8 have been removed from the canonical domain and worker boundaries: raw source scoring is translated by the Sleeper adapter, Tank01 source types remain in Tank01 adapters, the worker imports ports, and canonical repository contracts use resource-scoped references. Existing provider-specific SQL column names, filters, and low-level store DTOs remain intentionally encapsulated in the Neon adapter package so the schema and persisted data do not change. Items 1 through 3 and 9 through 12 remain intentional product or data-model constraints, including Sleeper-derived public IDs, Tank01's proven player crosswalk, canonical NFL-team schedule reconciliation, D/ST behavior, regular-season Weeks 1–18, and one global lease.

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

The Tank01 adapter is divided by responsibility so its public feeds remain reviewable:

- `projections/adapters/tank01/projection-feed.ts` composes the canonical projection feed, provider caches, crosswalk join, canonical output, and legacy-compatible source revision.
- `projections/adapters/tank01/projection-client.ts` owns projection endpoint requests, archive-season query policy, sibling-request settling, and persistent-cache rehydration.
- `projections/adapters/tank01/projection-normalization.ts` validates and normalizes projection and player-list response envelopes exactly once.
- `projections/adapters/tank01/projection-internals.ts` contains private Tank01 source shapes, cache constants, and shared adapter-only primitives.
- `projections/adapters/tank01/game-state-feed.ts` owns the uncached canonical game-state feed and strict atomic game-state normalization.
- `projections/adapters/tank01/slate-validation.ts` owns the pre-cache envelope gate and schedule-aware whole-slate assessment.

The current production write and read flows are:

```text
Cron route -> stable worker facade -> runtime composition -> canonical orchestrator
                                                        -> canonical ports/domain policy
                                                        -> Sleeper/Tank01/Neon adapters

Browser -> polling API -> shared projection reader -> stable store facade -> Neon
SSR page -------------> shared projection reader -> stable store facade -> Neon
SSR fallback --------------------------------------> official Sleeper loader
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

Update this table in the pull request evidence without rewriting the behavioral contract. PR1 established the HTTP/page characterization baseline, PR2 added the isolated store evidence, and PR3 preserved worker behavior through the mechanical split. PR4 evidence below describes only work and checks actually completed at the time of this edit; it does not mark the remote preview or production gate complete.

| Step | Revision/PR | Verification | Runtime/schema drift | Deployment evidence |
| --- | --- | --- | --- | --- |
| Baseline | `c9e8204`, PR #158 | 385 unit; 13 browser | Baseline | Production Ready; both routes healthy |
| PR1 | `35f8649`, PR #159 | 434 unit tests across 26 files, 36 focused HTTP/page cases, full lint/TypeScript/build verification, 13 local browser tests, and both GitHub jobs passed. | None; tests and documentation only | Vercel production `8AnBRLi7eb6dK7u8EdLeNha8Zdvm`; both live league routes verified |
| PR2 | `3f9273f`, PR #160 | 434 unit tests across 26 files, 13 browser tests, 13 isolated Neon integration cases, store/SQL parity audit, full lint/TypeScript/build verification, and both GitHub jobs passed. | None; mechanical store extraction and test infrastructure only | Vercel production `5MQN1L9t1SyCLhMZA4RhhR6ftpAb`; both live league routes verified |
| PR3 | `ea81425`, PR #161 | 441 unit tests across 27 files, 13 browser tests, 13 isolated Neon integration cases, worker concurrency/revision parity, full lint/TypeScript/build verification, and independent review. | None; mechanical worker extraction only | Merged and released to production from `ea81425eabeb74998adcabb858c3efbcd6ae0232` |
| PR4 | Working-tree canonical cutover | Final local gate: 518 unit tests across 41 files, 13 browser tests, lint, TypeScript, production build, canonical architecture/cycle checks, deterministic 3/50/300-league scale tests, and 13 isolated Neon cases covering all 42 contracted database scenarios. Independent review found a duplicate runnable Tank01 test feed and a contradictory bye-game edge case; both were removed or corrected before release and protected by regression tests. | No schema, migration, dependency, league-ID, payload, model, URL, UI, HTTP, cache, cadence, concurrency, provider-call, or persistence-format change. One production feed, formula, snapshot builder, and writer pipeline remain. | Preview, production, and first naturally eligible production-run evidence pending |
