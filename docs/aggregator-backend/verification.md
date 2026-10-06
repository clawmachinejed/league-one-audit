# Reconciliation verification

October 5, 2026; target backend-foundation-v1; source baseline `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`. This records a documentation deliverable, not implementation or release acceptance.

| Area | Result and limit |
| --- | --- |
| Local deliverable | Reconciled entry point, existing contracts corrected, exact field/case register, generated view, source/disposition/adoption plan, preserved transition evidence and offline checker |
| Repository and deployment identity | Clean primary main, isolated starting HEAD, GitHub main and Ready Vercel production matched the source baseline; source binding is canonical repository/main/apps/site. See [checkpoint](evidence/source-checkpoint.json) and [evidence scope](reconciliation.md). No new database or worker-lease audit. |
| Input preservation | All eight original handoff artifact hashes matched. Handoff and D02 approval copies retain original bytes; original manifest retained. Earlier full catalog capture remains unavailable. |
| Source trace | 24 source/migration/configuration files have SHA-256 hashes after CRLF-to-LF normalization (`sha256-lf-v1`) plus 14 named source facts/anchors. Only line-ending representation is normalized; content changes fail. Original transition evidence retains byte hashes and local Git attributes prevent conversion. Source presence is not deployed function-body proof. |
| Register consistency | 17 logical records, 132 fields, six capability traces, 22 specified acceptance cases. The final offline check passes 459 assertions covering field references, uniqueness, source anchors/hashes, explicit hash algorithm, D02 value/origin/status, open decisions, discriminated denial shapes, generated rendering, local links and preserved input hashes. Counts reflect consistency assertions, not runtime cases. |
| Independent review | Fresh recovery reviewer inspected handoff/policy, actual source/migrations and target documents. Three findings corrected: denied-result shape and metadata exclusion, native versus internal manager identity, and the exact SQL function name. Final reviewer recheck found no documentation blockers, including the added account/lookup scopes and result types, and independently passed all 458 checks. This is bounded documentation review, not runtime, database or deployment qualification. |
| Runtime tests | **0 executed.** FS01–FS22 are specified cases, not passing application tests. No SQL tests, full verify/build, preview or browser journey suite was run; scope is documentation only. |
| Branch publication | Local branch `codex/backend-reconciliation-recovery` in the managed worktree attached to this chat; not pushed. No PR created. No merge or deployment is authorized. Remote publication and actual preview are unperformed, an explicit deviation from the normal branch-and-PR delivery workflow for this local documentation recovery. A later publication task must inspect the actual preview and complete applicable repository checks before merge. |
| Merge / production | Not merged; no deployment, migration, production data, cron, provider configuration, public API or website behavior changed. Existing production was inspected read-only for identity. |
| Open gates | D03 public claim recovery, D04 genuine loss/regain follow behavior and D05 last-follower collection/retention. Finite cold-start discovery qualification, persistence/race/RLS proof, exact affected SQL catalog reconciliation, analytics applicability adoption, history coverage, 500-league delay and cost measurements remain unverified. |

## Reproduce the documentation check

From repository root run:

```text
python docs/aggregator-backend/verify_foundation.py
git diff --check
```

`--write` regenerates the readable field view from the canonical JSON after a deliberate reviewed edit. The script is offline and reads only explicit documentation and source paths. It never loads environment files, application modules, database credentials or provider endpoints. A passed check validates declared consistency only; semantic and executable qualifications remain separate.

## Portable synchronization copy

The prepared location is `Backend Build Ground up - Reconciled/` in this chat's output directory (`C:/Users/Robert Finchum/.codex/visualizations/2026/10/06/01a10e85-7bde-74b1-8ad7-93d3d1838eab`), with sibling `backend-foundation-reconciled.zip`. The package includes the repository documentation tree, only the 24 hashed source-reference files, a portable README, and `portable-manifest.json` recording baseline, source revision and SHA-256 for every copied artifact. Source snippets are reference evidence, not a runnable replacement repository. The checker runs offline inside that package. The manifest excludes itself and the containing archive to avoid recursive hashes; the completion receipt records the archive hash.

The package is a mirror of the sole repository target. Its README directs readers to `docs/aggregator-backend/README.md` and explicitly supersedes earlier Ground up readiness/schema claims. Sync it as a named reconciled snapshot and make the Ground up entry point redirect to it; do not blend independent edits into both copies. The original external Ground up directory was not written and remains unsynchronized. This uses the task's permitted prepare-in-worktree fallback rather than claiming those old files were corrected.

Final artifact hash and check totals are recorded in the portable manifest and the task completion report. Revalidate them after any further edits. No application readiness, optimization, capacity, merge or deployment follows from these documentation results.
