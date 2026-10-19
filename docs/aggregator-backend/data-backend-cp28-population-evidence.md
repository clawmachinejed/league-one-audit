# CP28 B1: shared roster population evidence

## Current result — October 19, 2026

**Local B1 implementation and six selected native cases: PASS.** This local candidate shares the identical population-evidence object repeated across the three core roster-policy receipts of one fresh capture. Overall CP28 remains **INCOMPLETE / CAPACITY UNQUALIFIED**.

The user approved local implementation and bounded local PostgreSQL proof. The sixteen-league benchmark, five-minute active freshness target, 10-GiB planning ceiling, retention of accepted 2026 history/corrections and required provenance through at least March 31, 2028, and absence of automatic expiry remain unchanged. The accepted hosted experiment and earlier [Slice A report](data-backend-cp28-shared-roster-content.md) remain historical evidence.

| Required scope | This increment |
| --- | --- |
| Data resource | Repeated configuration population evidence on current roster membership, primary-owner and manager-evidence receipts. |
| Existing path | Existing Sleeper adapters and public intake → administration observation/receipt/acceptance writers → roster lineage and standings validation → stored standings and exact-period readers. |
| Persisted result | Additive migration 064, immutable shared proof content, compatible accessor/readers, restricted grants, a dormant interner, and six native cases appended to the existing official-results module. |
| Real proof and gaps | Actual PostgreSQL 18.6 with 64 migrations and three provisioners; six selected cases pass. Combined A+B behavior/storage, hosted qualification, complete all-family forecast and 10-GiB capacity fit remain unqualified. |

