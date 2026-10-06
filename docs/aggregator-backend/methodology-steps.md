# Complete inventory for the selected audit profile

The [dated audit](methodology-audit.md) preserves the original findings and defines G1–G7. This is the current disposition of the selected profile after the bounded design work; it supersedes stale artifact-missing statements in that historical audit, without rewriting its evidence. NASA/SEI/SSDF IDs refer to published activities; TB IDs identify the explicitly located textbook activities, guidelines and stages below. DB-1 through DB-10 are local audit categories, not published step IDs. Labels are short paraphrases. Each row assesses the detailed first slice and its full-build planning allocation, not an organization-wide conformity result. Every selected activity has a disposition; none is silently skipped. Status is **documented** (bounded artifact exists), **partial** (incomplete evidence), **gap** (required design artifact absent), **deferred** (later implementation/activation), or **unassessed** (evidence outside this review). No status means a runtime test passed.

G1–G7 are defined in the audit. Evidence abbreviations: **C** = [contracts](contracts.md), **F** = [field register](foundation-fields.md), **R** = [reconciliation](reconciliation.md), **V** = [verification](verification.md), **H** = [preserved handoff](evidence/backend-workspace-handoff.md), **P** = [policy register](evidence/backend-policy-register.json), **T** = [atomic requirements and bidirectional trace](requirements-traceability.md) and its [JSON ledger](design-requirements.json), **B** = [behavior/security design](behavior-security-design.md), **L** = [selected relational model](relational-design.json) and [relational rationale](relational-design.md), **Q** = [quality decisions and operating evidence](quality-operations.md). A citation supports only the specific statement in its row. Documented means that the bounded artifact exists; it does not establish that every action or output in the named source activity is satisfied. Where an activity requires unperformed stakeholder participation, missing design outputs or later execution, the row records that limitation explicitly. No aggregate is an activity-completion rate.

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
| NASA-4.1.1.2.6 | Outcome measures | documented | ENG03/ENG06 select freshness, capacity, availability and recovery objectives with explicit measurement and qualification gates. No measured target result is claimed. |
| NASA-4.1.1.2.7 | Trace expectations | documented | T provides forward/reverse approved-need, field, constraint, case and selected-model allocation; every deferred approved need has an explicit disposition. |
| NASA-4.1.1.2.8 | Obtain commitments | partial | P preserves original D02 approval. The new direct user delegation and selected D03-D05 decisions are in backend-decisions.json. Staffed operating commitments and a formal stakeholder workshop remain unperformed. |
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
| NASA-4.3.1.2.1 | Model behavior | partial | B supplies state/sequence/transition models and the final-read protocol. Target command authorization lifetime on coordinator loss and discovery/recovery admission are still open G4/G5 behavior designs; nominal transitions are not complete guarded implementations. |
| NASA-4.3.1.2.2 | Allocate and reconcile | partial | T allocates declared requirements/model elements in both directions. The shared admission owner/interface and DB-enforced command lifetime are not yet selected, so their exact behavior, storage and failure allocations remain incomplete. |
| NASA-4.3.1.2.3 | Retain models | documented | Versioned B/L/T models and deterministic readable views retain the selected local model baseline; no installed implementation is inferred. |

### 4.4 — Design solution

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-4.4.1.2.1 | Frame alternatives | documented | Q identifies six quality drivers, 12 refined scenarios and explicit alternatives AD01–AD08 constrained by preserved product policy and owners. |
| NASA-4.4.1.2.2 | Develop candidates | documented | Q compares actual alternatives for coherent reads, adverse evidence, recovery, sharing, storage adaptation, bounded retry and safe diagnostics. |
| NASA-4.4.1.2.3 | Evaluate candidates | documented | Q, the delegated decisions and admission design compare bounded source sharing, same-transaction authority and reserved aggregate acquisition. Independent counterexamples are tracked in design-completion.md; empirical tradeoffs remain G6/G7. |
| NASA-4.4.1.2.4 | Select solution | documented | ENG01/ENG02 select same-transaction authority and atomic account-to-existing-job admission. D03-D05 are selected under direct delegation. Implementation and operating acceptance remain separate. |
| NASA-4.4.1.2.5 | Resolve details | partial | First-slice ERD, proposed structural DDL and exact helper/admission algorithms now exist. Independent SQL/ERD review found final-constraint and operator-path corrections; current dispositions are in design-completion.md. Later feature detailed designs remain BC-M2/3. |
| NASA-4.4.1.2.6 | Describe design | documented | T/B/L/Q plus ERD, proposed-schema.sql, admission and full-build plan describe the selected first-slice design and full-scope milestone allocations. They do not claim later feature detailed designs are finished. |
| NASA-4.4.1.2.7 | Verify design | partial | Three review passes cover scope allocation, relational/security consistency and adversarial failure cases. Current findings/dispositions are in design-completion.md. Actual database/source verification remains G6. |
| NASA-4.4.1.2.8 | Validate design | partial | B/Q and the full plan supply intended-use and degraded scenarios; delegated policy choices are recorded. Executed intended-use validation and source completeness evidence remain absent. |
| NASA-4.4.1.2.9 | Plan support | documented | Q specifies operating evidence, failure responses, restricted diagnostics, qualification, conflict-census and rollback plans; execution and operational effectiveness remain G6/G7. |
| NASA-4.4.1.2.10 | Baseline solution | documented | Versioned local candidate artifacts are identified together with open design issues. This is a recorded review baseline, not acceptance of a complete solution or authority to implement, migrate or activate it. |

