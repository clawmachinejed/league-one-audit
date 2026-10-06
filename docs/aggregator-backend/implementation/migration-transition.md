# BC-M1 account authority transition plan

Status: design for the next qualified implementation increment, not an executable release runbook or migration authorization. Migration 034 remains a merge/application blocker until this plan is implemented and its evidence passes. Source review starts at `c907584571052cfbea6957e8bad08066fe11f432`; requirements remain ENG01, ENG07, R087, BS-O07/13/15 and the canonical relational/security designs.

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
2. Establish a server-reported identity manifest that binds auth and account credentials to the same intended Neon project/branch/database and clock domain. Compare the approved manifest before authority-bearing work. This proof is not implemented by the current configuration hash; do not treat the receipt's echoed `clockDomain` as independent infrastructure identity.
3. Keep `accountAdmissionConfigHash` as the canonical admission configuration digest, computed from the exact issuer and existing normalized invitation set. Keep exact UTF-8 token/email digest behavior. Never log the receipt, token, token digest or email digest.
4. Provide an explicit schema-owner-only epoch activation operation. It must use actual `session_user`/catalog owner authority, the exclusive auth advisory gate before row locks, a checked prior revision, strictly advancing positive revision, exact issuer/configuration/clock-domain binding and atomic evidence. No automatic epoch seeding, request-triggered initialization or caller-chosen activation is permitted.
5. The auth role may use only its bounded epoch reader; account role only the approved authority helpers. Neither receives raw epoch mutation or raw auth-table privileges. Account-domain access remains in the existing account transaction, whose locks survive coordinator loss.
6. Qualify old-config, absent-epoch, mismatched-database, replaced-token, changed-email and epoch-switch cases. Old deployments must fail closed after epoch change. A rollback must not reactivate stale epoch receipts by decrementing/reusing a revision.

## Installation and application sequencing

Current 034 is automatically discovered by `scripts/migrate.mjs`, replaces the existing resolver, and installs mandatory existing-table guards in the same migration. Its comments and an inactive target route do not make it safe to apply. This remediation checkpoint does not alter or apply that migration.

Before a release-ready candidate exists, rehearse one reviewed coordinated transition in a disposable database with representative legacy fixtures and both application versions:

1. Inventory every affected caller and auth writer, validate prerequisites and exact migration checksums, and establish a separate release/maintenance authority. Preserve existing public football routes, shared workers and official-data reads throughout their qualified coexistence behavior.
2. Drain or explicitly gate affected private account requests at the service boundary for the bounded transition. This is maintenance that denies new private work, never an SQL-guard bypass. Confirm in-flight account/auth transactions have ended before changing their schema contract. An ordinary rolling deployment that mixes receiptless callers with mandatory guards is unacceptable.
3. Under the authorized schema owner, install the reviewed schema and grant manifests and verify the actual catalog before activating an epoch. Apply no migration to production merely because unit or browser tests passed.
4. Install the qualified receipt-aware caller composition and verify the service/database identity manifest. Activate the checked epoch only under the owner procedure, then run actual restricted-role canaries for resolver, reads, valid mutation, invalid mutation, revocation, final response lifetime and old-version rejection.
5. Reopen private requests only after the required old/new compatibility and recovery evidence passes. Public BC-M1 target activation remains a separate gate; foundational schema installation is not target completion.

An additive staged-install alternative is acceptable only after its exact intermediate schemas and caller compatibility are designed and independently qualified. It must not admit ordinary account operations without the required authority. Moving a mandatory guard behind a generic feature flag is not an acceptable alternative.

## Recovery and rollback boundary

Before a schema transaction commits, confirmed rollback may restore the prior state. After 034 or an epoch transition commits, an old receiptless application is not a safe rollback artifact. Retain a reviewed compatible application artifact and use forward repair or keep private access denied while resolving the fault. Do not drop guards, rewrite the migration ledger/checksums, delete epoch history, restore revoked sessions, or reset a production schema to make a rollback appear successful.

Explicit recovery must cover interrupted install, grant verification failure, absent/incorrect epoch, old deployment traffic, database identity mismatch, unknown migration/activation acknowledgement, dead coordinator, and failed private canary. Reconcile actual catalog/epoch and transaction outcome before repeating an operation. Repeat only a specified idempotent administrative operation with independent authority; no automatic destructive retry.

## Required evidence before closing F1

- Every inventory row has implemented request-owned receipt composition and production-callsite census evidence.
- Real restricted LOGIN installation, resolver and mutation tests pass, including meaningful bootstrap overlap, commit/rollback, both revocation orders, coordinator loss and same-transaction authority lifetime.
- Actual catalog evidence proves helper owner/search path/grants, mandatory guards, RLS and no raw auth/epoch privilege expansion.
- Empty/wrong/stale epochs, wrong database/branch/clock identity and old application configuration fail closed; approved activation advances revision without reviving old authority.
- Same-input legacy account behavior is preserved through the selected transition, and compatible rollback/recovery is rehearsed without bypassing guards.
- Full repository and browser evidence, the exact candidate SHA, independent review and separately authorized release/installation gates are recorded. No isolated SQL pass alone closes BC-M1 or authorizes production.

The preserved independent audit remains authoritative evidence for its reviewed SHA. F1 stays open until these implementation and qualification conditions are met; this plan alone does not change its verdict.
