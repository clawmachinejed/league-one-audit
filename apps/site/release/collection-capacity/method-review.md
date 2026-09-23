# Collection capacity method review

Reviewed September 23, 2026 against application commit `864580c67bae2380049c978346e3da076d5cdee5`. The reviewer inspected the independently authored Neon harness, supervisor and saved measurements without opening credentials, issuing provider requests, or executing database actions. The reviewer authored the separate offline scheduling report and final reusable supervisor; their local checks are author validation. The benchmark author independently reviewed the reusable supervisor and found no blocking issue.

**The bounded measurements are consistent with the stated method: 26 captures passed their logical invariants and both run receipts confirm child closure and cleanup.** This is not production capacity approval. The final reusable supervisor passed 13 offline tests, targeted lint and full TypeScript checking. The fixture owner reported four passing fixture tests. Runtime source, schema migrations, provider cadence, production data and league enrollment are unchanged.

| Check | Reviewed behavior |
| --- | --- |
| Target safety | Existing integration authorization, URL/TLS/role identity, server identity, durable sentinel and production denylist are checked before reset. The supervisor binds the intended disposable branch/database, takes the shared test advisory lock and requires empty schemas with no active, open-transaction, foreign-role or unattributed client session. Only attributable idle runtime HTTP pool backends are tolerated. |
| Process and cleanup | Supervisor follows its own child tree, waits for verified closure, checks sessions/schema after the child, and attempts guarded recovery cleanup only after closure and safe session attribution. A cleanup failure remains a failure. No database session termination or new credentials are used. The mutex coordinates cooperating integration supervisors; observed session guards do not prove that no other task exists. |
| Runtime path | The canonical registry, shared ingestion operation, scorer, official-observation writer, score-content writer and scoped acceptance functions run through the actual restricted Neon HTTP client. It does not substitute the single-session WebSocket integration client for runtime traffic. |
| Deadline | Real time and the existing 50-second operation deadline, 55-second lease, eight-task pool and eight-second league wait remain in force. Cleanup has a separate bounded signal. Fixture request scheduling is explicitly separate from lease/deadline clocks. |
| Network boundary | Synthetic provider responses are supplied in memory. Global fetch is restricted to the installed Neon SDK's derived HTTPS SQL endpoint **and** the exact guarded runtime connection header. The header is compared without logging it. |
| Workload | 4,385 entities, nonzero synthetic offense and defense statistics, retained League One rules, full 12×14 and 10×20 roster populations with defenses and varied league roster offsets. This stresses cardinality and payloads; it is not a real NFL participation distribution. |
| Isolation and reuse | A successful three-league baseline is required for both shared and distinct profiles. A separate three-league cohort checks a slow source, parity failure and missing registration against a healthy peer. Assertions cover profile writer reuse, acceptance calls, full roster parity, bounded source concurrency, unchanged content, retained failed pointers and healthy advancement. |
| Measurements | Actual operation wall time is separate from summed overlapping SQL/stage durations. Runtime statement/serialization counters exclude owner setup and measurement queries. Physical deltas include the new acceptance/pointer tables and expected-game children. They do not represent billed network transfer, compute or restore history. |
| Bounded ladder | 3, 8, 16 and 32 leagues are attempted sequentially. Each level has first-at-level, unchanged and changed captures; the first level also measures a history-context warmup. Expansion stops when invariants fail, less than ten seconds of operation headroom remains, or the overall measurement budget is reached. A separate distinct-profile extension uses identical workload and qualification rules. These samples do not establish p95/p99. |

The review found and resolved an incorrect HTTP-host allowlist, omitted expected-game storage, insufficient baseline qualification, overloaded mixed-scenario selection, narrow scoring/roster fixtures and insufficient publication invariants before supervised execution. The installed SDK's endpoint rewrite was independently verified offline using a synthetic hostname. Earlier diagnostic runs then exposed two fixture assumptions: lowercase synthetic IDs sorted differently from numeric Sleeper IDs in the parity fingerprint, and a first capture legitimately establishes previously absent historical team context. Numeric synthetic IDs now have an ordering regression test; the first history transition is explicitly measured rather than mislabeled unchanged reuse. These corrections did not modify production code. Failed diagnostic evidence remains separate from the qualified runs.

Remaining interpretation limits: local Windows Node-to-Neon timing does not prove Vercel timing, provider limits, visitor throughput, queue fairness, season storage fit or a maximum supported fleet. The higher ladder levels reuse earlier identities/pages and are not cold-start measurements. Failed or stopped samples must remain in the final evidence. A successful run must also have a successful supervisor cleanup receipt.

## Measurement result review

