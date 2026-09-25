# Supplemental league projections

Sleeper settings are the scoring authority for every imported league. Tank01
supplies the shared forecast. When the forecast lacks a scoring-event breakdown,
the Sleeper adapter compiles the configured event weight into an explicit
expected-value estimate before calling the existing canonical scorer.

`sleeper-2025-supplemental-v1` uses public 2025 NFL regular-season counters:

| Event | Projected count |
| --- | --- |
| Passing interception returned for TD (`pass_int_td`) | Tank01 passing interceptions × 28 / 380 |
| Individual special-teams fumble recovery (`st_fum_rec`) | Tank01 receptions × 5 / 11,124 |
| Individual special-teams forced fumble (`st_ff`) | Tank01 receptions × 4 / 11,124 |
| Defense forced fumble (`ff`) | Tank01 defensive fumble recoveries × 332 / 218 |
| Defense special-teams forced fumble (`def_st_ff`) | Tank01 defensive fumble recoveries × 32 / 218 |
| Made field goal, 0–19 / 20–29 / 30–39 / 40–49 / 50–59 / 60+ yards | Tank01 made field goals × 4 / 202 / 278 / 264 / 171 / 12, respectively, divided by 931 |

Each estimated count is multiplied by its own Sleeper weight, including negative
weights. Base field-goal scoring and distance bonuses remain additive. Myers'
weights produce 3435 / 931 expected points per made field goal; extra points
and misses retain their separate configured weights. Missing Tank01 inputs
remain missing, rather than becoming an invented forecast.

These are population-rate estimates, not native event-level Tank01 predictions
or claims about a particular player's return role or kicker's distance mix.
Using receiving volume to allocate the very rare individual special-teams
events is deliberately coarse; it does not forecast special-teams-only players.
The capability report marks these projections limited and explains the estimate.
Actual points still use the exact native Sleeper counters and weights, including
official-point parity checks. Existing projection omissions stay unchanged.

## Calibration and provenance

The public source was `https://api.sleeper.app/v1/stats/nfl/regular/2025`, captured
September 25, 2026. Its response SHA-256 is
`cd9c98ef7db4c2089629e301988fe793f92faabb182a6bf2393e098299b005af`.
The player catalog used to select QB/RB/WR/TE and K/PK cohorts was
`https://api.sleeper.app/v1/players/nfl`, SHA-256
`43c260c1baf6d18f8821858af1551004746e7a318e86a62f0589790cee15e9bf`.
The defense cohort is the 32 team rows. This is a retained historical calibration,
not another runtime provider feed or recurring request.

Aggregate evidence lives beside the Sleeper scoring adapter in
`supplemental-projection-calibration.json`. Selected nonzero public counters
and their player/team IDs live in the identically named test-support fixture;
tests replay every aggregate total. The model ID and active estimated keys
are retained in scoring provenance and the canonical league observation, and
participate in snapshot revision identity. Changing calibration requires a new
model ID. Raw scoring rules and their database hash remain unchanged.

## AutoSubs and import

Sleeper performs [AutoSubs](https://support.sleeper.com/en/articles/9731991-how-does-player-autosubs-work).
The shared full/thin lineup parser ignores pending substitute metadata and
detects the official starter replacement through `lineup-v1`. The existing
worker already captures rostered bench baselines. A replacement retains its
own immutable kickoff baseline, including an earlier game; a finished player's
actual points contribute to the team total. No substitute inherits the outgoing
player's projection, and no retroactive baseline is invented.

Captured Myers and The GridIron II settings are tested through discovery,
fresh capability validation, registration, the shared administration capture,
and activation. Confirmation still verifies the user's current roster membership.
There is no league-name exception, alternate import pipeline, schema migration,
cron change, or change to League One, League Two or Dynasty scoring.
