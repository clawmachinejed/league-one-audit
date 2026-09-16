# Portable league administration release bundle

This directory belongs only to migrations `016_portable_league_administration.sql` and `017_enrolled_all_player_publication.sql`. Installed migrations 001–015 and their historical release artifacts remain unchanged. A generated SQL file is a review artifact, not release authorization.

Current execution evidence is recorded in `validation-status.json`. The initial automatic approval-review rejection caused no database changes. The user subsequently approved the named isolated reset/test sequence. Actual catalog, wrapper and physical-measurement results belong in their separate `catalog.integration.json`, `wrapper-verification.integration.json`, and `capacity.synthetic.integration.json` artifacts; the status record does not substitute for them.

The application can run against the additive schema before it uses administration readers. Apply 016 and 017 together, then deploy the application. Both old and new application paths retain the existing scorer, snapshot format, provider adapters and publication path. Old observations without administration lineage remain valid; new observations and snapshot verification pointers are fenced against their accepted configuration. Migration 017 preserves the existing publication signatures and uses explicit exact-season enrollment rather than a league-name allowlist.

## Isolated capture and verification

Coordinate one database-test owner before using the existing destructive harness. Do not run this command concurrently with the main integration suite, another wrapper verifier, or capacity measurement. Use only the separately authorized isolated database, with all identity, sentinel, TLS, role, safe-name and production-denylist guards from `../../integration/README.md` satisfied.

From `apps/site`, after loading the guarded integration environment:

```text
node --env-file=.env.integration.local --import tsx scripts/run-league-administration-release-wrapper-integration.mjs
```

The runner uses the existing harness to reset the isolated schema, install 001–015, capture the baseline, install through 017, and capture the new catalog. It requires PostgreSQL `180006`, including real type `n` NOT NULL constraints. The supplemental `catalog-definitions.integration.json` contains readable definitions to accompany the fingerprints. The runner verifies a corrupt post-migration catalog causes complete catalog and ledger rollback, applies the exact valid wrapper, checks its commit sentinel, and proves an already installed bundle is refused. It reuses a previously successful connection to prove that a client continuing after replay or wrong-target errors cannot obtain a success sentinel. Cleanup uses the same isolated harness. It never selects an arbitrary database or loads production secrets.

The capture runner initially writes `catalog.integration.json` with `reviewed: false`; its temporary reviewed value exists solely to exercise SQL against the guarded isolated database. The current capture has completed the file-based review documented in `catalog-review.md` and is now marked reviewed. That review covers exact migration checksums, actual table/constraint/index definitions, nine new functions, the two replaced publication signatures, trigger scope, search paths, ownership and ACLs. Any SQL edit invalidates its checksums and requires a new capture and review.

For a non-executable review copy, run:

```text
node scripts/render-league-administration-release-wrapper.mjs --review
```

Every line in `016-017.production.review.sql` is a SQL comment. Once the manifest has an independent review, the same command without `--review` renders executable `016-017.production.sql` for the known production database and owner. Rendering performs no database operation. Confirm freshly verified repository, branch, production Git SHA, database identity, release authority and absence of competing writing owners before execution.

## Release behavior and recovery

The wrapper holds the existing migration advisory lock and ordinary worker-claim table locks, refuses active job, lineup or materialization leases, checks the exact 001–015 ledger, verifies the baseline publication catalog, and applies both migrations in one transaction. Before committing, it verifies the exact new catalog and grants, unaffected function/trigger/table/policy/ACL/role/default-privilege fingerprints, protected historical row counts, and the resulting 001–017 ledger. New administration tables are read-only to the runtime role; only the observation writer is callable. Remapping, annual connection approval and effective-period activation remain owner-only.

Execute the wrapper in a fresh, idle SQL session, outside any existing transaction. It first clears and commits a session marker before opening the migration transaction. That separate commit is necessary because a PostgreSQL simple-query batch otherwise rolls the initial clear back with a later failure, restoring a previous invocation's success marker. Only validated migration postconditions set the marker that can survive the migration commit. The final sentinel checks that marker, database, owner, PostgreSQL version, ledger and catalog.

A missing commit sentinel is an ambiguous outcome. Read the ledger and captured catalog before retrying; never assume that a disconnected client rolled the transaction back. A normal assertion failure before the migration commit rolls both migrations and ledger inserts back. The preliminary marker commit changes session state only.

An application rollback retains all additive administration tables and captured history. Do not drop tables, delete migration ledger rows, or reverse source mappings to roll back application code. The former application continues using the preserved interfaces, scoring profiles and snapshot publication signatures. A source mapping or setting correction requires its explicit owner operation and evidence; it is not an application rollback step. Confirm all routed leagues after deployment or rollback.

For the separately coordinated finite synthetic growth run, use:

```text
node --conditions=react-server --env-file=.env.integration.local --import tsx scripts/run-league-administration-capacity-integration.mjs
```

This resets only the same guarded isolated schema and cannot run concurrently with another harness owner. It measures 33 source documents for three synthetic leagues using the captured 12/12/10-team and 14/14/20-slot configuration shapes, complete draft/pick and bracket evidence, ten unchanged refreshes, branding reversions, and nine roster/score/transaction corrections through the actual restricted adapter and writer. Managers, players, lineups, transactions and draft/bracket entities are synthetic. `capacity.synthetic.integration.json` reports row counts and separate heap, index and TOAST allocations. Serialized JSON byte counts do not represent measured network transfer. Physical page allocations include update overhead and are not a production capacity or cost forecast.
