# Lineup freshness: architecture and operations

This is the current operational guide for lineup observation and projection rematerialization. The [approved contract](lineup-freshness-approved-contract.md) defines scope and invariants; the [implementation ledger](lineup-freshness-plan.md) records baseline, migrations, tests, deviations, and releases. Earlier architecture plans retain historical evidence and are not the current scheduling runbook. The [efficient lineup-check release note](efficient-lineup-checks.md) supersedes the original three-minute future-observation policy; its release status is recorded separately from implementation.

## What the system does

Sleeper remains the official league, roster, lineup, scoring, and schedule source. Tank01 supplies projected statistics, crosswalk identities, and NFL game states. Neon stores authority, observations, immutable projection content, kickoff baselines, work claims, and published snapshots. The browser reads published results and never triggers provider ingestion or projection calculations.

Lineup freshness is separate from projection-feed freshness. A thin lineup check detects whether the ordered starters or matchup assignments changed. Only a changed accepted lineup wakes extra materialization work. Routine scoring and provider refresh still occur on their established schedules.

There is one scorer, one `clock-v1` implementation, one projected-snapshot builder, and one publication implementation. The existing live formula remains `official Sleeper points + frozen pregame points × remaining game fraction` for offense and kickers. Live defense uses earned actuals plus supported remaining frozen components, replacing the provisional points-allowed tier with the projected final tier. It falls back to its frozen baseline when component evidence is unavailable; see [the defensive calculation and collection contract](live-defense-projections.md). When an individual NFL game is final, the fantasy-team projected total uses official final points while the player row shows the complete immutable frozen pregame baseline; a missing or invalid frozen baseline is unavailable in that row. A missing individual projection uses zero for internal calculation only after the overall slate is trusted. These rules remain independent of lineup observation.

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

Each runtime league configuration supplies its matchup horizon; the current configuration covers Weeks 1–18. The authority model retains distinct display and scoring fields, while the [site week calendar](site-week-calendar.md) resolves both regular-season weeks together at noon Eastern after the last scheduled NFL game day, requiring complete-game evidence. Snapshot order or a date alone cannot advance the week. Existing exact-game finality and publication guards remain independent.

| Authoritative state | Observed period | Healthy observation | Materialization owner |
| --- | --- | --- | --- |
| Preseason | Default display period | Every 60 seconds | Future lane |
| Preseason | Next configured period | Every 15 minutes | Future lane |
| Preseason | Two through four weeks after default | Every 60 minutes | Future lane |
| Preseason | Five or more weeks after default | Every 360 minutes | Future lane |
| Active league | Active scoring period | Every 60 seconds | Current lane |
| Active league | Next week | Every 15 minutes | Future lane |
| Active league | Two through four weeks ahead | Every 60 minutes | Future lane |
| Active league | Five or more weeks ahead | Every 360 minutes | Future lane |
| Active league | Earlier period | Never automatically | None |
| Complete league | Any period | Never automatically | None |

Website `past`, `active`, and `future` semantics remain distinct from watch classification. In particular, a preseason default page remains a future page even though its lineup receives one-minute observation.

Each future target has an absolute minute offset derived from its stable league/provider/season/week identity. A different league joining or temporarily losing authority does not reshuffle that target. The existing `cadencePolicyVersion` field stores `lineup-cadence-v2:<minutes>:<offset>`; the legacy three-phase field remains compatible with existing rows. A healthy completion schedules the next absolute bucket, not completion time plus an interval. Due targets are processed oldest first with bounded catch-up; these intervals are healthy scheduling targets rather than guaranteed response times.

Watch synchronization fences an in-flight claim when its cadence policy changes. Initial legacy-to-v2 adoption staggers healthy future targets into their new buckets. A later v2 tier change keeps the earlier of the existing due time and the new tier's due time, so week rollover cannot postpone an already due healthy check. Active failure backoff, accepted/materialized revisions and pending lineage survive cadence-only changes. Completed or otherwise obsolete watches retain their existing retirement rules.

A full active-period source load counts as that minute's observation. Its reservation prevents a duplicate thin load. When full work is not due, the current lane performs a thin check. A pending change bypasses an already-completed hourly marker; a busy owner or failure backoff remains respected. Routine full work retains hourly preparation, the seven-day preparation lookahead, and the existing two-hours-before/seven-hours-after kickoff windows. Missing exact kickoff times retain the established calendar-date fallback policy.

## Thin and full source validation

