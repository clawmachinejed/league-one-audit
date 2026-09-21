# Efficient lineup checks: policy, release and rollback

Implementation scope: reduce repeated checks of distant future starting lineups while preserving active-week freshness and safe bounded progress. This is one coordinated application PR. Production release is not yet authorized or completed. Targeted, full-workflow and isolated verification results remain pending until recorded against the final candidate; this document does not claim passing tests or deployment.

## Healthy observation policy

| Period relative to authoritative active/default week | Thin lineup-check target |
| --- | --- |
| Current active week; preseason default week | 1 minute |
| Next week | 15 minutes |
| Two through four weeks ahead | 60 minutes |
| Five or more weeks ahead | 360 minutes |
| Earlier weeks or completed league | No automatic checks |

The preseason default is a current-class watch owned by future materialization. Distance is measured from accepted period authority, never the newest snapshot or a browser selection. Each target's stable league/provider/season/week identity determines its offset within its interval. Adding another league or temporarily missing authority does not reshuffle existing offsets. Scheduling uses absolute minute buckets.

A future manager edit may remain unseen until that target's next check. Routine full materialization can discover it sooner. Once an accepted lineup changes, the existing pending-work path, stored projection-slate reuse, scoring, immutable snapshots and guarded publication remain in use. The UI still polls stored revisions every minute while visible; browser polling cannot make a not-yet-observed lineup fresh.

This is not a change to projection-feed or full-materialization cadence. Next-week projection ingestion remains every six hours with hourly broad materialization; weeks two through four retain daily preparation; weeks five and later retain weekly preparation. Pending changes and eligible model upgrades keep their existing priorities. The current active-week calculation and healthy observation interval, three cron attachments, provider feeds, scorer, `clock-v1`, frozen baselines, public payloads and UI are unchanged.

## Bounded capacity and honest accounting

The nominal lineup-check allocation remains 20 per minute, shared by active-current work and the observer. Future targets reserve one slot, leaving up to 19 nominal current-class slots. When preseason/default current-class watches also need the observer, active-current admission is capped at 18 so the observer can admit both a default and a future watch under sustained mixed overload. Otherwise the active-current cap is 19. With no future targets, the current-class allowance is 20 and still leaves an observer slot when defaults exist. The observer uses the remaining allocation, with at most 18 future-class checks per invocation; SQL reserves a due future slot even amid a default backlog. If no future row is due, defaults can use that spare slot. Current fleets larger than their admission limit rotate through oldest due work and cannot all receive one-minute checks. Busy claims, backoff and deadlines can leave slots unused.

An exceeded capacity estimate no longer stops the entire fleet. Eligible due rows proceed oldest first with deterministic tie-breaking. Deferred due state remains durable. This prevents a fleet-wide rejection and preserves progress; it does not prove that arbitrary fleet sizes meet the healthy cadence.

For three leagues at Week 2, the healthy nominal average changes from 19 to 3.45 lineup checks per minute:

`3 current + 3 leagues × (1 next-week / 15 + 3 medium / 60 + 12 distant / 360)`.

That is scheduling arithmetic, not measured provider traffic, database transfer, compute usage or billing savings. Offsets may collide; failures and catch-up add requests. Full current loads can substitute for thin observations through existing reservations. Full future-materialization loads and other Sleeper endpoints are not all included in the nominal 20-check accounting. Do not describe it as a complete service-wide HTTP limit.

## Persistence, compatibility and failure behavior

No migration is required. The existing `cadence_policy_version` / `cadencePolicyVersion` field stores `lineup-cadence-v2:<minutes>:<offset>`. Its permitted intervals are 1, 15, 60 and 360, with offset below the interval. The existing phase field remains compatible with legacy rows; it is not the full v2 schedule. Readers continue to recognize legacy `lineup-cadence-v1`.

The existing watch synchronization SQL applies the new policy and fences incompatible ownership by advancing watch generation and invalidating affected claims. Initial v1-to-v2 adoption puts healthy future checks into their new staggered buckets. Later v2 tier changes use the earlier of the existing and newly calculated due time, including promotion toward the active week. A cadence-only change preserves accepted and materialized lineup revisions, pending timestamps and failure retry state. Existing completed/obsolete-watch retirement rules still apply.

