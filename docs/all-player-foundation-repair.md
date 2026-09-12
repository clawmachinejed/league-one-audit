# Complete all-player foundation repair record

This record tracks the coordinated September 12, 2026 repair. It is not release
authorization. Local implementation, isolated SQL evidence, PR publication,
preview, merge, production deployment, Week 1 backfill and recurring activation
are separate milestones.

## Starting evidence

The dedicated branch is `codex/complete-all-player-foundation-repair`, based on
`5d84582475780164853104fab75ddc9e9d0e64f2`. The clean primary main checkout, freshly
read protected GitHub main and Vercel production all agreed on that exact SHA.
The canonical remote is `clawmachinejed/league-one-audit`. Vercel project
`league_one_fantasy` uses that repository, production branch main, root apps/site,
Node 24, and includes files outside the root. Production deployment
`6jYtjqLTUQ41PLtBRpzYuvEuQRJu` was Ready at the recheck.

The authenticated Neon console identified project `solitary-base-99261075`,
main branch `br-rapid-boat-avgeevye`, database neondb and role neondb_owner.
Read-only aggregate evidence at 2026-09-12 14:30:27 UTC reported PostgreSQL 18.6,
217,104,384 database bytes, zero rows in all six all-player tables, zero
all-player jobs, zero live projection_jobs leases and zero other active SQL
sessions. This did not independently inspect every lineup lease. Fresh checks
are required before any production mutation.

A second read-only production check at 16:46:52.885820 UTC confirmed the same
project/branch/database/owner and PostgreSQL 18.6, with 217,563,136 physical
database bytes. All six all-player tables and all-player jobs remained empty;
there were no active projection job leases, and additive 011 was not installed.
The false verified Sleeper 8063 / Tank01 4429835 pairing remained on canonical
entity `10ae356b-990f-5ed1-8b31-2fd98dd5acbd`; Sleeper 12048 had no mapping.
Candidate references had grown from the audit's four to eight. Frozen baseline,
official player-point and all-player score references remained zero. The
[sanitized preconditions](../apps/site/release/011-production-preconditions.2026-09-12.json)
record this dated state; the correction must recount and abort on unreviewed
reference changes rather than assuming the earlier count still applies.

No open PR was observed. Accessible worktrees, branches, production deployment,
the three existing every-minute cron attachments and the available job evidence
showed no competing owner observed. This does not claim that no other task or
chat exists. No cron was manually invoked and no Tank01 request was made for
this repair.

At 15:23 UTC, the primary checkout remained clean and GitHub main still matched
the starting SHA; no open PR was returned. Read-only public Week 1 revision
checks at 15:24:02 UTC returned 200/no-store for both leagues, active/default
2026 Week 1, distinct valid revisions, and verifiedAt 15:00:18.077 UTC. These
prove existing compact readers were available before release, not full browser
journeys or successful all-player ingestion. Initial requests without the
required week query correctly returned 400/invalid-week.

At 16:31 UTC, Vercel production still tracked main. Searching both production
Project and Shared variable lists for ALL_PLAYER returned no results. The
application's exact-true recurring flag therefore remains absent in the
inspected configuration. No value was revealed or configuration changed.
At 16:34 UTC, Preview branch tracking was enabled for nonproduction branches,
and searches in both Preview Project and Shared variable lists found no DATABASE
variable. The preview is therefore expected to exercise existing no-database
fallbacks; it cannot prove production persistence.

Six read-only official Sleeper league/roster/matchup requests supplemented
omitted runtime-loader fields in the captured audit package. Every retained
roster/matchup field matched exactly, including lineups and individual points.
League IDs, season, status, scoring rules and roster positions matched. The
later league settings had daily_waivers_hour 7 instead of 5; that difference is
recorded, and original fixtures are unchanged. The separately hashed supplement
adds only league name/count, roster standings metadata and actual matchup IDs.
No weekly-stat or Tank01 request was made. All five real Node runtime/CLI fixture
tests passed after this supplement, with the captured week still partial.

