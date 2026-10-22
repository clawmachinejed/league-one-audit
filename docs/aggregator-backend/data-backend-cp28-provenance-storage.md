# CP28 B2a: lossless receipt-provenance storage

## Status

**Local source candidate implemented and reviewed. Native qualification: INCOMPLETE. CP28: INCOMPLETE / CAPACITY UNQUALIFIED.** Three local attempts failed overall and were cleaned up. No B2 allocation or forecast was produced. The earlier test repair was source-checked but has not run against PostgreSQL. The consolidated continuation below replaces its unexecuted measurement design; no new native run has started. The accepted combined A+B result remains unchanged at a820e284f5f41d5c99eca5070f98902b550f1ec9.

## Complete accounting package and execution plan — October 20, 2026

The [completion manifest](data-backend-cp28-completion-manifest.json) and [derived accounting](data-backend-cp28-completion-accounting.json) define the complete planning inventory: all fifteen cost terms have explicit ownership, units, source multiplicities, scenario assumptions and unresolved costs. Complete accounting coverage does not mean every rate is measured or the capacity target is qualified. The existing offline calculator evaluates this package with `--completion`; it does not run SQL, fetch providers or write accepted evidence. Independent source/accounting/safety review accepted the package. Root independently passed all 33 completion checks and 87 candidate-validator checks and regenerated the saved accounting byte-for-byte. The offline preflight suite passed 72 checks; final exact-source readiness is recorded in the frozen local receipt. Six historical CLI outputs and all nine historical JSON evidence files remain unchanged. This preparation changes no integration fixture, migration, runtime owner or production behavior.

The declared scenario models a homogeneous sixteen-league 2026 fleet, not sixteen observed source identities or a measured geometry mix. It retains up to twenty rosters per league, the 821-day planning horizon through March 31, 2028 and both five-minute and four-minute core sensitivities. Exact periods 1–18 imply seventeen noncurrent daily periods; transactions include week zero and therefore eighteen noncurrent daily periods. Reports include one current period at result cadence plus seventeen earlier daily periods. A complete draft cycle has `2 + 3D` typed captures for D drafts, plus independent selection-link fanout. Held-player categories can overlap; the 160-player sample is not a bound on every supported roster. Every successful catalog version can change the roster-linking version even if catalog content is unchanged. These are source relationships and declared scenario inputs, not observed fleet traffic.

A decision-relevant sensitivity is already available before measuring B2: at five-minute cadence, exact, transaction, report and bracket work contributes 3,295,536 typed evidence captures under this declared schedule. Applying the historical mixed-family ratio of 3,604,480 bytes / 848 captures gives **13.045867 GiB** for that evidence component alone. It excludes core, drafts, catalog and other costs. The proof-only break-even ratio is 3,258.170519 bytes/capture before allowing any of those other costs. This is an assumed transfer of a finite historical allocation ratio; it is not a measured current rate or a lower bound. Transfer error can be positive or negative. Omitted physical costs and signed proxy error must remain distinct.

The four evaluated historical-proxy subtotals are below. Each excludes the pending candidate core and unresolved additional costs; signed transfer deviations may increase or decrease actual costs. These are neither complete numeric totals nor storage bounds.

| Assumed distinct catalog content fraction per successful refresh | Five-minute core schedule | Four-minute source-due sensitivity |
| --- | ---: | ---: |
| 50% | 37.549812 GiB | 41.087862 GiB |
| 10% | 28.021421 GiB | 31.559471 GiB |

Consequently the proposed native core sample cannot reverse this particular conditional over-budget result while its historical cost assumptions stay fixed. Its value is to qualify the B2 candidate's correctness and absolute core cost, replacing the pending core coefficient. It does not measure the other official families or prove the sixteen-league workload fits 10 GiB. The final decision must identify uncertainty and the required capacity response; it must not automatically launch another redesign or relax freshness, retained history or official-data coverage.

### Frozen native execution scope for separate approval

