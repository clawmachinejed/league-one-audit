# Site week calendar

Roster player PPG and position rank use the same validated schedule and date
arithmetic with a separate [4 AM weekly display cutoff](weekly-roster-metrics.md).
That cutoff does not change the noon active/display-week boundary below.

The site's active scoring week and default display week use one rule: advance at
noon Eastern local time on the day after the last NFL game date in that week.
The time zone is `America/New_York`, including daylight saving time. For the
captured 2026 Week 1 schedule, the last game date is Monday September 14; the
boundary is Tuesday September 15, 12:00 PM EDT (`2026-09-15T16:00:00Z`).

## Evidence and holds

Sleeper remains the league and schedule source. The rule reuses the existing
`/schedule/nfl/regular/{season}` request and its one-hour server cache. It validates
the full regular-season schedule before deriving a week: canonical teams, unique
game identities, weekly membership and existing season coverage checks. Calendar
arithmetic additionally rejects impossible dates and dates outside the requested
season. It never assumes that every week has 16 games.

A week advances only when its noon boundary has passed **and every non-canceled
scheduled game reports `complete`**. A missing, malformed or conflicting season
schedule is unavailable; an unfinished, postponed or unknown-status game holds
the current week. An updated scheduled date moves the prospective boundary. An
overdue held boundary stays observable for recovery. Week 18 finishes without
inventing Week 19. Preseason and league lifecycle remain official league facts;
after the policy takes effect its calendar is retained through season completion.

The date means the NFL game's authoritative scheduled calendar day, including
published rescheduling updates. The source does not supply an actual finish
timestamp. A normal late game crossing midnight therefore retains its official
game date. An unreported postponement whose date/status are wrong cannot be
reconstructed from this feed. Do not infer an actual completion date or bypass
the completion hold. Diagnose conflicting evidence through the existing sources.

Calendar advancement is not score-publication proof. Exact-game finality, official
points, complete lineups, participation policy, parity, and immutable publication
guards remain independent. Current missing starters remain unavailable. No
estimated starters or manufactured results are introduced.

## Shared application and worker behavior

`lib/site-week.ts` is the pure resolver. `lib/sleeper.ts:getLeagueCalendar` is the
shared application boundary. It preserves the raw NFL state and carries the
resolved period separately to Matchups, Rosters, standings, player metric/history
boundaries, manager data and transaction retrieval. Explicit requested weeks stay
exact. Transactions retain their existing broad retrieval horizon and also include
the site's current week when Sleeper's week fields lag.

The existing current worker persists both resolved periods through
`league_period_authorities`; existing future, lineup observer, snapshot reader
and all-player selection paths inherit them. Both league calendar loads use one
invocation evaluation timestamp. Source identity remains `sleeper`; the semantic
revision also includes the versioned site policy and normalized schedule evidence.
Evaluation time belongs to freshness metadata and does not create revision churn.

The existing authority generation and publication fences remain unchanged. A
proposal that disagrees with the post-write durable authority is rejected with a
period-authority diagnostic, including an explicit regression reason. It is not
reported as a successful idle cadence. Server readers use one request-memoized
read of the existing compact authority row to reject a known backward period or
lifecycle. Missing/disabled storage and transport failure preserve the existing
official-source fallback; malformed identity or a proved regression does not.

A failed schedule request or malformed season schedule does not hide otherwise
available official teams, standings, roster rows, scores or transactions. Readers
retain the highest already accepted display/active week for the same league and
season, using the same compact authority read even when that observation is old.
When no usable retained authority is available, the existing bounded official
display default remains a clearly warned temporary fallback. Neither fallback
establishes an active scoring week, schedules a new rollover, or attaches current
injury, IR or taxi metadata to a retained roster week. The page reports that the
calendar is unavailable and automatic advancement is paused.

Worker cadence and explicit projection/statistics operators reject either
fallback before downstream ingestion or ancillary writes. A retained observation
never receives a new authority timestamp or publication solely because a reader
used it. Recovery resumes the normal policy on a later request with valid schedule
evidence. This outage handling catches only schedule retrieval/validation;
malformed stored identities and a valid schedule that proposes a backward period
remain explicit failures outside that fallback.

