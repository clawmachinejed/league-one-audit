# Lineup freshness: architecture and operations

This is the current operational guide for lineup observation and projection rematerialization. The [approved contract](lineup-freshness-approved-contract.md) defines scope and invariants; the [implementation ledger](lineup-freshness-plan.md) records baseline, migrations, tests, deviations, and releases. Earlier architecture plans retain historical evidence and are not the current scheduling runbook.

## What the system does

Sleeper remains the official league, roster, lineup, scoring, and schedule source. Tank01 supplies projected statistics, crosswalk identities, and NFL game states. Neon stores authority, observations, immutable projection content, kickoff baselines, work claims, and published snapshots. The browser reads published results and never triggers provider ingestion or projection calculations.

Lineup freshness is separate from projection-feed freshness. A thin lineup check detects whether the ordered starters or matchup assignments changed. Only a changed accepted lineup wakes extra materialization work. Routine scoring and provider refresh still occur on their established schedules.

There is one scorer, one `clock-v1` implementation, one projected-snapshot builder, and one publication implementation. The existing live formula remains `official Sleeper points + frozen pregame points × remaining game fraction` for offense and kickers. Live defense holds its frozen baseline; final projections equal official final points. A missing individual projection uses zero only after the overall slate is trusted. These rules did not change with lineup observation.

Raw Sleeper scoring settings and their persisted hashes remain unchanged; canonical scoring weights exist in memory. Applicable official-score, game-state, and calculation timestamps must remain within the existing 90-second source-skew boundary. The cached pregame projection slate is governed by its own eligibility and refresh policy, not that 90-second rule. Valid halftime may omit the raw clock when its normalized phase and remaining fraction are usable.

## Three independent scheduled lanes

All three routes are declared in `apps/site/vercel.json`, scheduled every minute, and authenticated with `CRON_SECRET`. A cron invocation is not a guarantee of an upstream request or a publication.

| Route | Responsibility | Provider access |
| --- | --- | --- |
| `/api/cron/live-projections` | Refresh operational authority; observe active scoring-period lineups; run due or pending current projection work | Sleeper; Tank01 only when projection work is eligible |
| `/api/cron/lineup-observations` | Observe future-owned lineups, including the preseason default; persist accepted changes and pending state | Thin uncached Sleeper matchup requests; no Tank01 or scoring |
| `/api/cron/future-projections` | Select one provider-period ingestion or materialization action independently of current games | Stored Neon authority/slates; Sleeper full source for materialization; Tank01 ingestion or game states as needed |

The new observer and future routes ignore a force query. The existing authenticated current-route administrative force operation remains bounded to the authoritative default period; runtime dispatch hands a preseason default to its future owner. Normal current execution never invokes future work. Do not use force merely to produce release evidence.

Cron responses are `no-store`. Invalid authorization returns `401`; healthy completed/skipped runs return `200`; unavailable configuration/storage returns `503`; failed execution returns `500`; partial league failures return `503`. Read counts and reasons, not just the body word `completed`: the future route retains that word even for partial completion. Observer responses report checked, changed, unchanged, not-ready, skipped, failed, and pending counts. Future responses distinguish newly published from unchanged leagues; the legacy current `publishedLeagues` count includes accepted unchanged publications. Those existing response meanings remain intentional and are tested.

### Module boundaries

| Area | Responsibility |
| --- | --- |
| `projections/domain` | Scoped identities, complete lineup validation, `lineup-v1`, period classification, canonical scoring, and live calculation |
| `projections/ports` | Provider-neutral calendar, league/lineup sources, authority reads, watch state, and projection persistence contracts |
| `projections/adapters/sleeper` | Convert the shared raw Sleeper boundary to thin or full canonical source contracts |
| `projections/adapters/tank01` | One projection normalization/cache path and game-state translation |
| `projections/adapters/neon` | Canonical translation and the single low-level SQL implementation |
| `projections/worker` | Separate current, observer, and future orchestration; shared projection stages and scheduling policy |
| `projections/runtime` | Separate lane composition with shared configuration, clocks, projection services, and persistence factories |
| `projection-reader.ts` | Shared full/compact snapshot selection and freshness |
| `matchup-snapshot-client.ts` and `use-matchup-snapshot.ts` | Scoped browser protocol, visible polling, cancellation, and fallback |

