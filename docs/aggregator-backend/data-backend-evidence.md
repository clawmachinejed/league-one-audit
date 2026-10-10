# DATA backend evidence and remaining qualification

## CP9 competition phase and period-applicable settings — accepted seven-case qualification, October 10, 2026

**Checkpoint 9 implementation and resource qualification are accepted within the bounded current-2026 scope below.** The separately authorized [run 38089145590, attempt 1](https://github.com/clawmachinejed/league-one-audit/actions/runs/38089145590) passed at exact source `baa7408ac4ef18578a716783e53326942828428c`, using only `data-period-settings-context-v1`. All seven cases were collected, executed and passed once in source order; failed, skipped, filtered, retried, repeated, flaky and unhandled-error counts were zero. The beforeAll/afterAll pair each started and ended once. The earlier repair and failed-run sections below remain unchanged historical records of their recorded source states; this acceptance does not erase the failed run or local verification failures.

1. **Data resource:** original observed 2026 settings and independently evidenced scoring, roster and competition applicability for native weeks 1–18. Native official phase remains unknown. Derived phase is limited to before-start, regular-window or on-or-after-playoff-start from explicitly owner-confirmed applicable boundaries; round, multiweek leg and competition end remain unknown.
2. **Existing path:** R029 immutable settings/configuration receipts, R031 calendar evidence and R016 component activations → `neon/exact-period-context.ts` and the existing administration store → opt-in `periodContextVersion: 'v1'` in the existing intake/refresh readers. The pure contract is `lib/aggregator/exact-period-context.ts`. The repaired whole-row SQL expression is `to_jsonb(accepted.*)`; no new migration, grant, writer or acquisition pipeline is introduced. Default output and the 20-task rich-page bound remain unchanged.
3. **Persisted result:** the reader binds original matchup/configuration evidence and actual intake settings/matchup checkpoint pairs while retaining current mapping guards. Original observed settings survive newer heads; applicability separately exposes the latest explicit owner decision and its source, range, generation and recorded time. Tested inclusive boundaries, independent component versions, absent/null/invalid/zero/out-of-range or contradictory evidence, missing calendar, corrections, replay, unsupported newer decisions, unrelated receipts and A→B→A remapping behaved as asserted. These decisions are synthetic owner attestations, not provider-effective settings history or knowledge frozen at capture time.
4. **Real evidence and gaps:** maintained report/artifact validation and independent source/cleanup review accepted the exact-source seven-case result. The ordinary case completed **16 synthetic HTTP attempts** through the existing intake and refresh paths: committed week-1 checkpoint with lost acknowledgment, week-2 503 followed by recovery, configuration replay and changed refresh. Both requests retain 18 tasks with **2 complete and 16 pending** each, four checkpoints total and eight settings/matchup receipt witnesses binding dispatch work/nonce, mapping, fence and database timestamp order. Historical context remains readable when its ordinary resource is no longer the current head; a mismatched intake pair is rejected. Weeks 3–18 were not acquired. The independent permissions case created its own accepted capture and owner competition activation, proved runtime activation/table-write denial and owner immutable-history rejection, and checked existing runtime/auth function denial after transactional reprovisioning rolled back. It did not create fresh roles or execute as the auth role.

The ordinary case passed in **616,270.260554 ms** under its 840-second limit; the independent permissions case passed in **3,678.744243 ms** under its unchanged 60-second limit. Vitest took **729.94 seconds**, the measured supervisor lifecycle **743,256 ms**, and the workflow job **765,000 ms (12m45s)**. No deadline was exceeded. The 20-second worker, 60-second admission, 30-minute work, 40-minute lifecycle, 50-minute CI and one-hour expiry guards remained unchanged.

The binding is fixture LF SHA-256 `e12c44f20aa6865c379aea0eeb8eb74dfa7f19fa1ce495f0d6fe1a13760cdecb`, profile digest `376f50190b4ffc3c8c9873f1a9dfa2c58b5e723f07a13f86d0411bca576ee7ca` and context digest `25ccdf75daadc3ca332c75a7f13ebda67dcbe0606d44991ebc29f54ce1c6acc0`. Twelve contiguous immutable journals bind run UUID `7c089153-c975-46a0-b8d9-923d0289b753`; at `2026-10-10T22:03:44.8231087Z` the supervisor explicitly acknowledged terminal `run-1791669081645-0f1a88ef-6b25-48f1-a8e0-4a70dd131d0f-0012.json` as passed. Child/process-group closure, schema cleanup, generated credential revocation and owned-branch deletion were all verified; failures and unresolved resources were empty, cancellation was null and `productionWrites` was false. The zero-byte unsuffixed journal is the reserved path, not terminal evidence. Raw SHA-256 bindings:

- Qualification report: `c8df0b5854b03b1148826de7dd2872a67b6ec36b88d5c8e298e2ef0a96493e7d`.
- Qualification cleanup: `426858c47b944f03b89854f46d699d67afe5a41ee100c3b7a6a0db5860da9d35`.
- Acknowledged terminal journal 0012: `bf75f6af717204011ceb9c61c8be0d1dcb4754312569a4d554508cf55e5acbfb`.

At `2026-10-10T22:06:53.4673829Z`, root's independent authenticated Console observation found owned child `br-floral-sunset-b78vq158` absent and only baseline `br-plain-bread-b7sgfdl8` remaining, with no manual deletion. Provider evidence reported **0.25 CU** and PostgreSQL major **18**; SQL patch version and actual billing were not measured. The separately approved single run's **$1 allowance is consumed**; no automatic retry or additional run is authorized. Audits and artifacts remain under `cp9/sql-38089145590`, with the separate `provider-cleanup-38089145590.json` observation. The failed run's 19 retained artifact files remain unchanged.

[Source CI 38086312502](https://github.com/clawmachinejed/league-one-audit/actions/runs/38086312502) for exact head `baa7408` passed default verification. GitHub commit evidence confirms checkout `ffe7dcc2cf36769ea1db0d42302bc983f0a77112` has the same whole tree `65c278cc93c13437ad44ce1d41bde4645b578197` as that source. Results: **6,778/6,778 unit tests across 300 files, zero skips or failures**, 80.18 seconds, plus the production build with all 14 static pages. Public browser checks passed **121 tests with 20 account-fixture exclusions**; the separate mandatory account suite passed **20/20**. These repaired-source results are recorded separately in `cp9/source-ci-repair`; they do not replace prior local failures or the older source's unexplained conditional browser skip.

Ready [preview `TnAFmW9C4w5oBd3kPaELHMUcC5Rc`](https://leagueonefantasy-75esjcs2m-robert-finchums-projects.vercel.app/my-fantasy) was observed at exact `baa7408`: My Fantasy loaded 2026/week 5 with zero selected leagues and League One/Two/Dynasty manager links. This read-only observation does not import the previous preview's manager-card checks or exercise SQL period context. The work remains in [draft PR #298](https://github.com/clawmachinejed/league-one-audit/pull/298); no merge, production deployment or activation occurred. Authority checks retained canonical repository/root/main binding and production `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`.

Live Sleeper acquisition, provider-effective historical settings, full nonempty 18-period collection/refresh, official fantasy phase/round/leg/end, fresh-role provisioning, sustained recurrence, fleet freshness and full backend readiness remain unqualified. **CP10 exact-value/score parity is next and has not started.**

## CP9 local query repair — PostgreSQL defect reproduced, qualification still pending, October 10, 2026

**The shared reader defect is reproduced and corrected locally; CP9 remains unqualified.** The failed-run record below is preserved as recorded at `dd731adccbf7618fb1a4f04bfb5ffcf063cebbbc`. No second Neon run, new cloud resource, merge or production release has occurred.

1. **Data resource and existing path:** unchanged receipt-bound 2026 period settings through `neon/exact-period-context.ts` and the existing administration/intake readers. PostgreSQL resolves bare names as columns before whole-row aliases: `to_jsonb(accepted)` conflicts with both `content.accepted` and `configuration.accepted`. The correction is solely `to_jsonb(accepted.*)`, with an explanatory comment and an assertion in the existing reader test. No schema, role, writer, provider, deadline or public result contract changes.
2. **Persisted result:** existing immutable receipts and component evidence remain unchanged. The corrected query can return no rows for a missing receipt and a complete acceptance row for a present receipt, allowing the existing validator to return `missing` or `available` as intended.
3. **Real proof:** two independent local reproductions used in-memory PostgreSQL 18.3 through temporary PGlite 0.5.8, without repository dependency changes, credentials, cloud connections or provider requests. The complete original exported query returned SQLSTATE `42702`, `column reference "accepted" is ambiguous`, at position 107 on both empty and populated scratch tables. Changing only the ambiguous reference returned zero or one row respectively. The actual runtime reader reproduced original `unavailable` and corrected `missing`/`available`, including known component applicability, derived phase and an intake settings/matchup checkpoint pair. Scratch columns/types were extracted from the maintained migrations for all 14 referenced tables; constraints, defaults, triggers, indexes and roles were deliberately omitted. These diagnostics establish the query defect, not the discarded cloud SQLSTATE, Neon restricted-role qualification, migration enforcement or production performance. Scripts and results are retained under `cp9/local-sql-diagnostic`; original/corrected expanded SQL SHA-256 values are `e0f4f5035fe1942b2b609fcac34dac875b19aec84bceec9f81f20e59d99c800e` and `0a770f21a7f72fbc5cffb16d4c8241bf713cbdec0af32b3cf0f201490b32c8fe`.
4. **Test repair and remaining gap:** the selected SQL fixture now forwards query errors unchanged while recording only a fixed context-query marker and a validated SQLSTATE, never error messages, SQL text or parameters. Case 7 creates its own fixture, capture and owner-confirmed competition activation; it no longer depends on case 4 succeeding. All seven case names, existing assertions, hook counts and deadlines remain. The existing reader suite passed 45/45 both before and after the SQL correction, demonstrating why mocked rows alone missed the defect. The complete seven-case profile must still pass on a separately authorized exact source. The consumed one-run authorization has not been reused.
The local repair passed independent full-query and four-file diff review by `/root/cp7_contracts`. Focused checks passed: **45/45 reader tests**, **63/63 qualification-profile tests**, **17/17 isolated diagnostic behavior checks**, TypeScript and changed-file ESLint. AST comparison preserved all seven selected names, deadlines, hooks and 89 original assertions. Two initial test launcher attempts failed before execution because the default PATH selected Node 20; explicit Node 24.19.0 completed the checks. Case 7 retains its original 60-second limit with added independent setup; successful SQL duration remains unmeasured. Scope check passed 109 reviewed extensions, 5 governance paths and 24 data paths; diff check passed. The repaired fixture LF SHA-256 is `e12c44f20aa6865c379aea0eeb8eb74dfa7f19fa1ce495f0d6fe1a13760cdecb`; only the CP9 profile pin changed. The final local diagnostic results SHA-256 is `5e69ef82208463ca9ccd2bb6023d26b8b8cce488b75c531951e1136f06f35e55`. Full hosted source verification and the complete restricted-role SQL profile remain separate from these checks.

## CP9 competition phase and period-applicable settings — failed seven-case SQL qualification, October 10, 2026

**CP9 remains unqualified.** The single authorized [run 38083504310, attempt 1](https://github.com/clawmachinejed/league-one-audit/actions/runs/38083504310) failed all seven selected cases at exact source `da2bb32f1a9e68332b659fb1c31de23c3425ed03`. Independent audits accepted the artifact bindings and completed cleanup, not the resource behavior. Implementation source remains `26d7936c7017364f9bc4b84ef9351d1a71be1909`; the evidence-only source commits retain its `apps/site` tree `a06979bc75cef6f149b6603f48a51ebb719f7e9e`. No source correction or SQL retry followed this failure.

1. **Data resource:** receipt-bound 2026 native weeks 1–18, original observed settings, independently evidenced scoring/roster/competition applicability, and conservative derived relationships to competition boundaries. Native official phase, playoff round, multiweek leg and competition end remain explicitly unknown without supporting evidence. Current status, native leg and capture proximity never establish historical applicability.
2. **Existing path:** retained R029 typed settings/configuration receipts, R031 calendar evidence and R016 owner-only component activations → `neon/exact-period-context.ts` → optional `readExactPeriodContext` through the existing administration store → `periodContextVersion: 'v1'` selected-page intake and existing refresh composition. The pure contract/resolver is `lib/aggregator/exact-period-context.ts`; legacy roster lineage validation is reused without changing its SQL. Exact files and reviewed purposes are recorded as `DATA-CP9-2026-10-10-PERIOD-SETTINGS-CONTEXT` in the scope manifest. No migration, writer, grant, provider acquisition, worker, scoring, projection or UI change is introduced.
3. **Persisted result:** reuse the immutable original matchup/configuration receipt and, when selected through intake, its actual settings/matchup checkpoint pair. Raw/presence parity, original population-capture provenance and retained calendar identity are checked independently of mutable resource heads. Each component exposes the latest explicit owner-confirmed decision with reference, generation, recorded time, range and source content; this is neither provider-effective attestation nor knowledge frozen at capture. Newer unproved decisions do not fall back to older known ones. Large raw/version payloads are materialized only for the newest relevant generation; each component's metadata inventory is capped at 1,001 rows and overflow stays unknown. Default reader payloads remain unchanged; rich inventory pages retain the existing 20-task bound. Derived values are only before-start, regular-window or on-or-after-playoff-start, with exact positive boundaries; invalid, null, absent, zero, out-of-range or contradictory evidence remains explicit.
4. **Real evidence and gaps:** pre-run independent reciprocal source review by `/root/cp7_contracts`, `/root/cp7_storage` and `/root/cp7_qualification` accepted the final contract, immutable-query lineage, shared-parser compatibility and seven-case fixture. Root reviewed the actual diff and retained the fixed `87da4d0` scope baseline. Scope self-tests passed 23/23. Focused checks passed: 303 runtime/unit tests, 113 combined context/legacy-reader tests, 64 final reader/architecture tests, 39 architecture/composition tests and 222 qualification controls; these groups overlap and must not be summed. Lint and type checks passed. The standalone production build passed. The authorized SQL run below failed all seven cases. Source review and offline checks did not establish working PostgreSQL reader behavior; restricted-role readback, complete query performance and live settings history remain unqualified.

### Local verification and retained failures

At `26d7936`, Node 24.19.0 / pnpm 11.19.0 frozen installation completed. `pnpm verify` passed scope, dependency consistency, lint and route generation/TypeScript, then stopped at two test-runner timeouts: **6,775 passed, 2 failed, 1 skipped across 300 files**, 44.03 seconds. The unchanged diagnostics test `exposes every retained receipt, provenance, capture and manager identity field within realistic full operands` exceeded its 5-second limit; the unchanged 300-league projection test `materializes every league from one stored slate and one shared game-state call` exceeded 20 seconds. The single skip is the existing scoped-IPv6-interface precondition. This was not a complete default local verification pass.

The two files then passed together at their original limits: **230/230**, 13.93 seconds, including 3,577 ms for diagnostics and 2,898 ms for the 300-league test. A controlled full-suite run with `--maxWorkers=4`, without any source/configuration/timeout change, produced **6,776 passed, 1 failed, 1 skipped**, 52.63 seconds: the projection case passed, while the diagnostics case still timed out at 5,033 ms. No further local full-suite retry was performed. A separate `pnpm build` completed successfully, including compilation, TypeScript and all 14 static pages.

Both test files, Vitest configuration and lockfile are unchanged from CP8. The projection fixture's 51-module runtime import graph contains no CP9-changed code. Its Vitest limit wraps two simulated 300-league runs and is separate from the DATA worker's 20-second fence. Diagnostics repeatedly serializes, writes, reads and validates synthetic artifact differences; validation includes the full fixture inventory, which increased from 52 to 53. The isolated pass supports scheduling sensitivity but does not prove CPU, I/O or GC as the precise timeout cause. The earlier CP8 local diagnostics timeout remains in its original record. No deadline, assertion, skip, runtime guard or test configuration was weakened, and these results do not qualify real fleet capacity.

### Hosted source verification and preview

[Source CI 38081958842, attempt 1](https://github.com/clawmachinejed/league-one-audit/actions/runs/38081958842) passed the default `pnpm verify` and required browser jobs. GitHub tested synthetic merge `5aa25c509bb1a6d8baa2dac66e055ed7e65f6e3f`, whose whole tree `318cb24859b1c7d87cd0d85b9657ab0e6fe1f7c4` exactly matches source `da2bb32`. All **6,778 unit tests across 300 files passed, with zero skips**, and the production build generated all 14 static pages. This hosted success does not erase the local failures above or prove their precise cause.

The public browser job recorded **120 passed and 21 skipped**: 20 account-fixture exclusions plus one conditional public skip whose exact test and reason cannot be recovered from the retained line-reporter output. That unresolved public coverage gap is separate from the mandatory synthetic account suite, which passed **20/20 without skips**. No browser failure, flaky result or actual retry was observed; the configured retry allowance was one. The audit is retained at `cp9/source-ci/audit.json`.

Ready [preview `15FiWXmTqbKxcD1ed8fP4nF64aDM`](https://leagueonefantasy-pup8mbcx9-robert-finchums-projects.vercel.app) was inspected at exact source `da2bb32`: My Fantasy loaded 2026/week 5 with zero selected leagues; League One, League Two and Dynasty showed 12, 12 and 10 manager cards, with league navigation isolation observed. Existing UI does not exercise the new SQL period context. This was read-only preview evidence, not production deployment or SQL acceptance; details remain in `cp9/preview-audit.json`.

### Failed PostgreSQL attempt and verified cleanup

Only `data-period-settings-context-v1` ran: **0 passed, 7 failed**, all seven collected and executed once in source order, with zero skipped, filtered, retried, repeated or flaky cases and zero unhandled errors. The single beforeAll/afterAll pair each started and ended once. Failures were assertions; no test or lifecycle deadline was exceeded. The maintained qualification validator correctly rejected the failed report.

Cases 1–4 and 6 expected available context but received unavailable. Case 5 expected missing for a valid random nonexistent receipt and received `period_context_evidence_unavailable`, localizing the shared failure to the query/prequery boundary rather than row validation alone. The reader suppresses the caught error, so no underlying SQLSTATE or message was retained. Independent static review found no missing referenced column or SELECT grant, but did not establish a definitive SQL engine error or root cause. Unit tests supply mocked rows and SQL substring assertions; they did not validate PostgreSQL query execution.

The ordinary case reached identity/list/bootstrap, a committed week-1 checkpoint with lost acknowledgment, and a failed week-2 request followed by recovery. Nine synthetic GET attempts and two original period checkpoints were asserted before its first context read failed at about **307.093 seconds**. Changed refresh, the planned 16-GET/eight-receipt-witness assertions and historical/current composition were not reached. Case 7 failed immediately because its fixture was assigned only after the end of failed case 4; its role-denial, immutable-history and reprovisioning assertions did not run. No case or unexecuted assertion tail receives qualification credit.

The unchanged candidate binds seven cases to fixture LF SHA-256 `112c827b74b1986a1f7fc22b468cd36b0b22de1bc5bb9cb022dc34265438e7be`, profile digest `59d26bc7536cbf9a19478873ad4b554ccd54a7a83ff1528c30735c0db2b77944`, and run context digest `a10c26b5f2e982b8ab1e183c74958826aee3326969bf1419a5e4106969ab0bfb`. The pre-run preservation audit found all 18 older profile contexts/digests/arguments, 44 migrations, 55 older SQL fixtures and 109 other integration files plus supervisor/config unchanged. YAML parsing and 26 stubbed dispatch checks passed. Default discovery gained only this ordinary module (52 to 53); live modules remain excluded. The authored 24-minute allowance remains an unmeasured full-success duration, because this attempt stopped early.

Independent artifact and storage audits accepted twelve contiguous immutable journal snapshots for run UUID `b5b6cfdc-5d39-438e-8703-e073f7db858a`. At `2026-10-10T20:30:35.5873157Z`, the supervisor explicitly acknowledged terminal `run-1791663804361-081a0ef1-a5b5-45e0-a51f-361f12155bdc-0012.json` with outcome failed. Child/process-group closure, schema cleanup, generated credential revocation and owned-branch deletion were all true; unresolved resources were empty, failures contained only `tests`, and `productionWrites` was false. The zero-byte unsuffixed file is the reserved journal path, not terminal evidence. Exact raw SHA-256 bindings:

- Qualification report: `33ea42f5cfa2d20092e90a91fddfb014f9117522d0f51e266f1391cb4428554b`.
- Qualification cleanup: `5ceb4fc70b2d15408bcf18f4e414631f095fa6ecf90be6f9f0443c78315ac2dc`.
- Acknowledged terminal journal 0012: `4c8b0dcacb3809720cf7aca4cb4b13e524dcb862245bbee16294fb39377f2b25`.

Vitest reported **418.22 seconds**; supervisor lifecycle measured **431,335 ms** and the workflow job **455,000 ms (7m35s)**. These stayed inside the unchanged 30-minute work, 40-minute lifecycle and 50-minute CI limits; worker/admission gates remained 20/60 seconds and branch expiry one hour. The provider witness identified the exact child `br-super-water-b7lcvk2h`, fixed **0.25 CU**, and provider-reported PostgreSQL major 18. At the saved cleanup observation `2026-10-10T20:33:45.6249261Z`, a fresh authenticated Console list showed that child absent and only baseline `br-plain-bread-b7sgfdl8` remaining, without manual deletion. SQL patch version and actual billing were not measured. Cleanup does not qualify the failed reader or prove full-run performance.

The single authorized disposable run, with its **$1 allowance**, is consumed; no retry or additional SQL run is authorized. Audits and original artifacts remain under `apps/site/test-results/data-backend/cp9/sql-38083504310`, with separate `provider-witness-38083504310.json` and `provider-cleanup-38083504310.json` observations. No runtime/fixture fix, retained database change, merge, production deployment or activation followed. Fresh authority checks retained canonical `clawmachinejed/league-one-audit`, `apps/site`, production branch `main`, and local/GitHub/Ready Vercel production at `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`. CP9 diagnosis and correction remain outstanding; **CP10 has not started**. CP8 and all earlier records retain their original bytes and source/run bindings.

## CP8 current-2026 native-period inventory — accepted six-case qualification, October 10, 2026

**Checkpoint 8 implementation and resource qualification are accepted within
this bounded current-2026 scope.** [Run 38078013307, attempt 1](https://github.com/clawmachinejed/league-one-audit/actions/runs/38078013307)
qualified exact source `860a6c8c1a1ab541daf2cf0bc8d469d25317597e` using
only `data-period-inventory-v1`. All six ordered cases were collected,
executed and passed once, with zero failed, skipped, filtered, retried,
repeated or flaky cases and zero unhandled errors. The single beforeAll and
afterAll hooks each started and ended once. Full nonempty 18-period acquisition
and terminal full-mode refresh remain unqualified.

1. **Data resource:** explicit `periodInventory: 'sleeper-2026-native-period-inventory-v1'`
   with seasons exactly `[2026]`. Weeks 1–18 are requested endpoint coverage, not
   a provider-advertised availability list. Mixed `exactPeriods` are rejected;
   omitted and legacy exact selectors retain their prior wire and behavior.
   Retained references are `settings.leg`, `settings.last_scored_leg`,
   `settings.start_week` and `settings.playoff_week_start`. Absent, null,
   invalid, known zero and positive values stay distinct. Known references
   above 18 produce explicit coverage gaps without out-of-range acquisition,
   endpoint-availability, competition-phase or historical-settings claims.
2. **Existing path:** existing public Sleeper identity/list/bootstrap/matchup
   captures and administration acceptance → existing fenced intake tasks and
   checkpoints, extended by migration 044 → `public-intake-reader.ts` and
   `public-refresh-reader.ts`, with bounded metadata composition in
   `neon/public-period-inventory-reader.ts` through the existing store facade.
   Contracts/adapters require installed 044 before a new-mode mutation. Refresh
   configuration, cycle and request
   identities are checked independently. No provider, normalizer, coordinator,
   worker, queue or scoring pipeline is added. CP9 phase/settings and CP10
   exact-score parity remain later work.
3. **Persisted result:** one immutable plan per retained candidate, at most
   1,000; the existing owner admits at most 20 in its original selection order,
   with 18 durable tasks each, at most 360. Other candidates retain explicit
   capacity accounting. Task identity includes league, 2026 and native week.
   Immutable source records preserve every raw list occurrence by ordinal,
   including conflicting duplicates, and each retained bootstrap capture.
   Readers verify the complete task matrix, exact source manifests, raw field,
   timestamp and acquisition parity using the maintained typed settings
   normalizer. Global collection status/counts are separate from current
   resource acceptance and detailed page coverage (default/max 20). Pagination
   cannot imply completed collection or invent pending work. Capacity, source
   gaps, missing scopes and terminal discovery failures remain explicit; phase
   stays unknown.
4. **Real evidence and gaps:** the maintained report and artifact validators
   accepted exact source, module, profile, context and report bindings.
   Independent review accepted all twelve immutable journal snapshots, final
   acknowledgment and cleanup. The frozen source on `codex/data-period-inventory`
   is published in [draft PR #297](https://github.com/clawmachinejed/league-one-audit/pull/297),
   based on CP7 closeout `864e5a4d8b26a467eb854dc90b5d7610e83974e0`;
   scope confirmation is `DATA-CP8-2026-10-10-PERIOD-INVENTORY`.
   Focused intake/refresh/reader tests passed 283/283 across four files,
   including 360-complete collection versus 20-item pages, 17-of-18 rejection,
   unsorted admission, omitted duplicate/bootstrap evidence, source states and
   terminal discovery failure. These unit controls remain separate from the
   actual SQL cases below. Synthetic HTTP inputs do not qualify live Sleeper,
   sustained recurrence, fleet/freshness targets, fresh-role provisioning,
   the full SQL suite, production installation or complete backend readiness.
   CP9 competition phase/settings is next; CP10 exact-score parity remains later.

   The initial complete source verification recorded 6,667 passes, two failures
   and one skip across 297 files. The unchanged architecture rule identified
   SQL outside the Neon package; the helper was relocated and exposed through
   the existing store facade without changing the rule. The correction passed
   302/302 architecture and intake/refresh tests, scoped lint and type checking;
   dependency inspection found no store-to-intake-reader back-edge. The other
   failure was the unchanged diagnostics test exceeding its original five-second
   timeout.
   That complete diagnostics file subsequently passed 220/220 in isolation
   (12.29 seconds); the timeout's cause is unproved. The one skip was the
   existing scoped-IPv6 listener case on a host with no scoped IPv6 interface.
   No timeout or test allowance was changed. The second complete source run
   after relocation exited 1 with 6,668 passes, one failure and one platform
   skip across 297 files in 36.80 seconds. Architecture passed; the sole failure
   was the same unchanged diagnostics case timing out at 5,041 ms against its
   5,000 ms limit. The isolated 220-case pass does not replace either failed
   complete run, and the cause remains unproved. Logs are retained at
   `apps/site/test-results/data-backend/cp8/verify-full-source.log`,
   `verify-full-source-r2.log` and `diagnostics-isolated.log`. The standalone
   `pnpm build` then passed (exit 0), recorded in `cp8/build-source.log`; this
   completes build verification separately and does not make either local full
   verification run pass. Both local failures and the isolated pass remain
   historical evidence; the later hosted pass below does not explain their
   timeout. Earlier CP5–7 source/result bindings below remain unchanged.

[Source CI run 38077097334, attempt 1](https://github.com/clawmachinejed/league-one-audit/actions/runs/38077097334)
passed the complete verification workflow on Node 24.21.0: all 6,670 unit tests
across 297 files passed with zero failures or skips, followed by a successful
build. The public browser lane passed 121 tests with 20 account-fixture cases
intentionally excluded; the required companion account lane passed all 20 with
zero skips. Both browser lanes recorded zero failed or flaky tests and zero
observed retries. Browser retry capacity remained configured at one; no retry
was observed and this was not a workflow rerun.

CI checked out merge commit `c08dd945aedefd6d1143093c61a828a0cc39e17c`.
Its tree and source-head `860a6c8c1a1ab541daf2cf0bc8d469d25317597e` share
exact tree `557b07542a69c0645ca5ea9edd1182e3dcc1b2af`. The source audit,
checkout/API evidence and job logs are retained under
`apps/site/test-results/data-backend/cp8/source-ci`; the independently inspected
`audit.json` records these bindings and the distinction between configured and
observed retries. This is source/browser verification, not PostgreSQL evidence.

The [Vercel preview](https://leagueonefantasy-duqiq00o1-robert-finchums-projects.vercel.app)
was Ready at deployment `ERYR5LPKubEwRe6XUUxuUqsFsQXu` for exact source
`860a6c8c1a1ab541daf2cf0bc8d469d25317597e`. Actual in-app browser inspection
at `2026-10-10T18:51:11.1081497Z` observed My Fantasy's no-selected-team
state and 2026 manager lists for League One (12), League Two (12) and Dynasty
(10); League One's layout was visually inspected and no application-error view
was observed. `cp8/preview-evidence.json` records the inspected routes and
source binding. This protects existing website behavior and does not install
or qualify migration 044 or the new inventory mode. No manual deployment,
merge or production release is claimed.

The accepted SQL cases exercised the following through the maintained
restricted-role path; no existing guards or worker/admission limits changed:

| Case | Actual bounded proof |
| --- | --- |
| 1 | Current-2026 full-inventory scope, immutable replay identity and unchanged omitted, empty and legacy exact selectors before admission. |
| 2 | Observed late inventory-write lock and complete checkpoint rollback, followed by 1,000 unsorted candidates: 20 admitted leagues × 18 durable tasks, with 980 capacity exclusions accounted for and bounded page reads. |
| 3 | Ordinary empty discovery completes with zero inventory and no invented period availability. |
| 4 | Ordinary week 1/2 acquisition, lost acknowledgment, one failed response and recovery; duplicate source clues including 19, exact capture guards and a changed refresh retain both 18-task inventories. Each has two completed and 16 pending periods. |
| 5 | Immutable task/capture/cycle history, scope and replay rejection, configuration CAS and current-source mapping fences. |
| 6 | Actual role denials for direct mutations/private helpers and restricted grants through existing-role reprovisioning with rollback. This does not prove a fresh-role lifecycle. |

The fixture LF SHA256 is
`87204fdc856c2d1e90a589c342a1335f0fc11f95cc2fc9ea13ca58dfed428e09`;
profile digest is
`996ac29d889a75cad605152ba8cd7e86fca2007b10fcd33689197707bd905543`;
context digest is
`7302625c54c46c9abc97a66daa7479310fa04a37bf0ebbfe8bb1ceafba5110a7`.
Case 2 took 145,908.096214 ms; case 4 took 670,903.889328 ms. Those whole-case
durations include multiple attempts and do not expand the 20-second worker or
60-second admission limits. Vitest took 1,017.94 seconds; the measured
supervisor lifecycle was 1,028,054 ms. The workflow job ran 19:00:18–19:17:48 UTC
(17 minutes 30 seconds), within the authored 27-minute test/hook allowance and
unchanged 30/40/50-minute work/lifecycle/CI limits.

Supervisor run `7527ce86-84df-41cb-bff4-e304f80f7b4c` ran from
`2026-10-10T19:00:37.805Z` to `19:17:45.747Z`. The sole terminal
acknowledgment at `19:17:45.7576415Z` names immutable receipt
`run-1791658837800-9538684f-956f-4922-a076-8045f4bbdca3-0012.json`.
All twelve journal sequences are contiguous. Tests and qualification passed;
POSIX child-tree closure, schema cleanup, generated credential revocation and
branch deletion were all verified, with empty failures/unresolved resources,
no cancellation and `productionWrites: false`. The reserved zero-byte
aggregate file is not the terminal receipt.

Authenticated Neon Console evidence at `19:01:39.3431949Z` bound child
`br-sparkling-mountain-b7f4qtxh` in project `steep-glitter-44680287`
to the same run UUID, provider-reported PostgreSQL 18 and 0.25 CU. Fresh Console
navigation at `19:21:11.7166956Z` showed only `integration-test-base`;
the exact child was absent before its `20:00:38Z` fallback expiry.
SQL patch/build and actual provider billing were not measured. The approved
single paid-run allowance is consumed; it grants no retry, additional SQL run,
retained migration application, merge or production release authority.

Artifacts remain under `apps/site/test-results/data-backend/cp8/sql-38078013307`;
`qualification-audit.json` lists the raw input hashes. Final SHA256 values are:

| Evidence | SHA256 |
| --- | --- |
| Qualification report | `4055339ca638c75f04b24fc51e57041eaaa7d32da9f6c2e506bb047267c52059` |
| Global cleanup | `6266c810e2b61f9e88621b5ab3dd99feed61744d2bc1bc3791cdf1fb7c7ff5cb` |
| Terminal journal 0012 | `6def6f21360ed3a78a69c45ca342cca56d7f80968020029fb8b32107f988e29c` |
| Maintained-validator audit | `a4136fd8791962e9d13e93886337f2d6e6398ef47a4d5f983c47a96c825bac83` |
| `cp8/provider-cleanup-38078013307.json` | `0ec28742004e8f7e3cacf3a6735fefd3d70129f87a4412cb585f3942e9a4ae36` |

## CP7 manager and commissioner facts — accepted nine-case qualification, October 10, 2026

**Checkpoint 7 implementation and resource qualification are complete within the
bounded current-2026 scope.** [Run 38071709157, attempt 1](https://github.com/clawmachinejed/league-one-audit/actions/runs/38071709157)
qualified exact source `62b9f7710b8dda31e5723a6942911b85515bd014` on
`codex/data-manager-facts`, using only `data-team-manager-facts-v1`.
The separately approved corrected-source attempt collected, executed and passed
all nine cases once, with zero failed, skipped, filtered, retried, repeated or
flaky cases and zero unhandled errors. The single beforeAll/afterAll pair each
started and ended once. The earlier failed attempt remains recorded below;
neither its partial passes nor offline repairs supply this qualification.

1. **Data resource:** season-scoped team and provider-manager identities, primary
   ownership, vacancies, co-owners and ownership changes, plus independent
   Sleeper `users.is_owner` commissioner facts. True, false, absent, null and
   invalid raw values remain distinct; multiple commissioners are supported
   without inferring ownership or website/account authority.
2. **Existing path:** existing Sleeper captures and administration normalization,
   writer, relational identities and immutable storage, extended by migration
   043. Existing backend readers compose an exact retained directory capture
   under the current mapping guard. V1 primary-owner intake completion and V2
   latest-current-mapping evidence retain their separate meanings. No provider,
   worker, account or projection pipeline was added.
3. **Persisted result:** all nine restricted-LOGIN SQL cases passed raw/typed
   commissioner parity, identity reuse and immutable corrections/history/replay;
   unknown primary ownership beside valid co-owners; reservation ordering and
   source remapping; independent partial, malformed and unavailable directories;
   forged facts/mappings/fences; observed late-write rollback for both
   relationships and typed directory facts; and actual role/private-helper
   denials. Ordinary intake and one changed-ownership refresh passed a users
   failure followed by complete-empty directory recovery, exact historical
   capture readback, mapping gates and stored-only composition.
4. **Real evidence and gaps:** the maintained report and artifact validators
   accepted the exact source/profile/module/report/context bindings. Independent
   review verified all twelve immutable journal sequences and terminal cleanup
   acknowledgment and accepted the bounded result. HTTP inputs were synthetic: this
   proves
   the selected PostgreSQL behavior, not live Sleeper acquisition, sustained
   recurrence, fleet targets, genuinely fresh-role provisioning, full SQL-suite
   coverage, production installation or complete backend readiness.

The fixture LF SHA256 is
`cf206755ad34e916cb9606eb9c12259340ef3f603362c2f87d2299a52c0e058d`;
profile digest is
`ac2e58e56ba384f418d3e71a66f1ab291fd4dd11daf219197f95307b618afbe7`;
context digest is
`871d6b142d230156c233859099cdefc50e3db1f4199eeca389413a1f0eb0b1cf`.
The two-deadline rollback case took 34,607.834 ms; the ordinary intake/refresh
case took 614,556.483 ms. These whole-case measurements include multiple work
attempts and do not expand the unchanged 20-second ordinary-worker limit.
Vitest took 771.02 seconds, and the supervisor lifecycle was 784,612 ms within
the unchanged 30-minute work / 40-minute lifecycle / 50-minute CI limits.

Supervisor run `008e2692-2ddd-4dcd-8626-09360de901a0` ran from
`2026-10-10T17:26:37.070Z` to `17:39:41.579Z`; terminal acknowledgment at
`17:39:41.5899538Z` reports tests and qualification passed, POSIX child-tree
closure, schema cleanup, generated credential revocation and deletion of child
`br-odd-sun-b7z587py`, with empty failures/unresolved resources and no
production writes. Fresh read-only Neon Console navigation at
`17:40:55.8179472Z` independently showed only baseline
`br-plain-bread-b7sgfdl8` in project `steep-glitter-44680287`.
During-run Console evidence bound the exact child to provider-reported
PostgreSQL 18 and 0.25 CU. Patch/build and actual billing were not measured.
Deletion was observed before the fallback expiry. The second single-run
authorization is consumed; its $1 allowance was not a provider billing cap.

Artifacts remain under
`apps/site/test-results/data-backend/cp7-run-38071709157`; report and global
cleanup are in
`artifacts/integration-62b9f7710b8dda31e5723a6942911b85515bd014-1/artifacts/run-evCwbk`.
SHA256 values:

- Report: `dcdbae285c36916b200e214bc9e5c875ea5b79c318933d97f6f1f22b543e38dd`.
- Global cleanup acknowledgment: `6624517ef9c35f9286236825f9437c3a8645d70a05748faedb8c48cf97675ebc`.
- Terminal journal 0012: `3382886399444e5e23816970cc98086dac757518abba4a72b8219676c183ee56`.
- Workflow log: `2bf0713f4b6dded4589cfc4eb5e820d06421a80bc69c2a3daf87ad4edec2082a`.
- Provider cleanup observation: `4173ef13aab115907603fbcc34169bfc688448de0ca396305eb6500399b7fa39`.
- Independent `storage-validation.json`: `87910cd0cfa184fc37ae0f4fb779c3bb0fcfcfcfd667e4462ef5a1cdd6748061`.

Corrected-source [CI 38069762290](https://github.com/clawmachinejed/league-one-audit/actions/runs/38069762290)
passed scope, dependency, lint, type and build checks plus all 6,596 unit tests
across 295 files with zero skips. The merge checkout
`f4be7d57e084defb62bbb4eaf017222b180e640b` and executed source share exact
tree `42ae6bc76021105924d7fa6384f28a307a54a8bd`. Public Chromium checks passed
121 cases with 20 intentional account-fixture exclusions; the separate account
command passed all 20 cases with zero skips. No retry/flaky summary was observed.
Both browser commands verified a clean local served build; they were separate
from deployed-site inspection. The retained source-CI summary binds these
results to `62b9f77`, not the original failed candidate.

Ready deployment `J9RAvnvNgHGQxF8V7JmroKfkyKnm` at the
[corrected-source preview](https://leagueonefantasy-he3ao2n0d-robert-finchums-projects.vercel.app)
was checked against exact `62b9f77` and inspected in the built-in browser:
My Fantasy guest state, 12 League One cards, 12 League Two cards, 2026/History
tabs and scoped navigation. The original preview's Dynasty observation remains
bound to its earlier source. Preflight local/origin/GitHub main and Ready
production still agreed on `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`, with
canonical repository, `apps/site` root and production branch `main`;
no competing integration run was observed.

This closeout changes only the evidence ledger and preserves executed-source
identity. CP5/CP6 evidence stays bound to its own source. Both default local
full-verification failures and the earlier SQL/offline diagnostic failures remain
historical evidence below. No further paid run, retained migration, activation,
merge or production release is authorized by this result.

## Historical CP7 first attempt — failed qualification, October 10, 2026

> The following section preserves the state at the failed attempt and its offline
> repair, before the separately authorized successful run recorded above. Its
> present-tense unqualified statements apply to that historical state only.

**SQL qualification rejected; disposable cleanup accepted.** The single approved
attempt tested exact source `be4bb9ef1252d3b57217989769311668e9e996a1` on
`codex/data-manager-facts`, based on
`d073c86042398da56f0dc23abc40e7dc18d0182e`. It reported two passing and seven
failing cases. The failed source remains in the history of draft
[PR 296](https://github.com/clawmachinejed/league-one-audit/pull/296); source checks,
preview inspection and cleanup do not turn this result into qualification.
Local fixture repairs remain SQL-unqualified. The one-run authorization is
consumed; no retry, retained installation, merge or production release follows.
CP5 and CP6 evidence remains bound to its original source.

1. **Data resource:** current-2026 league/season-scoped teams, primary owners,
   vacancies and co-owners, plus independent official Sleeper `users.is_owner`
   commissioner facts. Commissioner true/false, absent, null and invalid raw
   values stay distinct; multiple commissioners are allowed. Commissioner
   status proves neither roster ownership nor website/account authority.
2. **Existing path:** the existing Sleeper users/roster captures and
   `normalizeAdministrationObservation` feed the same administration writer.
   Additive migration `043_manager_directory_facts.sql` stores a version marker
   and immutable typed facts beside existing users content and manager identities.
   `neon/team-managers.ts` reads the exact existing directory capture with the
   current source-mapping guard; `public-intake-reader.ts` composes it as retained
   evidence. Existing v1 primary-owner completion and v2 latest-mapping evidence
   remain distinct. No provider call or alternate worker is added.
3. **Persisted result:** the implemented contract checks raw-to-typed commissioner
   parity, identity and population completeness, including a complete-empty marker,
   inside the existing writer transaction. Exact capture time and database
   recording time retain separate meanings. Typed commissioner presence and raw
   parity were observed before the first case failed; the ordinary case also
   passed initial typed-capture readback and normalizer/binding assertions.
   Forged-evidence/fence rejection and restricted-role checks completed in the two
   passing cases. This partial evidence does not establish the nine-case contract:
   ownership history, empty-directory recovery, historical capture/remap gates
   and the new late-write rollback exercise were not completed. CP6 roster links,
   immutable prior migrations and original worker deadlines remain in source.
4. **Real evidence and gaps:** file-purpose and substantive peer reviews are
   recorded under `DATA-CP7-2026-10-10-MANAGER-FACTS` by
   `/root/cp7_contracts`, `/root/cp7_storage` and `/root/cp7_qualification`;
   these are engineering reviews, not infrastructure authority. The reader's
   database-clock/collector-clock mismatch was independently reproduced and
   corrected before the frozen run. Focused source checks passed 327 tests;
   independent normalizer/reader/migration-source checks passed 41 tests across
   three files. These sets overlap and are not additive.

   **Both default full local verification attempts remain failed:** each passed
   dependency, lint and type checks, then reported 6,594 passing tests, one failure
   and one existing scoped-IPv6 skip across 295 files. The unchanged diagnostics
   test exceeded its 5,000 ms limit at 5,092 ms and 5,055 ms, so neither workflow
   reached build. Its exact isolated case and unchanged 220-test file passed;
   the timeout cause remains unproved. No timeout/configuration workaround was
   applied. Both failed logs remain retained. A separate local build passed.

   [Hosted CI 38063134792](https://github.com/clawmachinejed/league-one-audit/actions/runs/38063134792)
   passed dependency, lint, type and build checks and all 6,596 unit tests across
   295 files, with zero skips. The diagnostic case passed in 1,446 ms. Public
   browser checks passed 121 cases in 6.3 minutes with 20 intentional account
   exclusions; all 20 account cases passed separately in 23.5 seconds. No failed
   or flaky summary appeared. Both served-build provenance checks used clean
   merge checkout `9db86f957686d27abfc2320cd9139cc2db58f3a5`, whose tree
   `1e7b9e260e73856001e30043f445d789226cfff9` matches the reviewed head.
   The Ready [exact-source preview](https://leagueonefantasy-febmbfoqx-robert-finchums-projects.vercel.app)
   was inspected in the built-in browser: My Fantasy guest state, 12 League One
   cards, 12 League Two cards, 10 Dynasty cards, 2026/History tabs and scoped
   navigation. No layout regression was seen in the inspected Dynasty view.
   This is existing UI evidence, separate from SQL qualification.

   **Approved attempt and failure.**
   [Disposable run 38068331831, attempt 1](https://github.com/clawmachinejed/league-one-audit/actions/runs/38068331831)
   selected only `data-team-manager-facts-v1` at `be4bb9e`, with fixture LF SHA-256
   `22955191422cb8601647cd31254c9e8aa3b9d555c2d8080bc59f986509127e23`.
   The report proves all nine cases executed once in source/chronological order,
   one beforeAll/afterAll pair each started and ended once, zero retries, repeats,
   skips, flaky cases or unhandled errors. Cases 6 and 8 passed: forged directory
   facts/source mappings/worker fences and actual restricted privileges. The
   maintained report and artifact validators correctly reject the seven failures.

   Cases 1–5 and 7 stopped at their initial accepted-manager read returning
   `missing`. Case 1 had already passed all six commissioner presence/value/raw
   assertions, exact stored projection parity and season binding. Case 7 stopped
   before either observed lock, either 15-second fence expiry or any late-write
   rollback assertion. Corrections/history/replay, uncertain-owner/co-owner,
   reservation/remap and directory-failure assertions in the other failed cases
   were not reached. The two passing cases do not prove a nonempty accepted-manager
   baseline or genuinely fresh-role provisioning.

   Case 9 passed initial ordinary intake, six HTTP requests, typed directory
   normalizer/capture/mapping/season parity and initial primary-manager readback.
   It reached the changed refresh and unavailable users response, with 12 requests
   asserted, then failed at fixture line 510: the expected one-element teams array
   did not match the returned three teams. The thirteenth-request empty-directory
   recovery, historical capture, stored-only read gate, unrelated/missing mapping,
   server witness and final remap assertions after that point were not reached.
   Passing statements before failure are partial observations, not passed cases.

   **Offline reproduction and fixture-only repair.** Separate local checks used
   the actual registrar, normalizer and readers with a fake database boundary.
   Configured registration with empty `scoringRules: {}` produces hash
   `44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a`,
   while normalization of empty official `scoring_settings: {}` produces null.
   The official-data empty control returns null on both sides; the configured
   `{ rec: 0.5 }` control produces matching hashes. The actual readers return
   `missing` when their query yields no accepted head. A model of the frozen
   R037/R039 predicates predicts that the mismatch records a configuration
   conflict, removes usable roster-population evidence and prevents acceptance.
   That predicate evaluation is not PostgreSQL execution, and the failed artifact
   does not retain the rejected acceptance row needed to directly witness the
   complete SQL rejection chain. The narrower proven facts are the actual
   registration/normalization mismatch and the failed run's missing reader result.

   A separate network-blocked reproduction using installed Vitest first passed
   one test expecting the original one-team nested `toMatchObject` assertion to
   fail against the documented three-team result. Its expanded two-test check
   also passed: the repaired assertion extracted from fixture source accepts all
   three teams and rejects an extra team, wrong owner, lost vacancy/co-owner or
   wrong native team ID, with zero network attempts. Both outputs are retained. Fixture-only repairs align synthetic registration
   and captured scoring rules, add immediate acceptance checks, and assert all
   three changed-refresh teams. No application or migration repair is selected.
   These offline checks and source repairs do not reexecute the SQL cases or
   qualify the unreached history, recovery, mapping or rollback assertions.
   Their evidence is retained in `cp7-offline-population-repro.mts/.log`,
   `cp7-offline-population-repair.mts/.log` and the run folder's
   `offline-case9-repro` files. The repair check extracts the shared scoring rules
   from the current fixture and confirms the matching actual hashes while
   retaining the original empty-scoring mismatch as a control.

   The combined fixture-only repair received independent source review; only
   its CP7 profile pin changes to LF SHA-256
   `cf206755ad34e916cb9606eb9c12259340ef3f603362c2f87d2299a52c0e058d`.
   Names, nine-case order, hook inventory, prior profile pins, worker limits and
   application/migration bytes are unchanged. Focused repair checks passed all
   192 tests across three files; targeted fixture/profile ESLint and final Node24
   `next typegen && tsc --noEmit` passed. An initial repair type check failed
   because ignored diagnostic `.ts` scripts were included by the broad app
   configuration. That failed output remains retained; the scripts were renamed
   byte-for-byte to `.mts`, and the repeat passed without tracked configuration
   changes. This separate local diagnostic failure is not either original full
   verification timeout or the SQL failure. The original `be4bb9e` failure and
   fixture digest remain unchanged. Hosted CI and preview results above bind
   only the original source; repaired source has no SQL execution or qualification.

   Vitest took 657.21 seconds, including 627.31 seconds reported for tests/hooks;
   the supervisor lifecycle was 670,614 ms (about 11m11s). The nine authored case
   limits remain eight at 60 seconds and one at 900 seconds, with two 120-second
   hooks: 27 minutes before harness overhead. A failed early-stop measurement is
   not a successful workload-fit guarantee. The original 20-second worker,
   30-minute work, 40-minute lifecycle and 50-minute CI limits were unchanged.

   **Cleanup accepted separately.** Immutable journal sequences 0001–0012 retain
   the failed run. The final acknowledged receipt and failed process exit agree:
   `tests=failed`, `qualification=failed`, `failures=["tests"]`, no cancellation
   and no unresolved resources. Child process-group closure, schema cleanup,
   generated credential revocation and child deletion are all verified. The global
   cleanup acknowledgment binds report LF SHA-256
   `29e56eeef64fe71147c1c31f7b02274ed000b709be35a857e94984443726b3dc`;
   no sticky timeout/reporter/cleanup-failure marker exists. The terminal receipt
   raw SHA-256 is
   `0b3085bf8568c43517710138eb7c71e82e3a1cdb96fee7eb3c2b1ce8c5e05167`.
   Root independently observed the approved Neon project's branch list afterward:
   only `integration-test-base` remained; child `br-bitter-hill-b7g57p9k` was absent.
   The run used one 0.25-CU child on PostgreSQL major 18; the patch version was not
   measured. Authorization was up to $1, not an enforced provider billing cap;
   actual billed cost/invoice was not measured. No live Sleeper request or
   production write was selected. Sanitized logs, source/report/cleanup bindings,
   journal snapshots, provider observations and independent rejection validation
   remain under `apps/site/test-results/data-backend/cp7-run-38068331831` locally.
   Any repaired source needs its own independently reviewed binding and separately
   authorized qualification; this failure is never relabeled as a pass.

## Current core recovery — October 9, 2026

**Bounded core recovery complete; compatibility and live SQL accepted. No merge or production deployment.** This bounded recovery starts from `e8176f26a30c705e8059c40a56afadc45ac35064` on `codex/username-core-recovery`. Its outcome is the existing generic Sleeper username plus declared season path: stable provider identity, associated-league discovery, core official import through the existing adapter and shared PostgreSQL store, committed stored-only readback, replay and refresh without loss of accepted history. DannyPak and stored League Two are test inputs, not runtime identity filters or a fixed discovery count. This core milestone is distinct from the broader data-backend-v1 matrix below.

Only three corrections are selected: reproduce and repair the legacy all-player/DATA enrollment mismatch additively; incorporate the reviewed `f83ac8c` response bounds; reconcile current status here with the compatible `23e9148` documentation cleanup. Existing 001–039 migration bytes, historical evidence, diagnostic fixes and exact-week behavior are preserved. Multiweek/R040 work on the separate combined branch is not incorporated; any newly numbered compatibility repair is unrelated to that deferred multiweek work.

### Exact core acceptance list and evidence plan

| Assertion | Existing path and evidence | Necessary current proof |
| --- | --- | --- |
| Generic username/season resolves stable provider identity and accounts for every discovered league within explicit limits | Existing public intake coordinator, Sleeper capture and canonical manager/league registration; ordinary randomized intake fixture; original live `f20eab3` proof | Existing ordinary fixture plus existing live public-intake case; never require exactly four leagues in runtime |
| Official settings/scoring/status, teams/managers/co-owners, held roster categories/native IDs and provenance survive committed readback with no hidden provider fallback | Existing typed writers and `public-intake-reader.ts`; ordinary fixture and prior live source/stored comparisons | Restricted LOGIN fixture and live typed/raw parity; unresolved canonical player links stay explicitly unresolved |
| Replay keeps canonical identities and refresh preserves history/last-good data after failure | Accepted changed-fixture `91aec119` and `592a60a` B controlled correction/lost-checkpoint/history results at their original SHAs; existing intake/refresh unit tests | Focused unit checks and existing live two-collection refresh; unchanged historical source behavior is not rerun merely for documentation |
| Public capture resources are bounded without changing successful payloads or capture seals | Reviewed `f83ac8c` byte/value/depth, cancellation and intake-failure regressions | Port exact intended change; targeted tests, final candidate verification and one live path |
| Unadopted DATA never enlarges the active legacy profile/parity population; exact-season account adoption remains included | Runtime enrollment inventory excludes unadopted DATA; baseline R037 filtered only NULL profiles, and additive 040 now aligns the legacy membership rule | Baseline 38003655733 reproduced the shared/distinct-profile defect; accepted corrected run 38008537554 covers owner/readiness and genuine restricted LOGIN publication/pregame regressions with ACLs, fences, accounting and history retained |
| Evidence binds exact candidate and full disposable cleanup | Existing supervisor, closed profiles/reporter and protected CI environment | Exact selection, source/hook inventory, no selected skip/retry, child closure, schema cleanup, generated credential revocation, branch deletion and terminal acknowledgment |

SQL has two purposes only: focused core/compatibility fixture verification (including the before/after reproduction), and the existing `data-live-public-intake-v1` whole path. The fixture selection uses the ordinary intake case, four existing all-player publication cases and two existing pregame cases through the existing supervisor. Existing 0.25 CU, 30-minute work, 40-minute lifecycle and 50-minute CI job bounds remain. The live case historically took about 28 minutes; this is measured prior duration, not a new guarantee. The baseline reproduction and corrected fixture run are recorded separately below; no blanket repeat of all 25 intake cases or additional qualification queue is authorized.

**Preflight.** Fresh checks in this task agree on clean local/GitHub `main` `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`, canonical Vercel repository/root/production branch, and Ready production deployment `8C3YSnXRCbmPETftQgRtirfyck5e` at that exact SHA. Public `/managers` and `/league2/managers` returned 200. No competing owner observed in inspected worktrees, open PRs, recent workflows and deployments. Production cron logs and database leases were not inspected. The Neon console identifies only the approved test parent `br-plain-bread-b7sgfdl8` in `steep-glitter-44680287`; this preflight preceded the isolated baseline attempt recorded below. The existing protected credential is reused only through the guarded workflow; no new key is permitted.

**Cost evidence.** The existing $1 isolated-test authorization persists, but prior cumulative actual billing is unmeasured and is not a provider-enforced cap. The current console's parent-branch usage and organization-wide spending cannot establish cumulative deleted-test-branch charges or remaining headroom. No renewed budget or cost guarantee is inferred.

**Reporting-correction checkpoint verification and publication.** The exact response-bound port passed 178 focused offline tests in two files; existing refresh/identity/discovery checks passed 233 tests in three files; profile, reporter, diagnostics and supervisor checks passed 317 distinct tests. Changed-file lint, generated route types, a direct TypeScript compiler invocation, scope and whitespace checks passed. Independent Astra Ultra source review accepted the baseline restricted-LOGIN reproduction and fixed three-module profile before any SQL dispatch. Offline checks do not qualify SQL. The baseline source is published at `7d81bb90b3ee85b4036553ec7aaaf17be9e41725`; the reporting correction is published at `4395602873cb5dcb9408f21a2ed160c9f71ca210` in [draft PR291](https://github.com/clawmachinejed/league-one-audit/pull/291). Its [CI38004698215](https://github.com/clawmachinejed/league-one-audit/actions/runs/38004698215) passed 6,332 unit tests across 287 files, 121 public browser checks with 20 intentional account-case skips, and 20 separate synthetic-account checks. Exact-source Ready preview `9Yu6tZXAMoaw23RaHUgBqfBEEdg1` rendered both league manager pages with twelve distinct cards in the built-in browser. Both CI jobs checked out merge `2a570fb85f4d305cec244297a100e9c55faab0c9` containing the exact checkpoint head, with identical tree `272b23013f94b47c462decda9f86842a36662812` and clean served-build provenance. Independent proof `test-results/core-recovery/ci-38004698215/proof.json` has SHA-256 `1f8d171ad17c6e51a15a49f4c20d9bbcd53cc35702b1765cd57039573397df1f`. These results belong to checkpoint4395602; evidence for the later additive candidate is recorded separately below. This branch is unmerged and undeployed; retained database/production activation is a separate release gate. Disposable proof leaves no persistent DannyPak dataset.

**First baseline attempt remains failed.** [Run 38003655733](https://github.com/clawmachinejed/league-one-audit/actions/runs/38003655733), attempt 1, executed exact `7d81bb9` and produced seven raw passes in three modules (89 collected, 82 filtered, eight hooks), including both expected restricted-LOGIN shared/distinct-profile rejections with unchanged state. Independent source/artifact review confirms actual defect reproduction; it does not grant accepted-profile credit. The supervisor rejected the evidence because two filtered `it.each` labels in the closed inventory omitted Vitest's quoted/truncated object-label formatting. The failure was reproduced offline from the preserved raw report before correction; no SQL retry was used to diagnose it. Its terminal journal and workflow log acknowledge process-group closure, schema cleanup, generated credential revocation and deletion of child `br-mute-resonance-b7a3ijdu`, with no unresolved resources. Lifecycle was 261,717 ms; the ordinary intake body was 243,888.806 ms. Its diagnostic reports PostgreSQL 18.6 (`180006`), no first failure and completed stored-reader boundaries. A fresh Neon console inspection showed only the approved parent after cleanup. Raw artifacts and all twelve journal records remain under `test-results/core-recovery/baseline-38003655733`; report SHA-256 is `11aff466db39083004ec94110731a32ae42f8e78c26054cf8a6dc4f31341db91`. This failed attempt is preserved separately from corrected fixture acceptance.

**Authorization and current work.** Automatic approval review initially rejected source authoring and cross-chat authorization evidence; neither rejected attempt wrote a migration or corrective SQL fixture. The human subsequently answered "Approved" to the explicit request for additive migration source, regression tests, bounded isolated verification and coordination. The fresh approval was forwarded to this task and independently read from the raw human message, but automatic approval review again rejected the source write because cross-chat evidence is treated as untrusted tool output. Those rejected attempts wrote no migration or dependent corrective fixture. The human has now directly approved authoring the additive compatibility migration and regression tests, then completing the already approved isolated verification in this recovery chat. No merge or production deployment is authorized. The previous rejected attempts remain recorded; the approved additive candidate has now been authored and independently reviewed. The historical checkpoints remain preserved; the same draft PR now contains candidate217c053. Production/retained installation and merge remain excluded. The two filtered manifest labels are corrected; the real installed-Vitest regression, 64 profile/reporter tests, lint and nonincremental types passed. Independent raw-result audit `test-results/core-recovery/baseline-38003655733-independent-review.json` has SHA-256 `4678e845b25a6e986d5df538681fd0797d914660201d44bbf267b39cf62a88ac`; the old qualification stays failed. The additive repair is authored as `040_legacy_all_player_data_membership.sql` because the maintained migration CLI rejects numbering gaps. The different 040 on the frozen multiweek branch remains untouched and must be reconciled before any future combination. No migrations 001–039 is edited.

**Live witness checkpoint (offline only).** The test now derives the complete sorted league set from the first original sealed discovery capture, matching raw and normalized IDs one-to-one without duplicates or filtering. It accepts one to four associations within the existing budget and derives both collections, receipt counts and final totals from that set. An empty, oversized, invalid or changed list retains the original sealed capture and bounded diagnostic reason, then refuses before the SQL list checkpoint. Absolute 28 admissions, 29 claims, 36 GETs, byte limits, fences, acquisition seals, history assertions and time bounds are unchanged. This changes the test witness, not the production intake path or qualification selection. The three focused offline files passed 312 tests with zero skips; changed-file lint and a fresh nonincremental TypeScript check passed. Scope and whitespace checks passed, and the primary checkout remains clean. Source-bound proof `test-results/core-recovery/live-witness-offline-proof.json` has SHA-256 `cab85b3048339a4985094bb187a0df5e84756d5c84ad6e45180e3e0ffcb580c4`; root independently matched all seven LF source hashes and three log hashes. Live-case/profile pin is `f8f2be393a4ea0d5660feac0c720ac2fffc4817c30ebf9a231f249d7b096615f`. Independent Astra Ultra `/root/core_live_witness_review` accepted those exact seven source hashes with no blockers; review was relayed by coordinating task `01a11bda-3fe5-7120-a27d-0d69096b54b6`. The reviewer independently observed the 312-test result (raw log SHA-256 `582edb31d664c189440641621bbf7388f6540948aded5e470e86505554d37803`). At that offline checkpoint, no new SQL or live-provider run occurred; the old live proof and failed baseline retain their original sources and results. Published checkpoint `e015a870722b637b85bf597d21364ecb030ff215` passed [CI38007185974](https://github.com/clawmachinejed/league-one-audit/actions/runs/38007185974): 6,388 unit tests across 287 files with zero skips, 121 public browser passes with 20 intentional account skips, and 20 separate account passes with zero skips. Both jobs used merge `5810cfb2d1a4da57b30a8edb96eec2e8b9f42ca7`, whose tree `663450dfc75a6bdd2f64cefb0b63254ba4c5b571` exactly matches the checkpoint; clean served-build provenance was verified. CI proof SHA-256 is `021f202322cbb5febf1257858c5f91879992fc7892c645e017baccb6386d8d78`. Its exact-source Ready preview `5hhPiNkTizy2WL6Xo8jcgNXWetqx` was inspected in the built-in browser on both league manager pages with 12 correctly scoped cards each; preview proof SHA-256 is `4333248c1f843b9c36f4765442ff18775523eae275c9859986dac942af31e974`. These checkpoint results do not qualify the subsequently approved compatibility migration or its changed fixtures.

**Additive compatibility source and offline verification.** Migration 040 replaces only the three effective R037 function bodies, with eight consistent membership predicates and two ordered parent-lock changes. Unadopted DATA no longer enlarges the legacy population because of a nonnull profile; active account adoption includes only the exact selected season and retains all existing profile, parity and source-authority checks. The existing selected owner/restricted-LOGIN fixtures cover fresh shared/distinct publication and replay, both observed adoption race directions, pregame completion, and deadline/lease expiry after a lock wait. Case names, selection, request accounting and existing bounds are preserved. Independent Astra Ultra `/root/bounds_port` accepted the frozen source and scope with no blockers. Migration LF SHA-256 is `f3ca03630b786a26242ba881c9f59ea9145a2629369d8a025f5a3324c6ae060c`; closed profile descriptor is `2bb60a3e3531c35c9bce39c240aa0b3b7961cdd2aec6974dfd744d6abcd1d4fb` (three modules, seven selected, 89 collected, 82 filtered, eight hooks). The transitive owner fixture is bound by reviewed LF hash `5e61c0caafa1737971e7ffb87627a983fb2e92f5759f9b905f99f9b50419a7dd` and immutable candidate SHA `217c053c095e0950a7e842030a9d4dee41939199`. Profile/reporter checks passed 65 tests across two files with zero skips; final changed-file lint and direct Node24 nonincremental TypeScript checks passed. An earlier sandboxed TypeScript invocation could not read installed dependency links and failed; the subsequent full-access check passed without a dependency change. Repin proof SHA-256 is `e2cff3b8ecd01d2990416660bbd73d6cc364dfec2b43297e97f61f2d0b94e072`. Fresh preflight proof `compatibility-preflight-e015a87.json` has SHA-256 `0138b2f951bcbd066be376c457b4d52dda74b4116aea447e3777ba2ab63ba4dc` and confirms unchanged main/production identity and only the approved test parent in Neon. Source acceptance and offline checks alone do not qualify SQL; the subsequent installed compatibility result is recorded below.

**Corrected compatibility SQL accepted.** [Run 38008537554](https://github.com/clawmachinejed/league-one-audit/actions/runs/38008537554) executed frozen `217c053c095e0950a7e842030a9d4dee41939199` under `data-core-compatibility-v1`: seven selected cases passed across three modules, with 89 collected, 82 filtered and eight balanced hooks. No selected case was skipped, retried or repeated; no flaky result or unhandled error was reported. Independent Astra Ultra review accepted the exact source-bound report through the maintained validator and confirmed the ordinary intake, membership, restricted-LOGIN publication, adoption races and pregame expiry assertions. The ordinary intake uses fixture provider responses; this acceptance does not substitute for the live-provider run. Terminal receipt 0012 and its workflow acknowledgment at `2026-10-10T00:25:25.9596547Z` confirm process-group closure, schema cleanup, generated credential revocation and deletion of child `br-lively-meadow-b7yw1p1m`, with no failures or unresolved resources and no production writes. Lifecycle was 310,812 ms. Root separately inspected the authenticated Neon console and found only the approved parent after cleanup. Artifacts remain under `test-results/core-recovery/compatibility-38008537554`; report SHA-256 is `d5b5120f5be3ef03484f9def7563dcde7499b77bc19a298149d6fc48a280d695`. Independent review `test-results/core-recovery/compatibility-38008537554-independent-review.json` has SHA-256 `31aaddaf5ca7aa2d0f600deb21c3bc5b34150503ebf00c5863bd721c5f9bb7b0`. This grants only the closed compatibility-profile acceptance; baseline 38003655733 remains failed with no retroactive credit.

**Candidate CI and preview.** [CI38008522996](https://github.com/clawmachinejed/league-one-audit/actions/runs/38008522996), attempt 1, passed for exact candidate `217c053c095e0950a7e842030a9d4dee41939199`: 6,388 unit tests across 287 files with zero failures/skips, 121 public browser passes with 20 intentional account-case skips, and 20 separate account browser passes with zero failures/skips. Both jobs checked out merge `8e3206892c7a59ecb5fc97c81f93acf317cc9e1c`, whose parents are main `87da4d0` and candidate `217c053` and whose tree `e6ac1a6e703515f750c2d28be5d18234a3c34e25` exactly matches the candidate. Both browser runs verified clean served-build provenance. Independent proof `test-results/core-recovery/ci-38008522996/proof.json` has SHA-256 `83597d3171fd0458fce21a0fe7fa4376b949fd3f9555153d888881184df2a91d`. The exact-source Ready preview `CwhadAwecD8WtBM1TZVFuq8FFdTo` was inspected in the built-in browser on `/managers` and `/league2/managers`, with 12 correctly scoped manager cards each. Saved `test-results/core-recovery/preview-217c053.json` has SHA-256 `4bae4ad7e171be07a32cc0cd94a7129703d264d151b1fa42d8ff6971696a260e`. The preview establishes presentation compatibility, not a production release or retained database installation.

**Live verification accepted.** The single approved existing `data-live-public-intake-v1` [run 38009158583](https://github.com/clawmachinejed/league-one-audit/actions/runs/38009158583), attempt 1, passed at the same frozen `217c053c095e0950a7e842030a9d4dee41939199`: one collected/executed pass, zero failures/skips/filtered cases/retries/repeats, and two balanced hooks. Independent Astra Ultra review accepted the untouched report through the committed maintained validator. Independent review `test-results/core-recovery/live-38009158583-independent-review.json` has SHA-256 `518f0d919e14a71216b38d97791c6c18e86dfb51bb70ce2ff3ca6a91ae2b1d0f`. Both original discovery captures contained the same complete four-ID set. The run completed 29 owner claims, 28 admissions and 36 GETs totaling 179,484 bytes; the largest response was 12,706 bytes. Source-bound passing assertions cover raw/typed parity, stable canonical identities, 16 fresh typed receipts per collection, nonempty immutable first-collection history, stored-only composed refresh readback, exactly one completed refresh and real SQL admission spacing. Final capture evidence reports `finalized: true`, no source failure and twelve unchanged normalized-content comparisons. This proves fresh acquisition and refresh lineage; changed-content/injected-recovery evidence remains at its separately recorded historical fixture sources. Sanitized artifacts retain payload hashes rather than provider payload bodies, so direct artifact checks and assertions established by the passing pinned source remain distinct.

Disposable run `b4eed72e-ff43-48bb-9159-398538555e9d` began `2026-10-10T00:28:34.528Z`, finished `00:57:22.051Z` and received the exact supervisor acknowledgment at `00:57:22.0615636Z`. Case duration was 1,700,652.229 ms; total lifecycle was 1,727,629 ms, within the unchanged 29-minute case, 30-minute work and 40-minute lifecycle limits. All twelve journal records bind the same source/run. Terminal receipt 0012 confirms child closure, schema cleanup, generated credential revocation and deletion of `br-holy-scene-b7jutnp1`, with no failures, unresolved resources or production writes. Fresh authenticated Neon inspection found only the approved parent afterward; browser-cleanup proof SHA-256 is `23005dce873af3f13fda7b6820a1f25ac94d537e7d71323f68e064714f6a3fce`. Diagnostics record PostgreSQL 18.6 (`180006`) and `firstFailure: null`; their bounded ring is not a complete event timeline. Raw artifacts remain under `test-results/core-recovery/live-38009158583`. Report SHA-256 is `7a939c5dd94e5a6466b86b6cc1cdae326326b31e3d0f4cfb0b3804ca148d7b04`, capture-manifest SHA-256 is `1ac4d3f288837ed0830bc7d8db766ece3285859adaacfb401b0406f1b2e301f7`, and the closed profile descriptor is `a943adbd6e98762a1579537e26d399406b76417883e66f1763c373738b6262c7`. Existing credentials and all provider/compute/time bounds were preserved; no automatic retry or extra qualification queue ran.

**Completion boundary.** The bounded username-core recovery and its two approved corrected-source SQL purposes are complete at executable source `217c053`; the failed baseline remains failed. The documentation-only closeout records these results and adds the already implemented compatibility option to the README's manual-choice list without changing executable bytes or implying another SQL run. PR291 remains draft and unmerged. Fresh authority checks still agree on clean local/GitHub main and Ready Vercel production at `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`, with the canonical repository/root/production branch unchanged; authority proof SHA-256 is `53dd4ae6e33df32119ffd97d0e9599883d6d7a95341804e8da3986c99d1448ca`. No production deployment or retained-database installation occurred, and no persistent DannyPak dataset remains. The broader DATA resource/operating matrix, full default SQL inventory, fleet capacity/endurance and production release remain outside this milestone. Actual cumulative billing remains unmeasured; no remaining budget is inferred. The different migration 040 on the preserved multiweek branch still requires reconciliation before any future combination.

**ClawMachineJedi verification accepted.** The direct user request is qualified for season 2026 at frozen test-fixture source `1eef1999df532b933b2e12de543c80e0e4b780ff`. Username `ClawMachineJedi` resolves to stable provider ID `862823517857697792`; the complete observed set is Claw (`1409353570947465216`, `pre_draft`, 12 teams), League One (`1378850182409490432`, `in_season`, 12 teams), and Dynasty League (`1312138224994385920`, `in_season`, 10 teams). Independent source review accepted the fixture and unchanged dynamic discovery/oracles; 337 focused offline tests passed, including the 52 independently rerun tests, with lint and nonincremental types passing. This adds no runtime or migration change. Source and public-preflight evidence remain under `test-results/clawmachinejedi`.

One isolated `data-live-public-intake-v1` run against PostgreSQL 18.6, [38012759794](https://github.com/clawmachinejed/league-one-audit/actions/runs/38012759794), attempt 1, passed at that exact source. Independent review accepted the maintained validator result: one collected/executed pass, zero failures/skips/filters/retries/repeats/flaky results/unhandled errors and two balanced hooks. Both original sealed discoveries retain the same complete three-ID set with matching raw/normalized counts. The run finalized with 23 claims, 22 admissions, 28 GETs and 117,180 bytes; each collection has 12 fresh typed receipts. Source-bound assertions establish official-data parity, stable canonical identities, committed stored-only readback, nonempty immutable first-collection history and one completed refresh. Nine normalized-content comparisons were unchanged. Sanitized artifacts retain hashes/counts/times, not raw bodies or SQL row transcripts. Independent proof `test-results/clawmachinejedi/live-38012759794/independent-review.json` has SHA-256 `52070932a744936c16b43ffd97c8572b2632e45a08b59c1f378ef8cdfecbf9f8`.

Case duration was 1,335,597.622 ms; lifecycle was 1,361,115 ms within the unchanged 29-minute case/30-minute work/40-minute lifecycle/50-minute CI bounds. Existing 0.25 CU, one-to-four-league, 28-admission/29-claim/36-GET and byte limits were preserved. Twelve contiguous source/run-bound journals culminate in receipt 0012, acknowledged at `2026-10-10T01:43:17.7910096Z`: process-group closure, schema cleanup, credential revocation and deletion of child `br-lingering-bird-b7m1gr6g` all succeeded, with no failures, unresolved resources or production writes. Fresh authenticated Neon inspection found only the approved parent; `test-results/clawmachinejedi/browser-cleanup.json` corroborates the terminal evidence.

Full [CI38012739955](https://github.com/clawmachinejed/league-one-audit/actions/runs/38012739955) passed 6,393 unit tests across 287 files, 121 public browser checks with 20 intentional account-case skips, and 20 separate account checks. Both jobs used merge `4d08ac0b00c9959ca8c2c0c7932b51c0ab093d4c`, whose tree exactly matches `1eef199`, with clean served-build provenance; CI proof SHA-256 is `24e6589696c1b53611f033548f3e4cf147cc67a5f1bf5458af3796313028e4f5`. Exact-source Ready preview `H2iGLvyNjMwaAvgt6kZVeXuuchDc` showed 12 manager cards on each existing league page. Saved preview and `authority-after.json` evidence confirm presentation compatibility and unchanged clean main/Ready production at `87da4d0`; PR291 remains draft and unmerged. This proves the requested bounded ClawMachineJedi path, not full backend coverage. Disposable verification leaves no persistent ClawMachineJedi dataset. No retained installation or production deployment occurred. Historical DannyPak acceptance at `217c053` and the failed baseline retain their original credit and status.

### Existing backend invocation

In an explicitly authorized server process with the existing restricted database configured and reviewed migrations installed, import `submitPublicSleeperIntake`, `runSelectedPublicIntake`, `configurePublicSleeperRefresh` and `runSelectedPublicDataRefresh` from `apps/site/lib/league-administration/public-intake-runtime.ts`. Submit `{ id: requestId, username, seasons: [season] }` with `{ enabled: true, requestId, managerEvidenceVersion: 'v2' }`. Keep the same UUID and input on replay. Invoke `runSelectedPublicIntake(selection, Date.now())` one bounded step at a time, respecting returned busy/backoff/terminal states and the existing 60-second admission interval. No new scheduler or page endpoint is added.

Read committed results through `readPublicSleeperIntake(database, createLeagueAdministrationStore(database), requestId, { managerEvidenceVersion: 'v2' })`. This reader has no source adapter or provider fallback. Once identity is accepted, `configurePublicSleeperRefresh({ id: targetId, expectedRevision: 0, identityRequestId: requestId, seasons: [season], cadenceSeconds, expiresAt, paused: false }, { enabled: true, managerEvidenceVersion: 'v2' })` uses the existing revision-bound refresh target. Reuse the target UUID and expected current revision for changes. `runSelectedPublicDataRefresh(selection, Date.now())` advances the existing owner; `readPublicDataRefresh(database, administration, targetId, { managerEvidenceVersion: 'v2' })` reads retained cycle results. Cadence is 60–604,800 seconds and expiry must be within 90 days; these inputs are explicit operator choices.

This documents the implemented dormant backend API. It does not authorize configuring a retained or production database. The guarded disposable commands are the acceptance invocation for this recovery; they remove their test dataset afterward.
## Historical acceptance reconciliation — October 9, 2026

**All four repaired qualification profiles are independently accepted.** Fresh sequential A → B → C → D runs passed at reviewed and frozen `592a60a79639a648a35dda14f53d787003d357bf`, with candidate CI/preview verified and each run accepted before the next dispatch. The cohort produced **15 executed passes across 14 distinct case names**, with all expected hooks and acknowledged cleanup. Original A remains accepted at `0c9f318`; original B remains failed. This closes the bounded intake case-selection qualification increment, not the complete DATA backend outcome.

**The data-backend-v1 outcome is not complete.** The [resource and operating matrix below](#resource-qualification-state) remains the current remaining-work authority for the unchanged [approved scope](data-backend-scope.md). It accounts for all eight official resource families, discovery and the integrity/operational obligations. Website accounts/UI and new analytics remain deferred. Neither the 25-case intake module, the 48-module default SQL inventory nor the historical account ledger is the backend completion denominator.

The repaired four-profile candidate is `592a60a79639a648a35dda14f53d787003d357bf`; its intake-module LF SHA-256 is `899c526471fd9f9df3917a357721c52b249d44c7aed5660fb658dda39d675abf`. Accepted A+B+C+D total **15 executions of 14 distinct names** at this source. Historical coverage totals **25 distinct names across tested sources: 14 + 4 + 5 + 1 + 1** — fourteen pre-closeout names, four added by original A at `0c9f318`, five added by corrected B, one by corrected C and one by corrected D. Repeating A adds no historical names. Eleven names remain historical-only; neither all 25 at this candidate nor the 48-module default suite is claimed. Original B remains failed; its six raw passes receive no accepted-profile credit.

Authority was revalidated at `2026-10-09T19:31:00.676Z` in `test-results/data-backend/intake-closeout-r2-prepublication-authority.json`, SHA-256 `41f56508811c370d51139c23b8e65f737bbd947506f620a4f79474c270152bd9`: local/origin/GitHub `main` and Vercel production remain `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`; primary and worktree were clean and PR288 draft/unmerged at `592a60a79639a648a35dda14f53d787003d357bf`. Authenticated Vercel overview bound Ready deployment `8C3YSnXRCbmPETftQgRtirfyck5e`, project `league_one_fantasy` in `robert-finchums-projects`, to `clawmachinejed/league-one-audit`, root `apps/site`, production branch `main` and that full production SHA. Only D was active then. The post-SQL check at `2026-10-09T19:46:58.128Z`, `test-results/data-backend/intake-closeout-r2-postsql-authority.json`, SHA-256 `e127c92b4f29cc2e319bd427d4345bc68d25c25d44aed8400f9c99208c350582`, confirmed no active integration runs, all four candidate workflow attempts completed successfully, unchanged main, clean worktree and draft PR. No competing owner observed; production cron execution and database/worker leases were not inspected. The frozen original preflight remains preserved. Production authorization remains false; isolated qualification grants no activation, merge or production-release authority.

Repaired-candidate [non-SQL CI 37969762423](https://github.com/clawmachinejed/league-one-audit/actions/runs/37969762423) passed **6,242 unit tests across 286 files, 121 public browser checks with 20 intentional account-case skips, and all 20 separate synthetic-account checks**, with zero failures or browser flakes. Both jobs checked out merge `0f3c0ca6ece190039edf196d6747b59e33a66e1e`, containing the exact candidate parent and identical candidate tree `6cac98755135c7eec62eee301145a22f6bc90788`; served-build provenance was verified. Proof `test-results/data-backend/intake-closeout-r2-ci-nonsql-proof.json` has SHA-256 `4b47178b6461f047b5317dfa9af5f23394379dd3cc97b11c92e3098780361dec`. Ready exact-source preview `4gMUeqWHPJnw9enC4tATMCo1wQKo` at [the 592a60a preview](https://leagueonefantasy-dj3bupju5-robert-finchums-projects.vercel.app) was inspected in the built-in browser on `/managers` and `/league2/managers`, each with twelve cards and inspected screenshots; `test-results/data-backend/intake-closeout-r2-preview-proof.json` binds these observations. These are candidate non-SQL proofs, not SQL acceptance or production deployment. Documentation publication evidence is recorded separately in the final publication manifest and PR description; this ledger binds the tested SQL candidate and makes no claim about that later documentation commit or its CI/preview.

## Grouped milestone — intake qualification and diagnostic repair, October 9, 2026

**Preserved original A result.** [Run 37962041331](https://github.com/clawmachinejed/league-one-audit/actions/runs/37962041331), attempt 1, passed `data-intake-recovery-v1` at `0c9f318eda864aa0e86927a399ff6a835ad18c37`, module LF digest `899c526471fd9f9df3917a357721c52b249d44c7aed5660fb658dda39d675abf`: 25 collected, six executed passes, 19 filtered; zero selected skips/failures/retries/repeats/unhandled errors. Its six expected hooks each started/ended once; lifecycle was 901,242 ms. Independent review accepted it at `2026-10-09T17:13:50.212Z`. Result SHA-256 `4e6ba19ef019907b3170bfb4ea32546b146b27ec70f82befd7710e4c4bc751bb` and review SHA-256 `f6c65ed2f696a642ea652588a3e5f7dc53f5070b8a2b6466593f8737600eb9f0` remain unchanged under `test-results/data-backend/intake-closeout-A-result[-review]-0c9f318eda864aa0e86927a399ff6a835ad18c37.json`. All four cleanup gates and terminal acknowledgment passed. This original-source result remains valid and supplies no replacement-candidate pass by itself.

**Preserved failed original B attempt.** [Run 37964858235](https://github.com/clawmachinejed/league-one-audit/actions/runs/37964858235), attempt 1, executed `data-refresh-history-v1` at the same original source: **25 collected, seven executed, six passed, one failed, 18 filtered**, with zero selected skips/retries/repeats/unhandled errors. The typed-core-cycle case failed while saving diagnostics: `boundary=artifact.write; category=unexpected; sqlState=unknown; step=687; cycle=2`; no diagnostic artifact was saved. Lifecycle was **1,380,677 ms**. Supervisor acknowledgment at `2026-10-09T17:38:28.6397066Z` reported the failed outcome, with process-group closure, schema cleanup, generated credential revocation and deletion of child `br-proud-waterfall-b7igpu0a` verified; failures contain `tests`, and unresolved resources are empty. Failure manifest `test-results/data-backend/intake-closeout-B-failure-0c9f318eda864aa0e86927a399ff6a835ad18c37.json`, SHA-256 `ef9af4c0e0856ee52fc493e8f1e30a35494dba60bd5665c6325db3c7ec2b6591`, remains failed and unqualified. Root independently checked 55 evidence hashes and 12 journals.

**Reproduced cause and bounded repair.** Independent offline executions of the actual maintained diagnostic-save code reproduced rejection of a valid `data-refresh-history-v1` context by its profile gate while valid `full` and `data-core-refresh-v1` contexts saved successfully. This establishes the diagnostic allowlist defect; it does not establish whether diagnostic-save failure masked an earlier assertion in the failed SQL case. The repair adds that exact profile only to refresh-kind diagnostic saving, preserving the old accepted pairs, failure precedence and immutable bounded artifact writing. Focused checks passed **181 diagnostic tests plus 128 profile/reporter/supervisor tests, 309 total**, with no failures or pending tests. Independent source review `test-results/data-backend/intake-closeout-r2-source-review.json` has SHA-256 `7985dce403ae84b203cddfe364993d9dd8509cc9e5b063bb597597432e9c1541`; the separate postcommit proof `test-results/data-backend/intake-closeout-r2-postcommit-source-review.json`, SHA-256 `dac17793f921ea88163003f1a822b38dadd9ccd787f62e5c83295593a3729dac`, binds the accepted review to clean exact commit `592a60a79639a648a35dda14f53d787003d357bf` at `2026-10-09T17:55:51.375Z`. Relative to the original qualification candidate `0c9f318`, this subsequent diagnostic repair preserves SQL case bodies/names/module/profile digests, runtime, migrations, provider configuration, acquisition, SQL assertions, retry policy, deadlines and workflow. The original qualification increment had added four closed profiles and aligned metadata-only fixture setup with its genuinely completed preceding cycle; those changes are distinct from this diagnostic-only repair. Fresh A → B → C → D completed with actual independent acceptance before each next dispatch; original results were not transferred to the repaired candidate.

Original-candidate non-SQL [CI 37960525821](https://github.com/clawmachinejed/league-one-audit/actions/runs/37960525821) passed 6,180 unit tests across 286 files, 121 public browser checks with 20 intentional account-case skips, and all 20 separate synthetic-account checks, with no failures or browser flakes. Checkout merge `7f16f8594eddff5766131437676e79d285f76259` had identical candidate tree `9c6d40fb635d133067dfc2cd3ab4f8675c303012`. Original Ready preview `D5tNpX5SGFcu3Wi4qjdt2RDA1J4f` at [the 0c9f318 preview](https://leagueonefantasy-4h2ohx6ob-robert-finchums-projects.vercel.app) rendered both manager pages with twelve cards each. These proofs remain bound to the original candidate; the independently verified replacement-candidate CI and preview are recorded above.

**Accepted replacement A.** [Run 37971973149](https://github.com/clawmachinejed/league-one-audit/actions/runs/37971973149), attempt 1, passed `data-intake-recovery-v1` at repaired candidate `592a60a79639a648a35dda14f53d787003d357bf`: **25 collected, six executed passes, 19 filtered**, with zero selected skips/failures/retries/repeats/unhandled errors. All six expected hooks started and ended exactly once in the required suites; chronological selection matched the frozen profile. Lifecycle was **900,563 ms**. Terminal acknowledgment at `2026-10-09T18:31:25.0139559Z` preceded result recording at `2026-10-09T18:34:22.352Z` and independent acceptance at `2026-10-09T18:36:28.820Z`. Result `test-results/data-backend/intake-closeout-r2-A-result-592a60a79639a648a35dda14f53d787003d357bf.json` has SHA-256 `3ddf3a0712a5965549f91a452a6146a3e960cae6f936100f0355c1754d193786`; review `test-results/data-backend/intake-closeout-r2-A-result-review-592a60a79639a648a35dda14f53d787003d357bf.json` has SHA-256 `2bfe7014e1a695ac13aa9187387c565a72ee6eaab98887b4d3a5101a3f7cfe08`. Process-group closure, schema cleanup, generated credential revocation and deletion of child `br-frosty-feather-b7rg6cy9` were verified and acknowledged, with empty failures and unresolved resources. The review verified 66 result-evidence hashes, 12 journals and the frozen inputs. These six repeated names add no new historical names; B/C/D each have their own independently accepted result below.

**All four replacement results accepted.** The closed profiles executed actual isolated PostgreSQL with controlled fixture capture transports; they add no live Sleeper-acquisition qualification. A passed six cases/19 filtered, B seven/18, C one/24 and D one/24, each with 25 collected and zero selected failures/skips or runner retries/repeats/unhandled errors. Across the four reports this is **100 collected appearances, 85 filtered appearances and 15 executed passes**, not 100 distinct cases. Filtered cases appear as skipped in Vitest. All **12 hook executions** — six in A and two each in B/C/D — started and ended once in the required suites, with no excluded-suite hook. Every run received verified terminal cleanup acknowledgment.

| Replacement profile / actual run | Collected / passed / filtered | Hook result | Lifecycle ms | Result SHA-256 | Independent acceptance |
| --- | --- | --- | --- | --- | --- |
| r2 A `data-intake-recovery-v1` / [37971973149](https://github.com/clawmachinejed/league-one-audit/actions/runs/37971973149), attempt 1; accepted | 25 / 6 / 19 | Six hooks, each start/end once | 900,563 | `3ddf3a0712a5965549f91a452a6146a3e960cae6f936100f0355c1754d193786` | Accepted `2026-10-09T18:36:28.820Z` |
| r2 B `data-refresh-history-v1` / [37974577614](https://github.com/clawmachinejed/league-one-audit/actions/runs/37974577614), attempt 1; accepted | 25 / 7 / 18 | Two hooks, each start/end once | 1,369,576 | `b806f7d0c0dfde2718c273c155b519f1ef2b3eddd4747783c9058a117490a6d9` | Accepted `2026-10-09T19:05:37.297Z` |
| r2 C `data-period-recovery-v1` / [37977900357](https://github.com/clawmachinejed/league-one-audit/actions/runs/37977900357), attempt 1 | 25 / 1 / 24 | 2; each started/ended once | 660,760 | `d5fe8efa52f6e3ffeabca7f3662d256a870d11a664528400335b8bdf783b6c31` | 2026-10-09T19:21:21.406Z |
| r2 D `data-period-exhaustion-v1` / [37979734070](https://github.com/clawmachinejed/league-one-audit/actions/runs/37979734070), attempt 1 | 25 / 1 / 24 | 2; each started/ended once | 1,273,154 | `a6cf52fee33e71024cc76c0fc171dd69469094b11cc510d1a75470bdb87de1fe` | 2026-10-09T19:47:58.879Z |


**A scope; original and replacement results accepted.** The existing intake/typed writer/reader path retained core through injected interruption, recovered once and permitted explicit existing-consumer adoption. Retention used a genuinely completed job and nonempty prior dispatch history; the fixture aged its timestamp by 49 hours before invoking the maintained 48-hour pruning path, so this is not a 48-hour soak. Configured identity rollback and the selector prerequisite execute in the same database. Fairness defers a failed target without admission credit and selects another verified target; it does not prove successful ingestion of that healthy target or sustained throughput. The twenty-ordinal/candidate-lineage/immutable-scope case uses rolled-back owner-only negative prerequisites, not twenty real acquisitions. The original result remains bound to `0c9f318`; fresh A independently repeats this scope at `592a60a`, without adding historical names.

**Accepted replacement B: recurring readback, immutable history and limits.** [Run 37974577614](https://github.com/clawmachinejed/league-one-audit/actions/runs/37974577614), attempt 1, passed `data-refresh-history-v1` at `592a60a79639a648a35dda14f53d787003d357bf`: **25 collected, seven executed passes, 18 filtered**, with zero selected skips/failures/retries/repeats/unhandled errors. Both expected hooks started/ended once and chronological order matched the frozen profile. Lifecycle was **1,369,576 ms**. Terminal acknowledgment at `2026-10-09T19:01:29.2616337Z` preceded result recording at `2026-10-09T19:03:41.306Z` and independent acceptance at `2026-10-09T19:05:37.297Z`. Result `test-results/data-backend/intake-closeout-r2-B-result-592a60a79639a648a35dda14f53d787003d357bf.json`, SHA-256 `b806f7d0c0dfde2718c273c155b519f1ef2b3eddd4747783c9058a117490a6d9`, and review `test-results/data-backend/intake-closeout-r2-B-result-review-592a60a79639a648a35dda14f53d787003d357bf.json`, SHA-256 `52c1de5cb9d629bf6418194230d5f21962be13a24acc8b574db45edc68ab7682`, bind this success. Process-group closure, schema cleanup, generated credential revocation and deletion of child `br-dark-block-b78aicgz` were verified and acknowledged, with no failures or unresolved resources. The bounded **24,069-byte** diagnostic at `test-results/data-backend/intake-closeout-r2-ci-37974577614/integration-592a60a79639a648a35dda14f53d787003d357bf-1/artifacts/run-EHtGGU/public-data-refresh-diagnostics.json`, SHA-256 `382eed56617c3a6048641f2fa3cc22a05acec484abd0fbb8a106908231a2ee29`, has kind `public-data-ingestion-diagnostics-v1`, `caseKind: refresh`, matching profile/run/source/context and `firstFailure: null`; `databaseVersion` is absent. B repeated selector/changed-core-cycle prerequisites, retained two empty-list cycles and prior typed data, rejected owner UPDATE/DELETE of all four nonempty refresh-history tables, and exercised the shared sixteen-pending-request and paused total16 metadata-target bounds. The metadata-only case proved explicit-period scope copying/replay/CAS after reading and requiring the genuinely completed preceding cycle. This is not period acquisition or fleet throughput. The independently accepted repaired run adds five historical names; original B remains failed and its potentially masked earlier assertion is not retroactively resolved.

**Accepted replacement C: exact native-period recovery.** [Run 37977900357](https://github.com/clawmachinejed/league-one-audit/actions/runs/37977900357), attempt 1, passed `data-period-recovery-v1` at `592a60a79639a648a35dda14f53d787003d357bf`: **25 collected, one executed pass, 24 filtered**, with zero selected skips/failures/retries/repeats/unhandled errors. Both expected hooks started/ended once and chronological selection matched the frozen profile. Lifecycle was **660,760 ms**. Terminal acknowledgment at `2026-10-09T19:17:56.9291699Z` preceded result recording at `2026-10-09T19:19:59.133Z` and independent acceptance at `2026-10-09T19:21:21.406Z`. Result `test-results/data-backend/intake-closeout-r2-C-result-592a60a79639a648a35dda14f53d787003d357bf.json`, SHA-256 `d5fe8efa52f6e3ffeabca7f3662d256a870d11a664528400335b8bdf783b6c31`, and review `test-results/data-backend/intake-closeout-r2-C-result-review-592a60a79639a648a35dda14f53d787003d357bf.json`, SHA-256 `82d622ba494af1b010202e349b9d8671e47cff2e9167528ce2bde6d8fff23ca5`, bind this success. Process-group closure, schema cleanup, generated credential revocation and deletion of child `br-wispy-river-b7q1sdko` were verified and acknowledged, with no failures or unresolved resources. The independently reviewed root terminal check, SHA-256 `c00fb0a7ab7f8dc6ddfaaa6ba7e600352f3e2bd6e5c0357ba1e140fbefd3cd11`, also binds the active/cleanup browser observations; no independent Neon API absence probe was performed. The existing R038 path at native week 7/season 2179 proved paired reservations and capture-witness binding, stale/wrong-period/mapping/receipt/fence rejection, an observed advisory-lock wait past an eight-second work deadline and lost-ack recovery, and preservation of an accepted period through core/directory failure. These are bounded controlled fixtures. The recovery fixture supplies custom zero but does not assert exact stored score values; complete raw/custom/effective-score parity, competing-head/remap coverage, period inventory, other formats and official finality remain open.

**Accepted replacement D: exact-period exhaustion with core completion.** [Run 37979734070](https://github.com/clawmachinejed/league-one-audit/actions/runs/37979734070), attempt 1, passed `data-period-exhaustion-v1` at `592a60a79639a648a35dda14f53d787003d357bf`: **25 collected, one executed pass, 24 filtered**, with zero selected skips/failures/retries/repeats/unhandled errors. Both expected hooks started/ended once and chronological selection matched the frozen profile. Lifecycle was **1,273,154 ms**. Terminal acknowledgment at `2026-10-09T19:44:01.4002154Z` preceded result recording at `2026-10-09T19:46:24.645Z` and independent acceptance at `2026-10-09T19:47:58.879Z`. Result `test-results/data-backend/intake-closeout-r2-D-result-592a60a79639a648a35dda14f53d787003d357bf.json`, SHA-256 `a6cf52fee33e71024cc76c0fc171dd69469094b11cc510d1a75470bdb87de1fe`, and review `test-results/data-backend/intake-closeout-r2-D-result-review-592a60a79639a648a35dda14f53d787003d357bf.json`, SHA-256 `86d00fcc1d2d4ea6cfb355e0f1bd5d37de091c2433056b027bb842428cd36f6d`, bind this success. Process-group closure, schema cleanup, generated credential revocation and deletion of child `br-wandering-lab-b71bi3z5` were verified and acknowledged, with no failures or unresolved resources. Root terminal check `test-results/data-backend/intake-closeout-r2-D-root-terminal-check.json`, SHA-256 `bacd2550c1868982a900241e0434aaa8a62dc3417f52af12b92f4a0e6dae8633`, binds the acknowledged receipt and active/cleanup browser observations. The controlled fixture proved that five failed exact-period admissions leave core eligible; core/users then complete, with partial intake status and no period checkpoint. There are four intervening real retry backoffs between the five failed admissions. This is bounded exhaustion/recovery evidence, not live acquisition, process restart or complete period/score parity.

**Source binding, cleanup and operating bounds.** Repaired freeze manifest `test-results/data-backend/intake-closeout-r2-freeze-592a60a79639a648a35dda14f53d787003d357bf.json`, SHA-256 `fed71e3ac73e543d8f40114f28311f866ea96fc3179c8a01738d3b3e58a5a514`, binds 24 reviewed source files, 51 frozen proofs, six preserved prior files and four retained original-attempt files. All four actual result/review hashes and terminal acknowledgments are recorded above. Each independent review validated exact source/module/profile/context/report bindings, chronological selected names, hooks, twelve immutable journals and acknowledged process-group closure, schema cleanup, generated credential revocation and child deletion, with empty failures and unresolved resources. B's accepted review additionally binds the persisted refresh diagnostic. The four runs account for 48 journal records; original A/B cleanup did not substitute for replacement cleanup. The original freeze and every original success/failure/report/journal artifact remain preserved.

Every run retains fixed 0.25-CU compute, 30-minute work, 40-minute lifecycle and 50-minute CI limits and the existing $1 authorization, which is not a provider billing cap. No automatic retry or deadline extension is authorized. The protected test-project API key is reused and retained. Postrun browser observations for the original and repaired runs corroborate child deletion; no independent postrun API absence probe was performed. Actual tested child PostgreSQL versions and cumulative billing remain unmeasured. Earlier PostgreSQL 18.6 evidence does not transfer to these children. Replacement timing and cleanup are recorded from each run's own actual evidence above.

**Remaining boundary.** Completion of the repaired four-profile sequence closes the eleven case-selection gaps relative to the pre-closeout historical baseline, including the four already added by original A. Actual process death/restart, general competing-worker safety and recovery of unfinished bootstrap dispatches left by the identity rollback fixtures remain unqualified. The matrix below retains missing resource acquisition/readers, field parity, runtime parsing bounds, sustained workload/freshness/provider budgets, query plans, storage growth, restore and source-use authority. The default 48-module suite has not been run as a whole. PR288 remains draft/unmerged, production remains `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f` and DATA recurrence remains dormant.

## Previous bounded milestone — late-write registration rollback, October 9, 2026

**All three selected cases passed in one isolated SQL run.** [Run 37945640394](https://github.com/clawmachinejed/league-one-audit/actions/runs/37945640394), attempt 1, executed reviewed source `fe96853a2d33235ae6b811d06aa829bc08987dd4` with `data-late-write-rollback-v1`: **25 collected, three executed passes, 22 filtered; zero selected skips, failures, retries, repeats or unhandled errors**. Vitest displays filtered cases as skipped. The selected suite's beforeAll and afterAll each started and ended exactly once. These are three newly executed cases; **11 of the 25 intake cases remain unexecuted** across the recorded SQL milestones. Earlier passes remain bound to their original source.

**Data resource, existing path and persisted result.** The existing public intake/store and official-data registrar enforce canonical league/season/source identity and collection reservations through their SQL pre/postcondition fences. Both identity fixtures use official-data registration: one supplies nonempty scoring/slots, the other omits those fields. Actual restricted-LOGIN identity-row waits occur after the initial guard; expiry of the unchanged eight-second work fences rejects the final postcondition and rolls back registration. Neither fixture leaves a league, source connection or collection reservation, and its next bootstrap work remains unchanged. The genuine discovery/bootstrap sequences use six fixture GETs in total; these are local captured source responses, not live Sleeper acquisition.

**Advisory correction and recovery boundary.** Independent tracing and an offline regression reproduced the old oracle's false pass: the expected lease-lost error could occur before the runtime reached the held advisory lock. The corrected case now passed in PostgreSQL only after observing its exact runtime/blocker PIDs through `pg_blocking_pids` while the original one-second fence was live, proving database-clock expiry before releasing the blocker, and receiving the lease-lost rejection. It retained discovery and unchanged work with no league, source, reservation or dispatch residue. This negative fixture uses owner-seeded discovery, no successful admission and no GET; it establishes this guard, not successful ingestion or a runtime defect. Each identity case deliberately retained one admitted bootstrap dispatch without an outcome at its readback; `failJob` does not close that dispatch. This logical work is left for ordinary recovery and remains distinct from infrastructure cleanup. Other case bodies, the identity fences and all existing case/hook deadlines are unchanged.

**Exact selection and local evidence.** Shared module LF digest is `a169746dc89051995f655785131cdc6379059d2ae2c0b506e4049d53a7060ceb`; profile digest is `80efcbd2e4b668540adf9fb2e0fa15d81ffbe32c110a0a6afe8054ea98a0ba87`. Source review accepted the exact candidate. Local focused checks passed 184 tests across four files with zero failures/skips, plus route generation, strict TypeScript, changed-file lint, scope and whitespace checks. Six offline callback regressions cover the advisory false positive, late or unproved expiry and readback/rejection requirements; offline results alone do not execute PostgreSQL. The three body allowances and shared hooks total 18 minutes before harness overhead; none was extended.

**Cleanup and measured evidence.** Disposable run `6000d3c4-accb-4747-87c4-e32fe4206c4a` began `2026-10-09T14:39:09.542Z`, finished `14:46:15.885Z` and received terminal supervisor acknowledgment at `14:46:15.8986852Z`. In source order, the advisory, configured-identity and official-only-identity bodies took **2,800.285 ms, 152,687.296 ms and 240,863.958 ms**. Lifecycle was **426,453 ms**, within the unchanged 0.25-CU, 30-minute work, 40-minute lifecycle and 50-minute CI limits. Process-group closure, schema cleanup, generated database-credential revocation and deletion of child `br-bitter-surf-b7rzebsi` are verified and acknowledged; failures and unresolved resources are empty. Twelve immutable journals bind the same run/source. Result `test-results/data-backend/ci-37945640394-result.json`, SHA-256 `b27266602c50ac78423b033c7fbe9c27602ea3eb17b18ed5619bfcf5906175ea`, binds 40 evidence files plus all journal hashes. Terminal journal SHA-256 is `a0cf9e730e3fd3640ef03209daa149d3ddd3fd7a58e9fa8b76e4e0d2c90eb305`. The protected test-project API key was reused and retained; no new key or SQL retry occurred. Built-in-browser Neon inspection observed the temporary child during the run and only the baseline afterward; UI proof SHA-256 is `1c4b3fd7d0385e4b86b7bc016cfad94e20103ef598ce02cc965b051a73b7d448`. This corroborates the supervisor's deletion evidence; a separate postrun API probe, child PostgreSQL version and actual billing remain unmeasured. The existing $1 authorization is not a provider billing cap.

**Candidate CI and preview.** [Non-SQL CI 37943943009](https://github.com/clawmachinejed/league-one-audit/actions/runs/37943943009) passed dependency, scope, lint, types and build checks: **6,117 unit passes across 286 files; 121 public browser passes with 20 intentional account-case skips; and all 20 separate synthetic-account browser checks passed**, with zero failures or browser flakes. Both jobs checked out merge `d0ffed272c0690bb39d4322a95ec8a597f761086`, containing the exact candidate parent and identical candidate tree `e6c10267b9a52ff8bacf7580ab618e422bbb69fa`; both browser invocations proved clean served-build provenance. Non-SQL proof SHA-256 is `ea9ad9a1906fdb094a7604a3b3a62ec1f73c629acb0b89b080b3f9a8076edf10`. Exact-source Vercel preview `2T7gUZVL3xEYtq8ucB3iaPbFiCnD` is Ready at [the fe96853 preview](https://leagueonefantasy-oyp4v4ox5-robert-finchums-projects.vercel.app). Built-in-browser inspection rendered My Fantasy 2026/week 5 and both league manager pages with 12 distinct cards and correctly scoped links. Preview proof SHA-256 is `6931556ea56b73228736bac85fe8046e46917d3930c65c9969cc9f591f47c6cd`; presentation compatibility does not establish isolated database use or production activation.

**Completion boundary.** Independent result review accepted the raw source-bound artifacts, reran the maintained validator and verified all 40 evidence hashes, 33 frozen proofs, 12 journals and four preserved pointers. Review `test-results/data-backend/late-write-sql-independent-review.json` has SHA-256 `1d610313b1721b02db4803cd8ba87922d0e6a08d76eaf86d08631f1ed473f4d8`. The bounded SQL milestone is complete. This entry is a documentation-only follow-up; the qualified SQL source remains `fe96853a2d33235ae6b811d06aa829bc08987dd4`. The follow-up publication SHA and its non-SQL CI/preview evidence are tracked separately in the ignored final publication proof and PR. All four earlier recovery pointers and previous ledger entries remain intact. PR288 remains draft/unmerged, production stays at `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`, and no production release, DATA recurrence activation or subsequent milestone is included. General competing-worker safety, process death, capacity, whole-suite timing, the remaining safeguard/failure matrix and broader resource/format coverage remain open.

## Previous bounded milestone — refresh configuration and admission concurrency, October 9, 2026

**All five selected cases passed in one isolated SQL run.** [Run 37936334720](https://github.com/clawmachinejed/league-one-audit/actions/runs/37936334720), attempt 1, executed reviewed source `357c390806e300224ba39eee6f96cb9681234378` with `data-refresh-concurrency-v1`: **25 collected, five executed passes, 20 filtered; zero selected skips, failures, retries, repeats or unhandled errors**. Vitest displays filtered cases as skipped. The selected suite's beforeAll and afterAll each started and ended exactly once. This repeats one previously passed prerequisite and adds four newly executed cases; 14 of the 25 intake cases remain unexecuted across the recorded SQL milestones. Earlier passes remain bound to their original source.

**Data resource, existing path and persisted result.** The existing public DATA refresh configuration, selection and intake-admission stores retained configuration/cycle history and dispatch outcomes under the original work fence. The five source-ordered cases establish retained history through concurrent selectors and unknown acknowledgments; one winning configuration CAS revision while prior history remains intact; admission rejection after a pause commits first; rejection when approval expires during an observed target-row wait under the original live fence; and retention of a genuine fixture identity capture with its exact original dispatch witness when admission commits before a competing pause. The prerequisite makes the CAS configuration-history assertion nonvacuous and leaves cycle 1 identity untouched for the final case. Fairness and the private-helper/job-lock case remain filtered in this profile.

**Minimal test alignment, not a runtime repair.** Independent actual-module reproduction confirmed that the old final case omitted acquisition while the maintained worker validates a witness before capture and checks the original sealed object. R039 intentionally accepts omitted acquisition through legacy timestamp checks; this was a current-flow coverage gap, not a demonstrated runtime defect. Only that case's witness alignment, exact retained dispatch acquisition and one-GET assertion changed. Nine maintained offline regressions execute the actual changed source tail with real transport/witness helpers and controlled HTTP/SQL fixtures. The other 24 expanded case bodies, shared hooks/helpers, observed lock barriers, original work fences, real minute spacing and time allowances remain unchanged. Setup makes two fixture GETs and the final case one; no live-provider acquisition is qualified here. Runtime, migrations, provider configuration, scoring, schedules, public APIs and dependencies are unchanged by this milestone.

**Exact selection and source.** Shared module LF digest is `a304cd43e98d5790eb76cbe01658df3e689e616f803dda02e4fb6f314ab8be03`; new profile digest is `ed1daaf3be9c03b6e0a19928be0ca5e2fbf905269bbbb9a84ff25c0f59296d96`. Four older shared profiles follow this source repin; previous SQL results do not qualify their repinned source. Both live module digests and the default 48-module inventory are unchanged. Existing body plus setup/teardown allowances total 13m10 before harness overhead; no timeout or deadline was extended.

**Cleanup and measured evidence.** Disposable run `f006eb2e-eaa3-4901-91cf-9bd2c1e819bf` began `2026-10-09T13:25:30.164Z`, finished `13:27:48.518Z` and received terminal supervisor acknowledgment at `13:27:48.5306825Z`. In source order, case bodies took 3,702.789 ms, 286.300 ms, 241.444 ms, 5,282.850 ms and 51,778.748 ms. Total lifecycle was **138,457 ms**, within unchanged 0.25-CU, 30-minute work, 40-minute lifecycle and 50-minute CI limits. Process-group closure, schema cleanup, generated database-credential revocation and deletion of child `br-shiny-cake-b7bhnq10` are acknowledged and verified; failures and unresolved resources are empty. Twelve journal snapshots bind the same source/run. Result `test-results/data-backend/ci-37936334720-result.json`, SHA-256 `ba6f4ce23b40068e8f8c18f0b294e42dbaffc9fe0628429e2b29d5b807ae1e3d`, binds 24 source/context/report/cleanup and ancillary proofs plus all journal hashes. Terminal journal SHA-256 is `d586df7d05c9feeab81aaca8d22d4e57baddc0097489209dcd74f971b582bab5`. The existing protected test-project API key was reused and retained; no new key or automatic SQL retry occurred. The child's PostgreSQL version, actual billing and a separate postrun Neon API absence check were not measured. The existing $1 authorization is not a provider billing cap.

**Local and full non-SQL verification.** Focused checks passed 170 tests across four files, zero failures/skips, plus TypeScript, changed-file lint, scope and whitespace checks. The final 113-test oracle rerun overlaps that total. Installed network-blocked Vitest checks verified all five selected cases in source order and both shared hooks. The actual extracted workflow shell accepted nine mappings (eight dispatch choices and the existing push route) and refused 19 invalid mappings. Early local module-mock, outbound-fixture and type setup failures were corrected; their logs remain retained and are not SQL failures. Independent source review accepted the exact candidate before dispatch.

[Non-SQL CI 37934646151](https://github.com/clawmachinejed/league-one-audit/actions/runs/37934646151) passed dependency, scope, lint, types and build checks: **6,103 unit tests across 286 files; 121 public browser passes with 20 intentional account-case skips; and all 20 separate synthetic-account browser checks passed**, with zero failures or browser flakes. Both jobs checked out merge `a666aaae17fadb05ae4740cd986e2a3a17da0e01`, with parents main `87da4d0` and candidate `357c390`; its tree equals candidate tree `e6764207b01182ce7a6bcfc5f86259b46cde7023`. Non-SQL proof SHA-256 is `4b1ad52fa3d150eaa28fca26dfed4a446daeac6caaf32cc10f33f225dc9ed87a`.

**Preview and completion boundary.** Exact-source Vercel preview `DzUBMdwZ355D21d4mybg3kBLMCVf` is Ready at [the 357c390 preview](https://leagueonefantasy-1fykmkefz-robert-finchums-projects.vercel.app). Built-in-browser inspection rendered My Fantasy 2026/week 5 and both league manager pages with twelve distinct manager cards and correctly scoped links. Preview proof SHA-256 is `1db05741b0c988a78757d211b446e7e6aca67b4e35f0b5414a1ad23edbf8a7c1`. Preview compatibility does not establish isolated database use or production activation. The three previous guard, R037 and DannyPak recovery pointers are byte-identical. Independent result review reran the maintained validator, checked the raw artifacts and all result/frozen/prior-pointer hashes, and accepted the exact-source result and complete cleanup. Review SHA-256 is `4806c3eda9776f826a89d227aea8c5c90da32d06ece2c18c4b55acf3f914b233`. This bounded milestone is complete; the follow-up result commit changes this ledger only. PR288 remains draft/unmerged, production stays at `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`, and no subsequent milestone or production activation is included. General competing-worker safety, process death, capacity, whole-suite timing, the wider safeguard/failure matrix and broader resource/format coverage remain open.


## Previous bounded milestone — ingestion permission and work-fence guards, October 9, 2026

**All three existing guard cases passed in one isolated SQL run.** [Run 37929506649](https://github.com/clawmachinejed/league-one-audit/actions/runs/37929506649), attempt 1, executed independently reviewed source `e8afd508cf059e955820f0337137edb15e264523` with the closed `data-ingestion-guards-v1` profile: **25 collected, three executed passes, 22 filtered; zero selected skips, failures, retries, repeats or unhandled errors**. Vitest displays the filtered cases as skipped. Both selected suites' before/after hooks ran exactly once. No case body, runtime, migration, provider policy, scoring, public API or schedule changed for this milestone.

**Data resource, existing path and persisted result.** The existing public intake/refresh stores, SQL guards and backend reader retained one cycle across concurrent same-owner selectors and a lost selection acknowledgment, preserved failure accounting and enforced sequential pause/revision/expiry checks. The second case depended on that retained cycle; the independent fairness case stayed filtered. Named private helpers and direct refresh-table writes were denied. A real observed job-row wait outlived the two-second work deadline, rejected selection without a refreshSelection payload and preserved the same one cycle. This guard executes before new selection writes: it is not rollback of newly inserted history, 25-second lease expiration or process-death recovery. The third case revoked/restored the exact optional grants on the existing restricted role through maintained provisioner blocks, verified the listed private/helper/table denials, rejected invalid selectors without retained requests and preserved omitted/empty and canonical-order replay while refusing changed scope. This is late-role-equivalent evidence, not freshly provisioned-role proof.

**Cleanup and exact evidence.** Disposable run `a2728b49-9bf9-4359-be2d-b7f03be4ca87` began `2026-10-09T12:22:44.585Z`, finished `12:24:24.490Z` and received terminal supervisor acknowledgment at `12:24:24.5010497Z`. The three bodies took 4,850.633 ms, 3,648.494 ms and 3,499.306 ms; lifecycle was **99,984 ms**, inside the unchanged 0.25-CU, 30-minute work, 40-minute lifecycle and 50-minute CI limits. Child process-group closure, schema cleanup, generated database-credential revocation and deletion of `br-wild-boat-b7ci1hz1` are verified; failures and unresolved resources are empty. Twelve journal snapshots bind the same source/run. Result manifest `test-results/data-backend/ci-37929506649-result.json`, SHA-256 `d9379e8c2adf27eabf9c3bd4f7902a42fe203b3f38711c6eaa0d4bb641fc772a`, binds 21 source/context/report/cleanup and ancillary proofs plus all journal hashes. The unchanged protected test-project key was reused and retained; no new key or automatic SQL retry occurred. The child's PostgreSQL version, actual billing and separate postrun Neon API absence were not measured. The existing $1 authorization is not a provider billing cap.

**Local, CI and preview evidence.** The new profile and workflow admit only the three exact source-ordered cases. Installed network-blocked runner checks proved the retained-cycle dependency, all four suite hooks and 22 filtered cases. Local and independent focused runs each passed 52 tests across three files with zero failures/skips; these overlapping totals are not additive. Eight permitted and fifteen refused extracted workflow mappings passed. Scope, lint, route generation, strict TypeScript and whitespace checks passed. The initial root pnpm wrapper accidentally invoked Node20; direct Node24 resolved that tooling failure. Initial strict TypeScript exposed two widened test-table types, corrected with literal tuple annotations before the final rerun. Both failed local logs remain retained. All six old profile contracts/digests and the 48-module default inventory are unchanged. The common case-module LF digest remains `399d9470f2256a8f08196a887ff9ccc43a76c94ce947e3d7c2e624670aa43479`; the new profile digest is `163df7d36fbbd7b12f7427af29aa7dc07047b51d867dd634b1d119c72f8f0b13`.

[Non-SQL run 37928229788](https://github.com/clawmachinejed/league-one-audit/actions/runs/37928229788) passed dependencies, scope, lint, types and build; **6,089 unit tests across 286 files passed; public browser checks passed 121 with 20 intentional account-case skips; all 20 separate synthetic-account checks passed.** There were zero failures or flaky cases. Both jobs checked out merge `f65242b7c54da11b10f2273d8e0e4637c0952e1c`, with parents main `87da4d0` and candidate `e8afd50`; its tree equals candidate tree `b3ca6225a2f5d339d89aff242942a336d3718253`. CI proof SHA-256 is `3b6334646d70897bd27157ce06126cf0aca0d0735f969b10d7009d79647a2bd3`. Exact-source Vercel preview `xtyNRfLCLToNFYaoTsrEomtmPVyL` is Ready at [the e8afd50 preview](https://leagueonefantasy-bfblcufpc-robert-finchums-projects.vercel.app). Built-in-browser inspection rendered My Fantasy 2026/week 5 and both league manager pages with twelve cards each. Preview proof SHA-256 is `cab8c43327793cd42aaf72ed52545b2e5a239931d834f783152ff27069aeced4`. These checks do not establish isolated database use or production activation.

**Completion boundary and gaps.** This bounded milestone is complete. Independent review accepted the exact three-case result, maintained validator, source/context bindings, all proof and journal hashes, hook counts, terminal cleanup acknowledgment and preserved historical pointers. Review `test-results/data-backend/ci-37929506649-independent-review.json` has SHA-256 `8947c080cea4d1875581349c8551e1e0d91e7e92269744fbaccca95ed653e6de`. The documentation follow-up preserves executable source at tested `e8afd50` and does not imply another SQL run. PR288 remains draft and unmerged; production is unchanged at `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f` / Ready deployment `8C3YSnXRCbmPETftQgRtirfyck5e`, agreeing with clean primary and GitHub main and the canonical Vercel repository/root/production branch. No competing owner observed in inspected worktrees, PRs, workflows and deployments. Production cron logs and database leases were not inspected; isolated ownership was enforced by the existing harness. Both older run pointers and all historical results remain intact. **Eighteen authored cases in the 25-case intake module remain unexecuted across recorded SQL milestones.** This bundle does not qualify competing-owner races, complete grants/RLS, live acquisition, fresh-role provisioning, process death, wider recovery, capacity, the 48-module full suite or production migration/release safety. No subsequent milestone or rollout was started.

## Previous bounded milestone — R037 official preconfiguration, October 9, 2026

**Both existing R037 cases passed in one isolated SQL run.** [Run 37922543557](https://github.com/clawmachinejed/league-one-audit/actions/runs/37922543557), attempt 1, executed exact reviewed source `cbfc938b6053cf9cb051b463d2de3ace451f6007` with the closed `data-official-preconfiguration-v1` profile: **25 collected, 2 executed passes, 23 filtered; zero selected skips, failures, retries, repeats or unhandled errors**. Vitest displays the 23 filtered cases as skipped; none of the selected cases skipped. The selected suite's before/after hooks each ran once. No new API key, production write or automatic SQL retry occurred.

**Data resource and persisted result.** The existing Sleeper capture/normalizer → canonical registration and restricted typed writers → backend reader path retained all nine missing/null/empty scoring-and-slot combinations with their distinct field states and immutable receipts. Malformed optional configuration stayed explicitly invalid, without replacing the legacy accepted-configuration pointer, existing configuration versions or canonical profiles. Later valid rules produced the expected typed configuration version and reader parity while the legacy compatibility writer retained its refusal. The separate recovery case committed a fresh NULL-profile canonical identity, interrupted before the bootstrap checkpoint, then recovered the same identity and completed the existing intake path. These are retained synthetic source cases against real isolated PostgreSQL, not additional live-provider coverage; the earlier DannyPak live result remains separately source-bound below.

**Cleanup and exact evidence.** Disposable run `0fa3d873-a728-4a74-b61e-5af00378c00b` began `2026-10-09T11:15:58.067Z`, finished `11:21:49.829Z` and received supervisor acknowledgment at `11:21:49.8401374Z`. Recovery took 305,815.088 ms; the nine-state matrix took 4,752.115 ms. Total lifecycle was 351,837 ms, within unchanged 0.25 CU, 30-minute work and 40-minute lifecycle bounds. Child closure, schema cleanup, generated database-credential revocation and deletion of `br-sweet-silence-b71ukfdk` are verified by the terminal receipt and supervisor acknowledgment; failures and unresolved resources are empty. All twelve journal snapshots bind the same source and run. Result manifest `test-results/data-backend/ci-37922543557-result.json`, SHA-256 `d96b9a2781299fc7be012bc320a616b32e83f9bd192e35aba6d19622d91c1b2e`, binds nine source/context/report/cleanup and ancillary proof files plus twelve journal hashes. The protected test-project key was reused and retained. No separate post-run Neon API probe ran; this child's PostgreSQL version and billing cost were not measured. The existing $1 authorization is not a provider billing cap.

**Reviewed corrections and local evidence.** Pre-run review independently reproduced two test-premise errors against the existing contract. Identity-only typed coverage retains malformed optional scoring/slots as invalid evidence; the legacy configuration pointer, rather than the typed evidence head, must remain unchanged. Valid later rules normalize successfully even when the legacy writer rejects compatibility with a NULL canonical profile. Only the existing matrix test body was corrected; recovery, runtime, migrations, scoring and provider policy remained unchanged. Thirty-two maintained oracle regressions exercise the actual assertion blocks and installed-driver-shaped boundaries. Final local runs passed 227 tests across six files plus 47 profile/reporter/runner tests across three files, with zero failures/skips; independent review separately passed 166 oracle/harness tests across two files. Totals overlap and are not additive. Lint, types, scope and whitespace checks passed. The new exact pair selector uses `RegExp.source` so Vitest's slash serialization matches the matrix name. Extracted workflow checks passed seven permitted and fourteen refused mappings. Existing core names, other bodies/selectors/inventories, live source digests and the 48-module full inventory are preserved; the two older core profile digests change with the common source repin. Selected LF source digest is `399d9470f2256a8f08196a887ff9ccc43a76c94ce947e3d7c2e624670aa43479`; profile digest is `8426481f37521c09208f8557afee10e175acda116a9bd639a8eb1ebbe0b89278`. Offline preparation evidence remains under `test-results/data-backend/r037-*`.

**Non-SQL CI and preview.** [Run 37922467495](https://github.com/clawmachinejed/league-one-audit/actions/runs/37922467495) passed dependencies, scope, lint, types and build; **6,084 unit tests across 286 files passed, zero failures/skips; public browser checks passed 121 with 20 account-case skips; all 20 separate synthetic-account browser checks passed, zero failures/skips.** Both browser groups recorded zero flaky cases. The previous f20eab3 flaky result remains historical, with its cause unproved. Both jobs checked out merge `777a16571087a97dce8f9b734ffab02275819970`, whose parents are main `87da4d0` and candidate `cbfc938`; its tree equals the candidate tree `eec84248f40bac09c46646024189b7afa0c7d3cf`. CI proof SHA-256 is `b2cc09f20056646ddd56791dbbc809a665999119dbee01398f470c844624396f`. Exact-source Vercel preview `9K1KvpDG2VvkNkEYTN1A7T9SGF4d` is Ready at [the cbfc938 preview](https://leagueonefantasy-h6gr94jyc-robert-finchums-projects.vercel.app). Read-only built-in-browser inspection rendered My Fantasy 2026/week 5 with three manager links and both league manager pages with twelve cards each, including DannyPak in League One. Preview proof SHA-256 is `28a9f3ce73c047cbaeb1da5af2c25e2c8a69d853cf9491eb61246c1389bbc92b`. These presentation checks do not prove use of the isolated database or production activation.

**Completion boundary.** This bounded R037 milestone is complete. The documentation-only result follow-up preserves executable source at tested `cbfc938`; it does not imply another SQL run. PR288 remains draft and unmerged. Fresh final checks still agree on clean local/GitHub main `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`, canonical repository/root/production branch and Ready production `8C3YSnXRCbmPETftQgRtirfyck5e` at that exact SHA. No competing owner was observed in the inspected worktrees, PRs, workflows and deployments. Production database leases and cron logs were not inspected for this test-only milestone; fresh isolated ownership was enforced by the existing harness. Production is unchanged. **Twenty-one authored cases in the 25-case intake module remain unexecuted across the recorded SQL milestones.** The broader 48-module guard/failure matrix, whole-suite timing, capacity, format/resource diversity and production-release qualification remain open. No next guard group, UI work or rollout was started. The prior DannyPak result and its active-run pointer remain intact.

## Previous passing live milestone — October 8, 2026

**DannyPak live username → complete league discovery → stored official data → one refresh passed.** [Run 37868723082](https://github.com/clawmachinejed/league-one-audit/actions/runs/37868723082), attempt 1, executed exact reviewed source `f20eab384e328e3b6cc0b1b18a710a381f622197` with `data-live-public-intake-v1`: **1 collected/executed pass, 0 failures, skips, filtered cases, retries, repeats or unhandled errors**. DannyPak's complete four-league 2026 list was Dynasty League, League One, The GridIron II and Myers; League Two was absent, and two leagues were outside the bootstrap registry. These identities constrain this test only. No runtime league filter, selected-league feature or parallel provider pipeline was added.

The complete case passed both live collections, exact raw/canonical and typed-resource parity, profile rules/hash, provider-manager/team/league identity retention, witness and fresh receipt lineage, directory captures, immutable first-collection history, composed completed-refresh readback, strict single-cycle/disposition checks, real admission spacing, exact final counts, no unfinished dispatches and final payload digests. It ended with `finalized: true`, `firstFailure: null` and final step 29 settlement progress. **29 owner claims, 28 acquisition admissions and all 36 GETs completed, totaling 179,478 bytes.** All 12 league/roster/users content comparisons were unchanged; this qualifies repeated real acquisition and fresh lineage, not changed live payloads. The separate 91aec119 fixture result remains the evidence for changed content and injected recovery. One immediate refresh under a one-hour cadence configuration does not establish hourly endurance, fleet-wide freshness or capacity.

**Cleanup passed and the existing key was reused.** Run `3fbaa803-2bfa-4980-8a09-c84aa12b4d33` began `2026-10-09T01:14:25.416Z`, finished `01:42:59.134Z` and was acknowledged at `01:42:59.1465514Z`. Case duration was 1,693,607.697 ms; lifecycle was 1,713,824 ms, inside the unchanged 29-minute case, 30-minute work and 40-minute lifecycle limits. Child closure, schema cleanup, generated database-credential revocation and deletion of `br-hidden-union-b7185ovy` are verified; failures and unresolved resources are empty. Artifacts are retained under `test-results/data-backend/ci-37868723082/`, with result manifest `ci-37868723082-result.json`, SHA-256 `61071e0f350a2616d94d00741df565edb59af5991fc821ee2bb0ea33435c133a`, binding nine independently verified source/context/report/cleanup and ancillary proof files. All 12 journal snapshots bind the same run and source; the bounded diagnostic ring is not a complete timeline. There was no new API key, local control file, automatic retry or production write. The protected test-project key is retained. Billing cost was not measured; the existing $1 authorization is not a provider billing cap.

**Local, CI and preview evidence remain distinct.** The corrected candidate passed independent review and 190 focused offline tests across six files, zero failures/skips, plus types/lint/scope/whitespace checks. Manifest `dannypak-cycle-oracle-verification.json`, SHA-256 `de43b5851ce8381a70cfc3c39f24854b49ca509a77d933bc4dbf71cd8fd019ce`, binds five changed paths and 22 verified proofs. The only executable change since 08bc9b8 was the reproduced test query's explicit cycle integer cast. Its case LF digest is `3d51da6710c64cccba8064806e3ff47a16240deef46b72c16a228453cae5699b`; profile digest is `313b01d3f928b305b9301facd6599c678e93e1e6ce263f44c838eb9205aa6ccb`. Runtime, query count, all provider/admission/time bounds, the four older profiles and the 48-module full inventory are unchanged.

[Non-SQL run 37868713482](https://github.com/clawmachinejed/league-one-audit/actions/runs/37868713482) succeeded with **6,047 unit passes across 285 files, zero unit failures/skips; 120 public-browser passes, 1 flaky pass and 20 skips; and 20 separate synthetic-account browser passes, zero failures/skips**. The unchanged compact-player-name browser case first measured 154 pixels against a 60-pixel bound at 320px/150% text, then passed its configured retry. Its cause remains unproved; there was no manual rerun or UI change, and no downloadable screenshot/trace artifact was retained. Actual merge checkout `3f4e8fa0c72e34b12a277c0c805353dc62046dfc` has parents main `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f` and candidate f20eab3; merge and candidate trees equal `c9c7607e568981adfdd32c0cf8e53c33889fe4de`. CI proof SHA-256 is `bc261e247831c5de797dbe0a8e6e3c52655c8675ca80ad8a6cab4487ebdd1ab3`.

Exact-source Vercel preview `CBedgUvthxigWidFfQ5rc1wFsqJp` is Ready at [the f20eab3 preview](https://leagueonefantasy-5lixhiqog-robert-finchums-projects.vercel.app). Read-only inspection rendered My Fantasy 2026 with three manager links and both league manager pages with 12 cards each, including DannyPak in League One. Preview proof `dannypak-cycle-oracle-preview-evidence.json` SHA-256 is `de86766c75ac0d0adbc7289669785f10197402558c0c0bde67122b31f4912e1c`. These existing pages do not prove production activation or use of the isolated database.

**Completion boundary at that checkpoint.** The bounded live username/import/readback/refresh milestone is complete. PR288 remains draft and unmerged; production is unchanged. Fresh clean local main, GitHub main and actual Vercel repository/root/production branch still agree on `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`, with Ready production `8C3YSnXRCbmPETftQgRtirfyck5e`. No production migration or activation is included. The other 23 authored cases in the 25-case intake module remain unexecuted: five intake/lock/recovery, twelve refresh, two optional-registration and four exact-period cases. They are one module within the 48-module full inventory. Some depend on earlier retained state; whole-suite fit under 30 minutes is unproved. The next small acceptance claim is the existing R037 nine-state missing/null/empty scoring-and-slots case, followed by the separate committed-bootstrap recovery case for fresh unconfigured intake. These require reviewed closed selections of existing cases, not arbitrary filters or a new runtime pipeline. Wider safeguard/failure, capacity, format/resource and production-release qualification remain open.

The integration README now links to this ledger for current results instead of duplicating a stale status summary. The following failed attempts and their exact limitations remain historical evidence.

### Previous cycle-type failure and correction

**Previous live result: both collections and completed refresh readback passed; the final raw cycle-count assertion failed.** [DannyPak run 37865039917](https://github.com/clawmachinejed/league-one-audit/actions/runs/37865039917), attempt 1, executed exact reviewed source `08bc9b8edab2bfd1ecd7cecba366f45b37e17e07`: **one collected/executed failure, zero passes, skips, filtered cases, retries, repeats or unhandled errors**. DannyPak's complete four-league 2026 list was acquired twice through the existing pipeline: 28 acquisition steps, 29 owner claims, 28 admissions, 36 GETs and 179,476 bytes. Both complete stored readbacks, profile rules/hash and canonical identities, detailed raw/resource parity, fresh receipt lineage and unchanged first-collection history passed. All 12 league/roster/users comparisons were unchanged. The zero-GET settlement returned backoff, and composed refresh readback returned available, cycle 1 and complete persisted outcome. At step 29 / collection 2, `journey-complete / journey.refresh.cycle-count / toEqual`, occurrence 1, failed: the raw query returned one string cycle value while the oracle expected numeric 1. The sanitized artifact does not preserve the raw string literal. The later direct disposition, SQL spacing/counts, explicit claims/admissions, unfinished-dispatch and final payload-rehash checks were not reached; `finalized` is false. The complete case remains failed.

**Cleanup and exact result.** Case duration was 1,699,719.308 ms; supervisor lifecycle was 1,727,014 ms, within the unchanged limits. Run `37ecafbc-cf86-4ab5-8a98-16cc8e68a9d5` ran from `2026-10-09T00:30:26.079Z` to `00:59:13.006Z`, with terminal acknowledgment at `00:59:13.0161852Z`. Child closure, schema cleanup, generated database-credential revocation and deletion of `br-late-fire-b7wuou1k` are verified; unresolved resources are empty. Result manifest `test-results/data-backend/ci-37865039917-result.json`, SHA-256 `d63b21208369ac1f3b1fd342cd2f0993f4da69b136509b3c5c1d2170edc5c154`, binds nine independently verified proofs. The 128-event ring dropped 719 events and is not a full timeline. The protected API key was reused and retained; no new key, local control, production write or automatic retry occurred. Cost was not measured; the existing $1 authorization is not a provider billing cap.

**Confirmed final-check type defect corrected offline.** The cycle column is bigint; the existing harness returns driver rows unchanged, while the composed reader already normalizes decimal strings. Author and independent offline reproductions exercised the installed Neon/PostgreSQL OID 20 parser and the actual frozen matcher: string `1` fails numeric equality; OID 23 integer 1 passes. The single existing cycle query now selects `cycle::integer AS cycle`, preserving the exact expected row and strict rejection of wrong, missing or extra cycles. The whole-case numeric/closing audit found no other raw bigint-to-number premise. Sixteen maintained regressions execute the actual closing assertion block with installed parsers and reject incorrect disposition, spacing/counts, counters, unfinished dispatches, mutated payloads, extra GETs and partial composed readback. Runtime, driver configuration, query count, provider budget and all deadlines are unchanged. The corrected case LF digest is `3d51da6710c64cccba8064806e3ff47a16240deef46b72c16a228453cae5699b`. Final maintained verification passed 190 tests across six files, zero failures/skips (104 diagnostic, 44 boundary and 42 profile/reporter/supervisor tests), plus TypeScript, lint, scope and whitespace checks. Independent source and final-tail review accepted the correction. Profile digest is `313b01d3f928b305b9301facd6599c678e93e1e6ce263f44c838eb9205aa6ccb`; four older profiles and all 48 full-inventory modules are unchanged. The subsequent f20eab3 live execution passed as recorded above; this prior failure remains failed. Fresh local/GitHub main and actual Vercel source/production checks at approximately 00:58 UTC agreed on `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`, canonical repository/root/branch and Ready production `8C3YSnXRCbmPETftQgRtirfyck5e`.

**Previous non-SQL verification and preview passed at 08bc9b8.** [Run 37865034697](https://github.com/clawmachinejed/league-one-audit/actions/runs/37865034697) passed dependencies, scope, lint, types, build and **6,031 unit tests across 285 files, zero failures/skips; 121 public browser passes with 20 account-case skips; and all 20 separate synthetic-account browser tests, zero failures/skips**. Actual merge checkout `a5558502b81486d4eb3e73e3433070011a3f9cd3` has parents main `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f` and candidate `08bc9b8edab2bfd1ecd7cecba366f45b37e17e07`; merge and candidate trees equal `cd9c4aba64c7e6ad0b49c01c3c4c392900ffbf12`. Proof `ci-37865034697-proof.json` SHA-256 is `dbe97d27b00543a4e33f96bcf7361577cabbbe5679048ef13ccc301ba3341f02`. Exact-source Vercel preview `ut85wxwhPakmVTcVHbDfQmxEYGCR` is Ready; My Fantasy 2026 and both manager pages rendered, with 12 cards each and DannyPak present in League One. Preview proof `dannypak-profile-oracle-preview-evidence.json` SHA-256 is `a1e72d2e51faaaeb07a564b44f3877fcbcdf75fe7937976024cafe5cee663c50`. These checks do not override the failed SQL case or prove that rendered pages use the isolated database.

**Publication and remaining scope at that checkpoint.** PR288 remained draft and unmerged; production was unchanged. The reviewed corrected candidate had not yet run; its subsequent result is recorded above. The 23 other cases in the 25-case ordinary inventory, the broader safeguard/failure matrix, capacity and backend/release qualification remain open. Test identities do not constrain runtime eligibility; the backend remains league agnostic.

### Prior source-bound attempts and corrections

The following records retain their original outcomes and limits. The latest status is above; earlier failed attempts are not converted into passes.

**Previous live result: a precise scoring-profile test mismatch.** [DannyPak run 37862067153](https://github.com/clawmachinejed/league-one-audit/actions/runs/37862067153), attempt 1, executed exact reviewed reporting candidate `89963b3a84f3129a3d686b5a807035270180f7ed`: **one collected/executed failure, zero passes, skips, filtered cases, retries, repeats or unhandled errors**. All 14 initial acquisition steps and 18 GETs completed (89,738 bytes). The composed intake summary required and returned available/terminal; league order/list and retained identity/list comparisons passed before `canonical-identity / journey.canonical.fields / toMatchObject`, occurrence 1, failed for the first sorted league. Actual `scoring_profile_id` was a UUID, while the test expected NULL. Inactive enrollment, evidence, connection and season IDs matched. This identifies the exact assertion; detailed per-league parity, retained-history comparisons, refresh and finalization remain unqualified.

**Cleanup and exact evidence for this failure.** Run `ec2c5c37-ec16-4aa1-9142-bda0df38ba8c` began `2026-10-08T23:56:05.763Z`, finished `2026-10-09T00:10:11.083Z` and was acknowledged `00:10:11.0929703Z`. Case duration was 800,679.876 ms and supervisor lifecycle 845,395 ms. Child closure, schema cleanup, generated database-credential revocation and deletion of `br-billowing-heart-b72pibu2` are all verified; unresolved resources are empty. The existing protected API key was reused and retained. Ignored result manifest `ci-37862067153-result.json` SHA-256 `8aa36f40564790b12858e367c63b20dc4b54948d10984ffc5bd79ff362484b9c` binds eight proof files. The 128-event diagnostic ring dropped 208 events and is not a full timeline. No production write or automatic retry occurred.

**Confirmed scoring-profile test-oracle defect corrected offline.** Existing official-data registration creates a profile for nonempty finite numeric scoring rules, retains NULL for absent/null/empty rules, and preserves an existing season profile. The live case incorrectly assumes every league has NULL regardless of its bootstrap rules. Author and independent offline reproductions exercised actual public registration through the shared identity adapter and the frozen failing matcher, with modeled database rows and blocked network. Nonempty numeric rules correctly supply a hash/profile while the old matcher rejects the returned UUID; absent/null/empty rules retain the NULL contract. The whole-case audit found no other inherited NULL-profile or expected legacy-rejection assumption. The corrected oracle checks the initial bootstrap rules/hash and profile identity through a LEFT JOIN in the existing canonical query and preserves the full canonical/profile snapshot across refresh. All 67 prior fixed assertion IDs remain; only the reproduced blanket-NULL premise is replaced. Five additional strict checks reject missing/non-string/invalid profile identity, a missing or mismatched joined row, wrong hashes and incorrect NULL states; existing exact JSON comparison rejects wrong rule content. There are still 18 query sites and no additional provider call, runtime change or deadline change. Final focused verification passed 174 tests across six files with zero failures/skips, including 25 profile regressions, plus TypeScript, lint, scope and whitespace checks. Independent review accepted source and the clarified optional-profile contract in this ledger and the R037 design heading. Selected case LF digest is `f045aa6d657452229d436fbce130438df0fa5c51420616f07805de9484c19330`, profile digest `3308c9008978118905dfb7a4ff86e6b281ea96f5e6da1b128a499e9dd602d30d`. All four older profile definitions and the 48-module full inventory remain unchanged. Its subsequent live execution at 08bc9b8 is recorded above; the preceding failure is not converted into a pass. No runtime or migration change is indicated by this mismatch. These offline reproductions do not constitute another SQL result. Fresh local/GitHub main and actual Vercel source/production checks at approximately 00:13 UTC still agree on `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`, canonical repository/root/branch and Ready production `8C3YSnXRCbmPETftQgRtirfyck5e`.

**Previous non-SQL verification and preview passed at 89963b3.** [Run 37862061557](https://github.com/clawmachinejed/league-one-audit/actions/runs/37862061557) passed scope, dependencies, lint, types, build and **6,006 unit tests across 285 files with zero failures/skips; 121 public browser passes with 20 account-case skips; and all 20 separate synthetic-account browser tests with zero failures/skips**. Actual merge checkout `619ab25223e9b78832a620d7a8219fef7119b7c2` has parents main `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f` and candidate `89963b3a84f3129a3d686b5a807035270180f7ed`; merge and candidate trees equal `965aaac5ff556fe8271b960090b08eb02cba4e87`. Proof `ci-37862061557-proof.json` SHA-256 is `eef30cdcfa9a20af4b4e113524263d753235dd077cb44e7f3497ad68430bac20`. Vercel preview `EgVdEf2gYEUBhohU13VpVxx3rgHh` is Ready at that exact candidate; My Fantasy 2026 and both league manager pages rendered, with 12 cards each and DannyPak present in League One. Preview proof `dannypak-reporting-preview-evidence.json` SHA-256 is `3528c3afb3efc818b6c7e20be56a7fe89a1fc54ca3d22f7757be7e91abb74ce5`. These checks do not override the SQL failure or establish that rendered pages use the isolated database.

**Previous DannyPak live journey failed without an exact assertion.** [CI run 37858990541](https://github.com/clawmachinejed/league-one-audit/actions/runs/37858990541), attempt 1, ran exact reviewed source `756ed0c81ecdd0c386acf182e0adf2af32a2859e` with `data-live-public-intake-v1`: **one collected/executed failure, zero passes, skips, filtered cases, retries, repeats or unhandled errors**. Real identity/discovery and all 14 acquisition steps of the first collection completed for DannyPak's complete four-league 2026 list: Dynasty League, League One, The GridIron II and Myers. All 18 expected GETs completed (89,738 bytes); the forwarding boundary recorded no transport failure. The next `reader.intake` assertion block failed at step 14, collection 1. Its plain assertions did not retain a fixed assertion identifier or actual/expected values, so the exact failing assertion and any underlying runtime cause remain unknown. Full stored readback, retained-history comparisons, refresh and finalization did not pass and must not be inferred from completed acquisitions.

**DannyPak run bounds and cleanup.** Run `9555aeb7-e7a5-4bb3-a7c4-70fed43020da` started at `23:22:16.225Z`, finished at `23:35:32.710Z`, and was acknowledged at `23:35:32.7224083Z`. Case duration was 783,834.015 ms; supervisor lifecycle was 796,590 ms, within unchanged 30-minute work/40-minute lifecycle bounds. Terminal receipt and acknowledgment confirm child-process closure, schema cleanup, generated database-credential revocation and deletion of child `br-purple-cloud-b7y4j7oc`; unresolved resources are empty and the sole failure is tests. The existing protected CI API key was reused and retained; no new key, local control, automatic retry or production write occurred. PostgreSQL `18.6 (4e955f5)` / `180006` and hosted Node 24.21.0 were measured. Independent review verified the exact source/profile/context/report/cleanup and seven proof hashes. Ignored `test-results/data-backend/ci-37858990541-result.json` SHA-256 is `be3167b0fd0089316ce60580b03dc54bb607f7a62365e9ddce1a37380db99d6b`; artifacts are under `ci-37858990541/`. The 128-event diagnostic ring dropped 158 prior events; the 14 fixed progress lines are retained separately in the masked job log.

**Test-reporting defect reproduced and corrected; no runtime fix established.** Author and independent offline reproductions exercised the failed candidate's actual assertion and diagnostic save with modeled readbacks, confirming that plain Vitest assertions lost their exact comparison. All 67 original plain matchers now use unique fixed identifiers; independent AST comparison found unchanged operands, order, matcher and negation. A bounded summary retains up to four aliased leagues and five fixed resource statuses/reasons. An observation-only facade preserves errors caught by composed readers, including SQLSTATE, without adding queries or changing arguments/results; a secondary summary never replaces the first error. Regressions cover the actual early and later case assertions, swallowed reader errors, accessors, oversized and hostile values. Final focused checks passed 149 tests across six files, zero failures/skips, plus TypeScript, lint, scope and whitespace checks. Selected case LF digest is `2183009553821c111746ec254451682033eea45d570b6732c8c62396ca85c979`. The failed live run remains failed. One attempt has completed; no automatic retry occurred. Continued DannyPak qualification uses the user's standing approval, a newly reviewed and frozen candidate, the existing protected key and unchanged test-only limits; the subsequent reviewed-source run is recorded above.

**Preparation and authority for the failed candidate.** Public preflight at 22:59:37–38 UTC resolved manager `79628519873069056` and the complete four-league list; League Two is absent. Ignored raw preflight evidence hashes are identity `e90880671ed221f680b4d405b58028002804acea38828bb8437859cbe9ab47fc` and list `0de0c31a5a2b95c5c263bf2db2f5d8c2b1c2c2f8196a161c96830d4e651286d1`. Candidate preparation passed 134 offline tests across six files, TypeScript, lint, scope and whitespace checks, plus six allowed/fourteen denied workflow stub cases. Independent source review accepted the candidate; these checks did not establish the SQL readback. Candidate manifest `dannypak-candidate-verification.json` SHA-256 `1dcd1075ffd2351af98de85334a08f67d38d06e4c419fa2423ed9edc5d55b28a` binds its 12 changed files and 11 proof hashes. Fresh local/GitHub main and actual Vercel production checks before authoring and again before the reporting correction agreed on canonical repository `clawmachinejed/league-one-audit`, Vercel root `apps/site`, branch `main`, exact SHA `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f` and Ready deployment `8C3YSnXRCbmPETftQgRtirfyck5e`. Production remains unchanged.

**Shared refresh and recovery passed once.** [CI run 37852495625](https://github.com/clawmachinejed/league-one-audit/actions/runs/37852495625), attempt 1, qualified exact source `91aec119930cc65d168f81e35a0bdc83fd7e583b` with `data-core-refresh-v1`: **25 collected, 1 selected pass, 0 failures, 24 filtered (reported skipped by the runner), no selected-case skip or runner retry/repeat**. The backend scope is shared across supported Sleeper leagues; League One and League Two are test inputs. This case uses a random synthetic league in season 2181, controlled HTTP fixtures through the existing adapter/coordinator, actual restricted PostgreSQL and composed stored readers.

The passing source-bound assertions establish two changed core cycles (scoring, primary/co-managers and players), stable canonical/team identities, exact typed receipts, unchanged populated first-cycle history, an unfinished dispatch with committed receipts, recovery and idempotent replay without recovery-time acquisition, no remaining unfinished dispatch, and real admission gaps of at least 60 seconds. Case duration was **791,967.448 ms (13m12s)**; total supervisor lifecycle was **867,671 ms (14m28s)**, within the original 30-minute work/40-minute lifecycle limits. The bounded diagnostic ends at cycle 2/step 770 with `firstFailure: null`; its 128-event ring dropped 2,426 earlier events, so it is not a complete timeline. No failure-only receipt query or child-version measurement is claimed. Live repeated-provider acquisition, the other SQL cases/full guard matrix, capacity and whole-backend/release qualification remain open.

Run `cb65d63e-2528-4a24-99df-132779b505d1` ran from `22:18:52.866Z` to `22:33:20.431Z`; the successful terminal acknowledgment at `22:33:20.4448723Z` confirms process-group closure, schema cleanup, generated database-credential revocation and deletion of child `br-shy-night-b7qedylp`, with no unresolved resources or production writes. It reused and retained the protected CI API key, unchanged test project/parent and 0.25 CU; no new key, local control or automatic retry occurred. The $1 authorization is not a measured bill or billing cap. Independent review verified the saved result/cleanup proofs; no separate post-run API probe is claimed. Artifacts and masked log are retained under `test-results/data-backend/ci-37852495625/` and `ci-37852495625-job.log` (GitHub retention: 14 days); `ci-37852495625-result.json` binds six proof hashes and the prior non-SQL CI result. Terminal 0012 SHA-256: `25b5190195445608869ad385a4491381862553c3767986296f82170098b62430`.

**The earlier bounded live League Two core milestone passed in CI.** [Run 37846456247](https://github.com/clawmachinejed/league-one-audit/actions/runs/37846456247), attempt 1, executed reviewed source `e85c798d787c54fba295963d7042b5529b4b478e` once: **1 pass, 0 failures, 0 filtered/skipped, no retries/repeats or unhandled errors**. All four permitted GETs completed (17,253 bytes), all four typed resources accepted, and every raw/canonical readback, identity, receipt/mapping/population, directory and unchanged-payload assertion passed. The inactive NULL-profile setup and expected legacy compatibility rejection remained intact.

This qualifies one live League Two 2026 registered-operator capture → existing writer → restricted isolated PostgreSQL → typed-reader path at that SHA. Live username/identity/associated-league discovery, witnessed intake, other resources/periods, the full SQL guard matrix and backend/release qualification remain open. The case took 2,637.736 ms; supervisor lifecycle elapsed was 48,987 ms. Hosted Node was 24.21.0 (local checks: 24.19.0); the existing restricted query retained PostgreSQL `18.6 (4e955f5)` / `180006`. `firstFailure` is null, so failure-only receipt queries did not run. No timestamp delta or prior-failure cause was measured; the changed league-response hash also prevents calling this an identical-input replay or attributing success solely to the host platform.

**Cleanup and credential reuse are confirmed.** The acknowledged successful terminal receipt at `21:25:16.0269643Z` verifies process-group closure, schema cleanup, generated database-credential revocation and deletion of child `br-silent-paper-b7q4jqjf`, with no unresolved resources or production writes. The existing test project/parent, 0.25 CU and 30/40-minute limits were unchanged. Independent review checked those saved proofs; no separate post-run API 404 probe is claimed. The protected CI project API key was reused and retained; no new key or local control file was created. The approved single attempt is consumed. Billing cost was not measured; $1 was authorization, not a provider billing cap.

The exact run is `bd51ee48-cab9-4e2f-9331-9119257b20a9`, from `21:24:27.131Z` to `21:25:16.013Z`. Sanitized artifacts are retained locally under `test-results/data-backend/ci-37846456247/`, plus the masked `ci-37846456247-job.log`; GitHub retention is 14 days. The terminal `run-1791494667125-cba6f39b-e0d3-4635-a23f-4e0171aac219-0012.json` SHA-256 is `71c1b70378ee2d9bbbf8727a2ac55a02b9b31305f02d92b26e91503be4250be6`. `ci-37846456247-result.json` binds the result and artifact hashes. Historical failures below remain failures.

**Diagnostic wiring and CI profile preparation, now exercised by the passing run above.** The live case now captures the existing guarded runtime receipt reader after its strict role assertion, queues exact preserved receipt/attempt bindings from the unchanged writer result and returns that result unchanged. Its existing finalizer restores the original fetch before the shared failure-only diagnostic save. The four-resource limit, one five-second caller deadline, read-only transaction/statement bound, sanitization, first-failure precedence and cleanup remain unchanged. No runtime, SQL, acceptance assertion, capture budget, case timeout or ordinary module changed. Live LF digest is `bcb3bee63bf12658da7d099fd34397fada96757a5799e05a586456761b173f74`; the ordinary digest remains `afb857bf98a17a82196433f3f684491e7671df6a1cdc5b96432c95efb2444f99`.

Local verification passed **209 tests across four files, zero failures/skips**, plus TypeScript, changed-file lint, scope and whitespace checks. Four new offline regressions execute the actual live wrapper and finalizer, proving exact four-resource binding, restored fetch, no reads without an original failure, diagnostic-error precedence and the shared five-second deadline/late-result behavior. These checks use modeled receipt rows and establish no PostgreSQL timing result. The existing CI workflow now offers closed profile choices mapped to fixed existing supervisor commands so approved bounded runs can reuse the protected project's existing control-plane key. YAML/normalized-configuration review and execution of the actual extracted Bash with a stub command passed 5 allowed and 13 rejected event/profile cases; zero real supervisor or SQL commands ran. That workflow-only YAML/shell check used Node 20 and supplies no application-runtime qualification; the 209 tests and TypeScript/lint checks used pinned Node 24.19.0. An initial sandbox Bash startup failure occurred before the stub command executed, followed by the successful unchanged normal-host check. Manual default and qualification pushes stay full-suite, and permissions, environment approval, concurrency and deadlines are unchanged. Disposable child credentials and branches still require per-run cleanup; the protected project key is reused without per-run rotation. GitHub secret metadata confirms an existing configured key, not its value, validity or a successful hosted run. Independent review accepted the diagnostic wiring, workflow and exact scope extension. During local source preparation no new key, SQL run, push or production release occurred. The subsequent branch publication and single successful CI execution are recorded above; production remains unchanged.

**Previous def3b372 live League Two attempt failed; cleanup completed.** Exact reviewed source `def3b37212b51650b2a47a025dce4e28a579f2ac` ran once as `c45cb17d-07d1-4a43-976b-d2229682b6c9`: **1 collected, 1 executed failure, 0 passes, 0 filtered/skipped**, with zero retries/repeats or unhandled errors. The case took 1,535.486 ms; terminal monotonic lifecycle elapsed was 35,165 ms and the command exited 1 with an acknowledged failed receipt. The existing restricted-role identity SELECT retained actual child PostgreSQL `18.6 (4e955f5)` / `180006`; no external version probe ran. This is not live core qualification.

The corrected inactive canonical enrollment/NULL-profile assertion passed. All four permitted GETs completed in order (metadata league, league, rosters, users), totaling 17,253 bytes (2,876 + 2,876 + 7,344 + 4,157), with no capture failure. Four reservations, normalization and the existing writer ran. The first failure was `live.write`: the exact expected legacy league compatibility rejection and changed roster/users outcomes matched, but all four typed acceptances were **preserved**, expected **accepted**. Retained reasons were `complete_league_identity_unproved`, `complete_players_population_unproved`, `complete_primary_owner_population_unproved` and `complete_manager_evidence_population_unproved`. Typed readers and their value/provenance comparisons were not reached. No receipt timing comparator values were retained; these reasons do not establish a runtime root cause or clock explanation. No acceptance condition, test expectation, runtime or schema was changed after this failure, and no retry ran.

**Narrow source inference, independently corroborated.** Source and retained evidence imply the legacy `requestStartedAt >= attempt.reserved_at` predicate evaluated false for settings. This is deduction from the other established settings-coverage conditions in `039_public_data_capture_witness.sql` and its exact-content binding, not a retained PostgreSQL comparator result. The exact timestamp difference and its cause remain unmeasured. The existing writer then withholds population evidence when the legacy league result is rejected and typed settings are preserved (`league-administration/runtime.ts`); the three downstream population-preservation outcomes follow from that missing population. This does not establish a separate manager-v2 timing-comparator result. At def3b372, the live wrapper recorded observation outcomes but never queued the existing bounded receipt diagnostic reader, which already returns the PostgreSQL comparison and a clamped difference. That missing wiring was corrected in e85c798; the subsequent successful CI case did not execute the failure-only receipt query, so the earlier comparator difference and cause remain unmeasured.

**Corrected-source run environment and complete cleanup.** Fresh source/service checks agreed on clean local/GitHub main `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`, the canonical repository, production branch `main`, root `apps/site` and Ready Vercel deployment `8C3YSnXRCbmPETftQgRtirfyck5e` at that exact SHA. No competing owner was observed in inspected source/deployment evidence. Fresh guarded parent preflight passed identity, inventory and quiescence checks for test project `league-one-integration-tests / steep-glitter-44680287`, parent `integration-test-base / br-plain-bread-b7sgfdl8`. The sole child `br-frosty-boat-b7qxs3zc` used fixed 0.25 CU. First parent connection was `21:00:58.439Z`; absolute work/lifecycle deadlines were `21:30:58.439Z` / `21:40:58.439Z`. Terminal cleanup at `21:02:09.239Z` was 70,800 ms after that first connection: child closure, schema cleanup, generated credential revocation and child deletion all verified, with no unresolved resources or production writes. Independent exact-child 404 and only the intended parent followed at `21:02:53.429Z`. After exact-key UI revocation, the same saved project-only key returned 401 at `21:04:18.280Z`; exact control removal, no matching owned processes and clean frozen source were proved at `21:04:58.686Z`. The one approved attempt is consumed. Billing cost was not measured; $1 was authorization, not a provider billing cap.

The acknowledged terminal receipt is `test-results/integration/run-1791493294138-9597097e-786a-426b-bb53-3db43136c51b-0012.json` (SHA-256 `eeb599dd2cb35c28c8d5de86b64dc3da173a9f57347ceb8a6c50e5f1564af540`). Captures, diagnostics, the failed one-case report and completed global-cleanup acknowledgment are retained in `test-results/integration/artifacts/run-Jwd7PO/`. The generic terminal `testEvidenceFailure: missing-or-invalid` does not mean those artifacts are absent: their bindings and report hash were independently verified, while the selected case failed. `test-results/data-backend/control-cleanup-def3b372.json` binds 24 proof hashes (SHA-256 `41aa593112e1eff74684f991e8e48491940b50f6fb53d8c6d061c29fec93d0f6`). Independent review confirmed the failed result, capture bounds and cleanup. The earlier ordinary SQL pass remains bound to `2f19b7e9`; no resource or release status is promoted by this run.

**Previous live League Two attempt failed at a test oracle; cleanup completed.** Exact reviewed source `27ccafedccd2a17e63ef5905d7c9723fb4c2daaf` ran once as `c63ab940-10b4-48dd-b0a2-464e6eeaf915`: **1 collected, 1 executed failure, 0 passes, 0 filtered**, with zero retries/repeats or unhandled errors. The retained first comparison `live.enrollment.inactive` reports **season-inventory membership true, expected false**; it does not report an active flag of true. Only the initial league metadata GET completed (2,876 bytes). Registration, explicit inactive setup and source mapping preceded the failure; core reservations, the other three GETs, writes and typed readbacks were not reached. The case took 765.462 ms; terminal monotonic lifecycle elapsed was 32,352 ms. This is not live core qualification or evidence of an adapter/database defect.

**Two test expectations corrected before the def3b372 run.** Author and independent reviewers reproduced the first mismatch with the actual season-inventory reader offline: `live-core-test-setup` memberships remain visible regardless of the enrollment active flag. The corrected parameterized restricted read requires exactly one canonical league/provider/season row with `active=false` and `scoring_profile_id=NULL`; active, configured, missing and duplicate rows fail. A second, not-yet-reached mismatch was reproduced through the actual registrar, normalizer and runtime with modeled SQL results: official-only NULL-profile setup plus nonempty source scoring rules produces the existing legacy compatibility rejection and aggregate `unavailable`, even when typed settings accept. The revised assertion requires that exact league rejection reason, exact fresh legacy roster/users changed outcomes, exactly three ordered families and all four typed acceptances. Every existing raw/canonical reader and receipt/identity/provenance comparison remains required. No runtime, schema, scoring configuration or acceptance threshold changed. The offline reproductions executed zero SQL/network requests; they do not substitute for PostgreSQL qualification.

The same closed `data-live-league-two-v1` profile still targets League Two `1378850360529014784` / 2026, permits at most four declared GETs (metadata, then reserved league/rosters/users), 1 MiB each/4 MiB total, no retry, and a 180-second case within unchanged 30/40-minute bounds. The passing ordinary module/digest is byte-identical. This is the legacy registered operator path, not username/identity/associated-league discovery or R039 witnessed live intake. Earlier ignored read-only preparation snapshots preserve 12 rosters, 13 users, 56 finite scoring rules, 14 ordered slots, defense IDs and 11 unknown co-owner groups; they remain preparation inputs only.

**Previous 27ccafed cleanup and containment.** The existing identity SELECT retained actual child PostgreSQL `18.6 (4e955f5)` / `180006`; no external version probe ran. Fresh guarded preflight passed for test project `steep-glitter-44680287` and parent `br-plain-bread-b7sgfdl8`. The sole child `br-winter-star-b7t13kjk` used fixed 0.25 CU. First parent connection was `20:24:29.132Z`; absolute work/lifecycle deadlines were `20:54:29.132Z` / `21:04:29.132Z`. Terminal cleanup at `20:26:13.993Z` was 104,861 ms after that first connection: child closure, schema cleanup, generated credential revocation and child deletion all verified, with no unresolved resources. Independent exact-child 404 followed at `20:27:26.917Z`; after root UI revocation, the same saved replacement key returned 401 at `20:28:45.928Z`. Exact control removal and no matching owned processes were proved at `20:29:35.166Z`. The cleanup receipt binds 23 proof hashes.

Before preflight, a receiver logging failure was recovered locally without using a database attempt. The first temporary key was exposed by browser token-modal accessibility output, then immediately revoked while unused; same-key 401 and exact control removal were verified before its equivalent replacement was created. The replacement was handed off safely and is now also revoked. Both containment records are preserved. The single approved database attempt is consumed; no SQL retry ran. Billing cost was not measured; $1 was authorization, not a provider billing cap.

Local correction verification: **298 tests passed across nine files, zero failures/skips**, plus TypeScript, changed-file lint, scope and whitespace checks. AST-extracted regressions execute the actual corrected comparisons and reject unrelated legacy failures, missing/reordered results and every typed preservation. Live selected LF digest: `7bc14351de8c53de2a9ffcff49b17bd31599ccabfc57aa4985fc9c423b8c9336`. The prior 295-test preparation receipts remain bound to the failed 27ccafed source. These local checks preceded the failed def3b372 PostgreSQL run above; they do not override its result.

**The ordinary PostgreSQL milestone passed.** Exact reviewed source `2f19b7e987b2f3eb2aa03145d95f013cf4ce7ea1` ran once as `e22eeca7-0c3b-4921-8101-2c70dafd41bd`: **25 cases in the closed inventory, 1 selected pass, 0 failures, 24 filtered**, with zero retries/repeats and zero unhandled errors. The selected case took 245,942 ms; the supervisor took 279,345 ms and exited 0 with an acknowledged successful terminal receipt. All 48 original matcher sites passed, including the five-stage/six-fixture-call journey, canonical inactive NULL-profile identity, all four typed readers, final values, exact provenance/acquisition and timestamp comparisons. This qualifies that one fixture → existing adapter/intake → restricted PostgreSQL → stored-reader path on this source. It does not qualify live Sleeper ingestion, the other 24 SQL cases, the full guard matrix, the entire backend or release readiness.

**Earlier ordinary-pass environment and complete cleanup.** The case's existing restricted-role identity SELECT retained actual-child PostgreSQL `18.6 (4e955f5)` / `180006` in the same run/SHA/profile-bound diagnostic; `firstFailure` is null. No external version probe ran. The test used only project `league-one-integration-tests / steep-glitter-44680287`, parent `integration-test-base / br-plain-bread-b7sgfdl8` and one child `br-empty-bar-b72k33ac` at fixed 0.25 CU. First parent connection was `2026-10-08T19:19:30.095Z`; aggregate work/lifecycle deadlines were `19:49:30.095Z` / `19:59:30.095Z`. Terminal cleanup was acknowledged at `19:24:51.020Z`, with child closure, schema cleanup, generated database-credential revocation and child deletion all verified, failures/unresolved resources empty and no production writes. Independent API evidence returned exact-child 404 and only the intended parent at `19:25:21.734Z`. After exact-key UI revocation, the same saved project-only key returned 401 at `19:26:25.582Z`; the exact ignored control was removed and absence/no matching owned processes proved at `19:27:07.272Z`. The one-run authorization is consumed; billing cost was not measured and $1 was authorization, not a provider billing cap.

**Confirmed test defect corrected; prior failure cause still unknown.** The installed Neon timestamptz parser returns a Date. The ordinary test converted it through String(Date), dropping nonzero milliseconds before comparing discovery start/completion times. Author, root and independent reviewer reproduced .001/.123/.999 becoming .000 offline. The two comparisons now use the existing exact-instant helper and retain strict equality at millisecond precision. The earlier c3ca7b00 run's exact first failing assertion was not retained, so this confirmed test defect is not a proven explanation of that earlier failure. No runtime, migration or acceptance threshold changed in the successful increment.

This paragraph records the earlier October 8 publication checkpoint; current acceptance is reconciled in the [resource matrix](#resource-qualification-state). At that checkpoint the `codex/data-backend-recovery` branch was published via [draft PR288](https://github.com/clawmachinejed/league-one-audit/pull/288); its live-core SQL-qualified checkpoint was e85c798 and its shared refresh/recovery checkpoint was 91aec119. It was not merged or deployed to production. The then-inspected Vercel preview `EgVdEf2gYEUBhohU13VpVxx3rgHh` was Ready at `89963b3a84f3129a3d686b5a807035270180f7ed`. Read-only built-in-browser smoke on [the preview](https://leagueonefantasy-tpvldqbfg-robert-finchums-projects.vercel.app) rendered My Fantasy and the League One/League Two 2026 manager pages with 12 cards each. This does not prove those pages use the newly qualified Neon path; the separate completed non-SQL CI result is recorded below. Before the ordinary SQL run, fresh 19:16–19:18 UTC checks agreed on clean local/GitHub main `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`, canonical repository/root/production branch and Ready Vercel deployment `8C3YSnXRCbmPETftQgRtirfyck5e` at that exact SHA. No competing owner was observed in the inspected source/deployment/PR evidence; the separate fresh test-parent preflight passed identity, inventory and quiescence guards. Before live-profile preparation, fresh 19:32–19:35 UTC checks agreed again. Before the live run, fresh 20:07–20:10 UTC local/GitHub main and actual Ready production/source-binding checks still agreed; the separate parent preflight then passed. Before these local test corrections, fresh 20:29 UTC checks again agreed on the same exact main/production identities. No competing owner was observed in inspected evidence; source checks alone make no database lease or parent-readiness claim. Production was unchanged; the earlier ordinary SQL qualification remains bound to 2f19b7e9.

**Previous c3ca7b00 failure.** Reviewed `c3ca7b00e30ae2bb9d69314f0ba26c69acaf5c53` ran once as `0dd3b647-1b2c-4054-a567-439a06e6c754` under the explicitly approved test-only 0.25 CU / $1 envelope, unchanged aggregate 30-minute work/40-minute lifecycle and no retry. The supervisor finished in **278,303 ms: 25 collected, 1 executed failure, 0 passed, 24 filtered**; the selected case took 246,181 ms. Its original failure is `case / assertion / unknown SQLSTATE / step 229 / cycle 1`. Source order plus the retained tail establish that the five stages, exact six fixture calls, intake completion and inactive NULL-profile canonical checks preceded return from all four typed readers. The last recorded boundary was `reader.manager-evidence`; final value and provenance assertions did not all pass. The 128-event ring dropped 647 earlier events. The sanitized failure lost the exact assertion location, so neither a particular oracle nor a runtime root cause is established. **R039 was installed and exercised by that failed ordinary run; it did not establish ordinary acceptance.** Its other 24 cases and guard matrix were not executed, and that failure promoted no DATA resource to verified. The newer bounded pass above supersedes only the ordinary-path status.

The preceding `de848347` run remains a failure: core step 170 preserved settings and manager evidence v2 while players and primary-manager v1 accepted. Its receipt comparisons were negative (-164.709 ms and -194.661 ms); these establish those comparator failures, not measured clock skew or a sole cause. Its earlier source-bound evidence is retained below.

**Previous c3ca7b00 cleanup and authority.** The terminal receipt acknowledged child closure, schema cleanup, generated restricted-credential revocation and child deletion, all cleanup flags true, no unresolved resources and no production writes. Independent API evidence returned 404 for exact child `br-calm-sea-b7mfhbdt` and only parent `br-plain-bread-b7sgfdl8`. After UI revocation, the same temporary project-only key returned 401 at `18:24:53.878 UTC`; its exact ignored control file was removed and absence proved at `18:25:31 UTC`. An app shutdown interrupted the prior credential handoff sequence; clean-source, process/artifact and console “never used” checks confirmed the first preflight/run had not started. No attempt was duplicated. First parent connection was `2026-10-08T18:17:51.629Z`; terminal cleanup was acknowledged at `18:22:57.422Z`, inside the aggregate limits. The approved attempt is consumed. Billing cost was not measured; $1 was authorization, not a provider billing cap.

**The previous c3ca7b00 child version was not measured.** The reviewed optional probe required an observable case start; the existing reporter retained that signal only at run end, when teardown could overlap a probe. No extra connection or ad hoc query was attempted. Parent PostgreSQL 18.6 and the earlier run's child version do not qualify this child's version. Fresh preimplementation checks at 18:27–18:28 UTC agreed on clean local/GitHub main `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`, canonical repository, `apps/site`, production branch `main`, and Ready Vercel deployment `8C3YSnXRCbmPETftQgRtirfyck5e` at that exact SHA. No competing owner was observed in inspected evidence; no release is authorized.

**R039 repair and remaining guard qualification.** Additive R039 reuses the existing immutable reservations and dispatches. Only new rows receive unpredictable database nonces; old rows remain NULL and retries preserve original nonces/times. The maintained source obtains the exact full reservation group after all awaited reservations and before HTTP, attaches it to the original capture and freezes that capture. Writers carry that original evidence into receipt provenance/evidence hashes; provider content and configuration hashes remain unchanged. Missing, foreign, malformed or rebound capture context fails closed in the witnessed path. A process-local original-capture seal prevents accidental copies/retags and mutation during awaits; it is not cryptographic HTTP proof against a malicious collector or SQL writer. Recovery after process loss obtains a new capture rather than grafting a new witness onto old bytes.

SQL validates exact work, dispatch, nonce, group, mapping, period and fence. New receipt/checkpoint timing uses original DB admission/reservation and immutable receipt recording time. Raw application request start/completion/observation strings and their internal ordering remain intact. Static input validation precedes wrapper field stripping; new live validation follows the exact-receipt replay boundary, so an identical typed receipt can still replay after dispatch checkpoint completion while the original job/fence remains valid. Checkpoint replay itself retains its prior refusal/recovery behavior. Identity, league list, bootstrap and users use the same dispatch contract; immutable dispatch outcomes retain their actual validated acquisition. Omitted-context legacy/operator/cache paths retain their old timing checks; present-invalid evidence never downgrades. Existing app-derived fence deadlines and scheduling remain unchanged, so this addresses witnessed acquisition causality only while those guards are valid, not arbitrary clock offset.

**Previous non-SQL CI passed at 756ed0c.** [PR verification run 37858979001](https://github.com/clawmachinejed/league-one-audit/actions/runs/37858979001) passed dependencies, scope, lint, types and build; **5,991 unit tests across 285 files passed with zero failures/skips; public browser 121 passed/20 account-case skips; separate synthetic-account browser 20 passed with zero failures/skips**. Both jobs checked out merge `a87cbdd8d515ab9a330d5b3c5eb365fbc8357583`, whose parents are main `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f` and head `756ed0c81ecdd0c386acf182e0adf2af32a2859e`; merge and head share tree `66a57463d5610991562ccb4ff6e4cd9b092add65`. Saved `ci-37858979001-proof.json` SHA-256 is `008208672dbc73520929a5c074c8a76b566e9dc8d7399b1aece39293e55256dc`. This is non-SQL verification and does not override the separate live failure above.

**Previous non-SQL CI passed.** [PR verification run 37847547471](https://github.com/clawmachinejed/league-one-audit/actions/runs/37847547471) completed scope, dependencies, lint, generated types/TypeScript and build on hosted Node 24.21.0 / pnpm 11.19.0: **5,962 unit passes across 284 files, zero failures/skips; 121 public Chromium passes with 20 gated account-case skips; then all 20 separate synthetic-account browser cases passed**. Its actual checkout was PR merge `64d8d1f901d06e41d62c6374878da1a71efc78b7`, whose verified parents are main `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f` and reviewed head `91aec119930cc65d168f81e35a0bdc83fd7e583b`; the merge and head share tree `75a9818f086911b221616bf920653e0f7f1bf3cd`. Saved `ci-37847547471-verify.log` SHA-256 is `4f5464ef833ae7620a29c49b4a79bb7899ad36392bdbd5ef5830484d2a3d1879`. This workflow does not run the full SQL suite; the separate selected SQL results above remain bounded. Historical failures retain their original outcomes and unproved causes.

**Historical local verification failure.** The earlier complete-workflow attempt ran on clean `f5e28630be6ca3ef4bfe38aca424e3899d20e493`, pinned Node 24.19.0 / pnpm 11.19.0. Scope, dependencies, full lint, generated types/TypeScript and production build passed. Unit tests: **5,918 passed, zero failed, 1 existing environment-conditional skip across 283 files**; the compact log does not identify which conditional listener case skipped. Public Chromium: **107 passed, 13 failed, 21 skipped**. Twelve failures reached the unchanged 30-second case deadline; one reported `route.fetch ECONNRESET`. The skips are the 20 separately configured synthetic account cases and the existing manager-card-dependent cross-league My Team case. The command exited 1; synthetic account verification and the SQL gate were **not reached**, not passed. No SQL credential was present or database command run. This is **not a successful full workflow or release qualification**.

All 13 browser traces are retained and hashed. Sampled failed navigations received local JavaScript/CSS in 31–35 seconds; a contemporaneous independent host snapshot showed memory pressure, without proving causation. The corrected desktop heading comparison passed; its 390px counterpart timed out later during navigation. Runtime DATA code is identical between `e36bfe9ed4936089f82031e5856ca71eabf6c7b0` and this final executable checkpoint; only the browser measurement helper and its scope record changed. No inspected failure demonstrated a defect in the DATA repair. The later non-SQL CI above passed those checks; the earlier timing/connection failure causes remain unproved. At `17:52:02 UTC`, read-only checks observed no matching owned test process or port-3000 listener, and no local control file/API-key environment value. No automatic full rerun was made.

Earlier attempts remain preserved: `dfd041e` first stopped in a nested Node 20 launcher, then with Node 24 at a test-matrix typing error; `b132f67` reached 5,914 unit passes, four failures and one skip, exposing contract import cycles and missing witness responses in three storage fixtures. Types now have single definitions in dependency-free contracts with compatibility reexports; fixtures exercise the real witnessed store. `e36bfe9` passed unit/build checks but reached 119 browser passes, one empty-style reference failure and 21 skips. The original trace did not record node connection state. Author and independent reviewer reproduced the same empty-style mechanism by replacing a resolved heading before measurement; the default-bounded connected-heading correction preserves all exact style/one-pixel assertions and test timeout/retry/worker settings. The final actual-helper reproduction used zero network requests. Earlier focused totals overlap these complete-suite attempts and are not additive or final-source qualification.

**Actionable comparison evidence.** All 48 existing ordinary matchers now have unique fixed IDs and retain their original Vitest pass/fail authority. The first failure records its matcher, synchronous group, occurrence and bounded expected/actual projections. Fixed field names expose settings values, missing/null states, array lengths/order and precise timestamps; per-comparison aliases preserve identity/hash equality across both operands without raw values. Subset matchers project the expected contract fields so unrelated data cannot exhaust their budget. Unknown fields, accessors and unsupported or oversized values are explicitly redacted; depth, node, array and byte truncation is explicit. No raw exception message, stack or exception-supplied operands are serialized. Earlier observed failures retain precedence.

Actual-child version metadata still comes from the existing initial restricted-role SELECT, with the unchanged strict role check and descriptor-only version validation. No added SQL query, connection, provider call, pipeline or supervisor is involved. Independent AST review confirms the same 48 matcher operations/expected operands, nine queries, 24 awaits, five stages/six fixture calls, request/deadline bounds and unchanged nonselected cases. Only the two independently reproduced Date conversions change an assertion operand; the exact expected timestamps are unchanged. The broader post-reader contract audit found no other proven oracle mismatch or runtime cause.

Focused local verification passed **330 unit tests across seven files, zero failures or skips**, plus TypeScript, changed-file lint, scope and whitespace checks. Real failed assertions and actual artifact saves cover settings, identities, all leaves of realistic full receipt/provenance/capture/manager operands, precise timestamps, hostile inputs, truncation and first-failure precedence. The timestamp regression checks both ordinary call sites and the installed driver parser. Those checks alone qualify local diagnostic/test behavior; the separate actual PostgreSQL result is recorded above. The selected source digest is `afb857bf98a17a82196433f3f684491e7671df6a1cdc5b96432c95efb2444f99`. The earlier 19f550e1 group-only diagnostic checkpoint passed 318 tests; the current evidence supersedes its diagnostic coverage claim. Historical failed SQL and complete-workflow/browser results remain failures; no additional full browser run was made for this local test change.

The other existing cases retain authored ±30-second capture-clock controls, invalid/mixed context negatives, replay/history/fence/lock and role oracles. Their SQL guard matrix remains unexecuted. The actual ordinary pass qualifies only that path, not the complete migration or backend.

Each database execution must bind a concrete reviewed source and pass the existing fresh guarded test-parent preflight. Standing user approval covers continued DannyPak qualification within the existing isolated test scope, protected key and budget; it does not authorize production migration, activation, merge or release. The bounded live League Two core profile passed once at e85c798 after two separately retained failed attempts. Shared fixture-based refresh/recovery passed once at 91aec119. The first DannyPak live run at 756ed0c failed during readback; its reporting correction is described above. The other 23 cases in the 25-case ordinary inventory, full guard matrix and release qualification remain open. No new architecture, provider pipeline or runner has been introduced.

Local source repair: implemented; ordinary fixture persistence/readback passed on 2f19b7e9, bounded registered-operator live core on e85c798, and shared fixture-based refresh/recovery on 91aec119. Non-SQL PR verification passed. Broader PostgreSQL/backend qualification and release readiness remain incomplete. Branch publication: draft PR288; hosted preview: f20eab3 Ready and inspected; the complete DannyPak live journey passed at f20eab3; merge: none. Production: unchanged.

| Current local verification evidence (under `test-results/data-backend/`) | SHA-256 |
| --- | --- |
| `reproduce-ordinary-timestamp-19f550e1.json` | `8633bdf0d6ea86af3fb5f0941adb374b5f69d8ca70a78dd63089ec796095eb4f` |
| `independent-discovery-timestamp-oracle-19f550e1.json` | `471875ec200078d0a85503342f6fbed7ffdbfe818108d7ab2c8c83544b4a7f2e` |
| `comparison-diagnostics-final-targeted.log` | `12b59abf9e4772781189235833f39b1890fc44e3b824769d43e75d7040fa18c8` |
| `comparison-diagnostics-final-types.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `comparison-diagnostics-final-lint.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `comparison-diagnostics-final-scope.log` | `de336cf62b9ad796ad452f64d73d32e9acffa121f97219c39805c35b6ecc282b` |
| `reproduce-assertion-location-c3ca7b00.json` | `661acfb0c851f565964dfe4119e7ab2bc8be5fbae0a2e2acfbbf0930d274ee76` |
| `assertion-diagnostics-final-targeted.log` | `aebe6e5f7c1f59d969cd76240405accd5f58a7773d5730c5a764fe4f8b1e0e5c` |
| `assertion-diagnostics-final-types.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `assertion-diagnostics-final-lint.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `assertion-diagnostics-scope.log` | `d0aab918aebfd9ad9688813d0525f353e5386cd53dec2aec32ecca16f6a5d972` |
| `capture-witness-full-f5e2863.log` (exit 1) | `ed1f1065e236545f086bbcd3fb7d151a91acdf90a021130a37a93709b5e58d39` |
| `browser-failures-f5e2863/classification-final.json` (includes all 13 artifact inventories) | `d18d397fa2a33128a1baa29c55ebb8045c0baea1ed0088ca30e49931ad5452be` |
| `owned-process-closure-f5e2863.json` | `e72a5fc40d9a4015e4ef2658bfd977c50c7eb861f4e98a2104b5f8119ae806fd` |
| `capture-witness-full-e36bfe9.log` (exit 1) | `6e0f7c65431ed9236f4a20bad3caccc5b0f7af3cccdaed0c9ed8ed387dfcbaa5` |
| `capture-witness-full-b132f67.log` (exit 1) | `71795a7f6aa9092ec62ef17699a92d027167820983fe264eeda9ebd870098d4c` |
| `capture-witness-full-dfd041e-runtime24.log` (exit 2) | `4e573033fe3df1a2d3b8215767b967bb96bb2aaafa8b576e80c1a9190007aeff` |
| `capture-witness-full-dfd041e.log` (exit 1) | `f673eb86abe748e002473fa66c8e6cb32df7023f18b3573c3b7c2f36e1855b7e` |
| `intro-detachment-before.json` / `intro-detachment-after-final.json` | `1a560dfcbf285ad3ad3bcb9003f276821f2c3ed6524d0baa8008de666a5fbe1e` / `58b858d8b9208c9cbf7dc2604131892b84bbe6f756dc46f07d8f87f9eaf1abf6` |

| Latest failed 27ccafed live attempt and local reproductions | SHA-256 |
| --- | --- |
| `test-results/data-backend/approved-parent-preflight-27ccafed.json` | `f45c785e5453b1984ba9b1e51268a43701b1693fd690c4824084c2705700f2d3` |
| `test-results/data-backend/approved-sql-27ccafed-20261008.log` | `6174b3df3d4530548ed87e3f8e4e921d440044000b0448e1de4e5acd486bddea` |
| `test-results/data-backend/diagnostic-absence-27ccafed-replacement.json` | `24c6c1723d49df6e042f531c08fde2779c287a9bb1d93f6b03430ea080be9c4b` |
| `test-results/data-backend/diagnostic-revocation-27ccafed-replacement.json` | `deb484bdf87184b04204853b3232d8bdc538fcd6032f35ae2c8d938c2ebbca78` |
| `test-results/data-backend/contained-control-cleanup-27ccafed.json` | `f62e74b851acb59ca432146e365ef25102a255aebc528069caab25d99f1bd637` |
| `test-results/integration/run-1791491141707-77a6a42f-58cd-4d84-8935-8a01a65d84af-0012.json` | `35c4b684956fb5f4435d9af2f8a25bfb420595052649b8ef0993f6731fc2afec` |
| `test-results/integration/artifacts/run-JIuigo/live-league-two-captures.json` | `f12ae7284e2b825656fbc181b24589cd338d351be23a32a1fc263bc2e2e801a9` |
| `test-results/integration/artifacts/run-JIuigo/live-league-two-diagnostics.json` | `668e99a2d7eb94801caafbf496a8e409ae1a789da9b6c3b1ee0902c938a3e388` |
| `test-results/integration/artifacts/run-JIuigo/qualification-report.json` | `36c5223f56a638b3df3f86f31f04f859317df7e6145957154485e48da699be8b` |
| `test-results/integration/artifacts/run-JIuigo/qualification-cleanup.json` | `47090aa3089ac561764dee98ce0cf922998cc2d5c86ea2c7605062895e516395` |
| `test-results/data-backend/control-cleanup-27ccafed.json` | `ce2499a9873dc1b1fcf543ef026541aaa0671a5e23dfb27b05e05eadccaa8773` |
| `test-results/data-backend/reproduce-live-enrollment-27ccafed.json` | `399884d3c4dbf2a42c5f5be44ca97a0c29504722816db66e8ca35901bbb9d004` |
| `test-results/data-backend/reproduce-live-official-profile-27ccafed.json` | `9b9ed25dd272cabfc8e822e4cfb226428e4d93a88118aabd63cd761985fe1c02` |

| Latest actual 2f19b7e9 ordinary pass evidence (repository-relative) | SHA-256 |
| --- | --- |
| `test-results/data-backend/approved-parent-preflight-2f19b7e9-start.json` | `0197e0d86a81ade3ce779d066e572dcf8cfc5b2c8e693d72ce8a30fabcaf63cc` |
| `test-results/data-backend/approved-parent-preflight-2f19b7e9.json` | `fc68173e9c71e379037e5839f9cf9a18f4653dc01f26c3fa285fce798e0c82f4` |
| `test-results/data-backend/approved-sql-2f19b7e9-20261008.log` | `b6ee845636d4a789fd895a7ebb4c0f02aac95449da62b8f7e39e110e6e2c4ac7` |
| `test-results/integration/run-1791487211746-0c8a75fb-30cd-47e0-9e0a-8f0e5542c7ae-0012.json` | `b1c59c2560ad13be23ddbc4050e779de216f87f900d4152c6f003e2c0a5fed0f` |
| `test-results/integration/artifacts/run-uZiphc/public-data-ingestion-diagnostics.json` | `3748382f276b476825eb727ad81305296cc3914002fb66768bb7d48db7d20812` |
| `test-results/integration/artifacts/run-uZiphc/qualification-report.json` | `8cf75678baf06a8fbf97c2b3422657541205082f394c79e2144ecf1d33954a7f` |
| `test-results/integration/artifacts/run-uZiphc/qualification-cleanup.json` | `ba78a5d6f2bcffbc58d917c42611ab57b87dfc0180b76fd5a0af5f6b3e4c0ba1` |
| `test-results/data-backend/diagnostic-absence-2f19b7e9.json` | `37d322ab5ef338c6e7fcf6f19bef62135670557d0b9d85435a4e90d424023ac4` |
| `test-results/data-backend/diagnostic-revocation-2f19b7e9.json` | `27d8022ad3679fdc3b11a9d286cc5cc11a971c0bb49c25d908500d4a499beb63` |
| `test-results/data-backend/control-cleanup-2f19b7e9.json` | `40efde5605e30d635399344b9fa0d08539b60afab2570a0e7ccba1c51e20b660` |

| Previous failed c3ca7b00 run evidence (repository-relative) | SHA-256 |
| --- | --- |
| `test-results/data-backend/approved-sql-c3ca7b00-20261008.log` | `368b0dc1dd49ffb7169a60a952ed81721571354e67653c663fadc9af76fb489a` |
| `test-results/integration/run-1791483499195-b3eb5cb6-7263-4a93-9cd4-467ee8165846-0012.json` | `8c93b6e7cd5083ae44e07cc453811fe1eed5c9a6b25292fdc691693993f77687` |
| `test-results/integration/artifacts/run-JUX5Sn/public-data-ingestion-diagnostics.json` | `543f360c07760e83d9c62c0fc3bbc9d0d37e0460cd7e17a808bd97a2d6d6e7b2` |
| `test-results/integration/artifacts/run-JUX5Sn/qualification-report.json` | `fdaaadf7dc53f202c0040f60078af69846a8cbe3b0d154e7bfe9771015b28d41` |
| `test-results/integration/artifacts/run-JUX5Sn/qualification-cleanup.json` | `47a18fc43dd8e02eae41bc4c6a8aa446500b8d5447c43800a48f88a9fefa2096` |
| `test-results/data-backend/diagnostic-absence-c3ca7b00.json` | `ba274f52a60bb0dafe34ea1ac4f297c00afb004c0bdabe35a910fbc846742226` |
| `test-results/data-backend/diagnostic-revocation-c3ca7b00.json` | `b3bba078de39cdd8799587335bc925c84cc13bf2da066e9c7d8f04c7c19c33c1` |
| `test-results/data-backend/control-cleanup-c3ca7b00.json` | `0ba8b02b206d95f7eaab07bb918b945355a18ddb8ee8cb00a33445ee2d3b0236` |

| Earlier de848347 run evidence (repository-relative) | SHA-256 |
| --- | --- |
| `test-results/integration/run-1791475997821-d33b9d1c-1ab2-46fb-89e3-e0d8726349a6-0012.json` | `dbd20e015a32cdc4329fbb527fb71bc5d72bd3d694f4bed0390fba2066d3b649` |
| `test-results/integration/artifacts/run-Igt4lD/qualification-report.json` | `ce726a03df0d2d336385a810f805a014e14a0ea6cf8339ca3c464e60ad7a8908` |
| `test-results/integration/artifacts/run-Igt4lD/qualification-cleanup.json` | `9911d292bc41fd13076290d67f14daf21ba4885c31e0d68fe9ad4d49d8fe0106` |
| `test-results/integration/artifacts/run-Igt4lD/public-data-ingestion-diagnostics.json` | `38e14361647c421a4180690c2a744216030eb93acf298fb9b2fb1ff268090d69` |
| `test-results/data-backend/diagnostic-version-corrected-de848347.json` | `6e3680f818000084c15e3ee271532236a38cbbc51ca2eaa62747013852250e84` |
| `test-results/data-backend/diagnostic-absence-de848347.json` | `c6d993d1145aaf3f642bf141228c1cd10258bd86eabeac3a7c9e4f99e8ea2fba` |
| `test-results/data-backend/diagnostic-revocation-de848347.json` | `4b648cda7e67817b662fdfd2050a6c3061f966dc0217f2c083255e1ca574b4a3` |
| `test-results/data-backend/control-cleanup-de848347.json` | `f1117bc3368e0bef7bdfef3235aa430da3eb5748fb80ca7415291bf42718c126` |

## Historical earlier October 8 diagnostic checkpoint

The following `11376e19` record is preserved history, including its consumed authorization and then-current next steps. It is superseded only for current status by the section above.

**Candidate and first milestone.** Work continues on the sole implementation branch `codex/data-backend-recovery`, in `C:/Users/Robert Finchum/.codex/worktrees/data-backend-recovery/LeagueOneEngineering`. The last actual SQL source is `11376e19d4f087eaa494ce1fe0b0930df4656824`, executable-equivalent to the independently reviewed `afebc862fadce3dbaacb52a979c0298aee496845`. The immediate milestone is one ordinary fixture → existing Sleeper adapter/intake → actual restricted PostgreSQL → stored-reader proof, then a bounded live username/league journey through the same path. Recurrence/recovery, other resources and the full backend definition of done remain open. No production acceptance predicate has been changed on a clock hypothesis.

**Fresh source/service check.** Before this increment, clean primary main, GitHub main and Ready Vercel production agreed at `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`. Project `league_one_fantasy` remained bound to `clawmachinejed/league-one-audit`, production branch `main`, root `apps/site`, deployment `8C3YSnXRCbmPETftQgRtirfyck5e`, domain `www.league1fantasy.com`. Only unchanged older draft PRs 286/287 were published. No competing owner was observed in inspected worktree, branch, PR, deployment and chat evidence; database leases were not inspected in that check. The later authorized test-parent preflight separately verified its exact identity, inventory, roles and quiescence.

**Actual diagnostic result.** The explicitly approved October 8 run `331ff561-8f20-44fa-8a49-248fe472cdc7` used exact `11376e19`, closed `data-core-ingestion-v1`, one fresh child, fixed 0.25 CU and the unchanged 30-minute work/40-minute lifecycle. It finished in 215,620 ms: **25 collected, 1 executed failure, 0 passed, 24 filtered**. Settings were preserved with `complete_league_identity_unproved`; manager evidence v2 was preserved with `complete_manager_evidence_population_unproved`; held players and primary-manager v1 were accepted. The coordinator correctly withheld complete core; directory and final stored-reader assertions were not reached. Both bounded receipt-comparison reads failed with `unexpected`/null SQLSTATE, so this run proves no request-start/reservation comparison and no clock skew. The two earlier failed SQL attempts remain failures, not superseded passes.

**Cleanup and deviations.** The acknowledged terminal receipt confirms child closure, schema cleanup, generated restricted-credential revocation and exact-child deletion, with no unresolved resources or production writes. Independent API evidence returned 404 for `br-sparkling-bonus-b7jkhui2` and found only the intended parent. The same temporary project-only API key returned 401 after UI revocation; its ignored local control file was removed and absence checked. An unused earlier key was revoked after the local browser handoff rejected its null Origin; a corrected same-origin handoff and replacement key served this single database attempt. A first read-only version probe used the wrong PostgreSQL comment lookup; its failure is preserved. The independently reviewed correction reused the harness's `shobj_description` lookup and verified the actual child as **PostgreSQL 18.6 (4e955f5)**, with read-only session/sentinel identity and connection closure. These helper corrections were not additional ingestion attempts. The $1 authorization budget was not a provider billing cap; invoice cost was not measured. The one paid-run authorization is consumed.

**Confirmed local correction.** PostgreSQL 18.6 returns canonical `1s` from `set_config('statement_timeout','1000',true)`; the diagnostic validator incorrectly required its input literal `1000`. Independent source inspection and an executed network-blocked Node 24/installed-driver red reproduction confirmed the defect. It necessarily rejects a successful canonical response, but the failed run did not retain enough error detail to prove this was its only diagnostic error. The correction accepts only canonical `1s`, keeps the fixed SQL/read-only transaction/deadlines unchanged, and distinguishes owned `transaction` versus `result-validation` failures using fixed redacted tags. Transaction includes driver/network/query/parse failures; it does not identify parsing separately. The original core failure still takes precedence. Source tests verify restored fixture transport, fractional/zero receipt comparisons, malformed results, hostile errors and tag spoofing. This is a diagnostic correction, not a repaired or qualified ordinary import. Frozen review and check evidence bind the resulting commit separately; historical afeb full-workflow totals are not rerun totals for this change.

**Next decision.** Another exact-SHA ordinary diagnostic requires fresh one-run credential/cost authorization and reviewed source. Keep the existing project/parent, 0.25 CU, one child, unchanged 30/40-minute limits, full cleanup, no retry and $1 approval envelope. For each preserved settings/v2 receipt independently: negative difference plus `false` proves that exact comparator failed, not measured skew or a sole cause; zero or positive difference plus `true` excludes that comparator for that receipt; missing/null/invalid/error evidence makes no timing conclusion. A clamped difference preserves sign, not exact magnitude. Repair only a demonstrated underlying cause, then qualify ordinary persistence/readback and bounded live Sleeper ingestion. No live SQL profile currently exists; its later bounded case must extend this harness and existing capture/writer/reader path.

**Local correction checks.** Node 24.19.0 / pnpm 11.19.0 used the frozen dependency lock. The five focused harness/diagnostics/profile/supervisor test files passed **229 tests, zero failures and zero skips**. Generated route types, TypeScript, lint of the four changed TypeScript files, the fixed-baseline scope check and whitespace check passed. Logs and exit records are retained under `test-results/data-backend/normalized-timeout-*`. The full verification workflow, browser checks and hosted preview were not repeated for this diagnostic-only increment; the complete workflow remains mandatory before merge. Independent review binds the frozen commit separately.

Local diagnostic repair: source/test work, pending actual corrected receipt qualification. Branch publication: none. Hosted preview: none. Merge: none. Production: unchanged. DATA/backend completion: incomplete. Release readiness: withheld. No second SQL attempt is authorized by this record.

| October 8 retained local evidence (repository-relative) | SHA-256 |
| --- | --- |
| `test-results/integration/run-1791470730454-b7514e08-89de-41ee-9ebd-35b8115f66f7-0012.json` | `9fe925b45557379201c1d5e8fe140cbf26c3f370a1603a2fe9d37ed829cb110b` |
| `test-results/integration/artifacts/run-iswFTI/qualification-report.json` | `08ee5adbf41b2bdc793f4b959767dc055e91ba69342563cd227e60d206f7b8ae` |
| `test-results/integration/artifacts/run-iswFTI/qualification-cleanup.json` | `4bc379f252f5184745bcd3a97db6dbe750617d3f5850c4e9e6f01ad6ff2bf4cd` |
| `test-results/integration/artifacts/run-iswFTI/public-data-ingestion-diagnostics.json` | `c5b273b40423a63b62a9ed090bf8ce23465c4e5f50a4e13429d0b517e58bd07d` |
| `test-results/data-backend/diagnostic-version-corrected-11376e19.json` | `9a67485731b3860e53258d401f0a3118221c93e0aa3737094e27451bea828347` |
| `test-results/data-backend/diagnostic-absence-11376e19.json` | `1cc92977c1b421e8e51303346d16b910bb00dd2c9612f8bda2a733bfb0edd1e0` |
| `test-results/data-backend/diagnostic-revocation-11376e19.json` | `0c9ffb219631293375b8bcf086775e60bd13c2ddcb4b1987e67611af6a30999b` |
| `test-results/data-backend/approved-sql-11376e19-20261008.log` | `f038d3f93e58230e61d276c7eadded72edd5f831ef324306ac5c771df2cfe176` |

## Historical record before October 8, 2026

Historical continuation: the approved ordinary `data-core-ingestion-v1` run at `e44b24c00bd0247a1961db7b5c9eca27223995e7` **failed** (25 collected, 1 executed failure, 0 passes, 24 filtered). The disposable child was deleted and database/API credentials revoked, independently verified. Its one-run authorization is consumed; no retry is authorized. The settings-preservation boundary is known, but its underlying database cause remains unproved because the diagnostic allowlist lost fixed rejection reasons. The integration-only correction and full evidence are recorded in [the current correction record](data-backend-diagnostic-correction.md). Prior passing non-SQL checks and the earlier failed refresh run remain historical. No DATA resource has been promoted to fully verified; the backend remains incomplete. The reason/receipt diagnostic correction at afebc862fadce3dbaacb52a979c0298aee496845 passed independent Astra Ultra architecture/security source review and the complete non-SQL workflow: 5,891 unit passes / 1 skip, 120 public-browser passes / 21 skips, and 20 synthetic-browser passes / 0 skips. SQL was explicitly skipped. These results qualify the local correction, not the failed import.

This ledger follows [the current data-only scope](data-backend-scope.md). It records source-bound evidence, not production acceptance. The [resource path and coverage record](data-backend-ingestion.md) remains the implementation map. The older account/access 108-obligation ledger is preserved in the separate PR287 lineage at `682f6bbf8158e1c3494d85f31cd0e83856536ebe`: 3 implemented-and-verified, 21 implemented-but-unverified, 84 pending. Those totals are historical/deferred, not the denominator for this DATA outcome.

## Source and service baseline

The DATA branch is `codex/data-backend-ingestion`, based directly on canonical `clawmachinejed/league-one-audit` main `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`. Rechecks on October 6, 2026 found local main, GitHub main and the Vercel production commit equal to that full SHA. The primary checkout was clean. Vercel project `league_one_fantasy`, team `robert-finchums-projects`, remained bound to the canonical repository, production branch `main`, root `apps/site`, ready deployment `8C3YSnXRCbmPETftQgRtirfyck5e`, and `www.league1fantasy.com`.

Draft PR287 remained at `682f6bbf8158e1c3494d85f31cd0e83856536ebe`, based on draft planning PR286 at `cef7f49243509da738ff9efc950538b5bd2ae3da`. DATA changes are local and have not been published to that PR. The account worktree's 51 application changes remain preserved. Its 034-037 migrations are not installed or imported into this clean DATA lineage. The two lineages must not be combined by merging migration filenames or overwriting preserved work. No competing release owner was observed in the inspected worktree, PR and deployment evidence; database leases were not inspected.

The manager-evidence increment was frozen at `15254c2c8d91793d255fb1a86bf7a58ef05be893`; the reviewed reader and fixture corrections were frozen at `f904b9ac805902180dd5db664a749c70d459ca18` in the isolated `data-backend-next` checkout. Recurring-refresh source is developed separately from that frozen verification tree. These local checkpoints are not a published PR, installed migration or production activation.

## Executed evidence by frozen source

| Frozen source | Executed evidence | Result and limit |
| --- | --- | --- |
| `b14834b137f6739216644d22e9b9294ce5bb7736` | Corrected Node 24 local non-SQL verification | Dependencies/lint/types passed; unit 5,530 passed, 1 failed, 1 skipped. Mandatory architecture failure found three facade imports. Build/browser not reached. A preceding Node 20 invocation failed at startup and supplies no verification credit. SQL unexecuted. |
| `5852d1677918d2140fef0abaaf7e341be6dea536` | Node 24 complete repository verification, command exit 0 | Dependencies, lint, types and build passed. Unit: 5,571 passed, 0 failed, 1 skipped. Public browser: 120 passed, 0 failed, 21 skipped. Separate synthetic-account browser regression: 20 passed, 0 failed, 0 skipped. SQL explicitly skipped/unexecuted; exit 0 is not database qualification. |
| `5852d1677918d2140fef0abaaf7e341be6dea536` | Independent GPT-6 Astra Ultra architecture and database/security reviews | Request changes: five unique findings listed below. Passing local verification did not establish acceptance. Reviewer targeted test totals overlap the full workflow and are not added to it. |
| `925eadf1e3b0443f29f4f66b2f28b5696cfb8062` | Independent Astra Ultra lifecycle-only closure review using a frozen Git archive with network entrypoints blocked | 317 passed, 0 failed, 0 skipped across 9 lifecycle files; 11 separate in-memory adversarial replay scenarios passed. The P1 late-dispatch and P2 final-receipt findings are closed at source/offline level only. The three intake findings remain open for the next full SHA. No SQL, credentials, provider/API calls or run/release approval. Preliminary launcher failures occurred before test execution and carry no test credit. |
| `23f17c6f504d382bd29ea6de08ebaaf56b697f1f` | First Node 24 complete repository workflow, exit 1 | Dependencies/lint/types/build passed. Unit: 5,586 passed, 0 failed, 1 skipped. Public browser: 120 passed, 1 failed, 20 skipped. `matchup-win-chance.spec.ts:260` encountered `route.fetch: read ECONNRESET` before fixture setup completed. Synthetic-account and SQL phases not reached; SQL unexecuted. |
| `23f17c6f504d382bd29ea6de08ebaaf56b697f1f` | Unchanged narrow browser reproduction, one worker, no automatic retry | The same parameterized case passed for League One, League Two and Dynasty: 3 passed, 0 failed, 0 skipped. This does not erase the full-run failure or establish its cause. |
| `23f17c6f504d382bd29ea6de08ebaaf56b697f1f` | Second complete repository workflow, original 10 browser workers, exit 1 | Dependencies/lint/types/build passed. Unit: 5,586 passed, 0 failed, 1 skipped. Public browser: 119 passed, 1 failed, 21 skipped. `my-fantasy.spec.ts:536` failed initial fixture setup with the expected server heading absent and the loading view still visible. Synthetic-account and SQL phases not reached. Both failures remain recorded; different failures do not establish a full pass. |
| `23f17c6f504d382bd29ea6de08ebaaf56b697f1f` | Independent Astra Ultra architecture/adapter and database/security reviews | All five 5852 findings closed at source/offline level; no new confirmed source defect. Architecture: 251 tests in 7 files plus 22 separate replay scenarios. Security: 531 tests in 24 files plus 29 separate Boolean predicate-model cases, types/lint/scope/diff checks. Neither replay scenarios nor predicate models are PostgreSQL. Counts overlap author/full-workflow evidence and must not be added together. No database qualification, whole-backend or release approval. |
| `15254c2c8d91793d255fb1a86bf7a58ef05be893` | Independent Astra Ultra R035 reviews | Author 583 tests/23 files passed; database/security independently reproduced the same 583 with network entrypoints blocked, types/lint/scope/diff passed. Architecture independently ran 243 tests/6 files, no skips. One P3 reader validation-order regression was reproduced; no other confirmed source defect. These selections overlap and are not additive. All SQL remained unexecuted. |
| `f904b9ac805902180dd5db664a749c70d459ca18` | Independent correction review | Reader validation now precedes scope construction; security independently ran 106 reader tests including 12 malformed-mapping boundaries, no failures/skips. The My Fantasy fixture preserves the exact fake date while allowing startup timers before pausing. Captured old-build delayed-JavaScript replays established causality and zero added timer ticks; they are not fresh-build product or provider qualification. Both prior 23f failures remain preserved. |
| `f904b9ac805902180dd5db664a749c70d459ca18` | Node 24 full repository workflow on clean frozen source, exit 0 | Dependencies/lint/types/build passed. Unit: 5,647 passed, 0 failed, 1 skipped across 277 files. Public browser: 121 passed, 0 failed, 20 synthetic-account cases skipped. Separate synthetic-account browser: 20 passed, 0 failed, 0 skipped. SQL explicitly SKIPPED/UNVERIFIED; no database command ran. Full success does not establish the cause of the earlier ECONNRESET. |
| `21d55cb1768cf97410eb9a3fd775060bfe9a9807` | First full local workflow, exit 1 | Dependencies/lint/types passed. Unit: 5,718 passed, 1 failed, 1 skipped across 279 files. The existing browser-launcher free-port lifecycle case did not reach its build trap within the 20-second helper limit. Build, browser and synthetic phases were not reached; SQL unexecuted. |
| `21d55cb1768cf97410eb9a3fd775060bfe9a9807` | Unchanged single-case reproduction | 1 passed, 24 filtered skips; test 857 ms, total 1.11 seconds. No source, timeout or assertion change. This does not explain the original full-run failure. |
| `21d55cb1768cf97410eb9a3fd775060bfe9a9807` | Unchanged second full local workflow, exit 0 | Dependencies/lint/types/build passed. Unit: 5,719 passed, 0 failed, 1 skipped across 279 files. Public browser: 120 passed, 0 failed, 21 skipped with original 10 workers. Separate synthetic-account browser: 20 passed, 0 failed, 0 skipped with 1 worker. SQL explicitly SKIPPED/UNVERIFIED; no database command ran. |
| `21d55cb1768cf97410eb9a3fd775060bfe9a9807` | Independent Astra Ultra architecture and database/security review | Source acceptance withheld for two P2 findings: selected-target timeout starvation and unbounded lazy-import waiting. Security independently ran 627 tests/26 files; architecture ran 128/5 files. Both selections overlap full/author checks and are not additive. Additional authored race and history-trigger proofs were required. All SQL remains unexecuted. |

The repository workflow is local and non-SQL, not globally network-blocked: existing public-page fallbacks may read public Sleeper data. Independent targeted reviews used network-blocked frozen snapshots. Neither public-browser checks nor local manual inspection proves the new DATA source-to-database path. The single skipped unit case depends on available host network interfaces. Twenty public-browser skips are synthetic-account cases; the conditional My Team cross-league choice case also skipped when required manager cards were absent. At 23f both full attempts stopped before the separate synthetic-account phase. Synthetic-account checks preserve existing consumers; they do not implement new accounts. Manual built-in-browser inspection at 23f and at clean f904 showed preserved League One and League Two Matchups presentation and separate teams/scoped navigation. The normal f904 preview build was nmVGgYisUVkN0hJJuTxCr on local port3248; no database was configured, and the temporary server was stopped afterward. An initial preview launcher failed in the Node20 corepack shim before build and was corrected with the verified Node24/pnpm wrapper. The hosted PR287 preview at its older SHA is not DATA evidence. At that earlier checkpoint, no DATA hosted preview had been published; the current e85c798 preview is recorded above.

Ignored local artifacts retain raw output rather than inflate source claims:

- `test-results/data-backend/full-verify-b14834b-node24.log`, SHA-256 `f47089dec874ddd1d2e4c8b2832ef3b904a94fdcfbba7ba8bf701520c513bb2a`.
- `test-results/data-backend/full-verify-5852d167.log`, SHA-256 `6eda76588f96de80f811897e9a3488b24a966e306956b599e2a8077841a99bde`.
- `test-results/data-backend/verification-5852d167.json` and `review-5852d167.json` preserve exact test categories and both reviews, including the architecture amendment.

- `test-results/data-backend/full-verify-23f17c6f.log`, SHA-256 `95ab646e9464337d3f1fe389d88da7660c3cb519a7fad81562f3ce6b31b83ed2`.
- `test-results/data-backend/full-verify-23f17c6f-rerun.log`, SHA-256 `61d4bdc2422c812814b3dfadf8d337278dfc089283d8c6dcd6f04bacf8128adc`.
- `test-results/data-backend/browser-win-chance-reproduction-23f17c6f.log`, `review-23f17c6f.json`, and both `failure-23f17c6f-*` artifact directories preserve narrow reproduction, independent reviews and original failures.

- `test-results/data-backend/full-verify-f904b9ac.log`, SHA-256 `4a719666efc4632d7aa2dc81dc6b919b30b67dcc108f8fd140fcdf2948d661bd` in `data-backend-next/LeagueOneEngineering`. Public build `lfXbnhjs9MTcx_IpUh3GP`, run `5aac5540-62ac-486c-bd9e-39bda0e2de3b`; separate synthetic build `za5pb2LTdi-tfCiwJxnwh`, run `7478dbe5-5274-4e3b-a99e-b48e3bfaebc9`.
- `test-results/data-backend/security-review-15254c2c.json` and `architecture-review-15254c2c.json` in `data-manager-evidence/LeagueOneEngineering` preserve independent source verdicts. The author's initial 13-case My Fantasy pass was retained only in tool output on dirty 15254c2 plus the exact subsequently committed four-file delta; it is development evidence, not an independently inspected saved stdout log.

R036 development evidence before freeze: the author reported 214 targeted tests across 11 files with no skips, plus TypeScript, owned ESLint, scope and diff checks passing. These ran on the working candidate above f904 and were retained in tool output, not a separate stdout artifact. They are development evidence pending root frozen-SHA reproduction and independent review. The candidate also corrects two root-review observations before freeze: default/force calls now avoid importing the optional recurrence runtime, and pre-selection failures produce one fixed-field warning without raw errors or request payloads. No new resource is promoted to actual SQL qualification.

## Open findings at the recurring-refresh checkpoint

At frozen `21d55cb1768cf97410eb9a3fd775060bfe9a9807`, passing full local verification does not establish source acceptance:

- P2 selected-target timeout starvation: the actual worker suppresses selection-failure recording when its outer signal aborts, while SQL selection continues choosing the same oldest unserved target. The independent offline six-attempt reproduction selected A six times with zero failure records and no healthy B request. An ordinary-error control allowed B three requests. The engineer reproduced the same behavior before editing. Correction must bound actual pre-admission storage early enough for same-owner reconciliation within the original fence, without charging an unselected/global timeout or inventing admission credit.
- P2 unbounded optional module load: independent execution of the frozen dispatcher/runtime stayed pending at +22,001 and +40,000 ms while the loader was delayed; maintenance had not run. The actual runtime refused late database work after loading. Correction must bound loading and prevent late startup, while still awaiting a worker that actually started.
- Authored SQL coverage gaps: sequential CAS/pause/expiry checks do not prove race ordering; runtime DELETE denial does not exercise immutable-history triggers. Add observed concurrent barriers/waits and rollback-protected otherwise-permitted mutation negatives against configuration, cycle, outcome and selection-failure history. These are missing authored proofs, not observed PostgreSQL failures.

Corrections are isolated in `data-refresh-recovery`; the original `data-refresh-cycles` checkout remains clean and frozen. The separately started official-only work was preserved at d65f658a8ecbdefafd78b948fb29ad2b0ca4ac2a, then resumed after the recovery correction was cherry-picked at 2c2d9ccfdf42c13584db170429ca57f0663fbc54. This is an unfinished candidate, not a passing checkpoint. No database qualification, activation, merge or release is approved.

Saved in the frozen refresh checkout: `test-results/data-backend/full-verify-21d55cb1.log` (SHA-256 `d32805f6737d9d46f2cfee2e1e24404829bdad428a56dc90f2e1620f9edf4d52`), `launcher-reproduction-21d55cb1.log`, `failed-verification-21d55cb1.json`, `full-verify-21d55cb1-rerun.log` (SHA-256 `eeb0bbd913dbf7122df33565dfd4e5fc87fdb78d9ecd0a4a746e261271043ab6`) and `verification-21d55cb1.json`. The successful public build/run were `habZ6vsVVZSaIe0P9De1H` / `661ef4eb-6caf-4554-97ea-71b675618e75`; synthetic build/run were `2ex1Muambo9JPNmEKpT38` / `c90b344c-09fa-4de5-b6f6-ffbbf79e9a05`. Reviewers inspected this root execution; they did not independently rerun the full workflow.

## Findings at 5852 and required closure evidence

| Finding and affected path | Consequence | Required closure |
| --- | --- | --- |
| P1: ownership verification yields before cleanup DDL dispatch (`integration/integration-database-ownership.ts`) | Cleanup can begin a previously unsent destructive statement after its phase expires. Outer harness cancellation checks alone do not close the inner await. | Reproduce through actual ownership + harness modules with only the driver mocked; guard immediately at dispatch, preserve independently bounded own-session rollback/release, and verify fresh phases can reuse a healthy lease. Actual SQL cancellation remains unproved. |
| P2: failed acknowledgment of a final passed receipt (`scripts/run-disposable-integration.ts`) | A complete passed JSON file may exist after final-write failure, although command exit remains 1. A scanner must not accept an orphan snapshot as qualification. | Retain finalization context, append a later failed snapshot inside the original lifecycle reserve where possible, and require exit 0 plus the referenced acknowledged receipt for acceptance. Reproduce full bytes persisted followed by both a hang and a rejection. |
| P1: fresh identical captures reuse old immutable observation time (`migrations/034_public_data_intake.sql`) | Repeat collection and recovery after committed observations but a lost checkpoint cannot complete. | Bind fresh typed receipts to the exact admitted dispatch/current mapping/current typed heads. Give the optional directory its own append-only fresh acquisition receipt; never rewrite immutable request times. Test repeats and lost-checkpoint retry. |
| P2: adoption updates immutable enrollment-season evidence (`migrations/034_public_data_intake.sql`) | The existing unconditional immutability trigger rolls the transaction back. | Preserve enrollment-season history byte-for-byte. Keep mutable explicit season eligibility separate, and apply it to both exact-season and latest-season registry reads. Test eligible/ineligible seasons and old-schema compatibility. |
| P2: official scoring correction blocked by legacy calculation-profile conflict (`league-administration/runtime.ts`, effective database population validator) | Valid official settings can be accepted but cannot provide the population proof needed to accept core records. | Use only the exact accepted current typed settings and matching source evidence for the narrow conflict case; preserve immutable calculation profiles, legacy callers, lineage/mapping, acquisition order, job lease and accepted-head guards. Test source composition and author real SQL positive/negative cases. |

Both independent reviewers closed these five findings at source/offline level on `23f17c6f504d382bd29ea6de08ebaaf56b697f1f`. Database correctness remains unqualified. Full verification on 23f failed; the later f904 local workflow passed as separately recorded above. R035 and its minor reader correction received separate frozen-SHA reviews at 15254c2 and f904 as recorded above. Failed-before/fixed-after offline checks close local regressions only; authored SQL cases remain unexecuted. Neither earlier reviews nor test totals automatically transfer to changed code.

## Resource qualification state

Current repaired source: `592a60a79639a648a35dda14f53d787003d357bf`, independently reviewed and frozen with shared module LF SHA-256 `899c526471fd9f9df3917a357721c52b249d44c7aed5660fb658dda39d675abf`. Original reviewed source remains `0c9f318eda864aa0e86927a399ff6a835ad18c37`. **Verified** below means only the named tested source/path, including original A and all four accepted repaired profiles at `592a60a`. Original B failed and receives no accepted-profile coverage credit. **Unverified** means implementation exists without the stated real proof; **missing** means concrete implementation or operating evidence still has to be added. **Unavailable/unsupported** must be justified for a specific capture, field or structure, not used to close an obtainable family. No entire approved family is exempted. Library paths below are relative to `apps/site/lib`; integration paths are relative to `apps/site`. `A/` abbreviates `league-administration/`, and `G/` abbreviates `aggregator/`. These are existing owners to extend, not new pipelines.

### Official resource requirements

| Requirement and native coverage | Existing adapter → writer → backend reader | Evidence, gap and smallest next action |
| --- | --- | --- |
| Discovery: username → stable user ID → associated leagues for declared seasons | `sleeper.ts` → `A/public-intake.ts`, `A/neon/public-intake.ts` → `A/public-intake-reader.ts` | **Verified:** `f20eab3`, complete four-league 2026 list and two live collections. **Verified r2 B at `592a60a79639a648a35dda14f53d787003d357bf`:** two controlled empty-list refresh cycles with retained prior typed history. Current bounds: 1–3 seasons, 1,000 list rows/season, 20 selected candidates and shared 16-league enrollment ceiling. **Unverified:** other users/seasons, changed/invalid lists and remaining list/enrollment-limit behavior. Qualify those through the same path; the selected pending-request/paused-target cases are not general discovery-limit or acquisition-capacity proof. Capacity exclusions are not invalid official formats. |
| Leagues, settings and seasons: native league/season IDs, scoring/roster/competition/waiver settings, applicability | `sleeper.ts`, `A/normalize.ts` → `A/neon/public-intake.ts`, `A/neon/league-settings.ts`, `projections/adapters/neon/identities.ts` → `A/public-intake-reader.ts` | **Verified:** core at `2f19b7e9`, `e85c798`, `f20eab3`; nine-state preconfiguration and committed-bootstrap recovery at `cbfc938`; A at `0c9f318` adds interrupted typed-core recovery, explicit existing-consumer adoption and generation-one admission after the maintained completed-job retention path. A new nonempty numeric rule set may create a profile; missing/null/empty rules leave NULL; an existing season's binding stays immutable. **Missing:** bounded DATA annual predecessor/successor acquisition and evidenced applicability coverage. Extend registration/source mapping using existing `A/applicability.ts`, `A/neon/administration.ts` and migration016's `connect_league_administration_season`; retain predecessor evidence and qualify conflicting/missing years. Existing applicability/version mechanisms are implemented, not a new history pipeline. |
| Teams, managers and co-owners: season-scoped roster IDs, user IDs, vacancies/changes; commissioner separate | `sleeper.ts`, `A/normalize.ts` → `A/neon/team-managers.ts`, `A/neon/administration.ts` → `A/public-intake-reader.ts` | **Qualified within CP7 scope:** nine-case restricted-SQL [run 38071709157](https://github.com/clawmachinejed/league-one-audit/actions/runs/38071709157) at `62b9f7710b8dda31e5723a6942911b85515bd014` passed commissioner true/false/absent/null/invalid parity, ownership/co-owner/vacancy changes, identities/history/replay, partial primary ownership, ordering/remap, independent directory failures, late-write rollback, actual privileges and ordinary intake/refresh recovery. Commissioner facts remain independent of ownership and account authority. V1 completion remains primary-owner based; V2 remains latest-for-current-mapping evidence, while the typed directory read is exact-capture bound with a current mapping guard. HTTP was synthetic. Live acquisition, fresh-role provisioning, sustained recurrence/fleet targets, full SQL regression and production installation remain separate qualifications. Earlier core/directory results retain their original source bindings; documentation-only closeout is not another executed SQL source. |
| Rosters and player identities: held players, starters/reserve/taxi and native player namespace; complete/partial changes | `sleeper.ts`, `A/normalize.ts`, `sleeper-player-catalog.ts` → existing administration acceptance and shared scoring-identity owner → `A/neon/current-roster.ts`, `A/neon/roster-player-links.ts`, `A/public-intake-reader.ts` | **Qualified within CP5–6 scope:** durable versioned directory; correctly keyed memberships/categories; evidenced player and team-defense links; explicit unresolved/conflicting identities; additions/removals/transfers, complete-empty versus incomplete input, unfamiliar positions, immutable corrections/history and stored-reader parity. CP6's nine-case restricted-SQL [run 38059763318](https://github.com/clawmachinejed/league-one-audit/actions/runs/38059763318) qualifies source `93c18e588f7bcead866b6e3e3f087b8a691dcee6`, including ordinary intake and one refresh. HTTP is synthetic; CP5 live acquisition remains separate evidence. No name-based cross-provider inference or provider transfer timestamps are invented. Fresh roles, sustained recurrence/fleet targets, full SQL regression and production installation remain later qualifications. Any subsequent documentation-only commit records this result; it is not another executed SQL source. |
| Lineups and matchups: native period, roster/matchup IDs, assignments/slots/grouping, byes and formats | `sleeper.ts`, `A/public-intake.ts`, `G/exact-matchups.ts` → `A/neon/exact-matchups.ts`, `A/neon/public-intake.ts` → `A/public-intake-reader.ts` | **Verified:** selector/permission SQL at `e8afd508`; A at `0c9f318` adds the twenty-ordinal/candidate-lineage/immutable-scope structural case with rolled-back owner-only prerequisites. **Verified r2 C at `592a60a79639a648a35dda14f53d787003d357bf`:** the controlled week 7/season 2179 retained-period chain, paired reservations/witnesses, stale/fenced receipt rejection, observed work-deadline expiry during an advisory-lock wait and lost-ack recovery, and failure preservation. **Verified r2 D at `592a60a`:** five failed exact-period admissions with real backoffs, then core/users completion with partial intake status and no period checkpoint. **Unverified:** stored score/custom-zero value parity and broader competing-head/remap/format behavior. **Missing:** bounded full period inventory and supplied competition-phase/multiweek/history applicability. Extend this same task and exact-reader path; unavailable exact-period reserve/taxi or historical slots cannot be filled from today's roster. |
| Official scores, results and standings: scores/custom overrides, outcome/finality, supplied rank/seed/W-L-T/PF-PA | `G/exact-matchups.ts`, `G/season-overview-source.ts` → `A/neon/exact-matchups.ts`, `A/neon/current-roster.ts` → `A/public-intake-reader.ts`, `G/season-overview-standings.ts` / existing `G/bundle-two-reader.ts` | **Implemented/unverified:** exact raw/custom/effective scores and same-roster season facts; custom zero remains zero and local ordering is derived. The C fixture supplies custom zero but asserts period availability rather than exact stored score values, so its accepted pass does not close field/value/presence parity. Existing exact-matchup finality is explicitly unknown (`no_matchup_finality_evidence`); intake still lists official results as not requested. **Missing:** supplied official outcome/finality/phase facts and generic stored result coverage; extend existing contracts and acceptance/readers using actual source/bracket evidence, never scores alone or current standings as historical evidence. |
| Transactions, waivers and FAAB: ID/type/status/participants/adds/drops/trades/bids/budgets/timestamps | `sleeper.ts`, `A/normalize.ts`, `A/runtime.ts` → `A/neon/transactions.ts` → existing `readAcceptedTransactions` through `A/store.ts` | **Implemented:** typed week-scoped path and correction-aware retained reader; core roster facts preserve supplied waiver/budget fields. **Missing:** DATA selection/checkpoints/reader composition (currently `notRequested`) and declared historical range. Add bounded transaction tasks to `A/public-intake.ts`, `A/neon/public-intake.ts` and `A/public-intake-reader.ts`, reusing existing attempt/writer/reader. Qualify corrections/deletions/partial failures and supplied claim visibility; do not invent failed bids or accepted outcomes. |
| Drafts and picks: draft ID/settings/order/status, selection and traded-pick ownership, round/pick/season/player scope | Existing metadata loaders in `sleeper.ts`, `A/normalize.ts` → legacy `A/neon/administration.ts` content/observations/heads → `A/store.ts` `readSource` | **Implemented:** legacy acquisition and raw/normalized evidence. **Missing:** dedicated typed accepted draft/pick resource, queryable ownership/settings/order/status reader and DATA selection. Extend existing `A/contracts.ts`, normalizer, administration writer and store reader, then bounded intake/refresh tasks. Raw archive or old maintenance acquisition alone does not complete this family. |
| Schedules, playoffs and history: native periods/opponents/bracket rounds/entrants/winners/losers, annual chains and corrections | `sleeper.ts`, `A/normalize.ts`, `A/source-mapping.ts`, `A/applicability.ts` → `A/neon/retained-matchups.ts`, `A/neon/administration.ts` → `G/season-overview-schedules.ts`, `G/historical-continuity.ts`, `G/bundle-four-reader.ts` | **Implemented:** retained exact-capture schedules, normalized bracket evidence, source-connection history and internal continuity composition. Existing B4 composition restricts keys to League One/Two/Dynasty and uses its own historical/week policy; it is not generic DATA history. **Missing:** bounded source season/period traversal, typed official bracket/result reads and generic annual/history composition. Extend these owners alongside the annual-mapping and period increments; qualify gaps, corrections, ties/byes/multiweek structures where supplied. |

Field-specific **unavailable** examples require their retained payload/coverage reason: unpublished null bracket, absent provider rank, unexposed losing waiver claims or missing historical slot evidence. An obtainable endpoint that intake has not selected is **missing/not requested**, not provider-unavailable. Unsupported derived scoring never vetoes representable official data. Sleeper is the only implemented fantasy provider; Yahoo/ESPN adapters remain future work, not a completion dependency for this boundary.

### Integrity and operating requirements

| Requirement | Existing path and source-bound proof | Remaining proof or smallest implementation action |
| --- | --- | --- |
| Relational identity and official meaning | Canonical identities in `projections/adapters/neon/identities.ts`; typed `A/contracts.ts` / `G/*-contracts.ts`, normalizer and `A/neon/*` writers/readers; bounded core and R037 proofs above. Native IDs are strings scoped by provider/resource/league/season; zero, missing, null, empty and invalid stay distinct. | Review functional dependencies and qualify installed keys/FKs/cardinality/uniqueness, units, native statuses and field-state/value parity for every increment under actual restricted roles; complete annual/player identities and missing typed families above. Include unrelated formats and League One/Two/Dynasty regression evidence; a four-league live sample is not all-format coverage. |
| Provenance, time, correction/deletion and accepted-head ordering | `A/public-capture-witness.ts`, `A/runtime.ts`, shared `A/neon/administration.ts` and resource readers retain request/source/acceptance times, schema/normalizer versions, coverage, mappings, attempts and receipts. `91aec119` proves changed core plus immutable prior history; `f20eab3` proves fresh acquisition with unchanged payloads. **Verified r2 B at `592a60a79639a648a35dda14f53d787003d357bf`:** repeated changed-core cycles, two empty-list cycles and owner UPDATE/DELETE rejection against all four nonempty refresh-history tables. **Verified r2 C at `592a60a`:** selected period witness/receipt/fence checks. | Qualify late corrections, deletions/removals, partial failures, replay and out-of-order/noncurrent heads per resource. Add missing typed-family acceptance to the same ordering machinery. The bounded recurring/period cases do not establish those properties for every family. A cache hit/retry/read is not a fresh source observation; keep `clock-v1` and immutable projection baselines unchanged. |
| Durability, concurrency and bounded recovery | `A/public-intake.ts`, `A/neon/public-intake.ts`, shared `projection_jobs` and `A/public-refresh-reader.ts`: selected guards at `e8afd508`, CAS/pause/expiry/admission races at `357c390`, real advisory/identity waits with rollback at `fe96853`; injected interruption/recovery at `91aec119` and `cbfc938`. A at `0c9f318` adds core recovery/adoption, completed-job retention, failed-target deferral without admission credit and selection of another target. **Verified r2 B:** the bounded history/limits proofs above. **Verified r2 C:** bounded period recovery. **Verified r2 D:** bounded period exhaustion followed by core/users completion with partial intake status and no period checkpoint. No database transaction spans HTTP. | Add actual process death/restart and fresh-fleet competing-owner tests through `integration/public-data-intake.integration-case.ts` and the existing supervisor; injected exceptions, lost acknowledgments and test-child cleanup are not restart proof. Specifically qualify recovery of unfinished bootstrap dispatches left by the identity rollback fixtures; these selections do not prove that recovery. General competing-worker safety and sustained healthy-target acquisition remain open. |
| Restricted roles, privacy, audience and source-use authority | Existing source/enrollment policies, runtime-role provisioner and guarded writers/readers remain; `e8afd508` proves named denials, optional grant restoration and selector guards. Its role proof is late-role-equivalent, not newly provisioned-role proof. Public lookup does not prove ownership. | Qualify actual fresh-role privileges and relevant writer/reader/source-audience boundaries for each new resource, preserving private account data without building deferred account products. Record applicable source-use permission before external/commercial operation; public HTTP success alone is not that permission. Keep evidence/logs secret-free. |
| Workload/provider bounds, capacity and freshness | `A/public-intake-runtime.ts`, `A/public-intake.ts`, `A/neon/public-intake.ts`, `sleeper.ts`: dormant bounded DATA composition, 60-second admission spacing, 20-second work fence, 25-second lease, 16 pending requests/targets and bounded retry/backoff. One live refresh passed; no operating cadence guarantee. **Verified r2 B at `592a60a79639a648a35dda14f53d787003d357bf`:** the shared sixteen-pending-request guard and paused total16 metadata-target ceiling under restricted configuration, not measured acquisition throughput. A's twenty task ordinals are structural proof only. | **Missing runtime protection:** shared DATA response parsing still lacks byte/depth/node ceilings; the live test wrapper's 1 MiB/response and 36 MiB/run are test-only. Add bounds at the existing DATA transport boundary and adverse tests. Declare attainable per-family freshness/workload objectives; measure sustained contention, provider budgets, lag, failure isolation and backlog recovery before activation. No 500-league or minute-level guarantee is established. |
| Reader plans, storage growth and restore | Existing typed readers and immutable history; successful disposable cleanup proves child/schema/generated-credential removal only. | Inspect material reader query plans/indexes under representative DATA load; record latency/capacity. Establish retained-history/storage-growth policy and an authorized isolated backup/restore/replay drill through existing storage/reader/harness owners; verify restored identities, receipts, heads and outputs. No DATA restore result or retention capacity is currently retained. Do not prune evidence to manufacture a pass. |
| Source-bound qualification and delivery | Existing `integration/README.md`, supervisor/profile validator and this ledger own actual-SHA run/report/cleanup proof. Original `0c9f318` has accepted A and failed B; all four fresh profiles at `592a60a79639a648a35dda14f53d787003d357bf` are independently accepted. Historical passes retain their exact sources; original CI/preview do not qualify the repaired candidate. Ordinary fixture child version was PostgreSQL 18.6, while these tested child versions and cumulative billing remain unmeasured. Branch is draft/unmerged and DATA selection dormant. | Retain the tested child's actual version on subsequent authorized runs, exact source/selection, independent review, source/SQL/reader parity, no selected skips/retries and acknowledged cleanup. Revalidate final changes against this matrix; the 48-module default inventory is not a whole-suite timing result. Production qualification remains separate: obtain release/migration authority, verify identity/roles and safe compatibility, inspect preview, then exact merged production SHA and both leagues/natural operations. No production action is part of this documentation outcome. |

### Historical SQL coverage index

The following index reconciles accepted passing reports without asserting a current-HEAD rerun. All earlier failed runs and cleanup histories above remain unchanged. Historical CI manifests are under ignored `test-results/data-backend/ci-<run>-result.json`; the ordinary local report is under `test-results/integration/artifacts/run-uZiphc/qualification-report.json`. The original A result and failed B manifest remain preserved above. Replacement result/review paths and hashes above come from actual independently accepted evidence. Failed rows receive no added qualification credit; the accepted fresh A repeat adds zero historical names. Detailed milestone entries retain exact artifact hashes and limits.

| Executed source | Run / passed scope | Distinct intake names added |
| --- | --- | --- |
| `2f19b7e987b2f3eb2aa03145d95f013cf4ce7ea1` | Local `e22eeca7-0c3b-4921-8101-2c70dafd41bd`: ordinary fixture source→stored-reader case | 1 |
| `91aec119930cc65d168f81e35a0bdc83fd7e583b` | [37852495625](https://github.com/clawmachinejed/league-one-audit/actions/runs/37852495625): two changed core cycles, history and unfinished-dispatch recovery | 1 |
| `cbfc938b6053cf9cb051b463d2de3ace451f6007` | [37922543557](https://github.com/clawmachinejed/league-one-audit/actions/runs/37922543557): committed-bootstrap recovery and nine-state R037 matrix | 2 |
| `e8afd508cf059e955820f0337137edb15e264523` | [37929506649](https://github.com/clawmachinejed/league-one-audit/actions/runs/37929506649): selectors/unknown acknowledgment, private-helper/job-wait deadline, optional privileges and omitted/empty/canonical period selectors | 3 |
| `357c390806e300224ba39eee6f96cb9681234378` | [37936334720](https://github.com/clawmachinejed/league-one-audit/actions/runs/37936334720): five passes; selector prerequisite repeated, plus CAS, pause-first, observed expiry wait and admitted-capture-before-pause | 4 |
| `fe96853a2d33235ae6b811d06aa829bc08987dd4` | [37945640394](https://github.com/clawmachinejed/league-one-audit/actions/runs/37945640394): advisory wait/expiry rollback and configured/official-only identity-row wait rollback | 3 |
| `e85c798d787c54fba295963d7042b5529b4b478e` | [37846456247](https://github.com/clawmachinejed/league-one-audit/actions/runs/37846456247): separate live registered-operator League Two core/directory case; not public discovery | Outside intake inventory |
| `f20eab384e328e3b6cc0b1b18a710a381f622197` | [37868723082](https://github.com/clawmachinejed/league-one-audit/actions/runs/37868723082): separate live DannyPak 2026 identity/list, four leagues, two collections, 36 GETs and unchanged payloads | Outside intake inventory |
| `0c9f318eda864aa0e86927a399ff6a835ad18c37` | A [37962041331](https://github.com/clawmachinejed/league-one-audit/actions/runs/37962041331): six accepted passes; core recovery/adoption, retention, fairness and structural period scope; two prerequisite executions | 4 |
| `0c9f318eda864aa0e86927a399ff6a835ad18c37` | B [37964858235](https://github.com/clawmachinejed/league-one-audit/actions/runs/37964858235): failed diagnostic artifact write; six raw passes, one failure, 18 filtered; cleanup verified | 0 accepted-profile additions |
| `592a60a79639a648a35dda14f53d787003d357bf` | Fresh A [37971973149](https://github.com/clawmachinejed/league-one-audit/actions/runs/37971973149), attempt 1: six accepted passes, 19 filtered, repeating the original A scope | 0; repeats original A |
| `592a60a79639a648a35dda14f53d787003d357bf` | Fresh B [37974577614](https://github.com/clawmachinejed/league-one-audit/actions/runs/37974577614), attempt 1: seven accepted passes, 18 filtered, including two prerequisites | 5 |
| `592a60a79639a648a35dda14f53d787003d357bf` | Fresh C [37977900357](https://github.com/clawmachinejed/league-one-audit/actions/runs/37977900357), attempt 1: one pass, 24 filtered; native-period recovery; independently accepted | 1 new historical name |
| `592a60a79639a648a35dda14f53d787003d357bf` | Fresh D [37979734070](https://github.com/clawmachinejed/league-one-audit/actions/runs/37979734070), attempt 1: one pass, 24 filtered; exact-period exhaustion; independently accepted | 1 new historical name |

Accepted historical coverage totals **25 distinct names across tested sources: 14 + 4 + 5 + 1 + 1** — fourteen pre-closeout names plus four from original A, five from corrected B, one from corrected C and one from corrected D. All four accepted profiles cover **15 executions of 14 distinct names** at `592a60a79639a648a35dda14f53d787003d357bf`; eleven other names remain historical-only. Original B remains failed; the new accepted source supplies B coverage without retroactively qualifying the failed attempt. The shared module LF digest is `899c526471fd9f9df3917a357721c52b249d44c7aed5660fb658dda39d675abf`, with each result bound to its own exact profile/report/cleanup evidence. Neither all 25 at the repaired source nor the full 48-module SQL suite has been performed. Unfinished bootstrap-dispatch recovery remains unqualified. Actual child versions, cumulative billing and an independent postrun API absence probe remain unmeasured; historical PostgreSQL 18.6 evidence cannot transfer to these children.

### Four-profile selection and prerequisite accounting

The selected names below match the repaired freeze exactly, bound by module LF SHA-256 `899c526471fd9f9df3917a357721c52b249d44c7aed5660fb658dda39d675abf`. The count column gives actual executions / additions relative to the fourteen-name pre-closeout baseline / filtered names; every profile collected 25. The fresh sequence was A → B → C → D, with each actual result independently accepted before the next dispatch. Original A already added its four historical names, so fresh A adds no historical coverage; all four replacement profiles are independently accepted. Prerequisites execute in the same disposable database: previous runs cannot supply setup state. Existing exact names, order, case/hook deadlines, runner/harness/configuration behavior and default 48-module inventory remain unchanged. No live-acquisition case is selected.

| Profile | Executions / additions vs pre-closeout 14 / filtered | Exact selected case names in source order | Dependency and bound |
| --- | --- | --- | --- |
| A `data-intake-recovery-v1` | 6 / 4 / 19 | `binds typed receipts, preserves core through interruption, recovers once and permits explicit existing-consumer adoption`; `admits generation one after normal completed-job retention while preserving older dispatch history`; `rolls back configured canonical registration and its reservation when an identity-row wait outlives the postcondition fence`; `retains one cycle through concurrent selectors, unknown acknowledgements, poisoned selection and sequential approval checks`; `defers a failed selection without giving it admission credit or monopolizing another verified target`; `enforces twenty task ordinals, candidate lineage and immutable scope with rolled-back owner-only negative prerequisites` | Configured identity rollback supplies the genuine fixture for fairness; the selector prerequisite runs before fairness. Six hooks across three suites. Original A accepted at 0c9; fresh A accepted at 592a60a and adds zero historical names. |
| B `data-refresh-history-v1` | 7 / 5 / 18 | `retains one cycle through concurrent selectors, unknown acknowledgements, poisoned selection and sequential approval checks`; `refreshes two typed core cycles with real admission spacing, a correction and lost-checkpoint replay [focused slow SQL]`; `retains two empty-list cycles without relabeling previous typed data or replaying missed cadence slots [focused slow SQL]`; `refuses owner UPDATE and DELETE of existing immutable refresh history and preserves later-cycle rows`; `shares the existing sixteen-pending-request limit with manual submissions without spending admission credit`; `copies explicit periods into a new ordinary cycle and preserves original scope across replay and configuration CAS [R038 metadata only]`; `counts paused synthetic metadata targets toward the total16 bound using a genuine restricted configure call` | Selector and typed-core cycles establish real configuration/cycle/outcome/failure history; empty-list cycles precede immutability and pending-limit setup. The metadata case reads the already-completed terminal cycle without selecting a new one; paused total16 population remains last. Two hooks. Accepted at 592a60a; five historical names added. |
| C `data-period-recovery-v1` | 1 / 1 / 24 | `binds both reservations, rejects stale/fenced receipts, recovers an observed lock expiry and lost acknowledgments, and preserves periods through core failure [focused slow SQL]` | Own genuine fixture; two hooks. Existing 18-minute body allowance and unchanged aggregate limits. Accepted at 592a60a; measured lifecycle 660,760 ms within the unchanged limits. |
| D `data-period-exhaustion-v1` | 1 / 1 / 24 | `exhausts five real exact-period retries without closing core or fabricating a period checkpoint [focused slow SQL]` | Own genuine fixture and five failed exact-period admissions with unchanged real retry backoffs; two hooks. Existing 27-minute body allowance and unchanged aggregate limits. Accepted at 592a60a; measured lifecycle 1,273,154 ms within the unchanged limits. |

Frozen repaired profile SHA-256 digests: A `6f8c4f80b1ff503d3a3650bea02e71b3fcb7ebb39661466bc7e9d5dde49ec29d`; B `0140e6419c834919cf1d19992a83d5a47dfdde2d483a25a83a4d861ff287d922`; C `fa4ed762051397cffc434d0dbc6e1c5a793b8a4b0faecaba978d23b0d93ddbc5`; D `0d7d3aa452dfe318b3b2ea3bd6f777baa26a856029ae4100709659b662f1b03f`. The selector is the one name shared between A and B; configured identity rollback and the typed-core-cycle case are the other two prerequisite names. The four profiles select eleven additions relative to the original fourteen-name baseline and four prerequisite executions, yielding fifteen accepted executions of fourteen distinct names. Original A's four, corrected B's five and corrected C/D's one addition each are included in the historical 25-name union.

### Execution order and completion conditions

1. **Close the remaining recovery and integrity proofs:** with the narrow diagnostic repair, exact-source CI/preview and all four fresh profiles independently accepted on common candidate `592a60a`, preserve the failed original attempt and add actual process-death/restart, recovery of unfinished bootstrap dispatches left by identity rollback and general competing-owner evidence through the existing intake owner and supervisor. The eleven selected gaps relative to the pre-closeout baseline do not cover these obligations. Use existing harness limits and fixed deadlines; never fabricate admissions, silently omit prerequisites or extend deadlines to claim completion.
2. **Complete obtainable resource paths:** qualify existing exact-period field/value/lineage readers, then add bounded period inventory and transaction selection using the same admission/checkpoint path. Extend existing draft/pick/bracket typed acceptance/readers; use their supplied results for official outcome coverage. Add evidenced annual traversal/generic history, durable catalog/crosswalk coverage and distinct commissioner facts where supplied. These increments may be planned independently, but annual history depends on valid source links and period coverage; a historical union of 25 intake names does not close any missing family.
3. **Qualify integrity as each path lands:** every matrix row needs declared native fields and coverage, actual authorized isolated source→adapter→typed SQL→reader parity, installed restricted-role/constraint evidence, corrections/deletion/partial/replay/fence checks and independent exact-source review. Preserve separate official/derived coverage, original failed-run history, immutable baselines and exact-week semantics. The bounded live connection proof already exists at `f20eab3`; changed paths need representative additional evidence, not automatic credit from it.
4. **Establish operating readiness:** add runtime response bounds, declare attainable freshness/workload/provider budgets, then measure sustained multi-target progress, real failures/restart, query plans/latency, storage growth and restore/readback. Retain actual tested PostgreSQL version and safe complete cleanup. Public source accessibility is insufficient for external/commercial source-use authority. No elapsed-time estimate or supported fleet maximum is inferred from fixture limits.
5. **Close the backend ledger only at requirement granularity:** all approved rows must have a durable typed result/readback and reviewed objective evidence, with each genuine source limitation explicitly justified and no obtainable unimplemented family hidden as unsupported. Re-run affected verification at the final candidate and report skips/unverified evidence separately. Production installation/activation/release remains a later authorized outcome with fresh identity/ownership checks, exact merged Vercel SHA and both League One/Two verification; completing this documentation outcome does not perform it.

## Historical pre-execution boundaries — October 6, 2026

At this historical planning checkpoint, no credentials, database connections, SQL execution, migrations, paid resources or qualification dispatch had been used in this DATA iteration. Later source-bound runs are recorded in the current status above. No merge, deployment or feature activation is authorized. The one-hour branch expiry is only a fallback.

The proposed one-run boundary remains project `steep-glitter-44680287`, parent `br-plain-bread-b7sgfdl8`, compute 0.25 CU, one attempt with no automatic retries, a 30-minute work cutoff plus 10-minute cleanup reserve, credential revocation and verified child deletion. This is a proposed bound, not a current approval or a guaranteed billing maximum if remote cleanup fails.

Read-only GitHub metadata showed an `integration-test` environment with reviewer `clawmachinejed`, self-review prevention disabled, and custom `codex/*` / `main` branch policies. That does not prove an independent reviewer approved a run. The last observed six repository runs were older completed verification runs; this limited listing cannot establish global absence of other work.

Read-only Neon Console observation on October 6 confirmed the intended project `steep-glitter-44680287` (`league-one-integration-tests`), parent `br-plain-bread-b7sgfdl8` (`integration-test-base`), one branch, two databases and reported PostgreSQL major version 18. Its compute `ep-proud-queen-b73kvynx` showed suspended for eight days at 0.25 CU; displayed usage since September 30 was zero CU-hours and zero kB. No Connect, Tables, SQL Editor, Roles, credential or provisioning action was used. This control metadata does not prove empty schemas, zero sessions, exact server patch, credential scope, a billing ceiling or teardown success. The parent's Never expiry is distinct from the proposed disposable child's fallback expiry. Ignored `test-results/data-backend/neon-control-metadata-2026-10-06.json` retains these limits.

Still required before a concrete request: fresh exact-SHA whole-chain review; approved test-key scope and project/parent/child identity; empty and quiescent intended parent evidence; production denylist, URL/TLS/sentinel checks and real restricted LOGINs; PostgreSQL version; a selected source/SQL workload demonstrably fitting the budget; exact live Sleeper scope/request cap; and fail-closed teardown evidence. The historical full SQL suite approached the former timeout and is not assumed to fit the proposed 30-minute work phase. Retained HTTP fixtures are not live Sleeper proof. Owner `SET ROLE` cannot substitute for LOGIN tests where `session_user` matters.

The next implementation steps are recurring shared-worker refresh, official-only registration and remaining official resource families, followed by qualification of the composed workflow when separately authorized. R035 and the source/fixture corrections are reviewed partial checkpoints; f904 full local verification passed, while the historical connection-reset cause and actual SQL remain unverified. Whole backend completion and production release remain unapproved.

## Recovery correction accepted at ab3e788d

Exact source `ab3e788da781a3f9787e79ac5f124e35ccbb1034`, parent `21d55cb1768cf97410eb9a3fd775060bfe9a9807`, is a bounded source checkpoint. Both independent GPT-6 Astra Ultra reviewers closed the two reproduced P2 findings above and found no additional confirmed defect in its nine-file increment. The historical findings and failed parent workflow remain retained.

The optional runtime loader has an original-invocation +5-second gate and cannot start late work; an already-started worker remains fully awaited. The concrete runtime bounds claim/select/recover/next/admit at +10 seconds, leaving same-owner failure reconciliation inside the original +20-second work fence. Admitted provider work retains its separate original signal; cleanup remains bounded. A committed admission wins over unknown acknowledgement, without duplicate HTTP or false failure credit. Direct injected coordinator callers without this concrete phase bundle retain caller-managed deadlines.

The clean exact-SHA full local workflow passed: dependencies, lint, types and build; **5,732 unit passed, 0 failed, 1 skipped across 279 files; 121 public-browser passed, 0 failed, 20 skipped; 20 separate synthetic-browser passed, 0 failed, 0 skipped**. SQL was explicitly skipped/unexecuted/unqualified, and no database command ran. The public browser permits existing public provider fallbacks and is not a globally network-blocked check. Existing synthetic account cases are compatibility regressions, not new DATA/account implementation credit.

Saved in `data-refresh-recovery/LeagueOneEngineering/test-results/data-backend`: `full-verify-ab3e788d.log`, SHA-256 `7c632f82953a41f6340a316edb91b3bfc6bd42e2324c2fae2524dda9f8aafbef`; `verification-ab3e788d.json`; `review-ab3e788d.json`. Public build/run: `W99QciQ55GJYnf_p-MAN4` / `693bc4fc-548b-4987-96ca-d326146ce8b4`. Synthetic build/run: `5HmtPDLg9wPaGawS-250B` / `50c2a0c2-81a7-4064-a84a-1b3799425366`. The security reviewer independently inspected the log/hash and clean source; the architecture inspection is pending.

Author targeted evidence: 227 passed across 11 files, no failures/skips; retained stdout `recurrence-recovery-targeted.log`, SHA-256 `574dcd960b7de122fd89b47a9506f5477333add8adc33024ef1040575919bc00`. The security reviewer independently passed 640 tests across 26 files with no failures/skips in a frozen, network-blocked archive, plus types, changed-file lint, scope and diff checks. Its `independent-targeted.json` SHA-256 is `05f4e6fafdf1dea81619d1817963226ae30841a2ed633942bb3a9e9864267327`. The architecture reviewer independently passed 141 tests across five files and three actual runtime/worker/database-wrapper probes using injected transport/storage. Reviewer subchecks overlap these totals; none are added to full-workflow counts.

Independent actual-worker timeout replay with a model of SQL selection changed the prior A,A,A,A,A,A monopoly into A,B,A,B,B,A, with three failure reconciliations and three healthy B captures. This proves the source correction under that model, not PostgreSQL cancellation or fleet fairness. Loader probes establish bounded startup and preservation of admitted-worker completion, original dispatcher results/errors and maintenance behavior.

Authored SQL coverage now observes real competing lock waits for CAS and pause/admission/expiry ordering, uses actual restricted LOGIN assertions, and attempts owner-authorized UPDATE/DELETE against immutable history with exact trigger errors and retained rows. These cases remain unexecuted. No migration, privilege or provisioning SQL changed in ab3e788d. Source acceptance is not database qualification, whole-backend completion or release authority.

## Proposed fixed qualification workload: design only

Both independent Astra Ultra reviewers recommend a closed, versioned workload inside the existing disposable supervisor, selecting the strengthened two-typed-cycle case by exact full name. Keep default full mode, unchanged global setup/migration discovery and all project/parent/child, real LOGIN, URL/TLS, sentinel, denylist, ownership, cleanup and receipt guards. No arbitrary command/filter/config/report-path forwarding, retries or zero-test success. Bind reviewed SHA, parent run, workload version and case-set digest to a fresh parent-owned structured Vitest report and acknowledged final receipt. Require every selected case exactly once and passed; reject missing/skipped/duplicate/stale/wrong-case reports, hook errors, cancellation, live child, cleanup failure and lost terminal acknowledgement. Explicitly filtered cases earn no qualification credit.

Before selection, strengthen the existing case's changed scoring/co-manager assertions, composed refresh-reader readback, genuinely unfinished dispatch/non-noop recovery and pre-second-cycle history snapshot. The case establishes retained-fixture SQL collection into a preconfigured league, not live Sleeper or complete backend coverage.

Budget accounting includes all authored allowances: 330 seconds prerequisite + 1,140 seconds body + 120 seconds afterAll = **26 minutes 30 seconds**, leaving at most 3 minutes 30 seconds of the 30-minute work phase for provisioning, migrations/global setup, process/report work and global teardown. This is an unmeasured ceiling, not proof of fit. The original 10-minute cleanup reserve cannot be borrowed. One child/one attempt within 40 minutes remains the proposed boundary; no execution, credentials, provisioning, spending, billing ceiling or cleanup result is authorized or established by this design.

## R037 and verification guardrail development evidence

The official-registration candidate builds on the reviewed ab3e recovery code, cherry-picked at `2c2d9ccfdf42c13584db170429ca57f0663fbc54`, with preserved R037 work from `d65f658a8ecbdefafd78b948fb29ad2b0ca4ac2a`. Neither intermediate commit is itself a passing R037 checkpoint. The TS author froze seven owned paths after 280 tests across 11 files passed, with no skips, plus TypeScript, lint, scope and diff checks. Saved `official-registration-targeted.log` in the official-registration checkout has SHA-256 `bcb9e111565420219179dd244edaa84f74401c0c72a9e7a4a02f72e2e6c36741`. This is development evidence on the working delta; combined exact-SHA review and full verification are still required.

The migration compatibility review found an additional legacy no-statistics completion population check in effective019. Both reviewers confirmed that a DATA/NULL enrollment without calculation authority can veto otherwise configured peers there. Current runtime sharedPregame uses024 and invokes the older function with partial, so this is not a demonstrated current shared-pregame failure. The narrow approved design replaces only the two related legacy eligibility predicates using the same immutable exact-season DATA evidence, NULL profile and matching provider connection classifier. All fences, request generation, evidence/time/kickoff, history, budgets, privileges and current024 composition stay unchanged. This source assessment and the authored restricted-LOGIN oracle do not constitute SQL execution.

The zero-eligible runtime oracle uses the first genuine acquired-and-marked2199 request before ordinary fixture enrollment, reuses the existing batch/scorer prerequisites, and requires the specific population rejection with unchanged rows. It does not consume or fabricate a second hourly request. A separate rolled-back owner fixture checks readiness with synthetic candidate prerequisites; owner proof is not substituted for LOGIN proof. Legacy pregame cases retain their inherited owner-reset setup and do not establish uninterrupted fleet request budgeting.

The scope guardrail uses only the existing root verify command and existing workflow checkout. Its 23 self-tests passed. A disposable local clone used the actual updated verify command and real fixed87da baseline: an out-of-scope TSX change returned1 and ran zero downstream stages; removing it returned0 and ran five sentinel stages in their original order. Only downstream bodies in that disposable clone were stubbed; this proves entrypoint ordering and failure propagation, not a full application test run.

Saved guardrail artifacts in `data-official-registration/LeagueOneEngineering/test-results/data-backend`: `verify-guardrail-selftest.log` SHA-256 `51214401f452b786296be08d43bcbe86f2c70379445eea0293abf8752bd2b0df`; `verify-guardrail-entrypoint-report.json` SHA-256 `112884fa15c7636591d2c759409ad03223df5babdc3c9c09f157818d5777301c`; negative log SHA-256 `2affa5d24978564a3c417556270ecfdf1c12c1a7c21fd8ff0e8188d5c30f2ff5`; positive log SHA-256 `8ab4b6c2349c26963dc8cc503d2b793e568c6144e604e1ec76bdae502f6d5858`. Scope exceptions cover only package.json and the existing verify workflow for this stated purpose; comparison baseline and broad patterns are unchanged.

Fresh read-only GitHub main protection metadata on October6 reported strict=true and required context verify, app15368. This does not make unpublished candidate wiring an observed hosted check, and PR287 currently targets its planning branch rather than main. No branch protection was changed. Fresh repository/Vercel inspection still found main/production `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`, canonical repository/project/root binding, and unchanged draft PR287/PR286 heads recorded above. No publication, CI dispatch, credentials, database connection, migration application or paid run occurred.

R037 SQL/oracle author freeze on parent `2790826281af7121ee3664f19ea2bd904d27c454`: full TypeScript, five-file ESLint, scope and diff checks passed. Exact reverse comparisons confirm the effective026 body changes only the nullable profile join, effective017 bodies change only their two intended-population classifications, and effective019 changes only its two related legacy pregame population predicates. Existing applied migrations and grants are unchanged. The six raw file hashes and saved checks are in `apps/site/test-results/data-backend/r037-oracle-freeze.json`; the authored037 migration raw SHA-256 is `60441f57a163180925d27738677b6a57dd4f11a8139492914aa0415d1747282c`. No PostgreSQL parser, SQL, credentials, provider calls or provisioning were used.

Guardrail-only source was independently frozen at `2790826281af7121ee3664f19ea2bd904d27c454` over `2c2d9ccfdf42c13584db170429ca57f0663fbc54` for separate review. Its four-file delta is verification wiring, fixed-history checkout, exact manifest purposes and scope documentation. The official-registration WIP was deliberately left outside that commit; this intermediate revision is not a passing R037 or whole-application checkpoint.

## Frozen e6d26e09 verification failure and inventory correction

Frozen `e6d26e0922030f7e7761463d9f821c7c86b04374` passed the new scope entrypoint, dependencies, lint and types, then failed full unit verification: **5,768 passed, 1 failed, 1 skipped across 279 files**. `lib/projection-store-characterization.test.ts:153` expected 77 SQL operations but the explicit official registrar adds a 78th. Both registration branches also reused the configured marker, which the preserved uniqueness assertion would reject. This is a confirmed source/inventory regression, not a timing flake. Build, public browser and synthetic browser were not reached; SQL remained unexecuted.

The clean frozen checkout retains `test-results/data-backend/full-verify-e6d26e09.log`, SHA-256 `f96a3de618d66b6c449400f1c41b6aa9957bda30ee0fbb884cec99ae610a1b87`, and `failed-verification-e6d26e09.json`. Independent security review also reproduced the focused inventory failure. The correction is isolated in the `data-exact-periods` checkout on `codex/data-official-registration-checks`; exact-period feature implementation has not started there. Required correction is a distinct official marker and exact78 inventory, retaining configured identity, complete SQL extraction, one-marker, uniqueness and exact sorted-list checks. No assertion may be removed or weakened.

Separate guardrail review accepted exact `2790826281af7121ee3664f19ea2bd904d27c454` as a bounded source implementation. The independent supported-Node24/Pnpm11.19 run reproduced actual verify negative exit1/zero downstream stages and positive exit0/five sentinel stages in a fresh network-blocked local clone. Its report SHA-256 is `c6c986511ee7c4f054ffbab8f23ed6a843f48c6e3ac61075d16a6154029170d0`, retained at `C:/Users/Robert Finchum/AppData/Local/Temp/league-one-guardrail-node24-27908262-27b61c9da60c42379060981c3f0cf440/report.json`. An earlier unsupported-Node20 attempt failed before checker startup and earns no pass credit. Dependency installation can precede the scope gate; the gate does not prevent all package-manager startup activity. Independent reviewer strings and mutable policy/code remain trust boundaries requiring actual diff review. No hosted run, R037 acceptance, SQL qualification or release is implied.

Independent e6 database/security review: 695 tests passed, one inventory test failed, zero skipped across27 files in a clean, network-blocked frozen archive. The direct extraction helper also reported78 query calls/operations and duplicate configured registration marker count2. Saved report `C:/Users/Robert Finchum/AppData/Local/Temp/league-one-review-e6d26e09-9fe5f5c973e040ef8866b4d95f294046/independent-r037-targeted.json` has SHA-256 `b303967dcab579e466994516a2e2ea6512167d2e831e78ae1873ed22a615fb19`. The reviewer verified the full-run log hash and found no other confirmed migration/security blocker. This is not acceptance while the inventory failure remains, and counts overlap other tests.

The reviewer reconciled the documented standalone mixed-initial registration race as a P3 limitation outside the supported guarded intake. Under ReadCommitted, two unguarded initial registrations with differing scoring evidence can preserve the winning immutable season binding yet leave an unused valid profile because the second statement retains its pre-wait snapshot. The concrete intake uses separately ordered lock/registrar/postcondition statements, obtaining job/request and bootstrap locks before the registrar snapshot; it therefore has a narrower supported guarantee. Existing configured registration also eagerly creates profiles before a conflicting-season rejection. No corrupted season identity/binding or current guarded-intake failure was found, and no PostgreSQL reproduction is claimed. Do not count the NULL/NULL wait oracle as mixed-rule proof or claim no unused profile for arbitrary standalone callers. Any future caller needing that stronger guarantee requires a same-transaction lock before the statement snapshot plus actual mixed-rule qualification; a lock CTE in the same statement is insufficient.

Inventory correction development evidence: unchanged characterization reproduction passed17/failed1; corrected focused run passed134 across seven files with zero failures/skips. Full TypeScript, five-file lint, scope and diff checks passed. A source-parity check confirmed the sole production delta is one SQL comment; configured SQL/hash behavior stays unchanged. The exact78 inventory retains query-call parity, one-marker, uniqueness and sorted-list assertions, adds the official marker and tightens official/configured routing expectations. Saved `registration-marker-before.log` SHA-256 `1a4ad21b795b85a31273a3ddc923907a2f98345c43d5019aaf8912b79b659897`; `registration-marker-targeted.log` SHA-256 `77354bdfdad4acce95cbdba7fd210c5c917e6abe511b9ba139821c2850392457`. Changed-SHA independent review and complete local workflow remain required; SQL remains unexecuted.

## b2a03bd1 local pass and second oracle correction

Frozen b2a03bd1793aebdaa266a36df6d4def96ce56883 passed the complete local workflow: scope, dependencies, lint, types and build; 5,769 unit passed, zero failed, one skipped across279 files;121 public-browser passed, zero failed,20 skipped;20 synthetic-browser passed, zero failed/skipped. SQL was explicitly SKIPPED / UNVERIFIED and no database command ran. Public regressions retain public provider fallbacks. Log in data-exact-periods/LeagueOneEngineering/test-results/data-backend/full-verify-b2a03bd1.log has SHA-2563e632cdd671746ae2e509a2bfa1fcd6d8d958544e9a39e8fcb2be345dd0f1001. Public build/run: BU9iA-ESnw1vwcEX2WAsz / e3ed5e28-fb2e-4272-bfaa-8270b6af6ef1. Synthetic build/run: yR7w7l1D-bzuyiIzRJ-RB /3c65ff35-89f7-48ca-b86b-30409455086b.

Independent database/security review closed the inventory blocker at that full SHA after696 tests across27 files, zero failures/skips, in a frozen network-blocked clone. Report C:/Users/Robert Finchum/AppData/Local/Temp/league-one-review-b2a03bd1-d54a792a668449f0b7b3645c92cd71f0/independent-b2-targeted.json has SHA-2566c934388eab02b8af1571d779c931b0abc4aca4b5c6c2af59f6da6d59c834c24. The architecture reviewer independently passed155 tests across five files and confirmed preserved exact inventory assertions. Counts overlap and are not additive. Production parity is solely the SQL-comment marker; migrations and grants remain byte-identical to e6.

Architecture review separately confirmed a P2 defect in the authored interrupted-registration SQL oracle: public_data_league_candidates has league_season_id and bootstrap_payload but no league_id. The pre-recovery SELECT/assertion would fail before reaching recovery. This was established against migration034 and the actual test source without executing SQL. The narrow correction removes only the nonexistent candidate column and its null assertion. The test retains the independent joined canonical league/season/connection identity query, committed identity preservation, two distinct bootstrap owners, versioned stored-reader readback and inactive enrollment assertions. No production SQL, migration, privilege or test expectation about an existing field is relaxed.

Overall b2 source acceptance is withheld until the corrected test SHA is reviewed. Its local pass does not qualify authored SQL. Historical e6 failure, b2 results, documented standalone P3 race and all PostgreSQL/live-provider gaps remain. The corrected candidate requires changed-SHA review and verification; no database qualification, source publication, merge, deployment or activation is authorized by this evidence.

## R037 reviewed source checkpoint at 367933d3

Both independent GPT-6 Astra Ultra reviewers closed the two source-review findings at full SHA `367933d3a27302358d9bb90508608a10258d6ec6`. The latest two-file correction only removes the nonexistent candidate league_id query/assertion and preserves the b2 verification and withdrawn-acceptance history. Independent reverse comparison reconstructs the prior oracle; runtime, migrations, provisioning, package, workflow and policy Git objects are unchanged. Valid checkpoint fields, separate canonical identity, replay, stored readback and distinct-owner assertions remain. No new independent unit count is claimed for this two-line correction; the earlier b2 independent runs apply to unchanged implementation/test objects by explicit source comparison.

The clean exact367 full workflow passed: scope, dependencies, lint, types and build; **5,769 unit passed /0 failed /1 skipped across279 files;121 public-browser passed /0 failed /20 skipped;20 synthetic-browser passed /0 failed /0 skipped**. SQL was explicitly skipped/unexecuted/unqualified; no database command ran. The saved full-verify-367933d3.log in data-exact-periods/LeagueOneEngineering/test-results/data-backend has SHA-256 `3971012b14f57f601d4588868917d5c58912f359b4d1991105fcad142b9f87e8`. Public build/run: jDWjLELa4GbwUVEDFLdvv /e45004e1-9157-42ff-b595-9bb501261033. Synthetic build/run: qkTl1qJL4RETjPQFB3FNW /d07b0d23-e2a2-4f36-944d-79089dff8c42. Independent inspection of this terminal evidence is separately requested.

The next038 work uses the separate data-period-ingestion checkout and preserves this frozen source and logs. Fresh canonical GitHub/localmain and Vercel production remained `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`; repository clawmachinejed/league-one-audit, main/apps/site source binding, project league_one_fantasy, production deployment8C3YSnXRCbmPETftQgRtirfyck5e. DraftPR287 remains published682f6bbf8158e1c3494d85f31cd0e83856536ebe, planningPR286 remainscef7f49243509da738ff9efc950538b5bd2ae3da. No new source publication or hosted preview has occurred. No competing release owner was observed in inspected source/deployment metadata; database leases were not inspected.

R037 is a reviewed local source increment. Real restricted-LOGIN SQL, installed migration compatibility, live source-to-database readback, operating freshness/capacity and the remaining official resource families remain required. The documented standalone mixed-registration P3 limitation remains. This checkpoint does not mark DATA or BC-M1 complete, approve a database run, or authorize release.

Actual normal local preview of clean367 used build lLQsMyqM0h8YImHYdKNTJ after the synthetic build was replaced. In-app-browser inspection loaded League One Matchups, switched through the existing selector to League Two, and selected explicit League Two week4. Distinct team populations, shared presentation, correctly scoped links and official scores rendered. Database-backed projections were unavailable as expected without credentials; public Sleeper fallbacks were allowed. This is existing-site compatibility evidence, not new DATA SQL or finality qualification. The temporary tab and server were closed. Both reviewers independently inspected the terminal367 workflow log/hash/provenance and accepted the bounded source/local-verification checkpoint, retaining all SQL and live-source gaps.

## Qualification reporter and cleanup finding (unrepaired at 1cd098be)

Independent database/security research found that installed Vitest4.1.11's JSON reporter omits retry/repeat counts and unhandled-error/reason details. Its report occurs before global teardown. A successful process exit plus JSON success is therefore insufficient evidence for the proposed exactly-once qualification workload.

More seriously, both the reviewer and root independently reproduced a passing test followed by a throwing global teardown: the process exited0 and the JSON report still said success=true, one pass and zero failures, while stderr logged the cleanup exception. Root used a fresh temporary fixture with outbound Node network blocked; no repository implementation, provider call, database connection or SQL participated. Root proof C:/Users/Robert Finchum/AppData/Local/Temp/data-teardown-repro-77b99792221f442d90715bebd15eb52a/proof.json has SHA-256 `83ac4119fa0566e5e4fc40cc190a81111180f9925d15e3241accaee3a1673e01`. Reviewer's retained report.json SHA-256 is `18908a535faf6d7b7cf5ce92cea9ae4dd628a63bc6314b6a4a105d39ec68ccd3` in vitest-teardown-evidence-a47d9430bcc64399904edb1bb9ae4ce5.

The current supervisor independently verifies its own schema cleanup, credential revocation and child deletion; this new finding does not establish failed remote cleanup in any actual run. It establishes that child global-teardown success cannot be inferred from its zero exit. Qualification remains withheld until the reviewed execution chain additionally requires fresh exact-run structured test evidence and a success acknowledgment written only after the awaited global teardown completes. Missing, failed, duplicate, stale or wrong-run acknowledgments must fail. A custom reporter alone cannot observe post-report teardown. This is a reproduced runner behavior, not executed SQL failure or a reason to weaken existing cleanup checks.

Reporter design review confirms the common cleanup acknowledgment must cover both default full-suite and the one fixed selected profile. Keep default selection unchanged. Use a small shared profile/context validator, public-API Vitest reporter, the existing supervisor and a minimal global-setup callback wrapper. Require only generated run/SHA/mode context in the supervisor-owned artifact directory; reject incomplete context before database preparation. Await existing global cleanup, exclusively write success afterward, and force nonzero exit on cleanup/write failure. Standalone invocation without supervisor context keeps its selection behavior but earns no supervisor acknowledgment.

The selected profile additionally requires a frozen component-name path and anchored CLI filter, the exact collected/filtered inventory, execution diagnostics (including actual retry/repeat/flaky/fails), module/suite/case errors and final run reason/unhandled errors. Public reporter names use a different separator than CLI filters; do not derive either by blind string replacement. Parent validates only after confirmed process-tree closure, checks a sticky late-timeout failure marker, computes bounded report hashes and preserves all existing ownership/cancellation/cleanup/revocation/deletion/source/terminal-journal gates. Run binding avoids stale evidence; it does not attest against malicious test code. This remains a reviewed design, not implemented source or an authorized test.
## R038 source candidate and development evidence

Explicit native matchup periods now compose the existing public intake, bounded Sleeper capture, typed settings/matchup writer and stored exact-matchup reader. Optional selectors preserve omitted/empty calls and refuse nonempty old-schema submission before mutation. Every period reserves both attempts before either HTTP request and checkpoints only dispatch-bound current typed receipts. Later settings refresh does not invalidate historical configuration evidence; remapped or different current matchup captures do not satisfy the old request. Period exhaustion preserves independent core/directory progression. No new provider, page, scheduler or scorer was added.

The TypeScript author froze ten paths from base367933d3 after545 passing tests across14 files, zero failures/skips, full TypeScript and changed-file lint. Exact working-file SHA256s and command evidence are retained in test-results/data-backend/r038-ts-freeze.json and adjacent logs. Five database cases are authored, not executed. The complete candidate still needs frozen-SHA independent review and the full workflow. The qualification-reporting finding above remains unrepaired in this increment; neither local test success nor authored database cases authorizes a database run, completion or release.
## R038 frozen review: corrections required at 1cd098be

Frozen candidate1cd098beaafd0078c6d55b99f5ae075d05b24682 is not source-accepted. Independent architecture review confirmed P2: a runtime role first provisioned after migration030 does not receive EXECUTE on begin_exact_matchup_attempt(jsonb,uuid,integer,jsonb), so the new period coordinator fails before HTTP capture. Migration030 grants only when the role already exists; late provisioning omitted it. Root independently inspected both source paths. The required correction is the same narrow public-function grant and positive privilege assertion, retaining private helpers revoked. P3: installed038 still reads or updates period-task tables for omitted/empty requests in terminal selection, list checkpoint and failure/capacity paths, contrary to the strict no-task-access compatibility promise. Root confirmed the unguarded statements. The correction requires procedural nonempty-selection branches; no incorrect stored result or executed SQL failure is claimed.

Independent database/security source review initially found no introduced blocker; architecture then supplied the late-provisioning and legacy-access findings for reconciliation. Independent network-blocked tests passed763 across27 files with no failures/skips. Report in C:/Users/Robert Finchum/AppData/Local/Temp/league-one-review-1cd098be-e9346209674549bca8d07a9dc548f423/independent-r038-targeted.json has SHA256c070ac85c193a01284566ef5c05f5def7666703dbcb29760d9f02683902b81e4. Architecture independently passed655 across17 files with no failures/skips. Counts overlap and are not additive. All13 author raw file hashes were verified before commit; committed Git objects normalize six of those files to LF. Raw working-file hashes are not all committed-byte hashes.

The first complete workflow failed at the unit stage:5834 passed,2 failed,1 skipped across279 files. Unchanged browser-target.test.ts did not reach its free-port build trap within the20-second subprocess bound, and unchanged lineup-mixed-admission.test.ts timed out after5 seconds. Build/browser stages were not reached. Raw test-results/data-backend/full-verify-1cd098be.log SHA256e44f479f5121bc6fe5bfd74054c2337598ef58ba9201287a73af88b9b2d204d3 is preserved in data-period-ingestion. The original two files then passed26 tests with1 skip at unchanged limits (free-port case1097ms, worker case102ms). A full unchanged rerun passed5836 unit tests with1 skip and continued; terminal build/browser results remain separately pending at this entry. These observations do not establish the precise cause of the first failures or erase them.

The five authored R038 SQL cases remain unexecuted. Their typed availability/lineage checks do not directly prove persisted score/custom-zero parity, actual competing remaps or another request replacing the head; those are mocked-unit dimensions until strengthened and actually run. The recurrence metadata case and structural owner fixture are not complete recurring acquisition or fresh-fleet capacity proof. Runtime fit remains unmeasured. All corrected source requires a changed-full-SHA review.

## Qualification evidence correction candidate

**Data resource.** The exact result of one bounded isolated DATA qualification attempt, including test selection, actual execution and completed global database teardown.

**Existing path.** Keep the existing disposable supervisor, standard Vitest configuration, global setup and cleanup, restricted LOGIN harness and immutable parent receipts. A small public-API reporter and closed profile/context validator add explicit child evidence; no second harness, provider pipeline or scheduler is introduced. Default full-suite selection is unchanged. The optional data-core-refresh-v1 profile selects only the existing two-core-cycle case and does not qualify R038 matchup collection or the full backend.

**Persisted result.** Fresh supervisor-owned run/SHA/profile-bound structured report, exclusive post-cleanup acknowledgment and sticky late-timeout failure marker. Parent acceptance must occur after verified child-tree closure and preserve every ownership, source, cancellation, schema cleanup, credential revocation, branch deletion and acknowledged terminal-journal check. The one-hour expiry is fallback only. The acknowledgment proves this global database teardown, not every internal runner resource closure.

**Real proof and gaps.** The installed runner failure was independently reproduced before authoring, as recorded above. Planned tests use actual network-blocked runner fixtures and mocked lifecycle dependencies; no real database participates. The selected SQL case needs stronger canonical/typed identity, changed settings and manager/player readback, a nonempty first-cycle history snapshot and actual unfinished-dispatch recovery. Its330-second beforeAll,1140-second body and120-second afterAll allowances total26m30, leaving3m30 of the existing30-minute work budget for all other work; actual fit is unmeasured. No paid run, credential access, SQL, provisioning, migration application, publication or release is authorized by this source correction.
Terminal evidence for the unchanged1cd rerun: scope/dependencies/lint/types/build passed;5836 unit passed/0 failed/1 skipped across279 files;121 public-browser passed/0 failed/20 skipped;20 synthetic-browser passed/0 failed/0 skipped. SQL was explicitly SKIPPED/UNVERIFIED; no database command ran. The full-verify-1cd098be-rerun.log SHA256 is477dd2aa6f7ba789c5ee63719b3912d1a9d5eeed209cd232958669f7cd824bfe. Public build/run Swm4PDQWdY9Dx1JRdU_-X/9a5a883b-fcaf-42de-8e92-cb263a0aa933; synthetic build/run588bAVT-e5NznNDz5ksjv/4f5f6d03-1a8d-47f9-b495-544bf7b60158. Frozen local verification-1cd098be.json SHA256a7e30175afe5de01129e32e750a3fb0f6c6f5baa5187646c67217769b9cc4777 preserves all stages and limits. The focused original-case log SHA256 is60b3e9bb17691fc5c738d1cae72dcc69431f6e179715465b2ca02d5b09be8d72. No tests or timeouts were weakened.

The independent database/security reviewer independently confirmed both P2 and P3 and amended its original source verdict to WITHHELD. It also inspected the completed rerun log/hash, clean exact-SHA browser provenance and preserved failure history. This accepts the recorded non-SQL verification result only. Both source corrections, reporter/teardown evidence, actual restricted-role SQL, live source acquisition and remaining resource families still need their own evidence. No manual normal preview or hosted preview is claimed for blocked1cd.
Independent read-only follow-on assessment against1cd identifies two additional operating gaps, deferred from this correction: DATA response parsing has no byte/depth/node ceiling, and current admission cannot establish minute-level freshness across its declared scope. For S declared seasons, C candidates and P matchup tasks, the path schedules1+S+3C+P steps and1+S+4C+2P GETs. The declared3/20/20 envelope is84 steps/124 GETs with at least83 minutes between admissions, before separate enrollment limits, contention, retries and processing; a fixed once-per-minute trigger can miss the additional completion cooldown and approximately double those gaps. This is a source-derived bound, not a measured operating run or proof that all20 candidates fit enrollment capacity. Each recurrence repeats identity/discovery/bootstrap, and current cron does not select DATA work. The existing shared current-worker freshness target is not proof of DATA freshness.

The reviewer proposed optional limits within the existing DATA transport and a shared matchup/transaction task budget; numeric limits are engineering proposals, not measured provider maxima or accepted implementation. Further research and resource expansion were stopped to prioritize the confirmed corrections and one actual source-to-database-to-reader slice. No live-ish, scaling, complete resource coverage or backend-completion claim follows from the current offline pass.
Correction author freeze from base1cd: the exact public matchup-attempt EXECUTE grant is now optional-function gated and positively asserted; all legacy-reachable period-task reads/writes are behind procedural nonempty selection. Forged exact work on empty scope still raises and rolls back. Only next_public_data_intake, fail_public_data_work and checkpoint_public_data_intake change inside038; the other eight functions and existing provisioning text outside the new block are unchanged by source comparison. The authored restricted-LOGIN grant oracle first revokes the exact privilege and proves its absence, then applies the maintained optional block and checks restoration/private-helper denial. This is an honest late-provisioning equivalent, not a newly created role. The empty-scope users/terminal path has an authored warmed-runtime test under owner-held exclusive locks on both period tables; it is not executed no-access proof.

The existing selected core case retains its name and18-minute loop/19-minute body bound. It now rejects null identity/receipt placeholders, compares the real0.13-to0.17 settings and primary/co-manager/player change through readPublicDataRefresh, snapshots populated first-cycle history before second acquisition, and proves one exact unfinished dispatch, recovery, idempotent replay and no extra acquisition. All24 module case names remain unchanged. Author types/lint/scope/diff/text audit passed. Raw oracle/migration/provisioner hashes are respectively f5d13a99ab855e16a7d68c5630e74c371a76ca486e50ad176f5a6db49b6262e5, f340640a2d58b108bf26f64e25126c470300a396575b3c34a3629d45f79f70b5 and d7151ead0f8dcf9af988b31492263491d36819f9c2346d6ec73a5b60758fe129; oracle LF digest f981eacbb6883106a57e5eff55237f2a575b559a477bc7cb4db921308757fced. The freeze report is apps/site/test-results/data-backend/qualification-oracle-freeze.json. These remain source corrections pending full-SHA review, not applied migrations or SQL qualification.
Qualification correction development checks passed127 tests across8 files with no failures or skips. The selected real-runner fixture reports24 collected,1 executed/pass and23 filtered/skipped; filtered and skipped overlap and are not additional executions. Network-blocked subprocesses exercise actual installed Vitest behavior for passing selection, throwing cleanup, hook/retry/repeat/unhandled errors and late process timeout. Mocked supervisor controls separately test validation after confirmed closure and missing/invalid artifact rejection while preserving parent cleanup gates. No SQL or live provider request ran. The earlier failed startup invocation and intermediate type/test failures remain in development logs; final source checks and exact-SHA independent review determine candidate acceptance.

The parent receipt retains the nonsecret trusted testContext (runId, nonce, full Git SHA, profile/digest and LF module digests) and separate collected/executed/passed/skipped/filtered counts with report digest. Fixed files are qualification-report.json, qualification-cleanup.json and qualification-failure.json; the acknowledgment asserts only globalDatabaseCleanup=complete. A source-AST check verifies24 unchanged case names and the selected module LF digest without importing the SQL module. Source binding and independent review are not a sandbox against malicious repository code.

## CP5 shared player directory source candidate (2026-10-10)

From local baseline `005a0e00692ac2a8553f2ff1515024f9cde07157`, CP5 adds the shared Sleeper NFL native player directory through the existing full-catalog loader, administration store and public-intake job. Migration 041 retains immutable native content, typed field/presence states, attempt reservations, capture receipts/source slices and accepted versions; bounded stored-only pages pin an immutable version for continuation. New captures of unchanged content retain distinct original observation evidence; replay retains its original result and timestamps. Partial, invalid, conflicting, empty and unavailable captures preserve the last accepted version. No roster linkage, recurrence activation, frontend/account behavior or projection pipeline is added.

The strict transport retains decoded JSON text and hashes its UTF-8 representation; this excludes a removed BOM and is not a wire-byte archive. Native JSONB is derived from that text, while TypeScript readers use ordinary JavaScript JSON number semantics. Precision-changing/nonfinite numbers and unsupported escaped Unicode retain raw-only unavailable evidence; malformed UTF-8, literal NUL and over-limit bodies retain failure evidence without raw text. Duplicate diagnostics are bounded; authoritative raw text and SQL-derived duplicate counts persist. Source clocks are informational: ordering uses database reservations/generations, and live owner checks run before and after waits and before commit.

Independent catalog/storage and qualification-wiring source review corrected the generated-hash volatility, SQL whitespace literal, replay-result, shared-admission side-effect, clock-domain and resource-amplification issues before any database execution. The fixed `data-player-directory-v1` profile binds six ordered cases and one hook pair to fixture LF SHA256 `c35a72eab57663a635a4e053f2a3ff2a17dcb7c4d44d610ed7af76c51322eaa9`. Its module joins ordinary full discovery (now 49); older selected modules, names and digests remain unchanged. Scope baselines, preserved checkpoints and allowed paths/patterns remain unchanged.

Offline profile, actual installed network-blocked synthetic reporter and mocked CLI checks passed **148/148 across 3 files, zero failures/skips**. Report `apps/site/test-results/data-backend/cp5-qualification-offline.json` has SHA256 `185c1dac74262efaffa3992447cac11fd3cda84c04c368244ce631b9bee73a96`. An earlier development run recorded 135 passes/13 failures after a concurrent fixture amendment prevented the initial pin: five pending-digest failures and eight obsolete 48-module expectations. The corrected pin/count produced the final pass; no SQL module was imported. YAML parsing and extracted-shell stub dispatch passed all 16 allowed mappings and rejected 6 invalid inputs, with zero actual supervisor/SQL/provider invocations; evidence is `test-results/data-backend/cp5-workflow-bf7ebea0-e459-45e3-ba21-309b27f197fe/result.json`, SHA256 `f0f867783e22b091c4f018ffea21a49e816167b0e3fc64335938a2eaba5386aa`. Wiring lint and scope checks passed. Complete candidate verification remains separately recorded by the coordinating task.

The six SQL cases were **authored, unexecuted and unqualified at source publication**. The separately authorized run below supplies subsequent SQL evidence. Repeated observations use disclosed owner setup of mutable directory cadence clocks; paused/expired admission negatives use fresh synthetic prerequisites. Neither is elapsed daily refresh or a live acquisition journey. The grant-restoration fixture reuses the existing role; fresh-role creation remains untested. Cleanup is designed to resolve only this fixture's work and wait through real minute admission spacing; mixed 49-module execution and fit remain pending. Transport limits (16 MiB, 2,000,000 values, depth 64, 100,000 rows) and the separate 64 MiB serialized storage envelope do not establish full-catalog or 20-second runtime fit; an oversized envelope currently fails before a receipt while its reservation remains. At source publication, actual restricted-LOGIN migration/SQL/readback, real full-catalog transport and persisted-size/latency qualification required a separately authorized bounded run with the unchanged identity, role, TLS, sentinel, denylist, ownership, source and cleanup guards. Even a passing six-case synthetic restricted-SQL run would qualify its fixture acceptance only; live full-catalog acquisition, stored-envelope size and 20-second operating fit would remain open. This source candidate does not complete CP5 or DATA and does not authorize provisioning, dispatch, installation, publication, merge or release.

CP5 complete-source verification history: the coordinating task reported dependency/peer and auth-dependency checks, full repository lint and final nonincremental Node 24 TypeScript passing. The retained `test-results/cp5-lint.log` records the lint command. The first full unit run recorded **6,456 passed / 1 failed / 1 skipped across 289 files**; unchanged `integration/public-data-refresh-diagnostics.test.ts` exceeded its existing 5,000 ms limit at 5,145 ms in the retained-receipt/provenance comparison case. Its isolated rerun passed **220/220** with unchanged assertions and deadline. Logs `test-results/cp5-unit-full.log` and `test-results/cp5-unit-diagnostic-rerun.log` have SHA256 `6eee6ecdfa4167bf67f637b37c21a3f86b1de9041f8571a87a4074c7cb2219ba` and `4fade754ce2c92cda0b1f661696ae895aa1f51ca0956a2f2c5eaf910e9c3cf92`. An unchanged full rerun repeated the same diagnostic timeout: 6,456 passed / 1 failed / 1 skipped across 289 files in 35.26 seconds (`test-results/cp5-unit-full-rerun.log`, SHA256 `b6474d03f2da3889a8352e2db3bde6b49bb1d5646ba3ebfb1764fd99da1e7d29`). The complete local run with `--maxWorkers=2` exited 0 with **6,457 passed / 0 failed / 1 skipped across 289 files** in 71.15 seconds (`test-results/cp5-unit-full-two-workers.log`, SHA256 `2cda98c72b56c8c208b8129e55634a967f1e5d36e030c8d8443e1049d0604836`), retaining every assertion and test deadline. This adjusted local concurrency differs from the default run. The isolated pass does not erase either failure or establish its cause; canonical hosted CI remains required.

The initial build wrapper launched nested pnpm with Node 20 and failed (`test-results/cp5-build.log`). Direct Node 24 filtered production build then passed (`test-results/cp5-build-direct.log`, SHA256 `0b9cb53c119cc8b88cc84a90d483ff47ff04622fc06f04f29c73b41a4d5d3ab9`); this was an execution-environment correction, not a source fix. Hosted/browser verification and actual SQL remain separate gates.

Canonical source verification subsequently closed at exact SHA `370ba5a0c94cfb21fa9fcbead8049beea041a843`: the coordinating task verified hosted [CI run 38023692574](https://github.com/clawmachinejed/league-one-audit/actions/runs/38023692574) succeeded with **6,458 unit passes / 0 failures / 0 skips**, **120 public-browser passes / 0 failures / 21 skips**, and **20 account-browser passes / 0 failures / 0 skips**. Vercel preview `6GtKfa3RctB6UikQX5SoNAHuNKRb` was Ready at the same SHA; the coordinating task inspected it in the in-app browser and verified 2026 League One and League Two manager views and the league selector. These hosted results close the earlier pending source CI/preview gates without erasing the local failure history. The ensuing evidence-only update leaves executable source unchanged; SQL qualification below remains bound to tested SHA `370ba5a0c94cfb21fa9fcbead8049beea041a843` and is not a new-head rerun.

## CP5 six-case restricted SQL qualification (2026-10-10)

After explicit approval for one bounded $1 attempt, protected workflow [38024557177](https://github.com/clawmachinejed/league-one-audit/actions/runs/38024557177), attempt 1, passed the fixed `data-player-directory-v1` profile at exact executable SHA `370ba5a0c94cfb21fa9fcbead8049beea041a843`. It collected, executed and passed **6/6 cases in one module**, with zero skipped, filtered, retried or repeated cases, no runner/hook errors, and exactly one completed beforeAll/afterAll pair. The fixture LF digest remained `c35a72eab57663a635a4e053f2a3ff2a17dcb7c4d44d610ed7af76c51322eaa9`. Independent Astra Ultra review recomputed source/context/profile/report bindings, inspected all 12 immutable receipt snapshots and ran only the existing read-only artifact validator; it accepted the six-case SQL result without another database run.

This qualifies the reviewed synthetic fixtures through actual isolated PostgreSQL and the genuine restricted runtime LOGIN: native/typed/stored-reader parity, fresh observations and immutable versions/replay, last-good preservation, reservation/evidence conflicts, restricted grants and immutable history, shared admission/daily reservation rejection, and rollback after an observed lock expiry. Repeated observations retain the disclosed owner setup of mutable cadence prerequisites; paused/expired admission negatives retain their synthetic prerequisite rows. No live provider call, elapsed 24-hour refresh or new production activation is claimed.

The supervisor lifecycle measured **145,074 ms**; Vitest reported **131.28 seconds** overall. The unchanged limits were 30 minutes for work, 40 minutes for the lifecycle including its 10-minute teardown reserve, and 50 minutes for the CI job, with a fixed 0.25-CU disposable child. The sole terminal outcome explicitly acknowledged immutable receipt `run-1791606935355-a98bbf4c-c19c-433e-b514-06374c31bb48-0012.json`, stage complete and qualification passed. POSIX process-group closure, schema cleanup, generated credential revocation and owned-branch deletion were all verified; failures and unresolved resources were empty. Run identity `e143028d-ad4b-4298-b51e-8e20cab01c0e` and the fresh context bound every artifact. The zero-byte base JSON is only the reserved journal path. One-hour branch expiry was a fallback, not the cleanup evidence. No automatic retry occurred.

Downloaded sanitized evidence is under `test-results/cp5-sql-38024557177/integration-370ba5a0c94cfb21fa9fcbead8049beea041a843-1`; the child files are in `artifacts/run-ruyLsC`. Independently recomputed SHA256 values:

- Acknowledged receipt `0012`: `63964eea5bd186515503a8c697dfdb64a925603b8f39ddd55a950cc14ab98067`.
- `qualification-report.json`: `501a91a219db78546083ebc602e8b0e78e3b18b4beb320b91cda0b2732ea6b0e`.
- `qualification-cleanup.json`: `b78802c7d55216046238240cf3eb0e68ac510103419d6569e7bbeddaef3b860e`.
- Downloaded workflow log `test-results/cp5-sql-38024557177.log`: `4d654cf19f3d39d8b1f035c04f3122a9b2d13a833364ff3a323ecfd21bcec724`.

The artifacts do not record the actual PostgreSQL server version or billed cost; both remain unmeasured. The $1 authorization was not an enforced provider billing cap. Live full-catalog acquisition, the 16 MiB transport and 64 MiB storage-envelope fit, 20-second operating fit, elapsed daily cadence, genuinely fresh-role creation and the full 49-module SQL suite remain unqualified. The source-publication failures and verification history above remain intact. This result qualifies only these six cases at the tested SHA; it does not complete CP5 or DATA or authorize another run, retained installation, merge or release.

## CP5 live full-catalog qualification candidate (2026-10-10)

**Data resource.** One real complete Sleeper NFL player directory, preserving native
rows, actual source captures, source version, typed fields and immutable accepted
history. This extends the existing six-case synthetic SQL evidence with a proposed
real catalog-size and operating-budget measurement; it does not replace that evidence.

**Existing path.** The closed manual-only `data-live-player-directory-v1` profile
selects one separately excluded live module through the existing disposable
supervisor and standard guarded setup. The case uses the same catalog loader,
public-intake owner, restricted writer and version-pinned stored reader, with actual
Neon HTTP transport and exactly one Sleeper `/players/nfl` GET. The existing limits
remain 16 MiB raw source, 2,000,000 values, depth 64, 100,000 rows, 64 MiB storage
envelope and 200 rows per page. No runtime, migration, scheduler or provider
configuration change is included; default full discovery stays 49 modules.

**Persisted result.** The candidate requires acquisition, normalization, guarded
acceptance, job completion and every stored-reader page to complete under the
same original 20-second clock, starting before claim. The clock is never restarted
for readback. Bounded aggregate stage timings distinguish accepted ingestion from
later readback failure; accepted ingestion alone cannot pass the combined check.
A passing qualification also needs the exact reviewed SHA/module/profile binding,
case and hook report, global cleanup acknowledgment and original supervisor
child/schema/credential/branch cleanup receipts. No raw catalog, player identities,
parameters or credentials are emitted in measurement artifacts. Source hashes and
nonsecret attempt, receipt and version UUIDs may identify retained evidence.

**Real proof and gaps.** This new candidate is authored and unexecuted. No live GET,
SQL, credentials or provisioning ran while authoring it. The proposed test retains
the fixed 0.25-CU disposable child and existing 30-minute work/40-minute lifecycle
limits; its 45-second case allowance permits failure reporting and cleanup without
extending the strict 20-second success budget. Actual full-catalog size, HTTP/SQL
request fit, ingestion/readback timing and combined success remain unmeasured.
The prior one-$1 synthetic SQL attempt was consumed; it does not authorize this
new live run. A new bounded authorization is pending after exact-source review
and publication. Production application, recurrence, CP6 roster linkage, retained
installation, merge and release remain outside this source candidate.
The live module was independently source-reviewed and pinned at LF SHA256
`a3216b2fc16b50e552fd5720d5b59fb21e696eb1f8a43b25d5854834f4e30a44`.
The focused offline profile, reporter and mocked-supervisor verification passed
**162/162 tests across three files**, with zero failures or skips. Its report is
`apps/site/test-results/data-backend/cp5-live-qualification-offline.json`, SHA256
`cbce7a2594df6e877278590cb2d5d1d671101823bc2167567785691a30669247`.
The new reporter coverage drives public callbacks against pinned source bytes
without importing the live module; unchanged network-blocked installed-runner
fixtures cover shared reporter mechanics. Neither exercises live PostgreSQL or
Sleeper. Source scope and diff checks passed. Full nonincremental TypeScript and
fixture lint passed after the development fixes; the four wiring/test files also
passed targeted ESLint. The first TypeScript run reported reader inference and
synthetic test typing errors, and the first wiring lint run rejected a reserved
fixture variable name. These were corrected before the passing checks; no checks,
source-binding guards or timeouts were weakened. Complete root verification,
publication, a new run approval and actual live measurement remain separate gates.
A diagnostic-only follow-up supersedes the live fixture in published candidate
`7022546258c8e1049c90dfb24989922546717b3c`, which was not executed against Sleeper
or PostgreSQL. The existing Neon HTTP observer now retains only bounded response
status, request ordinal and stage; it returns the original response without reading
its body or headers, recording its URL, or changing transport and deadlines.
Independent review accepted the new live LF pin
`4db8a8e3be986589d2a8e65c8662b20485347db48be83108b259500f5e574e9c`.
Every older profile/source pin remains unchanged. The same offline qualification
checks passed **162/162 tests across three files**, with zero failures or skips;
`apps/site/test-results/data-backend/cp5-live-http-status-qualification-offline.json`
has SHA256 `450927dee3d6e9e49251d276b43ef811a99fa7653690dc9aac7cb022e1b7beff`.
The earlier report is preserved. Full TypeScript and fixture lint passed, and no
SQL, live GET, provisioning or production action ran for this follow-up.

## CP5 live full-catalog qualification result (2026-10-10)

After explicit approval for one bounded $1 attempt, protected workflow
[38050136534](https://github.com/clawmachinejed/league-one-audit/actions/runs/38050136534),
attempt 1, passed `data-live-player-directory-v1` at exact executable SHA
`1257f8a4087c8e542ad6ba1b0b974761e6179bda`. It collected, executed and passed
**1/1 case in one module**, with zero failures, skips, filtered cases, retries,
repeats or unhandled errors, and one balanced `beforeAll`/`afterAll` pair.
This is subsequent execution evidence for the historical unexecuted candidate
entries above; those entries and the earlier synthetic six-case result retain
their original source bindings.

The live module LF SHA256 was
`4db8a8e3be986589d2a8e65c8662b20485347db48be83108b259500f5e574e9c`;
profile digest was `9bdccd0ab41ad829636981a1a70a975935b342cb5cc24f1e9459c5188fac7522`.
Run ID `30925585-6bed-47c7-8b51-db447067dd2c` and nonce
`25beacd6-63b5-4172-92c1-19bd4c431476` bound the source, report, capacity artifact
and cleanup acknowledgment through context digest
`4cd586755dd556113c69a49668c556532f563032849af1f18c24835816ebc847`.
The runtime reported Node `v24.21.0` and PostgreSQL `18.6 (c021049)` /
`server_version_num=180006`, on the fixed 0.25-CU disposable child.

The unchanged loader made **one Sleeper GET**, returning HTTP 200 and a complete
catalog without capture reasons. The genuine restricted runtime then accepted
one write through the existing Neon HTTP path and audited every stored page
against the original native capture under the same original 20-second clock.
The observed measurements were:

| Measurement | Actual result | Unchanged bound |
| --- | ---: | ---: |
| Stream, decoded source and stored raw-text UTF-8 bytes | 14,660,285 | 16,777,216 (16 MiB) |
| Native rows and stored rows read | 12,229 | 100,000 |
| JSON values / maximum depth | 691,010 / 4 | 2,000,000 / 64 |
| Compact serialized capture bytes | 37,447,585 | 67,108,864 (64 MiB) |
| PostgreSQL capture JSONB text bytes | 39,358,847 | 67,108,864 (64 MiB) |
| Instrumented Neon write HTTP request bytes | 44,192,256; HTTP 200 | Actual successful request; no new transport ceiling inferred |
| Stored pages | 62; terminal cursor reached | 200 rows per page, at most 500 pages |
| Existing owner acquisition/acceptance step, including job completion | 10,465.397552 ms | Within the original work clock |
| Complete work through full readback and final checks | 19,770.463353 ms | 20,000 ms |

All 67 observed Neon HTTP responses returned 200; the write was request ordinal 3.
The instrumented request includes measurement SELECT text and is not asserted to
be the exact uninstrumented production body size. The stored raw text retained
source revision `sha256:de339e9589bbe1f6d2ef9f5ac60e48157a6bd5a4a4e66780c373f1876f4ff880`.
Source-bound passing assertions establish raw-hash preservation, complete native
and typed parity, immutable version-pinned traversal, all 12,229 rows read, and
no extra provider acquisition. The artifact retains counts, hashes and nonsecret
provenance identifiers rather than raw player data. The accepted version was
`c6875cb4-ee64-4e1a-a03d-a599e7fb1cb0`, content
`5f770765-cd83-460c-81f7-1a5a8292dc71`, and receipt
`6a7db5b8-303d-4413-9820-647c91bf7a88`; isolated SQL data was subsequently removed
by the verified supervisor teardown.

The measured work left **229.536647 ms, approximately 1.15%**, below the original
20-second ceiling. Database preflight occurred outside that clock, so this is
one warmed, isolated observation of this catalog on 0.25 CU. It is not a cold-start,
concurrent-load, fleet-capacity, future-catalog-growth, elapsed daily-cadence or
recurring-freshness guarantee. The 45-second test allowance did not restart or
extend the success clock. Vitest's case duration was 19,772.325946 ms; its whole
invocation took 55.36 seconds including setup and teardown. Supervisor lifecycle
elapsed was 69,569 ms, within the unchanged 30-minute work/40-minute lifecycle
limits and 50-minute CI job allowance.

All 12 ordered immutable receipt snapshots retained the same run/source identity
and no recorded failures. Intermediate resource obligations were discharged;
the acknowledged terminal receipt
`run-1791633388340-ff3b3e22-b46d-4c15-876f-cf40f80c0546-0012.json` reported complete,
tests and qualification passed, POSIX process-group child closure, verified schema
cleanup, credential revocation and owned-branch deletion, with no unresolved
resources. The capacity artifact's `cleanupElapsedMs=null` means the already
completed owner needed no failure-cleanup attempt; it does not mean supervisor
cleanup was absent. The zero-byte base journal file is a reserved path, and the
one-hour branch expiry was fallback only. The one authorized $1 allowance is
consumed; actual billed cost is unmeasured, and the allowance was not a provider
billing cap. No automatic rerun occurred.

Downloaded evidence is under
`test-results/cp5-live-38050136534/integration-1257f8a4087c8e542ad6ba1b0b974761e6179bda-1`,
with child files in `artifacts/run-rCLCkW`. Recomputed SHA256 values:

- Acknowledged terminal receipt `0012`: `f3642c2d9686fc98fd0ae65b88cf1a9247258a7756553861766626b442948f03`.
- `live-player-directory-capacity.json`: `8ca9455a766592edecbd3fb9911cf7c5fc84d97e20184a3fd4fb94b3188d3350`.
- `qualification-report.json`: `86793a2aae2f7805943b3d05859e1a98c4a4d7f8c9f1980194033dd6b007f340`.
- `qualification-cleanup.json`: `be09845c2cad65dfdada75e61fac66ea924b7d974adcb77e8ce26086698d9cdb`.
- Parent `test-results/cp5-live-38050136534/workflow.log`: `c5cdf513f9595aa5f86af561e5d51e98575b20de7c557da723b7feb03104a49c`.

Separately, source verification [38045361596](https://github.com/clawmachinejed/league-one-audit/actions/runs/38045361596)
passed 6,472 unit tests across 289 files with zero failures/skips, 121 public browser
tests with 20 skips and zero failures, and 20 account browser tests
with zero failures/skips. The CI merge SHA
`3703306ddbdd31351e73f83dcd1206b76d7f1fd5` and candidate
`1257f8a4087c8e542ad6ba1b0b974761e6179bda` share exact Git tree
`4d43df362812d26fa0ca53fdefce74207556d7c2`. These source/browser checks are distinct
from the live SQL result. No retained installation, production migration,
automatic recurrence, CP6 roster linkage, merge or production release follows
from this isolated run.

Independent Astra Ultra review accepted the live artifacts using the existing
read-only qualification validator: 1/1 passed, zero skipped/filtered, exact binding
across all 12 receipts, terminal acknowledgment in the workflow log, complete
cleanup and the measured full-readback result. This review made no new SQL or
provider request. It also confirmed that the implementation libraries, migrations,
synthetic fixture, dependencies and harness carrying the six-case SQL proof at
`370ba5a0c94cfb21fa9fcbead8049beea041a843` remain unchanged for the live source.
That prior restricted-role proof therefore carries forward; the live run at
`1257f8a4087c8e542ad6ba1b0b974761e6179bda` adds the sampled transport, storage and
complete-reader qualification.

**CP5 implementation and resource qualification are complete within the recorded
acceptance-baseline scope.** The change remains unmerged and uninstalled in
production. The narrow warmed timing result above does not establish a robust
performance guarantee. Genuinely fresh-role creation, elapsed daily cadence,
the full 49-module SQL suite and production rollout remain separate unqualified
obligations; independent review did not identify them as blockers to this CP5
resource checkpoint. This does not complete DATA as a whole or authorize another
paid run, deployment or automatic acquisition.

## CP6 source candidate scope (2026-10-10; qualification pending)

- **Data resource:** accepted Sleeper current-season (2026) held roster membership and evidenced canonical player/team-defense links, retaining each roster observation's immutable history and native category evidence.
- **Existing path:** the existing administration normalization and `record_league_administration_observation` acceptance transaction; existing canonical identity owner in `projections/adapters/neon/identities.ts`; accepted roster and public DATA readers. Add migration 042 and receipt-bound link reads without another worker, feed or acquisition path.
- **Persisted result:** one immutable link snapshot per newly accepted players receipt, bound to league-season, source mapping, season-team, native player ID, roster observation and one accepted directory version when available. Missing directory evidence remains explicit and unresolved. Freeze canonical mapping/kind proof or an explicit unresolved reason. Complete empty membership is retained; incomplete captures preserve the last good acceptance. Link capacity is explicit (1,000 teams / 10,000 memberships), never silently truncated.
- **Required proof and present gaps:** source/unit verification and independent exact-diff review precede a frozen restricted-role PostgreSQL qualification covering identity reuse, native parity, historical reads, replay, category changes, concurrency, real lock expiry/rollback, isolation and negative permissions. No CP6 implementation or SQL result is yet qualified. CP5's two paid allowances are consumed; this source approval permits no paid run, provisioning, retained migration application, merge or production activation.

Independent Astra Ultra reviewer `/root/cp5_review` confirmed the specific migration, shared identity extraction/compatibility, provisioner grant, focused test-support, store-composition and opt-in reader paths before authoring (review reference `DATA-CP6-2026-10-10-ROSTER-PLAYER-LINKS`). The shared identity helper is capability-gated: absent schema retains the exact legacy implementation; an installed helper's error never falls back. Each accepted linkage transaction rechecks its existing fence/deadline after potentially blocking identity work. Reads perform no identity mutation or provider calls. Existing players-only v1 policy and hashes remain unchanged; DATA opt-in enriches held players and groups from the same validated frozen evidence while exposing link coverage separately. Omitted opt-in retains legacy output. The same independent reviewer confirmed the exact qualification profile, test and workflow wiring paths before authoring; final source review accepted their closed selector and preserved safeguards.


### CP6 reviewed source and qualification boundary

The dedicated branch `codex/data-roster-player-links` starts at qualified CP5
head `6ad380e10911eae1e274b9c96c8b1217613a45da`. Before implementation and again
before preview publication, local/GitHub main and the actual Vercel production
source agreed on `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`. Vercel remained bound
to `clawmachinejed/league-one-audit`, root `apps/site`, production branch `main`,
with Ready production deployment `8C3YSnXRCbmPETftQgRtirfyck5e`. Primary main
remains clean. Open branches and deployments showed no competing release owner;
this does not assert the absence of other tasks or qualify worker leases.

Independent Astra Ultra review accepted migration 042 at SHA256
`7d1f8658258c3e1a792a7b1765efb3ab0a4ccd5d8c8da3466029b00a6fea24db`, the shared
identity adapter/grants, immutable readers, DATA opt-in composition and nine-case
fixture. The maintained fixture's frozen LF SHA256 is
`0d2f9c729b2631a8a975410138e4cd56741a3ca1812205a39bf35daa7648908e`.
The closed `data-roster-player-links-v1` profile requires all nine collected cases
in chronological source order with one setup/teardown pair and no skips,
filtering, retries, repeats or unhandled errors. Normal discovery now contains
50 modules; all older closed source pins and live exclusions are preserved.

Review corrected native-ID index sizing, exact PostgreSQL timestamp precision,
JavaScript whitespace parity for kind evidence, strict JSON string source IDs,
identity validity after lock waits, and cleanup retaining canonical entities
referenced by immutable historical links. The shared identity helper samples
one post-wait validity instant immediately before its distinct resolve statement;
its installed error never invokes the legacy fallback. A real SQL oracle
requires a fresh canonical insert to sort before the observed blocking identity,
then checks rollback of identities, content, receipts, links and accepted heads.
These are authored assertions, not execution results.

Focused reader/wiring checks passed 419 tests across seven files with zero skips;
the final pinned qualification/profile/reporter/supervisor subset passed 177 tests
across three files, also with zero skips. Storage/identity compatibility checks
passed 130 tests across five files with zero skips; the final internal helper
rename was additionally checked by its nine identity tests. These overlapping
runs are not added together as a unique test total. Targeted lint passed. The
workflow's extracted shell was exercised only with a print stub: 18 allowed
combinations passed and six invalid combinations were rejected; no supervisor,
provisioning, provider request or SQL ran in those checks.

Early source development checks exposed incomplete fixture typings and test
expectations, and review caught two SQL template/dollar-delimiter mistakes.
They were corrected before the frozen review. No installed PostgreSQL parser
was available, so actual migration compilation remains part of the required
SQL qualification. The first complete local verification attempt stopped after
scope checking because nested pnpm used system Node 20; an ignored task-local
launcher routes the unchanged commands through required Node 24 without changing
project dependencies or package scripts. Its final result is recorded separately.

No CP6 paid qualification, retained installation, migration application, live
Sleeper acquisition, merge or production activation has occurred. The proposed
next run is one protected disposable 0.25-CU attempt under the existing $1
allowance model, only after new exact-source approval. Previous CP5 allowances
are consumed; actual billing is not measured and the allowance is not a provider
billing cap. Original limits remain 20 seconds per ordinary work step, 30 minutes
of supervisor work, 40 minutes total lifecycle and 50 minutes CI. The nine body
allowances total 29 minutes plus up to two 120-second hooks, so worst-case sum
exceeds the hard work cutoff. Actual fit is unmeasured and no retry is implied.
A successful run must show nine passing cases and acknowledged child, schema,
credential and owned-branch cleanup. CP6 remains pending that qualification;
manager facts, genuinely fresh roles, recurrence/fleet targets, the full SQL
suite and production rollout remain separate later obligations.

### CP6 local verification before publication

The final complete local `pnpm verify` invocation passed scope, dependency,
lint and type checks, then reported 6,529 unit tests passed, one failed and one
skipped across 292 files. The only remaining failure was the unchanged
`public-data-refresh-diagnostics.test.ts` case "exposes every retained receipt,
provenance, capture and manager identity field within realistic full operands":
5,058 ms against its original 5,000-ms timeout under the complete parallel suite.
The prior full invocation showed the same timeout at 5,221 ms plus one stale
reader-options expectation. Independent review approved updating only that
expectation to include `includePlayerLinks: true`; it now passes. The expensive
case passed separately with its original limit (one passed, 219 filtered;
approximately 2.40 seconds of test work). No timeout, worker setting, selector,
assertion or production behavior was weakened to make the full suite pass.

The one environmental skip is the pre-existing scoped-local-IPv6 browser-target
case: this host has a non-loopback IPv4 interface but no scoped IPv6 interface.
The latest local complete workflow remains failed; an isolated pass is not a
substitute. Canonical Linux source CI and browser results will be recorded for
the published exact candidate, separately from this local result. Retained
ignored logs are `apps/site/test-results/data-backend/cp6-source-verify-final.log`
and `cp6-diagnostic-timeout-reproduction.log` in the same directory.

The standalone unchanged production build passed under Node 24. Independent
review confirmed that the sole diagnostic expectation repair and conditional
IPv6 skip do not block draft publication, while the local complete verify
result remains failed pending the separate canonical CI result. Final
prepublication scope checking passed with 85 reviewed extensions, five
governance paths and 31 DATA paths; the exact diff remains within reviewed CP6
source scope. No paid execution or production action follows from publication.

### CP6 first PostgreSQL qualification attempt — failed, cleanup verified

The user approved exactly one protected disposable attempt at frozen source
`c7c1ab94c9f3c7fe91325205e8370dd78cac6261`, using the closed
`data-roster-player-links-v1` profile, 0.25 CU and a new $1 allowance under the
unchanged 20-second ordinary work, 30-minute supervisor work, 40-minute lifecycle
and 50-minute CI limits. [Run 38054471625](https://github.com/clawmachinejed/league-one-audit/actions/runs/38054471625),
attempt 1, was manually dispatched and its protected environment approved only
after the recorded exact-SHA/source review. No competing integration run was
observed. The reusable test-project credential was reused inside CI; no local
credential was retrieved, created or rotated.

**Result: nine collected and executed cases, nine failed, zero passed, zero
skipped/filtered/retried/repeated and zero unhandled errors. CP6 remains
unqualified.** Six cases reported PostgreSQL `42883` because a bare `team`
reference in the new trigger's size estimate resolved the joined directory's
text `team` column instead of the local JSON set-returning-function alias.
Two cases reported `42702` because two JSON functions exposed default `value`
columns and the shared identity validation referenced `value` without a column
qualifier. The ordinary intake case returned `unavailable` instead of `progress`;
its output does not expose the underlying SQL error, so attributing that final
failure to the same defect is an inference, not an independently reported cause.
The migration was installed in the disposable schema, but these function-body
statements failed when executed; source/build tests did not detect them.

The supervisor run was `9afd69bc-485b-4bde-ae34-fde9c685d2fc`, from
`2026-10-10T13:07:41.046Z` through `13:13:42.404Z`, with recorded lifecycle
361,448 ms. Vitest took 349.44 seconds. The terminal acknowledgment at
`13:13:42.4160614Z` records failure only for tests, verified POSIX child-tree
closure, schema cleanup, generated database-credential revocation, deletion of
owned branch `br-snowy-pond-b7ubuhrz`, no unresolved resources and no production
writes. The cleanup acknowledgment is bound to the exact failed report; cleanup
success does not turn failed tests into qualification. The one-hour branch
expiry was fallback only. No separate post-run Neon API probe or measured billing
is claimed. The single $1 allowance is consumed, is not a provider billing cap,
and does not authorize another run.

Downloaded evidence is retained under
`test-results/cp6-38054471625/integration-c7c1ab94c9f3c7fe91325205e8370dd78cac6261-1`,
with the report/cleanup pair in `artifacts/run-u97TK1`. SHA256 values:

- Acknowledged terminal receipt `run-1791637661042-ea183c8a-70e1-469c-955b-81b3ea66558c-0012.json`: `2b4ddafa27fcc5b971806e49c1a9621f3155e0e9ce440f0f923aa8aa649c1d79`.
- `qualification-report.json`: `e9ae2166c58b466f0be3e599a2f61a25ff268e33ce86dbd897414ab6a1babf67`.
- `qualification-cleanup.json`: `bad31a22e85857b3dd67f94e03e2498a85cf94ba687ca0349d355034b7290e8f`.
- Parent `workflow.log`: `98778594b4553ec1fa1d2b6a7d80eee3c2f6e483b8ab49a5ffb5ba26155f41ca`.

The separately passing [source CI 38053548430](https://github.com/clawmachinejed/league-one-audit/actions/runs/38053548430)
remains evidence only for source/build/browser checks: 6,531 unit tests across
292 files, zero failures/skips; 121 public browser passes with 20 intentional
account-fixture skips; 20 separate account browser passes, zero failures/skips.
CI merge `5db079f10670be0947f1f1b66573c2dd954c1383` and candidate share Git tree
`540ddd6a13c391731ebe5674ba0a0278719566a1`. Actual Ready preview
`H3makh6pTZmk3xtcjALL1HYVMdZC` was inspected for League One, League Two and Dynasty.
Neither source CI nor that preview supersedes the failed SQL result. No merge,
retained installation, production migration, scheduling or release occurred.

Independent Astra Ultra review verified all twelve receipt sequences and their
run/source/project/branch bindings, the exact report and balanced hooks, and the
terminal acknowledgment. The existing read-only artifact validator correctly
rejected the failed report: `testEvidenceFailure: missing-or-invalid` denotes
failed qualification here, not absent artifacts. The zero-byte unsequenced JSON
file is a reserved journal path, not a missing terminal receipt. Cleanup proof
and failed qualification remain separately recorded.

### CP6 source repair after the failed attempt

Independent reviewers and the coordinating agent traced the recorded PostgreSQL
positions to the two name-resolution errors before repair. The narrow repair
changes only migration 042: JSON set-returning functions and the two scalar
position-clue functions receive explicit output-column aliases, and all operands
in their affected scopes are qualified. This includes the related identity-lock,
cleanup, raw-roster, candidate/result and final-link statements, without claiming
an additional observed failure in those later statements. No casts or exception
swallowing conceal either defect. No predicates, capacity bounds, lock keys or
order, fences, grants, ordinality, public interfaces or fallback behavior change.

Independent Astra Ultra exact-diff review accepted repaired migration LF SHA256
`73bd322087d3de51bc65446d38661aaadfffd81e096202e7168656c968ee0f0c`.
The nine-case fixture, all profile pins, dependencies, runtime limits and original
assertions remain unchanged. Its existing nine actual SQL cases are the
regression oracle; no source-text test is substituted for PostgreSQL execution.
The existing nine identity-adapter tests passed with zero skips. Further source
checks and the repaired candidate SHA are recorded with PR295; none can qualify
SQL paths that the failed attempt did not reach. This repair is unqualified until
another explicitly approved frozen-source run passes all nine cases and cleanup.
No rerun, paid provisioning, retained migration, merge or production action is
implied by the source repair.

Post-repair source verification also passed all 177 profile/reporter/supervisor
checks across three files with zero skips, and scope/diff checks passed. Together
with the nine identity-adapter cases these are 186 distinct focused source tests;
none execute PostgreSQL. Before repair publication, local/origin/GitHub main and
Vercel production still agreed on `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`,
with the same canonical repository, `apps/site` root and production branch `main`.
Primary main remains clean. Only migration 042 and this evidence ledger changed
from the failed candidate; the fixture LF hash and every profile pin are preserved.

### CP6 second PostgreSQL attempt — seven passed, two fixture failures

The user separately approved one new attempt at repaired source
`fd04228756d2ef9c300c4e97e750a923ca908ae6`, under the same closed nine-case
`data-roster-player-links-v1` profile, 0.25 CU, new $1 allowance and unchanged
20-second ordinary work / 30-minute supervisor / 40-minute lifecycle / 50-minute
CI limits, with no automatic retry. [Run 38056628125](https://github.com/clawmachinejed/league-one-audit/actions/runs/38056628125),
attempt 1, executed once after exact-SHA and protected-environment verification.
Local/origin/GitHub main and Ready production remained
`87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`; canonical Vercel repository, main
production branch and apps/site root matched. No competing integration run was
observed. No production or retained database was targeted.

**Result: nine collected/executed, seven passed, two failed, zero
skipped/filtered/retried/repeated, zero unhandled errors, one balanced shared
setup/teardown pair. CP6 remains unqualified.** All prior SQL alias errors were
absent. Passing cases covered unresolved official membership, canonical reuse,
explicit conflicts/native edge cases, accepted-head/source remapping, actual
concurrent identity reuse and post-wait mapping validity, capacity and negative
permissions, and the ordinary 2026 intake plus one real refresh and stored-only
readback. The last journey passed in 609,196 ms. These are source-bound executed
assertions, not an all-nine pass or complete backend/fleet qualification.

The history case stopped at its exact-replay comparison: accepted status,
receipt and generation matched, but actual reason `exact_receipt_replay` differed
from the fixture's expected original null reason. Existing migrations 027/029/039
and the maintained current-roster-acceptance case explicitly define that replay
marker. The fixture expectation was incorrect. Subsequent snapshot/state,
partial/category/corrected-identity and empty-history assertions in that case
were not reached and remain unqualified by this run.

The rollback case stopped before its lock/rollback checks, while its directory
prerequisite tried to acquire the shared job. Its failure retained neither the
returned claim kind nor scheduled time. Independent offline reproduction found
that the installed Neon timestamptz parser returns a Date, while the fixture's
`new Date(String(row.at))` loses milliseconds. Two database timestamps inside
one second then become the same scheduler slot; the existing job owner correctly
requires a strictly newer slot after completion. This reproducible fixture defect
is consistent with the failed 389-ms transition after the preceding case's
directory capture. The historical collision is an inference, not a reconstruction
of unretained run values. The deadline/lease rollback assertions were not reached.

Supervisor run `bd9c7ab8-2fe8-4ac6-9aeb-6f0ccaeb9968` ran from
`2026-10-10T13:41:22.085Z` to `13:53:57.503Z`; lifecycle was 755,545 ms and
Vitest duration 743.24 seconds. The terminal acknowledgment at
`13:53:57.5152961Z` confirms POSIX child-tree closure, schema cleanup, generated
credential revocation and deletion of owned branch `br-snowy-haze-b72nsdcv`, with
failures only `tests`, no unresolved resources and no production writes.
Independent review verified all twelve journal sequences, report/context/source
bindings, cleanup acknowledgment and the maintained offline validator's correct
rejection of the failed report. The generic `missing-or-invalid` category again
means failed qualification, not missing evidence.

During this run, read-only Neon Console inspection identified that exact child,
its run-UUID branch name, parent and project as **PostgreSQL 18**, default compute
0.25 CU. The retained witness and subsequent supervisor receipts match. This is
provider-reported major-version evidence; SQL-reported patch/build was not
measured, and no prior CP5 patch version is borrowed. After cleanup, a separate
read-only Console branch listing showed only the integration-test baseline.
No extra SQL, credential retrieval or provider-data acquisition was performed.

Artifacts are retained under `test-results/cp6-38056628125`; downloaded report and
cleanup are in `download/integration-fd04228756d2ef9c300c4e97e750a923ca908ae6-1/artifacts/run-oDRZZA`.
SHA256 values:

- Report: `4927199212ef34a67c57e85870f568e94a41babdf506258468af44e58fd41cdc`.
- Cleanup acknowledgment: `3ecc5c1ae6b01ec21724f1c14b71e03e5ecb83111ebf3dcd039b57c546a2c5a8`.
- Terminal journal `run-1791639682079-f42bbf9e-4d34-4860-a3b2-341682f3d13a-0012.json`: `aa14a85c4dd915c0ad65f622c19c1ff41a6336174bdce0d3844229b3f809631b`.
- Workflow log: `25b39931299d597f50261253cdaec5a3751e1a4a14f01bcce0475f2d2b2932f3`.
- Provider Console witness: `b16aa140fd3fa93cb289586b59371cd0e47039285abe67562b921d6ec5a3781a`.

The second one-run allowance is consumed as execution authority; actual billing
was not measured and $1 is not a hard provider cap. No third run follows from the
failed result or repair. No merge, retained installation, production migration, activation or release
occurred.

### CP6 fixture correction after the second attempt

Independent Astra Ultra review approved three fixture-only changes: preserve a
returned Date directly before ISO serialization; include only the bounded claim
kind and scheduled timestamp in a failed-claim diagnostic; and require the
existing exact-replay marker while retaining strict status/receipt/generation,
snapshot and full-state equality. No scheduler, application or migration code,
SQL calls, waits, leases, timeouts, retry counts, case names or suite hooks change.
The reviewed module LF SHA256 is
`652a0be4ac216af1a8fd17b03f19a05e8be09f0529a4afe6b7c37ad153d640d0`;
only its CP6 qualification pin changes. All older profile pins remain unchanged.
Migration 042 remains LF SHA256
`73bd322087d3de51bc65446d38661aaadfffd81e096202e7168656c968ee0f0c`.

The independent offline reproduction extracts/transpiles the actual old and new
fixture functions, uses the installed Neon parser, and calls the maintained job
methods against an explicitly modeled scheduler predicate. The old Date path
collapses .100/.489 seconds and rejects the second completed-slot claim; the
repair retains .100/.489 and reacquires. String timestamp fallback remains
correct, and network attempts are zero. This is source evidence, not PostgreSQL
execution or proof of the unlogged historical timestamps. Ignored reproduction
script `apps/site/test-results/data-backend/cp6-job-clock-reproduction.cjs` has
SHA256 `2bca0b33cc759929b5d7196f4624a65d29ece1e3de82ec4345f8e410e3587504`;
its log has SHA256 `bbb74219f681539f9389b55003f76cf333988a16c177cfbb9bf10eb8fc618ba2`.

All 177 offline profile/reporter/supervisor cases passed across three files with
zero skips, and targeted lint and type checking passed. Final candidate SHA,
source CI and preview evidence belong with PR295. These fixture corrections
require a new separately approved exact-source SQL attempt before CP6 can be
qualified; seven passes at the preceding source do not qualify the new fixture.

### CP6 third PostgreSQL attempt — accepted nine-case qualification

**Checkpoint 6 implementation and resource qualification are complete within the
recorded 2026 scope.** The user separately approved one attempt at frozen source
`93c18e588f7bcead866b6e3e3f087b8a691dcee6`, using the unchanged closed
`data-roster-player-links-v1` profile, 0.25 CU, a new $1 allowance, the original
20-second ordinary work / 30-minute supervisor work / 40-minute lifecycle /
50-minute CI limits, no automatic retry and verified cleanup.
[Run 38059763318](https://github.com/clawmachinejed/league-one-audit/actions/runs/38059763318),
attempt 1, ran once after exact-source and protected-environment review.
Local/origin/GitHub main and Ready Vercel production agreed on
`87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`; the canonical repository, apps/site
root and main production branch matched. No competing integration owner was
observed; the test project contained only its baseline before this run.

**Nine collected, executed and passed; zero failed, skipped, filtered, retried,
repeated, flaky or unhandled errors.** The complete ordered suite and its two
once-only setup/teardown hooks passed the maintained offline artifact validator
and independent review. Both previously blocked cases now completed: history,
corrections, categories, exact replay and partial/empty preservation in 7,492.04717
ms; observed identity-lock deadline/lease expiry with full rollback in
21,997.095098 ms across the two scenarios. This latter whole-case duration is not
one ordinary work attempt or an expansion of its unchanged deadline. Ordinary
public intake, one real refresh cycle and stored-only readback passed in
612,107.762037 ms. The remaining cases passed native unresolved membership,
canonical reuse across leagues/kinds, explicit conflicts/native edge cases,
accepted ordering/source remapping, actual concurrent identity creation,
capacity outcomes and negative permissions. HTTP inputs were synthetic; the
prior CP5 live full-catalog result remains separately bound evidence.

Supervisor run `28c1c80d-6d30-4df2-9b76-f18a65d8b161` started at
`2026-10-10T14:29:37.348Z` and finished at `14:42:45.238Z`. Lifecycle was
787,998 ms; Vitest duration was 775.76 seconds. The workflow job took 13m32s.
The exact terminal acknowledgment at `14:42:45.2517010Z` confirms tests and
qualification passed, POSIX child-tree closure, schema cleanup, generated
credential revocation and deletion of owned branch `br-bitter-lake-b7utmpsl`,
with empty failures and unresolved resources and no production writes. All twelve
immutable journal sequences, context/source/report bindings and cleanup
acknowledgment were independently verified. A fresh read-only Neon Console
listing after completion showed only `integration-test-base`.

Read-only Console evidence collected during execution binds this exact child,
run-UUID branch name, parent `br-plain-bread-b7sgfdl8` and project
`steep-glitter-44680287` to **provider-reported PostgreSQL 18** and default 0.25 CU.
SQL-reported patch/build and actual billing were not measured. The child was
created at `14:29:38Z` and had `15:29:38Z` fallback expiry; observed deletion,
not expiry, establishes cleanup. No extra SQL or credential retrieval was used
for the version witness. The one-run allowance is consumed as execution
authority; $1 is not a hard provider billing cap.

Artifacts remain under `test-results/cp6-38059763318`; downloaded report and
cleanup are in `download/integration-93c18e588f7bcead866b6e3e3f087b8a691dcee6-1/artifacts/run-LcIN1e`.
SHA256 values:

- Report: `884d0585055b9a594455b902bb64a2018ac4f4464263c54905458646fb930314`.
- Cleanup acknowledgment: `a85c29ae29e021ef9a917ba3439f6b8b270778b4a2e59e0ae3625c9a7fb70fca`.
- Terminal journal `run-1791642577342-a2dba1f0-1e4c-4b2d-80dd-adadb577d983-0012.json`: `57b926493f2a6a22d6e2b92015bede732d511b5822b83a55fa03a9921fd50fa8`.
- Workflow log: `55864462ba9afaccc95b1b1ebfe255e0c00be34197786dbbbc17c314b34706e9`.
- Provider Console witness: `25e8b1b84f97c14f7dd738358c113111fa55d034efe10907e247615acf83acaa`.

Context digest is `da5f6017069982b57f7f8b1916838c7cf76225c29e55c069ef9b882b11a01ba5`;
profile digest is `4e5582dab661b8e1cf37581d24f8a37a4f08e7a05c87c6b4a5a4f1d74c482635`.
The fixture LF digest remains `652a0be4ac216af1a8fd17b03f19a05e8be09f0529a4afe6b7c37ad153d640d0`;
migration 042 remains `73bd322087d3de51bc65446d38661aaadfffd81e096202e7168656c968ee0f0c`.

Executed source `93c18e5` already passed [source CI 38058123736](https://github.com/clawmachinejed/league-one-audit/actions/runs/38058123736):
6,531 unit tests across 292 files, build, 121 public-browser passes with 20 expected
account-fixture skips and 20 separate account passes, with no actual retries.
CI merge `0f469b23e30414a09a2510e8c242e0782881e950` and candidate share tree
`c7fdc95037f01be97f41f4a712f32297c5b773a5`. Ready preview
`29dfCzqhVbNw7D7NbKBC6iWB4gsx` was verified at that exact source; My Fantasy,
League One, League Two and Dynasty manager views were inspected successfully.

This closeout changes documentation only and preserves the executed source
binding. Both earlier failures remain historical evidence. CP6 does not complete
fresh-role provisioning, process-crash recovery, sustained worker fairness,
daily recurrence, fleet/freshness/request/reader/storage/restore targets, the
full 50-module SQL suite or complete backend readiness. No further paid run,
retained installation, merge, production migration, activation or release is
authorized by this result. The next resource checkpoint is 7: manager facts,
commissioner distinct from ownership, changes, vacancies, co-owners and directory
failures.
