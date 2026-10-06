# Backend planning and design gate evidence

**Current status: full planning allocation and first-slice design review complete at the stated scope.** Full planning scope is 69 obligations across 20 domains with 16 existing owner roles,16 need anchors,11 selected decisions and 7 implementation milestones. These are allocations of the known approved scope, not a certification that all future requirements or implementation defects are known.

The earlier literal audit correctly identified missing first-slice ERD, structural DDL, provider admission, durable account-to-worker interface and safe command authority lifetime. Those design artifacts are now supplied. The user explicitly delegated outstanding policy decisions; D03-D05 are selected in [backend-decisions.md](backend-decisions.md), with original evidence preserved. [The full build plan](backend-build-plan.md) states exactly which later outputs and empirical evidence remain missing and why.

## Design gate evidence

| Gate | Current planning/design evidence | Remaining work |
| --- | --- | --- |
| G1 — needs and verification plan |108 detailed first-slice requirements/cases plus 69 full-build obligations; source, owner, data meaning, decision, phase, dependencies and acceptance allocation | Later slice detailed requirements/fields remain mandatory BC-M2/3 outputs; target procedures unexecuted |
| G2 — behavior and interfaces | State/trust/transition models, private pending identification, same-transaction receipt guard, closed command/progress/worker interfaces | Implement and execute normal, hostile, crash and recovery paths |
| G3 — quality and policy |12 first-slice scenarios; D03-D05 and ENG01-ENG08 chosen; measurable freshness/read/restore targets, bounded demand and retention, explicit capacity deficit and cost/source gates | Empirical capacity/cost, intended-use validation, staffing, source license and commercial quota |
| G4 — data and transaction design | Four detailed ER diagrams;44 declared logical relations;22 proposed table definitions and 9 existing-table adaptations; exact helper/privilege/guard contracts and field mappings | Actual PostgreSQL parsing/install/role/constraint/NULL/lock proof and later family schemas |
| G5 — security and operating plan | Same committing transaction owns authority; owner-authenticated operator disable/revoke; global admission and per-actor limits; threat/control/oracle/retention/observability plans | Implemented effectiveness, real-role hostile tests, all-callsite convergence and operating drills |
| G6 — implementation qualification | Exact case plans and guarded isolated harness conditions | **Open: target runtime, executable helper bodies/migrations and execution results are absent** |
| G7 — transition and operation | Full mixed-load, migration, rollback, backup/restore, privacy and release sequence | **Open: no target migration, production configuration, merge or release performed** |

## Three-pass review and corrections

| Pass | Independent comparison | Findings and disposition |
| --- | --- | --- |
|1 — scope/requirements | Approved mission, handoff, current consumers and lifecycle against full coverage | Added full official/analytics families, prior-season coverage, privacy export/deletion/disposal, visible latency and operating ownership;69 obligations now allocated |
|2 — design/security | Foundation, relational model, baseline auth source, admission, policy and operating text | Replaced separate-transaction authority with same-B locks; durable scoped admission; restored seven-day diagnostic ceiling; recovery/import demand cannot keep routine polling alive; pending handle equals identify demand ID |
|3 — adversarial structural review | Actual baseline migrations versus proposed SQL/ERD/helper privileges, plus failure schedules | Found final NOT NULL/scoring changes only in comments, ambiguous composite UK labels and blocked operator disable/revoke under a universal user-session guard. Final structural ALTER statements, composite annotations and owner-only operator helpers now replace those defects; independent correction review and offline checks confirm the saved specifications |

Mechanical checks are a separate aid: declared key/FD/decomposition analysis, source/hash/link/field consistency and full planning allocation/budget/schema inventory. They cannot substitute for the independent findings above. No PostgreSQL parser was available in the current runtime; the design SQL was not executed. All target runtime cases remain unexecuted.

## Historical earlier review record

The following earlier review describes previous revisions. Its historical reopened-gap statements are superseded by the current table above, the selected decision register and the final full-build verification receipt. It is retained to preserve why the earlier completion claim was corrected.

## Review method and corrections

Three specialist agent perspectives worked independently on requirements/method coverage, domain/relational design, and behavior/security. The primary reviewer reconciled their work, inspected the actual source constraints and challenged semantic dependencies. Cross-review then checked companion artifacts. These are documented agent reviews, not three human approvals, a facilitated SEI workshop or a penetration test.