### 5.1 — Implementation

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-5.1.1.2.1 | Prepare build | partial | The selected first-slice ERD/DDL/interfaces and full-build dependencies prepare implementation. Actual environment/role qualification, fixtures and later detailed family designs remain named milestone work. |
| NASA-5.1.1.2.2 | Acquire or construct | deferred | Reuse choices documented; target runtime construction and integration are G6 work. |
| NASA-5.1.1.2.3 | Retain build evidence | deferred | Future source changes, dependency provenance and actual checks must be captured at G6/G7. |

### 5.2 — Integration

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-5.2.1.2.1 | Plan assembly | documented | Existing-owner composition, same-B authority, atomic job admission and incremental caller/worker cutover are selected in the relational/admission/full-build plans. No integration execution occurred. |
| NASA-5.2.1.2.2 | Obtain components | deferred | Actual target implementation not built; retained source is reference evidence. G6. |
| NASA-5.2.1.2.3 | Check components | deferred | Require qualified versions and service/SQL results, not source presence alone. G6. |
| NASA-5.2.1.2.4 | Prepare environment | deferred | Existing isolated harness identified; no database provisioned or guard bypassed. G6. |
| NASA-5.2.1.2.5 | Assemble path | deferred | Identification-to-authorized-read path must run through existing owners. G6. |
| NASA-5.2.1.2.6 | Support assembly | deferred | Fixtures, source qualification and controlled failure injection remain G6. |
| NASA-5.2.1.2.7 | Retain results | deferred | Capture actual integration outcomes and unresolved anomalies at G6. |

### 5.3 — Verification

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-5.3.1.2.1 | Plan proof | documented | T/B/Q specify detailed cases; admission adds eight failure schedules; full coverage adds69 requirement-specific acceptance plans. Execution and empirical proof remain G6/G7. |
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
| NASA-6.1.1.2.4 | Prepare technical plans | documented | Full build plan and coverage matrix allocate design, implementation, source, security, load, recovery, privacy and transition activities with dependencies and stop conditions. Actual schedules/staffing are not invented. |
| NASA-6.1.1.2.5 | Secure commitments | partial | Documentation/design mandate and D02 are authorized. No implementation budget, public product decision or release authorization is inferred. |
| NASA-6.1.1.2.6 | Direct work | documented | Repository rules, isolated worktree and assigned document ownership govern this design work; no runtime writer or production owner is claimed. |
| NASA-6.1.1.2.7 | Retain planning | documented | R, T, Q, the historical audit and current inventory retain selected work, exclusions, constraints and remaining qualification. |

### 6.2 — Requirements management

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-6.2.1.2.1 | Plan requirement control | documented | T defines stable obligation IDs and source-to-model-to-oracle change impact in both directions under the one normative README entry. |
| NASA-6.2.1.2.2 | Manage obligations | documented | T and the69-row full matrix retain approved needs, source constraints and later detailed-design work. D03-D05 are selected in the new delegation record; original approval evidence remains immutable. |
| NASA-6.2.1.2.3 | Maintain trace | documented | T checks all declared fields/constraints/types/FS cases and model elements; full coverage traces every enumerated need, owner, milestone and acceptance ID. Finite allocation is not proof against unknown requirements. |
| NASA-6.2.1.2.4 | Control changes | documented | T defines synchronized source, obligation, model, case and evidence review on change; immutable approved policy/history remain protected. |
| NASA-6.2.1.2.5 | Track issues | documented | Historical M01–M14, current design responses, residual Q/B risks and D03–D05 have explicit dispositions; no design issue is silently converted to a test pass. |
| NASA-6.2.1.2.6 | Retain decisions | documented | P/H, reconciliation dispositions and audit findings preserved. |

