# Candidate design review and open completion gates

**Current verdict: design gate open.** The [fresh literal-method audit](literal-method-audit.md) supersedes the earlier G1–G5 closure claim in this record. Reviewed artifacts exist, but the ER diagram, end-design DDL specification, shared request admission, its guarded account-to-worker interface and failure-safe live command authority overlap remain missing selected design outputs. The corrections and open evidence are enumerated in the audit.


Design revision: **first-slice-design-v1**, 2026-10-06 UTC. Reviewed application baseline: `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`; starting documentation commit: `473e32e`. The exact deliverable commit is recorded by its Git/PR and portable manifest, avoiding a self-referential commit identifier inside the commit. [README](README.md) remains the sole entry point.

This record preserves the candidate design and earlier review history. The fresh audit corrected additional contradictions and reopened missing design outputs. The [181-row inventory](methodology-steps.md) now distinguishes literal source activities, authored evidence and remaining work. No installed enforcement, completed method or industry certification is implied.

## Design gate evidence

| Gate | Candidate artifact evidence | Remaining design / qualification |
| --- | --- | --- |
| G1 — requirements and verification plan | [108 atomic obligations and independent procedures](requirements-traceability.md), approved-need anchors, existing owner allocation, concrete design elements and forward/reverse coverage of all 135 fields, 26 record constraints, 25 named types and 22 acceptance families; explicit later-need and product-decision dispositions | Procedures are specified, not executed. Product/user validation, empirical source completeness and implementation results remain G6/G7 |
| G2 — composed behavior | [State, context, trust, interface and sequence models](behavior-security-design.md): independent state dimensions, 18 transitions, five composed scenarios, precise inputs/guards/commit boundaries/failures/recovery and the final stored-delivery protocol | Actual end-to-end service, competing transactions, role enforcement and request-byte behavior remain G6 |
| G3 — architecture quality and decisions | [12 refined quality scenarios, eight alternative decisions and residual risk owners](quality-operations.md), including expiry, races, sharing, partial data, recovery and later capacity | Priorities derive from approved needs; no stakeholder workshop, voting, performance measurement or new SLO is represented as completed |
| G4 — logical and physical design | [Relational design](relational-design.md) and [structured model](relational-design.json): logical keys/FDs/decompositions, explicit document/projection exceptions, cardinalities and scope integrity, all 135 storage/derivation mappings, candidate constraints/indexes/functions/grants, mutator inventory and lock schedules | **Open design:** ERD, exact DDL, shared acquisition admission/interface and server-enforced auth/account command overlap. Later real catalog, hostile-role/concurrency/crash, conflict, query-plan and migration evidence remains G6/G7 |
| G5 — security and operating evidence | [13 changed-surface controls and 15 adversarial oracles](behavior-security-design.md), selected versioned ASVS references with exclusions and residual risks; [typed diagnostic contract, retention ceiling, six operating procedures and transition/rollback plan](quality-operations.md) | **Open design:** aggregate acquisition admission and failure-safe live command authority. Later effectiveness, sink permissions/expiry/detection, recovery, user journeys and release evidence remains G6/G7 |
| G6 — implementation qualification | Test methods, fixtures, oracles, writer schedules and guarded-harness entry conditions are specified | **Open: target runtime implementation and execution have not occurred** |
| G7 — transition and operation | Migration/cutover/rollback/observability/release plan is specified, with explicit stop conditions and authority boundaries | **Open: no target activation, migration execution or production release has occurred** |

G1–G5 describe candidate artifacts with the current open gates above; they are not fully closed. G6/G7 cannot be closed by document checks, simulated SQL or a clean build of the unchanged application. D03 exclusive-claim recovery remains a public activation gate; D04 loss/regain follow behavior and D05 last-follower collection/retention remain gates for their affected behavior. Internal design/qualification does not silently resolve them.

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

Run both offline checkers from the repository root:

```text
python docs/aggregator-backend/verify_foundation.py
python docs/aggregator-backend/verify_design.py
git diff --check
```

The generated analysis states exact current counts. Key closure and lossless-decomposition checks are mathematical analyses of the declared finite model. Source anchors are literal evidence-location checks. Neither proves that an omitted real-world dependency is absent; the independent semantic review is separate evidence. No environment files, database credentials, production data or provider calls are needed.

Publication/preview/CI status is recorded separately in [verification](verification.md) and the portable completion receipt. The ordinary application checks, if run by PR CI, validate the unchanged application; they do not execute the new target procedures. The original external Ground up folder stays preserved, and a new exact committed portable snapshot supersedes earlier review snapshots without rewriting them.
