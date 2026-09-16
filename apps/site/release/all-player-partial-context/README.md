# Migration 018 guarded release evidence

Migration 018 replaces only `validate_all_player_stat_entry()` and `finish_all_player_job(jsonb,text,jsonb)`.
It creates no tables, changes no grants and rewrites no historical data. Installed migrations 001–017 must retain their exact checksums.

The transaction renderer and PostgreSQL 180006 catalog machinery are shared with the reviewed 016/017 administration wrapper. A regression test verifies that the historical administration SQL output remains byte-for-byte identical after LF normalization.

## Capture and verify in the existing isolated harness

Only the authorized database owner may run this, with every existing identity, sentinel, TLS, role and production-denylist guard satisfied. No production credentials are needed.

From `apps/site`, using Node 24 and the existing guarded integration environment:

~~~sh
node --env-file=.env.integration.local --import tsx --conditions=react-server scripts/run-all-player-partial-context-release-wrapper-integration.mjs
~~~

This destructive isolated capture installs through 017, records both replaced functions, then applies 018 and records the after catalog and readable definitions. It verifies full unaffected catalog/ACL preservation, all physical public-table row counts, the exact 001–017 ledger, PostgreSQL 180006 NOT NULL constraint inventory, corrupt-function and corrupt-constraint rollback, actual wrapper commit, exact sentinel, refused replay and same-session continue-after-error/wrong-target behavior.

The durable catalog remains `reviewed: false` until independent review. No fabricated capture is checked in.

## Render only

After capture:

~~~sh
node scripts/render-all-player-partial-context-release-wrapper.mjs --review
~~~

The review file contains only comments and cannot apply a migration. After exact independent manifest review:

~~~sh
node scripts/render-all-player-partial-context-release-wrapper.mjs
~~~

The executable output is `018.production.sql`. Rendering does not execute it. Before authorized production execution, revalidate repository/service identity, release ownership, exact installed ledger, recovery point and compatible application order. The wrapper itself rechecks database/owner, least privilege, live worker leases and all captured catalog protections within its transaction.

## Rollback

A failed wrapper transaction rolls back both function replacements and the ledger insert. Its same-session marker cannot report success after a failed attempt. Reconcile uncertain client outcomes read-only before retrying.

After successful installation, preserve the additive migration and verified history. Application rollback can use the compatible prior caller behavior. Replacing either function with an older definition requires a separately reviewed compensating forward migration; do not delete migration 018, edit installed checksums, drop history or assume a destructive down-migration is safe.

## Evidence status

The guarded isolated capture passed all 11 wrapper checks on PostgreSQL 180006. Independent review verified the two function bodies, unchanged ownership/ACLs, 50 protected tables and the constraint inventory including 417 NOT NULL constraints. The captured manifest is marked reviewed; its exact source hashes are in `catalog-review.integration.json`. Generator tests passed 19/19. Production installation remains a separate release gate; these artifacts do not claim it occurred.
