# Independent review of the migration 011 catalog

Reviewer: the identity/eligibility review agent (`/root/audit_identity_eligibility`),
independent of the migration, writer, job SQL and release-wrapper implementer.
Reviewed at 2026-09-12 16:47:34 UTC. This review covers those database/release
sources; it is not an independent review of code or fixtures authored by this
reviewer.

**Approved for preparing the identity-bound production wrapper.** The manifest
was marked `reviewed: true` after the source and catalog comparisons below.
This is not production execution authority, release completion, a capacity
approval, or evidence that Week 1 can publish.

## Exact artifacts

- Migration: `migrations/011_all_player_foundation_guards.sql`.
- SHA-256 after the release wrapper's CRLF-to-LF normalization:
  `0eaa96bcc0b65053ac8dab48657eb7bfe22fadbfd41b4f4c78c3472ca8a512b6`.
- Catalog: `release/011-catalog.integration.json`, captured on PostgreSQL 18 at
  `2026-09-12T16:44:12.614Z`.
- SHA-256 of the reviewed manifest file:
  `814a0297e21cdb686228a5462ed65403477ef3a5aab9039caecc6710d896a7ed`.

The normalized migration checksum was independently recomputed and matches the
manifest. Installed migration 010 has no working-tree diff. Its original catalog
and migration checksum remain the release precondition.

## Catalog and permissions comparison

The manifest contains exactly **7 tables, 16 triggers and 21 function
signatures**. Relative to the reviewed 010 catalog:

- Five existing immutable table tuples are identical, including columns,
  constraints, PostgreSQL 18 NOT NULL counts and indexes. The current-pointer
  table retains its columns and index; its one added constraint corresponds to
  the deferred publication-fence trigger.
- `all_player_score_verifications` is the only added table. Its five NOT NULL
  columns, three foreign keys, object check, primary key and observation/profile
  uniqueness account for its eleven constraints. Its three indexes are the
  primary key, unique key and parity-evidence GIN index.
- Constraint totals reconcile to **51 checks, 15 foreign keys, 79 NOT NULL,
  7 primary keys, 1 constraint trigger and 10 unique constraints**. The five new
  NOT NULL constraints and the deferred trigger explain the PostgreSQL 18 delta;
  no pre-18 count approximation was substituted.
- All ten prior trigger tuples remain identical. The six additions are
  verification immutability/lineage, raw-entry and score append guards, the
  global-job guard and the deferred pointer fence. Their table/function targets
  match the final SQL.
- The two publication overloads and seven dedicated job/budget helpers have
  runtime EXECUTE. The other twelve signatures remain unavailable to runtime
  callers. The older publication signature still requires a live transaction
  fence; retaining its grant does not permit the old unfenced writer to publish.
  The two-argument readiness helper, scorer-support helper and generic immutable
  history helper retain their original definition fingerprints.
- The wrapper independently asserts actual table and column privileges,
  function ownership and EXECUTE privileges, absence of PUBLIC grants and grant
  options, and inability of the runtime role to assume another role. Runtime
  table access remains SELECT/INSERT for immutable evidence, SELECT-only for
  current pointers, with no UPDATE/DELETE/TRUNCATE or privilege delegation.
  The manifest's table INSERT booleans are the reviewed policy expectations;
  the executed wrapper checks the effective database privileges against them.

The reviewed source keeps SECURITY DEFINER search paths explicit, protects the
global job through its owner-context trigger, validates active generation,
token, expiry and deadline at publication, and checks the physical coordinated
profile group before successful completion. The bounded preclaim helper uses
the same advisory/row-lock order as claims and preserves lease, budget and
period-history fields. Its unchanged/throttled branches do not update the row.

An equal-time new observation cannot bypass mapping validity by advancing
lineage: the publication function rejects a different observation or score-set
ID before pointer mutation. Exact replay and older superseded observations
retain their existing behavior.

## Execution evidence and remaining gates

The coordinating task supplied the guarded PostgreSQL 18 wrapper result:
corrupted constraint-manifest rollback, actual wrapper commit and exact success
sentinel all passed for the checksum above. It also reported all 31 all-player
SQL cases passing in the third isolated suite. That suite was not wholly green:
nine alias-test failures came from transaction connection handling and attempted
role switching. The test harness correction is separate and requires its own
rerun; this review does not relabel those failures as passing.

Any migration change invalidates this approval and requires a new checksum,
capture and independent comparison. Production rendering must still bind the
freshly verified database and owner. Execution additionally requires production
authority, compatible application order, fresh ownership checks, reviewed alias
reference counts and the remaining source/parity/capacity gates. Recurrence
stays disabled until the operational contract is satisfied.