The original audit reviewed the same base revision. Its counts remain historical
unless explicitly recounted here. The shared sanitized fixture directory retains
hashes and provenance rather than credentials or unnecessary manager metadata.

## Finding-to-change and evidence map

| Finding | Coordinated repair | Evidence and remaining gate |
| --- | --- | --- |
| F01 optional alias becomes required | Explicit required/catalog/optional provenance; validate official inventory before proposals; scoped optional diagnostics | Runtime mapping-policy matrix; captured 4429835/8063 case |
| F02 falsely verified identity | Shared quarantine, semantic source classification, stored consistency; narrow retirement SQL with no guessed replacement | Captured 488-row identity replay; identity correction runbook; production correction not executed |
| F03 historical eligibility | Exact-period evidence, null unknowns, no current-status inference | Jones/DeVito, Willis, Brown and Henderson cases; reviewed period inventory still needed |
| F04 incomplete schema/inventory | Full official bulk catalog classification, every response identity retained/classified; independent exact-schedule finality | Actual 301-row response remains expected partial; complete Week 1 evidence missing |
| F05 duplicate canonical targets | Reject before weekly request/shadow success/identity writes; writer independent duplicate checks | Runtime collision tests and isolated SQL cases |
| F06 stale publication | Global live job fence in batch SQL and immediately before coordinated pointers; expiry-aware completion | Isolated expiry/takeover tests required before release |
| F07 partial writer disagreement | Shared pure eligibility validator and faithful raw malformed flags/null counts | Adapter/domain/writer cases; isolated SQL evidence required |
| F08 false successful job outcome | Explicit publication/partial/provider/validation/timeout/lease outcomes; retain confirmed publication if cleanup fails | Runtime outcome regressions; SQL outcome and naturally scheduled evidence required |
| F09 late deterministic failure | Shared batch and official-observation preparers run before ancillary writes | Deliberately reproduced failures now assert zero ancillary writes; database races tested separately |
| F10 catalog duplicates/mapping severity | Deterministic identical/conflicting duplicate policy, key validation, mapping intervals and required/optional provenance | Real duplicate memberships; status/expiry/kind/collision matrix |
| F11 expiry/sealed child boundary | Additive 011 mapping and child insertion guards; installed 010 untouched | Direct valid INSERT, exact replay, permissions and PostgreSQL 18 wrapper tests required |
| F12 growth/polling | Semantic score reuse plus immutable per-retrieval verification lineage; 15-minute opportunity gate | Physical growth and outbound measurements required; no season-fit claim yet |
| F13 global cadence/deadline | One global request claim, 12-hour minimum/two per rolling day, finite corrections, retained overdue obligations and invocation deadline | Rollover regression; isolated concurrency/expiry proof; scheduled observation still missing |
| F14 generic/late preflight | Early profile/rule/official readiness, actionable stage and scoped diagnostics; one shared substantive preflight | Runtime/CLI fixtures and complete verification required |
| F15 FB identities | Preserve all eight observed FB-related official fantasy identities and existing scoped coverage | Captured projection/catalog regression; no ranking feature added |

## Source and shadow decisions

The captured package produces 4,385 conservative inventory entries, including
all 32 canonical defenses, 4,320 unknown
eligibility entries, 201 unclassified weekly identities and 14 nonfinal scheduled
games. These are replay results, not a fresh live Week 1 completion check. The
49 matching arithmetic comparisons cover 25 players and are only subset proof.
The full unfiltered current catalog resolves response classification; it cannot
establish historical period membership or participation.

