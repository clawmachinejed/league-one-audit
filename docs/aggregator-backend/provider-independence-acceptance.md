# Provider independence acceptance and evidence

Version 1.3 — October 21, 2026. Companion to the [remediation plan](provider-independence-remediation.md) and [source inventory](provider-independence-source-inventory.md). Phase 1 specifications and coverage mapping added by reference. Mandatory drift controls and handoffs enforce the existing success criteria; implementation and tests remain unauthorized.

Everything below is a future proof requirement. No application tests, SQL qualification, provider acquisition, performance run, restore, or CP28 execution was performed for this documentation task. A written test requirement is not a passing result.

Phase 1's [shared design](provider-independence-phase1-design.md), [complete first standings specification](provider-independence-standings-design.md) and [all-family coverage map](provider-independence-phase1-coverage.md) apply these unchanged requirements to concrete boundaries and planned evidence groups. Standings preserves qualified partial snapshots and previous complete immutable receipts; a newer failed standings attempt remains unavailable rather than silently showing an older success. This specifies Q07/Q08's existing behavior, not a change to their success criteria. No evidence group below or in the companions is an execution allowance.

## What must be proven

The boundary is complete only when the same shared acceptance, storage and reader path can handle the currently supported common facts from Sleeper and a deliberately different isolated test adapter, while preserving existing Sleeper behavior and integrity protections. The test adapter is not a shipped second provider and proves no live Yahoo/ESPN API, permission, completeness or competition coverage.

The common path must accept truthful source identity and differently shaped evidence. It must not pass the demonstration by renaming a Sleeper response, giving the test adapter fake Sleeper IDs, inserting preaccepted rows, mocking SQL acceptance, or returning hand-built reader DTOs.

Existing guards remain enforceable at their actual privilege/transaction boundaries. No application-supplied `verified` flag, matching hashes, source fixture alone, code scan, or successful TypeScript compile establishes native translation parity or database isolation.

## Test adapter boundary

Use one isolated synthetic provider with deliberately different native field names, opaque external IDs such as `team:ABC-7`, source-specific player namespaces, and a standalone standings response. Its supported semantics must fit the selected existing common contracts; it does not invent new league formats.

It must provide its own normalization and verifier registration through the reviewed test-only path. Its registration is absent/disabled in production. Run it through the same common writer, restricted-role acceptance, relational materialization, accepted-resource readers and common composition as Sleeper. Do not use an owner credential to bypass a missing runtime path.

Sleeper may retain native-verification functions in SQL under the recommended D02 design. The synthetic adapter must use its own verifier; the common path must not demand Sleeper raw keys, IDs, roster receipts, or catalog presence. Runtime direct access to the inner writer must be denied, and codec selection must be tied to the registered source rather than caller-supplied executable names.

No new live-provider acquisition is required merely to prove this abstraction. Valid retained source evidence can support Sleeper parity. CP26's separately scoped live import remains a distinct obligation.

## Eight family round trips

For each row, record the exact field/schema version, actual write entry, verifier, materializer, acceptance receipt and reader. Expected outputs must cover complete values and relevant state/coverage metadata, not just availability or row counts.

| Family | Different-provider demonstration | Sleeper preservation demonstration |
| --- | --- | --- |
| Settings/league | Opaque league identity, differently named native settings, accurate common fields and labelled native extensions | Same league/source identity, retained configuration/scoring semantics, field states, ordered/counted roster slots and original hashes |
| Teams/managers | Reused external ID across providers stays distinct; owner/co-owner/vacancy/unknown preserved | Same canonical people/teams, current and retained ownership relationships, independent commissioner facts and timing |
| Rosters/catalog/links | Provider-specific player IDs, complete-empty and partial membership, unresolved/conflicting links; no dependency on Sleeper catalog | Same native categories/order, membership changes/removals, source directory evidence, canonical player/defense links and historical capture |
| Matchups/lineups/points | Opaque group/team IDs and different native numeric representation; exact common values and source period mapping | Same requested-period isolation, starter/bench order, vacancies, custom zero/overrides, official values and missing states |
| Standings/reports | Standalone native standings source accepted with its actual receipt and complete/partial population evidence | Same roster-derived standings, report facts, decimal precision, rank/record authority and original source bindings |
| Transactions | Different native movement/status/time fields produce truthful common events and extensions | Same event IDs/order, adds/drops/trades, bid zero, statuses, unknown claims, corrections and compatibility payload |
| Drafts/picks | Opaque draft/team/player keys and different selection/ownership structures fit common contract | Same metadata, order, selections, traded ownership/conflicts, future-year reference and immutable link evidence |
| Brackets/history | Different native period/reference labels within supported semantics join common records | Same graph/advancement facts, inventory coverage, source identities, history and explicit unknown finality/applicability |