### 6.3 — Interface management

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-6.3.1.2.1 | Plan interface control | documented | T impact links, B trust/action boundaries and L ownership/protocols specify interface control for the internal slice and preserved public callers. |
| NASA-6.3.1.2.2 | Specify interfaces | documented | The admission register specifies six guarded interfaces and closed DTOs; relational contracts define same-transaction auth, account, worker and operator boundaries. Later feature interfaces are mandatory BC-M2/3 outputs. |
| NASA-6.3.1.2.3 | Qualify composition | deferred | Actual service/SQL and hostile-reference tests remain G6. |
| NASA-6.3.1.2.4 | Control interfaces | documented | Preservation obligations and Q transition plan constrain target adoption; source, model, case and compatibility changes require synchronized review before cutover. |
| NASA-6.3.1.2.5 | Retain interfaces | documented | C/F/B/L/T retain the conceptual interfaces and selected logical/behavioral adaptations with explicit local versions. |

### 6.4 — Technical risk

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-6.4.1.2.1 | Frame risk work | documented | Q assigns invariant-blocking priorities and response/stop conditions; B bounds trust/control coverage and separately identifies operational compromise assumptions. |
| NASA-6.4.1.2.2 | Identify risks | documented | Q/BS residual risks and historical M findings identify concrete design/security/operation risks; broader application and organization-wide risk coverage are not claimed. |
| NASA-6.4.1.2.3 | Assess risks | partial | Q records impact, engineering priorities, sensitivities and unmeasured likelihood. No fabricated empirical probability, stakeholder risk vote or operational risk result. |
| NASA-6.4.1.2.4 | Plan mitigation | documented | Selected mitigations include same-transaction locks, source/order fences, aggregate and actor admission, bounded purpose-specific demand, privacy retention and fail-closed behavior. Runtime effectiveness remains unexecuted. |
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
| NASA-6.6.1.2.1 | Plan data handling | documented | Q preserves exact minimal diagnostics and seven-day ceiling; D05/ENG08 add purpose-specific collection and reference-aware shared-data lifecycle. No deployed retention or destructive sweep changed. |
| NASA-6.6.1.2.2 | Preserve evidence | documented | H/P and source hashes preserved; unavailable historic catalog explicitly unclaimed. |
| NASA-6.6.1.2.3 | Deliver authorized data | partial | The repository is authoritative and portable-copy rules are explicit. Exact final mirror hashes/publication status must be reported separately; no external delivery is inferred. |

### 6.7 — Technical assessment

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-6.7.1.2.1 | Plan assessments | documented | Published profile, independent requirements/data/security perspectives and explicit artifact-versus-execution status guide the assessment. |
| NASA-6.7.1.2.2 | Assess progress | partial | Current design-completion and generated analyses record full allocation and specific review corrections. Later detailed designs, implemented enforcement, capacity and operation remain unproved. |
| NASA-6.7.1.2.3 | Retain assessments | documented | Historical audit, current inventory, requirement/model trace and V retain findings, corrections and bounded evidence claims. |

### 6.8 — Decision analysis

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-6.8.1.2.1 | Set criteria | documented | Q states approved product drivers, P0/P1 engineering priorities, invariant measures and preserved policy constraints without stakeholder-vote claims. |
| NASA-6.8.1.2.2 | Enumerate options | documented | Q AD01–AD08 enumerate candidate mechanisms and L/B describe the selected protocol/storage/privilege alternatives. |
| NASA-6.8.1.2.3 | Choose analysis | documented | Published method profile and three independent perspectives explicitly selected. |
| NASA-6.8.1.2.4 | Compare options | documented | Q and ENG decisions compare authority, acquisition, lifecycle and hosting choices with accepted limitations and qualification gates. No numerical performance result is inferred. |
| NASA-6.8.1.2.5 | Recommend choice | documented | The lead engineer selects D03-D05 and ENG01-ENG08 under direct delegation. External source rights, empirical performance and operations still need evidence before activation. |
| NASA-6.8.1.2.6 | Report choice | documented | The machine-readable/readable decision pair records owner, rationale, consequence, milestone and acceptance for every new choice while preserving earlier approval history. |
| NASA-6.8.1.2.7 | Retain rationale | documented | Q/B/L/T preserve rationale, controls, alternative consequences and uncertainty alongside the historical audit. |

