# CP28 retention and storage growth analysis

**Status: LOCAL ANALYSIS / CAPACITY UNQUALIFIED.** This report binds offline calculations to retained evidence; it does not qualify the 10 GiB target or execute a retention policy. CP26 remains **STOPPED / INCOMPLETE** and CP27 remains **DEFERRED / UNQUALIFIED**. Both remain open release obligations. No SQL, provisioning, paid run, publication, preview, merge, production change or DATA activation is authorized or performed by this work.

## Contract and source boundary

The [DATA scope](data-backend-scope.md), [CP1 contract](data-backend-readiness-contract.md) and [CP2 baseline](data-backend-acceptance-baseline.md) govern this analysis. Retain **all accepted 2026 typed records, correction versions and required provenance through at least March 31, 2028**. The planning ceiling is **10 GiB = 10,737,418,240 bytes** attributable to DATA at the sixteen-league benchmark, including observation/control metadata, required evidence, indexes and TOAST, with the shared catalog counted once. Row counts, JSON transport bytes and relation allocation answer different questions.

March 31, 2027 is an administrative cutoff for this engineering target, never competition finality, a source status or authority to stop corrections. There is **no automatic purge after March 31, 2028**. No retention reduction, new backup service, replacement storage pipeline or cadence change is proposed as an accepted solution. The horizon model uses January 1, 2026 through April 1, 2028 exclusive: **821 days**, including leap day. This is a conservative calendar scenario covering the whole 2026 season and retention tail, not 821 observed days of execution.

| Four-field scope | This increment |
| --- | --- |
| Data resource | Storage and retention of the eight official 2026 families, shared identities/catalog, accepted corrections, observation/provenance and durable control state. |
| Existing path | Existing Sleeper capture/normalization → `league-administration/neon` typed writers → stored DATA readers; existing migrations, job owner and isolated harness remain unchanged. |
| Persisted result | Local report, source-bound extracted measurement, explicit assumptions and deterministic forecast JSON. No application/database record is written. |
| Real proof and gaps | A saved CP27 allocation snapshot and source inspection support the inventory. Offline arithmetic supports only modeled scenarios. Marginal growth, complete attributable allocation, elapsed retention and restore remain unmeasured. |

The isolated CP28 worktree starts at published `b41fca034e9982014f3396f960c91c3a718b0169` on `codex/data-retention-growth`. It does not copy the later CP27 runtime fixes. The authoritative CP27 deferral is preserved separately at `C:/Users/Robert Finchum/.codex/worktrees/data-reader-performance/LeagueOneEngineering/docs/aggregator-backend/data-backend-cp27-deferral.md`, local commit `516f0b7c9fb1210c2cb8d3e56f25cc293fa8d6d6`, tree `63563fec890d9de9b13412e8adf2fba18bb12315`. That overlay supersedes older next-attempt wording in this worktree's CP27 plan; it grants no continuing run allowance.

