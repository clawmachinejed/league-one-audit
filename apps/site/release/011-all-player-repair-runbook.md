# All-player repair migration and recovery

This is a proposed release procedure. It does not authorize production changes.
Migration 010 and its checksum remain unchanged. Migration 011 adds one compact
immutable verification table, publication/job guards and stricter eligibility
and mapping validation. It changes no scoring rules, routes or cron schedule.

## Evidence required before release

- Revalidate canonical repository, local/GitHub main, Vercel binding/root,
  production branch and exact production SHA. Verify Neon project, branch,
  database and connected owner/runtime role. Inspect ownership and keep the
  recurring flag disabled. Proceed with no competing owner observed.
- Finish independent review and complete repository verification. Record the
  exact migration SHA-256 and reviewed branch revision. The final SQL file is
  `migrations/011_all_player_foundation_guards.sql`.
- Run the existing guarded isolated integration harness. Its authorization,
  server identity, durable sentinel, TLS, role and production denylist checks
  must all pass before any reset. Unit tests cannot prove SQL or race behavior.
- Run `pnpm --dir apps/site test:migration-wrapper:integration --repair`. The
  existing wrapper runner selects the 011 verifier with `--repair`. It tests the
  actual additive wrapper, a corrupted constraint manifest rolling back, and an
  exact success sentinel on PostgreSQL 18. It captures
  `release/011-catalog.integration.json` with `reviewed: false`.
- Independently review that captured manifest against the final SQL and runtime
  permissions. It contains PostgreSQL 18 NOT NULL constraints, table/index/
  function/trigger fingerprints and effective execution permissions. Do not set
  `reviewed: true` merely because capture succeeded. A changed SQL checksum
  invalidates the manifest and requires another isolated capture/review.
- After confirming the identities in the existing renderer, run
  `node scripts/render-all-player-production-migration-wrapper.mjs --repair`
  from `apps/site` with supported Node 24. It calls
  `buildAllPlayerRepairReleaseWrapper` with the exact production database/owner
  identity and reviewed manifest, then writes
  `release/011_all_player_foundation_guards.production.sql`. The builder refuses
  a missing, unreviewed, wrong-version or wrong-checksum manifest. Rendering
  performs no database operation.

## Installation order

1. Keep recurrence disabled and complete the reviewed alias correction plan
   separately. Recount affected canonical mappings and immutable references.
   Never edit immutable slates, candidates, baselines or past score rows.
2. Under explicit migration authority, execute the exact rendered 011 wrapper
   once. It uses the existing migration advisory lock and transaction; verifies
   the original 001–010 checksums and original 010 catalog; requires PostgreSQL
   18; locks job mutations and checks every live all-player job type, including
   old period-scoped keys; installs 011; checks the exact new object set/catalog,
   exact permissions and preserved historical row counts; then commits with
   `ALL_PLAYER_REPAIR_APPLIED:011_all_player_foundation_guards.sql:<checksum>`.
   An absent sentinel is ambiguous. Reconcile the ledger read-only before any
   retry. Do not run an unreviewed loose migration as a replacement.
   The short transaction lets readers continue while ordinary job mutations
   wait for its job-table lock. A five-second lock timeout aborts safely if
   competing work prevents the reviewed installation from beginning.
3. Verify ledger/checksum, effective ACLs, trigger definitions and both existing
   league readers while the old application remains deployed. Existing readers
   and unrelated workers remain compatible. **The old all-player writer is
   deliberately incompatible:** it supplies no live fence and must fail closed.
   Keep its lane disabled until the new application is deployed.
4. Under release authority, merge/deploy the reviewed application. Verify exact
   merged SHA in Vercel and both league readers. Only the new application uses
   the explicit fenced publication overload and compact verification lineage.
5. After requested-period inventory, eligibility, schedule finality, full parity,
   alias correction, request budget and measured capacity gates pass, follow the
   approved Week 1 shadow/backfill/activation procedure. Do not substitute a
   different week or force partial observations through publication.