| Item | Exact proposed scope |
| --- | --- |
| Source and target | The final committed local candidate, exact Git tree, clean tracked/nonignored worktree, 76 explicit database source pins and separately hashed helpers/accounting inputs. Owned loopback PostgreSQL 18.6 at 127.0.0.1:53125; no hosted or production database. |
| Installation | Apply the existing 65 migrations and three role provisioners to one new disposable local database; expect 158 relations. No migration or runtime change is part of this preparation. |
| Cases and sample | Four B2 cases; seventeen earlier cases remain unselected. Two leagues, twenty teams and 160 held players per league; 160 shared catalog identities. Nine semantic, three interaction, two warm and 32 measured cores. |
| Accounting | 46 attempted cores, 44 successful and two deliberate expiry rejections. 187 expected reservations, 193 fixture ceiling, 353 conservative reserved allowance within the 512 campaign cap. At most six sessions; zero external provider calls. |
| Time | One fixed 30-minute campaign. Stage/case/hook/cleanup envelopes total 21 minutes 30 seconds before unallocated overhead; this is a budget, not a duration prediction. Allocation requires at least 480 seconds of the same clock remaining. |
| Evidence | Fifteen unique snapshots across all 158 relations, row and logical-byte diagnostics, exact counters, historical reader parity, actual role/security and concurrency/expiry assertions, restored temporary writer bindings and complete original logs. |
| Stop rule | One invocation; no retry, source repair, clock reset or expanded cohort during the campaign. Any failed case, drift, identity ambiguity, limit breach or insufficient remaining time stops the work and invokes owned cleanup. |
| Cleanup | Verify zero established clients, exact owned process/path identity, process and listener absence, removal of owned data and both generated credential files, generated-secret scan and acknowledged normal/partial cleanup. Unproved cleanup prevents acceptance. |

The existing expired campaign remains closed at 133 reservations. A future approved run starts a separate ledger and never resets that history. No campaign clock, database, credentials or SQL may be created during this preparation.

The exact command and final commit/tree/source/helper/accounting hashes are retained in the local frozen execution-plan and manifest receipts under `test-results/cp28-consolidated-candidate`. Read-only preflight may run before approval. Only after explicit approval may PowerShell 7 invoke `local-postgres18/run-local.ps1` once. Its bootstrap, setup, native tests and finally-cleanup remain one guarded lifecycle. The final plan must bind the installed PowerShell/Node paths and contains no publication, merge or deployment step.

### Evidence acceptance and checkpoint limits

After the single run, preserve original evidence and verify source, exact case/counter/allocation data and cleanup independently. Only then may an offline acceptance edit bind the existing `PROVENANCE_PIN` and extraction hash. No source changes occur during the campaign. The existing `--derive-provenance --provenance-evidence <native-run-evidence.json>` validates the pinned originals; `--completion --provenance-evidence <same receipt>` consumes that accepted candidate through the same validator. There is no manually entered measured bytes-per-core shortcut. Until evidence is accepted, the core remains symbolic and native evidence inputs fail closed.

Retention lineage is preserved: the original 154-relation schema proof recorded 223 restricted-runtime denials and seventeen owner guards; all 62 original migration hashes, account/auth provisioners and projection-retention source still match that proof. Migrations 063/064/065 add two/one/one retained tables, reaching 158. Accepted A/B1 evidence covers their earlier overlays; the selected B2 history/security cases cover its new parent and bindings. This source lineage does not claim a fresh complete 158-relation native pass. Owner schema authority, long-term endurance and CP29 restore remain separate limitations. No deletion, automatic purge, changed retention horizon or production activation is authorized here.

## Consolidation foundation — local commit 01169b0

The remaining work is organized as one preparation package, one reviewed evidence campaign and one capacity decision. CP28 requires defensible whole-workload accounting and retained-history protection. Another optimization percentage is optional. The previous A+B proof stays accepted within its original scope; no further normalization slice is selected automatically.

The source candidate now prepares an absolute final-candidate cost test. Removing the unexecuted A+B comparison cohort removes two warm and 32 measured cores: 136 reservations. The proposed core submatrix has nine semantic, three interaction, two warm and 32 measured cores: **46 attempted, 44 successful and two expected rejections; 187 expected reservations and a 193 ceiling** including boundary allowance. A future campaign would still reserve 353 conservatively within the 512 cumulative cap, six sessions and a single fixed 30-minute clock. These are proposed execution limits, not consumed reservations or run authorization.