The separately captured official catalog was checked offline at 18:33:54 UTC:
all 12,227 rows passed the real catalog projector with zero malformed identities,
and 4,356 had official fantasy membership. That is a net three more than the
earlier catalog, not evidence of historical Week 1 membership. All 201 previously
unclassified weekly IDs have explicit nonfantasy official roles. The supplemented
replay therefore retains 205 excluded response rows including four TEAM
aggregates, zero unclassified response IDs, the same 4,385 conservative entries,
and the same partial result. Original source files and the original incomplete
fixture assertions remain intact. Null-role rows are not treated as positive
out-of-scope evidence for weekly-response exclusion.

The smallest proposed source addition is a reviewed immutable exact-week
inventory and participation manifest using official period roster and gamebook
evidence. It must retain source links/hashes, observation times, effective period,
period team/role evidence and a reproducible reason for every scope exclusion.
Required identities and all 32 defenses cannot be excluded to hide unknowns.
This introduces manual recurring review and no paid service by itself. An
unattended authoritative source would require separate source/cost evaluation.
No current dataset is represented as satisfying this requirement.

Strictly read-only live shadow and a durable global request budget cannot be
satisfied by repeatedly reading a reusable reservation. The unsafe reservation
path is closed. Replay can exercise read-only shadow; a live request requires a
reviewed procedure that either captures once through the budgeted operator or
explicitly permits only lease/request-budget bookkeeping. The user's policy
selection is pending; live production shadow currently fails closed before
source retrieval. This is an explicit implementation/release gate, not success.

## Capacity evidence and limits

Fresh console observations showed a Vercel-managed Free plan, billing window
September 2–October 1, organization usage since September 2, 4.48 GB network
transfer (89.6%), 60.02 CU-hours, 0.42 GB storage and 0.11 GB history. The project
tile showed 241.1 MB and four branches. Metrics may lag an hour. Database physical
size, project tile, branch/history scope and organization aggregate are distinct
measurements; they have not been substituted for each other.