Both paths use one raw Sleeper matchup parser and one canonical lineup revision algorithm. Thin requests are uncached and do not load the player catalog, scoring settings, projection slate, or game states. The authoritative roster and starter-slot shape is required to trust the response.

Responses are classified as:

- **Complete:** every expected roster and matchup pairing is accounted for. Each team's starter list is either a valid ordered assignment or explicitly unavailable. This describes the observed envelope, not complete starter coverage.
- **Not ready:** upstream matchups are not yet available under the existing readiness rules; keep accepted data and retry at normal cadence.
- **Invalid:** missing or contradictory roster/pair identities, malformed nonempty assignments, duplicate identities, or incompatible shape; never replace accepted state.
- **Unavailable:** request or provider failure; keep accepted state and retry with backoff.

Provider-scoped roster, matchup, player, and defense references are distinct. Raw lineup assignment references are not assumed to be canonical scoring entities. Player names and team-name matching cannot silently establish identity.

### Missing team starter lists

A missing, null, or zero-length whole starter list is a team-local unknown. The canonical observation uses `starters: null`; it never pads unknown assignments with empty slots, copies another week's lineup, or uses current roster starters as exact-week evidence. A valid full-length list of Sleeper `"0"` markers still means intentional empty slots. Nonempty lists must retain the exact expected shape and valid unique identities.

Healthy teams continue through the same scorer, provider group, snapshot builder and guarded publication. The unavailable team remains in its official matchup with its observed official total (including a faithful null), `starters: []` and `projectedPoints: null`. The source observation stores `lineupAvailability` with available and unavailable roster IDs. Its `quality: complete` means the full roster/pair envelope was faithfully observed. It does not claim all player assignments or actual player points are known. All-player score ingestion separately requires complete starter assignments and full official parity; this projection policy cannot classify an unknown player as a bench player.

The additive `lineup-v1` null-list representation preserves every existing valid-array digest. Known → unavailable → recovered lists produce the appropriate distinct revisions and use existing pending work and ownership fences. A coherent unknown list clears transport/invalid-response failure backoff and is checked at the current-minute or applicable future-distance cadence. Actual request failures and invalid identities retain their backoff. An inherited pre-release failure can still wait until its already scheduled retry; no manual watch or pointer repair is necessary.

Projected standings apply only complete matchup pairs to the completed-week baseline. An unresolved pair contributes no projected result or PF/PA increment; its two teams retain their completed-week totals. All ranks are recalculated together using the existing comparator. The table reports provisional coverage and labels excluded teams. All-unknown but coherent pairs show the baseline as provisional; a missing snapshot or invalid identity remains unavailable. Turning the switch off always restores official standings. No projected standings are persisted as actual results.

One known opponent's NFL games becoming final cannot establish finality for the unavailable lineup. Frozen baseline coverage still includes rostered bench/reserve/taxi players, so a subsequently recovered official starter can use its eligible immutable baseline.

This change needs no migration, new schedule, provider configuration, or public payload shape. Existing SQL accepts nullable official totals, explicit source metadata, and unavailable public sides. Application rollback remains compatible with stored snapshots; older workers reject missing full-source starter lists and retain their normal safety gates. Never rewrite historical observations, frozen baselines, current pointers, or installed migrations to roll back.

## Game-clock plausibility and recovery

Migration `009_game_clock_plausibility.sql` keeps the existing append-only game-state history and adds a physical-time boundary to the canonical insert guard. Within the same regulation quarter, a countdown clock may decrease by no more than the elapsed time between accepted `observed_at` timestamps plus 90 seconds. The 90-second allowance covers the one-minute polling cadence, provider delay, and timestamp jitter; it is tolerance for when a sample was captured, not permission for a regulation clock to run faster than real time. Repeated clocks and smaller countdown changes remain valid because an NFL clock can stop. A same-quarter interruption may still omit its clock, but that row does not erase the most recent usable same-quarter clock anchor when live play resumes. Quarter advancement, halftime, overtime, final, missing-clock, opaque-period, interruption, and status-conflict rules remain separate and unchanged.

An impossible forward countdown sample aborts the complete provider-state statement, so that poll publishes no league and creates no snapshot lineage from unrecorded state. The next credible sample is compared with the last accepted clock and can proceed normally. For a malformed low clock that predates migration `009`, a later same-quarter live clock increase remains invalid unless an earlier immutable live observation proves both conditions: the stored low clock consumed more game seconds than its wall-time interval plus the same 90-second allowance, and the incoming clock is non-increasing and physically plausible from that earlier observation. The correction is appended as a new observation and becomes the latest state; the malformed row is neither updated, deleted, hidden, nor eligible as snapshot lineage for the recovering poll.

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

