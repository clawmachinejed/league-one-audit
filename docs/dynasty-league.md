# Dynasty League

Dynasty League uses Sleeper league `1312138224994385920`, public key `dynasty`, and route prefix `/dynasty`. The source IDs remain strings in the existing canonical registry. The shared UI, loaders, readers, scoring pipeline and scheduled workers serve all three leagues. League One and League Two keep their existing paths, data scopes and saved My Team choices.

## Source and presentation

The sanitized settings fixture records the public Sleeper metadata observed on September 16, 2026, including request source and observation time. It is regression evidence, not a replacement for live settings. The observed league has 10 rosters and eight starting slots: QB, RB, WR, WR, TE, FLEX, FLEX and SUPER_FLEX. It has twelve bench slots, plus reserve/taxi settings. Existing roster normalization and exact-week rules remain authoritative.

The league avatar is Sleeper `d0aa2176f42972427d65e5c4e0ad1470`, downloaded unchanged from `https://sleepercdn.com/avatars/d0aa2176f42972427d65e5c4e0ad1470`. The 400×400 PNG is stored at `public/dynasty-logo-d0aa2176.png`, SHA-256 `8a6a615b5d68e9287f8fa6dec9900a50e00c2ca30f5d597a07ffcf338356aff6`. Headers, selector, browser icon and Apple touch icon use the same asset.

My Team, Schedule, Matchups, Standings, projected standings, Waivers, Transactions, Rosters, Managers and manager profiles reuse their existing shared components. My Team selection remains keyed by the opaque Sleeper league ID. Schedule retains the requested Weeks 1–15 policy. All four player surfaces share one slot presentation: FLEX displays **WRT**, SUPER_FLEX displays a two-by-two **WR / TQ**, WRRB_FLEX displays **WR / RB**, and REC_FLEX displays **WR / TE**. The label comes from the league's official roster slot rather than the player's NFL position or a league-specific override. Accessible names spell out the eligible positions; ordinary, bench and unknown slots keep their existing labels. The raw `SUPER_FLEX` slot remains unchanged for lineup matching, revision hashes and scoring.

## Scoring and data isolation

Sleeper supplies official points and each league's raw scoring settings. Dynasty gets its own registered scoring profile and hash; it never borrows League One's stored rules. In the captured settings, active offensive rules match League One/Two (half PPR, six-point passing touchdowns, native forty-yard touchdown bonuses), while Dynasty's defense and kicker rules are zero and those slots are absent. These are observed settings, not hardcoded application rules.

The existing single scorer applies supported Tank01 statistics to each distinct projection profile. Existing projection bonus limitations stay explicit in provenance; the application does not invent long-touchdown projection counts. Official actual points remain Sleeper's. Actual player statistics use Sleeper's native bonus keys through the existing sparse scorer and parity gates.

League One and Two currently share one raw profile; Dynasty is distinct. A shared provider slate therefore yields two cached scoring calculations. Complete all-player publication requires the complete coordinated profile group and every configured league's official parity evidence. Unavailable official starters, identity conflict, unsupported active rules or missing parity continue to block complete all-player publication. An unavailable team projection remains isolated under the existing team-local policy; adding Dynasty does not relax that separate contract.

The all-player operation and cadence selector validate the configured league inventory instead of requiring exactly two leagues. Missing, duplicated, unexpected or mismatched authority/identity remains invalid. One weekly-stat request serves the configured leagues. Existing stored raw observations can be scored for Dynasty once its live scoring profile is registered by the existing worker; no historical points or frozen baselines are fabricated.

## Capacity and onboarding

Three leagues require at most 20 nominal lineup observation requests per minute in Week 1, and 19 in Week 2, within the unchanged limit of 20. Projection/statistics retrieval remains shared by provider period. No new cron route, schedule, provider connection, retention policy or concurrency increase is added.

Additive migration `015_all_player_dynasty_publication.sql` extends the existing readiness and fenced publication checks to the canonical three-league set. Installed migrations 001–014 remain unchanged. The two original league seasons are always required; Dynasty becomes required for an exact season when its league-season record is registered. The complete profile group and each profile's official parity evidence use that same set. A publication transaction locks league-season registration so enrollment cannot race a two-league publication. The existing fenced entry point, lease expiry checks, immutable tables, grants and atomic pointer publication remain in place.

A distinct profile adds projection candidate and score storage, and another league adds official observations and snapshots. This implementation does not equate serialized fixture size with physical database growth. No new physical season-fit or live throughput claim is made. Check natural worker durations, capacity outcomes and database headroom during release; do not force an ingestion merely to obtain evidence.

