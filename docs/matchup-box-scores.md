# Matchup player box scores

Inside an expanded matchup, a player whose accepted NFL game is live or final
has a disclosure control across their player cell. Tapping it reveals that
player's reported box-score statistics beneath the lineup row; tapping again
collapses it. The opponent's disclosure is independent. Pregame games, byes,
empty slots and unavailable game state have no disclosure. Current injury labels
and elapsed kickoff times are not used as proof of game state or participation.

The original 52px summary rows, official fantasy scores, projections and matchup
expansion remain unchanged. Player expansion is keyed by team and official player
identity and survives ordinary matchup updates. Changing league, season or week
resets the board and cancels outstanding statistics requests.

## Source and presentation

The source is existing immutable Sleeper weekly statistics stored in Neon by the
all-player collector. No new source, connection, capture, scorer or cron is added.
The box score is descriptive: it does not recalculate the adjacent official
Sleeper fantasy score or claim that a partial observation establishes complete
league scoring parity.

The reader selects one latest accepted complete or partial observation for the
requested regular-season week, then reads only the distinct official player and
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

The first player expansion makes one bulk request shared by every player on the
board. Additional player taps reuse that result. Active-week pages check again
three minutes after each existing noon-through-midnight Eastern collection slot.
Historical pages load on demand without scheduled polling. Hidden pages cancel
in-flight requests and do not make statistics checks. Requests have a 15-second
timeout; repeated taps cannot retry a failed request more often than once per
minute. Automatic failures wait for the next scheduled display check. Older or
unavailable responses cannot replace a newer valid observation.

A single note below the matchup board shows **Stats as of** the actual source
observation time and identifies Sleeper and hourly collection after data loads.
Fantasy scores may update sooner than
the detailed box score. The selected period may also wait for the collector's
existing rollover/correction priority. The timestamp, rather than a page refresh,
states the freshness actually available.

## Validation and release

Unit coverage exercises positional display, zero/missing/negative values, exact
scope, a single accepted raw capture, bounded identity selection, disabled-store
silence and safe HTTP failure. Browser fixtures exercise independent tap/keyboard
disclosures, unchanged summary geometry, shared retrieval, hourly updates and
navigation isolation. Those fixtures do not prove a deployed database connection;
check the real endpoint and observed player values for both leagues after release.

This is an additive read/UI change with no migration, data correction, provider
configuration or cron changes. Existing restricted-role reads suffice. Rollback
is a reviewed code revert; all stored statistics, scoring pointers and history
remain intact.