These rows are a finite coverage obligation, not a command to build every provider/format permutation. Use representative data and reuse a captured fixture where appropriate. Common helpers can share coverage, but every materially different writer/trigger/materializer must have an identified proof; a successful roster path cannot qualify an unrelated draft trigger.

## Shared guard requirements

| ID | Required behavior and adverse case | Evidence needed |
| --- | --- | --- |
| Q01 Contract and policy | All eight family outputs have explicit semantics; unknown provider/codec/schema versions reject without implicitly enabling a connector | Reviewed field/owner map; positive and negative execution against actual dispatch/acceptance |
| Q02 Verification cannot be bypassed | Runtime cannot call inner canonical writer, replace codec policy, or submit mismatched native/canonical facts via an unverified route | Actual restricted LOGIN/role denials; correct adapter entry succeeds; same raw capture with altered canonical meaning rejects where independent parity is specified |
| Q03 Source identity | Identical native IDs in different providers/namespaces/leagues remain distinct; canonical mappings persist | Actual registration/lookup/readback with deliberate collisions and wrong-provider selectors |
| Q04 Scope and authority | Wrong league, season, entity, period, audience, connection or mapping cannot become accepted | Actual SQL negatives and unchanged affected heads/history; parsed identifiers alone grant nothing |
| Q05 Translation and materialization | Native-to-canonical parity uses the registered verifier; typed relational output exactly matches accepted canonical payload | Retained native input, expected canonical facts, full relational readback, field/child mutation negatives; distinguish current transaction assurance from stronger-family checks |
| Q06 Evidence binding | Swapped raw/canonical content, hashes, capture, receipt, attempt, codec/version or source timing cannot be accepted | Exact binding negatives; original evidence remains unchanged; recorded hash convention respected |
| Q07 Field states and coverage | Missing/null/empty/zero/invalid/unknown remain distinct; partial evidence does not erase last-good complete data | Representative family states, explicit coverage/reasons, authoritative removal only with complete scoped evidence |
| Q08 Corrections and ordering | Changed facts create correct immutable versions; stale/equal-time conflicts do not silently regress heads | Original/corrected retained reads, wrong-order writes, conflict outcomes and unchanged original records |
| Q09 Replay and sharing | Duplicate request/replay does not invent identities/observations; unchanged fresh capture preserves independent evidence; content sharing does not merge receipts | Before/after IDs, contents, observations, receipts, heads and timestamps; collision/equality semantics |
| Q10 Ownership and atomicity | Expired/superseded worker or wrong attempt cannot accept after lock wait; failed materialization rolls back the whole affected acceptance | Actual separate-session contention/fence proof for changed owner paths; rollback readback; reuse existing harness |
| Q11 Permissions | Public/runtime/account/auth privileges and source/audience boundaries remain appropriate; helper invocation cannot escalate | Fresh candidate object/grant inventory and actual restricted-role checks for changed privilege routes |
| Q12 Legacy coexistence | Old and new records remain readable through recorded versions; no implicit history rewrite or false reacquisition | Mixed-format histories/current pointers; exact original hashes/times; unavailable version fails explicitly; disable keeps accepted data readable |
| Q13 Network ownership | Common SQL/readers make zero provider requests; compatibility decode is local; comparison does not refetch the same source | Instrumented network tripwire, actual reader path and acquisition accounting; preserve allowed application page fallback separately |
| Q14 Existing consumers | League One/Two isolation, routes, payloads, selection, freshness/fallback and browser refresh behavior remain | Existing relevant source/browser regression workflow at final candidate; actual preview when release preparation requires it |
| Q15 Shared projection/runtime seams | Single worker/scorer/cache/builder/publication, `clock-v1`, frozen baselines, observer limits and original source budgets remain | Diff/dependency review plus targeted integration checks at touched seams; no automatic rerun of unrelated historical campaigns |
| Q16 Migration and disable | Additive install order, legacy accessors, rollback compatibility window and selected-version disable behave as specified | Actual isolated candidate installation/read-write compatibility; disable/drain/fence scenario; old/new reads after stopping new writes |

Q01–Q16 are proof obligations, not sixteen automatic paid runs. Several can be covered in one existing fixture; some materially distinct paths need separate assertions. Freeze the case-to-Q/family mapping before execution. Do not count an unexecuted assertion, skipped case or owner-seeded accepted row as satisfying an obligation.