The root store facade remains the supported entry point. Runtime-only shared projection services reuse the cached feed implementation; they are not imported by the thin observer. Import-graph and cycle tests enforce these boundaries. No provider request, database query, or scoring implementation is duplicated for comparison or shadow execution.

## Authority, timing, and ownership

Operational NFL period and league lifecycle reads target no more than 60 seconds of cache age. The current lane writes the normalized durable authority. New lanes read it in a batch and reject a league with missing, malformed, mismatched, regressing, or more-than-ten-minute-old authority. The ten-minute limit is an outage safety threshold, not the healthy refresh target. Schedule/presentation caches remain separate.

Each runtime league configuration supplies its matchup horizon; the current configuration covers Weeks 1–18. The display period can differ from the active scoring period. Snapshot order, today's date alone, and NFL games becoming final do not determine the fantasy current week.

| Authoritative state | Observed period | Healthy observation | Materialization owner |
| --- | --- | --- | --- |
| Preseason | Default display period | Every 60 seconds | Future lane |
| Preseason | Later configured period | Every 180 seconds | Future lane |
| Active league | Active scoring period | Every 60 seconds | Current lane |
| Active league | Later period | Every 180 seconds | Future lane |
| Active league | Earlier period | Never automatically | None |
| Complete league | Any period | Never automatically | None |

Website `past`, `active`, and `future` semantics remain distinct from watch classification. In particular, a preseason default page remains a future page even though its lineup receives one-minute observation.

Future targets are sorted by stable scoped identity and allocated round-robin to three persisted minute phases. For the initial two-league horizon, 34 future targets have phase sizes 12, 11, and 11. Assignments remain stable until the active target set changes; missing authority does not temporarily remove a configured league from phase planning. Overdue catch-up is bounded.

A full active-period source load counts as that minute's observation. Its reservation prevents a duplicate thin load. When full work is not due, the current lane performs a thin check. A pending change bypasses an already-completed hourly marker; a busy owner or failure backoff remains respected. Routine full work retains hourly preparation, the seven-day preparation lookahead, and the existing two-hours-before/seven-hours-after kickoff windows. Missing exact kickoff times retain the established calendar-date fallback policy.

## Thin and full source validation

Both paths use one raw Sleeper matchup parser and one canonical lineup revision algorithm. Thin requests are uncached and do not load the player catalog, scoring settings, projection slate, or game states. The authoritative roster and starter-slot shape is required to trust the response.

Responses are classified as:

- **Complete:** the expected roster rows and ordered starter slots form a valid observation.
- **Not ready:** upstream matchups are not yet available under the existing readiness rules; keep accepted data and retry at normal cadence.
- **Invalid:** partial or contradictory rows, malformed assignments, duplicate identities, or incompatible shape; never replace accepted state.
- **Unavailable:** request or provider failure; keep accepted state and retry with backoff.

Provider-scoped roster, matchup, player, and defense references are distinct. Raw lineup assignment references are not assumed to be canonical scoring entities. Player names and team-name matching cannot silently establish identity.

## Revisions and durable pending work

| Revision | Meaning | Changes for |
| --- | --- | --- |
| `lineup-v1` | Semantic lineup identity | League/period/shape, roster and matchup assignments, ordered starter positions, and explicit empty slots |
| Official source revision | Full official observation identity | Existing full-source data and observation timestamps |
| Snapshot revision | Full projected calculation lineage; the selected stored revision is used by the browser | Existing model, official/projection source revision, missing-baseline count, and game-observation revision inputs |

`lineup-v1` sorts roster rows but preserves starter order. It excludes scores, projections, player metadata, bench/IR/taxi contents, presentation fields, and observation time. Thin and full observations of the same lineup therefore produce the same revision without changing existing source or snapshot hash algorithms.