The candidate-only fixture explicitly uses **20 teams and 160 held players per league: two leagues, 40 teams and 320 held players total, with 160 shared catalog IDs**. This matches the original hosted fixture's size, but does not establish a maximum supported held-player distribution. All held categories and source-exposed shapes must be declared in the full workload manifest. The prior campaign's smaller 20-team/160-held TOTAL limit is historical and is not silently expanded or resumed.

Concurrency executes before the two original 20-second expiry probes. Any failed observation releases its owned blocker before the normal intake's failure handling can wait on that blocker. Original errors, rejection/rollback assertions and outer cleanup remain. No new helper pipeline or runtime path is introduced. The allocation case requires the acknowledged fixed campaign start/deadline, exactly 30 minutes apart, with at least **480 seconds remaining**: its 300-second body, the 120-second afterAll envelope and 60 seconds for owned cleanup. Offline boundary tests exercise that exact pure guard without importing or executing the integration module.

The unaccepted calculator lane uses a new candidate-capacity evidence kind and a single candidate phase. It rejects the old two-layout shape and provides no B2 savings percentage. Nine semantic boundaries plus six candidate allocation boundaries retain all 158 relations and complete physical allocation, row and logical-byte accounting. The candidate DATA mean replaces the earlier core mean once; synthetic controls, initial catalog and other family costs stay separate. Accepted evidence pins remain empty until a qualifying run exists. The fifteen missing rates remain null; no new measurement or forecast file is produced during source preparation.

### One complete accounting matrix

| Preparation package | Existing fifteen terms covered | Reused evidence and required closure |
| --- | --- | --- |
| Candidate, startup and benchmark size | coreChangeAndEpochPremium; benchmarkGeometryAdjustment; startupAndOnboarding | Reuse original hosted corrections/catalog, accepted A/B1/A+B history proofs and current migrated-schema snapshots. Measure current candidate cost, record initial/warm boundaries and justify correction/epoch frequencies and held-player distribution. CP27's measured 16-league startup is historical evidence, not a current-schema upper bound. |
| Other official families | exactCurrent; exactEarlier; transactionsCurrent; transactionsEarlier; brackets; reports; drafts; managerDirectory | Reuse retained family fixtures, source multiplicities and CP27 physical snapshots. Use byte/row ratios as explicitly assumed historical sensitivities only when source, shape and multiplicity are mapped, or design one combined family cohort through existing owners with full before/after snapshots. Account for unchanged/change/replay examples, current/earlier periods, week-zero transactions, both brackets, complete report/draft/pick inventory and independent directory captures. Share a cost case only when writer, payload and multiplicity parity justify it; event volumes remain disjoint. |
| Shared acquisition and ordinary operation | catalogRecurring; ordinaryControlsAndFailures | Charge the accepted initial catalog once. Price or bound subsequent catalog attempts/versions and actual dispatch/checkpoint/retry/failure work with explicit frequencies and existing guards. The old synthetic-control rate is not ordinary-control qualification; never add both representations. |
| Complete source inventory and physical uncertainty | beyondAssumedPeriodInventory; otherSharedAndMaintenance | Declare additional native periods, drafts, picks, reports, roster categories, correction/epoch exposure and physical maintenance assumptions. Seventeen earlier periods and 160 held players are fixture assumptions. No arbitrary reserve or unknown zero supplies a capacity bound. |

Before execution, freeze one manifest with the sixteen-league identity/geometry mix, native period/draft/report inventory, payload sizes, change/retry frequencies, catalog version assumptions, ordinary control multiplicities and maintenance treatment. Every price must identify its unit, source, measured-versus-assumed status and uncertainty; every required byte belongs to exactly one term. Some inputs may use justified assumptions with sensitivity. Fifteen unknown terms do not require fifteen native or hosted campaigns.

At the 01169b0 source-preparation stage, the 187-reservation core submatrix did **not** implement an additional family cohort or resolve the full accounting manifest. The completion package above now supplies that separate planning inventory. Newly measured rates are not mandatory for every term; explicit, reviewed assumptions may support a conditional forecast, but cannot be presented as measured current rates or verified upper bounds. Its unused reservation allowance is not proof that more work fits. Enumerate and review all added family captures, prerequisites, snapshots, time and reservation allowances before freezing a complete execution package. Reuse the existing local harness once, with retry zero and stop-on-failure; retain every failure and perform cleanup. Do not change source or restart within the campaign. The prior campaign remains closed at 133 reservations. Prepared helpers are offline proposals until their exact reviewed manifest and a single new execution approval exist.