## Minimum execution manifest

Each future authorized qualification proposal must contain:

| Field | Required content |
| --- | --- |
| Purpose | Specific R/F/Q/family requirements being proven and those explicitly excluded |
| Source | Full commit/tree, exact ordered migrations, fixture/support pins and selected version/codec policies |
| Environment | Existing isolated project/base identity, PostgreSQL version, actual restricted roles, sentinel/TLS/denylist and harness ownership |
| Dataset | Providers/identities, leagues, teams, player population, periods, facts/states and genuine versus synthetic evidence |
| Cases | Frozen names/order, expected outcomes, mapped guard/family obligations, permitted setup and cleanup; no direct seeding of acceptance under test |
| Commands | Ordered commands, their nested stages, environment/configuration and planned SQL profiles; identify repeated work and any conditional default-suite invocation before execution |
| Limits | Maximum time, calls, concurrency, spend, attempts and cleanup deadline; original safety guards retained |
| Failure policy | Stop at declared limit, preserve report/denominators, no automatic retry/reset or substitution of easier samples |
| Evidence | Full passed/failed/skipped/executed inventory, source versions, network/SQL accounting, semantic readback and integrity results |
| Cleanup | Child closure, schema cleanup, credential revocation and branch removal through existing acknowledged lifecycle; unresolved outcomes explicit |
| Review | Independent implementation/result review and bounded carry-forward rationale |

No profile, deadline, spend or case count is authorized by this documentation. Use the smallest existing qualification grouping that covers the changed dependency paths. If the necessary proof cannot fit current limits, expose that concrete limitation before proposing execution; do not quietly extend a campaign.

## Three-phase delivery and evidence order

This follows the remediation plan's [three-phase delivery](provider-independence-remediation.md#three-phase-delivery). The phases change work order and verification frequency, not the eight family or Q01–Q16 requirements. Slices are development increments, not separate release authorizations. All implementation and execution remain subject to their applicable authority; any actual merge still requires the complete repository verification and other applicable release checks before that merge.

1. **Shared decisions and complete inventory.** Independently review D02, the common acceptance and verifier boundary, source identity/namespaces, version/hash policy, source base and migration lineage, and legacy-read/disable compatibility. Inventory all eight families, their actual entry points, storage objects, roles, guards and dependencies; map every required assertion to R/F/Q/family and its intended evidence. Resolve decisions that constrain later slices and review the first slice's complete specification before phase 2 code. This establishes shared-design and first-slice readiness, not completion of every family specification or all of R1.
2. **Complete family slices.** Before coding a family, complete and review its field/state/coverage contract, native-verifier ownership, exact functions/triggers/materializers, grant/lock/transaction boundaries, legacy compatibility and write-to-read acceptance cases. Implement and qualify that family's complete adapter → acceptance → stored-reader path. Start with a standalone standings slice to expose the current roster-receipt dependency, then catalog-independent player links; resolve their required common dependencies within those slices. Continue the remaining families without building disconnected write-only layers. Obtain early actual restricted-role SQL proof for the first slice, rather than deferring SQL until all families are implemented. R6 tracks evidence and dependency impact throughout. R1 remains partially open until every family's full specification is complete and reconciled.
3. **Final integrated qualification.** Reconcile all slice specifications, shared changes, migration/privilege lineage and R/F/Q/family evidence against one stable integrated candidate. Complete required repository verification, CI and actual preview checks, plus affected SQL/compatibility proof. Obtain CP26–29's distinct final-source operating/recovery evidence under their respective scopes and authority; assemble CP30. No prerequisite is silently declared complete by R6. Separately authorize and record CP31 installation, CP32 merge, CP33 exact deployment/activation and CP34 production readback/natural refresh.

An early slice pass proves only its recorded scope and source. Later shared changes must be checked against completed slices before their evidence can support the integrated candidate. Exact source-verification and isolated-qualification ordering follows the existing required workflow; a skip or preview fallback never substitutes for database proof.

## Streamlined testing policy

This policy is mandatory under the plan's [drift controls](provider-independence-remediation.md#mandatory-drift-controls). Every added or repeated check must have a recorded requirement, dependency, failure or required-workflow reason in the existing coverage/execution record. That traceability does not create a new owner-approval gate for routine checks already authorized within scope.