## SEI: all 8 QAW and 9 ATAM steps

Source step descriptions: [QAW third edition](https://www.sei.cmu.edu/documents/716/2003_005_001_14249.pdf), [ATAM method report](https://sei.cmu.edu/documents/629/2000_005_001_13706.pdf). The following rows assess the current selected design artifacts and unperformed process activities. They do not assert that a workshop occurred or all stakeholder interests were represented.

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| QAW-1 | Explain process | partial | Selected-profile purpose and artifact limits are written. The source step also introduces facilitators/participants and the workshop process; that facilitated activity did not occur. |
| QAW-2 | Present drivers | partial | H/R/Q present approved outcomes and six derived quality drivers. No stakeholder presentation attendance or new business-priority commitment is inferred. |
| QAW-3 | Present architecture | partial | B/L/C supply architecture and ownership artifacts. No stakeholder architecture presentation or resulting questions/clarifications are evidenced. |
| QAW-4 | Identify drivers | partial | Q derives six quality drivers from the approved brief. The source step also seeks stakeholder agreement on the driver list; author derivation does not establish that agreement. |
| QAW-5 | Generate scenarios | partial | Q supplies 12 refined scenarios covering the recorded concerns. Broader stakeholder elicitation and a live brainstorming workshop did not occur. |
| QAW-6 | Consolidate scenarios | partial | Q consolidates related scenarios and retains deferred concerns. The source step calls for proposer agreement and an attempt at majority stakeholder consensus before merging; neither is evidenced. |
| QAW-7 | Prioritize scenarios | partial | Q assigns reasoned P0/P1/later engineering priorities. No stakeholder votes, consensus ranking or facilitated prioritization event is claimed. |
| QAW-8 | Refine scenarios | partial | Q supplies six-field scenarios, goals, quality concerns and oracles. Refinement of stakeholder-prioritized scenarios and collection of participant questions/concerns were not performed. |
| ATAM-1 | Explain evaluation | partial | Tailored evaluation purpose and limits are written; presentation of the method to the evaluation participants is not evidenced. |
| ATAM-2 | Present drivers | partial | Q states six approved-brief drivers and engineering priorities. Direct stakeholder presentation/priority agreement is not established. |
| ATAM-3 | Present architecture | partial | B/C/L provide architecture artifacts and boundaries. A formal architecture presentation to the ATAM participants is not evidenced. |
| ATAM-4 | Identify approaches | documented | Q AD01–AD08 and B/L identify alternative approaches and selected mechanisms, including lock/clock, versioned adverse evidence and privacy choices. |
| ATAM-5 | Rank quality scenarios | partial | Q provides an explicit driver-to-prioritized-scenario structure and acceptance measures. This is an engineering equivalent artifact, not a stakeholder-approved utility-tree workshop. |
| ATAM-6 | Analyze approaches | partial | Q/L/B provide scenario-based paper analysis, sensitivities, tradeoffs and proof obligations. Analysis against the formal participant-prioritized utility tree remains absent; runtime proof is also separate. |
| ATAM-7 | Broaden scenarios | partial | Independent reviewers broadened adversarial cases and checked concern coverage. No stakeholder brainstorming/voting workshop occurred. |
| ATAM-8 | Reanalyze approaches | partial | Independent design challenge revised mechanisms and identified residual limits. The source step reanalyzes approaches against scenarios from stakeholder brainstorming/prioritization; that formal input/activity did not occur. |
| ATAM-9 | Present findings | partial | Historical and current findings are written and reported in this review. Presentation to and feedback from the full ATAM participant group are not evidenced; no formal engagement completion is claimed. |

## Textbook: literal lifecycle, ER guidelines and normalization stages

The [BCcampus Database Design, second edition, Chapter 13](https://opentextbc.ca/dbdesign01/chapter/chapter-13-database-development-process/) supplies six activities in the list under “Software Development Life Cycle – Waterfall” and five numbered items under “Guidelines for Developing an ER Diagram.” TB13 IDs below preserve those exact locations and order; they are our cross-reference labels, not invented publisher IDs. Section headings and database examples explain these activities, rather than adding another disjoint lifecycle. The crosswalk is iterative; it does not impose a waterfall delivery process.

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| TB13-SDLC-1 | Establish requirements | partial | Requirements gathering: approved brief, direct delegation and source consumers map to detailed first-slice and full-build obligations. Broader interviews/user validation have not occurred. Local crosswalk: DB-1. |
| TB13-SDLC-2 | Analyze requirements | documented | Analysis: C/F/T plus the source-facing conceptual ER views and full contract-surface register describe meaning and constraints. Independent findings and limitations are in design-completion.md. Local crosswalk: DB-1/2. |
| TB13-SDLC-3 | Design the system | partial | First-slice logical/physical design now includes reviewed-model relations, ERD, proposed structural DDL and exact helper algorithms. Later official/analytics detailed schemas are BC-M2/3 outputs, not completed by full-plan allocation. Local crosswalk: DB-2 through DB-8. |
| TB13-SDLC-4 | Implement the design | deferred | Lifecycle item 4; Implementation, Realizing the Design, Populating the Database. No target construction, schema installation or population occurred. Local crosswalk: DB-7/8/9. |
| TB13-SDLC-5 | Test against requirements | deferred | Lifecycle item 5. T/B/Q specify future checks; no target acceptance or failure report exists from execution. Local crosswalk: DB-10. |
| TB13-SDLC-6 | Maintain the system | deferred | Lifecycle item 6. Change/rollback plans exist; target operational maintenance has not occurred. Local crosswalk: DB-9/10. |
| TB13-ERD-1 | Record entities | documented | ER guideline 1. F and L enumerate first-slice entities/storage responsibilities; deferred needs are retained in T. Local crosswalk: DB-1/2. |
| TB13-ERD-2 | Record attributes, keys and dependencies | documented | F/L record first-slice attributes, candidate/composite keys, dependencies and document/projection exceptions; ERD annotations are checked against SQL/model. Local crosswalk: DB-3/4/5. |
| TB13-ERD-3 | Draw and review initial ER model | documented | relational-erd.md contains four detailed ER views; independent semantic review is recorded in design-completion.md, including corrected composite-key labels. Local crosswalk: DB-2. |
| TB13-ERD-4 | Separate repeating/multivalued groups | documented | Separate membership/coverage/scan collections and their participation are represented in the ERD and proposed structural SQL; immutable document exceptions are explicit. Local crosswalk: DB-2/4. |
| TB13-ERD-5 | Check ER model through normalization | documented | ERD, logical relation/FD inventory and proposed SQL are cross-reviewed; finite-model normalization/decomposition results and semantic limitations remain explicit. Local crosswalk: DB-4. |

Chapter 13's Logical Design ending and [Open University's design section](https://www.open.edu/openlearn/science-maths-technology/the-database-development-life-cycle/content-section-1.5) require an end-design SQL DDL specification. A candidate schema table is not that output. The first-slice proposed-schema.sql now supplies structural DDL, while exact function algorithms/privilege manifests are design contracts. Later detailed family DDL remains a named milestone output. Installation, executable helper bodies and empirical qualification remain separate implementation work. NASA's phase-appropriate paper design allowance does not erase a missing output required by this separately selected textbook profile.

[Chapter 12](https://opentextbc.ca/dbdesign01/chapter/chapter-12-normalization/) supplies four named normalization stages: 1NF, 2NF, 3NF and BCNF. They are subordinate checks for the ER normalization guideline, counted separately for coverage rather than four additional project phases. Its worked School/Advisor examples and anomaly illustrations explain these stages; their example-specific bullets are not additional universal steps. No 4NF/5NF assessment is claimed by this profile.

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| TB12-NF-1 | First normal form | documented | Declared first-slice repeated facts and document exceptions are mapped to ERD/SQL; this is declared-model analysis, not proof that all future requirements are known. Local crosswalk: DB-4/5. |
| TB12-NF-2 | Second normal form | partial | Second Normal Form / Process for 2NF. L declares composite-key dependencies and decompositions; finite-model checks do not establish that all business dependencies were discovered. Local crosswalk: DB-4, TB13-ERD-5. |
| TB12-NF-3 | Third normal form | partial | Transitive dependencies, decomposition and owned redundancy are explicit. Model/ERD/SQL review is documented; actual NULL/constraint behavior and newly discovered business dependencies remain qualification concerns. Local crosswalk: DB-4. |
| TB12-NF-4 | Boyce-Codd normal form | partial | Boyce-Codd Normal Form and its examples. L checks declared determinants and keys with explicit exceptions; universal semantic completeness is not established. Local crosswalk: DB-4, TB13-ERD-5. |

The textbook's introductory normal-form summaries are not substituted for exact dependency definitions. In particular, the formal model tests every nontrivial FD determinant as a **superkey** for BCNF and tests candidate-key minimality separately; Chapter 12's candidate-key shorthand does not justify changing that rule. Normalization evidence is bounded to declared FDs and explicit storage/document exceptions. No checker can infer missing business dependencies from the same declarations it checks.

## Database lifecycle: 10 locally derived audit categories

These ten local categories organize this review; they are not the textbook's literal steps and cannot substitute for the TB crosswalk above. They group concerns from the [textbook lifecycle](https://opentextbc.ca/dbdesign01/chapter/chapter-13-database-development-process/), [conceptual/logical/physical progression](https://www.open.edu/openlearn/science-maths-technology/the-database-development-life-cycle/content-section-1.5), and [normalization analysis](https://bohr.wlu.ca/cp363/notes/theory/09_normalization.php). PostgreSQL details must match the version actually deployed; the current documentation explains [constraints](https://www.postgresql.org/docs/current/ddl-constraints.html) and [isolation](https://www.postgresql.org/docs/current/transaction-iso.html), but is not installed-version evidence.

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| DB-1 | Requirements | documented | T supplies atomic approved/derived requirements, exclusions, owner allocation and independent verification specifications for all C/F fields and constraints. |
| DB-2 | Conceptual relationships | documented | L specifies relation participation, optionality, stable identity, source alias, association, preference and provenance relationships; F remains the conceptual contract. |
| DB-3 | Logical relations | documented | L maps the bounded first-slice relations including acquisition policy, durable command, permits and authority scaffolding to exact storage/ERD/DDL responsibilities. Later family schemas have explicit design gates. |
| DB-4 | Normalize/decompose | documented | L records decomposition, lossless/dependency-preservation reasoning, declared normal forms and explicitly owned document/projection redundancy. Independent judgment remains necessary; declarations are not a runtime proof. |
| DB-5 | Domains and unknowns | partial | F/T and L select domains, unknown/null/empty handling, tagged evidence and proposed constraint semantics. Actual parser/SQL enforcement and deployed-version behavior require G6. |
| DB-6 | Temporal integrity | partial | L/B select timestamp authority, immutable history, D02 boundaries, generations and paper interleavings. Actual clock/lock behavior remains G6 qualification. |
| DB-7 | Transactions and constraints | partial | Same-transaction command/read authority, operator maintenance, aggregate acquisition and durable work are selected with exact algorithms. Real-role, trigger, commit/rollback and interleaving execution remains G6. |
| DB-8 | Physical design | partial | Proposed structural DDL, indexes, helper signatures/algorithms and privilege manifests now exist and receive independent review. Actual PostgreSQL parsing/installation/query plans/performance remain G6/G7. |
| DB-9 | Migration and population | partial | L/Q specify additive adoption, conflict census, abort criteria and rollback compatibility. No migration, population or isolated rehearsal was executed. |
| DB-10 | Testing and operation | deferred | T/B/Q provide test and operating specifications; target runtime/SQL/capacity/recovery execution and live operational evidence remain G6/G7. |

## NIST SSDF 1.1: all 19 active practices and 42 active tasks

Source: [SP 800-218 Table 1](https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.800-218.pdf). NIST calls for risk-based tailoring; this inventory is an evidence disposition, not a compliance score. Retired/moved IDs are not counted again: PW.3 → PW.4; PW.3.1 → PO.1.3; PW.3.2 → PW.4.4; PW.4.3 → PW.1.3; PW.4.5 → PW.4.1/PW.4.4; PW.5.2 → PW.5.1 example. Notional examples and mapped external standards are not additional mandatory tasks.

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| SSDF-PO.1.1 | Development security requirements | partial | Repository isolation/secret/test rules and target design requirements are recorded; organization-wide security requirement governance remains unassessed. |
| SSDF-PO.1.2 | Product security requirements | partial | T/B record source authority, freshness, denial and changed-surface requirements. Exact finite aggregate admission and command-lifetime obligations/allocation still need to be completed with their selected mechanisms; numeric quotas or coordinator guarantees are not invented. |
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
| SSDF-PW.1.2 | Maintain security rationale | partial | B/Q retain control rationale, alternatives and residual risks, including reopened acquisition and coordinator-loss command risks. Their mitigations are not yet selected; documented risks/stop conditions do not constitute completed secure-design decisions. |
| SSDF-PW.1.3 | Reuse security services | documented | Existing principal/session, restricted-role and audit owners retained; target enforcement unexecuted. |
| SSDF-PW.2.1 | Review security design | partial | Fresh independent review exposed and reopened admission/interface and live-command lifetime gaps. Corrections and future selected mechanisms require rereview; no full-application security audit, stakeholder workshop or implemented-control qualification is claimed. |
| SSDF-PW.4.1 | Qualify acquired components | unassessed | Runtime dependency/security inventory outside this document audit. G6/G7. |
| SSDF-PW.4.2 | Maintain shared components | partial | Selected design preserves shared auth, normalizer, worker, reader and publication owners. Actual changes and regression evidence remain G6. |
| SSDF-PW.4.4 | Verify supplier components | unassessed | No complete component vulnerability/license/provenance assessment performed. G7. |
| SSDF-PW.5.1 | Apply coding rules | deferred | Runtime implementation absent; repository rules must be applied during G6. |
| SSDF-PW.6.1 | Qualify build tooling | unassessed | Toolchain security posture not audited by document checks. G7. |
| SSDF-PW.6.2 | Configure build protections | unassessed | No broad compiler/interpreter/build configuration assessment. G6/G7. |
| SSDF-PW.7.1 | Plan code review | documented | T/B/L/Q identify risk-focused review surfaces: actual mutators, helper grants, fixed scope, connection fencing, failure atomicity and preserved callers before G6/G7 acceptance. |
| SSDF-PW.7.2 | Analyze source | partial | Relevant existing source and proposed adapters were inspected; future implementation code and executable security analysis remain G6 work. |
| SSDF-PW.8.1 | Plan executable testing | documented | Detailed requirement/security cases, admission failure schedules and full-scope acceptance plans are selected and independently reviewed. Actual executable target tests remain unimplemented/unexecuted. |
| SSDF-PW.8.2 | Execute security tests | deferred | Zero target runtime, SQL, race or adversarial tests executed. G6. |
| SSDF-PW.9.1 | Define secure defaults | partial | Closed outputs, same-transaction authority, role-authenticated operator maintenance, admission ceilings and no-bypass transport are selected. Actual secure configuration and environment validation remain implementation/activation evidence. |
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

Inventory: **97 NASA + 8 QAW + 9 ATAM + 6 textbook lifecycle + 5 ER guidelines + 4 normalization stages + 42 SSDF = 171 source-linked dispositions**, plus **10 locally derived DB categories**, for **181 rows**. These are mixed levels of activity, subordinate guideline and audit category; overlap is intentional and the sum is not a process-completion or assurance score. The earlier 166-row inventory omitted the literal textbook crosswalk and counted the ten local categories alongside published steps.

For this inventory, the checker detects missing/duplicate IDs and malformed statuses; companion checks validate artifact references and bidirectional allocation. Those checks cannot establish stakeholder participation, semantic completeness, satisfaction of a named method activity, or successful implementation. A reviewer must judge each row's evidence and unmet output.

Current dispositions: **75 documented, 69 partial, 0 gap, 26 deferred, 11 unassessed**. First-slice structural and interface artifacts now exist; the full plan records delegated policies and all known scope allocations. Later official/analytics detailed design, actual PostgreSQL enforcement, source rights/completeness, full capacity/cost, operational evidence, stakeholder participation and organization-wide practices remain explicitly limited. An authored artifact is not an executed activity or runtime pass.

## Full-build planning revision evidence

[The full plan](backend-build-plan.md), [69-obligation matrix](backend-coverage.md), [11 selected decisions](backend-decisions.md), [ERD](relational-erd.md), [proposed structural DDL](proposed-schema.sql) and [admission design](acquisition-admission-design.md) close the previously absent planning outputs at their stated scope. Independent review found and corrected retention, demand, structural-constraint, composite-key and operator-authorization conflicts. [Current gate evidence](design-completion.md) records the final review disposition. Runtime, later feature detailed design, source rights, full capacity, actual recovery and release remain separately required.
