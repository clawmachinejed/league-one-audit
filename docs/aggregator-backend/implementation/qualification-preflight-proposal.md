# BC-M1 test-only qualification preparation

Status: authored source and offline checks only; no credential use, connection,
SQL, provisioning, workflow dispatch or qualification publication is authorized
or recorded here. Freeze the exact full candidate SHA and independently review
the complete execution chain before requesting execution approval. This proposal
does not supersede the existing integration harness safety rules.

**Current source blocker:** the latest-schema setup installs037 but the retained
foundation SQL oracle still expects duplicate legacy active associations. Both
independent reviews of `a4b0f5274a3886db7a50f20377e5911dfef6a28c` confirmed this
contradiction without SQL execution. First reconcile explicit pre037/post037
transition stages and compatible callers while preserving the legacy assertion
and D03 exclusivity. No qualification dispatch or spending request is ready on
this candidate. The commands and scope below are prepared prerequisites, not an
approval. Passing SQL is required afterward for acceptance, not before the first
experiment; removing this known source contradiction is a prerequisite.

## Prepared transition rehearsal

The existing integration global setup now invokes
`apps/site/integration/account-transition-rehearsal.ts` through the same guarded
disposable child before the ordinary latest-schema preparation. It does not add
a queue, workflow, provisioner or alternate reset mechanism. Preparation through
033 and the subsequent full preparation retain the harness's sentinel, URL/TLS,
denylist, ownership and actual role guards. The rehearsal requires the temporary
actual account LOGIN credential, not owner `SET ROLE`.

The authored schedule covers:

1. A real legacy account LOGIN resolving an actor before 034.
2. Real 034 DDL followed by an injected interruption before 035, with atomic
   rollback and no transition ledger/schema remnants.
3. Destruction of the installer connection during the transaction, followed by
   another owner connection reconciling release of the authority gate and the
   absent ledger/catalog. No reconnect-and-resume occurs in the installer.
4. Two lost-COMMIT-acknowledgement simulations against real SQL: one deliberately
   rolls back before losing the acknowledgement; the other really commits before
   throwing away the acknowledgement. Both must report unknown, without retries.
5. Exact applied/absent ledger reconciliation, an explicit idempotent owner
   invocation after reconciliation, and proof that installation did not seed an
   admission epoch.
6. Existing grant manifests, owner-only epoch activation, rejection of the old
   receiptless LOGIN caller, and the new restricted LOGIN preserving the same
   actor ID.
7. The actual current Neon account transport and store resolving, returning a
   final read with authority timing, applying a CAS-protected profile mutation,
   and denying final reads after session expiry.

`account-transition-rehearsal.json` is separate setup evidence, not an extra
Vitest test count. A failing stage emits only completed stage names and denies
normal suite startup. All cases remain **unexecuted SQL** until a separately
authorized run. The synthetic acknowledgement fault does not prove a real
network lost-ack schedule. An actual service-boundary drain, old/new deployed
HTTP artifacts, interrupted deployment, and compatible application recovery are
still separate release rehearsal obligations; passing this database schedule
alone cannot close F1 or authorize reopening private traffic.

## Prepared parent inspection command

`apps/site/scripts/run-qualification-parent-preflight.ts` is deliberately absent
from ordinary verification and qualification workflows. Under a separate exact
SHA approval it can be invoked from `apps/site` with the already installed
runtime:

```text
node --conditions=react-server --import tsx scripts/run-qualification-parent-preflight.ts <reviewed-nonsecret-approval.json>
```

Its explicit authorization value is
`I_AUTHORIZE_ONE_READ_ONLY_TEST_PARENT_PREFLIGHT`. The approval binds the clean
reviewed SHA, reviewed credential-provenance and parent-quiescence evidence
hashes, complete expected non-template database names, exact global role
attributes and role memberships. Those evidence hashes are references for human
review, not automatic proof of the underlying facts. Supply `NEON_TEST_API_KEY`
only through the approved protected execution environment; do not paste it into
the approval file, command line, logs or chat. No `.env` file is loaded.

The command permits only the fixed test project `steep-glitter-44680287`, parent
`br-plain-bread-b7sgfdl8`, and one existing direct endpoint already fixed at
0.25 CU with five-minute suspension. It makes GET-only requests through the
existing Neon API client, checks API database inventory and owner names, and
obtains an in-memory owner URI only after these guards. A mismatched endpoint,
URL, role, TLS parameter or database denies connection. It never provisions an
endpoint, rotates credentials, writes a sentinel, resets a schema or creates a
child.