- Main measurement `6a9e51e0-e99a-45ae-9814-321c0a2e95a5`: 19 captures, all invariants passed. Shared-profile levels 3, 8, 16 and 32 qualified; distinct-profile level 3 qualified. Distinct level 8 was initially skipped only because the overall time budget was reached, not because of a capacity failure.
- Distinct extension `b7e252ff-a4a6-4cbd-bbb3-145a12e67ef7`: 7 captures, all invariants passed. Eight distinct profiles completed their changed capture in 41.353 seconds, leaving 8.647 seconds of the 50-second budget. This triggered the predefined ten-second-reserve stop. Eight profiles therefore completed this sample but did not qualify with the required reserve; 16 and 32 distinct profiles were not attempted.
- The mixed cohort preserves both failed leagues' exact prior acceptance IDs, advances the healthy league and never publishes the missing registration. Its failed sample writes one acceptance and 168 official player rows, matching the sole healthy league.
- The first provider body and history warmup have the same provider-body hash but different historical-context and material hashes. The subsequent unchanged capture has stable hashes and zero new raw or score rows. The changed capture changes the body/material hash and adds the expected rows. Both shared and distinct lanes satisfy this sequence.
- Shared 32 changed: 25.035 seconds, 4,385 raw rows and 4,385 shared score rows, with 9,158,656 bytes of measured relation growth. Shared 32 unchanged: 20.266 seconds and zero new raw/score rows, but 32 acceptance rows, 5,888 official player observations and 1,097,728 relation bytes. Reuse does not eliminate observation history.
- Distinct 8 changed adds 4,385 raw rows and 35,080 score rows, with 37,715,968 measured relation bytes. Its unchanged sample adds no raw/score rows but still serializes 94,825,141 parameter-JSON bytes and 4,811,964 decoded-result bytes. Stored-content reuse does not eliminate transport or score-write verification work. These metrics are neither billed transfer nor season storage forecasts.

External supervisor receipts `2fc3c46a-00d1-45f9-8bd8-b18bf13666f9` and `a5182b64-0b17-4b0f-ae6b-ae0c03de686d` both record child exit 0, confirmed closure, zero final schema relations and verified cleanup. Main-run Vitest teardown reported a close error; the external supervisor performed guarded recovery cleanup and verified the result. The extension needed no recovery cleanup. The teardown deviation is preserved rather than treated as an unqualified clean teardown.

## Reviewed bytes before the mutex correction

SHA-256 hashes are for exact local bytes. Changed files require a focused recheck. The main run captured capacity-case hash `862088bf7bf4fb7487bbfb22e67994e151a0ff9a350a8a20b5f7ebec2d221f90`; the extension adds only its explicit scope selection and captured the final capacity-case hash below. The reusable runner, global setup and supervision helper were strengthened after both measurements; measured runtime/fixture code was not changed by that safety work. A final standalone probe is separate evidence.

| File | SHA-256 |
| --- | --- |
| `integration/collection-capacity.capacity-case.ts` | `65b8ccbdba60b1a4d21df5175e680d0739a7d0ec6fbdca27ada843345745e114` |
| `integration/collection-capacity.fixtures.ts` | `04e3b2f50acadddbf74765dbbe860cd864b117b32323dd5c0bb4b9e20f64a64e` |
| `integration/collection-capacity.fixtures.test.ts` | `d8c09b6770610a53f514a01345cb08514f9025cfdc449a59e78d9c975e40631c` |
| `integration/collection-capacity.measurement.ts` | `a2762300acb1c08f8bb3663021de87da42edb3ce4d50d4a693d885e4d4c11b7d` |
| `integration/collection-capacity.config.ts` | `e400d01fa17ba88c2d9a27c41307809d24da8921390961672206a47bfb8b991c` |
| `integration/collection-capacity.global-setup.ts` | `a25a7c6f91e70c561f29fc0404f3c517600e18751300602500c5ae694a496a2d` |
| `integration/collection-capacity-supervision.ts` | `c4656d714fe2bfc7ed081c5dba1c88cb4e9bfa2de8fdd9107343f9d7224d33f7` |
| `integration/collection-capacity-supervision.test.ts` | `a59195a23550d0389dfab09d85e6cf75a45afd7a1efcfb13d021c7719fc24372` |
| `scripts/run-collection-capacity.mjs` | `bc5c162b7d9c1b481a3922a7f726d9af8ccaf851eab22926c4b0f5c638f6eb81` |
| `lib/projections/runtime/all-player-operation.ts` | `07e6e29401e2539687f36a5171787c4cd0a02317a22d1a74b55723d170f4c73c` |
| Main cleanup receipt | `2e09fab10973499bb1e50d2636fcf472293ec565999e522ae8ea3f0a23daf7a1` |
| Distinct-extension cleanup receipt | `9152bdd8920667db4e3fb644b95c69878a07349c8c7e35b04b60a485474f8a47` |

## Reusable supervision

Run only on Windows with Node 24, from `apps/site`, using the guarded disposable database environment described in `integration/README.md`. Set `COLLECTION_CAPACITY_OUTPUT` to a new absolute JSON path in the evidence directory. With the usual isolated-reset authorization present, the command is:

```powershell
node --conditions=react-server --env-file=.env.integration.local --import tsx scripts/run-collection-capacity.mjs
```

`COLLECTION_CAPACITY_SCOPE=probe` runs the three-league smoke capture; `distinct` selects the bounded distinct-profile extension; omission runs the main ladder. These select workload only and do not bypass database guards. Do not invoke the destructive Vitest configuration directly: global setup requires proof of the runner's live lock-owning database session.

