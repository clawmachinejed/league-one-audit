# Package 2: retained roster contract slice

This is the first implemented slice of packages A/B, not completion of the aggregator migration. It adds common contracts and a server-only comparison projection of **current roster membership at capture time**. Existing pages continue to consume their original payloads. No reader cutover, new provider connector, migration, backfill job, enrollment expansion, or production write is included.

## Working path and ownership

The existing Sleeper acquisition and `recordCapturedAdministration` still call the sole administration normalizer and SQL writer. Raw captures, immutable observations, team IDs, acceptance and heads remain in the existing tables. `createLeagueAdministrationMethods` reads the selected capture and its existing season-team IDs in one SQL statement. It reuses the validated v1 roster value to produce the shared membership contract, validates that contract, and compares native player/reserve/taxi lists against the same capture. `createPageAdministrationReader` exposes this as internal `commonRoster` only after the existing source-identity and freshness checks. The Sleeper page facade continues to return its original payload; the internal comparison result is not a new public API.

There is no second fetch, scorer, acceptance implementation, queue, cache, normalizer of raw Sleeper documents, or publication path. The correlated identity lookup adds work to the existing roster SELECT but no extra database round trip. Its fleet latency/cost has not been measured. Other administration families do not construct the projection.

The bridge is discriminated as `legacy-retained-roster`. It deliberately does not claim to be a v2 `AcceptedResource`: v1 observations do not retain a stable source-connection ID and exact mapping-revision linkage. `sourceMappingRevisionId: null` and `mapping_revision_not_captured` expose that limit. Never populate that field using today's mapping or manufacture an enrolled/discovery identity. Full SourceScope/DiscoveryScope contracts and structural validators exist for subsequent slices; they do not grant access or register an adapter.

## Values and continuity

| Value | Implemented policy |
| --- | --- |
| Team identity | Existing `league_season_teams.id`, joined through immutable `team_entries` for the exact raw content, league season, provider and source league. No allocated or inferred IDs. |
| Native player/defense | Opaque Sleeper NFL reference; canonical identity remains unresolved. No name matching or analytics qualification. |
| Membership | `players` maps to `roster`, which includes all held entities without inferring active/bench placement. `reserve` and `taxi` retain separate native groups. Overlap across these groups is allowed. |
| Missing versus empty | Absent/null source array is missing/null/unknown; `[]` is empty/complete; nonempty array retains source order and IDs. |
| Exact-week lineup | Unverified by this resource. Current membership, including a retained prior-season capture, is never historical lineup proof. No mapping of `starters` in this slice. |
| Raw/native facts | Original raw payload and content hash stay intact, including owner/co-owner evidence, numeric standings facts, settings and unknown fields. The bridge references this evidence; it does not map all of it yet. |
| Source age | Original request/observation/check times stay separate from the accepted head's later `verifiedAt`. Cache age can remain unknown. Provider update time is null. Group freshness stays unknown; the existing page reader alone applies its unchanged TTL. |
| Feature support | Membership coverage is independent from exact-period lineup and forecasts. Complete native groups do not qualify scoring, identity crosswalks, projections, or competition rules. |
| Failure | Missing/conflicting bridge identity or hash produces an unavailable comparison result. It does not replace the legacy document or trigger a provider fetch. Existing missing/stale/conflict/database fallbacks retain their policy. |

## Executable evidence

- `lib/aggregator/contracts.test.ts`: opaque provider references, precise decimal strings, UTC dates, discovery without enrollment IDs, accepted-resource structure, independent availability/support, and documentation-derived synthetic Yahoo groups/composite keys. The fixture is not authenticated or live qualification.
- `lib/aggregator/roster-bridge.test.ts`: same-capture value parity, retained native fields, existing IDs, missing/empty/partial, original source age, correction lineage, corrupt identity evidence and league/season namespace isolation.
- `lib/aggregator/roster-path.test.ts`: real acquisition-persistence orchestration, Neon adapter, and page reader over scripted SQL responses. Asserts the existing query/request counts and unchanged raw result/fallbacks. These are transport conformance tests, **not SQL acceptance/concurrency proof**.
- `integration/league-administration.integration-case.ts`: actual SQL cases for retry/idempotency, equal-content verification, correction/history retention, rejected partial/invalid evidence, stale delivery, persisted team IDs and the ordering limit below. Run only through the existing guarded isolated harness.

The existing writer orders by `sourceObservedAt`, normally request completion, then completion/check time. It rejects older observed times and equal-time conflicting content. It does **not** establish provider edit order for overlapping requests: an earlier-started request that completes later can become current. A dedicated SQL fixture records this inherited limit. This slice neither changes that behavior nor qualifies the design's future overlap quarantine/reconciliation rule. The read-only projection cannot advance a head or delete members independently.

## Baseline, verification and release boundary

Before implementation, isolated HEAD, clean primary `main`, GitHub `main`, and Vercel Production matched `5ecf73d3e4d904b8a1888be8a5c83e1cce2812b3`. Vercel showed Ready deployment `4btbUqkzfpZEqacaeLsXH76LTJzy`, canonical repository `clawmachinejed/league-one-audit`, branch `main`, root `apps/site`. GitHub had no open PR; no competing owner observed in the inspected worktree/branch/PR/deployment evidence. No production worker or lease was invoked or modified; production database leases were not inspected.

The guarded Neon suite was attempted using the established integration-only configuration and stopped **before connecting or resetting** because `AUTH_RESET_INTEGRATION_DATABASE_URL` was missing. The other known integration configuration also lacked that required restricted lifecycle credential. No guard was bypassed, credential provisioned, migration executed, or database evidence claimed. The added SQL tests remain unexecuted until a complete authorized isolated environment is supplied. Unit, build, browser, CI and preview results are recorded in the PR/task completion evidence rather than attributed to this pending SQL gate.

This task is authorized to publish an unmerged PR and preview only. Production release remains separate. Application rollback removes the internal projection and leaves all original evidence and heads unchanged; no data rollback is needed.

## Remaining package-2 work

Implement and qualify durable connection/mapping revisions, coverage/audience/version-aware heads, v2 acceptance/order fences, retained-evidence backfill and rollback on an authorized isolated database. Extend typed contracts/mapping fixtures to the remaining screen-map resources (teams/managers, settings, official scores, standings, schedule, transactions and history), including official decimal values and native periods. Preserve all existing IDs, baselines and scoring hashes. Qualify the new SELECT and acceptance behavior against the actual isolated database, then measure query cost. Shared account/read-service cutover is package 3; authorized live Yahoo integration is package 4.
