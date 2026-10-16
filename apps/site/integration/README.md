# Disposable Neon integration tests

`pnpm test:integration` creates a fresh test branch, runs the existing destructive SQL suite, verifies cleanup and credential revocation, and deletes that run's branch. It never reads the old `apps/site/.env.integration.local` file. Retained pilot data and production remain separate from test infrastructure.

The dedicated test project is `steep-glitter-44680287` (`league-one-integration-tests`). Its empty baseline must have no application relations, functions, custom types, managed `neon_auth` schema, or inherited application roles. Each run uses the repository's migrations; default and ordinary profiles use synthetic fixtures, while separately authorized live profiles use their explicitly bounded public captures. The baseline is not a copy of retained accounts and is not the target of destructive tests.

The authoritative source-bound results, failed-attempt history, cleanup evidence and remaining qualification are maintained in [DATA evidence](../../../docs/aggregator-backend/data-backend-evidence.md). Use that ledger for current status; the profile descriptions below define their contracts and limits. The product serves supported Sleeper leagues through the shared pipeline; ClawMachineJedi, DannyPak, League One and League Two are test inputs. A selected case or non-SQL workflow pass does not establish full-suite or production-release qualification.

The production/retained project `solitary-base-99261075`, its production branch `br-rapid-boat-avgeevye`, its retained branch `br-still-breeze-avaibago`, and the retained `projection_refactor_test` and `account_reset_integration_test` database names are explicitly denied. The shared SQL harness independently denies both branch IDs and both retained database names for every caller, including legacy migration and capacity commands, regardless of the supplied denylist or an old valid safety comment. Do not reset either retained database or rotate roles on that branch.

## Parent availability and safe target diagnostics

A configured baseline may be `ready` or `archived`, provided its exact project,
branch identity and permanent expiration checks pass. Neon documents automatic
unarchiving when the existing child-creation request accesses an archived parent.
The runner adds no parent SQL query, activation request, protection change or
retry. All other parent states are rejected before creation. The disposable child
must still become `ready`, return the exact bounded endpoint and pass the existing
empty-database, TLS, ownership, sentinel and restricted-login checks.

Target-validation failures use fixed diagnostic codes for configuration, project
identity, parent identity, parent expiration and parent state. The existing
supervisor journals only those codes; provider response bodies, field values,
messages, credentials and connection strings are not attached to these errors.
Initial environment validation remains separate and can fail before a receipt is
created. A failure before child creation remains a failed run with tests not run;
it does not acquire successful cleanup or qualification flags.

