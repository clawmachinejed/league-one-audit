# Capacity tooling validation

Application baseline: `864580c67bae2380049c978346e3da076d5cdee5`. Local `main` was clean and matched GitHub `main` before work and before publication. No competing open PR was observed. The production binding and exact source SHA were checked through Vercel before measurement; production was not changed.

- `pnpm verify:full`: passed under Node 24 / pnpm 11.19.0, including dependency validation, ESLint, Next route generation, strict TypeScript, unit tests and production builds.
- Unit tests: **3,946 passed, 1 skipped** across 205 files. The skip is the scoped-IPv6 listener case because this machine has no scoped IPv6 interface. Non-loopback IPv4 coverage ran.
- Public Chromium suite: **108 passed, 18 skipped**. Those 18 are the account-fixture cases intentionally excluded from the public configuration; all **18 passed** in the separate synthetic account browser suite. Both runs verified fresh local build provenance at port 3196.
- The broader destructive integration suite was **skipped/unverified** by `verify:full` because this worktree has no `.env.integration.local`. The separately supervised capacity suite used the already authorized disposable environment; this does not claim a rerun of unrelated auth lifecycle/migration integration cases.
- Capacity measurements: **26 correct main/extension captures**. Eight distinct profiles stopped expansion at 8.65 seconds of remaining work time, per the predefined ten-second reserve. No 16/32-distinct-profile claim is made.
- Final self-contained supervisor probe: **passed**, three accepted leagues and all logical checks, 23.721 seconds. Its live owner proof, guarded preparation, child closure and empty-schema cleanup passed on `account_reset_integration_test` / `br-still-breeze-avaibago`. The preflight had zero other sessions; final HTTP pool backends were idle, had no transactions and were created during the owned run. No recovery cleanup was needed.
- Independent checks: four fixture tests and thirteen supervision tests passed; method, scheduling calculations, physical row/pointer evidence and final supervisor code were independently reviewed.

The first local full-verification invocation stopped before checks because an installed pnpm launcher selected Node 20. A temporary task-local launcher pinned Node 24 for nested commands, and the complete workflow then passed. Global Node configuration was not changed.

Evidence: [full verification log](evidence/full-verify.log), [final probe](evidence/collection-capacity-final-probe-d76d7839-efb1-4088-8ed9-1fbb6f6efe71.json), [final cleanup receipt](evidence/collection-capacity-supervision-530017ce-1c54-4eff-b1ad-4b103fd44ade.json). Only trailing whitespace was normalized in the saved log. Its SHA-256 is `e5e732f41105842fb3df8b9c9481e29f1e54fe644793a079db74113fe7a0187c`.

Branch publication, preview checks and CI are recorded on the pull request. This validation does not authorize merging, enrolling additional leagues or changing production configuration. The runtime, migrations, cron schedules and provider configuration are unchanged.

## Review correction: shared integration ownership

The full verification log above records the initial candidate, before the review correction. The corrected head requires fresh `verify`, `browser-smoke`, Preview and local full-workflow evidence; final results are recorded on [PR #252](https://github.com/clawmachinejed/league-one-audit/pull/252) and its release receipt.

Review found that the ordinary integration runner could reset the database during a capacity run because it did not acquire the same mutex. The shared harness now retains a pinned exclusive session through ordinary preparation, test execution and cleanup. A capacity parent admits exclusively, then hands off to shared parent/child locks without an unlocked interval. A child retains its own lock if the parent disappears. Stale proofs and lost sessions fail closed; cleanup closes retained sessions even if validation fails. Session ownership requires a direct owner endpoint. Application runtime and measurements are unchanged.

- Final focused qualification: **88 tests passed across four files**, full TypeScript checking, targeted ESLint and the documented Node 24/tsx standalone import smoke passed. Independent code review found no remaining blocker.
- [Real Neon contention proof](evidence/integration-mutex-contention-e7dbbe83-9cec-4da2-87ad-40c36a353848.json): ordinary preparation rejected with `INTEGRATION_DATABASE_BUSY` while another session held shared ownership. PostgreSQL startup read-only settings independently prevented schema writes. Schema OIDs and zero relation counts stayed unchanged; the owned lock was released. No schema/data writes or provider requests.
- [Corrected standalone capacity probe](evidence/collection-capacity-final-probe-aed81c4f-b617-41a5-8a13-b09a7090d0a7.json): three accepted leagues, all invariants passed, **22.365 seconds** operation time. [Supervisor receipt](evidence/collection-capacity-supervision-7df4e6c9-e16a-424b-a1d3-48b5c7c5efc5.json) confirms child exit 0, child closure and empty-schema cleanup. No recovery cleanup was needed.
- Both real-database checks used only the previously authorized disposable `account_reset_integration_test` database on `br-still-breeze-avaibago`. They do not represent a rerun of unrelated account lifecycle integration tests.
