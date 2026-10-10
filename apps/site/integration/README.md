# Disposable Neon integration tests

`pnpm test:integration` creates a fresh test branch, runs the existing destructive SQL suite, verifies cleanup and credential revocation, and deletes that run's branch. It never reads the old `apps/site/.env.integration.local` file. Retained pilot data and production remain separate from test infrastructure.

The dedicated test project is `steep-glitter-44680287` (`league-one-integration-tests`). Its empty baseline must have no application relations, functions, custom types, managed `neon_auth` schema, or inherited application roles. Each run uses the repository's migrations; default and ordinary profiles use synthetic fixtures, while separately authorized live profiles use their explicitly bounded public captures. The baseline is not a copy of retained accounts and is not the target of destructive tests.

The authoritative source-bound results, failed-attempt history, cleanup evidence and remaining qualification are maintained in [DATA evidence](../../../docs/aggregator-backend/data-backend-evidence.md). Use that ledger for current status; the profile descriptions below define their contracts and limits. The product serves supported Sleeper leagues through the shared pipeline; ClawMachineJedi, DannyPak, League One and League Two are test inputs. A selected case or non-SQL workflow pass does not establish full-suite or production-release qualification.

The production/retained project `solitary-base-99261075`, its production branch `br-rapid-boat-avgeevye`, its retained branch `br-still-breeze-avaibago`, and the retained `projection_refactor_test` and `account_reset_integration_test` database names are explicitly denied. The shared SQL harness independently denies both branch IDs and both retained database names for every caller, including legacy migration and capacity commands, regardless of the supplied denylist or an old valid safety comment. Do not reset either retained database or rotate roles on that branch.

## One-time test infrastructure setup

The test project, empty baseline, verified database and owner identities, and scoped API credential must be configured before the first run. A project name alone does not establish readiness. Use an API key scoped only to this dedicated test project; do not use a production connection string or an organization-wide key as ordinary test configuration. Keep the baseline empty, without an application, auth, worker, or development client attached.

Reuse the dedicated project-only control-plane key stored in the protected `integration-test` CI environment across approved runs. Do not create or rotate it for each attempt. Every run still revokes its generated disposable database credentials and deletes its child branch; that cleanup does not revoke the reusable control-plane key. A local run may use an already authorized secured local control credential when available, without retrieving a CI secret or printing it. Rotate the control-plane key only for a specific credential-management need.

Create the ignored `apps/site/.env.integration-control.local` file. Revalidate these project/baseline/database/owner identities before activation:

```dotenv
NEON_TEST_AUTHORIZATION=I_AUTHORIZE_DISPOSABLE_TEST_BRANCHES
NEON_TEST_API_KEY=replace-with-dedicated-test-project-api-key
NEON_TEST_PROJECT_ID=steep-glitter-44680287
NEON_TEST_PROJECT_NAME=league-one-integration-tests
NEON_TEST_PARENT_BRANCH_ID=br-plain-bread-b7sgfdl8
NEON_TEST_PARENT_BRANCH_NAME=integration-test-base
NEON_TEST_DATABASE=integration_test
NEON_TEST_OWNER_ROLE=neondb_owner
```

The parent branch name must explicitly identify a test branch, and the database name must identify a test database. The API and server checks must agree on the configured identities. The `.env.*` ignore rule covers this control file. Never commit it, paste its key into a task, or publish it as a CI artifact.

Commit and review the intended test source before running it. The supervisor requires a clean Git checkout, records its exact SHA, and checks that the checkout and SHA remain unchanged after testing and cleanup. Ignored control files and receipts do not make the checkout dirty. From the repository root:

```text
pnpm test:integration
```

The same `NEON_TEST_*` values can be injected by a secured process environment instead of a local file. `pnpm verify:full` runs this gate only when the new control file exists or `NEON_TEST_API_KEY` is supplied. Without that configuration it reports SQL integration as **SKIPPED / UNVERIFIED**; deterministic and browser results do not substitute for SQL evidence. A configured but invalid control environment fails the gate.

## Optional bounded DATA profile

A separately authorized local invocation may select one ordinary source-to-stored-reader DATA case with the single closed argument --profile=data-core-ingestion-v1, or the existing two-core-cycle recovery case with --profile=data-core-refresh-v1. The ordinary case uses fresh canonical registration through the actual restricted LOGIN and no deliberate failure injection or owner-seeded enrollment. Both use fixture HTTP through the real adapter, not live Sleeper. Each profile binds its own exact test name and pattern to the reviewed 25-case module inventory and source digest: one selected execution, 24 filtered cases. Historical 24-case results remain evidence only for their original commit. No argument keeps the full suite unchanged. The supervisor refuses arbitrary file names, test filters, reporter/configuration overrides and unknown arguments. Both profiles use the same global setup, serial execution, actual restricted LOGIN, migrations and cleanup gates; neither adds a separate harness.

The `data-core-ingestion-v1` case checks one fresh username-to-stored-reader journey, canonical identities, typed official settings/roster/manager data and provenance through the actual restricted LOGIN. Its body has a 10-minute limit and a 9-minute polling loop; it does not exercise repeated refresh or injected recovery. The `data-core-refresh-v1` case uses fixture HTTP responses through the real adapter/coordinator, then actual isolated PostgreSQL and stored readers. It checks changed official settings and manager/player identities, preserved first-cycle history and unfinished-dispatch recovery. It does not qualify live Sleeper acquisition, matchup-period collection, the full SQL suite, production capacity or the entire backend. Its beforeAll/body/afterAll allowances total 26m30 within the unchanged 30-minute work budget, leaving 3m30 for all other setup, reporting and global teardown. The one passing `91aec119` CI run measured 791,967.448 ms for the case and 867,671 ms for the supervisor lifecycle, within those original bounds. That result qualifies the selected fixture-based recovery path, not full-suite or capacity fit. Exhaustion fails the run; it never borrows cleanup time or retries automatically.

The selected DATA cases retain only fixed operation names, bounded status/SQLSTATE categories and the seven actual fixed core-acceptance reasons. Unknown text is redacted and successful null reasons are omitted. If an original failure exists, diagnostics may inspect at most four exact immutable receipt/attempt bindings through a captured, guarded runtime-only reader. It reuses the existing Neon HTTP read-only transaction with a fixed one-second statement timeout and a fixed parameterized SELECT. The timeout validator expects PostgreSQL's canonical `1s` result for the `1000` millisecond input. Owned, fixed `transaction` and `result-validation` error boundaries distinguish a rejected driver transaction from local result validation without retaining error text. One shared five-second deadline bounds caller waiting, including response parsing; it does not prove remote cancellation or bound service queueing. No extra read runs on the successful path, no production acceptance rule changes, and secondary diagnostic failure cannot replace the original failure or prevent supervisor cleanup. The selected test assertions and full-suite inventory remain unchanged. See [current DATA evidence](../../../docs/aggregator-backend/data-backend-evidence.md) for failed-run history, cleanup and source-bound verification.

## Bounded official preconfiguration pair