This source repair does not rerun the failed weekly-report attempt or qualify its
eight cases. A new hosted run requires its own exact-source authorization. See
[the failed attempt and repair record](../../../docs/aggregator-backend/data-backend-cp13-semantics.md#weekly-report-hosted-attempt--october-12-2026)
and [Neon's archive behavior](https://neon.com/docs/guides/branch-archiving).

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

The supervisor also requires an actual run-bound PostgreSQL version observation. After all existing target, TLS, role, sentinel and ownership guards, one bounded read-only SELECT on its pinned owner connection reads `server_version` and `server_version_num` together with the actual database, child branch and authenticated owner/session identities. The safe, internally consistent values, observation time, run ID, Git SHA, profile and context digest are retained as `postgresqlVersion` in an acknowledged immutable receipt before child launch. Both supervisor and final command reject missing or inconsistent evidence. The maintained report validator still checks the unchanged report/cleanup artifacts; the parent adds their validated context digest to receipt `testEvidence`. Fixture, profile, context, reporter and artifact schemas are unchanged. The version read remains inside the existing work and query deadlines; it neither changes roles nor substitutes owner access for restricted fixture execution. PostgreSQL documents these [read-only server settings](https://www.postgresql.org/docs/current/runtime-config-preset.html#GUC-SERVER-VERSION) and their [numeric version representation](https://www.postgresql.org/docs/current/libpq-status.html#LIBPQ-PQSERVERVERSION).

Capture or pre-child journal failure prevents test launch and retains the existing safe close/delete fallback; schema cleanup and credential revocation stay unverified when provisioning did not finish. A failed post-child evidence check retains the normal verified-closure cleanup path. Errors retain only a fixed safe classification. Earlier receipts without this observation remain historically version-unqualified; a later child cannot supply their missing versions.

For independent offline acceptance, check receipt `databaseName` and `postgresqlVersion`, run `assertIntegrationPostgresqlVersionEvidence(terminal, { gitSha: approvedSha, profile })`, and require exact equality between terminal `testEvidence` and `{ ...await validateQualificationArtifacts(binding), contextDigest: qualificationDigest(binding.context) }`. Keep the original ZIP/file parity, immutable journal consistency, exact source/profile pins, final command acknowledgment and every cleanup check. The added parent-receipt context digest does not change the maintained test report or global-cleanup artifact schema.

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

## CP9 exact-period settings context qualification

The authored closed `data-period-settings-context-v1` profile selects seven
source-ordered cases in `period-settings-context.integration-case.ts` and exactly
one beforeAll/afterAll pair. Its fixed command is
`pnpm test:integration --profile=data-period-settings-context-v1`. Existing
supervisor, protected environment, restricted LOGIN, source/report binding and
cleanup gates remain unchanged. Default discovery gains one ordinary module
(52 to 53); all older fixture bytes, selected inventories and pins remain intact.

The fixture is designed to verify exact captured settings and receipt lineage;
independent scoring, roster and competition applicability; inclusive boundaries;
missing, invalid and contradictory evidence; corrections and exact replay;
current source mapping fences; and restricted reads and immutable history.
Historical positives use the existing owner-only activation API with explicit
synthetic owner attestations. They establish the latest evidenced decision, not
provider-effective history or what was known when a capture occurred. Newer
unproved decisions must remain unknown rather than falling back. Original
observations remain observation-only. Native NFL regular-week identity is distinct
from the derived relationship to evidenced fantasy competition boundaries;
official fantasy phase, round, leg and competition end remain unknown.

One ordinary fixture uses the existing intake and refresh coordinators with real
DB-issued witnesses, original minute spacing and synthetic HTTP. It acquires
weeks 1 and 2 in each of two 18-task requests: 11 admissions and 16 GET attempts,
including one committed checkpoint whose acknowledgment is lost and one failed
week-2 attempt followed by ordinary recovery. Four checkpoints retain eight typed
receipt witnesses. Each request still has 16 pending tasks. Changed settings in
refresh must leave the original exact context readable while legacy current-head
resource checks retain their existing unavailable result. Stored-only readers
must make no provider requests. The profile does not claim acquisition of all
18 periods, nonempty terminal inventory completion or live-provider evidence.

Six 60-second cases, one 840-second ordinary case and two existing 120-second
hooks total a 24-minute authored allowance before other harness overhead. This
is not a measured fit or cost guarantee. The existing 20-second worker,
60-second admission, 30-minute work, 40-minute lifecycle and 50-minute CI limits
remain unchanged; no automatic SQL retry is permitted. No new writer or schema
is introduced, so this read extension adds no late-write claim. Role checks
include reprovisioning an existing role in a rolled-back transaction, not a
fresh-role lifecycle qualification.

CP9 is **authored and SQL-unqualified** until a separately authorized exact-source
run and its ordered cases, source pins, report and acknowledged cleanup pass
independent validation. Source checks do not authorize that run. Actual results,
version, duration, costs and remaining limits belong in the
[evidence ledger](../../../docs/aggregator-backend/data-backend-evidence.md).

## CP10 exact native lineup and score value qualification

The authored closed `data-exact-matchup-values-v1` profile selects seven ordered
cases in `exact-matchup-values.integration-case.ts` and one shared hook pair.
Only after separate exact-source authorization, the fixed command is
`pnpm test:integration --profile=data-exact-matchup-values-v1`. The protected
manual workflow offers that literal choice. Normal full discovery adds one module
(53 to 54); all older fixture bytes, selected inventories and source pins remain
unchanged. Authoring does not authorize credentials, provisioning, migration
application, a paid SQL run, live capture or production activity.

The fixture is designed to compare synthetic source payloads with the new immutable
relational values and the actual restricted stored reader. It distinguishes
missing, null, supplied empty and supplied zero; preserves source row and starter
order, vacancy scores, every player-map key, raw scores and custom overrides; and
checks decimal, negative and exponent values without recalculating official team
scores. Equality is for parsed JSON values, not discarded numeric lexical scale.
An official custom zero overrides the raw score. Tied values and unpaired rows
remain native evidence. Repeated native matchup IDs in two separate period
captures do not establish a playoff round, multiweek aggregate, winner or finality.

Independent cases cover immutable corrections, fresh equal-content receipts,
exact replay, both out-of-order completion orders, invalid and partial last-good
preservation, unrelated receipt/source mapping rejection and restricted grants.
A pinned restricted writer must actually wait on the new typed relation until its
original 12-second synthetic worker fence expires. After release, all new typed
rows, legacy history, receipt and acceptance must roll back. Stored reads run with
provider calls blocked and reject mutation statements. Existing-role reprovisioning
runs only inside a rolled-back transaction; it is not fresh-role qualification.

The ordinary case uses the existing Sleeper adapter, intake owner, real minute
admissions, dispatch witnesses, stores and readers. It completes one explicitly
requested 2026 native period in each of an initial intake and a changed refresh.
Each cycle follows identity, discovery, bootstrap, exact period, core and users:
12 admissions and 16 synthetic GETs across both cycles, plus a final zero-GET owner
claim that records the complete refresh outcome. The original exact receipt must
remain readable after the correction, while default current-head checks keep their
existing behavior. This case does not claim acquisition of all 18 periods, live
provider coverage, fleet capacity, the complete SQL suite or production release.

Six 60-second cases, one 900-second case and two 120-second hooks total a 25-minute
authored allowance before other harness overhead. This is not measured fit or a
cost guarantee. The existing 20-second ordinary work, real 60-second admission,
30-minute supervisor work, 40-minute lifecycle, 50-minute CI and one-hour expiry
limits remain unchanged. No automatic SQL retry or cleanup exception is added.

CP10 remains **authored and SQL-unqualified** until a separately authorized run of
the reviewed frozen source passes every case and its report, hooks, source pin and
acknowledged cleanup are independently verified. Offline selector/report checks,
TypeScript, source inspection and numeric parser tests do not establish PostgreSQL
execution. Record the actual database version, duration, cleanup and remaining
gaps in the [DATA evidence ledger](../../../docs/aggregator-backend/data-backend-evidence.md).

## CP11 typed official bracket resource qualification

The authored closed `data-typed-brackets-v1` profile selects seven ordered cases
in `typed-brackets.integration-case.ts` with one shared hook pair. Only after
separate exact-source authorization, its fixed command is
`pnpm test:integration --profile=data-typed-brackets-v1`. The protected manual
workflow offers that literal choice. Default discovery adds one module (54 to 55);
older fixture bodies, profile inventories and source pins remain unchanged.
Authoring grants no paid SQL run, credential access, provisioning, migration
application, live capture, automatic retry or production authority.

The first two independently enrolled synthetic 2026 resource cases use the existing
Sleeper administration adapter for six fixture HTTP GETs; the remaining cases use
direct synthetic normalized captures. All reuse the sole administration writer,
existing reservations/receipts/acceptances and the actual restricted stored reader.
The native winners and losers endpoints remain separate sources under the
provider-neutral playoff-brackets family. Cases compare native, normalized,
relational and reader rounds, matches, entrants, winner/loser advancement and
supplied result facts. They retain missing, explicit null, unsupported native
forms, unpublished null and published empty distinctly. Unknown or absent upstream
references remain unresolved; native placement fields and supplied outcomes do
not establish weekly matchup identity, aggregate scoring, seed, rank or finality.

Malformed, partial and definitely contradictory captures retain their raw evidence
and preserve prior accepted typed data. Independent cases also cover immutable
corrections, fresh equal-content receipts, exact replay, both out-of-order
completion orders, unrelated mapping/receipt rejection, forged normalized facts,
and original-fence rollback after a witnessed lock on the new typed relation.
The lock witness retains its original 12-second synthetic fence; a separate
6-second synthetic fence per transaction is live when the writer returns and must
reject both a new-content transaction and a fresh equal-content acceptance when
deferred validation runs after expiry at COMMIT.
Stored reads run with provider access blocked and reject mutating SQL statements.
Restricted grants, direct history mutation and private helper denial are checked;
existing-role reprovisioning is confined to a rolled-back transaction and does not
qualify a fresh-role installation.

These are direct opt-in resource cases with synthetic enrollment prerequisites.
They do not compose ordinary intake, recurring bracket tasks, refresh checkpoints
or corrected intake heads (CP12), and do not establish broader result/finality
semantics (CP13). Seven 60-second cases and two 120-second hooks total an 11-minute
authored allowance before harness overhead; this is not measured duration or a
cost guarantee. The 20-second ordinary worker, real 60-second admission, 30-minute
supervisor work, 40-minute lifecycle, 50-minute CI and one-hour expiry bounds, plus
all identity/TLS/role/sentinel/denylist/cleanup gates remain unchanged.

The implementation bounds native captures to 1,024 matches and 8 MiB of compact
source JSON, expanded SQL payloads to 16 MiB, and stored reader operands to 32 MiB.
These are distinct bounds: expanded numeric forms can exceed the SQL bound even
when compact source is smaller. Such a write fails without advancing accepted
data. Maximum-size parity, latency and capacity are unqualified.

CP11 remains **authored and SQL-unqualified** until a separately authorized run of
the reviewed frozen source passes every selected case, exact hooks, source pin
and acknowledged cleanup. Offline AST/inventory/report checks, the network-blocked
installed runner, parser tests and TypeScript do not prove PostgreSQL execution,
installed constraints, permissions, runtime fit or live provider parity. Record
the tested database version, duration, exact source and cleanup in the
[DATA evidence ledger](../../../docs/aggregator-backend/data-backend-evidence.md).

## CP12 ordinary paired bracket intake qualification

The authored closed `data-bracket-intake-v1` profile selects five ordered cases
in `bracket-intake.integration-case.ts` with one shared hook pair. Only after
separate exact-source authorization, its fixed command is
`pnpm test:integration --profile=data-bracket-intake-v1`. The protected manual
workflow offers that literal choice. Default discovery adds one module (55 to 56);
all older fixture bodies, inventories and source pins remain unchanged. Authoring
grants no paid SQL run, credentials, provisioning, migration application, live
capture, automatic retry or production authority.

Requests explicitly select `sleeper-2026-playoff-brackets-v1` for season 2026.
The fixture checks SQL selector validation, replay identity, omitted-selector
compatibility, and coexistence with either existing period selector at metadata
level. An ordinary empty discovery spends two real admissions and two synthetic
GETs, retains zero bracket tasks, and invents no individual bracket availability.
The main ordinary case completes identity, discovery, bootstrap, paired brackets,
core and users for an initial intake and a changed recurring refresh. It adds an
deliberately late failed-task COMMIT and a failed losers-family response before paired recovery,
then loses the successful checkpoint acknowledgment. Fourteen real admissions and
20 synthetic GET attempts cover these two cycles. Acquired zero-GET owner claims
are observed separately: the unchanged 120-second retry backoff can consume an
intervening 60-second owner claim, and a final claim records terminal refresh
settlement without another GET or admission. The abandoned first dispatch is
recovered under a fresh owner fence without another source admission. Total claims must equal admissions
plus those explicitly observed zero-GET claims.

Both family attempts are reserved before the paired source requests and carry the
same database dispatch witness. Fresh valid family evidence survives its sibling's
failure, while the request remains incomplete. An older-dispatch family receipt,
wrong mapping or swapped family receipts cannot complete the pair. The first
failed-task mutation uses an actual pinned runtime transaction: failure returns
while its original 20-second fence is live, then deferred COMMIT rejects with the
server fence exception after expiry. Task, request and dispatch-outcome state must
roll back; the callback is drained before the next ordinary recovery begins. Changed
refresh reads use both immutable checkpoint receipts, preserving an older
request's exact values after newer accepted heads exist. Complete null, empty
and supplied result facts retain CP11 semantics. This adds ordinary acquisition
and history, not new competition phase, scoring aggregation or finality rules.

The remaining cases check immutable checkpoint/task history, selector CAS and
cycle history, current-source remapping, restricted grants, direct mutation and
private-helper denial. Stored readers have source calls blocked and reject
mutating SQL. Existing-role reprovisioning occurs only inside a rolled-back
transaction and does not qualify a fresh-role installation.

Three 60-second cases, one 180-second case, one 1,080-second case and two
120-second hooks total a 28-minute authored allowance before harness overhead.
This leaves only two minutes inside the existing supervisor work bound and is
not measured fit or a cost guarantee. The original 20-second worker, real
60-second admission, 30-minute work, 40-minute lifecycle, 50-minute CI and
one-hour expiry limits and all identity/TLS/role/sentinel/denylist/cleanup guards
remain unchanged. Five-failure exhaustion, maximum candidate capacity, combined
period-and-bracket acquisition, full-fleet latency, live provider parity and the
complete SQL suite are outside this selected profile's evidence.

CP12 remains **authored and SQL-unqualified** until a separately authorized run of
the reviewed frozen source passes all five cases, exact hooks, source pin and
acknowledged cleanup. Offline selector/report/AST checks, network-blocked runner
tests, TypeScript and source inspection do not establish PostgreSQL execution,
installed permissions or elapsed runtime fit. Record actual results and gaps in
the [DATA evidence ledger](../../../docs/aggregator-backend/data-backend-evidence.md).

## CP13 independent official standings and result composition qualification

The authored closed `data-official-results-v1` profile selects eight ordered cases
in `official-results.integration-case.ts` under the single suite `official standings
and results through restricted PostgreSQL`, with one shared beforeAll/afterAll
pair. After separate authorization for its reviewed exact source, its fixed command
is `pnpm test:integration --profile=data-official-results-v1`. The protected manual
workflow offers only that literal choice. Default discovery adds one module (56
to 57); all older fixture bodies, selectors and source pins remain unchanged.
The new profile source digest must match the frozen fixture before execution.
Authored selection is not authorization for SQL, credentials, provisioning,
migration application, a live provider capture or production work.

The first seven cases exercise independent typed record/points/placement fields,
presence and population/capacity states, correction/replay/unchanged captures,
latest-attempt ordering, forged projection/foreign identity rejection, actual
lock and deferred-COMMIT rollback under the original fence, restricted privileges,
and composition of exact scores with reported bracket outcomes. The final case
uses ordinary failed-core recovery and changed recurring refresh with immutable
selected receipts, two resolved held-player identities and available manager
resources before and after refresh. It must retain usable standings while unrelated players or
managers fail without marking the request complete. Stored reads must preserve
request/dispatch scope and original observation times, expose a newer failure
instead of silently returning last-good facts, and run with source access disabled.

The existing ordering case also evaluates the reader's exact SQL population-time
predicate with read-only before/equal/after microsecond operands within one
millisecond, missing timestamps and guarded witness branches. These operands do
not rewrite stored clocks. Both overlapping completion orders must return the
newest receipt with unproved population while retaining the original replay,
historical-read and legacy-upgrade assertions. The case inventory and deadlines
remain unchanged.

The new supplement does not weaken players acceptance or add an acquisition
pipeline. Native weekly and bracket identifiers remain separate. Equal scores,
null opponents, source array order, current standings, league status and local
game completion never manufacture official winners, ties, byes, ranks, series
aggregates or finality. Positive synthetic result cases establish code behavior,
not real provider availability. Retained evidence and unresolved interpretation
obligations are listed in the [CP13 design inventory](../../../docs/aggregator-backend/data-backend-cp13-design.md).

The final case first records a synthetic two-player catalog through the existing
complete-catalog loader, restricted directory reservation/write and shared job
owner. It changes only the fixture's mutable directory cadence prerequisite;
immutable source clocks and acceptance evidence still come from the maintained
path. That setup asserts one intercepted directory GET. The ordinary intake and
refresh separately assert 15 admissions and 22 intercepted GETs. Per-call owner
claims are reconciled against admissions and observed zero-GET backoffs: at most
one during failed-core recovery and exactly one for terminal settlement. No
rigid total claim count depends on whether recovery polls before its retry is
due. Directory owner claims and any reservation wait are separate from this
ordinary accounting. All payloads remain synthetic.

Seven 60-second cases, one 1,080-second case and two 120-second hooks total a
29-minute authored allowance before harness overhead. The remaining one minute
inside the 30-minute supervisor work bound is not measured fit or a cost guarantee.
Directory setup, its bounded reservation wait and the shared-owner cooldown are
inside the final case's 1,080-second allowance; they do not receive an extra budget.
The original 20-second worker, 60-second admission, 30-minute work, 40-minute
lifecycle, 50-minute CI and one-hour expiry limits remain unchanged, as do all
identity, TLS, role, sentinel, denylist, source, cleanup and no-retry controls.

The first authorized run at `67b43a6` failed with seven cases passed and one
fixture assertion failed; cleanup was verified. The second run,
[`38236085130`](https://github.com/clawmachinejed/league-one-audit/actions/runs/38236085130)
at `f28f673`, failed with six cases passed and two failed. Its automatic cleanup
acknowledgments were recorded; fresh provider-side absence and credential
revocation checks remain unverified. The current local source includes the
two-team assertion correction and population-time precision repair. A separate
offline PostgreSQL proof exercises the precision repair using PGlite and
`SET ROLE`; it does not prove a hosted restricted LOGIN. These local results do
not qualify the corrected fixture. It remains **hosted SQL-unqualified**
until a separately authorized run passes all eight cases, exact
inventory/order/hooks, reviewed source pin and acknowledged cleanup.
Offline selector/report/source tests do not establish SQL
constraints, restricted LOGIN behavior, concurrency, elapsed fit or live provider
parity. The profile does not qualify all 2026 periods, every competition format,
positive provider finality, fleet freshness, the complete SQL suite or CP13's
unresolved source-evidence obligations. Record tested database version, source,
duration, actual results and remaining gaps in the
[DATA evidence ledger](../../../docs/aggregator-backend/data-backend-evidence.md).

## CP13 retained-source and ordinary recovery candidate

The earlier eight-case profile subsequently passed at `29be8bc` in run
[38266572033](https://github.com/clawmachinejed/league-one-audit/actions/runs/38266572033),
with independently accepted report and automatic cleanup. The failed attempts
above remain historical failures. This continuation preserves that module and
its source pin unchanged.

The separate `data-official-results-evidence-v1` profile selects exactly two
ordered cases in `official-results-evidence.integration-case.ts`. Both passed at
`e7977776a645439fea966751dca389a4188a447b` in separately authorized
[run 38281416550](https://github.com/clawmachinejed/league-one-audit/actions/runs/38281416550),
with independently accepted report and automatic cleanup. Its fixed command is
`pnpm test:integration --profile=data-official-results-evidence-v1`; that one-run
authorization is consumed and supplies no retry. Standard discovery grows from 57 to 58
modules, retaining all prior modules. This is not a claim that the complete
suite fits the 30-minute work limit.

The retained-source case replays the 58 minimized roster standings from five
captured 2026 leagues through canonical registration, the existing restricted
writer and stored reader. It preserves native league/team identities, endpoint
clocks, field presence and exact decimal components. A new local `checkedAt`
records validation time only; request and source-observation times remain original.
The original full-document
digest, minimized fixture/slice hashes and newly stored minimized-content hash
have distinct meanings. Replay has a live write fence but no fabricated current
acquisition witness or backdated reservation. Population remains unproved and
minimized rows cannot establish accepted roster or manager membership.

The ordinary case completed a synthetic intake with populated membership
and both brackets, then tested a failed bracket sibling and malformed core data
during refresh. Its assertions showed pending current pairs cannot borrow old
pairs, exact historical pairs remain stable, independently valid standings stay
request-bound, prior membership survives rejection, and recovery settles. It
selects neither exact-period acquisition nor a player-directory acquisition;
canonical player resolution and selected scores retain their separate earlier
proof. All HTTP responses in this case are intercepted synthetic fixtures.

One 60-second case, one 1,080-second case and two 120-second hooks total a
23-minute authored allowance. The measured cases took 3.259333 seconds and
858.555202 seconds; supervisor lifecycle was 947.032 seconds. The ordinary case
passed 14 admissions and 20 intercepted GET attempts, both real retry backoffs
and zero-GET settlement within its existing 1,080 seconds. All original
worker, admission, supervisor, lifecycle and CI deadlines and cleanup/identity/
role/source guards remain unchanged. The selected hosted run qualifies retained-source
readback and failure preservation within its exact source/case boundaries;
offline checks and the earlier eight-case proof remain separate evidence. No
positive provider finality, weekly ties/byes, multiweek completion/correction,
natural cadence, full-suite timing or fleet freshness follows. Full report,
cleanup, source-CI and release state are in the
[DATA evidence ledger](../../../docs/aggregator-backend/data-backend-evidence.md#cp13-retained-source-and-ordinary-recovery-hosted-qualification--october-12-2026).

## Focused played-result qualification

The closed `data-official-results-played-v1` profile selects only the last two
existing cases in `official-results.integration-case.ts`: stored native-score
and bracket composition, then ordinary failed-core recovery and corrected
refresh. It retains the module's existing LF digest, all eight collected names,
source order and one beforeAll/afterAll pair. Exactly two cases must execute and
pass; the other six are reported as filtered (and included in the validator's
skipped total), never as passed. Default discovery and all older profiles are
unchanged.

The first case reads independent stored periods and supplied bracket outcomes;
the second reads initial/corrected bracket results and immutable prior receipts
through the ordinary intake/refresh readers, with stored reads making no provider
calls. Its existing synthetic 2026 fixtures remain synthetic. Separately retained
genuine 2025 source fixtures exercise the same played-result predicate offline;
this profile does not relabel those captures or claim 2025 SQL support.

One 60-second case, one 1,080-second case and two 120-second hooks give a
23-minute authored allowance. The ordinary case retains 15 admissions, 22
intercepted GET attempts plus its separately asserted directory prerequisite,
real admission spacing and original settlement behavior. All existing identity,
restricted LOGIN, source, cleanup and 20-second worker / 30-minute work /
40-minute lifecycle / 50-minute CI guards remain unchanged. No paid execution
is authorized by authoring this selector. The separate retained-evidence module
is not selected; its recovery proof keeps its original source binding.

## CP14 ordinary exact transaction period qualification

The closed `data-transaction-period-intake-v1` profile passed all three cases
at `6213716253369b6c39de774681d406178c2c39fe` in the single authorized
[run 38400157087](https://github.com/clawmachinejed/league-one-audit/actions/runs/38400157087).
Independent audit accepted its evidence and automatic cleanup; fresh Neon
inspection confirmed child absence. The [detailed closeout](../../../docs/aggregator-backend/data-backend-cp14-plan.md#accepted-hosted-qualification--october-13-2026)
retains exact source, counts, timings and boundaries. The profile selects three
ordered cases in `transaction-period-intake.integration-case.ts` with one shared
`beforeAll`/`afterAll` pair, using
`pnpm test:integration --profile=data-transaction-period-intake-v1` through
the existing protected manual workflow. The profile binds the exact module LF
digest, case names/order, hooks, immutable report and acknowledged cleanup;
source drift, extra filters, skipped cases, repeats, retries and substituted
evidence fail closed. Expected selected/collected/executed/passed inventory is
**3/3/3/3**, with zero skipped, filtered or retried cases and two completed hooks.
Default non-live discovery grows from 59 to 60 modules; older profile selections,
module bytes and source pins remain unchanged.

The first case checks the singular explicit `transactionPeriod` selector,
native Week 0/18 boundaries, invalid and changed replay rejection before
admission, omitted-selector compatibility and actual restricted-runtime denial
of direct transaction task/checkpoint mutations. The second uses synthetic
HTTP responses through ordinary identity, discovery, bootstrap, one failed
malformed transaction capture, successful exact Week 0 recovery, core and
directory acquisition. Its expected inventory is seven dispatch admissions
and eight intercepted GET attempts, with genuine 60-second spacing and no
provider-network traffic. It verifies wrong dispatch kind, league, period,
mapping revision, observation and receipt cannot complete the checkpoint.
The resulting receipt is tied to the original database dispatch nonce, work,
write fence, mapping and reservation ordering.

Native IDs (including a string beyond JavaScript's safe integer range), supplied
status, bid zero, missing/null fields, native timestamps and raw contents are
compared through the original normalizer, committed 033 acceptance and exact
relational transaction-entry rows, typed projection and ordinary stored reader. Originating acquisition
clocks remain distinct from native event times and each read's `readAt`.
A subsequent equal-content acquisition through the existing 033 writer reuses
the legacy observation but keeps its own receipt/time; explicit selection of
both receipts and the older request's stored read stay bound to their captures.
This direct equal-content acceptance is not a second witnessed DATA request or
recurring refresh. The third case checks complete-empty Week 18, retained
partial/malformed evidence with last-good preservation, and wrong-period,
mapping and league receipt selection. Stored reads reject all attempted
provider access.

Case allowances are **60, 720 and 120 seconds**, with two existing 120-second
hooks: **1,140 seconds (19 minutes)** in total. The accepted run measured
**494.519 seconds** for the supervisor lifecycle and **519 seconds** for the
GitHub job. It used fixed **0.25 CU** and a **$1 authorization limit**, with
**no automatic retry**. Actual billing was not measured, and this consumed
authorization permits no additional run. Original
20-second worker, 60-second admission, 30-minute work, 40-minute lifecycle and
50-minute CI deadlines, identity/role/TLS/sentinel/denylist guards and automatic
disposable cleanup remain unchanged.

Actual restricted PostgreSQL 18 execution, exact source binding and cleanup
were accepted for these three synthetic cases. Repeated native IDs across
unrelated leagues and deliberate stale/expired-fence injection were not
exercised; original successful receipt/fence binding was checked. This profile
does not qualify CP15 all-period history,
recurring transaction refresh, corrections/removals, a second witnessed
equal-content DATA intake, live provider parity, sustained freshness, capacity,
process death or restore. DATA activation, retained migration installation,
merge and production release remain separately unauthorized.

## CP15 authored full transaction history qualification profiles

**CP15 is complete for its bounded functional acceptance scope** through three separately accepted, once-only profiles at `dd3a573442fcf39b699f9f6735c4d23006028333`: [intake 38456374285](https://github.com/clawmachinejed/league-one-audit/actions/runs/38456374285), [refresh 38460582326](https://github.com/clawmachinejed/league-one-audit/actions/runs/38460582326) and [recovery 38464647170](https://github.com/clawmachinejed/league-one-audit/actions/runs/38464647170). Each retained its own actual PostgreSQL `18.6 (c021049)` / `180006` observation, exact context/report binding, one passing case with balanced hooks and complete acknowledged cleanup. The [detailed closeout](../../../docs/aggregator-backend/data-backend-cp15-plan.md#bounded-cp15-acceptance-complete--october-13-2026) preserves timing, hashes, source/browser deviations and recovery's stale nested GitHub-step metadata. The original three earlier-source functional passes still lack their own version evidence; these new observations do not backfill deleted children. The $1-each/$3-aggregate authorization is consumed, actual billing is unmeasured and no additional SQL run is authorized.

| Manual profile | Collected / selected / executed / passed if successful | Source evidence purpose |
| --- | --- | --- |
| `data-transaction-history-intake-v1` | 1 / 1 / 1 / 1 | All nineteen native periods 0–18 acquired through ordinary intake. |
| `data-transaction-history-refresh-v1` | 1 / 1 / 1 / 1 | A separate ordinary refresh acquires all nineteen periods after a disclosed direct accepted baseline. |
| `data-transaction-history-recovery-v1` | 1 / 1 / 1 / 1 | Bounded ordinary retry exhaustion, next-owner recovery after an injected failure before the first failure-checkpoint commit, and terminal partial coverage; seventeen other periods are explicitly seeded unavailable, never acquired. |

Each profile includes exactly one sequential suite, one ordered case, one `beforeAll` and one `afterAll`; expected skips, filters, repeats and retries are zero. The existing profile validator binds each module's normalized LF SHA-256, exact suite/case name, anchored selection, balanced hooks, immutable report and acknowledged global cleanup. The offline tests independently parse the modules' source inventory without importing or executing their SQL. Default non-live discovery grows from 60 to 63 modules. Older fixture bytes and pins, including CP14, are unchanged. The three literal manual workflow choices do not add an automatic run or retry.

Both complete profiles make **24 ordinary admissions and 25 intercepted GET attempts** for one synthetic league: identity, discovery, bootstrap, nineteen transaction resources, core (two GETs), and users. They acquire **25 job claims**, including the final **zero-GET settlement**. Twenty-three admission gaps plus the final completion-to-settlement gap impose a **24-minute body lower bound**, with all SQL, HTTP simulation, polling and assertions adding elapsed time. Every transaction receipt must have its own persisted checkpoint and network acquisition witness; inventory materialization and direct seeds never count as acquisition. Fresh store instances exercise persisted resumption, not operating-system process death.

The intake case checks selector/replay rejection and runtime privileges, complete and complete-empty receipts, all nineteen period/task/checkpoint identities, exact receipt ownership, independent native/normalized/relational/projector parity, bounded historical paging, and stored reads with source access blocked. An explicit later direct 033 correction proves the original request keeps its original receipt; that correction is not another ordinary intake.

The refresh `beforeAll` directly seeds synthetic identity authority, mapping/enrollment and **nineteen earlier accepted 033 receipts**, with no DATA dispatch or checkpoint for those baseline receipts. It additionally uses one unrelated mapping to test duplicate native IDs and foreign receipts; two direct partial/malformed observations and two reserved ordering attempts (including exact replay) check existing 033 acceptance rules. These prerequisites are not ordinary provider acquisition. The subsequent existing scheduler acquires all nineteen periods again: a correction with an older native event timestamp, authoritative complete-empty removal, and equal-content observations with fresh immutable acquisition receipts/clocks. Historical equality retains the original payload, receipt, provenance and acceptance while separately recognizing current stored team enrichment. Identical native IDs remain separate by league and period. Positive trade evidence includes player movement, participants/consenters, a future draft pick, and zero/nonzero FAAB movement; waiver bid zero is preserved. The complete profiles do not themselves exercise ordinary retry exhaustion or a partial terminal cycle; those branches belong to the separate recovery profile.

Every profile's case allowance is **1,530 seconds** and each hook allows **90 seconds**: **1,710 seconds (28 minutes 30 seconds)** total. The remaining **90 seconds** inside the unchanged 30-minute work deadline must cover global setup, migrations, runtime-role provisioning, reporting and acknowledged global cleanup. The real final cadence drain counts inside `afterAll`. The full profiles leave only 90 seconds of body allowance above their 1,440-second spacing floor; this is a tight authored budget, **not a measured guarantee of elapsed fit**. Slow work must fail within the existing limits; no clock, cadence, fence or supervisor limit is weakened to make it fit. Fixed **0.25 CU**, no automatic retries, **40-minute lifecycle** and **50-minute CI** limits remain unchanged.

The bounded recovery case has **11 ordinary admissions, 12 intercepted GETs and 13 job claims**: eleven source claims, one zero-GET abandoned-dispatch recovery claim and one final zero-GET settlement. Its minimum body spacing is **1,320 seconds (22 minutes)**: 180 seconds from identity through the first failed period, 900 seconds across the four real 60/120/240/480-second failure gaps, and 240 seconds for the next period, core, users and settlement. Work and polling add elapsed time. One direct 033 last-good receipt and seventeen owner-seeded unavailable task rows are disclosed fixture prerequisites; only Week 1 is successfully acquired by this adverse case.

The recovery fixture's owner-seeded unavailable inventory is only a disclosed prerequisite for isolating the expensive adverse path within those same limits. It cannot qualify nineteen successful acquisitions; the intake and refresh profiles supply that separate functional evidence at their stated source bindings. Their measured timings do not guarantee a new run's fit. The three version-instrumented runs complete only the bounded CP15 functional scope. Recovery acquired one period after its disclosed seeds; it did not prove nineteen-success recovery or an ordinary failed refresh cycle. CP16–34, live provider parity, maximum 20-league/380-period capacity, sustained freshness, actual process death/restore and frozen CP1/CP2 operating targets remain open. Retained installation, DATA activation, merge and production release require separate authorization.

## CP16 authored draft metadata profile

`--profile=data-draft-metadata-v1` is a closed manual selection of eight sequential cases in `draft-metadata.integration-case.ts`, with one `beforeAll` and one `afterAll`. The current fixture normalized-LF SHA-256 is `ad02626bdd113ead7d71a2f7365238f407f8eb8116b95da0f78f3e413c0fe4da`. A successful report must contain eight collected, selected, executed and passed cases in source order, zero skips/filters/retries/repeats/errors, and each hook started and ended exactly once. Default non-live discovery grows from 63 to 64 modules; older fixture pins are preserved. The workflow option grants no SQL execution authority.

The authored fixture covers exact 2026 draft identity, settings, order and provider status, including multiple drafts, pre-draft/incomplete states, missing/null/empty/invalid optional fields, zero and unknown native fields. It uses synthetic identity/enrollment prerequisites, fixture HTTP through the existing metadata-only Sleeper adapter, the shared administration writer and stored-only current/exact-receipt readers. Direct writes and adverse probes are fixture evidence, not ordinary DATA intake. Catalog/detail clocks and receipts remain separate; provider timestamps never replace acquisition/acceptance clocks. User-to-slot order and slot-to-roster mappings remain distinct. Intended checks cover independent metadata acceptance, complete-empty inventory, corrections/equal-content receipts, ordering, last-good preservation, source/mapping rejection, original fences and role denials. **Hosted qualification remains open.** At source `9c80b83216394a2b082a2d8fd3fd670b0e1b1417`, [run 38590034289](https://github.com/clawmachinejed/league-one-audit/actions/runs/38590034289) executed all eight cases: seven passed and case 2's legacy seed failed with `P0001`, with zero skips/retries; PostgreSQL 18.6 was observed before launch and cleanup was accepted. The current fixture removes only that seed's mapping argument and preserves whole-read equality with the existing legacy generation sequence 1 → 4 → 5, retaining all fourteen original assertions plus one baseline assertion. The final fixture passed the affected case locally under PGlite 0.5.8/PostgreSQL 18.3 with `SET ROLE` and a `postgres` session user; it has not had a hosted SQL invocation. The local single-case result does not qualify a Neon restricted LOGIN/TLS connection, concurrency, external cleanup or the full eight-case profile.

The opt-in collector allows one catalog GET and at most eight detail GETs, nine requests total. A successfully bounded catalog exceeding eight retains its known observed count; transport overflow leaves inventory totals unknown. Partial/capped captures must preserve prior accepted heads, with independent detail acceptance. The original 20-second work fence, redirect refusal, cancellation and per-response 8 MiB decoded-body/250,000-value/depth-64 limits remain. Retained native bodies share an 8 MiB aggregate allowance; downloaded/decoded bytes can exceed that retained allowance because each response is bounded before retention is checked. Persisted submissions have a separate 32 MiB compact-JSON guard. The source repair uses compact relational entry/link tuples and budgets raw payload, projected value, mapping and provenance with a 64 KiB fixed framing reserve plus eight encoded native league IDs. TypeScript checks the submission/read allowance before query submission; SQL checks a conservative expanded-JSON allowance before legacy writer delegation. Other SQL native-payload expansion rejection can roll back delegated work. Pathological overflow retains no new writes or receipt and preserves the prior head; ordinary partial/malformed/capped captures retain diagnostic native receipts. These source checks and focused tests do not qualify installed SQL, worst-case latency or capacity.

| Authored allowance | Minutes | Boundary |
| --- | ---: | --- |
| Eight 60-second cases and two 120-second hooks | 12 | Selected suite |
| Global setup, migrations and runtime-role provisioning | 8 | Within work deadline; no execution authorized |
| Reporting and global teardown | 3 | Within work deadline |
| Remaining work margin | 7 | Within work deadline |
| **Total work envelope** | **30** | Unchanged hard limit |
| Supervisor cleanup reserve | 10 | Separate reserve; 40-minute lifecycle |
| CI overhead reserve | 10 | Outside lifecycle; 50-minute CI limit |

These are planning allocations, not measured runtime or guaranteed fit. Fixed **0.25 CU**, no automatic retry and existing identity/TLS/role/sentinel/denylist, exact-source, PostgreSQL-version and acknowledged-cleanup guards remain unchanged. A later isolated attempt needs separate authorization for a final immutable SHA. CP17 picks, CP18 ownership/traded picks and CP19 ordinary intake/refresh remain separate; picks and traded picks are unrequested here. CP1/2 and row 16 remain unchanged. Retained installation, DATA activation, merge and production release remain separately unauthorized. See the [current source evidence](../../../docs/aggregator-backend/data-backend-evidence.md#cp16-fixture-repair-current-source-and-qualification-status--october-14-2026).

## CP17 authored draft selections profile — October 14, 2026

The closed manual `data-draft-selections-v1` profile selects eight ordered cases in `draft-selections.integration-case.ts`, under `official draft selections through restricted PostgreSQL`, with one `beforeAll` and one `afterAll`. The final normalized-LF source pin, exact names/order, anchored selection, chronological execution, immutable report and acknowledged cleanup are required. Expected collected/selected/executed/passed counts are **8/8/8/8**, with zero skips, filters, retries, repeats and unhandled errors. Non-live discovery increases from 64 to 65 modules; all older fixture pins, choices and safety guards are preserved. The literal workflow option is source wiring and does not authorize execution.

The intended resource proof covers exact 2026 native selections and source order, optional field states, complete-empty and keeper evidence, corrections/removals/equal captures and replay, stable native pick identities, frozen unresolved/conflicting/resolved player links, last-good preservation, receipt/mapping/forgery rejection, and restricted stored reads with provider access blocked. Synthetic prerequisites and direct accepted captures are fixture evidence; they do not qualify CP19 ordinary DATA intake or refresh. The fence case uses sequential expired reservations and deferred changed/equal commits under the original twenty-second deadlines; it makes no independent-session lock-contention claim.

Eight **60-second** cases and two **120-second** hooks allow **12 minutes**. Planning reserves **8 minutes** for global setup/migrations/runtime-role provisioning, **3 minutes** for reporting/global teardown, and **7 minutes** of margin within the unchanged **30-minute work** limit. The existing **40-minute lifecycle**, **50-minute CI**, fixed **0.25 CU**, no automatic retry, protected credential and identity/TLS/role/sentinel/denylist/source/version/cleanup guards remain unchanged. These are authored allocations, not measured elapsed fit. A proposed future **$1** single-attempt limit remains unapproved; no run, credentials, provisioning, retained installation, DATA activation, merge or production release is authorized.

CP17 source and checks remain in progress; no hosted CP17 qualification follows. The [CP17 plan](../../../docs/aggregator-backend/data-backend-cp17-plan.md) records the exact case inventory, independent scope references and the separately accepted CP16 dependency at `46edac981968a07b92e53202a330fb0436be47a8` ([run 38604592993](https://github.com/clawmachinejed/league-one-audit/actions/runs/38604592993)). That dated acceptance overlay does not rewrite the earlier CP16 records above. CP18 traded ownership/future references and CP19 ordinary intake/refresh remain separate; CP1/CP2 are unchanged. Final source SHA, actual check totals and publication/preview status are bound externally in the candidate pull request and retained evidence.

## CP18 traded-pick ownership profile — October 14, 2026

The dated [CP18 plan](../../../docs/aggregator-backend/data-backend-cp18-plan.md) records accepted CP17 dependency at exact 2145f695ffd5df33da0467c16c3ce6b4c7279064 ([run 38617162716](https://github.com/clawmachinejed/league-one-audit/actions/runs/38617162716)):8/8, actual PostgreSQL 18.6 observed before launch, genuine restricted LOGIN and independently accepted cleanup. This overlay preserves earlier CP17 pending records; its consumed authorization grants no new run.

The manual `data-traded-picks-v1` selector binds seven exact sequential cases in `traded-picks.integration-case.ts`, LF digest `34b3aa905c84eb9eaa13108363be3a2258773190cf1638826f37042be611d68c`, under `official traded picks through restricted PostgreSQL`. Successful inventory is 7/7/7/7 collected/selected/executed/passed, zero skips/filters/retries/repeats/errors, and one balanced beforeAll/afterAll pair. Default non-live modules increase 65→66; old fixture digests and guards remain unchanged.

The fixture uses disclosed synthetic 2026 registration/enrollment, bounded fixture HTTP through the existing adapter, shared normalizer/writer and typed current/exact readers. Complete current conflict/unknown replaces prior resolved evidence honestly; old receipts remain readable. Endpoint scope, native future references, previous-owner ambiguity, corrections/removals/equal/replay, bounded failure preservation, mapping/forgery/order, original 20-second rollback, privileges and legacy/CP16/17 controls are separate assertions. Ordinary CP19 intake/refresh and future-season acquisition are excluded.

Seven 60-second bodies and two 120-second hooks allow 11 minutes; planning reserves 8 minutes setup,3 minutes reporting/cleanup and 8 minutes margin inside unchanged 30-minute work,40-minute lifecycle and 50-minute CI limits. Fixed 0.25 CU, no automatic retry and all protected credential, identity/TLS/role/sentinel/denylist/source/version/cleanup checks remain. A proposed $1 run requires final immutable SHA and separate approval; the choice dispatches nothing.

Local PGlite 0.5.8/PostgreSQL 18.3 executed 55 migrations/all 3 role scripts and all 7 bodies with 398 passing body assertions. The required LOGIN setup assertion correctly fails because embedded session_user is postgres; profilePass is false. Exact final-source evidence is retained externally. This proves neither hosted LOGIN/TLS/external cleanup nor live parity, contention, cadence, capacity, retained installation, activation or production release.

## CP19 ordinary draft intake, refresh and recovery profiles — October 14, 2026

The accepted dependency is CP18 at `bd874f8eb513bca3307a0e2514f4214de8a8a4b5`: [run 38631337128](https://github.com/clawmachinejed/league-one-audit/actions/runs/38631337128) passed its seven cases with actual PostgreSQL 18.6 observed before launch, genuine restricted LOGIN and independently accepted cleanup. That consumed one-attempt authorization grants no CP19 run. Earlier dated CP16–18 records above remain historical and unchanged.

| Closed manual profile | Fixture | Authored body + hooks | Intended bounded proof |
| --- | --- | --- | --- |
| `data-draft-intake-v1` | `public-draft-intake.integration-case.ts` | 900 + 90 + 90 seconds (18 minutes) | One fresh 2026 league and one native draft through ordinary identity, discovery, bootstrap, catalog, league trades, detail, selections, draft trades, core and users. |
| `data-draft-refresh-v1` | `public-draft-refresh.integration-case.ts` | 900 + 90 + 90 seconds (18 minutes) | One configured ordinary cycle after disclosed directly seeded identity/mapping and prior accepted receipts; corrections, complete-empty removals, equal-content fresh captures and original receipt history. |
| `data-draft-intake-recovery-v1` | `draft-intake-recovery.integration-case.ts` | 1380 + 90 + 90 seconds (26 minutes) | One ordinary catalog, five failed selection attempts, next-owner recovery and lost acknowledgment, a successful draft-trade sibling and terminal partial with last-good preservation. |

Each profile contains one sequential suite and one case, with one `beforeAll` and one `afterAll`. A future successful hosted report requires exactly **1/1/1/1 collected/selected/executed/passed**, zero skips, filters, retries, repeats or errors, balanced hooks and the exact normalized-LF fixture digest and case names in `qualification-profile.ts`. Default non-live module discovery increases **66 → 69**; earlier fixture bytes and pins remain unchanged. Literal workflow choices use the existing supervisor and do not dispatch a run.

Intake and refresh each expect **10 admissions, 11 intercepted synthetic GETs and 11 claims**, including final zero-GET settlement. The real 60-second admission and settlement spacing imposes approximately a ten-minute body floor, before SQL, polling and assertions. Their eighteen-minute case/hook allowance leaves twelve minutes for setup, reporting, cleanup and margin inside the thirty-minute work envelope. One completed catalog is acquired per cycle; endpoint retries retain its receipt rather than fetching the whole inventory again.

Recovery discloses owner-seeded identity/list/mapping/bootstrap/core/users prerequisites, a directly accepted last-good selections receipt and two non-target draft tasks marked unavailable under the original owner fence. Those seeds are not ordinary acquisition. The body then uses **7 admissions, 7 GETs and 9 ordinary claims**, including recovery and settlement. Selection failures retain the real **60/120/240/480-second** retry gaps. Seven GET admissions have six minimum gaps of 60 + 60 + 120 + 240 + 480 + 60 seconds, totaling 1,020 seconds (seventeen minutes). Zero-GET recovery and settlement claims do not necessarily add separate minutes; the earlier nineteen-minute estimate was a conservative planning scenario, not a lower bound. The prerequisite owner job can add an initial 60-second cooldown. The twenty-six-minute case/hook allowance leaves four minutes for setup, reporting, cleanup and margin; this is a tight authored budget, not guaranteed hosted fit. A separate bounded nine-draft partial-catalog probe is direct fixture evidence, not a successful ordinary nine-draft cycle.

All three retain original **20-second work/commit fences**, **30-minute work / 40-minute lifecycle / 50-minute CI** limits, fixed **0.25 CU**, protected credentials, identity/TLS/sentinel/role/denylist checks, actual database-version persistence before launch, acknowledged cleanup and **no automatic retry**. Synthetic intercepted responses establish fixture parity only. Fresh stores and injected unknown acknowledgments do not prove operating-system process death, independent-session contention or restore. Maximum eight-draft/twenty-league elapsed capacity, sustained freshness, live-provider parity, retained installation, DATA activation, merge and production release remain unqualified.

The source candidate authorizes offline diagnostics and normal PR CI/preview only. Embedded PGlite runs preserve the genuine LOGIN hook: `current_user` can be the restricted runtime role while `session_user` remains `postgres`, so `profilePass` is false even when the unchanged case body passes. Final source/check/publication evidence is recorded in the [CP19 plan](../../../docs/aggregator-backend/data-backend-cp19-plan.md) and its candidate PR. The next proposal is for exactly **one intake-profile attempt**, at a final immutable SHA, with a **$1 ceiling**; it remains unapproved. Refresh, recovery, any rerun and all retained/production operations need separate authorization.

## CP20 authored within-season history composition profile — October 14, 2026

The closed manual `data-within-season-history-v1` profile selects five ordered cases in `within-season-history.integration-case.ts`, one sequential suite and one `beforeAll`/`afterAll` pair. Its exact normalized-LF source digest and case names are bound in `qualification-profile.ts`; a successful report requires **5/5/5/5 collected/selected/executed/passed**, zero skips, filters, retries, repeats or errors, balanced hooks and acknowledged cleanup. Default non-live discovery grows **69 → 70** modules. Earlier fixture bytes/pins, supervisor, reporter, harness, roles and migrations remain unchanged. The fixed manual workflow command is source wiring, not SQL execution authority.

The five authored groups cover three unrelated redraft/keeper/dynasty 2026 leagues with all **54 native period receipts** and both bracket families; page versus season coverage, native period 19 and unavailable/pending/unrequested states; corrections/removals/equal captures/replay and resumable retained manifests; period-applicable settings with unchanged captured provenance; and foreign/remapped identity, bounded comparison and source-free reads. Multiweek playoff legs remain separate native periods. Scores preserve supplied zero and negative values. Weekly outcomes, finality, byes and aggregate series remain unknown without corresponding evidence. Missing core standings remain an explicit gap even after every native period is verified. No prior-season chain or CP13 2025 exception is inherited.

**Disclosed direct prerequisites:** synthetic canonical registration and enrollment; completed candidate/core prerequisite metadata; and an original job owner plus dispatch row for each selected step. These bypass admission and core acquisition. A terminal unavailable task is directly seeded to isolate a missing-state read. Existing restricted identity/list checkpoints, settings/matchup/bracket reservations and acquisition witnesses, typed administration acceptance and exact period/bracket checkpoints still execute with all installed triggers and original twenty-second fences. No accepted receipt is fabricated. Applicability activations and source remap are explicit synthetic owner operations. The fixture proves stored composition only; it does not prove ordinary intake/refresh admission, elapsed cadence, live provider parity or complete core acquisition.

The five case allowances are **300/90/120/120/90 seconds** and each hook allows **120 seconds**, totaling **16 minutes**. Planning assigns **8 minutes** to setup/migrations/roles, **3 minutes** to reporting/global cleanup and **3 minutes** margin inside the unchanged **30-minute work** deadline. These are authored allocations, not measured fit. The **40-minute lifecycle**, **50-minute CI**, fixed **0.25 CU**, no automatic retry and all identity/TLS/sentinel/role/denylist/source/version/cleanup guards remain intact.

Hosted SQL qualification is open. An offline exact-body PGlite diagnostic may check installed SQL with restricted `SET ROLE`, while retaining the required failing LOGIN assertion because embedded `session_user` is `postgres`; such a result has `profilePass=false`. It cannot qualify Neon LOGIN/TLS, external cleanup, cadence, contention or capacity. A hosted attempt needs a separately authorized immutable source SHA and budget. Retained installation, DATA activation, merge and production release remain separate.

## CP21 fresh installation and actual restricted LOGIN profile — October 15, 2026 UTC

The closed manual `data-fresh-install-v1` profile selects exactly eight ordered cases in `fresh-install.qualification-case.ts`, under `fresh installation and restricted LOGIN enforcement`, with one balanced `beforeAll`/`afterAll` pair. Its module is excluded from ordinary integration-case discovery. Exact source digests, names/order, immutable initial and installed evidence, context, reporter and acknowledged cleanup must agree. A successful hosted report requires **8/8/8/8 collected/selected/executed/passed** and zero skipped, filtered, repeated or retried cases and unhandled errors. The fixed workflow choice grants no execution authority.

The [frozen CP21 plan](../../../docs/aggregator-backend/data-backend-cp21-plan.md) defines the complete enumerated schema/constraint/index/trigger/function/type/ACL/RLS/membership inventory and eight-case enforcement matrix. Expected catalog data comes from the accepted CP20 source before fixture implementation; it is never regenerated from the database under test. Representative behavioral probes supplement that complete inventory without claiming behavioral fault injection of every constraint.

The existing disposable role-first installer is retained. Before any role creation, the supervisor records exact child/owner/source identity, empty application schemas and absent runtime/account/auth roles. It creates fresh generated credentials for all three only for this profile, applies all 56 migrations and three maintained provisioners through the existing harness, and preserves the installed clock function. Each restricted role must then connect with its own actual LOGIN and prove both permitted operations and denied access. Owner SET ROLE helpers cannot satisfy LOGIN acceptance. All three credentials are redacted, revoked and checked under the existing cleanup lifecycle. The standalone migration-first CLI and unexecuted provisioner CREATE ROLE branches remain outside this profile.

Six 90-second cases, two 120-second cases and two 120-second hooks allow **17 minutes**; setup 8, reporting/cleanup 3 and margin 2 total the unchanged **30-minute work** envelope. The **40-minute lifecycle**, **50-minute CI**, fixed **0.25 CU**, original **20-second worker fences**, no automatic retry and all identity, TLS, sentinel, role, denylist, exact-source, version-before-launch and cleanup guards remain. These are planning allocations, not measured fit.

An offline PGlite diagnostic cannot prove actual restricted LOGIN, hosted TLS or external cleanup. In particular, a superuser-authenticated embedded connection retains session authorization power after SET ROLE; failures at the actual-LOGIN or impersonation assertions must remain visible, with any unexecuted tails reported. Local body checks do not constitute a hosted profile pass. Retained installation, DATA activation, merge and production release remain separately unauthorized.

### CP21 catalog transport repair — October 15, 2026 UTC

The original [hosted attempt 38671870366](https://github.com/clawmachinejed/league-one-audit/actions/runs/38671870366) failed in global setup at the six-row policy comparison; all eight cases and both fixture hooks were unexecuted. Supervisor cleanup was acknowledged separately. Its exact differing row was not retained and its one-attempt authorization is consumed. The [dated repair record](../../../docs/aggregator-backend/data-backend-cp21-plan.md#consumed-hosted-attempt-and-local-transport-repair--october-15-2026-utc) preserves that limitation.

Independent local reproduction confirms that Neon 1.1.0 leaves PostgreSQL `name[]` policy-role output as a string. The query now explicitly emits `text[]` while retaining the original values, ordering and strict frozen comparison. On a catalog comparison failure, a separately typed unverified diagnostic records only bounded sanitized mismatch details and source/run/context/server-version bindings before rethrowing. It is never accepted as installed evidence; write failures also fail closed through existing cleanup. The frozen manifest and eight-case actual-LOGIN contract remain unchanged. A new exact-SHA hosted attempt needs separate approval.

### CP21 database ACL repair and complete comparison diagnostics — October 15, 2026 UTC

The next separately authorized [hosted attempt 38684006032](https://github.com/clawmachinejed/league-one-audit/actions/runs/38684006032), at source `56192047ebbefe97bb5570787c2a5d635accebd4`, passed the repaired policy comparison but failed global setup at `databaseAcl`: eight expected rows, eleven observed. **Zero cases were collected, executed or passed; all eight cases and both fixture hooks were unexecuted.** Cleanup was acknowledged separately and fresh branch inspection corroborated child absence. That attempt's authorization is consumed.

Independent reconstruction of the complete normalized snapshot matches its retained catalog SHA-256 exactly. The only additional database grants are `CONNECT`, `CREATE` and `TEMPORARY` for `neon_superuser`, with the verified installer as database owner and grantor and no grant option. The [dated ACL repair plan](../../../docs/aggregator-backend/data-backend-cp21-plan.md#cp21-database-acl-repair-and-complete-comparison-diagnostics--october-15-2026-utc) records the pinned Neon source, full installed-reader reproduction and evidence limits.

The frozen manifest remains unchanged. A separately defined exact Neon platform variant requires a same-snapshot platform witness, verified owner, fixed role flags, installer membership, absence of application-role membership, and equality between the catalog and initial evidence branch IDs. It adds only those three expected ACL rows. Missing or additional grants, unexpected principals, grant options, owner/grantor drift and application privilege or membership escalation still reject. The direct catalog comparators retain the original standalone PostgreSQL variants with explicit absence of platform evidence. Hosted installed-evidence writers and readers require a nonnull platform witness for their verified Neon branch; a standalone eight-row artifact cannot substitute.

On a completed catalog mismatch, `fresh-install-diagnostic-v2` reports all structural, privilege and normalized/raw membership comparison summaries from the same snapshot, with deterministic missing/extra rows and unambiguous field changes. Bounded nonsecret identifiers and principal names remain readable; expressions, function bodies, configuration, unsafe values and unknown raw error messages are not emitted. Explicit omission counts accompany bounded details. The unverified artifact remains under 64 KiB, immutable and separate from accepted installed evidence. A separate platform-witness phase reports fixed identity, role-flag and membership fields, including branch-binding differences, with safe expected/observed values. It explicitly records whether the snapshot was completed and never implies that catalog comparisons ran. Incomplete reads or invalid bindings cannot fabricate a complete comparison. Comparison or diagnostic-write failure still fails setup and follows existing cleanup. No new hosted attempt is run by preparing this candidate.

## CP22 process death and restart profile — October 15, 2026 UTC

The [frozen CP22 plan](../../../docs/aggregator-backend/data-backend-cp22-plan.md) selects seven durable process-death states through the existing intake, refresh, registration, typed acceptance and stored-reader owners. The accepted dependency is CP21 at `ed1440bdc79624824387a714f38f9a0636435958`, repository tree `e49122bbf8705688576f9a20734e9ddfea95d581`, with [run 38758102959](https://github.com/clawmachinejed/league-one-audit/actions/runs/38758102959) accepted for eight cases in the user handoff. Original CP21 evidence and failed attempts remain unchanged.

The closed manual `data-process-recovery-v1` profile is authored in `process-recovery.qualification-case.ts`, excluded from ordinary integration-case discovery. Its seven ordered names/source digest are bound by `qualification-profile.ts`. Later hosted acceptance requires **7/7/7/7 collected/selected/executed/passed**, zero skips, filters, retries, repeats or unhandled errors, one balanced `beforeAll`/`afterAll` pair, seven complete process-death/restart records and acknowledged cleanup. The fixed command uses the existing disposable supervisor; adding its manual choice grants no SQL execution authority.

The seven barriers are: admitted draft child before acquisition; bootstrap after actual identity rollback; canonical identity committed before bootstrap checkpoint; first independently accepted core family; all core receipts accepted before intake checkpoint; final users checkpoint committed before job completion; and refresh selection committed before admission. Cases 2–6 share an ordinary intake journey with actual pending retry state. The draft case discloses prior synthetic identity/list/bootstrap/task state and accepted catalog evidence through the existing restricted writer; these prerequisites are not ordinary acquisition credit. Every measured dispatch/recovery/acceptance follows the existing worker and original fences. No typed receipt is fabricated.

The final users checkpoint case requires a fresh process to settle the terminal request with **zero GETs**. The recurring case proves the same cycle/request resumes through a fresh identity checkpoint, with prior typed state/history preserved and remaining work explicitly pending. It does not qualify a complete refreshed cycle or cadence. This profile does not rerun every resource-specific suite or test CP23 contention/fairness; its denominator is the seven distinct durable crash states.

Nested runtime workers remain inside the supervisor's POSIX process group and receive only an explicitly filtered runtime environment, never owner/auth/control-plane credentials or `NODE_OPTIONS`. The existing process helper tracks the owned live child, performs hard termination and verifies closure. Parent evidence observes the old PostgreSQL transaction/locks gone before launching a new process. Exception injection, suppressed acknowledgments, orderly shutdown and new store objects inside the old process do not qualify actual death/restart. Existing cleanup remains the sole schema/credential/child-branch lifecycle owner.

All **20-second work fences**, **25-second leases**, **60-second admission** and real **60/120/240/480-second retry** guards remain. Bodies allow **210/270/120/240/120/240/180 seconds** and both hooks allow **90 seconds**, totaling **26 minutes**. Four minutes remain for other guarded setup/reporting inside the unchanged **30-minute work** limit. This is a tight authored budget, not measured hosted fit. The **40-minute lifecycle**, **50-minute CI**, source/identity/TLS/sentinel/role/denylist/version guards, automatic cleanup and no automatic retry are unchanged. Timeout fails without extending deadlines or borrowing teardown reserve.

CP22 is a source candidate with all seven actual PostgreSQL cases **unexecuted**. Local diagnostics, targeted/full source checks, independent review, draft publication, normal CI and exact preview inspection remain separately reportable. A hosted attempt needs separate immutable-source authorization. No paid run, credential retrieval, provisioning, hosted migration application, retained installation, DATA activation, merge or production release is authorized. Sustained fleet freshness, thirty-minute outage/four-hour backlog, restore and CP23 operating work remain outside this profile.

### CP22 consumed attempt and reader assertion repair — October 15, 2026 UTC

The preceding unexecuted status describes initial authoring. Separately authorized [run 38776454151, attempt 1](https://github.com/clawmachinejed/league-one-audit/actions/runs/38776454151), at `2359f1102a572214c5c882b06f6758627319387f`, executed all seven cases: **six passed and case 1 failed**, with no skips or retries. Its nested reader matcher rejected the complete status envelope because the expected plain status object contained only `value`; the following no-fetch check was not reached. All seven hard-death/restart records were retained. Qualification failed, while disposable cleanup was accepted and owned-child deletion independently corroborated. The [dated plan record](../../../docs/aggregator-backend/data-backend-cp22-plan.md#consumed-hosted-attempt-and-reader-assertion-repair--october-15-2026-utc) binds the original artifacts and explains the validator's generic failure wording.

The authorized source repair preserves the reader contract and adds an actual-expression regression with updated source/profile pins. It carries no hosted qualification credit. The original seven-state denominator, guards, case/hook allocations and **30/40/50-minute** limits remain fixed; all seven cases must pass together at a new immutable SHA. The prior one-run authorization is consumed. Source repair/readiness and preparing a new proposal do not authorize another paid run, retained installation, DATA activation, merge or production deployment.

### CP22 accepted repaired-source overlay — October 15, 2026 UTC

The later separately authorized [run 38787959300, attempt 1](https://github.com/clawmachinejed/league-one-audit/actions/runs/38787959300) passed all **7/7/7/7** collected/selected/executed/passed cases at `2cf9fc2899efddd338c2c347e00a629be87764d6`, tree `2a03d679ffa68a52c452cb135780aa9b96110d99`, with zero skips, filters, retries, repeats or errors and balanced hooks. The retained accepted `qualification-closeout.json` has SHA-256 `eed41adc6b584cbf365712ae130c8923585f8da629e84c287c6116f2a74793e0`. It binds PostgreSQL **18.6 (653b019) / 180006**, seven actual deaths/replacements, the case-1 no-fetch pass and acknowledged cleanup. The original failed six-pass/one-failure attempt remains failed and unchanged. Both allowances are consumed; the accepted seven-state result supplies only CP22 dependency evidence, not CP23 SQL/run/release authority.

## CP23 independent competing workers and bounded fairness — October 15, 2026 UTC

The [frozen CP23 plan](../../../docs/aggregator-backend/data-backend-cp23-plan.md) defines five ordered cases in `competing-workers.qualification-case.ts`, one sequential suite, and one `beforeAll`/`afterAll` pair. The closed manual `data-competing-workers-v1` profile binds exact names/order, fixture and support-source digests, context, report and acknowledged cleanup. Passing hosted acceptance requires **5 collected / 5 selected / 5 executed / 5 passed**, zero skips, filters, retries, repeats or errors and complete process/session/durable-state oracles. Ordinary discovery remains 70 modules. Adding a fixed manual workflow choice does not authorize execution.

The five cases exercise a two-live-worker claim/admission race; live stale-owner rejection after the original fence and natural lease takeover; observed SQL lock-wait rollback while healthy work progresses; a durable pre-admission selection failure without false admission/`last_served_at`; and six ordinary competing admissions **F, A, B, F, A, B** across three fixed targets. F's roster endpoint fails twice. A and B each acquire, accept/checkpoint and read back core then users data, with deadlines **180/240/360/420 seconds** from an epoch fixed before measured worker launch, at most **240 seconds** between each healthy target's accepted progress, and at most **420 seconds** first-to-sixth admission. All real adjacent admission gaps remain at least 60 seconds. Missing/unserved/failing targets remain in the fixed denominator; metadata-only progress is insufficient.

Synthetic canonical identity, identity/list/bootstrap/core-ready metadata and refresh setup through existing configure/select with temporary setup-only pause/unpause are explicit prerequisites, never ordinary acquisition credit. No accepted receipt is fabricated. Negative stale-write probes preserve the actual old fence and SQL on one verified restricted backend using the existing transaction wrapper; they run after actual different-owner takeover and do not claim ordinary driver error/reconnect behavior. The same narrow wrapper handles expected expired-fence intake cleanup in only the stale-core/bootstrap-lock worker actions through the existing cleanup hook, retaining the backend and fixed rejection category without successful checkpoint credit. Positive work and job transitions use the unchanged ordinary client. Two independent worker PIDs/backends must be concurrently live; store instances or injected exceptions alone cannot qualify contention. The existing supervisor and nested-child helper retain lifecycle ownership and runtime-only secret filtering.

Planned totals are **12 admissions, 21 GET attempts and at least 15 acquired ordinary claims**; every extra zero-GET claim and busy attempt remains reported. Body limits **180/210/240/210/540 seconds** plus two **90-second** hooks total **26 minutes**, leaving four minutes inside the original **30-minute work** budget. Fit is unmeasured. Original **20-second work fences**, **25-second leases**, **60-second admission**, real retry progression, **40-minute lifecycle / 50-minute CI**, 0.25 CU, no automatic retry and all identity/TLS/sentinel/role/denylist/source/version/cleanup guards remain intact. No runtime, helper, harness, schema, role or provider change is selected.

**All five actual PostgreSQL cases are unexecuted.** Local/offline checks, independent source review, draft publication, normal source CI and actual preview remain separately reportable. A hosted attempt needs separate immutable-source authorization. This profile does not qualify complete refresh cycles, CP24 configuration transitions, CP26 sustained fleet freshness/capacity, outage/backlog, restore, retained installation, DATA activation, merge or production release.

## CP23 failed attempt and source repair — October 16, 2026 UTC

The preceding CP23 section records the original authoring boundary. Subsequent [run 38824807133](https://github.com/clawmachinejed/league-one-audit/actions/runs/38824807133) at exact source `f9199daf2e6fb9c4ca6da1710c8aad613b640efb` executed all five cases: **1 passed / 4 failed**, with cleanup separately verified. Its evidence and consumed allowance remain unchanged. Observed totals were 10 claims/341 attempts/5 admissions/8 observed GETs (incomplete-step lower bounds), not the planned denominator. CP23 remains unqualified.

The approved narrow [repair overlay](../../../docs/aggregator-backend/data-backend-cp23-plan.md#failed-attempt-and-narrow-fixture-repair--october-16-2026-utc) reuses the existing checked-out-client harness implementation through an explicit runtime-URL entry so worker backend identity survives the required idle waits. Case 4 waits for original job/admission eligibility before starting its sole one-shot F fault, binds that failure to its durable cycle/request/owner, and requires H's actual admission before F's original retry boundary. The separate allowlisted fatal channel is bounded best-effort evidence after connection finalization; missing diagnostics retain only a parent-observed exit/startup fact with unknown child cause. It never supplies success/session proof. Existing helpers' behavior, runtime SQL, all five oracles, fairness epoch/denominator/bounds, original fences, cost/deadline limits and no-retry guards remain intact. The harness is additionally pinned for CP23 only; older profile pins are unchanged.

The new regression timeline uses fake clocks only offline and is not elapsed SQL proof. Local verification and independent source review are recorded separately. This repair authorizes no paid rerun, credentials, provisioning, retained installation, DATA activation, merge or production release.

## CP24 controlled backend submission, configuration and stored status — October 16, 2026 UTC

The [frozen CP24 plan](../../../docs/aggregator-backend/data-backend-cp24-plan.md) defines nine ordered cases in `backend-controls.qualification-case.ts`, excluded from ordinary integration-case discovery. The closed manual `data-backend-controls-v1` profile binds exact names/order, fixture and support digests, one sequential suite and one balanced hook pair. Later hosted acceptance requires **9 collected / 9 selected / 9 executed / 9 passed**, zero skips, filters, retries, repeats or unhandled errors, and acknowledged supervisor cleanup. Ordinary discovery remains **70 modules**. A fixed workflow choice is source wiring and grants no execution authority.

The nine cases cover: strict controlled submission validation and canonical replay/conflict; stable refresh identity, explicit selectors and immutable cycle scope; two observed competing configuration CAS calls with one retained revision; pause/expiry before admission and current-token same-cycle resume; admission before pause with an original-fence identity checkpoint and a genuine subsequent leagues failure/retry record; sixteen targets including paused targets; fifteen pending requests plus two competing submissions producing one retained request and one durable capacity receipt; stored-only status and failure/progress readback; and restricted control permissions plus immutable configuration/capacity history. Accepted selectors include exact periods, brackets, weekly reports, transaction history and draft picks. Case 7 reads their canonical retained scope and rejects a same-ID selector mismatch after headroom changes. The controlled entrypoints execute their real Neon HTTP database composition, including the original **3-second AbortSignal**; only the test's database dependency selection is replaced. Pinned sessions orchestrate observed locks without substituting for that composition.

Before the cases, an ordinary identity and empty-league-list journey uses **two intercepted synthetic GETs** and real admission spacing. Case 5 uses **two additional GETs**: an actual captured identity and a subsequent 503 leagues response through the existing adapter/failure owner. Its persisted failure, retry time and prior identity survive the later stored read. Measured capture and failure timestamps are produced by the existing owners. Empty discovery proves only its selected discovery result, not a full resource refresh. Case 6 discloses sixteen owner-seeded identity prerequisites, including their synthetic timestamps, solely to configure control targets; no target, configuration, dispatch or accepted typed receipt is seeded. Case 7 marks one unused filler terminal solely to release queue headroom, with zero source/completion credit; that synthetic terminal metadata also supplies the separate unavailable-reader prerequisite. No acquisition follows the capacity fill.

Actual `league_one_runtime` and `league_one_auth` LOGIN must be observed. Account and PUBLIC effective denial, role flags, absence of memberships and inability to escalate are checked, but **actual account LOGIN is not rerun** by this profile. The fixed `backend-controls-evidence.json` companion is bounded, sanitized, exclusively written and independently read back. Closed-profile artifact validation requires its exact context/source/version bindings, nine completed case oracles, chronology and time bounds, actual roles and **2 prerequisite / 2 measured GET** reconciliation. Module/session closure is separate from the supervisor's authoritative schema, generated-credential and branch cleanup.

Body allowances are **90/90/120/180/240/90/180/90/120 seconds**, with **240-second beforeAll / 90-second afterAll**: **25 minutes 30 seconds**, leaving **4 minutes 30 seconds** for other setup/reporting inside the unchanged **30-minute work** limit. This is an unmeasured allocation. Original **20-second worker fences**, **25-second leases**, **60-second admission**, real retry spacing, **40-minute lifecycle / 50-minute CI**, fixed **0.25 CU**, a separately authorized **$1 maximum** for any proposed attempt, all identity/TLS/sentinel/role/denylist guards and no automatic retry remain. Submission latency is recorded without claiming CP1's two-second target; benchmark qualification belongs to CP26.

Migration 057 and its single additional runtime EXECUTE signature intentionally invalidate the current-source CP21 frozen installation match. CP21's original manifest, source guard, 56 migrations and accepted artifacts remain unchanged; its deterministic test now requires that drift to fail closed. CP30 must separately qualify the later installed catalog. **All nine hosted CP24 cases remain unexecuted.** Offline PGlite/source checks cannot establish restricted LOGIN, concurrent hosted sessions, TLS or external cleanup. Paid execution, credentials, provisioning, retained installation, activation, merge and production release remain unauthorized.

### CP24 consumed attempt and fixture HTTP repair — October 16, 2026 UTC

The later separately authorized [run 38903601068, attempt 1](https://github.com/clawmachinejed/league-one-audit/actions/runs/38903601068), at `271702b31a50950f662793607c8fd8c9505fa9de`, failed during `beforeAll`: **9 collected/selected, 0 executed/passed, 9 skipped**. Original artifacts remain failed and unchanged; cleanup was acknowledged separately. The installed Neon driver sends HTTP SQL to its derived regional API endpoint, whereas the fixture accepted only the database endpoint hostname. Independent offline reproduction confirmed that mismatch.

The narrow [repair overlay](../../../docs/aggregator-backend/data-backend-cp24-plan.md#consumed-hosted-attempt-and-fixture-http-routing-repair--october-16-2026-utc) derives the exact HTTP endpoint from the installed driver's supported configuration and forwards only `POST` with the exact guarded runtime connection identity. It rejects custom transport overrides, preserves original fetch arguments/AbortSignal and retains all source-acquisition tripwires. A new pinned fixture-only helper and actual-callback/installed-driver offline regression carry this correction. Shared database/runtime code, all nine cases and budgets, evidence oracles, LOGIN, clocks, supervisor and cleanup remain unchanged. The original paid allowance is consumed; source repair and offline tests authorize no rerun.


## CP24 second failed attempt and exact oracle repair - October 16, 2026 UTC

The separately authorized [run 38911117002, attempt 1](https://github.com/clawmachinejed/league-one-audit/actions/runs/38911117002), at exact source `037d6d9676ad4b38684f2c3a8682acf6b45fc429`, collected, selected and executed all nine cases: **7 passed / 2 failed / 0 skipped**, with zero retries, repeats, hook errors or unhandled errors. The unchanged validators reject the result. Seven completed case oracles do not qualify CP24 or transfer acceptance to the next source. Actual runtime/auth LOGIN and two prerequisite/two measured synthetic GETs were observed; actual account LOGIN and live-provider parity were not rerun.

Case 8 compared a correct `.780Z` database Date after converting it through `String(Date)`, which discarded milliseconds and produced `.000Z`. Independent offline execution of the actual readers and installed Neon parser confirmed preserved precision. Case 9's auth role correctly lacked public schema USAGE; its unqualified table probe therefore returned `42P01` before the expected permission check. PostgreSQL 18.6/PGlite with all 57 migrations and three unchanged provisioners independently reproduced `42501` for the explicit `public.public_data_intakes` probe. Embedded SET ROLE is not actual hosted LOGIN evidence.

Scope `DATA-CP24-2026-10-16-ORACLE-REPAIR-SCOPE` permits only a Date-aware exact timestamp comparison and that schema-qualified auth SELECT, actual-source AST regressions in the existing profile test, the fixture digest update, and this documentation/scope history. Exact timestamp equality and SQLSTATE `42501` remain required. There is no rounding, tolerance, permission grant, search-path, application, runtime, database-function, migration, helper or validator change. All nine names/order/oracles, original case/hook budgets, fences, admissions, 0.25 CU and 30/40/50-minute limits remain.

The failed run stopped before case 8's final unchanged-state/fetch-counter assertions and case 9's remaining escalation, direct-DML, private-helper and immutable-history probes. Those hosted obligations remain unproved. Offline regression cannot fill them in; a future separately authorized candidate must pass all nine cases and complete cleanup.

The immutable second failure closeout is `test-results/cp24-hosted-037d6d9/qualification-closeout.json`, SHA-256 `497a05d2bf747f86b1ac345193663167906776171ba27b35021c0813431608e6`. Independent audit matched all 17 archive entries and 13 ordered journal receipts with the terminal acknowledgment. Child closure, schema cleanup, credential revocation and branch deletion were confirmed; the refreshed Neon inventory independently corroborated child absence. Lifecycle was 249,602 ms. Actual billing remains unverified. Both separately approved one-attempt allowances are consumed; **no third attempt or automatic retry is authorized**. The original and second proposals, reviews, logs and failed closeouts remain immutable. New repair evidence is separate under `test-results/cp24-repair2`.

This repair candidate has no hosted executions. Final source review, complete ordinary verification, publication, normal CI and actual preview must be recorded separately before a new exact-source proposal and fresh human approval. No merge, production deployment, retained installation or DATA activation is included.

## CP25 repeated opt-in runner cycles source candidate — October 16, 2026 UTC

The [frozen CP25 plan](../../../docs/aggregator-backend/data-backend-cp25-plan.md) records independent nonauthor confirmation `DATA-CP25-2026-10-16-RUNNER-SCOPE`. The accepted dependency is CP24 `9809ea41ec48998c28f094bca213898e948870de`, tree `a786e4037a0e7b64d810df1fb45bdb3c8bbb4e09`; the coordinating root freshly matched its supplied accepted closeout SHA-256 `f52fde543b044905fac1bd088b7d993375aac6376c4f916fc3e992018c834f05`. Earlier failed CP24 records remain unchanged. The closed manual `data-runner-cycles-v1` profile defines four exact ordered cases in `runner-cycles.qualification-case.ts`, one sequential suite and one balanced hook pair, with later acceptance requiring **4 collected / 4 selected / 4 executed / 4 passed** and zero skips, filters, retries, repeats or errors. Ordinary integration discovery remains **70 modules**.

The fixture invokes the actual unchanged `runProductionProjectionSync` facade and its existing opt-in DATA finally drain. It covers omitted/false selection, enable/disable with pending work, pause/expiry before and after admission, an inter-invocation child restart, and two completed one-league 2026 cycles with explicit native week 1. Each cycle includes identity, discovery, bootstrap, core, users and exact-period acquisition plus a zero-GET settlement, with durable original and corrected stored readback. Transactions, brackets, drafts and weekly reports are outside this selected cycle. The real isolated empty-registry rejection is preserved; projection and maintenance branches do not run, so this hosted candidate cannot claim positive primary-operation coexistence. Separate actual-facade offline success/failure isolation tests retain their source-only proof class.

Planned totals are **14 admissions / 18 synthetic GET attempts / 18 acquired claims**: two prerequisite admissions/GETs/claims; twelve cycle admissions, sixteen cycle GETs and fourteen cycle claims including settlement; and two paused/expired zero-GET claims. All extra/busy attempts remain reported. Body bounds **60/660/600/60 seconds**, plus **180/90-second hooks**, allocate **27 minutes 30 seconds**, leaving **2 minutes 30 seconds** inside the original thirty-minute work limit. Natural admission/cadence/expiry waits, original twenty-second fences and twenty-five-second leases remain; the **40-minute lifecycle / 50-minute CI**, **0.25 CU**, separately authorized **$1 maximum** for any future proposed attempt, source/identity/TLS/sentinel/role/denylist/version/cleanup guards and no automatic retry are unchanged. Arithmetic and authored allowances are not measured fit.

The fixed `runner-cycles-evidence.json` companion binds completed case oracles, source/context/version, runtime and child identity, all attempts, real control/admission chronology, complete cycle outcomes, immutable receipt history and stored reader parity. Report acceptance and the supervisor's authoritative cleanup remain separate requirements. New fixture/support digests do not change prior profile pins. CP21's original 56-migration manifest still rejects the current 57-migration source; this candidate supplies no renewed full-catalog qualification. CP1/CP2, CP22/CP23/CP24 original evidence and every historical failed attempt remain intact.

**All four hosted CP25 cases are unexecuted: 0 executed / 0 passed.** Local/offline checks, independent source review, draft publication, normal CI and actual preview are separate reportable work. No paid SQL run, credentials, provisioning, hosted migration application, retained installation, DATA activation, merge or production release is authorized. CP26 fleet freshness/capacity/outage/backlog, CP27–30 query/storage/restore/final qualification and CP31–34 installation/release/activation remain separate.

Independent offline PGlite 0.5.10 / PostgreSQL 18.6 diagnostics passed **17 checks (11 controls / 6 settlement)** at their retained source snapshot, after an initial diagnostic failed on string-versus-number bigint decoding. Both attempts remain in `test-results/cp25-local/independent-offline`; the passing result SHA-256 is `7822ebcf3911659a00f1346b7c84033edd0048b911778b60e2ccd0995b524a1f`. Restricted SET ROLE and synthetic prerequisites are not actual LOGIN or acquisition proof. A nonempty cycle remained pending; the separately completed empty-association request is not full-cycle qualification. A separate AST diagnostic prepared **21 literal SELECTs without execution**, explicitly skipping **two dynamic templates**. The CP25 plan records scripts/result hashes and original failure history; later source changes need their own final checks.

At the newly pinned fixture/helper bytes recorded in the CP25 plan, the entire local Node 24 qualification-profile test file passed **145/145**, with zero failures/skips and no SQL fixture execution. Verbose log `test-results/cp25-local/qualification-wiring/profile-attempt1.log` has SHA-256 `b7e0867267746b7177ee82c9ffd7e0edd002ceb8b203b7a268e555022d57bdf8`. All 33 historical source-digest/support declarations remain unchanged. Focused lint, scope and diff checks passed; complete verification, final independent review, publication and preview remain separately reportable. The subsequent independent dynamic diagnostic checked the expanded 145-table full / 46-table protected snapshot and eleven history reads; the plan preserves its earlier narrower snapshot and exact result hashes. No local result supplies hosted CP25 acceptance.

## CP25 failed first attempt and source-only counter repair — October 16, 2026

The earlier unexecuted status above describes original authoring. Exact source `177c77af1c74bc78b31d7a255c4900ac1d3670b9` later failed [run 38939114958](https://github.com/clawmachinejed/league-one-audit/actions/runs/38939114958): **4 collected / 4 selected / 4 executed / 3 passed / 1 failed**, one case error, one suite error and an unfinished afterAll hook. Zero skips, filters, retries, repeats or unhandled errors were reported. The ordinary bounded registry read contributed one request to a broad signal counter incorrectly required to be zero for omitted selection. The companion writer rejected the same invariant before writing, leaving no companion; the three passing cases and planned acquisition totals are not accepted CP25 proof.

Cleanup was confirmed, including independent child absence. Immutable failed closeout `test-results/cp25-hosted-177c77a/qualification-closeout.json` has SHA-256 `11357b28befa73fdb5112aec03f969d10e294579d707894feb686c35afa92acb`. The approved attempt is consumed. Preserve every original artifact and failure.

The source-only repair distinguishes the exact ordinary registry SQL/signal counters from total SQL/signal counters. Disabled calls still require zero DATA acquisition, admission, claim or durable mutation and reject additional unmatched SQL. Enabled admissions retain signaled SQL beyond that registry read. Twenty support pins include the unchanged registry and enrollment reader. The same four cases, complete companion, balanced hooks, cleanup, fences and budgets remain mandatory. The [CP25 plan](../../../docs/aggregator-backend/data-backend-cp25-plan.md#source-only-registry-counter-repair) records the exact boundary. This candidate has no hosted result; a new run needs a reviewed committed source and fresh explicit approval. No workflow dispatch, production change or DATA activation is authorized by the repair.
