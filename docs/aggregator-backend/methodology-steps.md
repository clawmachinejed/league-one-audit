# Complete inventory for the selected audit profile

The [dated audit](methodology-audit.md) preserves the original findings and defines G1–G7. This is the current disposition of the selected profile after the bounded design work; it supersedes stale artifact-missing statements in that historical audit, without rewriting its evidence. IDs refer to published activities; labels are short paraphrases. Each row is an assessment of this proposed backend slice, not an organization-wide conformity result. Every selected activity has a disposition; none is silently skipped. Status is **documented** (bounded artifact exists), **partial** (incomplete evidence), **gap** (required design artifact absent), **deferred** (later implementation/activation), or **unassessed** (evidence outside this review). No status means a runtime test passed.

G1–G7 are defined in the audit. Evidence abbreviations: **C** = [contracts](contracts.md), **F** = [field register](foundation-fields.md), **R** = [reconciliation](reconciliation.md), **V** = [verification](verification.md), **H** = [preserved handoff](evidence/backend-workspace-handoff.md), **P** = [policy register](evidence/backend-policy-register.json), **T** = [atomic requirements and bidirectional trace](requirements-traceability.md) and its [JSON ledger](design-requirements.json), **B** = [behavior/security design](behavior-security-design.md), **L** = [selected relational model](relational-design.json) and [relational rationale](relational-design.md), **Q** = [quality decisions and operating evidence](quality-operations.md). A citation supports only the specific statement in its row. Documented means that the bounded artifact exists; it does not mean a workshop, stakeholder vote, deployed control or executable test passed.

## NASA: 17 processes, 97 detailed activities