The snapshot **content hash** is a separate value, not another name for snapshot revision. It hashes the material payload, ignoring only `updatedAt`, plus normalized activity windows. If new calculation inputs produce identical content, publication retains the selected snapshot and its existing revision while advancing verification. This is why an unchanged browser revision can have a newer `verifiedAt`.

Watch state stores the latest accepted revision separately from the last materialized revision. Different values mean pending work. First complete observation can create pending work during bounded bootstrap. An unchanged thin check updates observation freshness without Tank01, scoring, or snapshot publication; independently due full scoring work still runs. An A → B → A sequence resolves against what was actually materialized, not merely the last requested target.

Each claim is protected by database time, worker identity, attempt generation, authority/ownership generation, and expiry. A later full-source reservation supersedes an older thin claim. Full completion uses the actual source revision it read; the requested target is not proof of what was published.

If a B full load is followed by a thin C, valid B publication may finish while C remains pending. Publication must not demand that the latest thin revision still equal B, because doing so would unnecessarily reject safe work. It must reject incompatible ownership, retirement, superseded full-source claims, or expired authority. If the full source itself reads C, acknowledgment records C.

Future completion and lineup acknowledgment occur atomically against a complete official observation and a matching published or reverified snapshot. An unchanged snapshot still needs new verification lineage. An older failure cannot postpone a newer pending revision. Snapshot history and frozen baselines remain immutable; older calculations cannot move the current pointer backward.

Watch synchronization retires obsolete league/provider/version/season/horizon rows and invalidates incompatible ownership claims. Partial unique indexes prevent two active rows for the same logical period. Retirement preserves audit state and is not a deletion of snapshots or complete historical retention for every table.

## Future work and freshness

The future lane selects at most one provider-period action per invocation. It prefers eligible pending lineups with a stored valid slate, then pending groups needing ingestion, then routine work. Leased or backed-off groups do not block the next eligible group. Within a priority class, oldest pending time and canonical period/league ordering establish fairness.

A stored eligible slate is reused even if its routine refresh is due. If missing or rejected, ingestion and materialization are awakened together; ingestion consumes one invocation, and materialization remains due afterward. Pending changes bypass routine canary/staggering gates, not validation. Materialization loads fresh official lineups and one shared game-state slate but makes no projection-feed request. See [future operations](future-week-projections.md) for routine distance tiers and preseason default handling.

Future snapshots remain usable last-known-good data when a refresh is due. Durable slate, source, snapshot, and attempt lineage determine `refreshDue`; an older future snapshot is not automatically discarded. Active snapshots use the existing strict age policy: more than three minutes in an active window, or more than 75 minutes outside it, is stale. More than five minutes of future timestamp skew also fails freshness. Historical snapshots retain historical timestamp and non-polling behavior. Full and compact readers share this policy and one declarative payload structure validator; the compact query returns metadata and validation evidence, not the full payload.

## Browser protocol and HTTP

Visible active and future pages check `/api/matchups/{league}/revision?week=…` every 60 seconds. Hidden pages stop requests and cancel in-flight work; becoming visible triggers an immediate check. Completed pages do not poll. The fixed interval does not restart when a response arrives.

The compact response is always `no-store`. Same revision updates verification time and period context only. A changed revision requests `/api/matchups/{league}?week=…&rev=…`. The client validates request scope, full payload season and both week fields, protocol headers, actual returned revision, and request generation. The payload has no league-ID field; scope comes from the requested route plus cancellation/generation checks, not an invented body property.

One `409` publication race causes one immediate new compact check and at most one more full attempt. There is no recursive retry. A compact timestamp can update a full response only when both belong to the same actual revision. An older response cannot replace newer adopted content or another league/week. Same-content freshness never regresses.

| Full snapshot response | Cache behavior |
| --- | --- |
| Active | `s-maxage=15, stale-while-revalidate=30` |
| Future | `s-maxage=300, stale-while-revalidate=300` |
| Historical | `s-maxage=300, stale-while-revalidate=3600` |
| Error or revision mismatch | `no-store` |

