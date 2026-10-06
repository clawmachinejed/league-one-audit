# BC-M1 account authority transition plan

Status: implemented source transition, **not database-qualified or authorized for execution**. Migration 034 remains a merge/application blocker until the real installation, caller, role and recovery evidence below passes. The design originated at `c907584571052cfbea6957e8bad08066fe11f432`; this increment continues published parent `ffa7bd0d16bdc34c1578e2a2e77690cb6c756381`. Requirements remain ENG01, ENG07, R087, BS-O07/13/15 and the canonical relational/security designs. Exact frozen verification belongs in [evidence](evidence.md).

## Existing caller inventory and required composition

| Owner | Existing private operations | Required coordinated change |
| --- | --- | --- |
| `lib/accounts/http.ts` | Account read, teams, mutation; linked-profile preview; discovery | Obtain `getAccountAuthorizedPrincipalV2` and construct each request's store through `createAccountDatabaseForPrincipal(principal)`. Pass the principal explicitly into store composition; never put receipts in a process-global current-principal slot. Revalidation after slow work must bind a fresh admitted principal/store and compare the original actor/association revisions. |
| `lib/accounts/onboarding-http.ts` | Username preview and confirmed import/link | Same request-owned authority composition. Retain origin/body/expected-account checks. Provider work cannot keep an account transaction open; final account mutation must reacquire authority and reject a changed/revoked principal. Durable provider admission remains a separate BC-M1 requirement. |
| `lib/accounts/fantasy.ts` | Account-scoped memberships and fantasy response | Same request-owned composition and final coherent delivery checks. Receipt/session timing alone cannot substitute for target membership, source, association or policy deadlines. |
| `app/page.tsx` and sign-in/session UI | Login display/redirect, with no private account database | Keep maintained authentication independent of provider membership and account epoch. Do not make sign-in depend on a successfully resolved provider association. |
| `lib/accounts/neon/store.ts` | Resolver, reads and canonical mutations used by these owners | Preserve actor/request context, rate/audit transaction and canonical lock order. Bind all private transactions to the supplied receipt. Mutations and protected final responses require final database-time validation and monotonic delivery handling; unknown commit cannot be reported as rollback. |

The inventory must be regenerated before cutover, including application routes, server components, operator tools and any new worker caller. No ordinary private composition may retain receiptless `createAccountDatabase`. The low-level receiptless adapter is not an authorized fallback when 034 is present. Test-only injection must not expose a production bypass.

## Database and epoch authority

1. Prove schema owner, restricted auth/account/runtime LOGIN identities and grants using the actual roles. A matching URL string, owner `SET ROLE`, or matching database name alone is insufficient.
2. Establish a server-reported identity manifest that binds auth and account credentials to the same intended Neon project/branch/database and clock domain. The new 036 helpers compare independently obtained `pg_settings` postmaster values for Neon project, branch, tenant and timeline, plus current database name/OID, to the approved `ACCOUNTS_DATABASE_IDENTITY`. Auth checks and maintained auth operations use the same pinned connection; account checks run inside the protected transaction. Availability and privileges for these values on the actual intended Neon service remain unverified. Missing/mismatching values deny access. Neither a URL nor the receipt's echoed `clockDomain` is independent identity proof; no fallback is provided.
3. Keep `accountAdmissionConfigHash` as the canonical admission configuration digest, computed from the exact issuer and existing normalized invitation set. Keep exact UTF-8 token/email digest behavior. Never log the receipt, token, token digest or email digest.
4. Provide an explicit schema-owner-only epoch activation operation. It must use actual `session_user`/catalog owner authority, the exclusive auth advisory gate before row locks, a checked prior revision, strictly advancing positive revision, exact issuer/configuration/clock-domain binding and atomic evidence. No automatic epoch seeding, request-triggered initialization or caller-chosen activation is permitted.
5. The auth role may use only its bounded epoch reader; account role only the approved authority helpers. Neither receives raw epoch mutation or raw auth-table privileges. Account-domain access remains in the existing account transaction, whose locks survive coordinator loss.
6. Qualify old-config, absent-epoch, mismatched-database, replaced-token, changed-email and epoch-switch cases. Old deployments must fail closed after epoch change. A rollback must not reactivate stale epoch receipts by decrementing/reusing a revision.

