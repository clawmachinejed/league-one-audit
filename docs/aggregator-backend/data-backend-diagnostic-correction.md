# Ordinary ingestion proof and diagnostic correction

This correction follows the resumed user direction: first prove one ordinary journey through the existing backend, then qualify recurrence and recovery. It does not add a second ingestion pipeline or remove requirements. The current [data-only contract](data-backend-scope.md) remains authoritative.

## Resource and path

- **Data resource:** one unrelated synthetic Sleeper manager, one explicitly selected season and associated league, official settings, primary/co-manager relationships, held-player roster and manager directory.
- **Existing path:** public Sleeper capture functions in `lib/sleeper.ts` → existing `runPublicIntakeStep` and shared job admission → maintained canonical registration and typed administration writers → `readPublicSleeperIntake`. The recurring case continues through `runPublicDataRefreshStep` and `readPublicDataRefresh`.
- **Persisted result:** fresh canonical league/season/connection and provider-manager identities, accepted typed settings/roster/manager records and immutable provenance/receipt bindings. DATA enrollment remains inactive and its immutable calculation profile remains NULL. The ordinary case uses no owner-seeded enrollment, direct acceptance writes, interruption injection, projection calculation or account flow.
- **Evidence and gaps:** the new ordinary SQL case is authored only until a separately authorized isolated run executes it. HTTP is a retained synthetic fixture through the real capture/parser/normalizer; this is not live Sleeper connection proof. Local diagnostic tests use injected storage and cannot establish PostgreSQL behavior.

## Preserved starting point

- Candidate before correction: `fc744e629fb6764012018c274cd2b09d4c1c3c22`, initially clean in the existing isolated `codex/data-qualification-evidence` worktree. No paused source edits were present.
- Published draft PR287 remains `682f6bbf8158e1c3494d85f31cd0e83856536ebe`; planning PR286 remains `cef7f49243509da738ff9efc950538b5bd2ae3da`.
- Fresh local/GitHub main and Vercel production agree at `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`. Vercel project `league_one_fantasy`, team `robert-finchums-projects`, binds `clawmachinejed/league-one-audit`, main, `apps/site`; ready production deployment `8C3YSnXRCbmPETftQgRtirfyck5e`. The live domain was read successfully. No competing release owner was observed in available worktree, PR, deployment and chat evidence; database leases were not inspected.
- Unrelated account work in the original worktree is preserved. No publication, migration application, merge, deployment or public activation is included.

## Previous isolated run: failed, cleanup verified

The one approved run tested exactly `fc744e629fb6764012018c274cd2b09d4c1c3c22`, profile `data-core-refresh-v1`, run `22c0e9f8-5c4d-4a31-aef5-a952eb5c896b`. It collected 24 cases, executed 1 that failed, and filtered/skipped 23; none passed. The selected case observed zero completed cycles rather than the required two after its 18-minute loop. This does not mean no SQL executed or no data was written: restricted LOGIN prerequisites and canonical identity checks completed.

The supervisor finished unsuccessfully after 1,174,776 ms. Its acknowledged terminal receipt records child closure, schema cleanup, restricted database credential revocation and exact disposable-child deletion all verified, no unresolved resources and no production writes. Separate recorded provider checks confirmed the child absent and temporary project API key revoked. That authorization is consumed; there is no automatic retry.

| Retained local evidence | SHA-256 |
| --- | --- |
| `test-results/integration/run-1791329181209-be280c40-cc64-4b27-8817-59c30b42848e-0012.json` | `c1d8aebba21c9da25b4c55b2c5c10d410ff233b1641fbff38d98f21dc50f478b` |
| `test-results/integration/artifacts/run-Z03Rre/qualification-report.json` | `19419f7dd56b1a8b9b16351a612b7754a8a3e57e974bd00e31387e6b1f22adf1` |
| `test-results/integration/artifacts/run-Z03Rre/qualification-cleanup.json` | `7ccd3702798611e0e0b4ae8b2f846d673d123b43e6b2df34cb2ab75eab658823` |
| `test-results/data-backend/approved-sql-fc744e62-20261006.log` | `226562104793dd44dfd55cf574a39ef1885b9909a8b1aec190e1571b4f95ea99` |