### Capacity decision and stopping rule

If a declared scenario's priced candidate/catalog subtotal already exceeds 10 GiB, or a disjoint subset of additional costs crosses it, reject that scenario without spending more runs to price every remaining nonnegative term. Finite allocation observations are not universal lower bounds. If the subtotal fits, require the complete inventory and justified remaining prices/bounds before accepting the capacity response. Unknowns keep the result unqualified.

The final review must deliver either a defensible result under the unchanged contract or a concrete quantified capacity decision with remaining uncertainty. It must not automatically launch another storage-redesign slice, relax cadence or history, or treat a successful core test as CP28 completion. CP26/CP27 performance, CP29 restore, publication, release and activation remain separate. This preparation neither authorizes SQL nor promises that every remaining question can be settled within one native run.

## Original B2a scope and preserved evidence

| Field | This increment |
| --- | --- |
| Data resource | Full original provenance shared only among the three eligible witnessed roster-policy receipts from one capture. |
| Existing path | Sleeper core intake and current restricted SQL receipt owners, stored roster/manager/links/standings readers, ordinary checkpoint/reconciliation/settlement and the existing offline retention calculator. |
| Persisted result | A compatible additive storage candidate with its interner unbound, source tests, four local native cases, an unqualified calculator mode and this report. Matched allocation and a measured forecast remain absent. |
| Proof and gaps | Three owned loopback PostgreSQL attempts applied 65 real migrations and three provisioners over 158 relations. Semantics and binding/security passed in the later attempts; the complete interaction case and allocation remain unqualified. Hosted performance, natural cadence, benchmark geometry and fifteen remaining cost terms also stay unqualified. |

The implementation keeps every original attempt, receipt, acceptance, timestamp, witness and full logical provenance object. Attempts retain their original source_mapping and write_fence JSON. Settings, other resource families and unwitnessed receipts stay inline. Fresh captures keep distinct provenance even when official roster values are unchanged. The accessor accepts historical inline rows verbatim and reconstructs shared rows only after exact immutable binding checks; malformed shared data fails closed. No current head or current mapping substitutes for historical evidence.

Migration 065 is an expansion: existing 001–064 files remain unchanged, with no backfill or retained writer activation. Compatible readers and nine existing SQL consumers are included to preserve ordinary checkpoint, scheduling reconciliation and settlement behavior. Only the owned local test temporarily binds the new interner; mode transitions restore the legacy A writer with B1/B2 interners unbound. Runtime access is limited to the required parent SELECT and accessor EXECUTE; private helpers and account/auth roles remain restricted.

## Baseline and limits

Revalidation on October 20, 2026 confirmed clean local main, origin/main, fresh GitHub main and exact Vercel Ready Current production at 87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f. Deployment 8C3YSnXRCbmPETftQgRtirfyck5e remains bound to clawmachinejed/league-one-audit, root apps/site, production branch main. The existing draft was preserved and original file ownership reconfirmed. This isolated branch started at a820e28; PR318 remains draft, open and unmerged at 168a856ae44e7431393b0a8a9404483dda294ccc. No competing release owner was observed in checked worktrees, draft pull requests and current deployment evidence. This work claims no production-writing ownership.

The local campaign retained its original start, 2026-10-20T14:29:31.142Z, and deadline, 2026-10-20T14:59:31.142Z: 30 minutes, 512 cumulative resource reservations, a 353-reservation allowance per attempt, at most six sessions, two leagues/twenty teams/160 held players total and at most 12,229 catalog rows. The fixture uses 80 unique catalog players. Its planned upper bound is 80 attempted witnessed cores, one catalog and eight additional probe/boundary reservations, totaling 329. There were no provider, private Neon or hosted calls, publication, merge or deployment.

Four appended cases have body budgets of 180/120/120/300 seconds. The module contains 21 cases; the played selector retains original cases 7/8 with 19 filtered. All bodies plus original hooks total 64 minutes before overhead, exceeding the unchanged 30-minute protected cap. The full module remains unqualified; the campaign selected only the four separately bounded B2 cases.

