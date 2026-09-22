# Matchup player box scores

Inside an expanded matchup, each starting-position row has one disclosure control
when either player's accepted NFL game is live or final. Tapping anywhere across
the summary row, including the starting position or either team's points, reveals
both players' available box scores together beneath that row; tapping again
collapses both. Player names have no disclosure arrows. Rows remain independent,
including repeated RB, WR or FLEX slots. A side with a pregame game, bye, empty
slot or unavailable game state stays blank in the details. Current injury labels
and elapsed kickoff times are not used as proof of game state or participation.

The original 52px summary rows, official fantasy scores, projections and matchup
expansion remain unchanged. Box-score expansion is keyed by starting-slot index
and label, so a replacement player occupies the same expanded row after a lineup
update. Changing league, season or week
resets the board and cancels outstanding statistics requests.

## Source and presentation

The source is Sleeper's shared bulk weekly statistics stored in Neon. During live
games the existing current projection worker retains a compact box-score envelope
in its league observation from the same budgeted request used for defensive
components. The hourly all-player history remains a fallback and the source for
weekly PPG/rank. No new connection, scorer, table or cron is added.
The box score is descriptive: it does not recalculate the adjacent official
Sleeper fantasy score or claim that a partial observation establishes complete
league scoring parity.

The reader selects the newer whole capture from the requested league's compact
observation or accepted complete/partial hourly observation for the exact
regular-season week, then reads only the distinct official player and
canonical defense identities present in the accepted league matchup snapshot.
Player and defense kinds stay separate. Rows from older captures are not stitched
into a newer capture. Invalid observations, unrelated weeks, provider fantasy
point/rank fields and private eligibility evidence are not returned.

Only finite reported values are displayed in one compact comma-separated summary
for QB, RB/FB, WR/TE, K and D/ST. For example: **17/27 CMP, 209 YD, 1 TD, 1 INT,
5 CAR, 29 YD**. Statistics wrap between entries beneath the corresponding player,
without category headings or individual stat cards. Screen readers retain category
descriptions so passing and rushing yards remain distinguishable. Completions and
attempts (and kicking made/attempted pairs) combine only when both are reported.
Relevant unusual offensive, return and conversion statistics can appear
when present. An actual zero remains zero. A missing key or player row is not
converted into a zero; a panel without displayable data says **Statistics not
available yet.** Defensive and special-team totals are shown as separately named
source fields, never added together as potentially overlapping categories.

## Read and refresh behavior

`GET /api/matchups/{league}/box-scores?season=2026&week=1` is a read-only companion
to the existing matchup transport. Its response has its own statistics revision
and source observation time. It never changes the immutable Matchups payload,
snapshot revision or compact/full protocol. The server validates league, exact
season/week and accepted snapshot scope before the bounded raw-stat query.
Responses are `no-store` because the lineup may change under the same week URL;
the browser shares each result among players on its currently selected board.
Unavailable storage or invalid scope fails safely; requests never initiate
Sleeper/Tank01 collection or write to Neon.

The first row expansion makes one bulk read shared by every player on the board.
Additional row taps reuse it. Active-week, visible pages check every 60 seconds
while displayed games are live, including My Team's bench. Game-state transitions
also prompt a read; final transitions have bounded follow-up reads. Historical
pages load on demand without scheduled polling. Hidden pages cancel in-flight
requests and stop checking. Requests have a 15-second timeout. After three
consecutive failed, unavailable or regressed responses, a visible live board
backs off to one read every five minutes; a successful response restores the
one-minute cadence. A final transition allows its initial read and at most two
one-minute settling retries, stopping sooner when every displayed final player
has a final statistics record. Older or unavailable responses cannot replace a
newer valid observation. Once live games and final settling have ended, an opened
active-week board returns to the existing hourly collection window plus three
minutes, so later corrections still appear. Historical pages never schedule
these hourly reads.

A single note below the matchup board shows **Stats as of** the actual source
observation time and identifies Sleeper. Collection is budgeted at least 60 seconds
apart globally; browser polling does not force collection. Provider timing,
hourly priority, failures and publication delays can make the source older than
one minute. Scores and details can arrive at different times. The source timestamp
states the freshness actually available. After the final live game, the hourly
collector supplies subsequent final statistics and corrections.

Compact evidence contains only allowlisted numeric box-score fields for at most
512 displayed league identities and 256 KiB, plus exact period, retrieval times,
body hash and semantic revision. It includes reported final rows as well as live
rows. Missing rows are not carried forward under a newer timestamp. Invalid
compact evidence falls back to hourly data; it never changes actual fantasy
points or eligibility. The ordinary league-observation retention policy applies.
Full all-player raw history and score sets are not copied each minute.

## Validation and release

Unit coverage exercises positional display, zero/missing/negative values, exact
scope, a single accepted raw capture, bounded identity selection, disabled-store
silence and safe HTTP failure. Browser fixtures exercise paired tap/keyboard
disclosures, independent slots, unchanged summary geometry, shared retrieval, live updates and
navigation isolation. Those fixtures do not prove a deployed database connection;
check the real endpoint and observed player values for both leagues after release.

This is an additive read/UI change with no migration, data correction, provider
configuration or cron changes. Existing restricted-role reads suffice. Rollback
is a reviewed code revert; all stored statistics, scoring pointers and history
remain intact.
