# Account database boundary

Migration `020_account_foundation.sql` adds dormant website identity and personal-library records. It does not register leagues, collect providers, change source ownership, run account bootstrap or grant source commissioners website authority. Applying the migration is distinct from enabling authentication or deploying the account feature.

The seven `app_*` tables contain internal users, exact authentication issuer/subject mappings, private unverified source-account associations, personal league preferences, optional groups, group membership intervals and minimal audit events. Existing permanent leagues, annual source connections, teams and accepted membership observations remain the source records. Current league pages remain public.

## Trusted server and transaction contract

Only a verified server session may supply the issuer and subject to `resolve_app_login_identity(issuer, subject, display_name, request_id)`. The function returns the independent app-user UUID, creates one user transactionally under concurrent first login, and refuses revoked or inactive identities. It does not verify an external token itself and never matches email, display name or Sleeper username. An existing issuer/subject is never automatically reassigned or reactivated.

For every protected read or write, use one atomic database transaction:

```sql
SELECT set_config('app.actor_user_id', $1, true),
       set_config('app.request_id', $2, true);
-- Account queries run here, on this same transaction/connection.
```

The actor comes from the resolved verified server session; the request ID is a server-generated UUID. Never accept either as browser authority. Never set context in a separate pooled request. The actor helper checks active status and returns null for missing or malformed actor context. RLS then hides other users' rows and rejects cross-user writes. Concurrent request transactions keep separate context.

The account runtime credential is a trusted server credential: it can assert a different actor or verified issuer/subject. RLS protects against omitted row predicates, not a compromised server credential. Keep it server-only, separate from the shared worker credential and schema owner. Private response caching remains the server/API layer's responsibility.

## Privileges and mutation rules

Run `apps/site/scripts/provision-account-role.sql` as the schema owner after migration 020. It creates `league_one_account` through SQL without administrative role membership, refuses elevated flags or owned objects, resets both table and column ACLs, then grants only the intended privileges. It verifies RLS, worker exclusion, source-write denial, restricted lifecycle columns and unavailable privileged source functions. No password appears in this script. Assign its password separately and rerun the postconditions after any service control-plane role operation.

- Profile changes are limited to display name and optional platform handle. Handles normalize ASCII case and are unique; display names and unverified source claims are not exclusive.
- Provider associations can target an existing source account, always at `user_asserted` assurance. Revocation is irreversible for that record; a later explicit association creates another record. No provider credential is collected or stored.
- Saved leagues refer to permanent league UUIDs. A new preferred team must belong to that league's approved current annual connection and accepted complete roster. Rollover does not silently rewrite an old preference, and an old preference is not current team inventory.
- Mutable records advance revisions. Server writes should use the observed revision in their `WHERE` clause and handle zero affected rows as conflict.
- Identity mapping, lifecycle changes, groups, membership intervals and audit administration remain operator-only. No account-merge feature or role hierarchy is provided.
- Trigger-generated audit records commit or roll back with the change. They retain actor/request IDs, resource IDs and revision metadata, without names, emails, source payloads or secrets. Ordinary account requests cannot read or write the audit table.
- A per-actor advisory try-lock and the actor/time audit index limit ordinary user changes to 60 audit events in a rolling 60 seconds. User mutations require Read Committed isolation so a later count sees the preceding committed event. Contention, an incompatible isolation level or an excess write raises SQLSTATE `P4290` and rolls back the mutation, revision and audit together, including every row of a multirow statement. Authentication creation and operator maintenance are excluded; the API returns a rate-limit response rather than exposing driver text.

The account role reads selected normalized source columns only. It cannot read raw administration content payloads or mutate source evidence, enrollment, jobs, scoring or projections. Manager display documents have a separate accepted users head; they must not be presented as atomic with the accepted roster document. Source membership readers must join the accepted roster head and exact annual source, preserve conflict/stale/unavailable outcomes, and never union retained historical observations into current participation.

## Optional group bootstrap

`apps/site/scripts/seed-account-league-group.sql` is a separate operator action. It validates the existing active `league1`, `league2` and `dynasty` records, idempotently creates the `league-one-two` group with League One and League Two, and fails on a conflicting existing membership. Dynasty stays independent. It creates no users, provider associations, source enrollment or team memberships. Group navigation does not confer administration or private-data access, and overlapping groups are not recursively expanded.

## Verification and recovery

The existing isolated integration harness provisions the new account role only when migration 020 is included. `withAccountActor` and `accountQuery` use the guarded owner connection to assume that restricted role inside a pinned transaction. After checking that the catalog owner matches the already-verified owner URL, isolated preparation grants that owner permission to assume the account role and verifies the result. It does not grant the account role membership in an owner, worker or administrative role. Failure is not a reason to bypass the existing identity, sentinel, TLS, authorization or production-denylist checks. Historical migration-wrapper targets continue to skip account provisioning.

The account integration cases cover concurrent/failed provisioning, RLS isolation, inactive and revoked replay, privilege escalation, nonexclusive source associations, team lineage and annual rollover, handle uniqueness, revision conflicts, atomic audit, worker exclusion and rollback-only group bootstrap. These files are coverage requirements, not evidence of a successful live database run. Record actual isolated test results, role postconditions and exact migration checksums in the release evidence.

Migrations 001–019 remain unchanged. A failed migration transaction rolls back. After a committed deployment, disable the account feature or use a compatible application rollback/forward fix; do not erase private data, audit history or migration-ledger entries as routine rollback. Preserve the pre-account recovery checkpoint separately from ongoing account-data backups.