The coordinator freshly matched clean primary/local `main`, `origin/main`, GitHub `main` and Ready production `8C3YSnXRCbmPETftQgRtirfyck5e` at `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`. Vercel `league_one_fantasy` remains bound to `clawmachinejed/league-one-audit`, root `apps/site`, production branch `main`. Built-in browser checks loaded League One and League Two 2026 Week 6; League Two exposed six matchup articles. Five recent workflows were complete; eight inspected recent draft PRs were unmerged, including [PR317](https://github.com/clawmachinejed/league-one-audit/pull/317) at `b41fca0`, based on `codex/data-capacity-measurement` at `82c2ebf4e16ae707b8bb8f738b917cec441c5c11`.

No competing owner observed in the inspected worktrees, PRs, workflow runs and deployment. Production database, worker leases and cron activity were not inspected for CP28; this is no exclusive-release claim. The DATA-off boundary is carried forward from the unmerged work, not asserted as a freshly queried database state. The CP27 checkout and CP26's six unrelated dirty paths are preserved. No secrets were read.

## What the retained measurement establishes

The original file remains at:

`C:/Users/Robert Finchum/.codex/worktrees/data-reader-performance/LeagueOneEngineering/test-results/cp27-sql-b41fca0/artifacts/artifacts/run-T7dpvW/reader-performance-evidence.json`

| Evidence field | Recorded value / interpretation |
| --- | --- |
| Original file | 1,038,171 bytes; SHA-256 `acaaf6ab5493e9193c45a8ea4fd7c181aeb63d09cd6b7b585cabbe5ff17450fe`. This is the artifact file size, not database storage. |
| Executed source | `b41fca034e9982014f3396f960c91c3a718b0169`; [run 39124771162](https://github.com/clawmachinejed/league-one-audit/actions/runs/39124771162). |
| Dataset/source digest | `627a597e81d7a762ec7c1258eff43471065ba18277fd064a6209d3b59ff843c4`. |
| Saved relation inventory | 113 relations; 101,272 rows; **47,693,824 allocated bytes = 45.484375 MiB**. Twenty-five zero-row relations still occupy 548,864 bytes. |
| Physical measurement | `pg_total_relation_size`, already including each table's indexes and TOAST ([PostgreSQL 18 database-size functions](https://www.postgresql.org/docs/18/functions-admin.html#FUNCTIONS-ADMIN-DBSIZE)). Do not add indexes/TOAST or diagnostic `pg_column_size` totals again. No per-row `pg_column_size` or marginal-byte measurement was retained. |
| Selection boundary | Public `league_*`, `public_data_*`, `leagues` and `projection_jobs`; a prefix-scoped inventory, not the whole database or complete attributable DATA storage. |
| Run disposition | Setup and snapshot/list/plan cases passed; composed-read qualification failed: 588 passed, 22 failed, 390 unserved of 1,000 slots. Matching before/after digests and acknowledged cleanup support snapshot integrity, not a performance or capacity pass. |

This allocation belonged to the now-deleted isolated CP27 child. It is not the size of a current retained or production DATA database; no persistent production DATA dataset was measured or activated. The original artifact is local ignored evidence in its protected preserved checkout. The derived seed retains its 113-row relation inventory but is not a replacement for the original evidence; the seed's file size is not database storage.

The source fixture contains sixteen distinct leagues, twenty teams per league, eight players and four starters per team, eighteen weeks and only 160 shared catalog players. It has twenty week-7 transactions per league, one one-round twenty-pick draft, a week-7 official report and simple brackets with no edges. It is not a measured season of changes, a full NFL directory, a complete transaction/report distribution or a correction/unchanged-refresh marginal-cost experiment.

| Practical allocation group | Saved allocated bytes |
| --- | ---: |
| Exact-period matchups/lineups | 23,674,880 |
| Administration content/observations | 6,119,424 |
| Roster/player links | 4,792,320 |
| Capture/resource acceptance | 4,644,864 |
| `public_data_*` control | 2,850,816 |
| Drafts/picks | 2,097,152 |
| Identity/configuration | 1,703,936 |
| Standings/reports | 704,512 |
| Shared catalog | 540,672 |
| Brackets | 229,376 |
| Other selected relations | 335,872 |
| **Total, each selected relation once** | **47,693,824** |

These groupings explain the retained fixture; they are not SQL partition boundaries or a fresh measurement. Allocation includes relation/page overhead. Dividing allocated bytes by fixture rows and multiplying by future rows is an explicit approximation, not measured row size. Empty tables cannot establish a zero cost for future controls or failures.

The prefix excludes shared `scoring_profiles`, `scoring_entities` and `external_scoring_entity_ids`, which DATA canonical links use; it includes some `league_week_*` projection relations that may not be attributable to DATA. Later accounting must reconcile shared dependency rows and selected projection rows, allocate ownership transparently and count each physical relation contribution once. There is no demonstrated complete DATA total in this snapshot.

Earlier retained CP5 evidence at `1257f8a4087c8e542ad6ba1b0b974761e6179bda`, [run 38050136534](https://github.com/clawmachinejed/league-one-audit/actions/runs/38050136534), records **12,229 native/stored catalog rows and 14,660,285 raw UTF-8 bytes** on PostgreSQL 18.6 (see the CP5 record in [DATA evidence](data-backend-evidence.md)). This is historical observed cardinality, not a current catalog census. Its 16,841-byte artifact is preserved at `C:/Users/Robert Finchum/.codex/worktrees/data-player-directory/LeagueOneEngineering/test-results/cp5-live-38050136534/integration-1257f8a4087c8e542ad6ba1b0b974761e6179bda-1/artifacts/run-rCLCkW/live-player-directory-capacity.json`, SHA-256 `8ca9455a766592edecbd3fb9911cf7c5fc84d97e20184a3fd4fb94b3188d3350`. Its context digest `4cd586755dd556113c69a49668c556532f563032849af1f18c24835816ebc847` binds through the companion qualification report and ledger to that source/run.

The CP5 artifact also records a 37,447,585-byte compact capture and 39,358,847-byte PostgreSQL JSONB text representation. None of these is physical relation allocation. They establish that the 160-player fixture is small; they supply neither `pg_total_relation_size` for the complete directory nor the byte cost of unchanged checks or changed complete versions. Extrapolating CP27's allocation to 12,229 entries remains a model assumption.

## Inventory and retention dependency analysis

The following names are table patterns, not permission to purge a prefix. Paths in the source column are under `apps/site/migrations/`; the source is b41 unless stated. Current heads are bounded mutable pointers. Retention obligations attach to their historical versions and required dependencies as well as current values.

| Resource/group | Tables and practical growth behavior | Source |
| --- | --- | --- |
| Leagues, settings and seasons | `leagues`, `league_seasons`, `league_source_connections`, `league_source_connection_history`, `league_source_mapping_revisions`, `league_configuration_{versions,activations,heads}` and native calendar evidence. Canonical league/season identities are shared across usernames; source/configuration revisions are retained when mappings or settings change. `scoring_profiles` is a shared dependency outside the snapshot prefix. | `016_portable_league_administration.sql:3–178`, `026_source_mapping_revisions.sql:9–36`, `031_native_period_mapping_evidence.sql:3`. |
| Teams, managers and co-owners | `league_season_teams`, shared `league_source_manager_accounts`, administration team/manager/membership entries, `league_team_manager_*`, `league_manager_directory_*`. Season-team relationships and accepted directory facts remain historical; repeated discovery is not a new canonical league. | `016:168–199`, `028_team_manager_relationships.sql:3–14`, `035_team_manager_evidence_v2.sql`, `043_manager_directory_facts.sql:4–12`. |
| Rosters and player identities | Administration roster content plus `league_roster_player_link_receipts` and `league_roster_player_links`. **Every newly accepted roster capture adds a link receipt and all H held-player links even when values are unchanged**. Canonical `scoring_entities` and `external_scoring_entity_ids` are shared across leagues; roster links are per acceptance/per league. | `042_roster_player_links.sql:84–107,166–183,400–416`. |
| Shared player directory | `league_player_directory_{heads,attempts,contents,entries,captures,source_slices,versions}`. A distinct full content hash retains the whole raw catalog and typed entries; unchanged successful captures still add attempt/capture/slice/version evidence. One catalog acquisition/version serves the fleet; do not multiply it by leagues or usernames. | `041_shared_player_directory.sql:2–71,278–318`. |
| Lineups and matchups | Generic resource receipts plus `league_exact_matchup_{value_contents,team_values,starter_points,player_points}`. New distinct content adds typed rows; identical accepted content reuses them. Native period mappings and exact historical applicability are dependencies. New capture provenance can grow without a new typed value set. | `030_exact_period_matchups.sql`, `045_exact_matchup_values.sql:12–50,159–206`. |
| Official scores, results and standings | Exact values above; `league_official_standings_{contents,teams,captures}`, `league_weekly_report_{contents,teams}`. Distinct content retains corrections; standings capture evidence grows with each accepted roster capture. Official values and finality remain source facts. | `048_official_standings.sql:542–566,867–902`, `049_weekly_reports.sql:20–34`. |
| Transactions, waivers and FAAB | `league_administration_transaction_entries` under retained raw content and generic exact-scope receipts/acceptances. Changed source collections retain corrections/removals and native transaction IDs; complete historical sweeps have more source events than the one-week fixture. | `016:208`, `033_transaction_capture_acceptance.sql`, `051_public_transaction_intake.sql`, `052_public_transaction_history.sql`. |
| Drafts and picks | `league_season_drafts`, `league_draft_metadata_*`, `league_draft_selection_*`, `league_traded_pick_*`. New content retains the whole represented metadata/selection/trade version; selection-player link receipts/rows also grow per accepted selection capture. Native future-pick references do not authorize future-season collection. | `053_draft_metadata.sql:112–149`, `054_draft_selections.sql:106–127,438–450,611–622`, `055_traded_pick_ownership.sql:15–40`. |
| Schedules, playoffs and within-2026 history | Exact-period content/acceptance plus `league_bracket_{contents,rounds,matches,entrants,results,edges}` and retained period inventory. Distinct bracket corrections retain typed relationships; zero fixture edges cannot model rich multi-round history. These are 2026 records, with no annual traversal. | `044_public_data_period_inventory.sql:267–276`, `046_official_brackets.sql:174–215`, `047_public_data_brackets.sql`. |
| Raw/source provenance | `league_administration_{contents,observations,observation_mappings,heads}` and typed entries. New distinct raw content retains a whole version; an exact unchanged raw result can reuse legacy observation/content while advancing verification state. Raw reordering can produce a distinct retained version. | `016:60–107`, `026:36`; `apps/site/lib/league-administration/neon/administration.ts`. |
| Typed acceptance provenance | `league_roster_resource_{scopes,heads,attempts,acceptances}` and `league_roster_capture_receipts` are the shared mechanism across official families, despite the historical roster name. Each fresh capture can add an attempt, receipt and acceptance even for unchanged content; same-attempt replay is a separate idempotency path. | `027_current_roster_acceptance.sql:2–57`; later family migrations extend these owners. |
| Intake and durable controls | `public_data_{intakes,identity_observations,league_lists,league_candidates,rejections,collection_reservations,dispatches,dispatch_outcomes,directory_captures}`, refresh configurations/targets/cycles/outcomes/failures, period plans/sources, tasks/checkpoints and `public_data_resource_*` authorities/occurrences/selections/service. New admissions, occurrences and outcomes grow despite unchanged official values; heads/services also mutate in place. | `034_public_data_intake.sql:3–110`, `036_public_data_refresh.sql:3–53`, `044`, `057_public_data_controls.sql`, `058_public_data_batches.sql`, `059_public_data_resource_schedule.sql:14–96`. |
| Compatibility and shared worker state | `league_calculation_source_captures` and `league_calculation_capture_inputs` are compatibility lineage, not ordinary DATA dispatch volume. Existing projection histories remain distinct. `projection_jobs` is a shared mutable job owner; its historical job-fence facts are copied into retained DATA receipts/dispatches/outcomes. | `032_calculation_source_history.sql`; existing projection retention owner. |

One logical refresh is not one storage row or even one capture. The CP27 v2 core path performs two HTTP captures and **four typed acceptances including manager-v2**, plus roster-link and standings-capture evidence; a users-directory capture has its own receipt without that typed triple. Exact-period work can require two HTTP captures/two typed triples, brackets are paired, and draft work has `2 + 3D` typed triples for D drafts plus selection links. Active occurrences and correction cycles add separate control rows; a full cycle/outcome is once per target, not once per family. These source multiplicities are why naive “polls × one row” accounting is unreliable (`public-intake.ts:318–507`, `runtime.ts:176–202`, migrations `035`, `047`, `048`, `050`, `056:1242–1283`, `059:793–813`, `061:163–189`). They are source analysis, not measured recurring execution.

The practical dependency graph is:

```text
canonical league/season + source connection/mapping/configuration
  -> resource scope -> attempt -> capture receipt -> immutable acceptance -> current head
                              -> raw content + observation + mapping evidence
                              -> typed content/version -> typed child rows
accepted roster/draft selection -> link receipt + player links
                               -> shared catalog version/entries + canonical player identities
intake/dispatch/occurrence/cycle -> retained outcomes + copied worker-fence evidence
```

The graph combines enforced foreign keys and logical provenance links. For example, roster receipts reference attempts/content/legacy observations, acceptances reference receipts/mapping revisions and heads reference acceptances (`027:25–48`). A retained head alone cannot preserve previous accepted corrections, applicability or source interpretation. Required retention therefore follows both typed child relationships and provenance references; deleting “old raw data” solely because a current head exists is not justified.

Source immutability triggers reject ordinary UPDATE/DELETE on many retained rows (`016:215–225`, `027:50–57`, `041:368–370`, `059:87–96`), and restricted-role grants constrain writers (for example `056:1298–1305`). These are useful mechanisms, not a March 2028 hold or proof against owner-level `TRUNCATE`, an unreviewed migration, accidental target selection or lost infrastructure. No executable DATA date hold, complete retention-enforcement test or horizon restore proof is established here; installed privileges at a future candidate still need their actual SQL evidence.

The existing projection worker calls `pruneHistory` with a 48-hour cutoff (`apps/site/lib/projections/worker/orchestrator.ts:92`). Its implementation in `apps/site/lib/projections/adapters/neon/retention.ts` prunes selected projection history and completed `projection_jobs` except the shared all-player job; it does not select the DATA administration/roster/directory/`public_data_*` families. The copied immutable DATA job-fence JSON has no foreign-key dependency on keeping the mutable job row. That distinction must remain explicit in retention and restore accounting; keeping receipts is not a claim that all worker audit state persists forever.

No `ON DELETE CASCADE` was found in DATA migrations 026–062. The orphan-identity cleanup in `054:771–776` excludes identities referenced by historical roster/draft links. Neither fact supplies a universal deletion guard or permits a new purge. Retaining every source-bound row through the contract date, and preserving its recoverability, remains a required outcome whose enforcement and storage cost are not yet qualified.

## Forecast, assumptions and sensitivity

The executable [offline calculator](../../scripts/analyze-data-retention.mjs) reads bounded local JSON and writes JSON to stdout. It performs no SQL, provider request, child-process launch, credential read or file write. Inputs are the [extracted seed](data-backend-cp28-seed.json) and [explicit assumptions](data-backend-cp28-assumptions.json); the [saved forecast](data-backend-cp28-forecast.json) contains component bytes, event counts, provenance, omitted relations and warnings. Every scenario's status remains `UNQUALIFIED` and `completeBudgetFitProven: false`.

The tool pins the original evidence SHA-256, size, source, dataset and complete 113-table extraction digest (`a0593e7de6257cb420ebb4da347951b856f7fd044e9b4f5dbf1d564317a9ce4e`). `--evidence` additionally rechecks those values against the preserved original file. Without that argument, the calculation explicitly reports that it has not reverified the original artifact; it only validates the pinned extracted seed. The saved forecast used original-artifact verification. A checksum is provenance/integrity evidence, not acceptance.

The forecast adds 821 days of assumed activity to one saved fixture allocation. This is a sensitivity, **not a reconstructed calendar history** from an October snapshot. It assumes 126 active days at 24 hours/day and 695 inactive days; March 31, 2027 neither stops collection nor changes finality. There is one inactive refresh/day, one catalog check/day, daily earlier-period sweeps over seventeen periods in addition to the current period, daily drafts/directory work and fifteen-minute active bracket/report work. These are modeling inputs, not newly configured schedules or observed success.

| Input | Low | Base | High |
| --- | ---: | ---: | ---: |
| Active core/current exact/current transaction interval | 60 min | 15 min | 5 min |
| Held-player links across twenty teams per league | 160 | 320 | 600 |
| Shared catalog entries | 160 | 12,229 | 12,229 |
| Fixture allocation-ratio multiplier | 0.5 | 1 | 2 |
| Core / current-exact changed capture fraction | 0.1% / 1% | 1% / 5% | 5% / 20% |
| Earlier-period changed capture fraction | 0.01% | 0.1% | 1% |
| Catalog checks producing a whole distinct version | 10% | 50% | 100% |
| Unmeasured control/omitted-family reserve | 10% | 25% | 50% |
| MVCC/operational reserve | 10% | 20% | 35% |
| Omitted shared-dependency reserve | 64 MiB | 256 MiB | 1 GiB |

All change rates, active days, reserve sizes and byte multipliers are assumed. The JSON includes the separate transaction, bracket, report, directory and draft fractions. Low/base are not target-compliant active-freshness schedules; high's five-minute interval still proves neither successful source observation nor reader latency. Low's 160-player catalog is an incomplete fixture-sized directory, not required full-directory coverage. Twenty teams is the benchmark roster count, not a cap on held players. All modeled change fractions mean **distinct new retained content hashes/versions**; a new observation or a return to an existing hash is different. A catalog fraction applies to whole versions, not the fraction of rows changed.

For L unique leagues and active cadence C minutes, each modeled recurring family has `L × (126 × 1440 / C + 695)` events. Source-derived multiplicities expand these into typed capture triples, link fanout and dispatch outcomes. Incremental costs use disjoint measured allocation groups divided by the fixture's corresponding event/row counts, multiplied by modeled volume and the explicit ratio factor. Initial allocation is included once; shared catalog content/observation growth is included once per fleet. There is no separate index/TOAST multiplier.

| Unique league-seasons | Low modeled GiB | Base modeled GiB | High modeled GiB | Capacity disposition |
| --- | ---: | ---: | ---: | --- |
| **16: frozen benchmark** | **11.196** | **124.560** | **1,599.866** | All illustrative scenarios exceed 10 GiB; none is a measured capacity result. |
| 400: sensitivity only | 274.880 | 2,798.500 | 38,319.230 | Outside qualified scope; not a promise for 100 users or 400 memberships. |

Unique league count drives per-league acquisition/storage. Four hundred associations that overlap the same sixteen leagues do not become four hundred independent datasets. The 400-unique-league row is a planning sensitivity, not a change to CP1's benchmark, eligibility policy or supported capacity. These low/base/high combinations are deliberately different assumptions, **not statistical bounds or confidence intervals**.

In the sixteen-league base case, the largest modeled incremental components are roster-link fanout **57.089 GiB**, capture proof **11.014 GiB**, whole changed catalog versions **8.378 GiB**, dispatch/outcome pairs **3.111 GiB**, and changed exact typed values **1.601 GiB**, before reserves. A 45.48 MiB initial fixture therefore does not demonstrate inexpensive recurring retention. Unchanged source content cannot be assigned zero growth when accepted link/provenance rows continue to append.

A simpler sensitivity holds the fixture's **160 held players/league** and byte multiplier at **1** while using a five-minute interval. The roster-link group costs an allocated-ratio proxy of **149,760 bytes per roster acceptance** (`4,792,320 / 32`). Applying that proxy to sixteen leagues yields **80.980 GiB for 126 active days alone**, or **82.531 GiB with the 695 daily inactive captures**. The 10 GiB budget minus the original seed would be consumed by this component alone in about **15.5 active days**. This is useful evidence of which slope to measure first; it is not measured marginal growth, a proven lower/upper bound, production exhaustion date or bill.

The model deliberately exposes what it cannot qualify: initial page/index overhead and vacant space distort allocation/count ratios; shared canonical identity allocation is missing; the small fixture omits representative control recurrence and failures; content sizes, raw-order changes, retries, partial captures and correction distributions can differ; some raw/family and control growth remains represented only by synthetic reserves. Stable draft selection/traded-asset identities are excluded from per-correction version multiplication; future new-identity growth remains unmeasured. The seventeen earlier periods plus current period do not automatically cover additional source periods or transaction week zero. MVCC reserve is not observed bloat. A reserve cannot close missing attribution or prove that a worst case fits. Marginal measurements and reconciliation must precede a capacity decision.

Reproduce from the CP28 worktree root using the existing local Node runtime:

```powershell
node scripts/analyze-data-retention.mjs --self-test
node scripts/analyze-data-retention.mjs --seed docs/aggregator-backend/data-backend-cp28-seed.json --assumptions docs/aggregator-backend/data-backend-cp28-assumptions.json
node scripts/analyze-data-retention.mjs --evidence "C:/Users/Robert Finchum/.codex/worktrees/data-reader-performance/LeagueOneEngineering/test-results/cp27-sql-b41fca0/artifacts/artifacts/run-T7dpvW/reader-performance-evidence.json"
```

The second command is portable seed-only reproduction; the third additionally verifies the preserved local original and should match the saved forecast's verification status. Changing an assumption intentionally changes its digest and modeled output. It cannot change the output into a storage PASS or authorize execution.

## Capacity response without deleting accepted history

The contract is retained unchanged if any scenario exceeds 10 GiB. An illustrative result below the limit is not capacity approval; incomplete attribution and unmeasured growth can reverse it. An over-budget result is a reason to measure the dominant uncertainty and review an implementation/capacity proposal, never to delete earlier versions, drop provenance, understate coverage or reduce collection cadence to manufacture a pass.

The next useful experiment is a **short, separately authorized storage measurement**, reusing the existing guarded isolated harness. It is not a resumed CP27 reader benchmark or CP26 endurance run. A concrete candidate is **two leagues with twenty teams each**, one shared complete catalog baseline, then **sixteen unchanged core/roster captures, four controlled core/roster corrections and one same-request replay per league**. Use the existing path, including its generated settings, manager and standings evidence, to measure the dominant roster/provenance cost. Record relation/row deltas after each phase and distinguish first-league cost from the second league sharing the catalog.

Accept the complete shared catalog **once**, respecting the existing 24-hour attempt guard; this short experiment does not repeat the catalog sixteen times, shift its clock or claim daily recurrence. Catalog-repeat/correction marginal costs remain unmeasured unless addressed by a separately scoped future proposal. Bind a complete catalog fixture and its permitted provenance before proposing execution: the CP5 capacity JSON is a measurement artifact, not the raw catalog. There is no new source acquisition in CP28.

Freeze the exact core/roster fixture, source-event/typed-capture/control counts, final reviewed source, PostgreSQL version, deadline and budget in the later proposal. The counts above are a bounded candidate, not an executable authorization. This small matrix estimates dominant marginal costs; it does not attempt to close every resource/format or operational qualification. Keep new source observations distinct from replaying one receipt.

The inventory must include canonical identity dependencies, refresh/correction targets and cycles, request/dispatch/outcome/control state and the shared catalog exactly once. Bind changed/removed facts and prior immutable versions to their accepted-reader evidence. Record which family/event slopes this minimal batch actually measures and leave others explicit assumptions. Measure storage with indexes/TOAST included once; distinguish logical bytes, physical allocation and existing free space. Do not infer long-term bloat from a short run. Failed/retried attempt growth remains an explicit gap unless separately bounded into that approved batch.

Use the measured dominant driver and uncertainty to decide whether the unchanged retention contract fits existing provisioned storage and the 10 GiB budget. If it does not, prepare a concrete capacity decision with measured demand, actual provisioned capacity and cost. A larger provisioned capacity cannot satisfy the existing 10 GiB target by itself; increasing that target requires the user's explicit contract revision and any additional spending authority. Preserve all required data while the decision remains open. No storage redesign, new service or runtime optimization is proposed here.

| Later proposal path | Specific purpose before any implementation |
| --- | --- |
| `apps/site/integration/reader-performance.qualification-case.ts` | Identify the exact existing fixture population to reuse and propose only a separately selected, bounded storage-delta case. No reader benchmark or runtime change. |
| `apps/site/integration/reader-performance-snapshot.ts` | Propose explicit DATA/shared relation attribution and per-phase allocations/row counts around the bounded batches; preserve the existing safe snapshot behavior. |
| `apps/site/integration/reader-performance.ts` | Bind measurement output to the frozen dataset/event inventory without borrowing CP27 performance acceptance or granting run authority. |
| `scripts/analyze-data-retention.mjs` and `docs/aggregator-backend/data-backend-cp28-*.json` | Accept source-bound measured marginal costs after review, retaining distinct assumed costs for unmeasured families. |
| `docs/aggregator-backend/data-backend-cp28-retention.md` | Record residual uncertainty, actual capacity/cost evidence and the resulting capacity decision. |

There is **no dispatchable next-attempt SHA, paid SQL allowance, compute/budget approval or scheduled run**. A later proposal must name its exact reviewed files, immutable source, bounded cases, resource/cost/time limits, expected discriminating result, stop conditions and cleanup evidence before requesting execution. Reuse the unchanged existing identity, sentinel, TLS, role, denylist, ownership, deadline and cleanup guards; no second harness. Revalidate canonical repository/services and any competing owner then. Do not borrow consumed CP26/CP27 allowances or treat source review as permission to run SQL.

## Local verification and remaining obligations

The coordinator reran the final offline checks with the bundled **Node 24.19.0** runtime: calculator syntax (`node --check`) passed; **30 self-tests passed, zero failed**; the DATA scope check with `--governance-change data-backend-scope-v1` passed; and `git diff --check` passed. The scope result reported 305 reviewed-extension, five governance and 42 data-path changes over the whole configured historical baseline, not that many newly authored CP28 files. `git diff b41fca034e9982014f3396f960c91c3a718b0169 -- apps/site` was empty.

The calculator author additionally checked two runs against the original evidence, semantic parity with the saved forecast, seed-only provenance disclosure, and four adverse CLI inputs that were rejected. These checks overlap the thirty-test suite; do not add them into a larger test total. On Windows the saved text can use CRLF while stdout uses LF: deterministic parity means equivalent JSON after parsing/newline normalization, not a claim that differently encoded files have identical byte hashes. Original artifact hash verification always uses its exact original bytes.

Independent reviewer `/root/historical_bytes` checked the retained artifact extraction, source/event counts, table-group accounting, formulas and final report, including the narrowly bounded core/roster experiment and preserved catalog guard. The final source-bound calculator/report review had no remaining blocking finding. This is local review of the analysis, not SQL or capacity qualification. There was no new CI, full application/unit/build/browser suite, SQL suite, provider fetch or endurance run for CP28. No skipped SQL case is represented as a pass.

| Final local artifact | SHA-256 of saved bytes |
| --- | --- |
| `scripts/analyze-data-retention.mjs` | `0369a44982ceef6a5b604bb62a657d569b1ee201e6f1b7482d7b892344528ec6` |
| `docs/aggregator-backend/data-backend-cp28-seed.json` | `a5cc6925b026bf95b1e3fcc7d3fd603cd6a639a5c3547d6df7aa4b638dfadfee` |
| `docs/aggregator-backend/data-backend-cp28-assumptions.json` | `206875843f293642953068ccde5ffefd264cac8dde27419ae6ba1c724b874e33` |
| `docs/aggregator-backend/data-backend-cp28-forecast.json` | `73de15e2afd35ee1bebb67b6d366151c1e7df5a57ab1e267446b58061a83f485` |

CP28's present deliverable is a reproducible offline analysis and an evidence-gap/capacity plan. Actual storage fit, retention enforcement and season-long growth remain unqualified. CP29 owns isolated backup/restore/replay and its separate RPO/RTO evidence; immutable rows and matching digests are not restoration proof. CP30 owns coherent candidate assembly and final readiness review; this document cannot close CP26, CP27, unmeasured retention/storage or CP29 obligations. Installation, merge, release and activation remain separate CP31–34 authority.

| Delivery state | CP28 result |
| --- | --- |
| Local report/model | Authored and checked locally; exact targeted results and independent-review boundary recorded above. |
| Branch publication / ordinary CI | Not performed; CP28 remains local. Historical b41 publication/CI belongs only to that source. |
| Preview / pull request changes | No CP28 preview or PR update performed. Existing draft PR317 remains historical context. |
| Merge / production deployment | Not performed; production remains the freshly observed main SHA above. |
| SQL / infrastructure / DATA activation | No database credentials retrieved, SQL, provisioning, infrastructure mutation or DATA activation. Authenticated read-only GitHub/Vercel identity and live-site inspection are recorded separately above. |
| Retention/capacity acceptance | Unqualified; no PASS from a forecast, source review or fixture snapshot. |