During authorized development, run targeted meaningful checks for changed contracts, adapters/verifiers, SQL and compatibility paths. Stop repeating passing checks unless a relevant code/dependency change, failure, unresolved concern or required workflow obligation justifies them. Use one deliberately different synthetic adapter and valid retained Sleeper fixtures; do not create extra providers, refetch unchanged evidence or rewrite the test framework to prove this boundary.

Freeze the assertion-to-R/F/Q/family map before each qualification. Group compatible cases in a reviewed bounded profile within the existing supervisor so they share provisioning and setup where identity isolation, state prerequisites, source order and cleanup allow it. Do not merge frozen historical profiles, bypass their closed selectors or assume a previous run supplies fixture state in a fresh database. A shared fixture can cover several obligations; execution and cleanup totals must still show exactly what ran.

Prove a shared guard deeply once for its actual implementation and privilege boundary, then prove that every affected entry point invokes it and cannot bypass it. Retain separate proof for materially different functions, triggers, roles, locks, post-wait fences, transaction paths and legacy readers. Similar names or common helper imports do not establish equivalent behavior. Complete family readback and relevant adverse cases remain required.

Inventory scheduled commands and environment before execution. [`verify:full`](../../apps/site/scripts/full-verify.mjs) already calls `verify`, both browser suites and, when integration control configuration is present, the default SQL suite. Do not schedule an identical `verify` immediately before it on unchanged source. Account for configured SQL explicitly; do not silently disable configuration, skip guards or replace a required full gate with a selected profile. Public and account browser builds have different environments and source-provenance requirements; their builds are not removable duplicates by default. Any future build reuse needs its own reviewed provenance-preserving change.

Run the complete required workflow on the stable final candidate; retain required CI and actual preview evidence. Do not add repeated local full runs or blanket historical campaign reruns merely because a stage finished. Earlier results keep their original source binding, and the carry-forward table below determines affected requalification. No elapsed-time saving is claimed without measurement.

Keep CP26, CP27, CP28 and CP29 measurement purposes, populations and denominators separate. Shared test setup cannot contaminate a storage baseline, turn fixture setup into import timing, replace actual restoration, or convert a boundary pass into performance proof. Preserve existing cadence, budgets, deadlines, role/identity guards and acknowledged cleanup; CP28 remains frozen. No automatic retry, deadline extension or easier replacement sample follows from a failure. Preserve failed evidence, diagnose the cause and obtain the applicable next-attempt authority. If required proof cannot fit the bounds, report that specific limitation rather than expanding the campaign.

## Evidence carry forward table

| Existing item | Preserve/reuse | Requalify when affected |
| --- | --- | --- |
| Native fixtures and observed facts | Captured representations, source times, hashes and historical interpretations | New normalization/verifier output and field coverage; no unnecessary new fetch |
| Stable canonical IDs/mappings | Existing identities and relationships | Namespace/provider collisions, changed selectors, source/audience mapping |
| Legacy codecs and receipts | Exact version semantics, old histories and accepted bounded results | Compatibility after shared contract/accessor/function changes |
| SQL guard tests | Original source-specific results | Changed input/signature, grants, wrappers, verification, acceptance or post-wait behavior |
| CP21 installation proof | Original 56-migration installed result | Final candidate's actual later objects/roles; reconcile in CP30, do not erase historical CP21 credit |
| CP26 proof/diagnostics | Narrow approved scope, real failures and valid retained fixtures | Final import/replay/ownership path and legitimate pre-draft state handling |
| CP27 diagnostics/query mix | Diagnosed failures and relevant query inventory | Final joins, payload shape, compatibility decoding, plans and composed latency |
| CP28 historical A/B measurements | Actual original observations, semantics, byte deltas and assumptions | Final source, row/receipt/content model and any cost coefficient affected by canonical changes |
| CP28 frozen B2 proposal | Exact source/plan/receipt and unexecuted status | It has no executed credit; changed candidate requires a separate bound proposal |
| Unchanged projections/accounts | Existing source and scoped independent evidence | Only actual touched interfaces/dependency seams; no invented broad retest project |
| Recovery | Any actual original schema-specific proof | Final schema/identity/history/heads and both legacy/canonical readers |

Carry forward is not relabeling an old run as a new pass. Record dependency closure, including invoked SQL functions, grants, codecs, policy versions and fixture/harness dependencies. Changed behavior at any of those boundaries invalidates the affected proof, even when consumer bytes are identical. Preserve unrelated evidence with an explicit unchanged-dependency rationale; do not restart every historical campaign. New fixtures or measurement conditions also require a new source-bound claim. Documentation changes alone do not invent a runtime failure or turn an old run into current-SHA qualification.