`--profile=data-official-preconfiguration-v1` selects exactly the two existing R037 cases in the 25-case public-data intake module: committed-bootstrap recovery, then the nine-state scoring/slot matrix. The anchored closed selection requires both executions to pass and explicitly reports the other 23 cases as filtered. No new harness, arbitrary filter, runtime pipeline, retry or deadline extension is introduced. The shared module source digest is re-pinned after review; older core case names, bodies, selectors and inventories remain unchanged, while their source-bound profile digests necessarily follow the changed module. Historical passing proofs remain bound to their original commits.

The recovery case uses fixture HTTP, genuine minute-spaced restricted SQL admissions and an injected failure after canonical registration commits but before its bootstrap checkpoint. It requires the same NULL-profile canonical identity and mapping after recovery, two bootstrap attempts from distinct owners, complete core/directory reader availability, and inactive enrollment without worker activation. It is a committed-registration fault proof, not process-death or fleet-capacity evidence. The matrix uses an explicitly owner-enrolled synthetic identity; it is not fresh-intake proof. It distinguishes absent, null and empty scoring/slots, retains invalid optional fields with their raw evidence under the existing identity-only typed coverage contract, preserves the legacy accepted-configuration pointer for malformed input, versions later valid rules, and preserves the NULL canonical profile and earlier receipts.

The cases have independent random identities and their own shared restricted connection; they need no earlier case state. Their existing body limits total 11 minutes (10 minutes plus 60 seconds), with existing 120-second hook limits and unchanged global setup/teardown. This leaves headroom within the 30-minute work/40-minute lifecycle envelope but is not a measured runtime or billing guarantee. The same protected key, $1 authorization, 0.25-CU disposable child, identity/TLS/role/sentinel/denylist checks and acknowledged cleanup gates apply. Current source-specific results and limitations belong in the DATA evidence ledger.
## Bounded ingestion permission and work-fence guards

`--profile=data-ingestion-guards-v1` selects three existing cases in source order: concurrent selection/acknowledgment and sequential approval checks; private-helper/table denials and rejection after a job-row wait; then SQL selector validation and omitted/empty replay. The second case requires the first case's single persisted cycle. The intervening fairness case depends on a different acquisition fixture and is excluded. The closed profile requires exactly three passes from the unchanged 25-case module and reports 22 filtered cases. Existing case bodies, source digest, older profile digests and default 48-module inventory remain unchanged.

The refresh suite's focused beforeAll uses two genuine minute-spaced admissions against fixture HTTP to retain identity and an empty league list; owner enrollment supplies only the synthetic league prerequisite. It does not create the cycle needed by the second case. The existing 330-second setup and 60/15/60-second case limits remain, along with the shared 120-second hook limit and 30-minute work/40-minute lifecycle/50-minute CI limits. This bundle adds no live provider request or timing guarantee. It uses the same protected test-project key, 0.25-CU disposable child and guarded cleanup; no key creation or rotation is needed.

Coverage is narrow: concurrent selectors share one owner/fence. The lock case proves observed job-row blocking followed by rejection after a two-second work deadline, no refreshSelection job payload and preservation of the existing one cycle. The guard runs before new selection writes, so this is not rollback of newly inserted history, 25-second lease expiration or process-death recovery. The selector case removes/restores optional grants on an existing restricted role and reapplies maintained provisioner blocks; it is late-role-equivalent evidence, not fresh-role provisioning. Its private/PUBLIC EXECUTE and table-denial checks do not establish a complete grants or RLS inventory. Exact results and remaining gaps belong in the [single DATA evidence ledger](../../../docs/aggregator-backend/data-backend-evidence.md).

## Bounded live League Two core profile

`--profile=data-live-league-two-v1` is a separate, explicit opt-in to one source-bound case for repository bootstrap League Two ID `1378850360529014784`, season 2026. Its distinct `.live-integration-case.ts` suffix is excluded from default/full collection; both config and module require the validated matching supervisor context. The closed profile pins its module, LF digest, exact test name and one-case inventory, with the existing supervisor/reporter/global cleanup and no retries. It requires separate run authorization; source authoring and public read-only preparation authorize no SQL run or credential.

The test permits at most four GET attempts to exact Sleeper core paths: league metadata, then a new league capture, rosters and users. The existing adapter retains its 12-second timeout and the caller has a 20-second signal; each response stream is capped at 1 MiB, total 4 MiB. Redirects, extra requests and HTTP outside these four capture windows fail closed. Any failed capture ends the sequence. The case has a 180-second limit within unchanged aggregate 30-minute work/40-minute lifecycle bounds. Diagnostic artifacts contain no raw response bodies: they retain only bound hashes, sizes, timestamps and fixed failure classifications. On an original live-case failure, the existing finalizer restores the original fetch before the shared bounded receipt diagnostic reader runs. It may inspect at most four exact preserved receipt/attempt bindings through the guarded runtime-only read-only transaction under the existing shared five-second caller deadline. Successful cases make no receipt diagnostic request, and diagnostic errors or timeouts preserve the original failure and cleanup. The existing writer persists captured official data in the isolated database; separate read-only preparation snapshots remain ignored local files.

The proof uses existing official-data registration, explicitly inactive owner-created enrollment metadata, four reserved attempts before the three subsequent core GETs, `capturePublicSleeperCore`, `recordCapturedAdministration` and existing typed readers. Metadata setup creates no accepted observation, receipt or witness. The exact restricted read must prove one inactive canonical enrollment with a NULL calculation profile. With nonempty source scoring, the legacy league result must retain the exact scoring-profile compatibility rejection; the first roster/users writes must each return changed and all four typed resources must accept and pass full readback. This expected legacy rejection does not qualify calculation compatibility. The first live attempt failed at its season-inventory oracle; def3b372 then reached four preserved typed results and failed before readback. Both failures remain recorded. Source `e85c798` subsequently passed one CI case: all four GETs, four typed acceptances and every readback/value/lineage assertion passed, with complete acknowledged cleanup. The existing protected project key was reused and retained; generated database credentials and the child were removed. The failure-only receipt reader did not run on that successful case, so the earlier timestamp difference and failure cause remain unmeasured. See the current DATA evidence for the source-bound result and limits. This is the legacy operator capture/write path: it does **not** qualify username/identity/associated-league discovery, the five-stage intake owner or R039 witnessed acquisition. Legacy app/DB timing checks remain intact; no clock shift or sleep forces them to pass. Source scoring, ordered slots, roster/player IDs including defenses, owner/co-owner states and the independent user directory are checked against retained captures, alongside canonical normalization and exact receipt/mapping/population lineage. Partial optional co-manager evidence remains partial; mandatory typed resources must be available.

## Bounded refresh concurrency profile

`--profile=data-refresh-concurrency-v1` selects exactly five existing cases in source order: concurrent selectors/acknowledgments and sequential approval checks; competing configuration CAS calls; pause-first admission; approval expiry during an observed target-row wait; and admission-first capture with a competing pause. The first case deliberately retains cycle history without successfully admitting that cycle's identity step. This makes the CAS history-preservation assertion non-vacuous and leaves the final case a fresh identity admission. The fairness and private-helper permission cases are excluded. The closed profile requires five passes from the complete 25-case inventory, reports 20 filtered cases, and verifies exactly one shared beforeAll/afterAll pair. Default 48-module discovery and both live module digests remain unchanged.