Published basis: [design processes §§4.1–4.4](https://www.nasa.gov/reference/4-0-system-design-processes/), [realization §§5.1–5.5](https://www.nasa.gov/reference/5-0-product-realization/) and [technical management §§6.1–6.8](https://www.nasa.gov/reference/6-0-crosscutting-technical-management/). Coverage is each numbered activity under each process's `.1.2` subsection; inputs, outputs and general discussion are context rather than additional counted activities. Implementation and management processes are iterative, not a requirement to force a waterfall lifecycle.

### 4.1 — Stakeholder expectations

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-4.1.1.2.1 | Identify roles | partial | R and Q name manager/co-manager, product, data, security, operations and review concerns. Actual stakeholder representation/commitment confirmation is not inferred. |
| NASA-4.1.1.2.2 | Understand needs | partial | H/P approved needs are atomized and traced in T with explicit exclusions. No new interviews or direct stakeholder validation occurred. |
| NASA-4.1.1.2.3 | Frame outcomes | documented | README/H establish shared portfolio, official authority and bounded first slice; capacity stays a target. |
| NASA-4.1.1.2.4 | Operating concept | documented | B state/sequence/transition models and Q manager/operator scenarios describe normal, degraded, recovery and preservation behavior for the internal slice. |
| NASA-4.1.1.2.5 | Check statements | documented | T specifies 108 individually falsifiable obligations, source anchors, rationale and literal verification oracles; this is a reviewable design artifact, not executed validation. |
| NASA-4.1.1.2.6 | Outcome measures | partial | T and Q define invariant outcomes and D02 boundaries. Scale/latency measures have a later measurement plan; no new percentile SLO or measured target result is claimed. |
| NASA-4.1.1.2.7 | Trace expectations | documented | T provides forward/reverse approved-need, field, constraint, case and selected-model allocation; every deferred approved need has an explicit disposition. |
| NASA-4.1.1.2.8 | Obtain commitments | partial | P preserves actual D02 approval. D03–D05 remain open; engineering selection does not invent stakeholder approval or workshop commitments. |
| NASA-4.1.1.2.9 | Baseline expectations | documented | H/P retain approved evidence with hashes and explicit scope; new policy remains gated. |
| NASA-4.1.1.2.10 | Retain artifacts | documented | V records immutable input copies, baseline and source hashes. |

### 4.2 — Technical requirements

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-4.2.1.2.1 | Bound behavior | documented | T allocates bounded behavior, interfaces and constraints to existing owners and selected model elements; B composes the trusted boundary and transitions. |
| NASA-4.2.1.2.2 | Derive obligations | documented | T supplies atomic IDs, exact source anchors or engineering rationale, scope, owner, field/constraint allocation and verification evidence requirements. |
| NASA-4.2.1.2.3 | Check wording | documented | T provides independently stated fixtures/procedures/oracles; design review challenges singularity, false completeness and policy wording. Runtime execution remains G6. |
| NASA-4.2.1.2.4 | Validate requirements | partial | Source/approval consistency and paper intended-use/degraded walkthroughs are reviewable in T/B/Q. Direct manager/operator validation and source qualification remain G6/G7. |
| NASA-4.2.1.2.5 | Engineering measures | partial | T/Q define exact invariant measures, deadline ceilings and later delay/capacity measurement. Actual engineering performance values remain unmeasured. |
| NASA-4.2.1.2.6 | Baseline requirements | documented | The versioned local selected design includes the atomic T baseline and G1–G5 artifacts. Publication, implementation and release qualification are separate gates. |
| NASA-4.2.1.2.7 | Retain requirements | documented | Canonical JSON, generated view and Git history retain the current bounded contract. |

### 4.3 — Logical decomposition

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-4.3.1.2.1 | Model behavior | documented | B specifies orthogonal states, five composed sequences, 18 transition contracts and BS-P01 final-delivery guards, failures and recovery. |
| NASA-4.3.1.2.2 | Allocate and reconcile | documented | T links requirements to existing owners, fields, storage, transitions, controls and quality decisions in both directions; L and B reconcile transaction boundaries. |
| NASA-4.3.1.2.3 | Retain models | documented | Versioned B/L/T models and deterministic readable views retain the selected local model baseline; no installed implementation is inferred. |

### 4.4 — Design solution

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-4.4.1.2.1 | Frame alternatives | documented | Q identifies six quality drivers, 12 refined scenarios and explicit alternatives AD01–AD08 constrained by preserved product policy and owners. |
| NASA-4.4.1.2.2 | Develop candidates | documented | Q compares actual alternatives for coherent reads, adverse evidence, recovery, sharing, storage adaptation, bounded retry and safe diagnostics. |
| NASA-4.4.1.2.3 | Evaluate candidates | documented | Q selects and analyzes alternatives against measurable scenarios, sensitivities, consequences and residual risks; priorities are engineering-derived, not stakeholder votes. |
| NASA-4.4.1.2.4 | Select solution | documented | Q/B/L record the selected bounded engineering solution and rejected alternatives. D03–D05 and later empirical acceptance remain explicit. |
| NASA-4.4.1.2.5 | Resolve details | documented | L specifies candidate relations/keys/FDs, temporal constraints and selected transaction protocols; B fixes privilege and final-delivery boundaries. Actual DDL qualification is G6. |
| NASA-4.4.1.2.6 | Describe design | documented | T/B/L/Q form the reviewable G1–G5 design package alongside C/F. It describes a selected logical design, not a deployed schema. |
| NASA-4.4.1.2.7 | Verify design | partial | Bidirectional allocation, independent design challenge and paper interleavings support design consistency. Database concurrency/privilege enforcement and source completeness require G6 evidence. |
| NASA-4.4.1.2.8 | Validate design | partial | B/Q cover manager/co-manager, expiry/recovery, operator failure and preservation scenarios on paper. Actual intended-use validation with real behavior remains G6/G7. |
| NASA-4.4.1.2.9 | Plan support | documented | Q specifies operating evidence, failure responses, restricted diagnostics, qualification, conflict-census and rollback plans; execution and operational effectiveness remain G6/G7. |
| NASA-4.4.1.2.10 | Baseline solution | documented | Selected local design artifacts and their versions are identified; this baseline has no runtime, migration, release or public-launch authority. |

### 5.1 — Implementation

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-5.1.1.2.1 | Prepare build | documented | R/T/B/L/Q define the bounded internal build, selected protocols and G6 prerequisites. Build qualification must use actual guarded roles and isolated source fixtures. |
| NASA-5.1.1.2.2 | Acquire or construct | deferred | Reuse choices documented; target runtime construction and integration are G6 work. |
| NASA-5.1.1.2.3 | Retain build evidence | deferred | Future source changes, dependency provenance and actual checks must be captured at G6/G7. |

### 5.2 — Integration

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-5.2.1.2.1 | Plan assembly | documented | B sequences and L protocols define composition order, interfaces, atomic boundaries and failure recovery; Q supplies staged qualification and transition checks. |
| NASA-5.2.1.2.2 | Obtain components | deferred | Actual target implementation not built; retained source is reference evidence. G6. |
| NASA-5.2.1.2.3 | Check components | deferred | Require qualified versions and service/SQL results, not source presence alone. G6. |
| NASA-5.2.1.2.4 | Prepare environment | deferred | Existing isolated harness identified; no database provisioned or guard bypassed. G6. |
| NASA-5.2.1.2.5 | Assemble path | deferred | Identification-to-authorized-read path must run through existing owners. G6. |
| NASA-5.2.1.2.6 | Support assembly | deferred | Fixtures, source qualification and controlled failure injection remain G6. |
| NASA-5.2.1.2.7 | Retain results | deferred | Capture actual integration outcomes and unresolved anomalies at G6. |

### 5.3 — Verification

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-5.3.1.2.1 | Plan proof | documented | T specifies 108 cases covering FS01–FS22 and preservation/process invariants, with fixture, method, oracle and required evidence; B/Q add control and operating cases. |
| NASA-5.3.1.2.2 | Execute proof | deferred | Offline document checks ran; target runtime/SQL/race tests did not. G6. |
| NASA-5.3.1.2.3 | Assess results | partial | V and T distinguish paper/document consistency from executable proof. Findings and corrections can be reviewed; runtime anomaly assessment awaits G6. |
| NASA-5.3.1.2.4 | Retain proof | partial | Versioned specification and local design-check evidence are retained. Actual runtime receipts, deviations and coverage evidence remain G6/G7. |

### 5.4 — Validation

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-5.4.1.2.1 | Plan user validation | documented | T/B/Q define manager/co-manager and operator journeys, independent expected outcomes and acceptance evidence for success, degraded operation, recovery and preservation. |
| NASA-5.4.1.2.2 | Exercise intended use | deferred | No live or isolated target journey exists. G6, with product decisions at their gates. |
| NASA-5.4.1.2.3 | Assess fitness | deferred | Source consistency does not prove portfolio utility or recovery usability. G6/G7. |
| NASA-5.4.1.2.4 | Retain validation | deferred | Record user-workflow results and exceptions when executed. G6/G7. |

### 5.5 — Transition

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-5.5.1.2.1 | Plan transfer | partial | Q and L select additive compatibility, conflict census, abort and rollback boundaries. Actual installed-catalog preflight, rehearsal and release ownership remain G7. |
| NASA-5.5.1.2.2 | Prepare destination | deferred | Runtime roles, catalog, monitoring and production ownership need fresh G7 checks. |
| NASA-5.5.1.2.3 | Prepare release | deferred | No target build/preview or cutover authorization. G7. |
| NASA-5.5.1.2.4 | Transfer product | deferred | Nothing merged, deployed or migrated; user release authority required at G7. |
| NASA-5.5.1.2.5 | Retain transfer evidence | deferred | Exact merged/deployed SHA and both-league evidence required at G7. |

### 6.1 — Technical planning

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-6.1.1.2.1 | Frame planning | documented | README/H bound the deliverable, owners and exclusions. |
| NASA-6.1.1.2.2 | Define work | partial | R and Q allocate design/build/qualification deliverables to existing responsibilities. Named staffing, dates and execution commitments are not supplied by this design. |
| NASA-6.1.1.2.3 | Resource the work | unassessed | No approved staffing, dates or implementation budget; do not infer commitments from proposed costs. |
| NASA-6.1.1.2.4 | Prepare technical plans | documented | T/B/L/Q supply verification, security, operating and transition plans for this slice; G6/G7 are evidence-producing execution work, not missing design choices. |
| NASA-6.1.1.2.5 | Secure commitments | partial | Documentation/design mandate and D02 are authorized. No implementation budget, public product decision or release authorization is inferred. |
| NASA-6.1.1.2.6 | Direct work | documented | Repository rules, isolated worktree and assigned document ownership govern this design work; no runtime writer or production owner is claimed. |
| NASA-6.1.1.2.7 | Retain planning | documented | R, T, Q, the historical audit and current inventory retain selected work, exclusions, constraints and remaining qualification. |

### 6.2 — Requirements management

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-6.2.1.2.1 | Plan requirement control | documented | T defines stable obligation IDs and source-to-model-to-oracle change impact in both directions under the one normative README entry. |
| NASA-6.2.1.2.2 | Manage obligations | documented | T retains all first-slice obligations, approved decision references and explicit excluded/deferred needs. D03–D05 remain unresolved at their named gates. |
| NASA-6.2.1.2.3 | Maintain trace | documented | T records every field/constraint/type/FS-case allocation and both directions between requirements and selected model elements; count alone is not correctness. |
| NASA-6.2.1.2.4 | Control changes | documented | T defines synchronized source, obligation, model, case and evidence review on change; immutable approved policy/history remain protected. |
| NASA-6.2.1.2.5 | Track issues | documented | Historical M01–M14, current design responses, residual Q/B risks and D03–D05 have explicit dispositions; no design issue is silently converted to a test pass. |
| NASA-6.2.1.2.6 | Retain decisions | documented | P/H, reconciliation dispositions and audit findings preserved. |

### 6.3 — Interface management

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-6.3.1.2.1 | Plan interface control | documented | T impact links, B trust/action boundaries and L ownership/protocols specify interface control for the internal slice and preserved public callers. |
| NASA-6.3.1.2.2 | Specify interfaces | documented | C/F ports are composed with B state/sequence/auth guards and L key/relationship/transaction models; coherence is explicitly selected, not a cache assumption. |
| NASA-6.3.1.2.3 | Qualify composition | deferred | Actual service/SQL and hostile-reference tests remain G6. |
| NASA-6.3.1.2.4 | Control interfaces | documented | Preservation obligations and Q transition plan constrain target adoption; source, model, case and compatibility changes require synchronized review before cutover. |
| NASA-6.3.1.2.5 | Retain interfaces | documented | C/F/B/L/T retain the conceptual interfaces and selected logical/behavioral adaptations with explicit local versions. |

### 6.4 — Technical risk

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-6.4.1.2.1 | Frame risk work | documented | Q assigns invariant-blocking priorities and response/stop conditions; B bounds trust/control coverage and separately identifies operational compromise assumptions. |
| NASA-6.4.1.2.2 | Identify risks | documented | Q/BS residual risks and historical M findings identify concrete design/security/operation risks; broader application and organization-wide risk coverage are not claimed. |
| NASA-6.4.1.2.3 | Assess risks | partial | Q records impact, engineering priorities, sensitivities and unmeasured likelihood. No fabricated empirical probability, stakeholder risk vote or operational risk result. |
| NASA-6.4.1.2.4 | Plan mitigation | documented | Q/B/L select specific controls, ordered guards, evidence rules and safe failure responses with later tests and activation stop conditions. |
| NASA-6.4.1.2.5 | Reassess risks | partial | Independent design reviews and the scan-lifecycle correction reassess this design. Ongoing operational risk surveillance remains later; no recurring monitor was created. |
| NASA-6.4.1.2.6 | Execute responses | partial | Design responses and trace corrections are incorporated. Implemented enforcement, recovery execution and rollback evidence remain G6/G7. |
| NASA-6.4.1.2.7 | Retain risks | documented | Historical findings, selected decision rationale, residual risks, control allocation and later acceptance conditions are retained. |

### 6.5 — Configuration management

The published web page labels the last two activities in §6.5 as `6.4.1.2.5` and `6.4.1.2.6`. Below, `NASA-6.5.activity5` and `NASA-6.5.activity6` unambiguously identify their location under configuration management; they do not duplicate the risk activities or silently correct the source's numbering.

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-6.5.1.2.1 | Plan baselines | documented | Repository is authoritative; target entry and portable-copy relationship defined. |
| NASA-6.5.1.2.2 | Identify configuration | documented | Application baseline, input hashes, source fingerprints and versioned target identified. |
| NASA-6.5.1.2.3 | Control revisions | partial | Isolated worktree and local design review exist; local authored artifacts have not thereby passed publication, PR, build or release gates. |
| NASA-6.5.1.2.4 | Account for status | documented | V separates local artifact, publication, preview, merge and production state. |
| NASA-6.5.activity5 | Audit configuration | partial | Fresh source/deployment identity and design hashes can be checked without runtime writes; actual installed database catalog, grants and deployed effectiveness remain G6/G7. |
| NASA-6.5.activity6 | Retain configuration | documented | Versioned artifacts and generated views retain this local design; portable manifest must match the final source revision and exact hashes before handoff. |

### 6.6 — Technical data

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-6.6.1.2.1 | Plan data handling | documented | Q selects a minimal diagnostic schema, access/retention ceiling, safe evidence export and sink-failure semantics. These do not change deployed configuration or D05 retention. |
| NASA-6.6.1.2.2 | Preserve evidence | documented | H/P and source hashes preserved; unavailable historic catalog explicitly unclaimed. |
| NASA-6.6.1.2.3 | Deliver authorized data | partial | The repository is authoritative and portable-copy rules are explicit. Exact final mirror hashes/publication status must be reported separately; no external delivery is inferred. |

### 6.7 — Technical assessment

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-6.7.1.2.1 | Plan assessments | documented | Published profile, independent requirements/data/security perspectives and explicit artifact-versus-execution status guide the assessment. |
| NASA-6.7.1.2.2 | Assess progress | partial | Current G1–G5 artifacts and independent corrections demonstrate design progress; actual runtime quality, performance and operational acceptance are still absent. |
| NASA-6.7.1.2.3 | Retain assessments | documented | Historical audit, current inventory, requirement/model trace and V retain findings, corrections and bounded evidence claims. |

### 6.8 — Decision analysis

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-6.8.1.2.1 | Set criteria | documented | Q states approved product drivers, P0/P1 engineering priorities, invariant measures and preserved policy constraints without stakeholder-vote claims. |
| NASA-6.8.1.2.2 | Enumerate options | documented | Q AD01–AD08 enumerate candidate mechanisms and L/B describe the selected protocol/storage/privilege alternatives. |
| NASA-6.8.1.2.3 | Choose analysis | documented | Published method profile and three independent perspectives explicitly selected. |
| NASA-6.8.1.2.4 | Compare options | documented | Q supplies scenario-driven comparison, tradeoffs and sensitivities; L adds keys/FDs and paper transaction schedules for the selected solution. |
| NASA-6.8.1.2.5 | Recommend choice | partial | Selected engineering choices are explicit and reviewable. Product D03–D05, measured operational suitability and relevant residual-risk acceptance remain at their gates. |
| NASA-6.8.1.2.6 | Report choice | documented | Q/R state selected and rejected choices, preservation boundaries and unresolved product policies without silently deciding D03–D05. |
| NASA-6.8.1.2.7 | Retain rationale | documented | Q/B/L/T preserve rationale, controls, alternative consequences and uncertainty alongside the historical audit. |

## SEI: all 8 QAW and 9 ATAM steps

Source step descriptions: [QAW third edition](https://www.sei.cmu.edu/asset_files/TechnicalNote/2003_004_001_14201.pdf), [ATAM method report](https://sei.cmu.edu/documents/629/2000_005_001_13706.pdf). The following rows assess the current selected design artifacts and unperformed process activities. They do not assert that a workshop occurred or all stakeholder interests were represented.

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| QAW-1 | Explain process | documented | Selected-profile purpose, concern roles, artifact scope and limits are recorded; this does not assert a facilitated workshop occurred. |
| QAW-2 | Present drivers | partial | H/R/Q present approved outcomes and six derived quality drivers. No stakeholder presentation attendance or new business-priority commitment is inferred. |
| QAW-3 | Present architecture | documented | B/L/C present the selected architecture, ownership, state/sequence model and transaction boundaries for artifact review. |
| QAW-4 | Identify drivers | documented | Q explicitly derives security, truthfulness, recovery, sharing, evolution and preservation drivers from the approved brief. |
| QAW-5 | Generate scenarios | partial | Q supplies 12 refined scenarios covering the recorded concerns. Broader stakeholder elicitation and a live brainstorming workshop did not occur. |
| QAW-6 | Consolidate scenarios | documented | Q consolidates related source-error scenarios, separates expiry recovery from genuine loss/regain, and explicitly defers scale concerns without dropping them. |
| QAW-7 | Prioritize scenarios | partial | Q assigns reasoned P0/P1/later engineering priorities. No stakeholder votes, consensus ranking or facilitated prioritization event is claimed. |
| QAW-8 | Refine scenarios | documented | Each Q scenario specifies stimulus source, stimulus, environment, artifact, response and measurable acceptance outcome, with oracle and residual limitation. |
| ATAM-1 | Explain evaluation | documented | Tailored evaluation purpose, selected methods, evidence limits and non-certification boundary are explicit. |
| ATAM-2 | Present drivers | partial | Q states six approved-brief drivers and engineering priorities. Direct stakeholder presentation/priority agreement is not established. |
| ATAM-3 | Present architecture | documented | B/C/L present composed states, owners, interfaces, trust boundaries, relations and selected transaction design. |
| ATAM-4 | Identify approaches | documented | Q AD01–AD08 and B/L identify alternative approaches and selected mechanisms, including lock/clock, versioned adverse evidence and privacy choices. |
| ATAM-5 | Rank quality scenarios | partial | Q provides an explicit driver-to-prioritized-scenario structure and acceptance measures. This is an engineering equivalent artifact, not a stakeholder-approved utility-tree workshop. |
| ATAM-6 | Analyze approaches | documented | Q compares each scenario with selected approaches, sensitivities, tradeoffs and residual risk; L/B provide paper mechanisms and proof obligations. |
| ATAM-7 | Broaden scenarios | partial | Independent reviewers broadened adversarial cases and checked concern coverage. No stakeholder brainstorming/voting workshop occurred. |
| ATAM-8 | Reanalyze approaches | documented | Independent design challenge exposed composed-state, privilege, normalization and scan-lifecycle issues; revised mechanisms and residual limits are retained. Runtime qualification remains later. |
| ATAM-9 | Present findings | documented | Historical findings and current T/B/L/Q responses report selected choices, risks and unresolved qualification. This is not a completed formal ATAM engagement claim. |

## Database lifecycle: all 10 declared audit categories

These audit IDs decompose the [textbook lifecycle](https://opentextbc.ca/dbdesign01/chapter/chapter-13-database-development-process/), [conceptual/logical/physical progression](https://www.open.edu/openlearn/science-maths-technology/the-database-development-life-cycle/content-section-1.5), and [normalization analysis](https://bohr.wlu.ca/cp363/notes/theory/09_normalization.php). PostgreSQL details must match the version actually deployed; the current documentation explains [constraints](https://www.postgresql.org/docs/current/ddl-constraints.html) and [isolation](https://www.postgresql.org/docs/current/transaction-iso.html), but is not installed-version evidence.

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| DB-1 | Requirements | documented | T supplies atomic approved/derived requirements, exclusions, owner allocation and independent verification specifications for all C/F fields and constraints. |
| DB-2 | Conceptual relationships | documented | L specifies relation participation, optionality, stable identity, source alias, association, preference and provenance relationships; F remains the conceptual contract. |
| DB-3 | Logical relations | documented | L declares logical relation attributes, candidate keys and functional dependencies, with exact top-level field allocation and same-league identity rules. |
| DB-4 | Normalize/decompose | documented | L records decomposition, lossless/dependency-preservation reasoning, declared normal forms and explicitly owned document/projection redundancy. Independent judgment remains necessary; declarations are not a runtime proof. |
| DB-5 | Domains and unknowns | partial | F/T and L select domains, unknown/null/empty handling, tagged evidence and proposed constraint semantics. Actual parser/SQL enforcement and deployed-version behavior require G6. |
| DB-6 | Temporal integrity | partial | L/B select timestamp authority, immutable history, D02 boundaries, generations and paper interleavings. Actual clock/lock behavior remains G6 qualification. |
| DB-7 | Transactions and constraints | partial | L/B specify candidate uniqueness/FK/role/lock/isolation/retry design and independent race schedules. Actual database roles, triggers and interleavings are unexecuted. |
| DB-8 | Physical design | partial | L selects candidate schema/index/guard/privilege adaptations and ownership. Installed-version catalog checks, query plans and performance qualification remain G6/G7. |
| DB-9 | Migration and population | partial | L/Q specify additive adoption, conflict census, abort criteria and rollback compatibility. No migration, population or isolated rehearsal was executed. |
| DB-10 | Testing and operation | deferred | T/B/Q provide test and operating specifications; target runtime/SQL/capacity/recovery execution and live operational evidence remain G6/G7. |

## NIST SSDF 1.1: all 19 active practices and 42 active tasks

Source: [SP 800-218 Table 1](https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.800-218.pdf). NIST calls for risk-based tailoring; this inventory is an evidence disposition, not a compliance score. Retired/moved IDs are not counted again: PW.3 → PW.4; PW.3.1 → PO.1.3; PW.3.2 → PW.4.4; PW.4.3 → PW.1.3; PW.4.5 → PW.4.1/PW.4.4; PW.5.2 → PW.5.1 example. Notional examples and mapped external standards are not additional mandatory tasks.

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| SSDF-PO.1.1 | Development security requirements | partial | Repository isolation/secret/test rules and target design requirements are recorded; organization-wide security requirement governance remains unassessed. |
| SSDF-PO.1.2 | Product security requirements | documented | T/B specify target trust/action/control requirements, threats, source authority, denial and freshness rules with independent oracle allocation. |
| SSDF-PO.1.3 | Supplier requirements | unassessed | Existing provider/hosting roles identified; supplier security commitments not evaluated here. G5/G7. |
| SSDF-PO.2.1 | Assign responsibilities | partial | R/B/Q assign responsibility to existing product, security, data and operational owners. Named implementation/release staffing and acceptance commitments remain later. |
| SSDF-PO.2.2 | Train contributors | unassessed | This audit did not examine personnel training or competency records. |
| SSDF-PO.2.3 | Obtain sponsorship | partial | User authorized the bounded design work and preserved D02 policy; no organization-wide secure-development sponsorship attestation is inferred. |
| SSDF-PO.3.1 | Select supporting tools | partial | Deterministic design checks, independent oracle specifications and the guarded isolated harness are selected. Runtime security-tool coverage/effectiveness remains G6. |
| SSDF-PO.3.2 | Operate toolchain | unassessed | CI protection/configuration and tool authenticity not comprehensively assessed. G7. |
| SSDF-PO.3.3 | Collect tool evidence | partial | Design consistency evidence and safe later evidence formats are defined; actual build/security automation results remain G6/G7. |
| SSDF-PO.4.1 | Define security gates | documented | G1–G7 plus T/B/Q define applicable design, role/constraint/race, preservation, privacy, operating and release acceptance gates for the slice. |
| SSDF-PO.4.2 | Preserve gate evidence | partial | T/B/Q define safe evidence, exact oracles and restricted diagnostic handling. Actual runtime/gate receipts and effective deployment retention remain G6/G7. |
| SSDF-PO.5.1 | Isolate environments | partial | Dedicated worktree and guarded DB policy respected; full environment control effectiveness unassessed. |
| SSDF-PO.5.2 | Protect developer endpoints | unassessed | Device hardening/access controls were not audited. |
| SSDF-PS.1.1 | Protect source assets | partial | Canonical repo and immutable evidence referenced; repository ACL review not performed. |
| SSDF-PS.2.1 | Verify release integrity | deferred | Portable hashes protect this review copy; application release verification remains G7. |
| SSDF-PS.3.1 | Retain release artifacts | deferred | Local docs captured; actual application release archive/provenance remains G7. |
| SSDF-PS.3.2 | Retain component provenance | partial | Pinned source anchors/hashes and selected component ownership are retained; full runtime dependency and provenance inventory remains unassessed. |
| SSDF-PW.1.1 | Model threats | documented | B models changed-surface actors, assets, trust boundaries, state/actions and 13 threat/control allocations, with exact independent security-oracle methods. |
| SSDF-PW.1.2 | Maintain security rationale | documented | B/Q retain selected controls, alternatives, residual risks, trusted-credential limits and activation stop conditions; T provides requirement/control trace. |
| SSDF-PW.1.3 | Reuse security services | documented | Existing principal/session, restricted-role and audit owners retained; target enforcement unexecuted. |
| SSDF-PW.2.1 | Review security design | partial | Independent design challenge and cross-artifact corrections are recorded; no human stakeholder workshop, full-application security audit or implemented-control qualification is claimed. |
| SSDF-PW.4.1 | Qualify acquired components | unassessed | Runtime dependency/security inventory outside this document audit. G6/G7. |
| SSDF-PW.4.2 | Maintain shared components | partial | Selected design preserves shared auth, normalizer, worker, reader and publication owners. Actual changes and regression evidence remain G6. |
| SSDF-PW.4.4 | Verify supplier components | unassessed | No complete component vulnerability/license/provenance assessment performed. G7. |
| SSDF-PW.5.1 | Apply coding rules | deferred | Runtime implementation absent; repository rules must be applied during G6. |
| SSDF-PW.6.1 | Qualify build tooling | unassessed | Toolchain security posture not audited by document checks. G7. |
| SSDF-PW.6.2 | Configure build protections | unassessed | No broad compiler/interpreter/build configuration assessment. G6/G7. |
| SSDF-PW.7.1 | Plan code review | documented | T/B/L/Q identify risk-focused review surfaces: actual mutators, helper grants, fixed scope, connection fencing, failure atomicity and preserved callers before G6/G7 acceptance. |
| SSDF-PW.7.2 | Analyze source | partial | Relevant existing source and proposed adapters were inspected; future implementation code and executable security analysis remain G6 work. |
| SSDF-PW.8.1 | Plan executable testing | documented | T cases and B/Q oracle methods specify fixtures, deliberate schedules, independent expected outcomes, protected-output inspection and later role/catalog evidence. |
| SSDF-PW.8.2 | Execute security tests | deferred | Zero target runtime, SQL, race or adversarial tests executed. G6. |
| SSDF-PW.9.1 | Define secure defaults | documented | B/L/Q select private/no-store target responses, closed safe failure variants, restricted helper signatures/grants, deadlines and minimal diagnostics. Actual defaults remain unimplemented. |
| SSDF-PW.9.2 | Implement secure defaults | deferred | No runtime changes deployed; exact enforcement and docs require G6/G7. |
| SSDF-RV.1.1 | Receive vulnerability reports | unassessed | Organization-wide intake, component monitoring and investigation program not reviewed. |
| SSDF-RV.1.2 | Find residual weaknesses | partial | Independent reviewers challenged the target design and expanded race/privilege/lifecycle cases. Ongoing assessment of released software remains unassessed. |
| SSDF-RV.1.3 | Define disclosure response | unassessed | No claim about existing disclosure/response policy; require responsible operator before activation. G7. |
| SSDF-RV.2.1 | Assess reported weaknesses | partial | Design findings have concrete counterexamples and severity/risk dispositions. These are not reproduced production vulnerabilities or operational incident assessments. |
| SSDF-RV.2.2 | Respond to weaknesses | partial | Design root causes and inconsistent statements were corrected; future runtime enforcement and security regression evidence remain G6/G7. |
| SSDF-RV.3.1 | Identify root causes | documented | Historical identity/key/protocol findings and current lifecycle/coherent-state/privilege fixes record root causes and corresponding design changes. |
| SSDF-RV.3.2 | Examine recurring patterns | partial | The review addresses consistency-count overclaim and cross-model drift through explicit evidence boundaries. Longitudinal production-incident analysis remains unassessed. |
| SSDF-RV.3.3 | Find related weaknesses | partial | C/F/T/B/L/Q are cross-checked for related scope, identity, temporal and privilege weaknesses; no broader application vulnerability search is claimed. |
| SSDF-RV.3.4 | Improve development process | documented | Selected design gates, bidirectional model/oracle trace and explicit runtime-evidence limits correct the reviewed development-process weakness. |

## Coverage boundary and future re-audit

Inventory: **97 NASA + 8 QAW + 9 ATAM + 10 database + 42 SSDF = 166 activity dispositions**. Many activities overlap; adding counts does not measure assurance. For this inventory, the checker detects missing/duplicate IDs and malformed statuses; companion checks validate artifact references and bidirectional allocation. A reviewer must still judge each disposition and its evidence.

Current dispositions: **83 documented, 49 partial, 0 gap, 23 deferred, 11 unassessed**. This is evidence bookkeeping, not a maturity or compliance score. The G1 artifact is reviewable: atomic approved/derived requirements, explicit deferrals, complete contract and model allocation, and independent verification specifications are provided. Actual stakeholder validation, unresolved product approvals, organization-wide practices and G6/G7 execution remain bounded exactly as the rows state.

The supplementary OWASP/PostgreSQL checks are intentionally focused, with their exact sources and findings in the audit. A full ASVS assessment, all clauses of paid ISO standards, every referenced standard, aerospace-specific governance, organizational staffing/training, broad supply-chain audit, installed database enforcement and live product validation are **not established**. These limits are explicit rather than converted into passes or silently omitted. Revisit relevant rows when G1–G7 artifacts, code, policy or service identity change; do not reuse this snapshot as future release evidence.
