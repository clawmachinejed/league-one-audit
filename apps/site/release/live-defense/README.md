# Shared live D/ST weekly-statistics release

Migration `019_live_defense_weekly_statistics.sql` extends the existing global
Sleeper all-player job. It adds no table, connection, provider endpoint or cron.
Installed migrations 001-018 remain unchanged. Installation alone does not
activate or establish successful live D/ST calculations.

## Request and history policy

Every actual bulk weekly request, whether live, recurring or operator, needs the
same global lease and a one-use request reservation. Successful reservations are
at least 60 seconds apart. This implies at most 1,440 starts in any rolling
24-hour interval without storing a growing per-minute timestamp array. The
first post-upgrade reservation honors the latest legacy hourly reservation.
A provider failure retains its consumed request opportunity. One exact period
belongs to each claim.

Live requests additionally require fresh stored current-period authority and a
latest canonical Tank01 game observation showing a live game within 90 seconds.
Receipt and game timestamps allow at most 30 seconds of forward clock skew,
matching the existing authority tolerance. Cross-host millisecond timestamps
do not prove request ordering: the current marked generation and the runtime
awaiting that reservation before its GET establish ownership and sequence.
Both acquisition and reservation verify those facts. When an hourly collection
slot is due, minutes zero and one are reserved for the existing hourly operation,
including its finite previous-week correction selection. A late request at
minute 59 may delay minute zero, but it cannot consume the protected minute-one
opportunity. No additional historical polling is introduced.

Full all-player raw/stat/score history retains its existing one-capture-per-hour,
13-capture-per-rolling-day, noon-through-midnight Eastern policy. A live-only
lease cannot pass the all-player writer fence or its durable completion method.
Live outcomes use separate bounded job metadata; they never replace the stored
all-player period history or final-capture evidence.

Within an invocation, a successful bulk response can be reused by a due hourly
capture of the exact same period. A bounded durable receipt binds its period,
source revision, body hash, source times and original request generation. The
hourly operation takes its own lease, validates the receipt again, and reserves
its hourly history slot without reserving a second network request. The complete
bulk response remains in memory; it is not stored every minute. A missing,
changed, stale, or different-period receipt cannot bypass the provider budget.

## Compatible installation and verification

1. Revalidate canonical repository, main, Vercel binding/root/production branch,
   exact deployed SHA, Neon project/branch/database/role and release ownership.
   Record no competing owner observed only when supported by current evidence.
2. Run the guarded isolated Neon suite and the dedicated wrapper capture using
   the already authorized `projection_refactor_test` environment. The scripts
   independently enforce identity, sentinel, TLS, role and production denylist
   protections. Never run them on production and never run two reset suites at
   once.
3. Run `node --env-file=.env.integration.local --import tsx
   scripts/run-live-defense-release-wrapper-integration.mjs` from `apps/site`.
   It captures PostgreSQL **180006** before/after catalogs, definitions and the
   unchanged physical-table/constraint inventory; exercises the actual wrapper,
   corrupt-manifest rollback, stale same-session sentinel and installed replay
   refusal. Its captured manifest starts with `reviewed: false`.
4. Independently review the SQL, exact catalog differences and test evidence.
   The authorized renderer requires the reviewed manifest and exact migration
   checksum. `node scripts/render-live-defense-release-wrapper.mjs --review`
   produces a comments-only artifact for review; it cannot install anything.
   After review, render the executable wrapper without `--review`.
5. Within release authority, wait for existing live job/worker leases to finish
   and install the rendered wrapper **before** deploying the new application.
   The wrapper requires the exact 001-018 ledger and current owner, locks the
   established ownership tables, refuses active owners and unexpected catalogs,
   applies 019 transactionally, verifies all existing physical row counts and
   protections, and emits its exact commit sentinel only on success.
6. Verify the exact merged application SHA reaches production, ordinary readers
   remain healthy in all leagues, and the naturally scheduled live worker uses
   one shared request with fresh defense evidence. Verify the next request is
   bounded, live-only receipts do not append all-player history, hourly capture
   and previous-week selection remain intact, and failures preserve their
   consumed opportunity. A preview without persistence cannot prove SQL or
   live-provider operation.

The legacy claim and mark signatures, hourly outcomes, stored immutable content,
public readers and publication path remain compatible after installing 019.
The new internal helpers are owner-only; runtime grants cover only the existing
and explicitly added fenced entry points.

## Rollback and recovery

Deploy the prior compatible application to stop live D/ST capture and restore
its prior calculation behavior. Keep migration 019 installed: the old application
uses its preserved hourly signatures and the global spacing has no effect on a
normal hourly request. Do not drop functions, edit installed migration checksums,
erase request reservations, reset leases, delete raw history or move pointers.
Let current leases expire normally so a stale worker cannot complete under lost
ownership. Preserve successful snapshots and all-player final-capture evidence.

If a wrapper reports no exact success sentinel, inspect its migration ledger and
catalog rather than retrying blindly. The wrapper is transactional and explicitly
refuses an already installed migration. Any later compensating schema change
must be reviewed as a new additive migration; a destructive down-migration is
not the rollback procedure.

## Evidence status

The scripts and tests are implementation deliverables. The generated
`catalog.integration.json`, `catalog-definitions.integration.json` and
`wrapper-verification.integration.json` establish actual isolated database and
wrapper evidence only after the guarded run succeeds. Production migration,
exact deployment and a naturally scheduled successful live request must be
recorded separately by the release owner.