The prior full non-SQL workflow passed on that exact SHA: 5,860 unit passes / 1 skip, 120 public-browser passes / 21 skips and 20 synthetic-browser passes / 0 skips. Its SQL stage was explicitly skipped before the separately approved run failed. These historical results do not verify the changed candidate.

## Confirmed diagnostic defect and correction boundary

The coordinator intentionally returns a public unavailable status after internal errors. The integration case previously accepted that status repeatedly without retaining which operation failed. A local reproduction injected a permission error at `refresh.select`; the actual coordinator returned unavailable with zero provider calls in 1 ms and did not expose the cause. This reproduces the visibility defect, not the cause of the earlier real database failure.

Independent offline inspection exercised both retained fixture variants through the real Sleeper captures and normalizer with blocked outbound networking. Identity/list and league/roster/users normalization succeeded, including complete v1/v2 manager evidence. That excludes deterministic rejection of those fixture shapes. SQL permissions, functions, return values, fencing, acceptance and readback remain possible failure boundaries, not established causes.

The correction is integration-only: fixed operation names, bounded status/error categories, allowlisted SQLSTATE, sticky unexpected-failure detection and a small sanitized artifact bound to the existing qualification context. Raw messages, stacks, queries, parameters, payloads, URLs and credentials are excluded. Existing intentional faults remain exact test-owned identities with bounded occurrence. Artifact handling cannot mask primary failure or bypass cleanup.

The new closed `data-core-ingestion-v1` profile selects only the ordinary journey. The existing `data-core-refresh-v1` keeps its original selected recovery case. Each new-source profile must collect 25, execute its own exact 1 and filter 24; the historical 24-case report remains unchanged. Full mode stays unfiltered. Arbitrary file/name/configuration selectors remain rejected. No new runner or production logging framework is added.

## Approval and completion limits

Source acceptance requires executed offline checks, independent architecture/security review of the frozen full SHA and the scope/diff check. Neither new SQL case is verified until the existing isolated supervisor runs it with separate authorization and successful cleanup evidence.

The next requested database increment will be exactly one ordinary-ingestion run in the existing dedicated project `steep-glitter-44680287`, from parent `br-plain-bread-b7sgfdl8`, fixed 0.25 CU and unchanged 30-minute work / 40-minute lifecycle including cleanup, with no automatic retries and a maximum authorized budget of $1 (an approval budget, not a provider hard cap). The ordinary test body is bounded to 10 minutes, not yet measured. Any temporary project-only credential creation and revocation must be included explicitly in the new approval. Production remains denied. One-hour expiry is fallback; verified credential revocation and child deletion remain mandatory. The prior parent inventory is historical and must be revalidated under authorized access. No new paid run or credential action has occurred in this correction.

DATA completion and release remain withheld. Core storage/readers and recurrence are implemented but lack successful end-to-end SQL evidence; live Sleeper-through-database proof, remaining official families, historical coverage, bounded response parsing, workload/freshness and recovery qualification remain pending. The historical 108-obligation account ledger stays deferred at 3 verified / 21 implemented-unverified / 84 pending and is not the DATA denominator.

## Local correction evidence before commit

The frozen author increment passed 49 tests across four files with zero skips, complete TypeScript, lint on owned source, scope and diff checks. Evidence is retained under `test-results/qualification/diagnostics/`: `targeted-final.log`, `scope-final.log`, `diffcheck-final.log` and `source-freeze.json`. The author originally named `typecheck-final.log` and `lint-final.log`, but those files were not created because both commands emitted no output. The original successful tool results are transcribed honestly in `final-validation-tool-transcript.json`; this is transcript evidence, not direct command logs or a rerun. The original freeze metadata is preserved with that correction. The complete frozen-source workflow below independently passed lint and types and retained its actual output. The earlier failed TypeScript attempt (two test mock literal types) remains in `typecheck.log`; both were corrected, without loosening types. The selected module LF digest is `3ce0cb8d9dfefa803c08c0b94a3339cb960a80f03a9dca9d38861d20da43352e`.

