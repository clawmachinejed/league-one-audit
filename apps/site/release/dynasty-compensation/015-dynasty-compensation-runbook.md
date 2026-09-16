# Dynasty 015 compensation — prepared operator review

This is a prepared rollback package, not approval to execute production work. Its exact SQL was independently reviewed and tested in the existing guarded isolated PostgreSQL 18 harness. No production operation was performed. These files intentionally live outside `migrations/`, so the normal migration runner cannot apply compensation during Dynasty onboarding.

## Why a forward migration is required

Restoring the installed 011 publication functions after 015 changes the database again. Record that action with a new **016** migration rather than modifying or deleting any 001–015 ledger entry. Before an authorized rollback, commit the exact prepared 016 migration and reviewed executable wrapper through the repository's normal release process. If another migration has become 016, stop and prepare a newly numbered compensation against the newly verified installed state.

Prepared files in this artifact directory:

- `016_all_player_dynasty_publication_compensation.sql`: exact 011 three-argument readiness and nine-argument publication function bodies, with PUBLIC execution denied. It does not alter installed migration files, tables, league registrations, mappings, scores, observations or pointers.
- `016_all_player_dynasty_publication_compensation.production.review.sql`: transaction wrapper for the verified production database name `neondb`, owner `neondb_owner`, runtime role `league_one_runtime`, and PostgreSQL 18. It appends one 016 ledger row.
- `015-dynasty-compensation-evidence.json`: source and output checksums and explicit pending gates.
- `prepare-dynasty-compensation.mjs`: deterministic, database-free artifact generator. It verifies the unchanged installed 011 checksum, both reviewed 014/015 manifests, and exact regenerated 015 production wrapper before extracting its reviewed catalog/permission assertions.

## Exact state required by this candidate

The existing 015 migration must have checksum:

`f7bf9b74cc14c0ede7a7534257ea956f99edc2615983b5b66ae546f2812fef8a`

The prepared 016 migration has checksum:

`6afa9ea6f4eaab7dca9b0088ad74cd9a1ccb1dc006f1f6a0414c541976d3ecf8`

The prepared review wrapper has SHA-256:

`e7febcbf1caa603c434099ef16b6a575fb83995a400583342e11277bbb934ac2`

The wrapper checks exactly 15 prior ledger rows, every 001–015 checksum, the installed 015 PostgreSQL 18 table/column/index/constraint/trigger/function catalog, owners, PUBLIC/runtime execution rights and grant options, and runtime role membership restrictions. It refuses an active all-player lease. It takes the existing migration advisory lock and the existing projection-jobs table lock before these checks, preventing a new claim during installation.

After restoration it checks the complete reviewed 014 all-player function catalog and existing permissions, all unchanged 001–015 checksums, the exact new 016 row/checksum and 16-row ledger total. It verifies unchanged counts in all seven all-player tables, exact current-pointer contents, and unaffected schemas, tables, columns, constraints, indexes, triggers, functions, roles, memberships and default privileges. All changes and ledger insertion occur in one transaction. A failed assertion rolls back the function replacement and new ledger row.

## Operator sequence, only after separate authorization

1. Revalidate canonical repository, production branch, exact application SHA and Vercel binding. Verify the intended Neon project, branch, database and owner through the approved external service identity checks. SQL cannot prove a Neon project/branch identity from a database name alone. Require no competing release owner observed.
2. Disable all-player recurrence and verify the disabled application returns before its provider/database work. Drain active all-player jobs. Do not erase a job or force a successful completion; an expired or lost fence must remain unable to publish. Recheck naturally scheduled behavior and accessible lease evidence.
3. Prepare and verify the compatible original two-league application while recurrence remains disabled. Keep the corrected database guards and immutable history in place during the application rollback. A two-league writer must not resume against enrolled Dynasty under 015, because 015 correctly requires Dynasty's complete profile group.
4. Independently review this exact 016 source and wrapper. Run this exact wrapper, with the isolated database/owner parameters, through the existing fully guarded isolated PostgreSQL 18 harness. Prove successful commit and sentinel, old two-league publication with a registered Dynasty season, preserved Dynasty pointer/history, and complete transaction/ledger rollback under a deliberately corrupted postcondition. The application integration case already exercises the function-level compensation in a rolled-back transaction; that does **not** establish standalone wrapper execution evidence.
5. Commit the forward 016 migration and reviewed wrapper through a protected rollback PR. Recheck that production still has exactly the intended 001–015 ledger and 015 catalog. Execute the approved wrapper once under the verified owner. Never execute it as the runtime role, remove safeguards or edit its assertion values to fit an unexpected database.
6. Require the exact success sentinel below and verify the 016 ledger row, restored function fingerprints/permissions, unchanged history counts and unchanged pointers. On a lost connection or missing sentinel, inspect the exact ledger/catalog before deciding whether any retry is appropriate.
7. Verify League One and League Two readers against the compatible application. If separately authorized, restore the existing recurrence flag and observe a natural safe operation. Historical Dynasty data and its verified pointer remain retained. Removing the Dynasty routes from the restored application does not authorize deleting that data.

Expected success sentinel:

`ALL_PLAYER_DYNASTY_COMPENSATION_APPLIED:016_all_player_dynasty_publication_compensation.sql:6afa9ea6f4eaab7dca9b0088ad74cd9a1ccb1dc006f1f6a0414c541976d3ecf8`

## Behavior after Dynasty has been enrolled

The restored 011 functions require the two original leagues and their complete scoring/profile parity. They ignore Dynasty for subsequent original-league publication, while retaining Dynasty's registered season, existing scoring profile, immutable observations/scores and last verified pointer. Both existing publication signatures retain their existing runtime grants and still enforce a live job fence; readiness remains owner-only. The original single worker, scorer, ingestion budget and cron attachment are unchanged.

Applying this compensation while continuing to run the three-league application is not a valid recovery configuration: its three-league batch will correctly fail the restored two-league profile/lineage contract. Keep recurrence disabled until application and database publication scope agree. Reintroducing Dynasty after compensation requires a further reviewed forward migration; never erase or rewrite the 016 ledger record.

## Evidence status

Prepared and independently reviewed: deterministic extraction of exactly two original 011 function bodies; unchanged installed source checksum; exact match of the reviewed 015 production wrapper; expected database/owner/PG18/lease/catalog/ledger/preservation assertions; output checksums.

`dynasty-release-compensation-verification.json` records isolated execution at `2026-09-16T04:37:50.201Z`: the final forward wrapper committed with the exact reviewed 015 catalog; a forced compensation postcondition failure restored the entire 015 catalog and ledger; the valid compensation then committed with its exact sentinel, restored 014 catalog/ACL and unchanged 001–015 ledger plus one 016 entry. Only database/owner identity literals were rebound to the guarded test branch. Those wrapper checks used empty all-player tables; populated-history preservation is a separate application integration case. No production verification or production authorization is claimed. Repeat identity and compatibility checks at any future rollback; these dated artifacts cannot authorize a later changed state.