Before release, revalidate main, repository/root binding, exact production SHA and no competing owner observed. Run full verification, independent review and the actual preview. Preview persistence remains disabled and cannot prove production snapshots or metrics.

Install migration 015 through the reviewed release wrapper before deploying the new application. Before Dynasty enrollment, the old application remains compatible. After enrollment, an old two-league complete-publication attempt fails closed; do not deploy the application first or assume a code-only rollback will restore ingestion. Stop the recurring lane and drain or invalidate live job ownership for the migration window, then restore the existing configuration after compatible code is ready. The release wrapper verifies database/owner identity, PostgreSQL 18, the exact installed ledger and catalog, restricted permissions, absence of an active ingestion owner, unchanged history counts and the final success sentinel. An ambiguous response requires read-only verification, not a blind retry.

The independently reviewed PostgreSQL 18 capture is `apps/site/release/015-catalog.integration.json` (observed `2026-09-16T04:19:09.834Z`). It retains the exact tables, triggers and constraints and changes only two of 24 function bodies. The isolated release-wrapper test committed successfully and also proved complete catalog/ledger rollback for a corrupt constraint manifest.

- Normalized migration SHA-256: `f7bf9b74cc14c0ede7a7534257ea956f99edc2615983b5b66ae546f2812fef8a`.
- Rendered production wrapper: `apps/site/release/015_all_player_dynasty_publication.production.sql`, SHA-256 `5a853f19d220dbabe9c15494035b713aa352ef87a1d7c3db481564471459f31c`.
- Success sentinel: `ALL_PLAYER_DYNASTY_APPLIED:015_all_player_dynasty_publication.sql:f7bf9b74cc14c0ede7a7534257ea956f99edc2615983b5b66ae546f2812fef8a`.
- Regenerate without connecting to a database: `node apps/site/scripts/render-all-player-production-migration-wrapper.mjs --dynasty`.
- Guarded isolated wrapper check: `pnpm --filter @l1/site test:migration-wrapper:integration --dynasty`. A recapture resets `reviewed` to false and needs independent review again.

Read-only production preflight at `2026-09-16T04:20:55.529651Z` confirmed project `solitary-base-99261075`, main branch `br-rapid-boat-avgeevye`, database `neondb`, role `neondb_owner`, PostgreSQL `180006`, exact installed migrations 001–014, two original league seasons sharing profile `ffe5ecf4-ddfe-4ebf-b176-180520020540`, and no active job leases at that instant. Physical database size was 398,557,184 bytes. This is an identity/size observation, not a current capacity allowance or proof that migration 015 is deployed. Recheck before execution.

After the authorized migration and code release:

1. Verify the exact merged SHA is Production / Ready and all three route families use their intended league identity and icon.
2. Let the existing current worker register Dynasty's league season and raw scoring profile and synchronize authority/watch rows. Let the existing current/future lanes populate snapshots within normal scheduling and budgets.
3. Check Dynasty and existing leagues' compact/full readers, exact-week behavior, saved team isolation, official scores, projected standings, roster metrics and box-score availability. Record unavailable source data honestly; do not fill missing results with zero.
4. Observe naturally scheduled current, future and lineup-observation outcomes, including per-league success/failure, request sharing, capacity and duration. The all-player lane retains its existing hourly eligibility and cooldown and may report not-due or source incompleteness.
5. Record tests, preview, merge, deployment and live data readiness separately. A Ready application deployment alone does not prove Dynasty's first stored snapshot or scoring-profile registration.

Dynasty's observed playoff start differs from the original leagues. If Sleeper later supplies different active/completed lifecycle states, the shared all-player selector currently fails closed rather than combining incompatible periods. The source's actual transition timing has not been observed. This release does not claim that future mixed-lifecycle ingestion has been proven; watch those durable outcomes at the transition.

Rollback first stops recurrence and prevents stale publication by draining or invalidating existing job ownership. Preserve all created league/profile records, official observations, snapshots, pointers and immutable history. Before enrollment, an application revert can retain migration 015. After enrollment, restoring the two-league application requires a reviewed forward compensation that restores the readiness and publication function bodies from migration 011, under the same ownership and catalog checks; do not alter installed migration checksums or remove Dynasty's records. The prepared [compensation package](../apps/site/release/dynasty-compensation/015-dynasty-compensation-runbook.md) includes exact SQL, checksums, independent review and guarded isolated success/rollback evidence. It is outside the migration directory and is not installed during this release. At rollback, add its forward 016 ledger entry through the normal reviewed process, or renumber after review if 016 has since been used. Verify the original readers and existing history before restoring recurrence. Normal registry reconciliation retires obsolete watch targets. No table drop, pointer rewrite, alias edit or destructive cleanup is part of rollback.
