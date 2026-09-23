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

Evidence: [full verification log](evidence/full-verify.log), [final probe](evidence/collection-capacity-final-probe-d76d7839-efb1-4088-8ed9-1fbb6f6efe71.json), [final cleanup receipt](evidence/collection-capacity-supervision-530017ce-1c54-4eff-b1ad-4b103fd44ade.json). The verification log SHA-256 is `d420375f3d2e768b08139abeb7d79f657b1c9c1fea480a5cf8e9976f8241ac11`.

Branch publication, preview checks and CI are recorded on the pull request. This validation does not authorize merging, enrolling additional leagues or changing production configuration. The runtime, migrations, cron schedules and provider configuration are unchanged.
