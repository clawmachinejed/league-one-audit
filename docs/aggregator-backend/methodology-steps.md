# Complete inventory for the selected audit profile

Read [audit verdict, findings and gates](methodology-audit.md) first. IDs refer to published activities; labels are short paraphrases. Each row is an assessment of this proposed backend slice, not an organization-wide conformity result. Every selected activity has a disposition; none is silently skipped. Status is **documented** (bounded artifact exists), **partial** (incomplete evidence), **gap** (required design artifact absent), **deferred** (later implementation/activation), or **unassessed** (evidence outside this review). No status means a runtime test passed.

G1–G7 are defined in the audit. Existing evidence abbreviations: **C** = [contracts](contracts.md), **F** = [field register](foundation-fields.md), **R** = [reconciliation](reconciliation.md), **V** = [verification](verification.md), **H** = [preserved handoff](evidence/backend-workspace-handoff.md), **P** = [policy register](evidence/backend-policy-register.json). A cited document supports only the specific statement in its row.

## NASA: 17 processes, 97 detailed activities

Published basis: [design processes §§4.1–4.4](https://www.nasa.gov/reference/4-0-system-design-processes/), [realization §§5.1–5.5](https://www.nasa.gov/reference/5-0-product-realization/) and [technical management §§6.1–6.8](https://www.nasa.gov/reference/6-0-crosscutting-technical-management/). Coverage is each numbered activity under each process's `.1.2` subsection; inputs, outputs and general discussion are context rather than additional counted activities. Implementation and management processes are iterative, not a requirement to force a waterfall lifecycle.

### 4.1 — Stakeholder expectations

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-4.1.1.2.1 | Identify roles | partial | H supplies manager/product authority; R now records operational and review roles. Confirm coverage at G1. |
| NASA-4.1.1.2.2 | Understand needs | partial | H/P preserve approved behavior; no new stakeholder interviews or validation inferred. G1. |
| NASA-4.1.1.2.3 | Frame outcomes | documented | README/H establish shared portfolio, official authority and bounded first slice; capacity stays a target. |
| NASA-4.1.1.2.4 | Operating concept | partial | C describes normal/degraded behavior; composed manager and operator walkthroughs remain G2. |
| NASA-4.1.1.2.5 | Check statements | partial | D02 has exact semantics; other grouped statements still need atomic obligations at G1. |
| NASA-4.1.1.2.6 | Outcome measures | partial | D02 is measurable; onboarding completeness and later delay/capacity need qualification definitions. G1/G6. |
| NASA-4.1.1.2.7 | Trace expectations | gap | Selective capability map does not prove need-to-obligation coverage. M01/G1. |
| NASA-4.1.1.2.8 | Obtain commitments | partial | P preserves D02 approval; D03–D05 remain open; no invented design signoff. |
| NASA-4.1.1.2.9 | Baseline expectations | documented | H/P retain approved evidence with hashes and explicit scope; new policy remains gated. |
| NASA-4.1.1.2.10 | Retain artifacts | documented | V records immutable input copies, baseline and source hashes. |

### 4.2 — Technical requirements

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-4.2.1.2.1 | Bound behavior | partial | C records owners and limits; full function/constraint allocation remains G1/G2. |
| NASA-4.2.1.2.2 | Derive obligations | partial | F/C contain obligations but lack complete atomic IDs and rationale. G1. |
| NASA-4.2.1.2.3 | Check wording | partial | Exact denial shapes and D02 exist; assess every obligation for singularity/verifiability at G1. |
| NASA-4.2.1.2.4 | Validate requirements | partial | Source/approval consistency inspected; intended-use walkthrough and stakeholder concern coverage remain G1/G2. |
| NASA-4.2.1.2.5 | Engineering measures | partial | Exact boundary/race outcomes exist; no measured runtime performance or approved extra SLO. G1/G6. |
| NASA-4.2.1.2.6 | Baseline requirements | partial | Versioned conceptual contract exists; complete requirements baseline waits for G1–G5. |
| NASA-4.2.1.2.7 | Retain requirements | documented | Canonical JSON, generated view and Git history retain the current bounded contract. |

### 4.3 — Logical decomposition

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-4.3.1.2.1 | Model behavior | gap | No unified sequence/state model of authorization and recovery. M02/G2. |
| NASA-4.3.1.2.2 | Allocate and reconcile | partial | R retains shared owners; complete requirement/interface allocation and cross-model consistency remain G1/G2/G4. |
| NASA-4.3.1.2.3 | Retain models | partial | Existing prose retained; reviewed G2 models must join the same baseline. |

### 4.4 — Design solution

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-4.4.1.2.1 | Frame alternatives | partial | R rejects blanket new schema and duplicate owners; scenario-driven comparison remains G3. |
| NASA-4.4.1.2.2 | Develop candidates | partial | Existing-owner adaptations are selected provisionally; alternative protocols need G3/G4 analysis. |
| NASA-4.4.1.2.3 | Evaluate candidates | gap | No prioritized quality tradeoff record. M03/G3. |
| NASA-4.4.1.2.4 | Select solution | partial | R contains reconciliation decisions; their quality implications need G3 review. |
| NASA-4.4.1.2.5 | Resolve details | partial | F is conceptual; transaction and relational enforcement remain G4. |
| NASA-4.4.1.2.6 | Describe design | partial | C/F define important interfaces; G1–G5 complete the reviewable design package. |
| NASA-4.4.1.2.7 | Verify design | partial | This audit corrects ambiguities; no relational/concurrency proof or complete requirement coverage. G1/G4. |
| NASA-4.4.1.2.8 | Validate design | gap | No complete intended-use and degraded-operation walkthrough against stakeholder concerns. G2/G3. |
| NASA-4.4.1.2.9 | Plan support | partial | Isolated harness/release owners reused; observability, rehearsal and support artifacts remain G5/G7. |
| NASA-4.4.1.2.10 | Baseline solution | deferred | Only conceptual reconciliation is baselined. Design baseline waits for G1–G5. |

### 5.1 — Implementation

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-5.1.1.2.1 | Prepare build | partial | R defines internal slice; G1–G5 must precede a runtime/persistence baseline. |
| NASA-5.1.1.2.2 | Acquire or construct | deferred | Reuse choices documented; target runtime construction and integration are G6 work. |
| NASA-5.1.1.2.3 | Retain build evidence | deferred | Future source changes, dependency provenance and actual checks must be captured at G6/G7. |

### 5.2 — Integration

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-5.2.1.2.1 | Plan assembly | partial | R gives order; interface assumptions and failure boundaries need G2/G4. |
| NASA-5.2.1.2.2 | Obtain components | deferred | Actual target implementation not built; retained source is reference evidence. G6. |
| NASA-5.2.1.2.3 | Check components | deferred | Require qualified versions and service/SQL results, not source presence alone. G6. |
| NASA-5.2.1.2.4 | Prepare environment | deferred | Existing isolated harness identified; no database provisioned or guard bypassed. G6. |
| NASA-5.2.1.2.5 | Assemble path | deferred | Identification-to-authorized-read path must run through existing owners. G6. |
| NASA-5.2.1.2.6 | Support assembly | deferred | Fixtures, source qualification and controlled failure injection remain G6. |
| NASA-5.2.1.2.7 | Retain results | deferred | Capture actual integration outcomes and unresolved anomalies at G6. |

### 5.3 — Verification

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-5.3.1.2.1 | Plan proof | partial | FS01–FS22 specify grouped outcomes; independent oracles/methods and full coverage remain G1. |
| NASA-5.3.1.2.2 | Execute proof | deferred | Offline document checks ran; target runtime/SQL/race tests did not. G6. |
| NASA-5.3.1.2.3 | Assess results | partial | V correctly separates consistency from runtime proof; runtime anomalies await G6. |
| NASA-5.3.1.2.4 | Retain proof | partial | Document results preserved; actual runtime evidence and coverage receipts remain G6/G7. |

### 5.4 — Validation

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-5.4.1.2.1 | Plan user validation | gap | Manager/co-manager and operator end-to-end acceptance matrix needs G1/G2. |
| NASA-5.4.1.2.2 | Exercise intended use | deferred | No live or isolated target journey exists. G6, with product decisions at their gates. |
| NASA-5.4.1.2.3 | Assess fitness | deferred | Source consistency does not prove portfolio utility or recovery usability. G6/G7. |
| NASA-5.4.1.2.4 | Retain validation | deferred | Record user-workflow results and exceptions when executed. G6/G7. |

### 5.5 — Transition

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-5.5.1.2.1 | Plan transfer | partial | Migration compatibility concerns exist; detailed rehearsal and rollback boundary remain G7. |
| NASA-5.5.1.2.2 | Prepare destination | deferred | Runtime roles, catalog, monitoring and production ownership need fresh G7 checks. |
| NASA-5.5.1.2.3 | Prepare release | deferred | No target build/preview or cutover authorization. G7. |
| NASA-5.5.1.2.4 | Transfer product | deferred | Nothing merged, deployed or migrated; user release authority required at G7. |
| NASA-5.5.1.2.5 | Retain transfer evidence | deferred | Exact merged/deployed SHA and both-league evidence required at G7. |

### 6.1 — Technical planning

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-6.1.1.2.1 | Frame planning | documented | README/H bound the deliverable, owners and exclusions. |
| NASA-6.1.1.2.2 | Define work | partial | R/G1–G7 identify deliverables; implementer must allocate execution work explicitly. |
| NASA-6.1.1.2.3 | Resource the work | unassessed | No approved staffing, dates or implementation budget; do not infer commitments from proposed costs. |
| NASA-6.1.1.2.4 | Prepare technical plans | partial | R plus this audit define gates; test/security/migration plans remain incomplete. |
| NASA-6.1.1.2.5 | Secure commitments | partial | Documentation mandate and D02 approved; runtime/release authority absent. |
| NASA-6.1.1.2.6 | Direct work | documented | Existing repository rules, isolated worktree and scoped roles govern this audit. |
| NASA-6.1.1.2.7 | Retain planning | documented | R, audit and versioned handoff preserve scope and open work. |

### 6.2 — Requirements management

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-6.2.1.2.1 | Plan requirement control | partial | Single normative entry exists; atomic trace/change impact procedure remains G1. |
| NASA-6.2.1.2.2 | Manage obligations | partial | P and R retain decisions; full obligation ledger still missing. |
| NASA-6.2.1.2.3 | Maintain trace | gap | Forward and reverse trace not complete. M01/G1. |
| NASA-6.2.1.2.4 | Control changes | partial | Git and approved-policy preservation exist; per-obligation impact links remain G1. |
| NASA-6.2.1.2.5 | Track issues | documented | M01–M14 and D03–D05 have explicit dispositions and gates. |
| NASA-6.2.1.2.6 | Retain decisions | documented | P/H, reconciliation dispositions and audit findings preserved. |

### 6.3 — Interface management

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-6.3.1.2.1 | Plan interface control | partial | Shared owner boundaries defined; G2/G4 must define protocol change impact. |
| NASA-6.3.1.2.2 | Specify interfaces | partial | C/F typed ports exist; coherent fencing and full relationship models need G2/G4. |
| NASA-6.3.1.2.3 | Qualify composition | deferred | Actual service/SQL and hostile-reference tests remain G6. |
| NASA-6.3.1.2.4 | Control interfaces | partial | Existing routes/payloads preserved by scope; future contract changes need G1/G6 review. |
| NASA-6.3.1.2.5 | Retain interfaces | documented | C/F and source anchors retain the conceptual interface baseline. |

### 6.4 — Technical risk

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-6.4.1.2.1 | Frame risk work | partial | Audit prioritizes correctness/security; explicit tolerance and review triggers need G3/G5. |
| NASA-6.4.1.2.2 | Identify risks | documented | M findings, D decisions and source constraints expose concrete risks; not exhaustive threat coverage. |
| NASA-6.4.1.2.3 | Assess risks | partial | Concrete counterexamples supplied; likelihood/impact and scenario priority remain G3/G5. |
| NASA-6.4.1.2.4 | Plan mitigation | partial | G1–G7 assign closure; protocol/security control selection remains G4/G5. |
| NASA-6.4.1.2.5 | Reassess risks | deferred | Revisit findings at each design, source, policy and release change; no recurring monitor created. |
| NASA-6.4.1.2.6 | Execute responses | partial | Narrow contract/prose fixes made; executable mitigation and rollback remain G6/G7. |
| NASA-6.4.1.2.7 | Retain risks | documented | Finding table records evidence, disposition and closure requirements. |

### 6.5 — Configuration management

The published web page labels the last two activities in §6.5 as `6.4.1.2.5` and `6.4.1.2.6`. Below, `NASA-6.5.activity5` and `NASA-6.5.activity6` unambiguously identify their location under configuration management; they do not duplicate the risk activities or silently correct the source's numbering.

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-6.5.1.2.1 | Plan baselines | documented | Repository is authoritative; target entry and portable-copy relationship defined. |
| NASA-6.5.1.2.2 | Identify configuration | documented | Application baseline, input hashes, source fingerprints and versioned target identified. |
| NASA-6.5.1.2.3 | Control revisions | partial | Isolated branch and review exist; unpushed local work has not passed PR/release gates. |
| NASA-6.5.1.2.4 | Account for status | documented | V separates local artifact, publication, preview, merge and production state. |
| NASA-6.5.activity5 | Audit configuration | partial | Main/GitHub/Vercel binding and hashes checked; installed database catalog unverified. G6/G7. |
| NASA-6.5.activity6 | Retain configuration | documented | Git snapshot and versioned portable manifest preserve the reviewed documentation. |

### 6.6 — Technical data

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-6.6.1.2.1 | Plan data handling | partial | Source evidence retained without secrets; runtime event privacy/retention remains G5. |
| NASA-6.6.1.2.2 | Preserve evidence | documented | H/P and source hashes preserved; unavailable historic catalog explicitly unclaimed. |
| NASA-6.6.1.2.3 | Deliver authorized data | partial | Local portable review snapshot supplied; original folder unsynchronized, no external publication. |

### 6.7 — Technical assessment

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-6.7.1.2.1 | Plan assessments | documented | Three method-focused reviews, source checks and explicit status definitions used here. |
| NASA-6.7.1.2.2 | Assess progress | partial | Design audit identifies open gates; no runtime quality/performance result inferred. |
| NASA-6.7.1.2.3 | Retain assessments | documented | Audit and V preserve findings, corrections, limits and evidence. |

### 6.8 — Decision analysis

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| NASA-6.8.1.2.1 | Set criteria | partial | Preserve existing owners/policies; prioritize quality scenarios at G3. |
| NASA-6.8.1.2.2 | Enumerate options | partial | R retains rejected approaches; protocol/storage alternatives remain G3/G4. |
| NASA-6.8.1.2.3 | Choose analysis | documented | Published method profile and three independent perspectives explicitly selected. |
| NASA-6.8.1.2.4 | Compare options | gap | No completed scenario-driven tradeoff analysis. G3. |
| NASA-6.8.1.2.5 | Recommend choice | partial | Existing-owner adaptation recommended; residual risk acceptance remains at appropriate gates. |
| NASA-6.8.1.2.6 | Report choice | documented | R states retained/rejected proposals; D03–D05 are not silently decided. |
| NASA-6.8.1.2.7 | Retain rationale | documented | Reconciliation and audit preserve decision rationale and uncertainty. |

## SEI: all 8 QAW and 9 ATAM steps

Source step descriptions: [QAW third edition](https://www.sei.cmu.edu/asset_files/TechnicalNote/2003_004_001_14201.pdf), [ATAM method report](https://sei.cmu.edu/documents/629/2000_005_001_13706.pdf). The following rows assess prerequisites and current artifacts. They do not assert that a workshop occurred or all stakeholder interests were represented.

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| QAW-1 | Explain process | documented | This audit identifies method, participants' roles and limits. |
| QAW-2 | Present drivers | partial | H/README supply business outcomes; prioritized concern confirmation remains G3. |
| QAW-3 | Present architecture | partial | R/C describe retained owners; composed models remain G2. |
| QAW-4 | Identify drivers | partial | Security, correctness, recovery and sharing apparent; explicit quality priorities remain G3. |
| QAW-5 | Generate scenarios | partial | FS cases supply scenarios; no broader stakeholder elicitation claimed. G3. |
| QAW-6 | Consolidate scenarios | gap | No reviewed scenario grouping with lost/duplicate concerns disposition. G3. |
| QAW-7 | Prioritize scenarios | gap | No agreed priorities or votes; G3 must document actual decision authority. |
| QAW-8 | Refine scenarios | partial | D02 and adverse interleavings precise; complete stimulus/context/measure records remain G3. |
| ATAM-1 | Explain evaluation | documented | Audit scope, evidence and non-certification limits recorded. |
| ATAM-2 | Present drivers | partial | H/README establish product drivers; explicit quality ranking remains G3. |
| ATAM-3 | Present architecture | partial | C/R available; G2 model needed to make interactions reviewable. |
| ATAM-4 | Identify approaches | partial | Shared versioned heads, owners and serving binding retained; compare alternatives at G3. |
| ATAM-5 | Rank quality scenarios | gap | No completed utility/prioritization tree or equivalent. G3. |
| ATAM-6 | Analyze approaches | partial | This audit found counterexamples; systematic scenario/approach matrix remains G3/G4. |
| ATAM-7 | Broaden scenarios | gap | No stakeholder workshop; record concern coverage and priorities honestly at G3. |
| ATAM-8 | Reanalyze approaches | partial | Corrections challenged by independent reviewers; complete sensitivities/tradeoffs remain G3. |
| ATAM-9 | Present findings | documented | M01–M14 report concrete findings, limits and residual gates; no completed ATAM claim. |

## Database lifecycle: all 10 declared audit categories

These audit IDs decompose the [textbook lifecycle](https://opentextbc.ca/dbdesign01/chapter/chapter-13-database-development-process/), [conceptual/logical/physical progression](https://www.open.edu/openlearn/science-maths-technology/the-database-development-life-cycle/content-section-1.5), and [normalization analysis](https://bohr.wlu.ca/cp363/notes/theory/09_normalization.php). PostgreSQL details must match the version actually deployed; the current documentation explains [constraints](https://www.postgresql.org/docs/current/ddl-constraints.html) and [isolation](https://www.postgresql.org/docs/current/transaction-iso.html), but is not installed-version evidence.

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| DB-1 | Requirements | partial | Strong semantics in C/F; complete approved-obligation trace remains G1. |
| DB-2 | Conceptual relationships | partial | M04/M05 corrected; cardinality and optional participation need G4. |
| DB-3 | Logical relations | gap | Relations, candidate keys, FDs and same-league relationships not fully specified. G4. |
| DB-4 | Normalize/decompose | gap | No update-anomaly/lossless/dependency-preservation analysis or justified redundancy record. G4. |
| DB-5 | Domains and unknowns | partial | F separates absent/null/empty/invalid; executable validators and SQL null semantics remain G4/G6. |
| DB-6 | Temporal integrity | partial | D02, source/processing times and remap generations specified; composed proof remains G4/G6. |
| DB-7 | Transactions and constraints | partial | Race outcomes named; exact uniqueness/FK/role/lock/isolation/retry proof remains G4/G6. |
| DB-8 | Physical design | deferred | No new SQL schema/index/query plan qualified; actual database version/catalog required. G4/G6. |
| DB-9 | Migration and population | deferred | Adoption seams documented; conflict census, reconciliation and rollback rehearsal remain G7. |
| DB-10 | Testing and operation | deferred | No runtime/SQL/capacity/recovery execution for the new slice. G6/G7. |

## NIST SSDF 1.1: all 19 active practices and 42 active tasks

Source: [SP 800-218 Table 1](https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.800-218.pdf). NIST calls for risk-based tailoring; this inventory is an evidence disposition, not a compliance score. Retired/moved IDs are not counted again: PW.3 → PW.4; PW.3.1 → PO.1.3; PW.3.2 → PW.4.4; PW.4.3 → PW.1.3; PW.4.5 → PW.4.1/PW.4.4; PW.5.2 → PW.5.1 example. Notional examples and mapped external standards are not additional mandatory tasks.

| Activity | Focus | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| SSDF-PO.1.1 | Development security requirements | partial | Repository isolation/secret/test rules known; organization-wide requirements unassessed. G5/G7. |
| SSDF-PO.1.2 | Product security requirements | partial | C contains denial/freshness rules; full threat/control trace remains G1/G5. |
| SSDF-PO.1.3 | Supplier requirements | unassessed | Existing provider/hosting roles identified; supplier security commitments not evaluated here. G5/G7. |
| SSDF-PO.2.1 | Assign responsibilities | partial | R records role concerns; actual implementation/release assignments still needed. |
| SSDF-PO.2.2 | Train contributors | unassessed | This audit did not examine personnel training or competency records. |
| SSDF-PO.2.3 | Obtain sponsorship | partial | User authorized audit and preserved policy; no broad organizational program attestation. |
| SSDF-PO.3.1 | Select supporting tools | partial | Offline checker and isolated harness identified; runtime security-tool coverage remains G6. |
| SSDF-PO.3.2 | Operate toolchain | unassessed | CI protection/configuration and tool authenticity not comprehensively assessed. G7. |
| SSDF-PO.3.3 | Collect tool evidence | partial | Documentation checks retained; build/security evidence automation remains G6/G7. |
| SSDF-PO.4.1 | Define security gates | partial | G1–G7 defined; complete applicable-control and test criteria remain G5/G6. |
| SSDF-PO.4.2 | Preserve gate evidence | partial | Hashes and review findings retained; safe runtime evidence contract remains G5. |
| SSDF-PO.5.1 | Isolate environments | partial | Dedicated worktree and guarded DB policy respected; full environment control effectiveness unassessed. |
| SSDF-PO.5.2 | Protect developer endpoints | unassessed | Device hardening/access controls were not audited. |
| SSDF-PS.1.1 | Protect source assets | partial | Canonical repo and immutable evidence referenced; repository ACL review not performed. |
| SSDF-PS.2.1 | Verify release integrity | deferred | Portable hashes protect this review copy; application release verification remains G7. |
| SSDF-PS.3.1 | Retain release artifacts | deferred | Local docs captured; actual application release archive/provenance remains G7. |
| SSDF-PS.3.2 | Retain component provenance | partial | 24 source references hashed; full runtime dependency/provenance inventory unassessed. G7. |
| SSDF-PW.1.1 | Model threats | gap | Changed-surface trust/action/control/test matrix absent. M09/G5. |
| SSDF-PW.1.2 | Maintain security rationale | partial | C/P/audit retain decisions; complete risk-control trace and exceptions remain G5. |
| SSDF-PW.1.3 | Reuse security services | documented | Existing principal/session, restricted-role and audit owners retained; target enforcement unexecuted. |
| SSDF-PW.2.1 | Review security design | partial | Three reviews found and corrected gaps; G1–G5 remain open. |
| SSDF-PW.4.1 | Qualify acquired components | unassessed | Runtime dependency/security inventory outside this document audit. G6/G7. |
| SSDF-PW.4.2 | Maintain shared components | partial | Single normalizer/worker/reader path preserved; target changes require G6. |
| SSDF-PW.4.4 | Verify supplier components | unassessed | No complete component vulnerability/license/provenance assessment performed. G7. |
| SSDF-PW.5.1 | Apply coding rules | deferred | Runtime implementation absent; repository rules must be applied during G6. |
| SSDF-PW.6.1 | Qualify build tooling | unassessed | Toolchain security posture not audited by document checks. G7. |
| SSDF-PW.6.2 | Configure build protections | unassessed | No broad compiler/interpreter/build configuration assessment. G6/G7. |
| SSDF-PW.7.1 | Plan code review | partial | Independent review planned; complete risk-based implementation review selection remains G6. |
| SSDF-PW.7.2 | Analyze source | partial | Relevant existing source inspected; target implementation and full security analysis unperformed. G6. |
| SSDF-PW.8.1 | Plan executable testing | partial | FS cases exist; independent fixture/oracle and control coverage remain G1/G5/G6. |
| SSDF-PW.8.2 | Execute security tests | deferred | Zero target runtime, SQL, race or adversarial tests executed. G6. |
| SSDF-PW.9.1 | Define secure defaults | partial | Deny/indeterminate shapes and finite freshness defined; config/privilege default matrix remains G4/G5. |
| SSDF-PW.9.2 | Implement secure defaults | deferred | No runtime changes deployed; exact enforcement and docs require G6/G7. |
| SSDF-RV.1.1 | Receive vulnerability reports | unassessed | Organization-wide intake, component monitoring and investigation program not reviewed. |
| SSDF-RV.1.2 | Find residual weaknesses | partial | Target design challenged; ongoing released-code assessment remains unassessed. |
| SSDF-RV.1.3 | Define disclosure response | unassessed | No claim about existing disclosure/response policy; require responsible operator before activation. G7. |
| SSDF-RV.2.1 | Assess reported weaknesses | partial | M findings independently reproduced as design gaps, not production vulnerabilities. |
| SSDF-RV.2.2 | Respond to weaknesses | partial | Contract ambiguities corrected; future runtime mitigation/testing remains G6. |
| SSDF-RV.3.1 | Identify root causes | documented | M04–M07 identify identity provenance/key/protocol causes rather than cosmetic symptoms. |
| SSDF-RV.3.2 | Examine recurring patterns | partial | This audit exposes consistency-check overclaim; longitudinal incident analysis unassessed. |
| SSDF-RV.3.3 | Find related weaknesses | partial | All 17 records and composed contracts reviewed; broader application vulnerability search not claimed. |
| SSDF-RV.3.4 | Improve development process | documented | README/R now impose explicit design gates and preserve the corrected evidence boundary. |

## Coverage boundary and future re-audit

Inventory: **97 NASA + 8 QAW + 9 ATAM + 10 database + 42 SSDF = 166 activity dispositions**. Many activities overlap; adding counts does not measure assurance. The checker only detects missing/duplicate inventory IDs and malformed statuses. A reviewer must still judge each disposition and its evidence.

The supplementary OWASP/PostgreSQL checks are intentionally focused, with their exact sources and findings in the audit. A full ASVS assessment, all clauses of paid ISO standards, every referenced standard, aerospace-specific governance, organizational staffing/training, broad supply-chain audit, installed database enforcement and live product validation are **not established**. These limits are explicit rather than converted into passes or silently omitted. Revisit relevant rows when G1–G7 artifacts, code, policy or service identity change; do not reuse this snapshot as future release evidence.