| Review finding | Concrete correction | Evidence and limit |
| --- | --- | --- |
| Current account source SELECT grants cannot perform the proposed shared row locks; current provisioning rejects unlisted privileged helpers | Select narrow fixed-signature owner helpers, exact actor/scope contracts and role-manifest changes; retain separate auth/account roles and no direct shared-source UPDATE | Existing provisioning and auth/account transaction source inspected; actual grants/function bodies require G6 |
| Independent auth/domain reads and local wall clocks cannot establish one coherent final allow | Select guarded auth admission/session plus ordered domain locks, same verified DB/clock domain, one final DB clock sample and conservative pre-serialization expiry budget | Explicit writer order, transaction boundary, deadline and failure schedules; no runtime linearizability claim |
| A newly committed removal or newly qualified policy head could evade a list of old immutable receipts | Persist a positive connection authorization generation; all applicable writers lock/bump it, retain adverse/supersession evidence and reevaluate the full set | `MembershipDependency.authorityFence` now names the exact proposed connection/generation; absent is never zero |
| A qualified lookup capture determines its one manager identity; the proposed compound key hid that dependency | Correct the logical key, capture uniqueness and related semantic dependencies; analyze denormalized context explicitly | Independent domain review plus attribute-closure checks, not just ID consistency |
| Requirements initially lacked explicit allocations for privilege helpers, origin/input controls, private responses and operations | Expand to 108 requirements with fixture/procedure/oracle, model allocation and security/quality/operations crosswalks | Every declared field/constraint/type/family covered; no claim that numeric coverage proves complete user intent |
| Log outcome combinations, numeric domains and sink-failure fallback were underspecified; several scenario FS links were wrong | Exact per-event outcome/reason/field combinations, BIGINT strings, safe integer domains, bounded nonrecursive failure counter and corrected case links | Independent rereview; real host access and seven-day maximum expiry require G7 |
| A checker could pass before readable relational evidence existed and did not validate model links | Require readable artifacts/anchors and model allocations; analyze key sufficiency/minimality and declared decomposition losslessness/dependency preservation | [Reproducible model analysis](design-analysis.md); counterexample probes and actual artifact drift checks recorded separately |

The new audit found design conflicts despite the earlier review. Confirmed corrections are recorded separately from still-missing outputs; no unresolved design issue may be hidden behind a pending runtime test. Runtime tests remain for empirical properties of a selected design: actual SQL permissions/NULL semantics, lock ordering/phantoms, timeout/abort behavior, current provider completeness, source budgets, operational retention and migration data. Their responsible roles and failure gates are explicit in the companion artifacts.

## Earlier finding disposition

| Earlier findings | Current resolution |
| --- | --- |
| M01, M10 — requirements and V&V coverage | G1 ledger, exact allocations and independent case procedures now exist; execution remains G6 |
| M02 — composed behavior | G2 context/state/sequence/transition models now exist |
| M03 — quality tradeoffs | G3 scenarios, alternatives, sensitivity and residual risks now exist |
| M04, M05, M14 — identity/dependency/null defects | Earlier contract fixes preserved and allocated to explicit obligations/oracles; actual behavior remains G6 |
| M06, M07 — adverse evidence and coherent authority | Candidate persisted fence and transaction/privilege protocols are recorded; the fresh audit reopens command authority overlap and acquisition admission at G4/G5 before real G6 race proof |
| M08 — relational design | Logical and physical responsibility models, normalization exceptions, invariant enforcement and additive change inventory now exist |
| M09, M11 — threat/control and operating evidence | G5 threat/authorization/control plan and typed operating evidence now exist; effectiveness and operation remain G6/G7 |
| M12 — stale migration prose | Earlier supersession correction retained; actual migration authoring remains a later implementation task |
| M13 — missing explicit entry gate | README/reconciliation now use this reviewed design baseline and retain separate implementation/activation gates |

## Published basis and tailoring

The current [181-row method inventory](methodology-steps.md) distinguishes 171 source-linked NASA, QAW, ATAM, textbook and SSDF entries from 10 local database categories. Artifact-based design activities can now be documented; meetings, stakeholder commitments, organization-wide processes, implementation, verification, transition and operational work retain honest partial/deferred/unassessed status where evidence is absent. Counting a row is not passing it.

The method follows the [NASA logical-decomposition process](https://www.nasa.gov/reference/4-3-logical-decomposition/) and [verification/validation matrix guidance](https://www.nasa.gov/reference/system-engineering-handbook-appendix/), [SEI QAW](https://www.sei.cmu.edu/library/quality-attribute-workshop-collection/) and [ATAM](https://www.sei.cmu.edu/library/atam-method-for-architecture-evaluation/), and the [database design lifecycle](https://opentextbc.ca/dbdesign01/chapter/chapter-13-database-development-process/). Security references are pinned and scoped in the [behavior register](behavior-security-design.json); SSDF remains 1.1 final in the audit profile. Full paid ISO clauses were not read, so no clause-level ISO conformity is asserted.

## Verification and delivery boundary

Run all three offline checkers from the repository root:

```text
python docs/aggregator-backend/verify_foundation.py
python docs/aggregator-backend/verify_design.py
python docs/aggregator-backend/verify_backend_plan.py
git diff --check
```

The generated analysis states exact current counts. Key closure and lossless-decomposition checks are mathematical analyses of the declared finite model. Source anchors are literal evidence-location checks. Neither proves that an omitted real-world dependency is absent; the independent semantic review is separate evidence. No environment files, database credentials, production data or provider calls are needed.

Publication/preview/CI status is recorded separately in [verification](verification.md) and the portable completion receipt. The ordinary application checks, if run by PR CI, validate the unchanged application; they do not execute the new target procedures. The original external Ground up folder stays preserved, and a new exact committed portable snapshot supersedes earlier review snapshots without rewriting them.

Final protocol review also corrected cross-command join idempotency, duplicate send-capable permits, retry reconstruction from a hash, fresh source-attempt reservation and late429 feedback. Immutable typed request context and once-only feedback refinement now have matching contract, model, SQL and diagram fields. The remaining helper bodies and real interleaving proof belong to implementation; no target runtime case was executed.