Current automatic failures refresh the server route, allowing safe official Sleeper fallback. Future automatic failures retain the last good view. Matchups has no routine header refresh button; users can reload the page when a manual retry is needed. The shared hook's existing manual helper remains available, but Matchups uses its automatic checks. Requests share a 15-second client timeout, and route changes/unmount invalidate old responses. Intentional null-lineage Sleeper fallback can replace stale Neon data; an unrelated old server response cannot displace a newer adopted snapshot. Expanded cards, My Team, week selection, mobile fit, and dark-mode presentation remain unchanged.

## Retry and execution budgets

| Work | Admission/abort budget | Lease |
| --- | --- | --- |
| Current lane | Existing provider limits and 60-second route maximum; no newly claimed whole-run deadline | 120-second global lease and hourly markers; full-source ownership fence |
| Observer | Stop new batches at 30 seconds; abort at 44 seconds; cleanup bounded to 4 seconds | 120-second global, 55-second observation claims |
| Future lane | Stop new stages at 45 seconds; abort at 50 seconds; cleanup bounded to 4 seconds | 120-second global, 55-second action claims |

Provider/database work remains bounded; observation and league-stage concurrency are at most eight. A slow database claim is rechecked against the start deadline before beginning network work. Unstarted claims expire without pretending an observation succeeded. Cancellation does not replace database ownership checks. Leases are not renewed; distributed renewable claims remain deferred.

Observation-failure retry remains separate from the healthy distance tiers: the first retry is after 60 seconds for a current-class watch, or 180 seconds for a future-class watch, followed by 300, 900 and 3,600 seconds. A distant future watch can therefore retry a failed request sooner than its normal six-hour interval. Complete and not-ready responses reset observation failures and return to the healthy tier. Future-action failures use their separate 5-minute, 15-minute, 1-hour, and 6-hour schedule. Backoff preserves accepted data and pending changes. Browsers cannot bypass it.

## Request envelope and service objectives

Lineup observation retains a nominal 20-check allocation per minute. Full current source requests reserve their share so a thin check does not duplicate the same observation. When future targets exist, the shared allowance reserves one slot for future work and up to 19 for current-class work. If preseason/default current-class watches also need the observer, the active-current lane admits at most 18 targets, preserving an observer slot for those defaults as well as future work; otherwise its cap is 19. With no future targets, the current-class allowance is 20, still shared across both lanes when defaults exist. The observer uses the remaining allocation, with at most 18 future-class checks per invocation. Its SQL reserves a due future slot ahead of a full default backlog; when no future row is due, default watches can use that spare slot. These are bounded admission rules, not a guarantee that all current leagues are checked every minute. Busy ownership, backoff and execution deadlines can reduce actual work.

Capacity diagnostics still report whether due-bucket demand exceeds that allocation, but excess fleet demand no longer rejects the entire fleet. Eligible due rows make bounded progress oldest first; deferred rows retain their due state. This prevents a fleet-wide capacity failure, not a growing-backlog problem. Larger fleets require measured provider limits, queue age and remote throughput before promising cadence.

For the existing three leagues at Week 2, the previous three-minute policy implied 19 nominal lineup checks per minute. The new healthy average is `3 + 3 × (1/15 + 3/60 + 12/360) = 3.45`: three current periods, then one next-week, three medium-distance and twelve distant targets per league. This is scheduling arithmetic, not measured provider requests, Neon transfer, compute or billing savings. Stable offsets can collide, catch-up and retries add work, and actual current source reuse can reduce duplicate thin work. The 20-check accounting does not include every full future-materialization load or other Sleeper endpoint; it is not a global HTTP rate cap. The thin observer still makes zero Tank01 calls.

The original three-phase fleet figures, hard capacity rejection and four-to-six/seven-to-eight-minute future timing objectives in earlier contracts and the [Dynasty release record](dynasty-league.md) describe the prior policy. They do not apply to the accepted slower future checks.

Observation cadence is not end-to-end latency. Measure due bucket → accepted observation, accepted observation → verified snapshot, and verified snapshot → browser adoption. Current changes normally need the next eligible minute full run and the next visible browser poll. Future changes may wait up to their 15-, 60- or 360-minute healthy observation bucket before being detected; a routine full materialization may observe them earlier. After detection they still wait for action selection, any projection prerequisite and the next visible 60-second browser check. Backlog, source failures and ownership delays add time. Sleeper has no manager-mutation timestamp, so exact delay from the user's tap cannot be measured directly.

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

