# Decisions, deviations and verification evidence

Append dated outcomes; preserve failed/partial attempts. Owner: implementation lead. Source: BC-M1 and release-validation.md.

## October 6, 2026 — kickoff

- Verified and adopted the exact docs-only planning dependency by fast-forward on the isolated implementation branch. PR286 remains unmerged.
- Read-only specialist reviews mapped the existing account/auth, administration, roster and projection_jobs owners. No replacement queue, collector, scorer, normalizer or publication path is authorized.
- ENG01 requires mandatory legacy DML/resolver guards at completed cutover. Strict additive helper groundwork alone does not complete that requirement. A generic flag bypass would violate the design. Bridge, fixtures and guarded SQL must be upgraded together before claiming completion.
- Initial association is user-asserted. No provider-control mechanism exists; disputed claims remain locked. Public lookup, screenshots or commissioner status cannot authorize takeover.
- Actual SQL qualification is currently **SKIPPED / UNVERIFIED**: no ignored integration-control file or NEON_TEST_* process configuration available. No paid-run budget inherited. Existing guarded supervisor, exact test-only identity, committed clean reviewed SHA and full lifecycle cleanup receipt remain mandatory. No database tests or provisioning started.
- The default system Node20/Corepack combination failed dependency installation before implementation. Selected the already available bundled Node24.19.0 and pinned pnpm11.19.0; no repository toolchain version changed. Locked install subsequently completed using all 402 reused packages.

## October 6, 2026 — first authority/admission foundation candidate

- Implemented exact ephemeral nine-field auth receipts; exact UTF-8 token/email digests; canonical admission configuration hash; receipt-bound internal database transactions; final same-transaction authority timing; and a single-use monotonic response delivery boundary. These are internal components, not the target stored-roster workflow. Final roster authority must still intersect membership and acquisition/policy deadlines.
- Draft migration 034 implements strict epoch/session/actor/login locks, resolver and legacy write guards, and owner-only disable/revoke. No epoch is seeded, no schema was installed, and no helper is production-qualified.
- Draft migration 035 retains explicit unfollow revision through a private tombstone, restores monotonic revision on re-follow, and uses the existing preference audit transaction. It does not yet implement renewal/carryover semantics. Four real-SQL cases are authored, unexecuted.
- Added pure follow-demand/recovery policy tests and a committed-permit transport boundary. Neither is wired into workers or public provider callsites. Global SQL permits, jobs/leases/fairness/retries, source context, and durable lifecycle state remain to implement.
- Independent reviewers reproduced inherited receipt-field acceptance, invalid initial monotonic clock handling, and inconsistent active-follow/tombstone consumption. Regression tests and fail-closed fixes were added. Parent review also fixed SQL timing lifetime JSON number versus required decimal string. Independent follow-up account/receipt/timing review passed 126 unit cases; this overlaps the full suite and must not be added to its total.
- **Merge/application blocker:** 034 immediately replaces the existing resolver and installs mandatory guards, but the unchanged public account composition does not supply receipts. Applying it through normal migration discovery would break those callers. No disabled route or generic flag bypass resolves this. Qualified composition/activation sequencing remains mandatory; the candidate is a draft and is unsafe to merge/apply as a release.
- Guarded PostgreSQL suite has 33 new authority cases plus four new follow cases authored, with synthetic auth fixture upgrades. Five authority cases require the real restricted account LOGIN; owner-session SET ROLE alone is not proof of exact session_user behavior. All 37 remain unexecuted.
- Read-only GitHub checks found the protected `integration-test` environment with its expected secret/variable names and required reviewer; no values were retrieved. The latest completed disposable run is 36792669232 at older SHA `4cbaa3e248a8ea04ee4b12af66926514229fcaff`. That success does not qualify this candidate. No run was dispatched.
- Rechecked local main, origin/main and GitHub main: all remain `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`; the only open PR at this check is draft PR286 with exact dependency SHA. No competing owner observed within that census; database leases remain unobserved.
- First canonical `verify:full` launch stopped at the machine's Node20/Corepack shim. A temporary launcher selecting installed Node24.19.0/pnpm11.19.0 allowed the unchanged workflow to run. Dependency checks, full lint, generated Next route types, TypeScript, unit suite (**277 files; 5,637 passed, one skipped**) and production build passed. The skip is a host-interface-dependent browser-target guard test. Browser results are pending; initial ten-worker checks include timeouts and rendered Sleeper-unavailable fallbacks, retained for diagnosis.
- First browser attempt finished: **108 passed, 12 failed, 21 skipped**. The complete workflow stopped before the separate account-browser and SQL steps. Failure artifacts were preserved in ignored `test-results/playwright-bcm1-first-attempt`. A two-worker retry correctly refused to run because the checkout changed while its build was preparing; this is not a test pass. Retry must use a frozen checkout.
- Extended the existing disposable supervisor with a generated restricted account login on only its owned child, matching pre-reset URL/server database/branch/TLS/sentinel/role proofs and credential redaction/revocation. Independent review reproduced the actual driver's last-duplicate `sslmode` behavior without connecting to a database. Central parsing now rejects ambiguous/unsupported connection overrides across owner/runtime/auth/account. A parent follow-up also requires invalid denylist URLs to fail closed rather than degrade into ineffective raw tokens. This is a confirmed test-safety repair within the same qualification boundary.
- Vercel production was rechecked in a fresh in-app browser tab after stale-tab timeouts: ready deployment `8C3YSnXRCbmPETftQgRtirfyck5e`, main, canonical repository, exact production SHA still `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`.

