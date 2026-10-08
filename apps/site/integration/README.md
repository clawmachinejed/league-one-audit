# Disposable Neon integration tests

`pnpm test:integration` creates a fresh test branch, runs the existing destructive SQL suite, verifies cleanup and credential revocation, and deletes that run's branch. It never reads the old `apps/site/.env.integration.local` file. Retained pilot data and production remain separate from test infrastructure.

The dedicated test project is `steep-glitter-44680287` (`league-one-integration-tests`). Its empty baseline must have no application relations, functions, custom types, managed `neon_auth` schema, or inherited application roles. Each run uses the repository's migrations and synthetic fixtures. The baseline is not a copy of retained accounts and is not the target of destructive tests.

The production/retained project `solitary-base-99261075`, its production branch `br-rapid-boat-avgeevye`, its retained branch `br-still-breeze-avaibago`, and the retained `projection_refactor_test` and `account_reset_integration_test` database names are explicitly denied. The shared SQL harness independently denies both branch IDs and both retained database names for every caller, including legacy migration and capacity commands, regardless of the supplied denylist or an old valid safety comment. Do not reset either retained database or rotate roles on that branch.

## One-time test infrastructure setup

The test project, empty baseline, verified database and owner identities, and scoped API credential must be configured before the first run. A project name alone does not establish readiness. Use an API key scoped only to this dedicated test project; do not use a production connection string or an organization-wide key as ordinary test configuration. Keep the baseline empty, without an application, auth, worker, or development client attached.

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

The `data-core-ingestion-v1` case checks one fresh username-to-stored-reader journey, canonical identities, typed official settings/roster/manager data and provenance through the actual restricted LOGIN. Its body has a 10-minute limit and a 9-minute polling loop; it does not exercise repeated refresh or injected recovery. The `data-core-refresh-v1` case uses fixture HTTP responses through the real adapter/coordinator, then actual isolated PostgreSQL and stored readers. It checks changed official settings and manager/player identities, preserved first-cycle history and unfinished-dispatch recovery. It does not qualify live Sleeper acquisition, matchup-period collection, the full SQL suite, production capacity or the entire backend. Its beforeAll/body/afterAll allowances total 26m30 within the unchanged 30-minute work budget, leaving 3m30 for all other setup, reporting and global teardown. Fit has not been measured. Exhaustion fails the run; it never borrows cleanup time or retries automatically.

The two selected cases retain only fixed operation names, bounded status/SQLSTATE categories and the seven actual fixed core-acceptance reasons. Unknown text is redacted and successful null reasons are omitted. If an original failure exists, diagnostics may inspect at most four exact immutable receipt/attempt bindings through a captured, guarded runtime-only reader. It reuses the existing Neon HTTP read-only transaction with a fixed one-second statement timeout and a fixed parameterized SELECT. The timeout validator expects PostgreSQL's canonical `1s` result for the `1000` millisecond input. Owned, fixed `transaction` and `result-validation` error boundaries distinguish a rejected driver transaction from local result validation without retaining error text. One shared five-second deadline bounds caller waiting, including response parsing; it does not prove remote cancellation or bound service queueing. No extra read runs on the successful path, no production acceptance rule changes, and secondary diagnostic failure cannot replace the original failure or prevent supervisor cleanup. The selected test assertions and full-suite inventory remain unchanged. See [current DATA evidence](../../../docs/aggregator-backend/data-backend-evidence.md) for failed-run history, cleanup and source-bound verification.

## Explicit child result and teardown evidence

Both supervised modes require a fresh generated run/SHA/profile context, a structured public-API test report, and an exclusive cleanup acknowledgment written only after the awaited global database cleanup succeeds. The parent checks these after verified child-tree closure. A sticky late process-timeout marker invalidates earlier successful artifacts. Missing, malformed, stale, duplicate, wrong-run, retried or otherwise incomplete selected-case evidence fails qualification. Collected and filtered cases are not executed passes.

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
