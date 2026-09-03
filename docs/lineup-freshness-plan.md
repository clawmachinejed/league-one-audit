# Lineup freshness implementation ledger

Approved specification: [62-section final contract](lineup-freshness-approved-contract.md).
This ledger records evidence and implementation resolutions; it does not authorize unrelated changes.

## Baseline (2026-09-03)

- Starting main and origin/main: `0bda56f943928bbf4107c19997f593def8ad08cf`; clean before work.
- Pushed backup: `backup/pre-lineup-freshness-2026-09-03-0bda56f`.
- Production deployment: `AbPGFD71HnmSHatzJAYV1nQ3eKSs`, Ready, same commit.
- Deployment URL: `leagueonefantasy-851yr5ep6-robert-finchums-projects.vercel.app`.
- Vercel project: `league_one_fantasy`; team plan: Pro, confirmed in dashboard.
- Pro supports minute-level cron (official [Vercel documentation](https://vercel.com/docs/cron-jobs/usage-and-pricing), checked 2026-09-03).
- Existing cron: live-projections every minute; maximum duration 60 seconds.
- No environment changes are expected. Observed names only: CRON_SECRET, DATABASE_URL,
  TANK01_API_KEY, ENABLE_EXPERIMENTAL_COREPACK, NEXT_PUBLIC_SITE_NAMW,
  NEXT_PUBLIC_SITE_NAME, ADMIN_KEY, NEXT_PUBLIC_TAGLINE. No values recorded.
- Preview has its own CRON_SECRET/DATABASE_URL entries; do not invoke authenticated preview workers against production.
- Existing environment spelling/legacy entries are unrelated; left unchanged.
- Node 24.19.0 and pnpm 11.19.0 used for verification.
- `pnpm verify`: lint, TypeScript, 51 unit-test files / 602 tests, production build passed.
- Browser suite: 13 passed.
- Isolated Neon suite: 1 file / 18 passed.
- Integration branch: `br-blue-silence-avyruwi0`, database `projection_future_integration`.
  Existing guarded harness verified isolation before resetting only test fixtures.
- Production database baseline used SELECT queries only; no production writes.

### Production snapshot metadata (Week 1, 2026)

| League | Snapshot | Model | Content hash | Published (UTC) | Verified (UTC) |
|---|---|---|---|---|---|
| league1 | 99771117-ec7e-4045-9ffe-950e485e0d5d | clock-v1 | 60284aeb5ecce287222b39788ee8f718c77a768b5f2fa09290b5931da894c426 | 2026-09-03 18:00:22.732369 | 2026-09-03 18:00:19.425 |
| league2 | cc341acb-f2bf-4f92-9ca9-96103ae6a30c | clock-v1 | 501a5760721960506330278f0555d666c81f3db9729c6f76c8771e64565905b6 | 2026-09-03 18:00:22.75997 | 2026-09-03 18:00:19.425 |

Snapshot revisions: league1 `93458f41f30ff9e63f0e77c48ca537109f9d46b544f7be856b6d14fe47ab2835`;
league2 `22164740148accbd9c6668c0e284518620a29265908a32c350bc79be3de7ca94`.
No raw production payloads or manager information are recorded.

### Future refresh baseline

All weeks 2–18 have one shared projection refresh row and two league materialization rows.
All have a last success and zero consecutive failures. Week 2 materialization last succeeded
2026-09-03 18:02 UTC, next due 19:02 UTC. Weeks 3–5 are due the following day;
weeks 6–18 are due September 10. The last initial Week 18 materialization succeeded
2026-09-03 16:57 UTC. Week 1 currently belongs to the current lane; the approved
preseason cutover changes its materialization ownership, not its displayed period.

### Protected public and provider behavior

- Existing current cron response contract remains in projection-http.ts and its tests.
- Full snapshot caches: current 15+30, future 300+300, historical 300+3600 seconds.
- Existing missing snapshot precedence is 404/no-store even if authority is stale.
- Existing malformed/stale/disabled/database-error responses remain 503/no-store.
- Full Sleeper loader: one weekly matchup request, unchanged 60-second website cache
  and uncached worker path. Start/request/parse/completion timestamp order is protected.
- Tank01 feed invocation grouping and cold/warm request behavior remain protected by
  the existing worker/provider tests. New watcher must invoke neither Tank01 feed.

## Readiness resolutions (before affected implementation)

These resolve details required to satisfy the approved safety and compatibility rules.
They are not scoring, visual, provider, or cadence scope additions.

1. **Authoritative shape and identity.** Current durable authority lacks external league
   identity, authoritative roster IDs and expected roster/slot counts. Migration 007 will add nullable metadata,
   populated from the already required league metadata response. Unknown or mismatched
   shape fails closed; bootstrap cannot depend on a prior successful full materialization.
   PR review additionally confirmed that count-only validation is insufficient: a same-sized
   foreign roster set must reject. The canonical shape now requires scoped roster references
   obtained from trusted roster metadata, never inferred from a numeric ID sequence.
2. **Source age.** A new wrapper timestamp around cached provider data does not make the
   source fresh. Operational NFL/league authority must use a fresh shared request or a
   timestamped cached envelope with a maximum 60-second source age. Schedule caches stay unchanged.
3. **Preseason ownership.** The default preseason week is watcher-current but
   future-materialized. Its broad-reconciliation urgency rank is one (not distance zero);
   remaining established future intervals stay unchanged. Scheduled current execution
   cannot also own that materialization. Forced execution must route to its owning lane.
4. **Absolute cadence buckets.** Healthy next-check times use absolute minute/phase
   boundaries. Completion-time-plus-180-seconds can miss a phase and cause six-minute
   gaps. Failure backoff remains separate from healthy phase scheduling.
5. **Atomic publication fence.** Rejecting stale acknowledgment after publication is too
   late. The existing atomic snapshot SQL must validate and lock current authority,
   lifecycle/watch generation and materialization ownership before updating a pointer.
   Authority verification timestamps alone do not increment semantic generation.
6. **Unchanged snapshot lineage.** Immutable snapshots retain their original official
   observation when content is unchanged. A nullable verification-source observation
   pointer on the current snapshot records the new proof atomically with verifiedAt.
   Completion validates this proof; it must not falsify immutable snapshot lineage.
   Retention must preserve observations referenced by that pointer.
7. **Independent generations.** Observation claim generations and lifecycle/materialization
   generations are distinct. An unchanged thin poll must not invalidate useful in-flight
   materialization. A materialization claim records its observed version and lineup revision.
8. **Database time and replay.** Affected refresh leases use database time for ownership.
   Application timestamps remain provenance. Official-observation replay checks nullable
   lineup version/hash equality and rejects contradictory lineage.
9. **Compact/full parity.** One shared structural validation definition drives full JS
   validation and compact SQL structural checks. Compact metadata retains enough date,
   status and kickoff information for the same JS refinements and freshness policy.
   It never returns full teams, players or payloads. Existing unusual coercion and exact
   numeric/date boundaries require characterization before changing the validator.
10. **Missing-first HTTP semantics.** Missing snapshot remains 404; stale authority with
    an existing snapshot remains 503. The compact endpoint mirrors this established order.
11. **Per-league authority.** Future planning partitions healthy leagues by eligible period.
    A stale/missing/different league authority cannot globally stop other healthy leagues.
12. **Browser response identity.** Responses are fenced by requested league, period and
    request sequence, since the unchanged payload does not contain a league identity.
    Route refresh must reconcile new initial props without discarding retained UI state.
13. **Staged activation.** PR2 adds database/backend capability without activating watchers.
    Publication guards are introduced in the single SQL implementation before PR3 callers
    supply mandatory active ownership. No active watch may be bypassed by an unguarded
    publication. Transitional call shapes must be reconciled by the worker cutover.
14. **Durable default-period cadence facts.** The independent future owner needs the
    preseason default's existing seven-day/hourly/live-window rules without fetching
    the NFL calendar again. The authority writer retains compact schedule dates/kickoffs
    and the current-regular-period fact in additive authority metadata. The reader
    exposes these canonical facts; both owners use the same cadence calculation.
    Timing refresh does not alter scoring revisions, snapshot payloads, or ownership
    generations. Authority and lineup shape remain the ownership fence.
15. **Dirty action precedence.** An eligible stored projection slate permits immediate
    dirty-lineup materialization even when a routine provider refresh is due. A missing
    or ineligible slate requires ingestion first. Routine provider work never forces
    an unnecessary Tank01 call ahead of otherwise valid lineup-only recalculation.
16. **Complete-horizon synchronization.** Watch synchronization receives every configured
    week for each healthy league, even from the current owner; a current-only subset
    would incorrectly retire future watches. Unhealthy leagues remain in registry
    membership but do not supply destructive replacement target sets.

## Release checklist

- [x] Stage 0: clean synchronized baseline, pushed backup, deployment/configuration and database metadata, complete existing gates.
- [x] PR1: shared raw parser, scoped identities, lineup-v1, classification, balanced policy, parity tests; no route/cadence change.
- [ ] PR2: migration 007, guarded repository operations, authority batch reader, compact reader/API and full revision protocol.
- [ ] PR3: three-lane cutover, ownership, thin/full deduplication, independent future work, exact HTTP and capacity gates.
- [ ] PR4: current/future revision polling, visibility/race/manual/fallback behavior.
- [ ] PR5: obsolete code reconciliation, runbook, final production evidence and retrospective.

For every PR record: head and merged commit, GitHub checks, actual preview, production
deployment, local/unit/browser/Neon evidence, request counts, deviations and residual risks.
No stage is complete merely because code exists locally.

## PR1 verification record

- Full local verification: 56 files / 697 unit tests passed; lint, TypeScript and build passed.
- Existing isolated Neon suite: 18 passed.
- Browser suite: 12 passed, one existing data-dependent cross-league My Team test skipped
  because live Sleeper manager cards were unavailable. A second run had the same result.
  No assertion failed. This is recorded rather than represented as 13 passes; inspect
  actual preview manager pages and rerun the check before closing the release gate.
- Independent code review found no blocking defect for valid contract inputs.
- GitHub automated review found count-only roster membership insufficient. Corrected before
  merge with required authoritative roster references and both raw/canonical regression tests.
- After that correction, the full local gate passed 702 tests in 56 files and all 13 browser
  tests passed (29.3 seconds), including independent per-league My Team selection.
- Initial head 800a64a: GitHub 697 unit tests and all 13 browser tests passed; Vercel preview
  Cv7yNAN6Cro7cFs1F6zCs1MrYJH6 ready. Both leagues' actual manager and matchup pages rendered.
  Standalone preview Playwright encountered Vercel login protection and was stopped; authenticated
  browser inspection was used without bypassing deployment protection.
- Do not use run-start calculatedAt as authority validation time after a newer database
  authority read; sample the injected clock after reading authority.
- Unpublished null starter arrays require explicit provider-state recognition in the thin
  adapter; they may never produce an accepted complete revision.



PR1 release: https://github.com/clawmachinejed/league-one-audit/pull/164.
Heads `800a64a3c933a7952c5acc91b6f7478ad05acde6` and
`eb9e309bfb3339bf6b6e7401189d9df90eb96a8f`; squash merge
`cbf6de191f301c0c3aab954ede70cf6997a5f3f7`.
Corrected-head GitHub run `33794149694` passed verify and browser-smoke.
Corrected preview `4MKRGeGEWuPayfTJwCKL2ttWqBjk` passed authenticated route inspection.
Production `JBDUFodZ8rqgKo8aAXNZbu5AGpaD` is Ready for the merged commit.
Live League One current matchups and League Two Week 5 both rendered six matchup cards
with projections after deployment. No worker was forced and no production data was
written for verification. Existing naturally updated snapshots remained readable.

## PR2 verification record

- Final local gate: 838 tests in 62 files; lint, TypeScript, architecture and production build passed.
- Isolated Neon: 97 tests in five files passed, including the forced authority-lock/claim
  race, A-B-A pending state, full-source C after claimed B, expiration, lifecycle fencing,
  exact verification lineage, permissions, and shared full/compact SQL parity.
- Browser regression: all 13 tests passed (30.4 seconds). No UI or browser cadence changed.
- Store SQL audit now covers 51 distinct operations. Publication retains original parameters
  1-12 and appends its fence at 13; official observation retains original 1-12 and appends
  nullable lineup version/hash at 13-14. Authority appends one metadata JSON parameter.
- Migrations 001-006 and package dependencies are unchanged.
- Production migration 007 applied through a single guarded owner transaction. The database
  verified the exact SQL checksum and all six prior migration checksums before executing.
  Checksum: `1a92f9517294fe289bd25d74923dd042d0cb394d143b5c89d33ed017963c3e47`.
  Only the new table received SELECT/INSERT/UPDATE for the existing runtime role; existing
  table grants, credentials and Vercel environment settings were not changed.
- An initial release safety review used the earlier refactor's no-migration restriction.
  It accepted the same action after checking this contract's explicit PR2 migration and
  Section 20 permission requirements. No alternate execution path or bypass was used.

- Automated PR review identified a delayed-content publication after a newer unchanged
  verification. Corrected the atomic pointer update so a changed snapshot replaces both
  verification source and time; same-snapshot verification remains monotonic. The real
  Neon A-B-A/delayed-B test proves exact acknowledgment and reopening pending A.
- Corrected-head local verification remains 838 tests / 62 files; isolated Neon 97 passed.

## Deferred work

Real-game transitions, provider delays and end-to-end freshness require live operational
verification. Synthetic 50/300-league tests demonstrate bounded work/backlog, not production
capacity. Distributed tasks/queues, database league registry and increased concurrency remain
outside scope. No test branch will be deleted until its evidence and identity are verified.
