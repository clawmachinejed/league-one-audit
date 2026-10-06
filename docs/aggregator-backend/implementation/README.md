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

**Migration compatibility remains unqualified:** the current source increment supplies request-owned receipt composition and a coordinated 034–036 installation/epoch transition. No real database installation, server identity, old/new caller coexistence or recovery rehearsal has run. Migration 034's mandatory guards remain unchanged. A disabled target route does not establish installation safety. Do not merge or apply these migrations without the separately authorized qualification and release gates.

The connected acquisition increment adds migration 037, whose D03 unique indexes
would change existing legacy multi-profile link behavior. Normal installation is
therefore held before driver construction, with no environment override, until
the compatible caller cutover and expanded transition are reviewed. See the
[037 hold](migration-transition.md#migration-037-installation-hold). Internal
composition and authored disposable fixtures do not authorize lifting it.

See [backlog](backlog.md), [preflight evidence](preflight.md) and [decisions and evidence](evidence.md). Historical B1/B2/B4 completion does not complete any BC-M milestone.

## Independent audit and authorized remediation

The independent audit reviewed `c907584571052cfbea6957e8bad08066fe11f432` and withheld the proposed paid run and qualified checkpoint; BC-M1 completion/merge/release remained NO. Its preserved 108-obligation assessment is **3 implemented-and-verified, 5 implemented-but-unverified, 100 still pending**, counting whole obligations rather than partial components or a completion percentage. The reviewed audit and JSON remain under ignored `test-results/independent-audit/`; their source-bound findings are recorded in [evidence](evidence.md).

The user explicitly resumed implementation after the independent audit of `ffa7bd0d16bdc34c1578e2a2e77690cb6c756381`, superseding the audit-only restriction. This remains the same BC-M1 outcome, worktree and draft PR287; the chat is pinned as “BC-M1 Implementation and gap closure.” Both historical audit worktrees and artifacts remain unchanged. Local implementation, meaningful tests, independent review, corrections and draft PR continuation are authorized. Database connections, real SQL execution, credential retrieval/rotation, paid provisioning, migration application, qualification dispatch, merge and public activation remain unauthorized. No production deployment is authorized; the requested final preview inspection is a separate PR review gate.

The previous published increment corrected local lifecycle enforcement and transport quarantine, and authored genuine account-LOGIN concurrency cases. The current increment implements the [migration transition](migration-transition.md), repairs R035 in the single manager normalizer, and advances finite discovery through the existing adapter. Actual SQL and complete target workflow qualification remain pending. The [current 108-row ledger](current-requirements.json) separates whole-obligation status from partial component evidence; it does not replace the canonical requirements or rewrite either historical audit.

## Product and consumer boundary

This is the backend of a multi-provider fantasy aggregator, with Sleeper the only implemented provider. The intended path is provider connection/access → existing provider adapter → shared normalized Neon records and provenance → authorized shared readers → existing website consumers. Backend-only includes server composition needed by those consumers; website presentation and public response shapes remain preserved. Login, provider association, permission to acquire, and current membership remain separate. Public username recognition is not provider-control proof. Future providers reuse the shared architecture. [Resource paths](resource-paths.md) identify actual producers, storage, readers, consumers and wired/dormant/pending boundaries; tables or helpers alone never complete a path.

## Working increments

| Item | Source | Owner | Dependencies | Acceptance evidence | State |
| --- | --- | --- | --- | --- | --- |
| Exact source/service preflight and planning dependency | AGENTS.md; ENG07 | Lead | Authenticated GitHub/Vercel reads | preflight.md | Source/service identity verified; census limits recorded |
| Transaction-owned account/session authority and operator revocation | ENG01; TX01/TX07/TX08; AA-P01/P02 | Account + data | Exact receipt/epoch/helper/role manifest | Actual SQL roles, NULL/rollback/lock/process-death proof; bridge tests | Private callers composed; 036 identity/owner activation and coordinated installer authored; actual SQL and transition qualification pending |
| Exclusive association, follow intention and current selection | D02-D04; TX02/TX05 | Account + data | Qualified lookup, authority guards, source fence | 108-case mapping and conflict/expiry/renewal races | Receipt-pinned exclusive activation and idempotency authored; legacy cutover held. Membership, release, selection and renewals pending; SQL unexecuted |
| Durable acquisition and globally admitted transport | ENG02; AA-P03..08 | Worker + data | Existing projection_jobs, policy/context/source reservation | Atomic job/audit/idempotency and cross-process permits/retries | Concrete target acquisition ports and existing job/permit transport composed; SQL qualification, universal callsite convergence and cross-actor coalescing pending |
| Finite discovery through the existing adapter | R018–R021; D03 | Adapter + worker | Server-owned scan reservation, committed permit and retained capture/checkpoint acknowledgment | Per-scope completion/failure/replay and immutable plan | Internal request → existing job/adapter → retained normalized capture/checkpoint → authorized reader → existing consumer DTO composed. Public mounting remains off; SQL unqualified |
| Qualified stored roster service and demand lifecycle | BS-P01; D02/D05 | Account + worker | All preceding increments, existing accepted roster reader | Identify to authorized roster, hostile delivery, lifecycle clocks | Pending |
| Complete qualification and independent review | BC-M1 exit; release-validation.md | Lead + independent reviewer | Implemented cases, retained unrelated fixtures, isolated DB access | Full repository checks, real SQL receipt, actual preview | Foundation reviewed; frozen local non-SQL checks pass; SQL requires run authority; complete target pending |
| Branch/PR publication | User implementation boundary | Lead | Reviewable commits and honest evidence | Attached draft PR; separate preview/merge/production states | Draft PR287 published and attached, stacked on PR286; implementation preview inspected; no merge or production release |
