# Aggregator backend foundation

Target contract **backend-foundation-v1**; completed bounded design revision **first-slice-design-v1**, October 6, 2026 UTC. This is the single target entry point for identification, discovery, shared current teams and authorized stored reads. The missing requirements, behavior, relational, quality and security/operating design is now supplied and independently reviewed in [design completion](design-completion.md). G1–G5 form the selected design baseline for the internal slice. Runtime implementation and SQL qualification (G6), transition/operation (G7) and applicable product activation decisions remain open.

## Authority and supersession

1. Explicit approved product behavior and repository safety instructions take precedence.
2. Current source, tests and migrations establish what exists. Fresh external evidence establishes only the observed deployed facts. Existing behavior is not automatic endorsement of target behavior.
3. [Contracts](contracts.md) owns semantics. [foundation.json](foundation.json) owns the exact first-slice field register, D02 value, open decisions and acceptance IDs. [foundation-fields.md](foundation-fields.md) is its generated readable view. They are one definition with a consistency check, not independent contracts.
4. [Requirements](design-requirements.json), [relational design](relational-design.json), [behavior/security](behavior-security-design.json) and [quality/operations](quality-operations.md) refine those semantics into allocated design and verification obligations. Their readable views are linked below. [Design completion](design-completion.md) records current G1–G7 status; the [earlier audit](methodology-audit.md) remains dated evidence. [Reconciliation](reconciliation.md) records dispositions/adoption, [all methodology activities](methodology-steps.md) have current dispositions, and [verification](verification.md) records actual checks and delivery state.
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
| [Current method activity inventory](methodology-steps.md) | All 166 selected activities, completed design evidence and explicit remaining lifecycle work |
| [Verification record](verification.md) | What was checked, independent review and what remains unverified |
| [Step 2 checklist](step-2-checklist.md) | Historical/internal screen bundle evidence; does not certify this target or authorize reader cutover |

## Binding product constraints

Sleeper is the only implemented league provider. Username lookup is read-only identification, not external ownership proof. Active L1 associations become exclusive in both directions under the target. L1 identity, provider identity, acquisition permission, team eligibility and follow preference remain separate. Current owner/co-manager evidence is required; commissioner or league membership alone is insufficient. Shared league facts belong to neither one L1 user nor one follow.

D02 is **sleeper-membership-access-v1**, maximum membership age **3,600 seconds**, approved but not deployed. Every allow expires from the latest successful qualifying verification; failed, partial/unqualified, cached or replayed evidence never restarts it. Complete removal denies sooner. Expiry suspends affected league serving, not L1 account/sign-in access, and cannot block independent revalidation. D03 claim recovery, D04 loss/regain follows and D05 last-follower collection/retention remain open at their named activation gates.

Each league advances after verified renewal and current membership; a portfolio may span years. Carry an existing follow only through a verified transition and never override a newer unfollow. Official facts remain separate from derived coverage. Preserve native settings and each league's actual scoring/roster/competition rules. The existing shared NFL acquisition, scorer, normalizer, worker lanes, exact-week behavior, clock-v1, immutable baselines and publication remain the owners.

## Gates and scope

The [design-completeness gate](reconciliation.md#design-completeness-gate) is supplied by the reviewed artifacts above. The next engineering work is implementation and qualification of the selected internal path, using the explicit requirements/oracles and preserving current owners. Mathematical checks establish declared key/FD/decomposition properties; independent reviews address semantic assumptions and cross-artifact consistency. Neither proves actual database enforcement or live source behavior. Those have named owners and G6/G7 stop conditions, not implicit passes.

With separate implementation authorization, the first implementation slice remains an internal shared service path from qualified pre-enrollment identification through shared current teams to an authorized stored current-roster read. It needs exact field/constraint implementation, same-path unit and guarded disposable SQL tests, unrelated-league source qualification and independent review. Those executable qualifications are later gates; a design review cannot close them. No website UX, public API cutover, migration execution, schedule change or release is authorized by this design.

Current-season recoverable history, remaining published schedule and analytical coverage are later milestones. The 500-distinct-leagues-per-supported-provider and approximately 60-second additional L1 score-delay targets are not demonstrated. Proposed cadence, retry, concurrency, percentile and approximately $50 supporting-feed budget figures are not accepted performance results or deployed policy. No table count is mandated.

Run `python docs/aggregator-backend/verify_foundation.py` and `python docs/aggregator-backend/verify_design.py` for documentation consistency and declared-model analysis. Use `--write` only after deliberate canonical edits to refresh generated views. They do not qualify runtime, installed database constraints, provider completeness or production capacity. Merge/release must follow the complete verification and fresh identity checks under separate release authorization.
