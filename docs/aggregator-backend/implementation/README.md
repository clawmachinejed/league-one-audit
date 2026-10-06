# BC-M implementation execution index

This is the execution record for the [reviewed build plan](../backend-build-plan.md), not a replacement specification. Owner: this BC-M1 implementation chat, `01a11100-ead6-7311-afb4-29e5db560c9e`, with bounded account, database and transport subagents. Planning/decision chat: `01a10e85-7bde-74b1-8ad7-93d3d1838eab`.

## Authority and exact dependency

- User approved implementation and project organization. Any additional user-facing chat must be pinned immediately; preserve unrelated pins and chats. Use subagents for this outcome.
- Authorized: isolated implementation, tests, branch publication and reviewable PR. Not authorized: merge, production migration, public activation, paid provisioning or deployment. A hosted preview is a separate review gate under the requested PR workflow.
- Application baseline: `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`.
- Reviewed planning dependency: `cef7f49243509da738ff9efc950538b5bd2ae3da`, [draft PR286](https://github.com/clawmachinejed/league-one-audit/pull/286), still unmerged at kickoff.
- Branch `codex/bc-m1-account-roster`, worktree `C:/Users/Robert Finchum/.codex/worktrees/cd90/LeagueOneEngineering`. Fast-forwarded this isolated branch to the reviewed dependency after inspecting all six commits and confirming the complete baseline delta is confined to 38 documentation files. Implementation commits follow this dependency separately. Primary checkout and other chats' worktrees were not edited.

## Current state

BC-M1 is **in progress / unqualified**. Target public activation remains disabled. No target SQL installation, end-to-end workflow qualification or production change has occurred. The 108 cases are procedures in `design-requirements.json`, not existing runtime tests. The 10,770 historical offline assertions are document/model checks, not implementation evidence.

**Draft migration compatibility blocker:** migration 034 replaces the existing login resolver and attaches mandatory receipt guards. Current public account compositions intentionally remain unchanged and cannot use that schema. Migration discovery includes 034 automatically; disabling a target route does not make migration execution safe. Do not merge or apply these migrations outside the isolated harness. Qualified receipt composition/activation sequencing is required before that blocker can close.

See [backlog](backlog.md), [preflight evidence](preflight.md) and [decisions and evidence](evidence.md). Historical B1/B2/B4 completion does not complete any BC-M milestone.

## Working increments

| Item | Source | Owner | Dependencies | Acceptance evidence | State |
| --- | --- | --- | --- | --- | --- |
| Exact source/service preflight and planning dependency | AGENTS.md; ENG07 | Lead | Authenticated GitHub/Vercel reads | preflight.md | Source/service identity verified; census limits recorded |
| Transaction-owned account/session authority and operator revocation | ENG01; TX01/TX07/TX08; AA-P01/P02 | Account + data | Exact receipt/epoch/helper/role manifest | Actual SQL roles, NULL/rollback/lock/process-death proof; bridge tests | Internal bridge, strict guards and authored SQL cases; real SQL unverified; legacy composition blocker |
| Exclusive association, follow intention and current selection | D02-D04; TX02/TX05 | Account + data | Qualified lookup, authority guards, source fence | 108-case mapping and conflict/expiry/renewal races | Follow revision/tombstone drafted with unexecuted SQL cases; association/selection/renewals pending |
| Durable acquisition and globally admitted transport | ENG02; AA-P03..08 | Worker + data | Existing projection_jobs, policy/context/source reservation | Atomic job/audit/idempotency and cross-process permits/retries | Permit transport boundary unit-tested; real SQL permits, jobs and callsite convergence pending |
| Qualified stored roster service and demand lifecycle | BS-P01; D02/D05 | Account + worker | All preceding increments, existing accepted roster reader | Identify to authorized roster, hostile delivery, lifecycle clocks | Pending |
| Complete qualification and independent review | BC-M1 exit; release-validation.md | Lead + independent reviewer | Implemented cases, retained unrelated fixtures, isolated DB access | Full repository checks, real SQL receipt, actual preview | Foundation reviewed; frozen local non-SQL checks pass; SQL requires run authority; complete target pending |
| Branch/PR publication | User implementation boundary | Lead | Reviewable commits and honest evidence | Attached draft PR; separate preview/merge/production states | Draft PR287 published and attached, stacked on PR286; implementation preview inspected; no merge or production release |
