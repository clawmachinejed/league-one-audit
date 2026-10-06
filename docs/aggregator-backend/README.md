# Aggregator backend foundation

Target contract **backend-foundation-v1**; full planning revision **backend-build-plan-v1**, October 6, 2026 UTC. Start with [the full backend build plan](backend-build-plan.md), [coverage matrix](backend-coverage.md) and [delegated decisions](backend-decisions.md). They cover the entire approved aggregator mission and resolve D03-D05. The detailed first slice now includes [ER diagrams](relational-erd.md), [proposed structural DDL](proposed-schema.sql), [shared admission](acquisition-admission-design.md) and a same-transaction authority protocol. Independent integration review and current evidence are recorded in [design-completion.md](design-completion.md). Later detailed designs, target implementation/SQL tests, capacity, source qualification, operations and release remain explicit milestone gates.
## Authority and supersession

1. Explicit approved product behavior and repository safety instructions take precedence.
2. Current source, tests and migrations establish what exists. Fresh external evidence establishes only the observed deployed facts. Existing behavior is not automatic endorsement of target behavior.
3. [Contracts](contracts.md) owns semantics. [foundation.json](foundation.json) owns the exact first-slice field register, D02 value, selected policy references and acceptance IDs. [foundation-fields.md](foundation-fields.md) is its generated readable view. They are one definition with a consistency check, not independent contracts.
4. [Requirements](design-requirements.json), [relational design](relational-design.json), [behavior/security](behavior-security-design.json) and [quality/operations](quality-operations.md) refine those semantics into allocated design and verification obligations. Their readable views are linked below. [Design completion](design-completion.md) records the corrected G1–G7 status; [literal-method audit](literal-method-audit.md) records the latest findings; the [earlier audit](methodology-audit.md) remains dated evidence. [Reconciliation](reconciliation.md) records dispositions/adoption, [all methodology activities](methodology-steps.md) have current dispositions, and [verification](verification.md) records actual checks and delivery state.
5. Other files in this directory are source-era implementation notes, compatibility constraints or candidate designs. Their facts must be rechecked against their stated revision. They cannot override this target. In particular, the old nonexclusive-link sentence, unversioned-head proposal, global-year current selection, mandatory 36-object schema, old cadence proposals and earlier blanket readiness claims are superseded.

The previous September 28 entry point's claim that the design gate was met is superseded by the explicit gates below. Git history preserves that dated record. The Ground up planning folder is a transition input, not a second source of authority. Its physical schema, mapping, refresh and readiness documents remain candidates/dated evidence wherever not explicitly retained in the disposition log. The [original handoff and manifest](evidence/backend-workspace-handoff-manifest.json) identify the inputs; [policy approval history](evidence/backend-policy-register.json) preserves D02. Physical storage names in that historical policy file are proposals, not mandatory runtime configuration.

A portable package must be a byte-checked copy of this repository documentation, marked with source SHA, artifact hashes and dirty-worktree status. It must direct readers here and may not acquire independent normative edits. If the original Ground up folder cannot be updated, prepare a verified synchronization package inside the isolated worktree and report its location. The original drafts then remain unsynchronized and must not be represented as corrected.

## Read in this order

| Document | Purpose |
| --- | --- |
| [Contracts, sections 3, 8 and 11](contracts.md) | Versioned accepted heads, exclusive associations, per-league current selection, D02 and authorized delivery |
| [Generated field and case register](foundation-fields.md) | Capability → source → exact field → identity/constraint → acceptance case |
| [Atomic requirements and verification matrix](requirements-traceability.md) | 108 obligations, concrete design allocation, independent procedures and complete forward/reverse coverage |
| [Behavior and security design](behavior-security-design.md) | Context, trust, state/sequence/transition models, authorization, threat/control/oracle plan |
| [Relational and physical responsibility design](relational-design.md) | Keys/FDs/decompositions, cardinality, all field storage mappings, constraints, privileges, writer order and proof schedules |
| [Quality decisions and operating evidence](quality-operations.md) | Scenarios, alternatives, residual risks, diagnostic/retention rules, migration and transition plan |
| [Design completion and analysis](design-completion.md) | Review findings/dispositions and precise design-versus-runtime gate status |
| [Reconciliation and gated next slice](reconciliation.md) | Verified facts, retained/rejected proposals, adoption order and qualification gates |
| [Current method activity inventory](methodology-steps.md) | 181 dispositions: 171 source-linked activities/stages/guidelines and 10 local audit categories; artifact evidence and unperformed work distinguished |
| [Verification record](verification.md) | What was checked, independent review and what remains unverified |
| [Step 2 checklist](step-2-checklist.md) | Historical/internal screen bundle evidence; does not certify this target or authorize reader cutover |

## Binding product constraints

Sleeper is the only implemented league provider. Username lookup is read-only identification, not external ownership proof. Active L1 associations become exclusive in both directions under the target. L1 identity, provider identity, acquisition permission, team eligibility and follow preference remain separate. Current owner/co-manager evidence is required; commissioner or league membership alone is insufficient. Shared league facts belong to neither one L1 user nor one follow.

D02 is **sleeper-membership-access-v1**, maximum membership age **3,600 seconds**, approved but not deployed. Every allow expires from the latest successful qualifying verification; failed, partial/unqualified, cached or replayed evidence never restarts it. Complete removal denies sooner. Expiry suspends affected league serving, not L1 account/sign-in access, and cannot block independent revalidation. D03 claim recovery, D04 loss/regain follows and D05 last-follower collection/retention are selected in the delegated decision register; actual implementation and qualification remain required.

Each league advances after verified renewal and current membership; a portfolio may span years. Carry an existing follow only through a verified transition and never override a newer unfollow. Official facts remain separate from derived coverage. Preserve native settings and each league's actual scoring/roster/competition rules. The existing shared NFL acquisition, scorer, normalizer, worker lanes, exact-week behavior, clock-v1, immutable baselines and publication remain the owners.

## Gates and scope

The full-scope planning gate requires every enumerated need to have a chosen design direction, accountable role, milestone, dependencies and independent acceptance procedure. The first-slice detailed design adds exact structural and interface specifications. Later official/analytics milestones require their own reviewed field registers, ERDs, DDL and interfaces before implementation. This is not a claim that every later detailed schema or runtime case already exists.

The internal first slice remains qualified identification through shared current teams to authorized stored current-roster reads. The complete plan includes official current-season history/schedule, shared NFL analytics,500-league qualification, privacy, operations and staged cutover.45-second live-score scheduling and p95<=60-second additional score delay are selected targets, not demonstrated capacity. All existing pipeline owners, exact-week behavior, `clock-v1`, immutable baselines and both named leagues remain protected.

This is planning work. No target runtime, applied migration, production configuration, merge or deployment was performed. The prior audits remain dated evidence with current dispositions linked above.

Run `python docs/aggregator-backend/verify_foundation.py`, `python docs/aggregator-backend/verify_design.py` and `python docs/aggregator-backend/verify_backend_plan.py` for documentation consistency and declared-model analysis. Use `--write` only after deliberate canonical edits to refresh generated views. They do not qualify runtime, installed database constraints, provider completeness or production capacity. Merge/release must follow the complete verification and fresh identity checks under separate release authorization.