Invalid or unavailable observation retry remains 60 seconds for the first current-class failure or 180 seconds for the first future-class failure, then 300, 900 and 3,600 seconds. It does not become 15 minutes, one hour or six hours merely because healthy checks slow down. Healthy complete/not-ready responses clear the failure count and resume the normal tier. Future ingestion/materialization failures retain their separate 5-minute, 15-minute, one-hour and six-hour backoff. No failure clears accepted snapshots or manufactures a successful observation.

## Required verification

Before release, record against the exact final candidate:

- Policy tests for all tiers, stable offsets, absolute buckets, preseason ownership, rollover/promotion, completed silence and invalid policy input.
- Bounded current/future admission, oldest-due fairness, no fleet-wide rejection, missing-authority isolation, preserved backoff and existing full/thin sharing.
- Isolated PostgreSQL proof of initial legacy staggering, v2 promotion, concurrent synchronization/claims, generation fencing, preserved pending lineage, failure retry timing and old-application compatibility. Use only the existing authorized dedicated harness and all its identity/TLS/role/sentinel/denylist guards.
- The complete repository verification workflow, exact totals and skips, plus independent review of scheduling and SQL changes.
- Actual Vercel Preview tied to the candidate SHA, with current/future navigation, expanded lineups, My Team and all three league readers checked. Preview persistence is disabled; this proves presentation and fallback, not database scheduling. Never invoke an authenticated preview worker against production Neon.

Historical contract and release-ledger numbers remain historical evidence. Update the candidate's release record with real results rather than borrowing an earlier test count or treating a preview's unavailable stored projections as a production failure.

## Release procedure

1. Finish implementation, full verification, independent review and the single PR. Prepare concrete results before requesting missing production authority. No new migration, manual watch rewrite, provider sweep or cron change is part of this release.
2. Once production release is authorized, revalidate clean primary main/GitHub main, canonical repository, Vercel repository/root/main binding and exact existing production SHA. Recheck relevant ownership and worker leases; proceed with no competing owner observed. Verify service identity through the established secret-safe checks if database evidence is read.
3. Merge the exact reviewed head through normal protections and verify that Vercel Production runs the exact merged SHA. Confirm the unchanged three cron definitions and healthy stored readers for League One, League Two and Dynasty.
4. Observe natural current and observer invocations. Record period authority, due counts, selected/checked/deferred counts, outcomes, policy fingerprints/offsets, next due times, lease/failure state and request evidence. Confirm current-class watches still use one-minute buckets, future targets use their assigned tiers, completed targets are silent, and excess demand makes bounded progress rather than a fleet-wide rejection. Separate not-due/busy outcomes from failures.
5. Verify existing future materialization/projection-feed schedules remain in effect and a naturally detected change retains correct observation, snapshot and acknowledgment lineage when such work occurs. Do not force an edit or provider fetch for release paperwork. A quiet period proves not-due behavior, not a changed-lineup publication.

Do not claim all six-hour cycles, future week rollovers or extreme live overload were observed from a short release window. Report their deterministic/isolated evidence separately and state which natural production events remain unobserved. Compare real request/duration evidence with the nominal estimate before describing measured savings; no billing claim follows from query counts alone.

## Rollback

Use a reviewed application revert or the already authorized compatible deployment recovery procedure. Preserve installed migrations, accepted observations, pending changes, immutable snapshots and pointers. No destructive database rollback or manual due-time reset is required or proposed.

The old application can read the existing watch rows. However, restoring old code does not instantly restore every future check to three minutes: a previously stored v2 due time can remain as far as six hours away, after which the old v1 cadence resumes. Current one-minute observation remains unchanged. Treat this delay as an explicit rollback tradeoff; do not claim immediate cadence restoration or silently repair rows by hand. Failure backoff and busy ownership may add their ordinary delay.

Verify exact rollback SHA, unchanged cron ownership, all three readers, natural current/future outcomes, retained pending lineage and due times. Escalate for unreadable leagues, loss of pending work, stale ownership publishing, unexpected provider traffic or completed-period checks. If immediate future-cadence restoration is required, prepare and review a separate bounded operational procedure rather than bypassing the existing write guards.
