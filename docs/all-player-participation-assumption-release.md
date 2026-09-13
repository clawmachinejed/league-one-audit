# Versioned nonparticipation assumption release

Migration 013 implements the user-selected `missing-participation-as-zero-v1` product policy. A clean unresolved weekly row or absent player row can carry an explicitly assumed appearance count of zero. Eligibility remains independent: a clean row with `gms_active=1` yields eligible 1 / appearance 0; a missing row or other clean unresolved row yields eligible unknown / appearance 0. Positive participation, known zero eligibility, byes, malformed fields, contradictory evidence and reviewed ambiguous evidence retain their existing handling.

The evidence stores `kind: assumed-nonparticipation`, the exact policy version, `source: product-policy`, the requested regular-season period, and the unchanged weekly or missing-row basis. Its parent observation supplies the retrieval timestamp. This records the assumption without introducing timestamp-only raw-history copies. Current catalog metadata remains advisory observation context.

## Database scope and compatibility

Only migration 013 is new. Installed migrations 010, 011 and 012 retain their exact contents and checksums. The migration verifies and replaces the original paired-null raw-entry CHECK with a narrow constraint that additionally permits eligible NULL / appearance 0 for the new evidence kind. It replaces the two existing evidence validation functions, preserving their signatures, security attributes and permissions. It adds no table, column, trigger, provider request, job, pointer mechanism or cron schedule.

The new wrapper is valid only for player entries under the v4 normalizer. Its basis must be clean and unresolved. Missing-row basis requires empty raw statistics. Weekly basis must match every retained participation flag and individual snap field. Wrong-period, old-version, defense, positive-participation, malformed and contradictory wrappers fail closed. Existing v2/v3 observations preserve their meaning and exact replay behavior.

Complete quality still requires both counts to be known. The unchanged scorer rejects nonzero points for a nonappearing entry. The unchanged SQL publication path requires complete inventory, game context/finality, score groups and official parity; assumed zero appearance with unknown eligibility cannot advance a score pointer. All identity, job ownership, expiry, deadlines and request-budget protections remain in force.

## Verification

The new isolated case covers 216 SQL/domain derivation combinations; direct runtime inserts of NULL/0 and 1/0; unchanged v2/v3 sealed replay; old-version, wrong-kind, wrong-period and hidden-stat rejection; exact raw binding; unknown-eligibility pointer preservation; actual writer replay and later unchanged observations. Its synthetic 1,000-entry partial measurement records physical heap/index/TOAST allocation and elapsed write times, with zero provider requests. It does not repeat or claim whole-season capacity validation.

Use the existing isolated harness only after every explicit authorization, database/branch identity, sentinel, TLS, role and production denylist guard passes. One release owner coordinates destructive runs. The actual wrapper check from `apps/site`, under Node 24, is:

```text
node --env-file=.env.integration.local --import tsx scripts/run-all-player-migration-wrapper-integration.mjs --participation-assumption
```

This captures `013-catalog.integration.json` with `reviewed:false`, recreates the isolated schema through 012, proves full catalog/ledger rollback for a corrupted constraint manifest, then requires the actual wrapper commit and exact success sentinel. Independent review of the captured PostgreSQL 18 catalog is required before rendering production SQL. The normal production renderer accepts the same `--participation-assumption` selector and performs no database operation.

## Reviewed release order