## Existing checkpoint measurements remain distinct

| Checkpoint | Required outcome retained | What the boundary proof does not establish |
| --- | --- | --- |
| CP26 | Narrow complete 1–4-league useful current import within60 seconds, same-request replay and specified current-batch recovery | Sustained fleet freshness, full-history throughput, prolonged outage recovery or endurance; these were deferred |
| CP27 | Actual composed stored-reader query/correctness/latency evidence at its declared workload | Real import speed or future fleet capacity merely because isolated reader cases pass |
| CP28 | History preservation and measured/projected growth for a declared final schema/workload | All-family capacity from four core cases or 41×12 capacity from the old two×20 fixture |
| CP29 | Actual isolated restore/replay and recoverable history/read service | Recovery from immutable rows alone, successful disposable cleanup, or provider re-fetch |
| CP30 | Coherent reviewed source/migration/privilege candidate and installation/disable/recovery plans | Permission to install, merge, deploy or activate |

The 41×12 planning population must be completed with observed/declared roster population, churn, cadence, histories, corrections, drafts and query mix before a meaningful capacity claim. Old 10 GiB calculations remain source-bound historical scenarios. A new budget or workload change must be explicit and cannot justify data deletion by default.

## Completion and reporting template

Use the following statements only when their evidence exists:

- **Shared-design ready:** common boundary decisions, source/migration lineage, all-family inventory and assertion/evidence map independently reviewed; R1's unfinished family specifications explicitly listed.
- **Slice-design ready:** one named family's complete field/object/guard/grant/verifier/compatibility specification reviewed before its code; shared prerequisites and required acceptance cases identified. This is not full R1 completion.
- **Full R1 complete:** every family specification and shared decision reconciled and independently reviewed; no required field, object, privilege, compatibility or ownership decision remains open.
- **Implemented locally:** exact source changes complete; targeted checks reported with failures/skips; no implication of SQL/hosted readiness.
- **Boundary qualified:** all eight family rows and Q01–Q16 mapped to accepted source-bound proof, with original native/legacy compatibility preserved and no open required failure.
- **Operational checkpoints:** CP26,27,28,29 recorded separately against their actual approved objectives and final dependencies.
- **Release candidate ready:** CP30 requirements complete; later action permissions and states remain separate.
- **Installed/merged/deployed/activated/production verified:** report each only after its own CP31–34 evidence.

These statuses require the plan's [mandatory drift controls](provider-independence-remediation.md#mandatory-drift-controls). Before declaring an increment complete, reconcile its actual file/object, permission and behavior changes with its specified scope, and map required outcomes to their evidence. Missing evidence, an unexplained change, an unresolved material deviation or an incomplete handoff prevents the completion claim. This enforcement adds no new runtime success criterion and does not authorize a test or release.

## Mandatory four-point handoff

Every increment close, phase close, task transfer, and stop/interruption must use exactly these four numbered reporting categories. A partial or failed increment still reports all four. Routine progress updates need not repeat them. If interruption prevents a handoff, reconcile it at the next resume before dependent work continues.

1. **Agreed requirement:** Identify the applicable R/F/Q and family requirements, expected result, scope limits, protected behavior, plan version and existing execution authority.
2. **Actual change:** Describe what changed and why, including affected files, database objects, permissions or behavior. Record the exact branch/commit/tree and relevant migration, contract, plan or receipt versions. If work is uncommitted, identify that state and the exact reviewed diff or artifact rather than implying the commit includes it. State the actual completion stage.
3. **Evidence:** Map completed requirements to source-bound evidence. Report passed, failed, skipped and unexecuted checks, their environment and limitations. Identify carried-forward evidence with its original source and reuse rationale; reviewing an old result does not create a new pass. Documentation-only work reports document review separately from unexecuted runtime proof.
4. **Unresolved items or deviations:** List remaining failures, missing evidence, deferred requirements and departures from the agreed scope. Record each dependency decision and its resolution, consumed and unused execution authority, and the next bounded action with whether existing authority covers it. State “none” where appropriate; an empty category must not imply completion.

The responsible agent must provide the handoff, and required independent review must check its scope/evidence reconciliation. Proceed with routine work inside existing authority; apply the plan's decision rule before a material scope, architecture, cost, limit or success-criterion change. Do not use an unexplained percentage-complete figure. A new finding must identify its affected requirement and cannot silently move the finish line or invalidate unrelated completed work. CP28 remains frozen.