## Installation and application sequencing

Migration 034 replaces the existing resolver and installs mandatory existing-table guards. Its bytes and 035's bytes remain unchanged. The updated `scripts/migrate.mjs` recognizes 034–036 as one coordinated transaction with their ledger entries, rather than applying them as three independently committed migrations. It refuses absent-transition installation unless the source is clean at the reviewed full SHA, all three checksums match the explicit approval, a compatible recovery SHA and maintenance/drain evidence hashes are supplied, and private maintenance is enabled. Partial or drifted ledger state stops installation for independent reconciliation. An evidence hash is an attestation reference, not proof that old traffic has drained.

The installer takes the exclusive auth gate and checks for remaining auth/account backends before the transition. Pre-034 writers do not obey the new gate: an independently verified service-boundary drain is still mandatory. The atomic installer also checks actual schema-owner LOGIN authority. A lost COMMIT acknowledgement is reported as unknown, never rollback; it does not retry. The strict shared owner URL parser rejects duplicate parameters, driver overrides and TLS downgrades before constructing a driver. None of these commands has been executed against a database in this iteration.

An independently reviewed `ACCOUNTS_MIGRATION_DATABASE_IDENTITY` manifest is mandatory before constructing the migration driver, including an idempotent rerun or read-only reconciliation. The installation approval also binds that exact identity. Before any ledger/schema write, raw built-in catalogs establish the immutable Neon project/branch/tenant/timeline and database name/OID on an explicitly pinned owner connection; this does not depend on 036 already existing. That connection retains the gate, census and every migration operation. The atomic transition rechecks identity and takes its own transaction gate before DDL. Connection loss fails the operation; the pool cannot silently replace the gate-owning connection. Application account credentials also undergo strict host/role/database/TLS/query validation before driver construction, so a later SQL identity check cannot be used to excuse sending a credential to an unapproved endpoint.

Before a release-ready candidate exists, rehearse one reviewed coordinated transition in a disposable database with representative legacy fixtures and both application versions:

1. Inventory every affected caller and auth writer, validate prerequisites and exact migration checksums, and establish a separate release/maintenance authority. Preserve existing public football routes, shared workers and official-data reads throughout their qualified coexistence behavior.
2. Drain or explicitly gate affected private account requests at the service boundary for the bounded transition. This is maintenance that denies new private work, never an SQL-guard bypass. Confirm in-flight account/auth transactions have ended before changing their schema contract. An ordinary rolling deployment that mixes receiptless callers with mandatory guards is unacceptable.
3. Under the authorized schema owner, install the reviewed schema and grant manifests and verify the actual catalog before activating an epoch. Apply no migration to production merely because unit or browser tests passed.
4. Install the qualified receipt-aware caller composition and verify the service/database identity manifest. Activate the checked epoch only under the owner procedure, then run actual restricted-role canaries for resolver, reads, valid mutation, invalid mutation, revocation, final response lifetime and old-version rejection.
5. Reopen private requests only after the required old/new compatibility and recovery evidence passes. Public BC-M1 target activation remains a separate gate; foundational schema installation is not target completion.

An additive staged-install alternative is acceptable only after its exact intermediate schemas and caller compatibility are designed and independently qualified. It must not admit ordinary account operations without the required authority. Moving a mandatory guard behind a generic feature flag is not an acceptable alternative.

## Migration 037 installation hold

Migration 037 implements target D03 exclusivity on the existing account-link
owner. This is a behavior-changing schema step: 020 and the existing site store
permit nonexclusive/multiple provider profiles, while 037's active-link unique
indexes prevent both a second active provider account for one actor and a second
actor claiming the same account. A clean pre-install census does not preserve
those callers' future behavior. A disabled target does not protect them.

