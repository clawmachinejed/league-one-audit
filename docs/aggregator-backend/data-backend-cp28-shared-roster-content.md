# CP28 Slice A: shared immutable roster content

## Current result — October 19, 2026

**Local Slice A implementation and six selected native cases: PASS. Overall CP28: INCOMPLETE / CAPACITY UNQUALIFIED.** This candidate introduces immutable shared roster-link storage and a compatible reader. The production acceptance trigger still uses the original legacy writer. No writer activation migration, publication, hosted execution, merge or deployment is included.

The user approved this local implementation after the [lossless storage design](data-backend-cp28-lossless-storage-design.md). The 10-GiB planning ceiling, sixteen-league benchmark, five-minute active freshness target, retention of all accepted 2026 history/corrections and required provenance through at least March 31, 2028, and absence of automatic expiry remain unchanged. This report supplements the [accepted hosted measurement and forecast](data-backend-cp28-retention.md); it does not replace that historical evidence or assign unmeasured families zero cost.

| Required scope | This increment |
| --- | --- |
| Data resource | Immutable resolved current-roster player links and each capture's historical binding. |
| Existing path | Sleeper adapters → administration observation/acceptance → the existing roster trigger → the stored roster-link reader. |
| Persisted result | Additive migration 063, private dormant shared writer, compatible reader, restricted grants, retention protection, and six native regression cases. |
| Real proof and gaps | Actual PostgreSQL 18.6 with all 63 migrations and three provisioners; six selected native cases pass. Combined fifteen-case qualification, hosted/preview verification, activation, full-core growth and complete 10-GiB fit remain unproven. |

