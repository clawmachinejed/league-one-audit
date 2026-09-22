# Live game statistics repair

## Confirmed production problem

On September 21, 2026, production at `0eb7ce520c4184569b36b4ec832cb6a687e9d37d`
served Blake Corum's live official points while detailed box scores still used
the hourly all-player history. A fresh check at 9:07 PM Eastern found his 3 carries
and 19 yards captured at 9:01 PM, and a fresh browser rendered them. This proved
the hourly freshness gap; it did not prove an identity or formatting failure.

Rams defensive observations also showed two separate conditions: a short-lived
official-score/component mismatch (10 versus 10.5), and later not-due claims
without fresh reusable evidence. Those conditions held the pregame projection.
The official score later reached 10.5. Rewriting points or loosening parity would
have concealed the difference between those independent sources.

## Repair boundaries

- The current worker requests existing bulk weekly statistics when a displayed
  starter or available bench player's canonical game is live, including leagues
  without a defense slot. All leagues in the selected period share the request.
- The existing global job, hourly priority, 60-second reservation spacing,
  ownership, deadlines and provider implementation remain authoritative. A small
  not-due timing gap allows one bounded wait and re-claim; no provider failure loop.
- Fresh hourly defense records may supply the same original evidence to the live
  calculation. Missing, stale, contradictory or wrong-period evidence remains
  unusable. Full official-score parity and the 90-second limit remain unchanged.
- New captures retain only bounded descriptive rostered-player fields in existing
  league observations, separate from score payloads. The box-score reader selects
  the newer valid whole live or hourly capture for the requested league/week.
- Open, visible active-week box scores check every minute during displayed live
  games. Hidden pages stop; historical pages remain on demand. Kickoff and final
  changes prompt bounded reads. The note reports the actual source time.
- Weekly PPG and positional rank keep their existing completed-week 4 AM Eastern
  policy. No minute-level all-player history/score copies, scoring rule changes,
  new migration, source, cron, Tank01 call or subscription are introduced.

## Release and rollback

This document does not mark production release complete. Record the exact PR/head,
full verification totals/skips, independent review and real Vercel preview in the
release evidence. Isolated database tests must pass the existing authorization,
identity, sentinel, TLS, role and production-denylist guards before any reset.
Physical size measurements use the real parent table and separate heap/index/TOAST
allocation from serialized bytes; they do not establish unlimited season capacity.

With production authorization, revalidate canonical main, Vercel repository/root,
production branch/SHA and release ownership; then merge the reviewed PR. No schema
installation, data rewrite or manual worker invocation is needed. Verify the exact
merged production SHA and all three league readers. During a naturally scheduled
live run, confirm compact source timestamps advance, box-score endpoints read them,
the browser adopts them, and the shared reservation stays bounded. Report a final
or idle window as unverified live operation, not as live ingestion success.

Rollback is a protected code revert to the compatible prior application. Optional
compact observation metadata can remain; prior readers ignore it. Preserve all
official scores, frozen baselines, pointers and history. Existing cron attachments
and hourly ingestion continue unchanged. Do not delete history or down-migrate.