Independent source-model reproduction showed both previously accepted insert
patterns becoming zero-row `ON CONFLICT DO NOTHING` outcomes, and that automatic
discovery originally placed 037 outside the 034–036 coordinated batch. The normal
`migrate.mjs` entry now **refuses installation before constructing a driver when
037 is present**. There is no feature-flag or environment override. Explicit
read-only reconciliation reports the held migration without applying anything.
The existing guarded disposable harness may install it only during a separately
authorized qualification invocation; no invocation has occurred here.

Before lifting this hold, implement and independently review the compatible
existing connection/onboarding callers, including durable qualified lookup,
exclusive activation, conflict/release handling and their existing UI contracts.
Reconcile all legacy claims without invented lookup receipts, arbitrary conflict
winners or weakened D03 indexes. Extend the coordinated schema/caller/drain and
recovery rehearsal to include 037, both application's actual canaries, and exact
new SHA/checksums. Until then, this is an internal source increment, not an
installable foundation checkpoint. R087 and F1 remain open.

## Recovery and rollback boundary

Before a schema transaction commits, confirmed rollback may restore the prior state. After 034 or an epoch transition commits, an old receiptless application is not a safe rollback artifact. Retain a reviewed compatible application artifact and use forward repair or keep private access denied while resolving the fault. Do not drop guards, rewrite the migration ledger/checksums, delete epoch history, restore revoked sessions, or reset a production schema to make a rollback appear successful.

Explicit recovery must cover interrupted install, grant verification failure, absent/incorrect epoch, old deployment traffic, database identity mismatch, unknown migration/activation acknowledgement, dead coordinator, and failed private canary. Reconcile actual catalog/epoch and transaction outcome before repeating an operation. Repeat only a specified idempotent administrative operation with independent authority; no automatic destructive retry.

`migrate.mjs --reconcile-account-transition` is an authored read-only ledger inspection mode. Its `applied` result explicitly does **not** qualify the catalog or authorize reopening private access. A separately authorized owner must compare the actual helpers, triggers, grants, RLS and restricted LOGIN canaries. This read-only database command is also outside the current no-database-connection authorization.

`activate-account-epoch.mjs --activate-reviewed-epoch <operation-file>` is an explicit, separately authorized owner action, never part of application startup or automatic migration. The operation records previous/next revision, issuer/configuration, identity, request ID and release evidence hash. The SQL procedure verifies actual owner LOGIN, takes the exclusive auth gate, compares the previous revision, and atomically appends activation evidence. UPDATE, DELETE and TRUNCATE of retained history are guarded; a reset epoch cannot reuse a retained revision. The command requires private maintenance and sanitizes uncertain outcomes. An unknown acknowledgement requires reconciliation by request ID before another operation. The source implementation is not an activation authorization or a successful recovery rehearsal.

## Required evidence before closing F1

- Every inventory row has implemented request-owned receipt composition and production-callsite census evidence.
- Real restricted LOGIN installation, resolver and mutation tests pass, including meaningful bootstrap overlap, commit/rollback, both revocation orders, coordinator loss and same-transaction authority lifetime.
- Actual catalog evidence proves helper owner/search path/grants, mandatory guards, RLS and no raw auth/epoch privilege expansion.
- Empty/wrong/stale epochs, wrong database/branch/clock identity and old application configuration fail closed; approved activation advances revision without reviving old authority.
- Same-input legacy account behavior is preserved through the selected transition, and compatible rollback/recovery is rehearsed without bypassing guards.
- Full repository and browser evidence, the exact candidate SHA, independent review and separately authorized release/installation gates are recorded. No isolated SQL pass alone closes BC-M1 or authorizes production.

The preserved independent audits remain authoritative evidence for their reviewed SHAs. F1 source corrections are reviewable, but F1 qualification stays open until the installation, actual identity/role, old/new compatibility and recovery conditions pass. Local mocks and source review cannot close that qualification gap.
