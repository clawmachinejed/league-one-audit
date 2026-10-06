# Design verification and delivery evidence

Design revision **first-slice-design-v1**, October 6, 2026 UTC; application baseline `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`. The [design completion record](design-completion.md) supersedes the earlier audit for current readiness: G1–G5 provide a reviewed selected design; G6 implementation qualification and G7 transition/operation remain open. This is not a production or industry-certification result.

| Area | Evidence and limit |
| --- | --- |
| Local design | 108 atomic obligations and independent verification procedures, all 135 fields/26 constraints/25 types/22 FS families allocated in both directions; composed behavior, logical/physical design, quality alternatives, changed-surface threat/control and operating plan |
| Source identity | Local primary main and origin/main, protected GitHub main and Ready Vercel production matched the exact baseline at the latest read-only checkpoint; canonical binding is repository/main/apps/site. Primary checkout was clean and no open PR was observed before this design publication. No database/worker lease/cron census or release ownership is claimed. |
| Source evidence | Every explicit source-reference file in the checkpoint was compared with the same Git baseline and hashed with CRLF-to-LF normalization. This includes actual role provisioning and auth/account transaction limitations, not merely conceptual documentation. Source equality is not installed-catalog evidence. |
| Independent review | Three agent perspectives plus primary cross-review: requirements/methods, data/relational, behavior/security. Findings corrected include privilege/lock feasibility, semantic functional dependencies, historical aliases, repeat discovery, closed helper shapes, private timing receipts, diagnostic contracts and model-reference checks. Human signoff/workshop participation is not invented. |
| Mathematical analysis | Candidate-key closure and minimality; BCNF/3NF assertions only for declared normalized relations; explicit exceptions for documents/projections; lossless binary decomposition and preservation of declared dependencies. Exact counts/results are in [design-analysis](design-analysis.md). Omitted semantic dependencies remain a domain-review concern. |
| Documentation verification | Both offline checkers validate source anchors/hashes, exact generated views, local file/heading references, complete model/requirement allocations, D02/decision/denial invariants, and every one of the 166 methodology activity IDs. Actual assertion totals are emitted and copied to the completion receipt; assertions are not runtime tests. |
| Verification procedures | 108 requirement cases, 15 security schedules, six operating procedures and ten paper concurrency arguments are specified. These overlap and must not be summed into a fictional unique test total. All target runtime cases remain unexecuted. |
| Runtime/database tests | **0 target runtime cases executed.** No database connection, migration, production data change, SQL/RLS/race execution, new provider call or live target user validation occurred. Any ordinary application CI checks on the published branch test the existing application and are reported separately. |
| Branch and PR | Dedicated `codex/backend-reconciliation-recovery` branch in the attached managed worktree. Publication, exact SHA, draft PR, CI and actual preview results are captured in the portable completion receipt and final handoff; this document does not turn attempted publication into confirmed success. No merge authorization is inferred. |
| Merge / production | No merge or target production deployment. Runtime, public APIs, worker schedules, scoring, projections, provider configuration and production data are unchanged. D02 remains approved but not deployed. |
| Remaining work | G6 actual implementation/SQL/race/source qualification; G7 transition/rollback/sink permissions/retention/recovery/release evidence. D03/D04/D05 remain product gates for their affected activations. Later analytics/history/capacity/cost outcomes are not demonstrated. |

## Reproduce the checks

From the repository root:

```text
python docs/aggregator-backend/verify_foundation.py
python docs/aggregator-backend/verify_design.py
git diff --check
```

Use `--write` only after reviewed canonical edits. `verify_foundation.py` regenerates the field view; `verify_design.py` regenerates requirements and declared-model analysis. The scripts read explicit repository documentation/source paths and import only the documentation renderer and Python standard library. They do not load environment files, application modules, credentials, databases or provider endpoints.

The primary reviewer also exercises the FD analysis with a known transitive dependency, a nonminimal candidate key, a lossy decomposition and a lossless but dependency-losing decomposition. These are checker counterexample probes, not runtime acceptance tests. The generated proof is only about the supplied finite relation model; JSON internals, SQL NULL semantics, actual FKs, all-mutator coverage and timing need real qualification.

Earlier snapshots remain historical: `3b4d63c` was the bounded reconciliation and `473e32e` the methodology audit. Their narrower check totals/readiness findings are not reused as current evidence. The original audit's 166-row inventory is now updated with current artifact evidence and honest remaining lifecycle dispositions.

## Portable synchronization copy

The new named snapshot is `Backend Build Ground up - Design Reviewed/`, with sibling `backend-foundation-design-reviewed.zip` in the chat output directory. Its exact source commit, dirty status, file hashes, archive hash, checker outputs, branch/PR/preview status and limitations are in `backend-design-completion.json`. Earlier Reconciled and Methodology Audited packages remain intact.

The package is an exact committed documentation tree plus the source-reference files needed to reproduce offline checks, a portable README and manifest. It is not a runnable application replacement and directs readers back to the repository's sole normative entry. The original external Ground up folder remains unsynchronized and unchanged. Any later synchronization should install this named snapshot and redirect the entry point, rather than edit two independent sources.