## Superseded two-layout measurement design — not executed

Receipt provenance is the largest repeated metadata field in the accepted A+B sample. Sharing attempt mappings or fences would affect reservation and witness derivation before capture and remains a separate design question. This experiment cannot price the fifteen missing terms or establish their workload frequencies, source inventory, ordinary controls or benchmark geometry.

The planned comparison uses the same expanded schema for A+B and A+B+B2a: two warm and 32 measured cores per layout, four eight-core boundaries and complete heap/index/TOAST/auxiliary allocation. It counts the new parent and receipt-format overhead, all attempts, receipts, acceptances and controls. Whole-core DATA and synthetic controls remain separate; separately projected A/B/B2 savings are never added or counted twice. Required checks include historical read/hash parity, original witness/fence equality, scheduling/settlement and post-wait rejection.

The bounded compression diagnostic inspects existing rows only, recording pg_column_size of composite receipts/attempts and individual columns, pg_column_compression where available and full logical JSON parity. Composite sizes may flatten stored values and do not measure original on-disk insertion tuples or per-row heap allocation. It changes no table storage setting and creates no extra tuning captures. Logical column sizes overlap whole-row and physical allocation; they are not additional savings or reclaimed bytes. The allocation case never started, so none of these planned diagnostics constitute a result.

## Consolidated source validation

The final candidate fixture is frozen at LF SHA-256 7db5ed992af0a299566f284dda822b67bcafffd90e3608d358924944c8ce550d. The current qualification module passes **187 tests with zero skips or failures**; TypeScript, changed-file lint and the repository scope check pass. An independent AST comparison confirms all seventeen original case bodies and all 21 body budgets are unchanged. All 64 accepted migrations, nine historical JSON evidence files and runtime files are unchanged by this consolidation. The full suite was not rerun for these fixture/calculator/documentation changes.

The revised offline calculator passes **87 labeled test-data checks**, preserves six historical CLI outputs byte-for-byte, rejects twelve invalid CLI combinations and leaves accepted B2 pins null. These are source and validator checks; they provide no PostgreSQL, storage or capacity qualification. The separate prospective harness remains an offline proposal with no campaign clock, reservations, credentials, SQL or measurement files created.

## Prior source validation — local commit 3fcca906

Independent review accepted the additive migration, its nine compatible SQL consumers, restricted grants, five reader projections, exact scope extensions and local harness. All seventeen earlier case bodies/budgets and existing migrations remain unchanged. Type checks and changed-file lint passed. The first full unit run recorded 9,624 passes, ten failures and four guarded skips: eight failures came from a fixture digest changing during that run, and two historical-source expectations needed to identify the newly changed readers. Intermediate digest-bound profile failures are preserved. After the final fixture freeze and repin, the qualification module passed all 186 tests. Across unchanged passing files and the affected rerun, 9,634 unique cases pass and four remain skipped; this is not a new single full-suite result. All historical hosted support hashes remain unchanged and continue to reject current-source drift before provisioning.

The offline calculator's final source passed 58 explicitly labeled test-data checks. Six existing CLI outputs remain byte-identical to a820e28, twelve invalid CLI combinations fail closed and nine historical JSON files remain unchanged. Accepted B2 evidence pins remain empty; the new provenance modes reject measurement and forecast generation until accepted native evidence exists. Neither data-backend-cp28-provenance-measurement.json nor data-backend-cp28-provenance-forecast.json exists. Fixture self-tests provide no storage or capacity credit.

## Native attempts and repairs

Every attempt used the real migrated schema and restricted local roles. The table counts only the four selected B2 cases; the seventeen earlier cases were not selected. A case shown as unexecuted is not a passing or skipped qualification.

| Attempt | Passed / failed / unexecuted | Reservations | Cumulative | Outcome |
| --- | --- | ---: | ---: | --- |
| 1 | 1 / 1 / 2 | 39 | 39 | Semantics passed; stale-mapping standings expectation failed. Cleanup verified. |
| 2 | 2 / 1 / 1 | 43 | 82 | Semantics and security passed; deadline callback failed with its original assertion swallowed. Cleanup verified. |
| 3 | 2 / 1 / 1 | 51 | 133 | Semantics and security passed; both deadline probes passed before the interaction case timed out during concurrency. Cleanup verified. |

