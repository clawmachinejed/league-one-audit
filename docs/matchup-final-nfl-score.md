# Final NFL results in matchup player rows

When a player's NFL game is final, its schedule label becomes
`Final W 23-10 @ TEN` or `Final L 10-24 vs NYJ`. The player's NFL team score
comes first. Equal scores use `Final T`; a shutout keeps the zero. This depends
on the individual NFL game, even while the fantasy matchup remains live.

The existing Tank01 `getNFLScoresOnly` request supplies `homePts` and `awayPts`.
The provider's [Example Responses](https://rapidapi.com/tank01/api/tank01-nfl-live-in-game-real-time-statistics-nfl/playground/apiendpoint_170ffbd1-36a2-4570-9671-0888277ee728)
were inspected on September 13, 2026, without running the endpoint. The documented
`20240107_KC@LAC` example has `home: "LAC"`, `away: "KC"`, `homePts: "12"`,
`awayPts: "13"`, `gameStatus: "Completed"`, and `gameStatusCode: "2"`.
Its home/away `lineScore` totals and team abbreviations agree. This is provider
documentation evidence, not a fresh production game capture.

The existing adapter normalizes the score pair. Missing, malformed, or conflicting
scores remain unavailable without rejecting an otherwise valid game clock.
The snapshot builder requires a unique exact-period final game, matching the
official schedule's opponent and home/away relationship, and two nonnegative
safe integer scores before including a result. Pregame, live, interrupted,
unknown, or incomplete games retain their existing schedule label. BYE and
empty-player behavior is unchanged.

The public scheduled game object gains optional `finalScore`, containing
`teamScore` and `opponentScore`. Old snapshots omit it and remain valid; old
application readers ignore the extra property. Full and compact readers use the
same updated structural validator. The existing `home_score`/`away_score` columns,
immutable observations, snapshot builder, publication guards, revision/content
hashes, and browser refresh protocol carry the change. No migration is needed.

Scores become visible after the existing worker accepts the next normal source
observation and publishes a changed snapshot, followed by the existing visible
page refresh. No extra feed, request, cron, browser provider access, or database
repair is introduced. A fallback page or older historical snapshot without a
stored result still displays the schedule. This release does not rewrite those
snapshots or force historical collection.

Fantasy scoring, projections, frozen baselines, standings, actual-player rank,
PPG, and recurring all-player collection retain their existing behavior. The
roster page still receives its existing official schedule; final results are
attached in the matchup snapshot conversion.

Verification covers requested win/loss strings, ties and zeroes, source-field
normalization, source conflicts, period and team isolation, unchanged fantasy
calculations, legacy payloads, full/compact validation agreement, and both leagues'
360px schedule-to-final browser updates. Release evidence records actual totals,
preview limitations, exact merged SHA, and live results separately.

Rollback is a reviewed application revert. Existing database structures and
immutable history remain compatible; no down-migration, data deletion, pointer
rewrite, or schedule change is required.