Explicit operator targets retain their exact NFL schedule, including canonical
byes derived from full-season evidence, even after that week becomes historical.
This does not attach current player-team metadata to historical player rows.
The existing final-capture and finite correction selection policy is unchanged.

## Refresh and resource bounds

The noon decision is calculated for each server request, outside the one-hour
schedule cache. It does not wait for Sleeper's `display_week`, `week`, or `leg`.
The existing scheduled current worker adopts it on its next invocation; an
in-flight invocation keeps its shared evaluation time. Persisted context can lag
by the existing worker/transport interval. No new cron or statistics request is
created by this rule.

Open pages receive the server's known transition time. They refresh at the
boundary, with one delayed retry for the existing worker/cache interval, and
bounded visibility recovery. They do not calculate a second browser week or poll
providers. A held boundary does not start an unlimited retry loop. A background
tab refreshes when visible again. Current follows the new week; an explicitly
selected past or future week remains selected. During an authority mismatch,
Matchups uses the exact official fallback rather than relabeling stored projections.

The season request is shared with exact-week schedule loads. Its cache lifetime
and the hourly all-player budget are unchanged. The reader regression guard adds
at most one existing compact authority read per league per server render/request
memoization scope; the current worker reuses its existing batched authority read.
Outside an active React memoization scope, schedule-outage recovery may perform
two bounded, read-only compact authority calls; normal valid-calendar reads use one.
There are no added history tables, score copies, retained snapshots, or migrations.
This is a query-bound statement, not a claim about measured compute cost or Neon
physical storage.

## Release and recovery

1. Revalidate canonical GitHub main, Vercel source/root/production branch, exact
   production SHA, both league IDs, database identity and observable ownership.
2. Compare both durable active/default periods with the newly derived period.
   Stop on an unexplained backward proposal; do not rewrite authority rows.
3. Require full verification, independent review and the actual Vercel preview.
   The captured schedule fixture proves the September 15 boundary; synthetic
   browser clocks prove rollover interactions, not an observed future live event.
4. Merge and verify the exact merged production SHA, both league pages and APIs,
   and a naturally scheduled current-worker authority update. Record default and
   active weeks, source revision, generation, timestamps and durable outcomes.
   Distinguish existing lineup/provider failures from successful calendar adoption.
5. If a schedule correction contradicts an already published period, keep the
   durable monotonic guards and verified history. Investigate the exact source
   date/status and authority diagnostic; do not force a backward write or relabel
   complete results. A transport outage cannot prove a durable floor, so report
   that reconciliation gap while retaining the existing official fallback.

Rollback must preserve a compatible calendar producer. Once the site advances
the stored display week beyond Sleeper's display week, simply restoring the old
producer would propose a regression and be rejected. Prefer a reviewed corrective
PR retaining the new authority policy; restore older code only after proving its
periods cannot regress the live authority. Do not delete history, lower pointers,
remove database guards, or assume that Vercel rollback restores cron definitions.

## Evidence map

- `lib/site-week.test.ts`: exact noon, Eastern DST, varying last game days,
  incomplete/rescheduled games, invalid schedules, season bounds and the sanitized
  public 2026 schedule captured at `2026-09-15T17:33:44.1032175Z`.
- `lib/sleeper.test.ts`: both league loaders and cadence around the real cutoff,
  unchanged cached evidence, raw-state independence, metric/transaction bounds,
  strict lineup handling and completed-week schedules.
- `lib/site-calendar-authority.test.ts` and current-lineup-context tests: durable
  floors, conflicting identity, transport fallback and post-write disagreement.
- Sleeper calendar/composition tests: stable policy revisions and one invocation
  timestamp across both leagues.
- Browser timer, view and page tests plus `e2e/site-week-rollover.spec.ts`: Current
  intent, exact selections, held boundaries, hidden tabs and stored-context lag.
- Existing all-player cadence, period/publication and repository suites retain
  finality, ownership, corrections and immutable history coverage. No destructive
  production integration test is part of this release.