Attempt 1 incorrectly demanded available standings during a rollback-only administrative mapping advance. The unchanged reader requires current mapping revision and generation, so its exact result is missing/roster_capture_missing. Historical provenance access had already passed under the advance. The fixture now expects that result and verifies restored reader parity after rollback; no runtime repair was needed.

Attempt 2 stopped after the ordinary intake error handler swallowed an assertion from the test callback. The exact first assertion was not retained. Independent database-free reproduction confirmed a fixture defect: a nested Vitest fetch spy retained the capture's two earlier calls and could not pass the historical reader's zero-fetch assertion if reached. The repair moves history verification after capture-spy restoration and preserves callback errors before sentinel matching. Observed-lock, original-deadline, rejection and rollback assertions remain intact.

Attempt 3 passed both original 20-second deadline probes: B1 population insertion waited after B2 provenance insertion, and A identity work waited after the B2/B1 insertions and acceptance lock. Both rejections rolled back the 22-table logical snapshot and retained historical reads. These are partial assertions, not a passing interaction case: the later same-input concurrency section timed out at 120,017.6 ms.

Independent source review found that this concurrency fixture watched the wrong lock. Existing migration 026 locks the exact projection_jobs row before the mapping advisory lock; the existing delegation/witness chain preserves that order. Writers sharing the genuine fence therefore serialize on the job row first. The callback's failed observation was swallowed while the first transaction remained open, leaving ordinary intake cleanup waiting on that row. The final source-only repair observes the exact first PID blocking the second, matched transaction-ID locks and both job-table locks. It releases the first transaction inside callback failure handling before ordinary intake cleanup, preserves the original error and retains the outer rollback safeguard. This proves an intended owner-job serialization observation when executed; it does not claim direct unique-content contention. All replay, receipt, parent, count, deadline and history assertions remain. No implementation change was made for these three fixture repairs.

The frozen source-only repair before consolidation was 31ff1fe56dbf49048bd8f09614e21e3ec6ebcf535e2e5ccfdfad22cd0bd2474b. It is independently source-reviewed and checked by units/types/lint, but has not been executed against PostgreSQL.

| Retained failed fixture | SHA-256 |
| --- | --- |
| Attempt 1 | 6792442867e89275bd743d3242a1b3c60248a2a041197561c6c2f7f5c6c0eb48 |
| Attempt 2 | af0e72fd9f2bf857ab07d1977150d98e3760735e93208e9286bb42228df5bc34 |
| Attempt 3 | fc08ef1a735530ea9daa242cefac7ccde8a1e0912dcad1e27c01ec4f5117ab2d |

Each cleanup verified zero established clients, absent owned PostgreSQL process/listener, removed owned data and both generated credential files, and a clean secret scan of 28 retained files. Third cleanup completed at 2026-10-20T14:49:33.1005360Z, 20 minutes 1.958 seconds after campaign start. Failed fixture sources, logs, accounting and cleanup evidence remain under test-results/cp28-provenance-b2. The campaign ledger's completed entries mean reservation accounting settled, not test success.

After source diagnosis/review, the remaining time could not fit a credible full rerun: the earlier comparable allocation alone took about 233 seconds, before semantics/security/interaction, setup and cleanup. No fourth attempt was prepared or started. The original campaign was not reset or extended; final consumption remains 133/512 reservations. Unused reservations do not extend the elapsed-time limit.

## Outstanding evidence and publication

A future bounded local campaign must execute the final frozen fixture, pass the complete interaction/concurrency case and obtain absolute candidate allocation with verified cleanup. The complete conditional accounting package above is separate from native qualification; its unresolved rates and transfer uncertainty remain visible after a core pass. Only accepted evidence can produce candidate measurement and conditional forecast files. Complete CP28 capacity qualification also requires pricing the fifteen missing family/control/benchmark terms under the unchanged retention, freshness and 10-GiB requirements. Source review and the previous A+B savings cannot substitute for that evidence.

This candidate is local and unpublished. PR318 remains at 168a856; no new CI, preview, hosted, merge or production result is claimed. Historical accepted A+B allocation and forecasts are preserved unchanged.