Independent Astra Ultra architecture and security reviewers confirmed the bounded design and exact scope before implementation. Both subsequently reviewed frozen `cdcce4cd53a3a4495cff02f72b983949becc5cbb`, parent `fc744e629fb6764012018c274cd2b09d4c1c3c22`, and found no blocking executable-source finding. Architecture confirmed all 24 original case names, 23 unchanged case bodies and retained recovery assertions. Security independently executed the same 49 targeted tests in four files with outbound networking blocked: 49 passed, zero failures/skips. Those counts overlap author and full-workflow results and are not additive. Two documentation findings were corrected afterward: ambiguous profile wording and the nonexistent author-log citations. Final documentation-only changes require exact-SHA review and source-equivalence binding; the following tests ran on cdcce4cd, not on a later documentation commit.

## Frozen-source verification and current status

The complete local workflow on clean `cdcce4cd53a3a4495cff02f72b983949becc5cbb` finished with exit 0. Scope, dependency checks, full lint, generated types/TypeScript and production build passed. Unit tests: **5,873 passed, zero failed, 1 skipped across 282 files**. Public Chromium tests: **120 passed, zero failed, 21 skipped**; 20 are synthetic cases excluded from the public build and one is the existing manager-card-dependent cross-league My Team check. Separate synthetic browser regressions: **20 passed, zero failed/skipped**. These preserve existing account behavior and add no account implementation. The unit skip is environment-conditional listener coverage; the compact log does not identify which conditional case skipped.

SQL was explicitly **SKIPPED / UNVERIFIED** and no database command ran. This successful command does not qualify either selected SQL case. Browser evidence is a fresh local production build bound to the tested SHA, not a hosted preview, a live Sleeper-to-database proof or deployment. No source publication, hosted preview, merge or production release occurred.

| Evidence | SHA-256 |
| --- | --- |
| `test-results/data-backend/full-verify-cdcce4cd.log` | `c356b89a8eb8d457418efd4f4ac2b11fa59452aeb3ba4cf1167c22e5db69566a` |
| `test-results/data-backend/diagnostic-review/architecture-review-cdcce4cd.json` | `9cb249a03bfbe4926cb8c93487c6054242115fd33e762689471413a591c4b516` |
| Independent security record, retained with its frozen temporary checkout | `82c6cb075c110c00f2d5b601ef7b97622576ef9f1694a46e8a95a96d8eb7110d` |
| Independent four-file targeted report, retained with that checkout | `2a74e7ff324176e6829d868082cad4ffadf43adb0d16c150b9d2006a7ccb2840` |

The security checkout is `C:/Users/Robert Finchum/AppData/Local/Temp/league-one-review-cdcce4cd-c1d95d11c5e3412bb91480cf79f2ccdc`; its source review is `source/test-results/reviews/independent-security-cdcce4cd.json` and targeted report is `independent-diagnostics-targeted.json`.

- **Implemented and verified offline:** bounded sanitized failure diagnostics, closed profile/report binding and preservation of the existing test selection/assertions. This does not grant a DATA resource database pass.
- **Implemented but unverified in real SQL:** the ordinary ingestion oracle and composed core identity/discovery/settings/roster/manager/directory paths; recurring refresh, persistence and recovery remain unqualified after the preserved failed run.
- **Pending:** successful ordinary SQL execution, repair of any confirmed underlying failure, repeated correction/recovery and concurrency evidence, bounded live Sleeper-to-database proof, remaining official resource families, performance/freshness measurements and production release qualification. No DATA resource obligation was promoted to fully verified. The historical 108-account ledger remains unchanged and deferred.

The next executable increment is one separately approved `data-core-ingestion-v1` run of the final reviewed SHA. Approval must include a new temporary key scoped only to the dedicated test project, necessary test-only identity and empty/quiescent-parent preflight, exactly one new child, child-only migrations and restricted LOGIN execution, schema cleanup, generated database credential revocation, verified child deletion and separate API-key revocation. Revalidate the documented provider-managed maintenance-object exception; it is not permission to accept application objects or inherited application roles. Record the actual PostgreSQL version. Success requires 25 collected / exactly 1 executed and passed / 24 filtered, exact source/report/cleanup binding and an acknowledged successful terminal receipt with every cleanup condition verified. The earlier run approval was consumed. A failure requires diagnosis and review of any changed SHA, never an automatic retry.