It inspects every API-listed database plus connectable `template1`, in read-only
transactions with a `pg_catalog` search path. Each connection checks immutable
server project/branch settings, actual owner LOGIN, TLS, whole-branch database
inventory, exact global role attributes/memberships and absence of other client
sessions. Catalog-only counts must show no custom schemas, public relations,
functions or types, extra extensions, large objects, foreign servers,
publications, subscriptions, event triggers or default ACLs. No application rows
are read. A non-connectable application database fails closed. The command does
not enable connections to `template0`; its uninspected platform-template status
is explicitly recorded and needs trusted platform-baseline evidence if a
whole-parent claim relies on it. No opaque schema/API preview substitutes for
these checks.

The local command exits by ten minutes, uses no automatic retry and has bounded
connection/query timeouts. It rechecks API inventory and parent identity at the
end and emits sanitized counts/identities only. It cannot establish an exclusive
service boundary against a concurrent privileged writer; a reviewed quiescence
window covering inspection through child creation remains mandatory. A receipt
therefore says `qualification: unverified`, `parentRaceExcluded: false` and
`credentialBindingProvenByThisCommand: false`. These are deliberate limits, not
claims that successful catalog queries qualified the SQL test suite.

## Saved-key authority and smallest remaining approval

The documented [Neon authentication-details endpoint](https://api-docs.neon.tech/reference/getauthdetails)
describes credential type and associated identity. A successful test-project GET
does not establish that the credential lacks authority elsewhere. Likewise,
[GitHub environment-secret metadata](https://docs.github.com/en/rest/actions/secrets#get-an-environment-secret)
does not disclose the stored value. Matching key names, last-used times or one
visible project cannot bind that stored secret to a project-scoped key.

First seek a trusted creation/storage provenance receipt tying the specific
protected environment secret to the intended project-scoped key and current
secret version. If unavailable, the smallest corrective human action needs
explicit authorization to create one dedicated project-scoped key and store it
directly as environment `integration-test` secret `NEON_TEST_API_KEY`, recording
non-secret creation/storage metadata. Credential creation/replacement, retrieval
or rotation is not authorized by the current implementation request. Do not
silently try another key or retrieve a secret to compare it.

Then request **one separately bounded parent inspection** against the exact
reviewed SHA and identities above, including protected key use, in-memory owner
credential retrieval and read-only catalog connections that may wake compute.
The approval must acknowledge the external quiescence requirement and any
platform-template limitation. No qualification run is dispatched by that
approval.

After those prerequisites and independent source review pass, request **exactly
one existing disposable qualification invocation** of that reviewed full SHA:
the same project/parent, one uniquely journaled child, fixed 0.25 CU, 30 minutes
work plus ten minutes teardown within a 40-minute local lifecycle, no automatic
retries, temporary credential revocation, verified child closure and deletion.
The one-hour branch expiry is fallback only. Preserve unresolved-resource
receipts if deletion or revocation cannot be verified. Do not publish a
qualification-trigger ref before this explicit approval.

The real transition fixtures need to exist and receive independent review before
authorizing this experiment. Their **passing real results are required for
acceptance afterward**, not as a circular prerequisite to authorizing the run
that obtains them.

## Cost bounds and limitations

Official [Neon compute pricing](https://neon.com/blog/major-compute-price-reduction-on-neon)
checked on 2026-10-06 states $0.106/CU-hour for Launch and $0.222/CU-hour for
Scale. Fresh authenticated Console inspection on October 6 placed the exact test
project in `org-round-wildflower-31158557`, whose billing page shows Launch,
managed by Vercel, for October 1–November 1. It lists ten included branches per
project, 500 GB transfer, $0.35/GB-month storage and $0.20/GB-month instant restore.
The page did not expose a compute unit rate or prove a hard spending cap. The
compute rates below remain published reference rates, not verification of this
account's complete contract, credits or invoice. At those rates, 0.25 CU continuously active for 40
minutes is approximately **$0.0177 Launch / $0.0370 Scale compute**. A ten-minute
parent inspection is approximately **$0.0044 / $0.0093 compute**, before idle
suspension time. Confirm any differing Vercel-managed rate and additional
applicable charges before requesting a monetary approval.

These estimates exclude additional parent wake/idle time, storage, transfer,
branch charges, GitHub runner usage, minimums, taxes and unresolved resources.
The existing provider endpoint's five-minute idle suspension can add compute
after local inspection ends. A 40-minute local timeout and 0.25-CU endpoint do
not cap total cloud spend: host loss, active connections, API outages and delayed
deletion can outlive them. No total-dollar ceiling is proven. The approval must
state that limitation, an operator cleanup responsibility and a separately
authorized escalation if the recorded child survives. Expiry never establishes
successful cleanup.
