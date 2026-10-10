# DATA backend readiness and completion contract

Revision: data-backend-readiness-v1, October 9, 2026 (America/Indianapolis). This is **checkpoint 1: freeze the completion contract**, read with [the current scope](data-backend-scope.md) and [the evidence record](data-backend-evidence.md). The coverage decisions below define the requested outcome; the numeric operating values are selected engineering acceptance targets, not measured capabilities or new spending/runtime authority.

## Completion boundary and source

The outcome is a generic public Sleeper username → stable provider identity → associated **2026** leagues → existing adapters and canonical typed PostgreSQL storage → refresh/recovery → stored-only backend readers. Any public username is eligible: no named-user or pilot whitelist. League One, League Two and Dynasty are regression customers. Complete backend coverage includes all eight official families below, even when a projection or analysis cannot support the league.

Checkpoint 1 is complete when this contract is frozen, independently reviewed, and passes the scope check and actual-diff review. It does not complete checkpoint 2, certify the backend, or authorize later execution. Backend readiness requires the in-scope resource and operating checkpoints through 30 with their required evidence; deferred 3–4 remain deferred, and 31–34 are separately authorized installation/release/activation work.

The reference source is `de711417c0bfbc22f2b92081b8a133e37e28d276`, the documentation closeout on unmerged draft [PR291](https://github.com/clawmachinejed/league-one-audit/pull/291). Its last executable/test-fixture revision is `1eef1999df532b933b2e12de543c80e0e4b780ff`; the closeout changed no executable bytes. The [core recovery and ClawMachineJedi evidence](data-backend-evidence.md#current-core-recovery--october-9-2026) establishes only its recorded bounded paths and original sources. Historical failures remain failed. The reference recovery worktree/branch is preserved, not merged or silently replaced.

Contract preflight found local `main`, local `origin/main`, GitHub `main` and Ready Vercel production `8C3YSnXRCbmPETftQgRtirfyck5e` at `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`, with canonical repository `clawmachinejed/league-one-audit`, root `apps/site`, and production branch `main`. The readiness contract is authored in its own worktree. Revalidate this authority before later implementation and again before deployment; these recorded observations are not continuing release authority.

## Season, format and official-data coverage

“Current season” is pinned to **2026**, including its earlier weeks, transactions, drafts, playoffs and corrections. It does not roll forward with the calendar. Do not traverse annual league links or collect another season. Preserve native `previous_league_id` and future-year traded-pick references as source facts without following them; retaining those references is not prior/future-season coverage. Checkpoint 20 means within-2026 history.

Supported format scope is head-to-head redraft, keeper and dynasty, including byes, ties, custom official scores and multiweek playoffs. Pre-draft or incomplete configuration is represented honestly. Unsupported derived scoring cannot reject representable official data. A specific unrepresentable official structure needs an explicit resource limitation with retained evidence; it cannot disappear behind a claim that the whole family is complete.

| Official family | Required 2026 completion |
| --- | --- |
| Leagues, settings and seasons | Stable canonical identity and exact provider/season connection; native status, scoring, roster, competition and waiver settings; versioned, evidenced applicability to each interpreted period. No inferred annual chain. |
| Teams, managers and co-owners | Season-scoped team/roster identities, stable provider users, observed primary/co-owner relationships, vacancies and changes; commissioner is a separate supplied fact, not ownership or account authority. |
| Rosters and player identities | Native held/reserve/taxi/other supplied categories, additions/removals and complete/partial/empty states; durable versioned player directory and evidenced canonical links, with unresolved/conflicting identity explicit. |
| Lineups and matchups | Complete bounded inventory of source-exposed 2026 weeks/periods, exact native assignments, slots, grouping and phase, including byes and each evidenced multiweek playoff leg. Today's roster/settings cannot substitute for missing historical evidence. |
| Official scores, results and standings | Exact supplied values, custom overrides including zero, supplied W–L–T/PF/PA/rank/seed, results and finality evidence. Unknown/provisional remains explicit; any computed ordering or outcome is labeled derived. |
| Transactions, waivers and FAAB | Complete source-exposed 2026 transaction history, stable IDs, native type/status/participants/adds/drops/trades/bids/budgets/timestamps, corrections and removals. Do not infer unexposed claims or outcomes. |
| Drafts and picks | All source-exposed 2026 draft identities/settings/order/status and selections; player/team/round/pick and evidenced traded-pick ownership, including conflicts and future-year references. Pre-draft/incomplete is not fabricated completion. |
| Schedules, playoffs and history | Generic stored 2026 schedules, exact opponents/periods, structured bracket rounds/entrants/relationships/advancement and evidenced results, with corrections and historical applicability. No named-league-only history reader. |

Every discovered league and requested resource must have an explicit outcome. Supplied, unavailable, not requested, unsupported and invalid are distinct; an obtainable endpoint not yet implemented/selected remains a gap. Source-unavailable fields need captured evidence and a coverage reason. Missing/null/empty/invalid/zero and native IDs as strings remain distinct. A complete raw archive without typed queryable records and stored reader parity is insufficient.

## Frozen workload and acceptance targets

These targets qualify a declared workload, not unrestricted fleet scale. The benchmark is **16 distinct 2026 league-seasons total**, shared once across usernames, up to **20 rosters per league**, with weeks **1–18** including evidenced playoff legs. Coverage must also account for any additional native 2026 period exposed by the source; an out-of-benchmark period is an explicit coverage/qualification gap, never silently omitted. Exercise at least two unrelated usernames and the named-league regressions. The maximum benchmark keeps **eight already-accepted distinct leagues refreshing while two concurrent username intakes each import a fresh, unpopulated cohort of four distinct leagues**, reaching the same 16-league total. Shared/overlapping username associations and deduplication are qualified separately; already-populated imports cannot substitute for this fresh-intake workload.

Generic eligibility is independent of this benchmark. A username with more associations, an oversized league or excess total demand receives explicit queued/capacity/coverage status and a complete discovery accounting; it must not be silently truncated, labeled an unsupported format solely for capacity, or reported as a complete import. Qualification above these bounds requires an explicit revised contract.

| Measure | Acceptance target and boundary |
| --- | --- |
| Submission status | Durable request/status receipt ≤ 2 seconds for each measured benchmark submission, including explicit capacity outcomes. This acknowledges work, not completed data. |
| Initial import | Each of the two concurrent benchmark imports completes full obtainable 2026 coverage and stored-reader availability within 4 hours from accepted submission, including queueing, all backfill and retries. Measure initial backfill separately; publish its entire wait and duration. Two imports do not establish a population percentile. |
| Active rosters, lineups, official scores and transactions | For each league and family after its first acceptance, source-observation age p95 ≤ 5 minutes and p99 ≤ 10 minutes. Controlled change-to-stored-reader visibility p95 ≤ 5 minutes. Steady-state measurement includes the two concurrent intakes above. |
| Discovery, identity, manager facts and settings | Successful source refresh within 24 hours. Period-applicable settings still require actual evidence before interpreting that period; this cadence grants no historical applicability. |
| Brackets, official results and standings | Successful source refresh within 15 minutes while active; within 24 hours while inactive. |
| Player directory; drafts and picks | Successful source refresh within 24 hours. Shared catalog acquisition counts once; no five-minute live-draft promise. |
| Earlier 2026 corrections | Complete correction sweep of earlier periods, transactions and drafts within 24 hours, retaining corrected versions and earlier evidence. |
| Provider request envelope | Proposed DATA release ceiling: ≤ 40 GET attempts per rolling minute and ≤ 1,800 per rolling hour, including intake, refresh, failed/retried requests and redirects. Count each HTTP attempt; shared acquisition counts once. |
| Outage and backlog | After a controlled 30-minute provider or worker/database outage, restore active freshness within 15 minutes of dependency/service recovery and clear the declared queued backlog within 4 hours. Preserve last-good records and report outage-inclusive lag and failures. |
| Stored reader performance | Single-league composed 2026 reads p95 ≤ 500 ms and p99 ≤ 1 second, with at least 1,000 bounded reads at concurrency 10. Record query mix and dataset; measure end to end through the actual database-backed backend reader, with no external provider calls. Directory/list queries stay bounded and measured separately. |
| Retention and storage | Retain all accepted 2026 typed records, correction versions and required provenance through at least March 31, 2028. Planning budget ≤ 10 GiB attributable DATA storage at the benchmark and retention horizon, including unchanged-observation metadata, correction versions, required evidence, indexes/TOAST; shared catalog counted once. |
| Isolated restore | RPO ≤ 24 hours of committed accepted data; RTO ≤ 4 hours to verified restored stored-reader service. Prove restored identities, versions, receipts, heads and outputs through the existing isolated harness/storage owners. |

The provider ceiling is an engineering bound, **not Sleeper's published rate limit or source-use permission**. Existing lower admission, transport, concurrency, lease, retry and provider guards remain effective until a separately scoped/reviewed change at 25–26. Inventory combined demand and preserve existing named-league and Tank01 budgets. Neither the ceiling nor the freshness target authorizes increasing today's limits, adding a feed/queue/scheduler, changing production cron, or bypassing a safety fence.

The retention horizon uses March 31, 2027 as an administrative season-end cutoff solely for this engineering target; it is not competition or finality evidence. There is no automatic purge even after March 31, 2028, no end-of-season import/rollover, and no new production backup service. Storage forecasts must state their inputs and uncertainty; estimates and row counts are not measured bytes, and two hours of performance proof do not prove 12-month endurance/storage fit. Exceeding 10 GiB requires a reviewed capacity/retention plan, never deletion, truncation, reduced evidence or partial data reported as complete. Any later retention change requires an explicit contract revision; destructive cleanup also requires separate authority.

### Measurement and pass/fail rules

- Freeze the exact source, installed PostgreSQL version, workload distribution, applicable source statuses, event/sample inventory and limits before each later authorized qualification. Use the same existing source → writer → stored-reader path; no test-only faster pipeline.
- Define active before sampling: provider in-season league and its current requested period, including roster, lineup, score and transaction families; never choose it retrospectively from successful/changed responses. Record the activity mix and time window. Before the run, freeze a contiguous sampling schedule with at least 120 slots at 60-second intervals over at least two hours for every active league/family. Missing, unavailable or timed-out measurement slots count as failed observations with infinite age for percentile ordering; never omit/replace them or extend the window to accumulate 120 successes. Report p50/p95/p99, maximum, scheduled/observed sample counts and failures separately per league/family; pooled percentiles cannot hide a failing league. Use nearest-rank percentiles. Queueing, processing, contention and retries remain on the clock.
- Source-observation age is sample time minus the successful originating provider observation bound to the reader's accepted/verified resource. Reads, retries without a new successful observation, or cache hits cannot advance that timestamp. Initial absence and incomplete backfill remain visible in import/coverage reporting; the post-first-acceptance freshness lane cannot conceal them.
- Change latency starts at a reliable upstream availability/change timestamp when supplied, or the controlled fixture's known change instant, and ends when a committed stored-only reader returns that version. When live source change time is unknown, retain old/new observation brackets and report a conservative upper bound. If that bound cannot prove the target, record latency as unqualified; do not report exact live mutation latency. Include any independent measurement GETs in the provider envelope.
- The healthy-load run must meet the five-minute p95 and ten-minute p99 freshness targets; incidental failures remain included. Test the deliberately injected 30-minute outage against the recovery/backlog targets and report its outage-inclusive percentiles separately, without claiming they satisfy the healthy-load freshness target. Do not remove an undeclared outage to manufacture a healthy pass. Recovery time begins when the failed dependency and existing runner are available again; backlog time includes all declared queued work. A stored success with stale content is not recovery.
- Reader timing includes database execution, decoding and composition; report cold/warm behavior, query plans, row counts and measured storage separately. RPO compares the latest recoverable committed point with the failure point; RTO runs from declared restore start to validated readers. Provider re-fetching alone cannot prove restoration of immutable accepted history.
- Required correctness, identity, permission, immutability, source parity and complete discovery accounting must pass; latency percentiles cannot excuse corruption or silent omissions. Report all selected failures/skips/retries and unexecuted proof. No target is met by authored code, passing path checks, fixtures alone where live proof is required, or a configuration value.

### Known gaps at the reference source

The current DATA composition is dormant and uses the existing single-step runner with a **60-second admission interval**. A three-league cycle comprising identity, discovery, three bootstraps, three core captures, three directories and one period per league requires 14 admissions: **at least 13 minutes of spacing alone**, before processing or backoff. This is source-bound scheduling arithmetic, not a measured full-backend capacity result. It already exceeds the five-minute target at three leagues; the 16-league benchmark is unqualified.

The current exact-period selector permits only **one week per declared season**, not complete 2026 inventory. Transactions/drafts/brackets and full official-result/history composition have the gaps recorded in the [resource matrix](data-backend-evidence.md#resource-qualification-state). Historical live two-collection core passes do not qualify all families, sustained freshness, actual crash/restart, fleet load, retention capacity or backup/restore. Implementing bounded fair scheduling within existing owners at 25–26 may be necessary; the contract supplies no blanket architecture or runtime-change exception.

The existing disposable supervisor has a 30-minute work budget and 40-minute total lifecycle, with a one-hour branch-expiry fallback; hosted CI has a 50-minute job limit ([harness limits](../../apps/site/integration/README.md#run-lifecycle-and-evidence)). Those limits cannot accommodate this sustained measurement as currently configured. Checkpoint 26 must reconcile duration and cost in a separately authorized qualification plan through the existing guarded harness. This contract neither weakens current deadlines, expiry or safety controls nor authorizes a new harness. Simulated timestamps cannot stand in for elapsed operating proof.

## Checkpoint order and acceptance ownership

Keep all **34 original numbers**. Work proceeds 1, 2, 5 onward; 3–4 are deferred, not passed or renumbered. Each increment still records the scope contract's four fields: data resource, existing path/files, persisted result, and real evidence/gaps.

| Checkpoint | Required outcome |
| --- | --- |
| 1 | Freeze this completion contract; independent review and scope/diff checks only. |
| 2 | Separately freeze the source baseline and acceptance checklist against this contract; do not inherit complete status from checkpoint 1. |
| 3 | **Deferred:** connect consecutive seasons using provider evidence. |
| 4 | **Deferred:** bounded resumable prior-season discovery. |
| 5 | Persist the player directory with source and version evidence. |
| 6 | Qualify roster-player links, removals, empty/partial states and unresolved identities. |
| 7 | Qualify manager facts, commissioner distinct from ownership, changes, vacancies, co-owners and directory failures. |
| 8 | Queue every supported 2026 week/period once through bounded existing work. |
| 9 | Establish phase and period-applicable 2026 configuration. |
| 10 | Prove exact stored lineups/scores, corrections, custom zero and supported formats. |
| 11 | Store structured playoff brackets: rounds, entrants, relationships and advancement. |
| 12 | Include brackets in ordinary intake/refresh with corrected versions. |
| 13 | Read official results/standings with provisional, unknown and derived states explicit. |
| 14 | Include one period's transactions in ordinary intake and stored readers. |
| 15 | Complete 2026 transaction history, refresh, corrections/removals and partial-failure handling without duplicates. |
| 16 | Store draft identity/settings/order/status, including pre-draft/incomplete states. |
| 17 | Store draft selections with player/team/round/pick and replay safety. |
| 18 | Store evidenced traded-pick ownership/conflicts; retain future-pick-year references without other-season collection. |
| 19 | Include drafts/picks in intake/refresh with checkpoint recovery. |
| 20 | Compose generic **within-2026** stored history, schedules, results and brackets. |
| 21 | Prove a fresh isolated installation, installed constraints and actual restricted roles. |
| 22 | Prove actual process crash and restart. |
| 23 | Prove independent competing workers, fenced ownership, fairness and bounded failure isolation. |
| 24 | Qualify controlled backend submission, status, configuration and pause entry points; no UI/accounts. |
| 25 | Qualify ongoing opt-in DATA refresh in the existing runner, repeated cycles and disable behavior; production remains off. |
| 26 | Measure freshness, acquisition capacity, provider budgets and backlog signals against this contract. |
| 27 | Measure query/index performance and fix demonstrated defects only. |
| 28 | Qualify retention and growth policy; destructive cleanup needs separate authority. |
| 29 | Qualify isolated backup, restore and replay. |
| 30 | Assemble a coherent release candidate containing intended changes, reconcile migration lineage if needed, and obtain independent source/SQL/preview review plus installation/disable/recovery plans. |
| 31 | **Separate authorization:** approved database installation with identity, role and compatibility verification. |
| 32 | **Separate authorization:** merge reviewed source; merging may trigger deployment. |
| 33 | **Separate authorization:** verify exact deployment and activate only approved DATA behavior. |
| 34 | **Separate authorization:** verify production League One/Two, generic-username stored backend readback and natural refresh. |

Checkpoint 2 must use at least the reference source above and carry historical evidence only for its exact tested source/path, then bind new proof to the final reviewed source. Do not import preserved branches to close a checkpoint. Any needed later migration-lineage reconciliation is explicit scope at 30, not authority to combine branches now.

## Proof, change control and authority

Use the existing adapters, normalization, canonical identity owners, typed writers/readers, durable jobs and guarded [isolated integration harness](../../apps/site/integration/README.md). Later completion proof must cover all eight families and relevant formats through actual authorized isolated PostgreSQL with actual restricted roles, retained representative source evidence, source/stored-reader parity, installed constraints/privileges, duplicate/replay and out-of-order handling, corrections/removals, partial failures, concurrency, rollback, real crash/restart, bounded recovery, load and restore. At least one bounded authorized live username → complete discovered 2026 list → actual isolated storage → stored-only reader journey remains required; the representative fixture/format matrix complements it.

Each proof records exact Git SHA, execution source/profile, PostgreSQL version, workload and timestamps, test totals/skips/filters/retries, limits, report/artifact hashes, independent review and acknowledged child/schema/generated-credential/branch cleanup where applicable. Prior selected SQL acceptance is reusable only for unchanged relevant behavior with an explicit source mapping; it is not certification of a later source or an entire family. Publication, preview, merge, database installation, production deployment and activation are separate states. Follow the [release rules](../release-validation.md) only when that phase is authorized.

UI/accounts, other providers, new projections/analytics, alternate feeds/queues/schedulers and unrelated branch imports remain outside this outcome. Preserve existing consumers, source permissions, database role boundaries, league/manager selection, fallbacks, exact-week behavior, `clock-v1`, immutable baselines, scoring and publication owners. Official coverage cannot substitute estimates for source results.

Any change to the season, format/family coverage, numeric targets, workload, evidence rules or deferred/release boundary requires an explicit contract revision, rationale, affected-checkpoint impact and independent review. A material product/scope decision returns to the user; routine in-scope engineering choices do not. An infeasible or failed target stays an implementation/qualification gap until explicitly revised—never silently relaxed or reclassified as achieved.

This checkpoint authorizes documentation, documentation/scope checks, and ordinary existing source CI on draft publication, with **$0 new spend authorized**. It authorizes no application implementation, paid/live/destructive integration tests, SQL runs, credential access, provisioning, retained installation or migration application, merge, production deployment or activation. Historical source/test evidence keeps its original revision and execution status; it is not a new test run. Historical test budgets imply no remaining balance or future allowance. This document creates no production backup service or schedule. Later paid/isolated runs and release actions require their own applicable authority; existing safety guards cannot be waived by this contract.