Unknown league or missing snapshot is `404`; invalid week or malformed optional revision is `400`; an unavailable, disabled, malformed, or stale active snapshot is `503`; a valid requested revision that differs from the selected snapshot is `409`. Successful full responses preserve the existing body and supply revision, verification, and period headers. Unversioned full requests remain supported. Compact responses use the same scope/freshness decisions without transferring teams or starters.

Current automatic failures refresh the server route, allowing safe official Sleeper fallback. Future automatic failures retain the last good view. Manual refresh falls back through the route for either. Requests share a 15-second client timeout, and route changes/unmount invalidate old responses. Intentional null-lineage Sleeper fallback can replace stale Neon data; an unrelated old server response cannot displace a newer adopted snapshot. Expanded cards, My Team, week selection, mobile fit, and dark-mode presentation remain unchanged.

## Retry and execution budgets

| Work | Admission/abort budget | Lease |
| --- | --- | --- |
| Current lane | Existing provider limits and 60-second route maximum; no newly claimed whole-run deadline | 120-second global lease and hourly markers; full-source ownership fence |
| Observer | Stop new batches at 30 seconds; abort at 44 seconds; cleanup bounded to 4 seconds | 120-second global, 55-second observation claims |
| Future lane | Stop new stages at 45 seconds; abort at 50 seconds; cleanup bounded to 4 seconds | 120-second global, 55-second action claims |

Provider/database work remains bounded; observation and league-stage concurrency are at most eight. A slow database claim is rechecked against the start deadline before beginning network work. Unstarted claims expire without pretending an observation succeeded. Cancellation does not replace database ownership checks. Leases are not renewed; distributed renewable claims remain deferred.

Observation failures retry after the normal class interval, then 5, 15, and 60 minutes. Complete and not-ready responses reset observation failures. Future-action failures use their separate 5-minute, 15-minute, 1-hour, and 6-hour schedule. Backoff preserves accepted data and pending changes. Browsers cannot bypass it.

## Request envelope and service objectives

At Week 1, two leagues have two current observations and 34 future targets. Nominal observation demand is `currentTargets + ceil(futureTargets / 3)`, or 13–14 matchup requests per minute. Bounded catch-up is at most 18 future plus two current, totaling 20. Full current requests reserve their share; extra future materialization loads and other Sleeper endpoints are separate traffic. The thin observer makes zero Tank01 calls.

| Fleet at Week 1 | Approximate observation demand per minute | Capacity result |
| --- | --- | --- |
| 2 leagues | 13–14 | Supported target |
| 50 leagues | 333 | Requested cadence unsupported |
| 300 leagues | 2,000 | Requested cadence and provider guidance unsupported |

Capacity checks prevent an unbounded provider burst and emit `capacity-exceeded`; synthetic scale tests do not establish live production throughput. Future scale requires partitioned durable tasks, multiple bounded invocations, a database-backed registry, backlog/retry policy, provider-rate testing, and remote-load measurements.

Observation cadence is not end-to-end latency. Measure due bucket → accepted observation, accepted observation → verified snapshot, and verified snapshot → browser adoption. Current changes normally need the next eligible minute full run and the next visible browser poll. Future changes normally need their assigned three-minute phase, one or two future cycles, and the browser poll; missing projection prerequisites or backlog add delay. The contract's four-to-six-minute nominal and seven-to-eight-minute conservative future envelopes are operating objectives, not guarantees. Sleeper has no manager-mutation timestamp, so exact delay from the user's tap cannot be measured directly.

## Telemetry and safe diagnosis

Structured logs identify service/lane, stage/outcome, run ID, internal league key, period, counts, duration, authority age, capacity, claim/lease result, and failure code where available. Count provider adapter starts, HTTP starts, and cache events separately; completion events carry outcome/duration without counting another request.

Uncached HTTP attempts and owned cache-loader misses/backoff hits are exact. Next-managed caches do not expose trustworthy per-access hit/miss or upstream counts through their public API. Those counters are explicitly `null`, meaning unknown, not zero. Do not infer totals by treating every adapter call as an upstream call. Cache loader instrumentation may cause a normal initial refill after deployment; steady-state namespaces, arguments, and TTLs remain unchanged.