Focused setup retains identity and an empty league list through two genuine minute-spaced restricted admissions and fixture HTTP. Owner enrollment supplies only the synthetic league prerequisite. The final case performs one more fixture identity GET through the existing capture helper with its DB-issued witness and preserves the original capture into the existing checkpoint. Its retained dispatch outcome must match that acquisition exactly. This test-side alignment covers the maintained witnessed flow; the prior omitted-witness path was permitted by the legacy SQL timestamp checks and is not evidence of a runtime defect. There are no fabricated identity/receipt/approval rows or live-provider claims, and the observed SQL barriers, deadlines and existing oracles remain intact.

Existing body limits total 340 seconds (four 60-second cases and one 100-second case). With the 330-second beforeAll and 120-second afterAll allowances, the selected suite has a 13m10 allowance before other harness overhead, inside the unchanged 30-minute work/40-minute lifecycle envelope. Actual fit remains a measured run result, not a guarantee. The protected reusable key, $1 authorization, fixed 0.25-CU child, 50-minute CI job, identity/TLS/role/sentinel/denylist checks and acknowledged cleanup gates are unchanged. No automatic retries are permitted.

The minimal final-case alignment changes the shared module's LF source digest. The ordinary, refresh, R037 and guards profiles share the reviewed re-pin while retaining their existing names, selectors and other case bodies. Earlier passing SQL evidence remains bound to its original source and does not qualify the re-pinned source. Current run results and remaining gaps belong only in the DATA evidence ledger; this bundle does not qualify general competing workers, process death, capacity, the full SQL suite or a production release.

## Bounded late-write registration rollback profile

`--profile=data-late-write-rollback-v1` selects exactly three source-ordered cases from the public intake module: restricted advisory-wait rejection, then canonical identity-row rollback with supplied scoring/slots and with official-only metadata. The closed profile requires all 25 collected names, exactly three executed passes, 22 filtered cases, and one start/end for each selected suite beforeAll/afterAll hook. Selected skips, retries, repeats and unhandled errors fail qualification. Both identity variants use the existing official-data registrar; the configured fixture means nonempty supplied rules, not the separate legacy configured-mode writer.

The cases need only their shared independent connection and existing global harness, not the preceding full journey or pruning case. The identity cases explicitly require fewer than 16 used fleet slots. Each obtains identity, league-list and bootstrap captures through three genuine admissions and three fixture GETs, with existing minute spacing and DB-issued capture witnesses. Total source traffic is six fixture GETs, not live Sleeper evidence. The advisory negative retains owner-seeded discovery and a synthetic negative capture, with no successful admission or provider request. Its corrected oracle must observe the exact runtime/blocker PIDs while the original one-second fence remains live, then wait for database-clock expiry; it cannot pass by rejecting before it reaches the lock. The two identity cases preserve their existing observed blocker and eight-second fence.

Rejection must leave no canonical league, source connection or capacity reservation and must retain the same pending work. An admitted identity-case bootstrap deliberately remains as one dispatch without an outcome after rollback; ordinary coordinator recovery in the following case accounts for prior unfinished work. The final logical dispatch may remain unfinished until guarded global teardown. Infrastructure cleanup does not mean every logical dispatch completed. No owner-written successful admission, fabricated receipt, backdated admission or alternate recovery is introduced.

Existing case allowances remain 60 + 390 + 390 seconds, with 120-second beforeAll and afterAll limits: 18 minutes before other harness overhead. The unchanged 30-minute work, 40-minute lifecycle, 50-minute CI job, 0.25-CU child and existing $1 test authorization remain; these are not measured runtime, cost or a provider billing cap. The same protected key, identity/TLS/role/sentinel/denylist, inventory, live ownership and cleanup guards apply, without automatic SQL retries. The advisory-only correction requires a reviewed shared-module digest repin; other case bodies, both live module digests and default 48-module discovery remain unchanged. Historical SQL evidence stays bound to its original source. Current source-specific results and gaps belong in the single DATA evidence ledger.

## Remaining intake recovery, history and period profiles

Four closed selections cover the eleven remaining intake names identified at documentation checkpoint `68b4628`. Each collects the unchanged 25-name intake inventory. They use the existing supervisor, protected project-only key and restricted-LOGIN harness; no live provider is selected.

| Profile | Selected cases in source order | Executed / filtered | Selected suite hooks |
| --- | --- | --- | --- |
| `data-intake-recovery-v1` | Core interruption/adoption; completed-job retention; configured identity-row rollback prerequisite; retained-cycle selector prerequisite; failed-selection fairness; twenty task ordinals/lineage | 6 / 19 | Three beforeAll/afterAll pairs, each once |
| `data-refresh-history-v1` | Retained-cycle selector prerequisite; two changed typed cycles prerequisite; two empty-list cycles; owner history immutability; sixteen pending requests; period metadata/replay/CAS; sixteen total targets | 7 / 18 | One beforeAll/afterAll pair, each once |
| `data-period-recovery-v1` | Dual reservations, receipt fences, observed lock expiry, lost acknowledgments and period preservation through core failure | 1 / 24 | One beforeAll/afterAll pair, each once |
| `data-period-exhaustion-v1` | Five real exact-period failures followed by available core without a fabricated checkpoint | 1 / 24 | One beforeAll/afterAll pair, each once |

The first two profiles repeat four prerequisite executions (three distinct previously passed names); together all four select fourteen distinct names and add eleven previously unexecuted names when they pass. Historical results cannot supply fixture state in a fresh disposable database. The configured identity-row case supplies fairness's genuine captured identity. Populated changed cycles and selection-failure history keep later preservation and immutability assertions nonempty. The total-target boundary remains last in the refresh suite because it retains sixteen paused metadata targets until guarded global cleanup.

The period-metadata fixture originally selected again after the pending-request case had settled its terminal cycle and waited until due. That setup selection could commit a new unfinished ordinary cycle, correctly preventing a period-scope change. Offline execution of the actual callbacks/store reproduced the conflict against a source-aligned SQL state model. The repaired prerequisite reads and requires the current terminal cycle's complete outcome, retaining the real due wait, restricted transaction, replay/CAS assertions and rollback. This is a fixture repair; PostgreSQL qualification remains a separate executed result.

All selected names, anchored patterns, source order and exact running suites/hooks are enforced. Installed-runner regressions verify sequential callback execution across the actual source topology with networking blocked. Missing, extra, reordered, duplicated, skipped, retried or repeated selected cases, substituted/omitted hooks, cross-profile context and source drift fail qualification. No argument retains the full default; arbitrary filters, files, config, reporters and extra CLI arguments remain rejected before provisioning.

Independent workload review estimates roughly 15–18 minutes, 20–23 minutes, 10–12 minutes and 20 minutes respectively. These are planning estimates, not guaranteed ceilings: authored case/hook timeout sums can exceed the supervisor's work cutoff. The history estimate uses the earlier source-bound `91aec119` typed-cycle measurement of about 13.2 minutes plus real empty-cycle/cadence waits. The final profile retains 60/120/240/480-second retry backoffs. Run each profile separately and sequentially from one reviewed frozen SHA, retaining the fixed 0.25-CU child, 30-minute work, 40-minute lifecycle and 50-minute CI limits. Exhaustion fails without borrowing cleanup time or automatic retry. Actual duration and cleanup must be measured per run; the existing $1 authorization is not an enforced provider billing cap.