The global job row is protected against generic runtime INSERT/UPDATE/DELETE.
Only the dedicated owner-executed job functions may mutate it. A request marker
is claimed once per generation and retained across failures and period rollover.
Publication checks owner, generation, lease expiry, period and actual deadline
inside SQL, including a deferred pointer guard before commit. Successful job
completion requires the publication marker and actual complete profile pointers;
final-period proof comes from stored coverage. A stale owner cannot complete a
successor's job. A takeover preserves interrupted-attempt evidence.

## Recovery and rollback

Disable recurrence first. Allow outstanding leases to expire, or use a separately
reviewed owner procedure that invalidates the exact current generation. Do not
erase the global budget row: it carries request limits and final-capture evidence.
Never move current pointers manually or delete immutable observations to recover.

Preserve installed 011, compact verification lineage, original score-set lineage,
current pointers and historical rows. Roll back only to application code that is
compatible with this schema and the repaired shared identity boundary. The
pre-011 all-player writer must remain disabled; restoring it does not restore
ingestion. An older projection worker that can recreate a quarantined false
mapping is not a safe rollback target.

Database rollback is compensating and reviewed, not an automatic down-migration.
Keep guards in place unless a separately tested additive correction replaces
them. Any alias compensation must verify the saved before/after state, unchanged
affected-reference inventory and concurrency preconditions; do not relink to an
unproven replacement or rewrite historical candidates. Reconcile temporary
Vercel changes through Git and reverify both leagues after recovery.

## Current evidence status

The guarded isolated PostgreSQL 18 wrapper run completed on September 12, 2026.
It proved corrupted constraint-manifest rollback, successful execution of the
actual wrapper and its exact success sentinel. The capture timestamp is
`2026-09-12T16:44:12.614Z`; the installed/tested normalized migration SHA-256 is
`0eaa96bcc0b65053ac8dab48657eb7bfe22fadbfd41b4f4c78c3472ca8a512b6`.
The [independent catalog review](011-catalog-independent-review.md) at 16:47:34Z
approved the [PG18 manifest](011-catalog.integration.json), including its exact
seven tables, sixteen triggers, twenty-one function signatures and runtime ACLs.

The [prepared production wrapper](011_all_player_foundation_guards.production.sql)
has SHA-256
`afe42644234b0805e44c00d9e8eb9e1eaefd3520a75cea0354fffb58470e6912`.
It binds database `neondb`, owner `neondb_owner` and runtime role
`league_one_runtime`. The coordinating task freshly checked production SQL
database/owner identity at `2026-09-12T16:46:52.885820Z` on PostgreSQL 18.6 and
matched Neon project `solitary-base-99261075`, main branch
`br-rapid-boat-avgeevye`. That read-only check found all six installed all-player
tables empty, no all-player or live projection jobs, and no 011 verification
table. Revalidate these identities, installed catalog and release ownership
immediately before any authorized production execution.

**Production 011 has not been applied by this work.** Prepared SQL and isolated
execution do not establish application deployment, alias correction, completed
Week 1 source evidence, backfill, pointer publication or activation. The final
supported Node 24.19.0 / pnpm 11.19.0 `verify:full` run completed with exit zero:
108 unit files, **1,641 passed and one scoped IPv6 skip**; **39 Chromium tests
passed, zero skipped**; and 13 isolated database files, **200 passed, zero
skipped**. The database phase took 252.71 seconds and included all twelve corrected
alias retirement cases, the two-session replay/preclaim cases, partial evidence
and the eleven-scenario synthetic capacity measurement. These are local and
isolated results, not production release evidence. The guarded 011 wrapper test
remains the separate PostgreSQL 18 installation/rollback proof described above.
Physical measurements and their limits are recorded in
[the capacity document](../../../docs/all-player-capacity-validation.md).
