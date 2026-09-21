# Weekly roster PPG and position rank

League / Rosters uses a fixed weekly statistics cutoff: **4 AM Eastern local
time (`America/New_York`, including daylight saving time)** on the day after the
NFL week's final scheduled game date, once every non-canceled game reports
complete. It shares the validated Sleeper season schedule and calendar arithmetic.
Active scoring and display week still advance at noon.

During 2026 Week 2, metrics use Week 1 evidence retained by September 15 at 4 AM.
After Week 2's final game on September 21, the cutoff advances September 22 at
4 AM; the displayed week stays Week 2 until noon. PPG still divides points by
the existing appearance denominator. Pos Rank still ranks cumulative points
within the player's position and league scoring profile. Scoring and participation
rules are unchanged.

Earlier roster selections cap included statistics at the selected week. All
selections use the latest weekly cutoff, so older corrections appear together at
the next release. Future selections never include unplayed weeks. Before Week 1's
first release, metrics are unavailable. After Week 18's release they stay fixed;
a subsequent correction requires separately authorized policy. The UI identifies
the actual through-week and weekly cadence.

## Existing collection and history

Collection timing is unchanged. Existing hourly statistics and live matchup/D/ST
workers retain their schedules, budgets and ownership. There is no new 4 AM
provider request or cron. The reader uses evidence already stored by that cutoff,
normally including midnight collection. Delayed/incomplete evidence does not
become a complete final capture; later saved corrections wait for the next cutoff.

The existing metric reader accepts internal `asOf`. It selects each week's latest
accepted immutable observation with observation, request completion and database
creation times at or before that cutoff. Hourly corrections and backdated late
writes cannot change the display midweek. The cutoff scopes statistics, not league
registration: a league added later can score earlier retained statistics under its
one immutable season/profile assignment and rules. That permits initial Dynasty
metrics without changing an existing league's rules midweek. The existing
sparse scorer and identity, participation, missing-week and ranking checks remain.
Unsafe or expired current mappings may still withhold affected values: weekly
stability never overrides identity safety.

Current complete-score pointers are mutable; there is no immutable publication
ledger. Cutoff metrics therefore use accepted complete/partial raw history and
remain `provisional`, with a truthful partial-statistics indication. They do not
claim an older score set was published by the cutoff or publish complete scores.
Existing non-cutoff readers keep their prior behavior. No migration, score copy,
history rewrite or new cache is needed.

## Refresh, holds and recovery

`X-Roster-Metrics-Refresh-At` supplies the next known boundary. Current/future
rosters keep normal hourly membership/status refresh, and the 4 AM boundary can
wake the page sooner; metrics remain frozen on ordinary reads. Historical
selections can wait until the weekly correction boundary. Hidden/inactive pages
stay quiet. Missing new headers retain legacy timing during rolling deployment.
Unknown or expired boundaries and failures use bounded hourly recovery.

A missing/malformed calendar cannot establish a cutoff: roster data remains
available, unproved metrics are withheld, and an open page preserves its last
valid metrics on a failed/regressing read. A fresh page may show unavailable
metrics during the outage. Unfinished/postponed games hold the previous cutoff;
authoritative rescheduling moves the next boundary. Sleeper supplies scheduled
game dates, not actual finish timestamps; ordinary midnight crossings retain the
official game date, just as with noon progression.

Rollback is a compatible application revert. Raw history, complete scores,
pointers, worker budgets and database permissions are untouched.

Calendar tests cover 4 AM, DST, noon independence, incomplete/rescheduled games,
bye weeks and season end. Existing reader tests and guarded isolated SQL cases
cover complete/partial data, all time fences, corrections and profile creation.
HTTP/browser checks cover weekly metric stability with fresh rosters, visibility,
errors and legacy timing. No destructive production test is authorized or needed.