The runner owns the same advisory mutex through cleanup. The child confirms that exact PID, backend start, unique application name and advisory lock before schema preparation and cleanup. It terminates only the process tree it spawned, never database sessions. Prior successful reusable-runner receipts allow only exact recorded idle runtime backend identities; active, open-transaction, foreign-role and unknown idle sessions fail closed. Earlier external-wrapper receipts do not provide that exact identity format, so any remaining HTTP pool sessions must expire naturally before the first reusable run. An unresolved prior child receipt blocks another reset; deleting evidence is not a recovery procedure. The supervisor uses 20-minute cooperative and 21-minute hard bounds and preserves an unverified cleanup state if closure or ownership cannot be established.

## Offline scheduling evidence

The report invokes actual watch synchronization, cadence parsing, absolute due-time scheduling and current-work admission. Twenty-four regular fleet/week cases and twelve observer-default sensitivity cases passed internal invariants twice with the same deterministic policy digest: `cf624c70203c7fab32d9a88ae104cf60244f5c818103f7354c49f8396f1e0dad`. Targeted ESLint and the final full TypeScript check passed.

This is a deterministic policy measurement with instantaneous successful current work, not remote throughput. The synthetic identities affect offset collisions. Future same-minute excess is reported without duplicating SQL claims or claiming observer queue fairness. At Week 3, nominal average demand is 3.44 checks/minute for three leagues and 11.47 for ten; twenty leagues require 22.94 against the shared twenty-check allocation. The actual current planner admits nineteen when future targets exist. The report does not authorize additional enrollment.

Scheduling script SHA-256: `e97c62a7c3801c12706824aec80d293c18afba43b6ae3b617bb51d9ed13e2f35`.

## Initial standalone qualification

The final reusable runner passed a guarded three-league probe in 23.721 seconds after the earlier HTTP pool backends expired naturally. The owner proof passed before reset and cleanup, all capture invariants passed, the child exited 0, and cleanup was verified with empty application schemas and no active/open transactions. See [the validation record](validation.md) for the exact probe/receipt and complete repository check totals. The reviewed implementation bytes above remained unchanged.

## Independent review of the integration mutex correction

A subsequent PR review correctly identified that ordinary `prepareIntegrationDatabase` and `cleanIntegrationDatabase` callers did not participate in the capacity mutex. The earlier successful measurements do not prove cross-run exclusion. The correction centralizes ownership in the destructive harness, pins its actual migration/schema connection, and retains ownership through cleanup. Capacity uses exclusive admission followed by shared locks in parent and child; every independent run requires exclusive admission. This prevents parent connection loss from opening a competing reset window. Failed owner checks, connection loss, wrong lock modes and changed targets fail closed. Cleanup closes its retained session even when preconditions fail. Owner transport is direct, and changed-target errors omit credentials.

Independent read-only review found no remaining blocker. The reviewer checked all destructive callers, Vitest setup/worker boundaries, repeated migration preparations, exception cleanup and parent/child lock lifetime. The implementer passed 88 focused tests, TypeScript and lint. The release owner separately proved real PostgreSQL conflict rejection with read-only startup protection and a successful guarded capacity probe; see [validation](validation.md). Benchmark operation/fixture code and the 26 earlier performance captures were not changed.

| Corrected file (relative to `apps/site`) | SHA-256 |
| --- | --- |
| `integration/integration-database-ownership.ts` | `3834ee6ca797ba2008ba945bdcb7af1ba30919709b84aa41d3ee35bc44659975` |
| `integration/integration-database-ownership.test.ts` | `f1dda8a65cad267677e84a682936cca0f63837a85f060637a02644be6cf1e479` |
| `integration/neon-integration-harness.ts` | `b53ffeeee14a40d37a27c2b52d400bd6141dcefbbdb7a1eeff04404d476ea82d` |
| `integration/neon-integration-harness.test.ts` | `c163bba35d2b9d49f63f9ba494b3e1cb3b89da44e487341ecb57bfcee886ee6a` |
| `integration/global-setup.ts` | `e9c96e4427af74339d4b25bfe8cb87530c2bef0ad3965dcd2959d637bb0883aa` |
| `integration/global-setup.test.ts` | `9f25349a47914465991e3a74c333fe3a3376834a8adf2de8065c49270675637b` |
| `integration/collection-capacity.global-setup.ts` | `b4f684a1bee7b937166a3f91963650d1b772e002b5680bc0f4da30122cee56e3` |
| `integration/collection-capacity-supervision.ts` | `937b7fcd95aa507da489e6f26343de8c229649cb50b614aec04807d6f3680edf` |
| `integration/collection-capacity-supervision.test.ts` | `f0e3cad749d68315091f23eadbd20ed3797eaec96e7fe96a54f3b42a36b3cdd1` |
| `scripts/run-collection-capacity.mjs` | `aa6e8165d997d662defe7f7b05efcdbd061d0ad1469af7b3c37e75eb447381fe` |
| `integration/README.md` | `de55b98f6b41727a1592ec13ff9e6bd7871e94e66bc0f500d889beb3cb82d5a1` |