1. Revalidate canonical GitHub/local main, the reviewed PR, Vercel repository/root/branch binding and exact production SHA; resolve any unexplained disagreement. Verify Neon project, branch, database, owner and restricted runtime role. Inspect competing release activity and live leases, reporting “no competing owner observed” only when supported.
2. Keep recurring all-player ingestion disabled through the release. Preserve the existing global job row, request starts, next-request boundary, generation and durable outcomes. Do not delete the budget row or expire an active owner merely to make installation proceed.
3. Complete full repository verification, independent domain/SQL/writer review, actual preview inspection, guarded integration, actual wrapper rollback/commit proof and independent catalog review. The prior manifest must bind installed 012 checksum `bea4bd568c05eee7da177811b25a1389180d37329b9061b3e79ee60d546aa4ed`.
4. Render and review the exact 013 production wrapper. It requires the reviewed PostgreSQL 18 identity/catalog, exact migrations 001–012 and checksums, no active all-player owner, the existing schema advisory lock and job-table lock, unchanged historical table counts and unaffected objects/ACLs. It commits 013 and requires `ALL_PLAYER_PARTICIPATION_ASSUMPTION_APPLIED:013_all_player_participation_assumption.sql:<checksum>`.
5. Install 013 before deploying the v4 writer. Existing v2/v3 application writes remain compatible with the broader raw constraint and preserved old validation branches. Verify the exact merged SHA reaches production and both existing league readers remain healthy.
6. Perform only the authorized operator action, respecting current global provider budget, live ownership and deadline. Verify retained raw contents, separate unknown eligibility and unknown appearance counts, explicit assumed counts, source period, normalizer/policy versions and unchanged complete pointers for partial results. No new provider or unbudgeted retry is introduced.
7. Recheck actual storage and ordinary-workload headroom. This policy change does not establish missing inventory, period-finality or full-parity evidence, and does not itself authorize or prove recurring activation.

## Rollback

Before commit, any wrapper assertion failure rolls back the constraint/function changes and ledger insertion. An ambiguous execution requires read-only ledger/catalog inspection before retry.

After a committed release, disable recurrence and stop operators, preserve the durable request budget and live generation/expiry discipline, then revert compatible application/configuration if necessary. Leave 013 installed: older v2/v3 writers remain compatible, and retained v4 NULL/0 observations remain immutable. Reinstating the old paired-null CHECK would conflict with valid retained history. Do not rewrite or delete evidence, move verified pointers backward, edit installed checksums, or assume a destructive down-migration is safe. Any later database compensation must be a separately reviewed additive change.

## Evidence status

- Local wrapper tests: 16 passed across the existing and new wrapper suites; owned lint passed. Final full verification is pending.
- Normalized 013 checksum: `4e03581db2b9a33d0df77110fe32b81745bec7f1ab001a20bfd788c4b4283d80`. The guarded PostgreSQL 18 wrapper passed corrupted-manifest full catalog/ledger rollback, actual commit and exact sentinel checks. Independent review of the catalog dated `2026-09-13T04:04:45.801Z` passed: only the two intended function bodies and raw-entry constraint fingerprint differ from reviewed 012; signatures, permissions, triggers and other objects are unchanged. Rendered production wrapper SHA-256: `5d8679810f42aa9dc24c8fd8cac9ad9cfad31c4af3a4e1687949fe336bc96b87`.
- All 7 new 013 isolated tests passed, including the 216-case SQL/domain derivation matrix. The complete development database run recorded 209 passes and 7 failures attributed to WebSocket/Undici connection errors in existing B3 cases. Final full verification must still pass; those failures are not counted as successful or skipped tests.
- The synthetic 1,000-player measurement at `2026-09-13T04:03:35.128Z` wrote 1,000 raw entries, then zero on exact replay and zero on a later unchanged retrieval. It retained 1,000 unknown eligibility counts, 1,000 assumed zero appearance counts and two observations. The first raw-entry allocation grew 712,704 bytes: 507,904 heap bytes and 204,800 index bytes. Later physical allocation was unchanged; the new observation fit within existing allocated pages. This does not imply that retained observation rows cost zero bytes. First/later writer durations were 385.7/197.0 milliseconds, with no provider request. The bounded synthetic result is not a whole-season storage or production-duration guarantee.
- Final PR/merge SHA, preview, production deployment, schema installation, authorized capture and both readers: pending. Local preparation does not establish those operational milestones.