The fixture change requires a reviewed shared-module digest repin; older names, selections and historical source-bound proofs remain intact. Both live module digests, runtime, migrations, provider configuration and default inventory remain unchanged. Source/SQL results and cumulative coverage belong in the single DATA evidence ledger. Completing these selections does not qualify the full default suite or finish the resource and operating requirements of the backend scope.

## Bounded live public intake and refresh profile

`--profile=data-live-public-intake-v1` selects one independently reviewed, source-bound live case. ClawMachineJedi is the current qualification input only: the product remains league agnostic. The test requires stable public manager `862823517857697792` and season 2026, then derives its sorted league IDs from the first original sealed discovery capture. It accepts one to four associations only when raw and normalized IDs match one-to-one with no duplicates or filtering. It returns that original capture unchanged. The second discovery must contain the same complete set; an added, removed or replaced association is retained as an original sealed capture with sanitized counts/digests and sticky refusal before the SQL list checkpoint. Zero or more than four associations fail after the identity/list GETs and before any list checkpoint or core work. League names and historic preflight IDs are not eligibility rules.

The case submits one fresh username intake through the existing restricted owner, verifies complete stored readback for every discovered league, configures the existing refresh target and completes its first fresh cycle. It uses no owner-seeded enrollment or synthetic accepted evidence. The existing one-hour cadence configuration makes the first cycle immediately eligible and lets a final zero-GET selection persist its completion without starting another cycle. This qualifies one refresh when it passes, not hourly endurance or minute-cadence freshness.

For N discovered leagues, each collection performs identity/list, sorted bootstrap/core pairs, then sorted users: `2+3N` dispatches and `4N` typed receipts. The two collections require exactly `4+6N` admissions, `5+6N` owner claims including the final zero-GET settlement, and `4+8N` GET attempts. Absolute caps remain 28 admissions, 29 claims and 36 GET attempts; each response is limited to 1 MiB and the total to 36 MiB. The adapter timeout and 20-second caller fence remain unchanged. The loop is limited to 28m45 and the case to 29 minutes inside the unchanged aggregate 30-minute work/40-minute lifecycle. Real spacing alone requires at least `4+6N` minutes (28 minutes at the four-league cap); actual HTTP, SQL and setup add time, so fit is not guaranteed. Any error or exhausted bound fails the single run, without automatic retry or borrowing cleanup time. The existing protected CI project key is reused; the normal harness removes generated database credentials and the disposable child.

Required assertions compare both collections to their own live source payloads, preserve the complete identity/list and DB-issued witness, verify typed settings/players/primary and co-managers/directory readback, stable canonical identities, fresh receipts and directory captures, unchanged prior evidence and a persisted complete refresh outcome. Natural changed or unchanged content is recorded, not forced. Fixed progress lines and bounded sanitized artifacts identify the completed stage; passing source checks alone do not qualify PostgreSQL. Like the earlier live profile, this module is excluded from default/full collection and requires its exact closed supervisor context, name, source digest, report and cleanup acknowledgment.

## Explicit child result and teardown evidence

All supervised profiles require a fresh generated run/SHA/profile context, a structured public-API test report, and an exclusive cleanup acknowledgment written only after the awaited global database cleanup succeeds. The parent checks these after verified child-tree closure. A sticky late process-timeout marker invalidates earlier successful artifacts. Missing, malformed, stale, duplicate, wrong-run, retried or otherwise incomplete selected-case evidence fails qualification. Collected and filtered cases are not executed passes.

A successful child exit alone is insufficient: installed Vitest 4.1.11 can log a global teardown exception while exiting zero. The acknowledgment proves the existing global database teardown only, not all internal test-runner resource closure. Standalone global setup without supervisor context preserves its selection behavior and does not earn supervised qualification evidence. These checks supplement every existing parent ownership, schema-cleanup, credential-revocation, verified child-deletion, source-integrity and acknowledged terminal-receipt gate.
## Run lifecycle and evidence

The supervisor verifies the project and parent through the Neon API, journals a unique branch name and expiry before creation, and creates that branch with a one-hour expiry and a fixed 0.25-CU endpoint that suspends after five idle minutes. It rotates only the new child's owner password and waits for completion, so test code cannot reuse an inherited owner password against the empty parent. It then verifies the exact server identity and empty state before writing any role or safety comment. It creates temporary restricted `league_one_runtime` and `league_one_auth` login credentials through SQL. Connection strings, passwords, the random sentinel, and ownership proof remain in the supervised process environment. The Neon API key and unrelated provider, application, or production secrets are excluded from the test child.

The existing harness remains responsible for migrations, role grants, synthetic fixtures, and resetting only the fixed `public` and `website_auth` schemas. The standard suite includes the restricted-login password-reset lifecycle tests. Account-role tests use guarded owner sessions with transaction-local `SET ROLE`; no separate account password is required.

The runner and global setup refuse to continue unless authorization, URL identity, actual server-reported database and Neon branch, the durable JSON database comment, safe test naming, distinct authenticated roles, TLS, and the production denylist all pass. The configured auth connection must authenticate as `league_one_auth` with restricted role flags and no memberships before any reset. Historical migration and capacity callers can omit that credential. Configured production database URLs are compared by normalized endpoint and database identity rather than raw connection-string text.

The owner connection uses the direct endpoint because ownership requires a pinned session. A pooled runtime or auth endpoint is allowed only when it resolves to the same verified database. Never substitute an owner connection for a restricted runtime or auth login.

Each invocation exclusively reserves a timestamp-and-UUID receipt path under `test-results/integration/` before provisioning, then writes immutable numbered snapshots beside that claim. The command identifies the latest completed snapshot; an older delayed write cannot overwrite a later failure. Missing or truncated evidence never qualifies a run. Qualification requires exit code zero plus the acknowledged receipt referenced by that successful command. A file containing `qualification: "passed"` by itself is insufficient: a write may persist its bytes before its acknowledgment fails. Finalization failure exits unsuccessfully and attempts one later immutable failed snapshot within the original finalization reserve; if that append also fails, the run remains unqualified. Record the exact Git SHA and all of `tests`, `childClosed`, `childClosureEvidence`, `schemaCleanupVerified`, `credentialsRevoked`, `branchDeletionVerified`, and `failures`. POSIX closure includes process-group checks; Windows normal completion records child/stdio closure, while cancellation additionally records successful tree termination. A run passes only when tests and every cleanup condition pass. Infrastructure failures, test failures, and cleanup failures remain distinct; expiry is a fallback, not evidence that deletion already happened. Invalid initial configuration can leave an empty reserved receipt and never qualifies the SQL gate.

