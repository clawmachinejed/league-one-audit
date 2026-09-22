# Projection capture consistency repair

The September 21, 2026 production interruption affected the current-week projection publication shared by League One, League Two and Dynasty. Official Sleeper scores remained available through the existing fallback, while stored live projections and the worker's minute-level compact box-score captures could not advance. The hourly raw-statistics fallback is a separate path.

## Root cause and evidence

The feed cached weekly projection statistics and the global player crosswalk independently for one hour, then joined them on every read. The joined slate retained the statistics capture timestamp. A refreshed crosswalk could therefore change aliases or coverage for an already-observed slate. PostgreSQL correctly rejected different semantic content at an identical observation time. That shared provider-stage failure prevented all three leagues from publishing their new snapshots.

Production chronology (UTC, September 22):

- The last accepted Week 2 statistics capture was observed at `02:17:18.313`, with 478 entries: 446 players and 32 defenses.
- The naturally scheduled `02:19` invocation started a background player-crosswalk refresh at `02:19:18.005`. Persistence completed at `02:19:21.576` using the saved capture; the crosswalk request completed at `02:19:25.814`. All three leagues then reported unchanged publication.
- The next invocation failed at `02:20:21.704` in projection-slate persistence, with PostgreSQL `P0001` and three failed leagues. Run ID: `8c86d9a8-fda2-4c08-b3b4-93ba16a5ddca`.
- This predates PR #244's `02:34:49` merge. The same failure continued on its production SHA `2bddae97047c8d1f29b475ac75ca56181e0bcd69`.

Independent reproductions using the real normalizer, join, semantic serializer and writer inputs showed that both a same-count alias change and a coverage-only crosswalk change produce the conflicting content/revision pair at the original timestamp. Changes to game phase, scoring profile, downstream identity resolution, metadata and input ordering did not reproduce it. Production did not retain the rejected crosswalk payload, so no particular player alias is claimed as the trigger. The observed cache refresh timing and database error establish the failure path; synthetic fixtures prove its mechanism separately.

## Repair

Cache the normalized statistics and the crosswalk used for that capture together. Replays use the saved pair; a genuinely new statistics capture may use newer crosswalk evidence. Preserve the source timestamp, normalizer, scorer, identity checks, immutable history and SQL conflict guard.

The pair uses a new `tank01-normalized-projection-capture-v4` namespace because its cached value shape changed. The global crosswalk keeps its existing namespace and hourly lifetime. Crosswalk reads begin outside the projection cache callback: Next.js bypasses nested `unstable_cache` reads. Both started cache-read promises settle before returning; Next-managed stale background revalidation may continue. A valid warm pair remains usable if a newer crosswalk request fails. Foreground failures retain the existing short failure cooldown; Next owns background revalidation retries.

Current and future persistence logs classify the exact known SQL exception as `projection-slate-observation-conflict`. They log only fixed reasons and safe SQLSTATE values, never raw exceptions or database details.

A fresh capture waits for usable crosswalk evidence before requesting statistics. This avoids repeated projection requests when a cold crosswalk fails during background refresh. Fully cold loads may take longer because those two provider loads are sequential; warm crosswalk reads keep their existing cache behavior.

## Verification and release

Use unit tests for cache timing and failure lifecycle, the installed Next.js cache implementation for actual stale/background behavior, and the existing isolated Neon harness for SQL replay/conflict/rollback tests. Synthetic complete fixtures are engineering evidence, not production player evidence. Record exact totals and final revision in the release report.

No migration, production data correction, credential/configuration change, cron change or forced provider request is required. The new namespace requires normal cold cache refill as existing workers select periods, after which the existing hourly cache policy applies. This is not a guarantee against concurrent cold requests; existing worker ownership and cadence remain unchanged. Global crosswalk sharing remains intact. Do not warm every week manually.

After merging under the existing release authorization, verify the exact production SHA and observe naturally scheduled publication, then read current-week revision/full/box-score endpoints for all three leagues. A deployment alone does not establish recovery. Record actual phase and source timestamps; do not claim an active-game observation after the game has finished.

## Recovery and rollback

Retain the pre-release production SHA `2bddae97047c8d1f29b475ac75ca56181e0bcd69` as a restore tag. If this change causes a regression, revert the application through a reviewed PR or an authorized temporary Vercel rollback reconciled with Git. The previous application can read the unchanged database schema and snapshots, but still contains this cache consistency bug; rollback is not a durable resolution of that bug.

Do not delete captures, alter observation timestamps, relax SQL guards or manually move current pointers. Preserve valid history and frozen baselines. The unchanged schedules and lease mechanism remain authoritative. Verify readable snapshots and the next natural worker result after any rollback.