Before implementation, clean local main, origin/main, fresh GitHub main and Vercel Ready production 8C3YSnXRCbmPETftQgRtirfyck5e matched 87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f. Vercel was bound to clawmachinejed/league-one-audit, apps/site, production branch main. The isolated codex/data-cp28-measurement-proposal worktree began clean at 54f3eb85338ea5f76a33980a3a34a67938fd17f5. [PR318](https://github.com/clawmachinejed/league-one-audit/pull/318) remained draft, open and unmerged at published head 168a856ae44e7431393b0a8a9404483dda294ccc. Its earlier CI and preview do not verify this local candidate.

## Representation and rollout

[Migration 063](../../apps/site/migrations/063_roster_player_link_contents.sql) adds shared content headers and typed entries, plus an explicit storage format and nullable content reference on each original link receipt. Legacy remains the default. Shared reuse is scoped by league, mapping revision, nullable directory version, link version, storage version and a hash of the complete resolved typed link set; exact typed equality is checked before reuse. New captures retain distinct administration receipts, acceptances, timestamps and link receipts. Same-request replay retains its existing semantics.

Content entries are restricted to the header's creation transaction and sealed by its first receipt. Deferred checks validate completeness, count, hash and first-receipt binding. Updates/deletes, late children and mixed legacy/shared representations are rejected. Existing identity cleanup retains entities referenced only by shared history. Runtime receives SELECT on the new tables; direct table writes and execution of private helpers remain denied to runtime, account and auth roles. Original migrations 001–062 are unchanged.

The [compatible reader](../../apps/site/lib/league-administration/neon/roster-player-links.ts) uses one bounded query with mutually exclusive legacy/shared branches. It validates the shared header, first receipt, hash, count and context, then applies the existing strict link validation and ordering. It preserves the public result shape, exact capture-time precision, historical identity/catalog bindings and empty/missing behavior. Malformed or mixed storage fails closed; reading does not consult current heads or backfill history.

The new capture_roster_player_links_shared helper is dormant. The existing acceptance trigger remains bound to capture_roster_player_links. The safe eventual order is schema expansion, compatible reader deployment, then a separately reviewed cutover of that same writer trigger after verification. This candidate contains neither a second active trigger nor a public activation helper. The compatible query requires migration 063 to exist before deployment. No deployment order is executed here.

## Installed-schema proof and cleanup

An owned PostgreSQL 18.6 process listened only on 127.0.0.1:53125, using a disposable cp28_snapshot_test database. The local adapter used the real Neon client with an explicit node socket to that endpoint, generated local credentials, a sentinel, restricted runtime/account/auth identities and at most six sessions. It blocked non-loopback network/fetch paths and scrubbed inherited service credentials. All 63 actual migration files and three actual provisioners installed; the migration ledger matched and 156 application tables existed (151 public plus five auth tables).

The ignored local adapter selects the six new Slice A cases from the existing integration module; it is not the protected hosted supervisor. The original nine bodies remain unchanged and were unselected. Thus the result is **6 passed, 0 failed, 9 unselected**, not a fifteen-case qualification. The six cases exercise:

1. Legacy historical reads and 32 matched unchanged captures per layout, retaining fresh receipts with shared content reuse.
2. Corrections, return to previous membership, exact replay, mapping changes, directory boundaries and original provenance.
3. Late-member/sealing guards, a controlled hash/typed-value mismatch fixture, immutable history, shared-only identity retention and actual role permissions.
4. Null directory history, empty membership and fresh receipt semantics without changing the public representation.
5. Observed identity-lock waits that outlive a deadline or lease, with rollback of shared state.
6. A real concurrent acceptance wait that reuses the committed shared winner.

For null-directory coverage, the owner temporarily removed only the synthetic mutable directory-head row, committed runtime captures with no current head, restored the full original row exactly, and read the historical null-directory receipt afterward. No immutable directory contents changed or guards were disabled. This is a synthetic absent-catalog prerequisite, not support for regressing a production catalog head. Each shared-write proof restores the original legacy trigger; teardown also has a restoration fallback.

All local attempts shared the original thirty-minute campaign deadline, 512 roster-attempt ceiling, two-fixture maximum, at most twenty teams and 160 held players across both leagues, and 12,229 catalog-row ceiling. The fixture used ten teams and eighty held players per league, eighty synthetic catalog player IDs plus one shared-only identity; no live provider fetch occurred. Final cleanup completed at 2026-10-19T22:36:32.4496923Z, 11m29.322s after the original bootstrap, within the unchanged deadline. The final log directly records 87 attempts before its last concurrency case; 89 final-attempt and 168 campaign-wide attempts are source-derived totals, not final database count snapshots.

All four owned PostgreSQL process IDs, the listener, data directories and generated credential files were verified absent. The final run had zero clients before shutdown; all 22 retained final-run files passed the generated-secret scan. Cleanup receipts are preserved for each failed and successful attempt. There were zero hosted attempts, private Neon calls or production writes.

### Preserved failures and repairs

| Local attempt | Outcome and repair |
| --- | --- |
| 1 | Migration 063 failed after 62 migrations with SQLSTATE 42601; no provisioners or cases ran. Cleanup passed. |
| 2 | A bounded diagnostic reproduction identified the same unparenthesized CASE expression in a PL/pgSQL IF. Adding parentheses repaired the syntax without changing the condition. Cleanup passed. |
| 3 | All 63 migrations and three provisioners installed. The first three native cases passed. Case four's attempted nonzero-generation/null-head update correctly failed an existing directory guard; the remaining two cases were not run. The fixture was repaired using the exact remove/restore procedure above. Cleanup passed. |
| 4 | Same reviewed final executable sources throughout: all six selected native cases passed and cleanup passed. |

An earlier source review also caught and corrected malformed dollar delimiters in the new optional provisioner block before native execution. Failed logs remain retained; none are relabeled successful. No hosted measurement was retried.

## Bounded allocation result

The matched workload used two leagues with eighty held links per capture, two warmup captures per layout and four measured batches of eight captures per layout. Twelve snapshots covered all 151 public tables. Independent review reconciled all 1,812 observations: heap, indexes, TOAST and auxiliary forks sum to total allocated relation space.

| Growth over 32 matched captures | Legacy | Shared |
| --- | ---: | ---: |
| Roster-link group physical allocation | 2,596,864 bytes | 0 bytes |
| All public-table physical allocation | 2,736,128 bytes | 106,496 bytes |
| New resolved link entries | 2,560 legacy rows | 0 shared rows |
| New link receipts and acceptances | 32 each | 32 each |

Shared content remained at two headers and 160 typed entries. Its two warmups separately allocated 311,296 bytes in the link group. Shared link-receipt logical tuple bytes still increased by 230 bytes per capture. **Zero additional allocated link pages in this short batch means existing page space was sufficient; it is not zero retained cost or a long-term storage rate.** Physical allocation and logical tuple bytes are distinct measurements and are not added together.

One native historical reader call returned eighty links with one query in 14.7209 ms. This is one local observation, not hosted latency or fleet performance qualification.

The workload exercises the roster path, not a complete witnessed four-resource core. It also has half the held-player occupancy per league of the accepted hosted CP28 fixture. Consequently these deltas cannot be substituted into that whole-core forecast, treated as a linear horizon rate, or used to claim a 10-GiB pass. Corrections, directory/mapping changes and retained content still consume storage. Long-term page reuse, MVCC/bloat, catalog changes, failed attempts, controls and other official resource families remain separate obligations.

## Source verification and evidence

The final native manifest binds 68 executable source files (63 migrations, three provisioners, the reader and the integration case) and nine local helper files. Independent review found the manifest, pre-run, post-run and current hashes equal. Key raw SHA-256 values are:

| Source | SHA-256 |
| --- | --- |
| Migration 063 | 86f92a4100383ac708a20ca01b12ec491f29ad56bdc9092bb6aec00277e33ad6 |
| Runtime provisioner | 02a7c6d9a50f7f7a424d2fca35875f31b70d9b56de1c3a766a9325eacd0206a7 |
| Compatible reader | 245067103c7fa6417f67cc0cd6743478d3a08d7bf643916bd90e2f86a4987907 |
| Integration case | bf81bf571b0989112b2268bd372d32a1211e82bc4bf3d360fd309b35f41e2bfd |

The case's LF-normalized qualification pin is 8af7186b26068c4346cdaf7a28f9933167768446e378dbf486aab2f020e878ca. The roster profile now inventories fifteen literal names; the original nine test bodies and original CP26/CP27/CP28 support pins are preserved. In particular, the 107-source historical CP28 measurement remains pinned to its original sources and correctly rejects the changed reader. Historical unit fixtures use their historical reader/provisioner bytes rather than repinning old evidence to this candidate.

Local verification passed 9,582 unit tests across 371 files, with four environment-dependent/opt-in skips. The full suite used two workers with existing timeouts unchanged. An earlier default-concurrency run failed on historical fixture CRLF bytes, pending profile changes and unrelated timeout-sensitive tests; its failed log is preserved. Restoring the CP26 fixture to its exact already-committed LF bytes produced no content change. Typecheck and lint of all seven changed TypeScript files passed. The final data-backend scope check and git diff --check passed. After the final null-directory fixture and matching source-pin repair, the profile/reporter pair passed all 221 tests in a separate final run (two files, no skips). The full suite preceded only that last fixture/pin repair, so these results are reported separately.

Local evidence is intentionally ignored, not published. The worktree retains test-results/cp28-shared-links/ for preflight, unit/type/lint/scope/review logs, and test-results/cp28-slice-a/ for native-verification-summary.json, native-allocation-measurement.json, independent-cleanup-evidence.json and all four attempt directories. The successful directory is local-postgres18-attempt-4; its sanitized manifest, setup, native-run, results, cleanup and orchestration receipts preserve the complete evidence chain. This report commits the concise findings; a future hosted run requires a newly reviewed source package and explicit execution authority.

The [integration README](../../apps/site/integration/README.md#cp28-shared-roster-content-current-local-candidate) distinguishes the original nine-case historical qualification from the current fifteen-case inventory. Their authored body allowances sum to 42.5 minutes before hooks; that is neither actual elapsed time nor proof of fit under the unchanged thirty-minute work/forty-minute lifecycle limits. No limits, protected guards or hosted execution allowances were relaxed.

## What remains for CP28

Slice A locally demonstrates lossless link-content reuse; it does not complete the capacity contract. The original measured sensitivity still shows that even eliminating its entire old link component would leave 12.274 GiB of modeled core DATA, or 16.365 GiB with the observed synthetic-control proxy, before other families/reserves. That sensitivity is not a measurement of this candidate.

Independent source review narrowed the next metadata candidate (B1) to sharing identical league-configuration population_evidence copied into core roster-policy receipts. This is design preparation only. It would preserve the complete original evidence JSON, receipt provenance, coverage, witness/evidence hashes, attempt/fence mappings and event IDs. Only an exact core-policy whitelist would participate; null, unproved, no-configuration and other-family evidence would remain inline. A validated accessor must resolve both a NEW receipt and stored receipts without fallback for a corrupt shared binding.

That design requires forward-migration updates to the active administration/lineage/standings consumers currently defined in migrations 048 and 053, compatible official-standings and exact-period readers, restricted grants, immutable first-receipt sealing and post-wait fence checks. Under that strict population-only core whitelist, existing 056 witness validation and 062 settlement logic need no changes because their inputs remain intact. No B1 schema or behavior has been implemented here, and no savings are assigned to it.

The remaining sequence is to implement and locally prove the reviewed metadata representation; review a complete ordinary-core measurement candidate and its combined-profile limits; obtain new bounded hosted execution authority when required; then produce a non-overlapping all-family retained-history forecast under the unchanged cadence, horizon and 10-GiB ceiling. Publication, complete CI/actual preview verification, writer activation and any merge/production rollout are distinct future steps. CP28 can be marked complete only when the full contract has supporting evidence.