Before implementation, clean local main, origin/main, fresh GitHub main and Vercel Ready production 8C3YSnXRCbmPETftQgRtirfyck5e matched 87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f. Vercel was bound to clawmachinejed/league-one-audit, apps/site, production branch main. The isolated branch began clean at 0ef6de4563fb2d7a1f432df6021b23f64fd696ba. [PR318](https://github.com/clawmachinejed/league-one-audit/pull/318) remained draft, open and unmerged at published head 168a856ae44e7431393b0a8a9404483dda294ccc. Earlier CI and preview results do not verify these local changes.

## Representation and compatibility

[Migration 064](../../apps/site/migrations/064_roster_population_contents.sql) adds immutable league_roster_population_contents and an explicit inline/shared receipt representation. Each parent retains the original full JSON object, including observationId, contentHash and provenance. Reuse requires the same league, mapping revision, configuration content, proof version, canonical JSONB hash and exact complete value. A deferred first-receipt binding seals each parent; original acceptance, receipt IDs, source provenance, evidence hashes, coverage, attempts and write fences remain distinct and unchanged.

Fresh captures have different source provenance, so B1 creates one new parent per fresh eligible core. It does not collapse consecutive equal football results into one observation. Settings receipts keep NULL population evidence; players, primary managers and manager-evidence receipts can share their one exact within-capture proof. Null, missing-configuration, unproved and other-family evidence remains inline. The pre-existing positive expected-count fallback may still be unproved; the interner preserves it inline rather than tightening acceptance.

The read-only roster_capture_population_evidence accessor reconstructs original inline or shared evidence and validates context, hash, configuration proof and first-receipt binding. Four existing SQL owners use that accessor at the population boundary while retaining their existing acceptance/lineage/scoring behavior. Two stored-reader SQL expressions change: official standings selects the reconstructed evidence, and exact-period component inventory reads its original provenance. No provider fetch or new acquisition pipeline is added.

Runtime receives SELECT on immutable population content and EXECUTE on the read-only accessor. Direct content writes and private interner execution remain denied to runtime, account and auth roles; account/auth/PUBLIC do not gain evidence access. Original migrations 001–063 remain unchanged.

The new interner is deliberately unbound. Local tests temporarily bind one owner-only BEFORE INSERT trigger and remove it in finally/teardown. The legacy roster-link writer from Slice A remains active throughout this B1 comparison. Deployment would require the schema before compatible readers and separate verification before activating either shared writer; this local candidate performs none of those deployment steps.

## Local proof and limits

The native lifecycle uses an owned PostgreSQL 18.6 process on literal 127.0.0.1:53125, a disposable cp28_snapshot_test database, generated local credentials and a verified sentinel. All 64 actual migrations and three actual provisioners installed, with 157 application tables (152 public and five auth). Tests use actual restricted runtime/account/auth logins, at most six sessions, scrubbed inherited service environment and blocked external sockets/fetch.

The six new cases cover fresh provenance, corrections/replay and stored legacy/shared reads; inline exclusions; durable invalid bindings and actual-role denials; observed waits beyond original deadline/lease; concurrent committed-parent reuse; and matched witnessed-core allocation. Concurrency uses an explicitly synthetic owner-created first receipt through native/deferred guards, followed by an actual runtime second-policy writer blocked on the parent's unique key. It does not claim two ordinary core workers. Rollback compares the declared relevant history/head/typed/link tables, not a complete 157-table state snapshot.

The workload has two fixture leagues, ten teams and eighty held players per league, eighty synthetic catalog IDs and no live provider calls. Six semantic/security cores plus 68 warm/measured cores produce 74 witnessed cores; additional direct/catalog/negative reservations are counted separately. Each witnessed core uses the existing public intake and actual settings/roster writers, producing four fresh resource attempts/receipts/acceptances; the existing standings capture attaches to the players receipt. Synthetic intake/admission/job prerequisites do not qualify natural cadence or complete ordinary orchestration.

The shared campaign limit is thirty minutes from the first bootstrap, 512 cumulative resource reservations and 353 reserved for the first run, including failed/rolled-back reservations. Existing 60-second statement, 65-second query and 90-second idle-transaction bounds remain; signal checks before/after SQL do not prove cancellation of an already-running query. Original writer deadlines and leases remain enforced. The local harness reserves cleanup time and removes only identity-verified owned resources.

## Preserved local attempts

| Attempt | Result |
| --- | --- |
| 1 | All 64 migrations and three provisioners installed. The first B1 case failed because its exact expected wins fact omitted the existing sourcePath: settings.wins field. No complete B1 case passed; five remaining B1 cases bailed and eight original cases were unselected. Seventeen resource reservations were consumed. Cleanup verified zero clients and removed the owned process, listener, data and credentials; 28 retained files passed the generated-secret scan. |
| 2 | Same SQL and readers, with the strict expected-fact repair: six B1 cases passed, zero failed, eight original cases unselected. Final source hashes remained unchanged. All cleanup checks passed. |

The repair adds the exact existing sourcePath to the strict equality assertion. SQL, readers and acceptance behavior are unchanged. The first attempt remains failed; any later run shares its original thirty-minute campaign deadline and 512 cumulative reservation limit.

## Installed behavior, allocation and cleanup

The second attempt completed every selected case, including visibility of the new parent during the first shared receipt INSERT, exact/changed replay, distinct fresh provenance, old historical reads, inline exclusions, durable foreign/configuration/hash/orphan rejections, immutable history and actual role permissions. Two observed population-table RowExclusiveLock waits exceeded the original deadline or lease and rolled back the declared relevant tables. The concurrency case observed a transactionid ShareLock wait on the uncommitted parent and then reused the committed exact proof with a distinct second receipt.

There were **309 resource reservations** in the passing run: 74 witnessed cores × four resources (296), one catalog reservation, one latest-unwritten reservation, six direct inline/other-family reservations, two fence probes and three concurrency reservations. The pre-run estimate of 308 omitted the latest-unwritten reservation; the actual monotonic counter and cumulative budget include it. Together with the failed run's 17, the campaign consumed **326 of 512**, without resetting its original clock or allowance.

Fourteen allocation snapshots covered all 152 public tables: two warmups per layout, then four measured batches of eight fresh cores per layout, plus boundary snapshots. The 2,128 per-table observations reconcile heap, indexes, TOAST and auxiliary forks to total allocated space. Both layouts retain 128 new attempts, receipts and acceptances; the shared layout has 32 new parents for 96 eligible population references. Settings receipts remain inline with NULL population evidence. Each layout also adds 2,560 legacy roster-player links and 32 typed standings captures.

| Growth over 32 matched fresh cores | Inline | Shared B1 |
| --- | ---: | ---: |
| Receipt + population-parent physical allocation | 458,752 bytes | 360,448 bytes |
| All public-table physical allocation | 3,391,488 bytes | 3,137,536 bytes |
| Receipt logical tuple bytes | 418,816 bytes | 253,696 bytes |
| Parent logical tuple bytes | 0 bytes | 62,208 bytes |
| New resource receipts / attempts / acceptances | 128 / 128 / 128 | 128 / 128 / 128 |
| New population parents | 0 | 32 |

The directly affected table group allocated **98,304 fewer bytes (21.43%)** in the shared batch. Its logical tuple increment, measured as the sum of pg_column_size(row), fell from 418,816 to 315,904 bytes. This is not canonical JSON size; logical and physical measures are separate and are never added together. All public tables showed a 253,952-byte difference (7.49%); 155,648 of that difference lies outside the directly affected group and is not attributed solely to B1. Sequential page allocation, free space and auxiliary effects can differ across the two batches.

The two warmups separately added 57,344 affected-group / 212,992 all-public bytes for inline, and 16,384 / 172,032 bytes for shared. These are increments in the existing test database after the semantic cases, not cold-start totals. One stored standings read per layout returned ten teams with one query: 13.9914 ms inline and 4.8047 ms shared. These single local observations do not establish an SLO or production speedup. The measurement case took 210.041 seconds.

Both owned PostgreSQL processes, the port53125 listener, both data directories and generated credentials were verified absent after cleanup. Each run had zero clients before shutdown, and each retained 28 files passed the scan against its five generated secrets. The final cleanup finished at **2026-10-19T23:14:31.425Z**, **8 minutes 53.052 seconds** after the original campaign bootstrap, inside the unchanged thirty-minute limit. Temporary B1 triggers were removed and the Slice A writer remained legacy. No hosted attempt, external provider request, private Neon call or production write occurred. The witnessed cores asserted 148 synthetic fixture responses (74 × two), separate from the synthetic catalog prerequisite.

The final native manifest binds 71 sources: 64 migrations, three provisioners, the migration text helper, the integration case and two changed readers. Eleven ignored local helpers are separately hash-bound. Key retained SHA-256 values follow. Source hashes identify the tested local file bytes; the case pin also matches its LF-normalized bytes.

| Artifact/source | SHA-256 |
| --- | --- |
| Migration 064 | 5598586c948bcac01d706c07b65a6bf0ad99cc50a354e965e6c93e318edcea00 |
| Runtime provisioner | ad344ac5a85e7a7d61317cc387328af3f7545671beb830fccd53b569ff4c886f |
| Final native case / LF qualification pin | 38ce70c50c3d2f473fd1ce6a886c95b79d3db998921cd3a93c324122153d7c27 |
| Final native run receipt | 94e46f1cafe2a8f580d840b8cb93b013dda40f918b1beed9e0f85e610ba35844 |
| Final native log, including allocation samples | 9543d2b69c37958aa0aaa3c394104c0de9dae74ca7533fdfff84e443258d1058 |
| Final cleanup receipt | 12ff7645893577bd9e6ff74c5ef13dc34c2b1d1620de3f6b5e236b8c033ec4ed |

Original failed and passing evidence remains under ignored test-results/cp28-slice-b1/local-postgres18 and local-postgres18-attempt-2. Independent source, harness and arithmetic receipts are under test-results/cp28-population-evidence. The source assertion failure remains a failed run; it is not erased by the later pass.

## Source verification and outstanding work

Local unit coverage passed **9,603 tests with four expected skips across 372 files**: 9,417 passed/four skipped in the broad run excluding the profile file, and 186 profile tests passed separately. TypeScript and lint on all eight changed TypeScript files passed. Independent source reviews covered the SQL, narrow reader changes, exact case inventory, historical support pins and local harness. The scope checker passed, and final native source hashes match their reviewed manifest.

The official-results module now inventories fourteen cases. The passing attempt ran each of the six appended cases once, with zero failures and no automatic runner retries; the failed first attempt remains separately recorded. The original eight cases remained unselected. The played-result selector remains original cases 7 and 8, with twelve filtered cases. Fourteen body budgets plus two hooks total 42 minutes, exceeding the unchanged 30-minute protected work cap; no full-profile elapsed-fit claim is made. Historical CP26/CP27/CP28 support pins are preserved and reject the changed candidate before provisioning.

This fixture has eighty held players per league, compared with 160 in the accepted hosted experiment. Its B1-only physical allocation cannot replace that historical whole-core rate or establish combined A+B growth, a complete retained-horizon rate, or a 10-GiB pass. Remaining work includes combined shared-writer behavior and matched full-core storage, correction/catalog/control and other-family growth, a complete nonoverlapping capacity forecast, and separately authorized publication/CI/preview/hosted/activation steps where required. No automatic history purge or relaxed freshness target is proposed.

Local source is complete and unpublished. PR318 remains at its earlier published head; no CI, preview, build, hosted, merge or production-deployment result is claimed for this commit. Both shared writers remain inactive in deployed behavior.