One monotonic local budget starts before preflight: provisioning and tests stop by minute 30, reserving the last ten minutes of the fixed 40-minute total for teardown. Each cleanup phase receives its own cancellation signal bounded by the same absolute deadline; interrupted work cannot cancel cleanup admission or renew that deadline. Child closure, guarded schema cleanup, credential revocation, connection closure, API reconciliation/deletion, polling and receipt writes have bounded waits. The final ten seconds are reserved for receipt finalization. A last-resort local exit at minute 40 bounds leaked local handles. These are local runner limits, not a guarantee of remote cancellation, cloud deletion or billing duration. Branch expiry remains one hour and is only a fallback.

The historical September 30 B4 attempt reached a 35-minute deadline after 672 of 733 authored cases, with 61 cases remaining in the final file and no observed assertion failure. That partial attempt does not qualify SQL or establish that the current full serial suite fits the 30-minute work budget. There are no automatic retries or configurable deadline increases. Report only observed results and do not infer final totals from partial output. An aborted run records a safe `cancellationReason`, unresolved resource identities and only cleanup flags actually confirmed before their phase deadline. Offline fake-time and mocked API tests prove local orchestration behavior; they do not prove actual PostgreSQL behavior, credential revocation or remote branch deletion.

Standard-suite measurements use a fresh ignored `test-results/integration/artifacts/run-*` directory recorded as `artifactDirectory` in the receipt. The supervisor supplies that absolute directory through `PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY`; inherited overrides are not admitted to its child. Writers refuse to overwrite an existing artifact, and tracked `release/*.json` evidence stays unchanged. Explicit artifact directories for separately supervised standard Vitest runs remain supported. The specialized collection-capacity and release measurement commands retain their own explicit output contracts.

After verified child closure, guarded schema cleanup runs before temporary credentials are revoked. A failed or timed-out cleanup does not prevent later safe teardown attempts, but it fails qualification. Signals fence follow-up SQL/API work after every await; late operation results cannot upgrade cleanup flags. The supervisor then closes its connections, deletes only its proven owned branch, and verifies deletion. If the process is interrupted or a step fails, retain the receipt and inspect the exact recorded branch and expiry through the Neon API. Never rerun against a surviving branch or manually delete a baseline/retained branch to clear a failure. A new invocation creates a new target.

## Why this design