## October 6, 2026 — frozen implementation checkpoint

- Committed and independently reviewed implementation candidate `5781aa82c24a07780532e290b1e04fc1580ea0aa`. Review found no remaining actionable source blocker for an **authorized isolated qualification attempt**, not for release. Final denylist URL fix was reproduced before repair; 217 focused harness tests passed with zero skips. No test credential or actual connection was used for those deterministic checks.
- Published `codex/bc-m1-account-roster` and attached [draft PR287](https://github.com/clawmachinejed/league-one-audit/pull/287), stacked on planning PR286 to isolate the implementation diff. Neither PR was merged.
- Ran the unchanged `verify:full` workflow against the clean committed candidate in CI mode with Node24.19.0/pnpm11.19.0. Dependency checks, full lint, Next route generation, TypeScript, **277 unit files / 5,675 passed / one skipped**, production build, **120 public-browser passed / 21 skipped**, and **20 synthetic-account-browser passed / zero skipped** completed successfully. Public-browser skips comprise the 20 separately run account cases and the provider-dependent My Team selection case when manager cards were absent. The unit skip is host-interface-dependent. Earlier failures remain recorded above; no application change was made to conceal them.
- The guarded SQL step explicitly reported **SKIPPED / UNVERIFIED**; the full command exited zero without any database command. That exit code does not qualify PostgreSQL behavior or the BC-M1 target. Ignored local log: `test-results/bcm1-frozen-verify.log`.
- GitHub main verification job passed on the same implementation SHA; hosted browser job was still running at this checkpoint. Latest check state belongs to the PR. This documentation-only follow-up changes no tested application, migration, test, dependency or workflow source.
- Inspected actual ready Vercel Preview `5N9SPky7T6jA6AUexFdVWTwKzrib` in the built-in browser, verified exact source SHA `5781aa82c24a07780532e290b1e04fc1580ea0aa`, and opened My Fantasy, dormant Account, League One Matchups and League Two Matchups. Both named leagues rendered distinct official scores and scoped navigation. Preview deliberately has no target database authority; this is baseline behavior evidence only.
- Primary main checkout remains clean at the original baseline. No migration application, production deployment, production source binding/provider configuration/cron change or paid database provisioning occurred.

## Next qualification action requiring authority

The candidate is reviewable but BC-M1 remains incomplete. Before building further on the mandatory authority guards, request authorization for **one** existing `disposable-integration` workflow run through GitHub's protected `integration-test` environment on the reviewed draft head: only project `steep-glitter-44680287`, empty parent `br-plain-bread-b7sgfdl8`, new disposable child at fixed 0.25 CU, fixed 40-minute lifecycle, one-hour expiry fallback, verified credential revocation and child deletion, and no automatic retries. Never retrieve the environment secret or substitute a retained database. The earlier implementation scope excluded paid provisioning; neither an old passing receipt nor existing configuration grants a new run budget. Review exact head again before dispatch, then retain the existing supervisor's full lifecycle receipt. This action is not merge, migration or release authorization.

## Delivery state

| Evidence class | State |
| --- | --- |
| Local target implementation | Reviewed foundation checkpoint; complete target still in progress |
| Target unit/runtime tests | Foundation suites pass within 5,675 total passes; one host-dependent skip; target orchestration not implemented |
| 108 acceptance procedures | Not yet executed against implementation |
| Actual PostgreSQL qualification | Protected test environment exists; new run budget/approval absent; 37 new SQL cases unexecuted |
| Independent adversarial code review | Foundation findings fixed; migration/public composition blocker remains; full target review pending |
| Full repository verification | Frozen local Fast Check + public/account browser gates passed with stated skips; SQL unverified |
| Branch publication / PR | Published and attached draft PR287, stacked on unmerged PR286 |
| Actual implementation preview | Ready implementation SHA inspected; target not activated; no target SQL proof |
| Merge | Not authorized / not performed |
| Production migration/deployment/public activation | Not authorized / not performed |