Never log credentials, authorization headers, database URLs, raw responses, manager data, or raw credential-bearing errors. High-cardinality identifiers remain log fields, not metric labels. No new monitoring vendor is required.

For a suspected delay, inspect in order:

1. The deployed commit and three active cron definitions.
2. Last naturally scheduled results for each lane; distinguish healthy idle/busy from unavailable or failed authority.
3. Per-league authority source/verification ages and current ownership.
4. Active watch count, due phase, accepted observation age, not-ready/failure state, and pending age.
5. Future projection prerequisite, action lease, backoff, and queue eligibility.
6. Complete official-observation linkage, publication/verification, and acknowledgment revision.
7. Public revision metadata and browser adoption for the selected league/week.

Use aggregate metadata, hashes, status, and timestamps for read-only production checks. Do not publish raw roster payloads, dump environment values, clear pending flags, edit current pointers, or force a sweep to make a dashboard look healthy. A missing authority for one league must not be diagnosed as global healthy idle.

## Database and integration safety

Migration `007_lineup_freshness.sql` adds watch state and nullable lineup-version/hash lineage on official observations. Existing migration files remain immutable and checksummed. Runtime uses the restricted role. Watch-table privileges are `SELECT`, `INSERT`, and `UPDATE`; not delete, truncate, references, trigger creation, ownership, or schema modification. The schema-owner credential is for local migration/fixture tooling only and must not be deployed.

`pnpm test:integration` is destructive and must never target production. The [integration guide](../apps/site/integration/README.md) defines the disposable database, explicit authorization, independent owner/runtime clients, TLS, identity checks, sentinel, and production denylist. Connection-string inequality alone is insufficient because direct and pooled URLs can reach the same database. Global retention tests use an empty disposable database. Delete a test branch only after evidence is recorded, identity is reconfirmed, and no other run is using it.

## Release and rollback

Follow the [release validation guide](release-validation.md). Activation order is migration → backend readers/protocol → worker lanes and cron definitions → bounded bootstrap → browser polling → final cleanup. Do not invoke an authenticated preview worker against production Neon. Preview worker tests require disabled persistence or the isolated integration database.

Verify the production deployment belongs to the merged commit, both league sites remain readable, all active cron routes exist, and naturally eligible work publishes or returns unchanged. Healthy idle is acceptable when no work is eligible; do not force a write for paperwork. Record actual test totals, deployment identities, request evidence, durations, and limitations in the implementation ledger rather than assuming a green build proves runtime behavior.

Rollback is a normal reviewed Git revert. Do not reset or force-push main, delete snapshots, mutate pointers, or drop additive columns. Vercel Instant Rollback does not automatically restore prior cron definitions: explicitly disable/correct schedules, restore the Git-backed configuration, and confirm no obsolete route is still scheduled. Keep only one owner for future work throughout recovery.

Escalate or revert if a league becomes unreadable, fallback fails, the observer contacts Tank01, calls multiply unexpectedly, stale ownership can publish, pending work is acknowledged without official lineage, completed periods keep polling, or secrets/excess privileges appear. Ordinary timestamp-driven source revisions are not evidence of changed scoring by themselves.

## Portability and remaining work

Lineup validation/revision, classification, scheduling, pending-state policy, and orchestration are provider-neutral. Another service can implement the calendar, league source, lineup source, and crosswalk ports without rewriting those policies. Complete Sleeper removal is still broader: official scoring and identities, stored provenance and low-level IDs, the direct fallback, and presentation identifiers need separate work. This implementation does not claim one adapter swap removes all Sleeper dependencies.

Real 2026 game validation remains an operational follow-up: near-kickoff lineup changes, first live score, clocks, halftime, final convergence, future changes during live current games, missing projections, empty slots, byes, completed starters, defense, team sums, both leagues, request counts, execution duration, skew, and publication/acknowledgment/browser lineage. Synthetic, browser, and isolated Neon checks support release but cannot prove real provider game-clock quality or live end-to-end timing.
