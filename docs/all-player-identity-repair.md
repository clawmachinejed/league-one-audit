# All-player identity correction and recovery

This procedure is prepared work. It does not authorize execution or certify that
the deployed pairing, reference counts, or capacity still match the audit.

The shared boundary retains the provider's explicit native crosswalk as source
evidence and validates the exact official identity against the shared catalog.
Names, current teams and positions do not create a new identity. Legitimate
football metadata transitions keep their existing identity, while incompatible
current projection metadata cannot supply a scored candidate. The official
fantasy memberships determine the representative stored role, including the
eight captured FB-related players. Multiple memberships remain one identity;
the representative role introduces no ranking rule. Identical duplicate catalog
memberships are accepted; conflicting members and key/player-ID mismatches fail.

Catalog membership is not independent proof of every provider crosswalk. Native
crosswalk assertions remain attributable source evidence; conflicting assertions
require review, and database `verified` flags cannot override that review. The
known Tank01 4429835 / Sleeper 8063 pairing is quarantined in the shared worker
boundary before proposals, coverage, or candidate generation. Sleeper 8063 is
George Silvanic, DT/DL. The apparent intended George Holani / Sleeper 12048 is
not an authorized replacement. The source slate and old candidates are retained.

Required official roster, starter and canonical defense identities remain strict.
Optional projection aliases outside validated inventory are unresolved; they
cannot manufacture new official identities or veto unrelated official raw
statistics. Missing, retired, unverified, expired, wrong-kind and conflicting
optional aliases make their projection coverage unresolved even if another
reference maps. Mapping validity uses its effective interval: a future expiry is
valid until that time, a future start is not yet valid, and an expired or retired
mapping is unusable. Distinct inputs cannot silently collapse to one canonical
target. The same existing writer checks these conditions before ancillary writes
and again in its post-conflict resolution snapshot.

## Reviewed correction

The prepared SQL is `apps/site/release/retire-4429835-8063.sql`. It retires only
Tank01/player/4429835's false attachment to canonical entity
`10ae356b-990f-5ed1-8b31-2fd98dd5acbd`, setting `mapping_status=retired` and
`valid_to` to the transaction time. The official Sleeper/8063 anchor, entity
metadata, unrelated 12048 mapping, immutable slate, existing candidates,
baselines, observations, scores and pointers are preserved. Retaining the
official anchor is not evidence that the cross-provider pairing was correct.

Before execution:

The coordinating task's read-only production check at
`2026-09-12T16:46:52.885820Z` still found the exact false pairing verified with no
expiry and no Sleeper/12048 mapping. It found **eight** candidate references,
zero baselines, zero official player-point rows and zero all-player scores.
The audit's four candidates are therefore stale evidence. Eight is also a
timestamped observation, not a script default: recount and review the physical
references again immediately before the correction transaction.

1. Record matching local/GitHub main, canonical Vercel repository/root/main,
   exact merged production SHA, Neon project/main branch/database/owner role,
   installed migration checksums and both league reader health.
2. Deploy the reviewed shared quarantine and mapping-validity guards before
   retiring data. Keep all-player recurrence disabled. Confirm no old worker
   invocation can publish and no competing owner observed from branches, PRs,
   deployments, cron activity and live leases. Do not modify cron schedules.
3. Recount every candidate, frozen baseline, official point and all-player score
   referencing the canonical entity. The audit's four/zero/zero counts are
   historical. Retain exact alias/entity rows and row digests, reference counts,
   time, code SHA, operator identity and SQL checksum in the release evidence.
   Any baseline/official point/all-player score reference requires new review.
4. The reviewed owner session must begin a transaction and set transaction-local
   `league_one.alias_repair_authorization` to
   `retire-tank01-4429835-sleeper-8063`,
   `league_one.alias_repair_expected_candidates` to the freshly reviewed count,
   and `league_one.alias_repair_application_sha` to the verified deployed SHA.
   These are non-secret bounded inputs, not service-identity substitutes.

The SQL takes the existing migration advisory lock and short-lived write locks
on the existing job, mapping, entity and referenced child tables. This prevents
new claims/references from racing the recount and retirement. A busy lock, live
projection lease, changed target/kind/status/reference count or unexpected
historical reference aborts the transaction. Do not retry blindly. It modifies
no installed migration or checksum. An already retired matching relationship
returns an explicit idempotent marker without changing its original end time.

Capture the before/after rows and transaction identifier. Commit only after the
exact `ALL_PLAYER_ALIAS_RETIREMENT_APPLIED` or
`ALL_PLAYER_ALIAS_RETIREMENT_ALREADY_APPLIED` marker and expected delta. Verify
the after-state in a fresh read after commit and retain the result with the
reviewed SQL checksum and final Git SHA. This retained release record is the
correction audit trail; no new database audit subsystem is introduced. A lost
or ambiguous response requires read-only state reconciliation before any retry.

## Compensating recovery

On any failed precondition, roll back the uncommitted transaction. After a
committed retirement, the safe compensation is to keep the quarantine and
retirement, stop recurring ingestion, preserve current verified pointers and
history, and deploy compatible guarded code. Do not restore a known wrong
`verified` relationship merely to reverse a deployment. An older unguarded
worker may not resume until its alias attachment/publication paths are proven
unable to use this retired relationship.

If independent reviewed identity evidence later proves a legitimate replacement,
prepare a separately reviewed forward correction with exact before/after state,
references, ownership and permissions. It must not rewrite old source slates or
candidates. If review overturns the original finding, restoring the saved alias
state requires explicit data authority and the same locks, fresh reference
review, full shadow and parity gates. There is no automatic destructive down
migration or guessed reassignment to Sleeper 12048.
