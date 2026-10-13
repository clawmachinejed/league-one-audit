# CP14: one current-season transaction period

Revision: October 13, 2026. Source implementation and local verification are authorized; hosted SQL qualification, retained installation, merge, production deployment and DATA activation are not. Read with the frozen [CP1 contract](data-backend-readiness-contract.md), [CP2 baseline](data-backend-acceptance-baseline.md) and [evidence ledger](data-backend-evidence.md).

## Bounded increment

1. **Data resource:** one explicitly selected native transaction period in season 2026, including week zero when selected. Preserve native transaction IDs, type/status, participants, player/pick/budget movements, valid zero bids and supplied timestamps. No named-league eligibility rule or inferred failed/accepted outcome.
2. **Existing path:** optional `transactionPeriod` on ordinary public DATA intake → existing bounded uncached Sleeper capture adapter → existing 033 transaction attempt/acceptance/storage → exact accepted receipt → ordinary stored-reader composition. Extend the existing durable task and capture witness owners in migration 051; keep the existing transaction normalizer and projector.
3. **Persisted result:** an accepted period is bound to its request, dispatch, original ownership/deadline fence, source mapping, attempt and receipt. The reader selects that receipt, including a fresh equal-content acquisition whose immutable original observation is older. Typed official facts, source and acceptance clocks remain distinct. Omitted selection preserves existing intake behavior; incomplete/unavailable acquisition cannot claim completed coverage.
4. **Real evidence and gaps:** independent preimplementation file/purpose review `DATA-CP14-2026-10-13-SCOPE-REVIEW` confirmed the narrow shared dependencies. Local checks and independent source review are recorded below. Authored SQL and mocked readers do not qualify installed PostgreSQL, actual restricted-role behavior, live acquisition or elapsed operating targets.

CP15 retains complete 2026 transaction history, recurring refresh, correction/removal and partial-failure completion. Drafts, websites/accounts, fleet operations and release remain with their existing checkpoint owners. Product intake remains 2026-only; CP13's selected 2025 testing exception does not extend to CP14.

## Authority and dependency

This task uses dedicated worktree `data-transaction-period/LeagueOneEngineering`, branch `codex/data-transaction-period`, based on CP13 documentation closeout `af90868f1505fbe975e3d36b6e415c71f414369e` and draft PR303. The CP13 worktree and branch are preserved. CP13 remains complete for its accepted bounded scope; this increment creates no new CP13 gate.

Before implementation, local and freshly checked GitHub `main` agreed at `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`. Vercel project `league_one_fantasy` showed Ready production `8C3YSnXRCbmPETftQgRtirfyck5e` at that exact SHA, canonical repository `clawmachinejed/league-one-audit`, root `apps/site`, production branch `main`. The live site responded with its existing public/account navigation. Observed open PRs were drafts; recent qualification runs were complete. Vercel retained the existing three every-minute future-projection, lineup-observation and live-projection crons. No competing release owner observed. Database/worker leases were not inspected, and this task assumes no production-writing ownership.

Primary `main` remains clean. No production secrets were loaded. No SQL execution, database provisioning, retained migration, merge, production deployment or DATA activation is authorized by this record.

## Proof to prepare

- Same-capture native-to-typed transaction ID/status/value parity, including bid zero and native timestamps; scoped repeated IDs across unrelated leagues.
- Ordinary intake reservation, one exact bounded transaction GET, accepted receipt checkpoint and stored-only composition with provider access disabled.
- Exact receipt identity and fresh acquisition clocks when content deduplicates to an older observation; a later current head cannot replace the requested receipt.
- Empty period versus unavailable/invalid capture; wrong league/week/dispatch/source mapping and stale fence rejection.
- Omitted-selector compatibility and preserved routes, fallbacks, selection, providers, scoring, immutable baselines and single shared pipelines.

The smallest closed hosted profile will reuse the existing protected disposable harness, actual restricted LOGIN and cleanup. Preserve the 20-second worker fence, 60-second admission spacing, 30-minute work/40-minute lifecycle/50-minute CI limits, fixed 0.25 CU and no automatic retry. A proposed $1 run envelope requires one new authorization tied to the final reviewed commit; earlier per-run authorizations are consumed. Actual billed cost is not a measured hard cap.

## Verification state

Implementation and local source verification are complete for the bounded candidate. Independent reviewers approved the TypeScript path, additive migration and role grants, fixed qualification fixture/profile, and scope/evidence changes. Reviewers did not approve their own authored changes. No material source findings remain; this does not establish PostgreSQL acceptance.

- Focused intake/receipt regressions: 318 tests across seven files passed. Closed-profile validation: 87 tests passed with zero skips. Scope self-tests: 23 passed. Changed-source ESLint, nonincremental TypeScript, dependency/peer/auth checks, and the declared scope gate passed.
- The complete local `pnpm verify:full` finished successfully with Node 24.19.0, pinned pnpm 11.19.0 and process-local `VITEST_MAX_WORKERS=4`: 319 unit files, 7,404 passed and one scoped-IPv6 host-capability skip; lint, generated types, TypeScript and optimized build passed.
- Public Chromium: 120 passed and 21 skipped. Twenty account-only cases were intentionally deferred to the account fixture phase, where all 20 passed. One manager-selection isolation case skipped because the provider returned no manager cards. That live-data assertion remains unverified.
- Two earlier full runs at default unit concurrency each ended with 7,403 passed, one failed and one skipped: the existing unchanged complete-operands diagnostic exceeded its five-second case timeout. Its isolated reproduction passed within the same timeout (2.22-second body), and the four-worker full run passed. No timeout, test case, runtime fence or committed concurrency setting was changed.
- The ordinary full workflow explicitly skipped disposable Neon integration because no secured control environment was configured. No database command, credential load, provisioning or SQL execution occurred. Ignored local logs retain failed and successful attempts.

The authored, unexecuted `data-transaction-period-intake-v1` profile has three ordered cases, one before/after hook pair, no filtering/skips/retries, and normalized fixture SHA-256 `a16903ff701c386f2f9d2f2032e6920534139015e83bc1ed6b9d675ceea682f1`. The synthetic ordinary journey expects seven admissions and eight intercepted GET attempts, including malformed-transaction recovery. Its oracle compares the same capture with normalization, accepted relational transaction rows and provider-disabled ordinary reads; direct equal-content acceptance checks exact acquisition clocks and retained old request reads. It does not prove recurring refresh or live acquisition.

Case/hook allowances total 1,140 seconds (19 minutes); this is authored allowance, not a measured run. Installed PostgreSQL, actual restricted-role grants, fence/rollback behavior and cleanup still require the separately authorized isolated run. The broader prospective proof bullets above are not a claim that every adversarial case ran.

At this source record, branch publication and Vercel preview readiness remain pending. The draft PR will record their exact source binding. No merge, retained installation, production deployment or DATA activation has occurred.