Migration `007_lineup_freshness.sql` adds watch state and nullable lineup-version/hash lineage on official observations. Migration `008_additive_write_guards.sql` preserves compatible security-definer write entry points and immutable-history guards. Migration `009_game_clock_plausibility.sql` replaces only the canonical game-state insert trigger function; it adds no alternate persistence path and does not change tables, public APIs, workers, feeds, scoring, snapshots, or cron configuration. Existing migration files remain immutable and checksummed. Runtime uses the restricted role. Watch-table privileges are `SELECT`, `INSERT`, and `UPDATE`; not delete, truncate, references, trigger creation, ownership, or schema modification. The schema-owner credential is for local migration/fixture tooling only and must not be deployed.

The following migration-first procedure describes the historical `009` rollout, not the cadence-v2 release, which needs no migration. First revalidate the exact Production source, project, branch, database identity, migration ledger, and absence of a competing release owner. With separate database authorization, apply the reviewed `009` checksum through the existing migration runner while the old application remains deployed. Verify the ledger entry, function owner and ACL, both readers, and naturally scheduled old-application polls without forcing a worker. Only after that compatibility gate passes should the reviewed application commit be merged and deployed; verify the exact Vercel Git SHA, both leagues, and naturally scheduled publication again. Preview persistence remains disabled, so Preview is presentation evidence rather than a database-persistence test.

Application rollback may return to the previously deployed commit while leaving `009` in place because both old and new callers use the same unchanged insert contract. If the database behavior itself must be withdrawn, stop publication and use a separately authorized, reviewed forward migration; do not edit migration `009`, restore the vulnerable function ad hoc, mutate snapshot pointers, or rewrite/delete the anomalous observation. Revalidate both league readers and natural worker outcomes after either rollback.

`pnpm test:integration` is destructive and must never target production. The [integration guide](../apps/site/integration/README.md) defines the disposable database, explicit authorization, independent owner/runtime clients, TLS, identity checks, sentinel, and production denylist. Connection-string inequality alone is insufficient because direct and pooled URLs can reach the same database. Global retention tests use an empty disposable database. Delete a test branch only after evidence is recorded, identity is reconfirmed, and no other run is using it.

## Release and rollback

Follow the [release validation guide](release-validation.md). The original architecture rollout used migration → backend readers/protocol → worker lanes and cron definitions → bounded bootstrap → browser polling → final cleanup. The cadence-v2 application-only release instead follows [its explicit release and rollback procedure](efficient-lineup-checks.md), with no migration, cron or browser change. Do not invoke an authenticated preview worker against production Neon. Preview worker tests require disabled persistence or the isolated integration database.

Verify the production deployment belongs to the merged commit, both league sites remain readable, all active cron routes exist, and naturally eligible work publishes or returns unchanged. Healthy idle is acceptable when no work is eligible; do not force a write for paperwork. Record actual test totals, deployment identities, request evidence, durations, and limitations in the implementation ledger rather than assuming a green build proves runtime behavior.

Rollback is a normal reviewed Git revert. Do not reset or force-push main, delete snapshots, mutate pointers, or drop additive columns. Vercel Instant Rollback does not automatically restore prior cron definitions: explicitly disable/correct schedules, restore the Git-backed configuration, and confirm no obsolete route is still scheduled. Keep only one owner for future work throughout recovery.

Escalate or revert if a league becomes unreadable, fallback fails, the observer contacts Tank01, calls multiply unexpectedly, stale ownership can publish, pending work is acknowledged without official lineage, completed periods keep polling, or secrets/excess privileges appear. Ordinary timestamp-driven source revisions are not evidence of changed scoring by themselves.

## Portability and remaining work

Lineup validation/revision, classification, scheduling, pending-state policy, and orchestration are provider-neutral. Another service can implement the calendar, league source, lineup source, and crosswalk ports without rewriting those policies. Complete Sleeper removal is still broader: official scoring and identities, stored provenance and low-level IDs, the direct fallback, and presentation identifiers need separate work. This implementation does not claim one adapter swap removes all Sleeper dependencies.

Real 2026 game validation remains an operational follow-up: near-kickoff lineup changes, first live score, clocks, halftime, final convergence, future changes during live current games, missing projections, empty slots, byes, completed starters, defense, team sums, both leagues, request counts, execution duration, skew, and publication/acknowledgment/browser lineage. Synthetic, browser, and isolated Neon checks support release but cannot prove real provider game-clock quality or live end-to-end timing.