Current published [Neon pricing](https://neon.com/pricing) lists 0.5 GB storage
per Free project and 5 GB monthly network transfer. Neon defines database network
usage as [outbound database responses](https://neon.com/docs/introduction/network-transfer),
including pooled/direct connections and replicas. Current allowance scope must
also be confirmed for this Vercel-managed account before activation.

A refreshed console read at 16:35 UTC showed 60.44 CU-hours, 0.42 GB storage,
0.10 GB history and 4.51 GB network transfer; the project tile showed 241.56 MB.
The account still reported Free, managed by Vercel, with the same September
2–October 1 billing window. These shared-account changes include ordinary
application activity and cannot be attributed to the isolated tests alone.

No physical retained-history projection or ordinary-workload headroom claim is
made until the isolated benchmark and actual account scope are reconciled. Keep
provider response bytes, client-to-database writes, database outbound responses,
physical table/index/TOAST growth and compute separate. Serialized JSON is not
physical storage, and query count is not compute cost. No paid upgrade, deletion
or relaxed history guarantee is authorized.

## Coordinated release sequence

1. Finish exact-head verification, independent identity/eligibility/SQL review,
   guarded isolated PostgreSQL 18 integration and physical capacity evidence.
   Publish one PR and inspect its actual Vercel preview with persistence disabled.
2. Prepare and review additive 011's exact checksummed release wrapper, expected
   catalog/ACL delta, old-application compatibility and non-destructive rollback.
   Keep installed 010 and its checksum unchanged. Prepare the narrow alias
   correction with fresh reference counts and its own exact success marker.
3. Resolve source and shadow policy gates. Establish completed 2026 regular
   Week 1 schedule, inventory, eligibility, both profiles' full roster parity,
   and sustainable headroom. A different week cannot substitute for this target.
4. If production authority remains absent, request one explicit authorization
   for the concrete reviewed code/migration/alias/backfill/activation sequence.
   Revalidate repository, service identity, exact production SHA and ownership
   immediately before any authorized production work.
5. Follow the reviewed compatible installation order with recurrence disabled.
   Verify exact merged SHA in Vercel and both leagues' unchanged reader behavior.
   Apply alias retirement only after the guarded shared worker is deployed and
   old invocations can no longer recreate or use the false relationship.
6. Run the real read-only Week 1 shadow under the selected request policy. Only
   after success run the existing guarded backfill. Verify physical raw/score
   counts, null/eligible/appearance counts, complete profile group, full parity,
   immutable lineage and every coordinated current pointer.
7. Compare actual first-write growth with measurements before enabling the
   existing recurring lane. Observe an actual scheduled successful run and a
   later not-due result, request budget, durable outcome, pointers and both leagues.

On failed safety/capacity checks disable recurrence, prevent stale publication
and retain verified pointers/history. Use the compatible code/config rollback
and reviewed compensating alias procedure. No destructive down-migration,
manual pointer advancement, forced partial publication or blind retry is allowed.

## Evidence status

Independent source reviews are recorded in
[the review record](all-player-foundation-independent-review.md). The supported
Node 24.19.0 / pnpm 11.19.0 complete repository workflow passed on September 12,
2026, ending approximately 18:40 UTC. It passed lint, Next type generation,
TypeScript, 1,641 unit tests in 108 files, the production build, all 39 Chromium
tests and all 200 isolated database tests in 13 files. The only skip was the
existing scoped-IPv6 listener case because this host has no scoped IPv6 interface;
no browser or database case was skipped. The database suite took 252.71 seconds
and included all twelve corrected alias-script cases and the eleven synthetic
capacity scenarios. Its original destructive-test safeguards passed before reset.

The [sanitized complete log](../apps/site/release/011-full-verification.2026-09-12.txt)
retains exact totals. Chromium verified a fresh local production build on port
3047, build `k1K27YwT0nZk4JOuldyRH`, source digest
`a5c481be2126d4741ef75ca63831e624d45b0d156f4878587216cc1856bbe1a2`.
That working-tree run preceded evidence-only provenance/document updates; the
fixture/catalog tests passed another 12/12 after those provenance additions.
The final commit, PR and actual Vercel preview are separate publication evidence.

The first guarded isolated PostgreSQL run passed 164/184 tests, with 20 failures
and one unhandled rejection caused primarily by an untyped SQL parameter.
The second run passed 180/184 with four negative-fixture failures: deliberately
forged parents lacked the new verification lineage required to reach the
intended publication checks. Those tests are being repaired without weakening
their rejection assertions. A later full workflow passed lint, type generation,
TypeScript, 1,613 unit tests (one existing skip) and production build; its outer
package-manager invocation reported the host's older Node/pnpm versions, so
the final supported-Node-24 workflow remains required.

The third development database snapshot passed 190/199 tests. All all-player
statistics cases passed, including raw partial persistence and publication races.
Nine alias-repair negative cases exposed a test harness transaction-pinning
problem, which was corrected without weakening the SQL assertions. All twelve
alias cases then passed in the complete workflow above. The actual additive 011 release wrapper separately passed its
isolated PostgreSQL 18 execution, corrupted-manifest rollback and exact replay
checks at 16:44 UTC. Its normalized migration checksum is
`0eaa96bcc0b65053ac8dab48657eb7bfe22fadbfd41b4f4c78c3472ca8a512b6`.
The captured catalog received independent review before rendering the
identity-bound production wrapper. Rendering is preparation, not installation.

| Milestone | Current status | Missing evidence |
| --- | --- | --- |
| Schema ready | No | Reviewed and verified additive 011 not installed in production |
| Corrected application deployed | No | No authorized merge or production deployment |
| Complete production shadow successful | Blocked | Completed Week 1 evidence, source contract, shadow budget policy and capacity |
| Backfill complete | Blocked | Successful legitimate Week 1 shadow and production data authority |
| Current score pointers published | No | No complete guarded production write |
| Recurring ingestion enabled and verified | Blocked | Successful backfill, demonstrated headroom and actual scheduled evidence |
| Foundation fully operational | No | All preceding milestones must be satisfied |