A [project-scoped API key](https://neon.com/docs/manage/api-keys) has broad authority within its project. A separate test project limits that authority away from production and retained accounts. Ordinary children of an empty parent avoid copying personal data, managed auth configuration, or schema drift; migrations and synthetic fixtures remain the sole application setup path. [Schema-only branching](https://neon.com/docs/guides/branching-schema-only) is unnecessary here and introduces separate root-branch limits. Earlier console failures were not enough to establish a root cause.

[Roles are branch scoped](https://neon.com/docs/manage/roles), and ordinary branches can inherit passwords. The supervisor rotates only its newly created child owner; it creates restricted SQL roles rather than Neon API roles with administrative privileges. [Expiration](https://neon.com/docs/guides/branch-expiration) protects against host loss but is asynchronous, so successful API deletion and observed absence remain the cleanup gate. API response validation and operation polling follow the [official v2 specification](https://neon.com/api_spec/release/v2.json). Ambiguous creates are reconciled by their journaled unique name, parent, and creation window, without retrying the creation POST. API errors record only status, code, and request ID, never raw credential-bearing response bodies.

CI permits one run at a time. A preflight inventory also refuses more than two existing non-parent branches; this is a budget guard, not an atomic cross-host lease. Local overlapping qualification uses distinct targets and must stay within the approved test budget. Never automatically delete another run's branch to make room.

## CI qualification

The checked-in `disposable-integration` workflow supports manual dispatch (`workflow_dispatch`) and pushes only to branches matching `codex/integration-qualification-*` in the canonical repository. [Manual dispatch requires the workflow to exist on the default branch](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch); once registered there, select an approved internal branch in GitHub. Before merge, an explicitly reviewed commit can instead be published to a dedicated qualification ref named `codex/integration-qualification-<shortSHA>`. That ref must point to the exact full reviewed SHA without another code commit; [push workflows can run before merge](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#push). Each matching push queues a run, so publish only a commit ready for qualification and environment review. Ordinary development branches and pull-request events do not trigger this workflow.

Manual dispatch offers the closed `profile` choices `full` (default), `data-roster-player-links-v1`, `data-live-player-directory-v1`, `data-player-directory-v1`, `data-core-compatibility-v1`, `data-core-ingestion-v1`, `data-core-refresh-v1`, `data-live-league-two-v1`, `data-live-public-intake-v1`, `data-official-preconfiguration-v1`, `data-ingestion-guards-v1`, `data-refresh-concurrency-v1`, `data-late-write-rollback-v1`, `data-intake-recovery-v1`, `data-refresh-history-v1`, `data-period-recovery-v1` and `data-period-exhaustion-v1`. Each choice maps to a fixed existing supervisor command; unknown values fail closed. Qualification-branch pushes continue to run the full suite. The same protected environment secret, approval boundary, concurrency group and original deadlines apply to every choice.

Both paths require review of the immutable `github.sha` recorded for the run and qualify that exact checkout; there is no arbitrary SHA input. The canonical-repository guard and protected `integration-test` environment apply to qualification pushes as well as manual dispatch. No fork code receives the control-plane credential. The workflow has read-only repository permissions, does not persist checkout credentials, serializes integration jobs without cancelling an active cleanup, and has a 50-minute limit. This leaves a nominal ten-minute allowance for dependency installation and artifact upload around the supervisor's 40-minute local lifecycle; installation consumes part of that allowance. Cleanup is already inside the supervisor budget. Individual API operation limits remain, but all requests, polling and teardown waits also share the remaining aggregate lifecycle budget. Expiry or a local hard stop never substitutes for verified remote deletion. The API key is supplied only to the test-runner step. Sanitized receipts and synthetic measurement JSON from each run's artifact directory are uploaded even after failure when available.

Activation is a separate repository setup step. Create the `integration-test` environment with required review and deployment branch restrictions for approved internal branches, including the explicitly reviewed qualification refs used before merge. Require an independent reviewer and prevent self-review when a separate reviewer is available; otherwise record the responsible maintainer's manual approval of the exact SHA. Review the workflow, supervisor, tests, and dependency changes before releasing the secret to a run. Pushing a matching qualification ref does not replace environment approval. Store `NEON_TEST_API_KEY` as that environment's dedicated-project secret and all other `NEON_TEST_*` values above as environment variables. Set `NEON_TEST_AUTHORIZATION` to the explicit authorization value only when setup is ready.

Filtering the child's environment reduces accidental exposure; it does not sandbox repository code from the CI host or make untrusted code safe. Do not approve untrusted changes, enable `pull_request_target` execution, or treat a same-repository branch name as sufficient review. A modified supervisor or dependency can access the host's credentials. The dedicated test-project key bounds control-plane authority; it is not a substitute for code review.

A committed workflow or matching branch name does not prove the GitHub environment, secret, reviewer configuration, or live SQL run is active. Before environment activation, run the reviewed checkout locally with the ignored control file and report local qualification separately. Record the GitHub run URL, exact SHA, test totals/skips, receipt, and every cleanup outcome for each CI qualification; this is not yet an automatic required PR check.

## Ownership and specialized harnesses

The older migration-wrapper and capacity commands below are specialized callers of the same harness. They still require an explicitly supervised disposable target and their existing low-level `PROJECTION_INTEGRATION_*` configuration; the control file is not a source of reusable database URLs. Do not direct these commands at the empty baseline or any retained database. Their evidence is separate from the standard suite's disposable-run receipt.

Every caller of `prepareIntegrationDatabase` and `cleanIntegrationDatabase` shares the `league-one-auth-integration-credential` advisory mutex. Ordinary preparation pins an exclusive lock on its actual schema/migration connection, retains it through the test body and repeated preparations, and releases it after cleanup. A conflicting run fails before schema reset. Lost ownership is terminal for that harness process; it never reconnects and resumes destructive work automatically.

An external supervisor already holding the mutex must explicitly delegate ownership. It first acquires exclusive admission, then acquires a shared lock on the same key/session before releasing its exclusive lock. It retains shared ownership until its child has closed and cleanup is verified. Pass `PROJECTION_INTEGRATION_OWNER_PROOF` containing the exact database, branch, backend PID, backend-start time, unique `integration-owner-<UUID>` or `capacity-owner-<UUID>` application name, and `lockMode: "ShareLock"`. The child pins its own shared lock and validates that exact live parent session before destructive queries. Either session therefore blocks a new exclusive run if the other is lost. Old exclusive-only wrappers or absent/stale proofs fail closed; finding another session's lock alone never authorizes reset. The capacity supervisor implements this protocol and passes its existing proof automatically.

## PR2 coverage

The 13 store-facade cases exercise a migration from a verified empty schema; canonical scoring JSON and hashes; immutable scoring rules, baselines, and snapshot history; concurrent provider-identity resolution and orphan cleanup; corrected game aliases and conflicts; projection-run replay and eligibility; the absence of a synthetic row when a baseline is missing; forward and rejected game-state transitions; official-observation replay and unmapped reports; competing job claims and lease ownership; exact snapshot source sets, source skew, material deduplication, verification advancement, history, and older-pointer rejection; requested and latest snapshot selection in one query; malformed payload rejection after an owner-level insert; runtime-role restrictions; and safe pruning with current pointers and frozen sources retained.

## B2 season-overview acceptance

`bundle-two.integration-case.ts` exercises the internal `createBundleTwoReader`
with synthetic accepted captures through the existing restricted runtime login.
Its eight cases cover exact optional official facts, independent ranking and
waiver policies, corrections/partial population, bounded B1 schedules and
unrounded results, current manager/display separation, season/remapping fences,
stored projection and metric joins, and serialized frozen comparison restart.
The fixtures preserve existing evidence and pointers across reads. Setup uses
the existing administration and snapshot writers; metric rows use guarded
synthetic fixture inserts. No provider feed or alternate publication is added.

This suite qualifies only the exact reviewed checkout actually run under the
supervisor. Ordinary unit/build/Preview results do not execute it. It does not
qualify production population, historical applicability, late runtime-role
provisioning, durable persisted replay or Step 3 public/account reader cutover.
See the [B2 composition notes](../../../docs/aggregator-backend/season-overview.md)
and the sole [Step 2 evidence ledger](../../../docs/aggregator-backend/step-2-checklist.md).

## B4 historical-continuity acceptance

`bundle-four.integration-case.ts` adds seven guarded cases using synthetic annual
league captures through the existing Sleeper adapter, administration writer and
restricted store reader. They cover annual identity, same-capture compatibility,
partial retention, missing scores and ambiguous ownership, completion verification,
corrections, serialized frozen comparison, stale sources, unsupported settings and
concurrent remapping. The fixture validates retained enrollment evidence during
teardown; it never deletes committed history or resets schemas itself.

These cases require the existing authorized disposable supervisor and cleanup
receipts. Authored source and ordinary tests do not qualify their SQL behavior or
production population. See the [B4 contract](../../../docs/aggregator-backend/historical-continuity.md)
and the [Step 2 evidence ledger](../../../docs/aggregator-backend/step-2-checklist.md).

## B4 fixture teardown

The B4 historical-continuity fixture retains its committed synthetic enrollment
and history rows until the existing guarded global schema teardown. Migration
016 makes enrollment-season history immutable, including for the fixture owner;
fixture cleanup must not delete it or disable its guards. Cleanup reads and
checks that original enrollment evidence is preserved, that registration added
only the expected synthetic memberships, and that the committed enrollment state
is unchanged. The same check applies after a post-registration setup failure.
The independent restricted connection still closes if validation fails, and the
source-remapping case restores its source through the existing revision writer.

## Deliberately outside this PR2 database suite

- Player projection math and policies for pregame, live, halftime, final, bye, empty-slot, explicit zero substitution, retained prior values, D/ST, duplicate starters, and exact team sums remain pure-domain and worker tests. A missing baseline is represented in Neon by no row; the worker's zero substitution does not belong in the store.
- Sleeper and Tank01 normalization, cold- and warm-cache calls, shared provider groups, cross-league failure isolation, worker logging, cadence, and accepted-result counts remain worker/provider gates for PR3 and PR4.
- Matchup and cron HTTP status, body, cache, page fallback, polling, browser, and preview behavior remain their existing HTTP/page/browser and release gates; they do not require database-owner credentials.
- Compatibility with the recorded production snapshot IDs is a read-only release check. This destructive suite intentionally contains no production data and never connects to the production database.
- The harness emits no connection strings, sentinels, or provider credentials. End-to-end checks for secrets in browser bundles, HTTP bodies, provider cache keys, and structured worker logs remain PR3/PR4 and release checks because those paths are outside the store facade.

## Hourly all-player schedule tests

Migration `014` keeps the production schedule clock internal and owner-only. After all destructive-test guards pass, Vitest global setup substitutes an in-window clock in the isolated database so legacy store tests can run at any time of day. Only the all-player schedule clock changes; lease and deadline expiry always use the real database clock. The hourly cases control that owner-only clock to verify Eastern noon–midnight hours, daylight saving, hour-slot deduplication, the strict 13-request rolling-24-hour cap, operator/recurring contention, window and budget changes after claim, and expiry/takeover. They restore the prior fixture clock and job row afterward.

The actual `014` release-wrapper capture uses `prepareIntegrationDatabase` directly and never installs the test clock. It verifies the real production clock, owner-only helper permissions, unchanged table/constraint protections, old read signature, exact sentinel and complete transaction rollback after a deliberately corrupted constraint manifest. Run `scripts/run-all-player-migration-wrapper-integration.mjs --hourly` only through the same explicitly authorized isolated environment. Its catalog remains `reviewed: false` until independent review; the production renderer refuses it until then.

The all-player replay regression deliberately blocks two warmed, independent
runtime sessions on the same job row before releasing them. Both exact replays
must succeed while creating one physical batch and a coordinated profile group.
The writer's lock and batch are separate statements in one atomic Read Committed
transaction. The harness pins the connection and rolls back on failure; ordinary
client tests separately verify Neon's single HTTP transaction, statement order
and cancellation. These transport tests use mocked HTTP, not production access.

## Application authentication storage

Migration 021 adds the fixed `website_auth` schema and the separately restricted `league_one_auth` role. The harness resets only `public` and `website_auth`; managed `neon_auth` storage is never a reset target. Historical `throughMigration` runs before 021 skip auth-role provisioning. Configured account-domain and app-auth database URLs are also checked as protected identities before destructive preparation.

Do not run this suite against retained pilot users, even when their database name contains `test`. Use a fresh empty disposable database and include the retained pilot database names in its denylist. The auth catalog/role cases qualify the maintained table layout and reciprocal role boundaries. Lifecycle and concurrent password-reset proofs require their separate explicitly supplied restricted auth connection; report missing credentials as unverified.

## Measured collection capacity

The separate [capacity harness and report](../../../docs/collection-capacity-validation.md) exercise the current shared-statistics and per-league acceptance path through the real restricted Neon HTTP adapter. Providers are synthetic and all other network fetches are refused. Run the Windows-specific supervised command from `apps/site` using Node 24:

```text
node --env-file=.env.integration.local --conditions=react-server --import tsx scripts/run-collection-capacity.mjs
```

Set `COLLECTION_CAPACITY_OUTPUT` to a new absolute JSON path. `COLLECTION_CAPACITY_SCOPE` is `ladder` by default; `probe` qualifies one three-league capture and `distinct` measures a separate scoring-profile ladder. The standard owner/runtime authorization, identity, sentinel, TLS and denylist guards remain mandatory. This dedicated configuration does not run account lifecycle tests and does not require an auth-role credential.

The supervisor requires empty application schemas, acquires exclusive integration admission, and then retains shared ownership with its pinned child until child closure and cleanup verification. Unknown or active database sessions fail closed. Previously recorded idle Neon HTTP pool backends are accepted only by exact process/start identity from a closed, clean run; active transactions are never accepted and database sessions are never terminated. Allow unexplained pooled sessions to expire naturally and investigate other test activity before retrying. A mutex coordinates cooperating runners; the checks support “no competing owner observed,” not proof that no other task exists.

Direct Vitest invocation is refused without the live supervisor's database ownership proof. A successful measurement also needs its successful cleanup receipt. This harness resets the same disposable schemas as the standard integration suite; it must never target production or retained pilot users.


## CP5 shared player directory qualification

The closed `data-player-directory-v1` profile selects only
`integration/player-directory.integration-case.ts`: six ordered cases in one
sequential suite, with exactly one `beforeAll` and one `afterAll`. The existing
supervisor command is `pnpm test:integration --profile=data-player-directory-v1`.
The module also joins the normal full fixture discovery; the prior 48-module
inventory remains historical. Older closed profiles keep their original selected
modules, cases and source digests.

The authored cases cover full native rows and bounded stored-only reads;
unchanged content versus fresh observations, corrections/removals and exact replay;
last-good preservation for partial, invalid, conflicting, empty and unavailable
captures; serialized reservations and forged evidence; actual restricted-LOGIN
privileges, immutable history and restoration of optional grants; and shared
60-second admission, the catalog daily reservation, failure and observed lock
expiry. The fixed profile binds the reviewed LF source digest, exact names/order,
complete collection, hook balance, zero retries/skips and acknowledged cleanup.
Source checks and the network-blocked synthetic reporter tests execute no SQL and
do not qualify these database claims.

Every directory reservation and acceptance uses the genuine runtime LOGIN and a
current fence for the existing public-intake job. Multiple-observation fixtures
explicitly age only the mutable head's operational `last_network_at` and
`next_network_at` using the guarded owner as synthetic cadence prerequisites.
Immutable attempts, capture/source times, native evidence and accepted history
are not aged. This setup is not elapsed 24-hour refresh proof, an unrestricted
runtime write path, or production scheduling. Grant-restoration checks are not
proof of a genuinely fresh role unless a separately recorded test creates one.

This is source-only qualification wiring. No SQL/provider execution, credentials,
provisioning, retained installation, dispatch, migration application or release is
authorized here. Any later run needs its exact reviewed source and separate
bounded authorization. Preserve the existing 30-minute work/40-minute lifecycle,
real-login identity/TLS/sentinel/denylist/ownership guards, protected environment,
immutable reports and acknowledged child/schema/credential/branch cleanup.
Full-catalog 16 MiB/2,000,000-value/depth-64/100,000-row bounds are authored limits;
actual full-size provider, database request-size and 20-second work-budget fit
remain unqualified. No public roster linkage, projection, account or frontend
behavior is changed by this fixture profile.

## Live full-directory budget qualification

The separate manual-only `data-live-player-directory-v1` profile selects exactly
one case in `integration/player-directory.live-integration-case.ts`, with a
reviewed LF source pin, a matching supervisor context and one hook pair. Run
only through the existing protected disposable supervisor after exact-source
review and separate bounded run authorization. The new live suffix is excluded
from normal full discovery, which contains 50 modules after the CP6 addition; all older profiles and
source pins remain unchanged.

This case requires one real public Sleeper `/players/nfl` GET through the existing
catalog owner, restricted runtime Neon HTTP storage, and every version-pinned
reader page to finish under the same original 20-second deadline. The clock
includes claim, reservation, acquisition, normalization, acceptance, job
completion and full stored-page audit. It is never restarted for readback.
Stage timings distinguish accepted ingestion from a later readback failure;
ingestion alone is not a passing end-to-end result. The 45-second test allowance
covers failure reporting and cleanup, without extending the success budget.

The existing 16 MiB source, 2,000,000-value, depth-64, 100,000-row, 64 MiB storage
envelope and 200-row page bounds remain unchanged. Exactly one acquisition is
permitted: no redirects, fallback feed, retry, prefetch or second observation.
Only bounded aggregate measurements and sanitized outcomes are reported, never
raw catalogs, player identities, query parameters or credentials. Nonsecret
source hashes and attempt, receipt and version UUIDs may bind retained evidence.
Production scheduling,
roster links and production installation remain off. Source/offline checks are
not evidence of live capacity or fit; only a separately authorized exact-source
run with verified report and cleanup can qualify the observed catalog.


## CP6 roster-player link qualification

The closed `data-roster-player-links-v1` profile selects exactly nine ordered
cases in `integration/roster-player-links.integration-case.ts`, with one shared
setup/teardown pair. Its fixed supervisor command is
`pnpm test:integration --profile=data-roster-player-links-v1`. The same protected
manual workflow can select it; source authoring and publication do not dispatch it.
The normal suite now discovers 50 modules. Every older closed profile/source pin
and all live-module exclusions remain unchanged.

This profile uses synthetic Sleeper HTTP responses through the existing adapters
and actual restricted PostgreSQL writes/readers. It qualifies current-season 2026
native roster membership, player and team-defense identity reuse, immutable link
history, additions/removals/transfers/category corrections, unchanged captures and
exact replay, explicit unresolved mappings, source remapping, concurrency, real
identity-lock expiry with full rollback, bounded capacity and negative grants.
The final case uses ordinary public intake and one real refresh cycle, including
actual minute admission spacing and stored-only public readers. It does not make
a live Sleeper request. The prior CP5 full-catalog live result is separate evidence.

The new link resource permits at most 1,000 teams and 10,000 memberships. A
conservative pre-mint proof estimate is capped at 8 MiB; a reader independently
rejects serialized evidence above 32 MiB. An exceeded link limit preserves the
official held roster with explicit capacity status and zero new link rows or
identity writes. These are link-resource bounds; the CP5 catalog and existing
20-second work deadlines are not expanded. Categories retain native
missing/null/empty/supplied state, and capture/resolution times do not invent
provider transfer or effective timestamps.

The fixture may reset only the directory's mutable daily-cadence prerequisite,
never immutable source/acceptance/dispatch times. It waits on actual database time
for public admission and teardown spacing. Its nine individual test allowances
sum to 29 minutes, in addition to setup/teardown; this is not a worst-case fit
claim. Expected ordinary admission time is roughly ten minutes before other
checks. The unchanged supervisor still enforces 30 minutes of work, 40 minutes
of total lifecycle and 50 minutes of CI, including failure cleanup. No retries,
extra arguments or alternative credential path are introduced.

[Run 38059763318](https://github.com/clawmachinejed/league-one-audit/actions/runs/38059763318)
passed all nine cases at `93c18e588f7bcead866b6e3e3f087b8a691dcee6`,
with independently validated source/report bindings and acknowledged cleanup.
The [evidence ledger](../../../docs/aggregator-backend/data-backend-evidence.md)
records actual timing, versions, artifact hashes and both preceding failures.
This establishes CP6 implementation and resource qualification within the stated
scope, including observed execution within the original limits; it is not a
worst-case duration guarantee. Later documentation-only commits do not change
the executed source.

This result does not qualify genuinely fresh-role provisioning, daily recurrence,
fleet capacity, a few-minute freshness guarantee, the full SQL suite or production
rollout. The approved single-run allowance is consumed; actual billing is
unmeasured. No further paid run, retained migration application, merge or
production activation follows from this result.

## CP7 manager and commissioner fact qualification

The authored closed `data-team-manager-facts-v1` profile selects exactly nine
ordered cases in `integration/team-manager-facts.integration-case.ts`, with one
shared setup/teardown pair. Its fixed supervisor command, only after separate
run authorization, is `pnpm test:integration --profile=data-team-manager-facts-v1`.
The existing protected manual workflow offers the same profile. Source authoring
and publication do not dispatch it or authorize credentials or provisioning.
Default collection now contains 51 modules; older fixture bodies and closed
profile pins remain unchanged.

The profile uses synthetic Sleeper HTTP responses through existing adapters and
the ordinary restricted PostgreSQL writers/readers. Current-2026 cases distinguish
commissioners from roster primary owners, co-owners and vacancies; retain known
true/false, absent, null and invalid commissioner facts; and cover canonical
identity reuse, ownership corrections, immutable history, unchanged capture and
exact replay. Dedicated cases exercise uncertain owner/co-owner evidence,
reservation ordering, source remaps, independent partial/malformed/unavailable
directory results, forged facts and worker fences, observed lock expiry with
rollback, and actual runtime table/helper permissions. The final case uses the
ordinary intake owner, directory failure and recovery, then one changed refresh
cycle with stored-only readback. Existing v1 completion and v2 latest-mapping
evidence semantics are preserved. No live Sleeper request is selected.

The nine case limits total 23 minutes (eight at 60 seconds and one at 900 seconds);
the two 120-second hooks bring the authored allowance to 27 minutes before other
harness overhead. This arithmetic is not measured runtime or a worst-case fit
guarantee. Every ordinary work step retains its original 20-second deadline,
real minute admission spacing and retry policy. The shared supervisor retains
30 minutes of work, 40 minutes of total lifecycle and the existing 50-minute CI
limit, including failure cleanup. No extra acquisition pipeline, timing rewrite,
automatic retry, alternative credential path or cleanup exception is introduced.

CP7 remains **authored and SQL-unqualified** until a separately approved exact
source run passes all nine selected cases and the maintained report, source pins,
hook inventory and acknowledged cleanup are independently validated. Source tests
and mocks cannot establish installed constraints, role privileges, PostgreSQL
version, lock behavior or duration. Record those results in the
[evidence ledger](../../../docs/aggregator-backend/data-backend-evidence.md).
The profile does not qualify fleet capacity, daily recurrence, the full SQL suite,
live provider acquisition, retained installation or production release.

## CP8 current-season period inventory qualification

The authored closed `data-period-inventory-v1` profile selects exactly six ordered
cases in `integration/period-inventory.integration-case.ts`, with one shared hook
pair. Only after separate exact-source run authorization, its fixed command is
`pnpm test:integration --profile=data-period-inventory-v1`. The existing protected
manual workflow offers this literal choice. Default collection now includes 52
modules; every older fixture and closed source pin remains unchanged. No run,
credentials, provisioning or migration application follows from authoring.

The fixture uses synthetic Sleeper HTTP through the ordinary adapter, restricted
LOGIN, existing task queue, durable dispatch witnesses and typed resource readers.
A deliberately unsorted 1,000-distinct-league list is designed to verify 20 admitted leagues times
18 native weeks equals 360 tasks, with 980 other candidates and 17,640 unscheduled
periods explicitly capacity-accounted. Provider list order selects the admitted
subset; deterministic task order applies within that subset. All raw duplicate
entries retain their own ordinal and native clues, while each logical period is
queued once. An actual late lock on new inventory metadata must expire the
original worker fence and roll back the delegated checkpoint and all new rows;
ordinary retry then materializes the inventory once. Separate empty discovery
will test zero inventory without inventing available period results.

The representative ordinary case is designed to make 16 synthetic HTTP requests across one
manual intake and one refresh cycle: genuine checkpoint acknowledgment loss,
week 2 source failure and recovery, then changed refresh captures. Both requests
retain all 18 durable tasks; only weeks 1/2 complete, and 16 remain pending in each.
Stored readers distinguish requested coverage, global collection progress and
the bounded rich-resource page. A duplicate native clue for week 19 remains an
explicit unsupported gap, never an extra request or inferred competition phase.
History, exact receipt/current mapping checks, configuration scope/CAS rejection,
direct mutation denials, private helpers and existing-role reprovisioning are
covered independently. Stored reads are checked for no provider calls or writes.

The six case limits total 23 minutes: three 60-second cases, two 180-second cases,
and one 840-second case. Existing 120-second setup and teardown hooks bring the
authored allowance to 27 minutes before other harness overhead. This arithmetic
is unmeasured and does not guarantee fit. The 20-second worker, real 60-second
admission spacing, 30-minute work, 40-minute lifecycle and 50-minute CI limits remain
unchanged, with no extra retries, cadence changes or cleanup exceptions.

CP8 is **authored and SQL-unqualified** until a separately approved exact-source
run and its report, hooks, source pins and acknowledged cleanup are independently
validated. This profile does not claim elapsed acquisition of all 18 periods,
terminal full-mode cycle completion or exhaustion, live provider availability,
historical settings, phase classification, fresh-role provisioning, fleet capacity,
the full SQL suite, retained installation or production release. Offline reader
tests of terminal aggregation are separate from this representative acquisition
witness. Record actual version, timing and remaining limits in the
[evidence ledger](../../../docs/aggregator-backend/data-backend-evidence.md).
