# Week 2 rollover diagnosis and repair

## Reproduced source state

The public Sleeper request group started at 2026-09-15T12:50:44.9958966Z.
Its NFL state reported season 2026, regular season, active week/leg 2 and
display week 1. Both registered leagues were in season.
The retained [fixture](../apps/site/test-support/fixtures/sleeper-week-two-rollover.json)
contains that state, league ID/season/status/slot configuration, the requested
Week 2 roster IDs/pairings/starters/starting points, and current roster
IDs/starters. It excludes manager names, owner IDs, avatars, account metadata
and credentials. The timestamp marks the request group start, not a provider
mutation time or individual response completion.

Sources: Sleeper's public `/v1/state/nfl`, `/v1/league/{id}`,
`/v1/league/{id}/matchups/2` and `/v1/league/{id}/rosters`.
The [official API documentation](https://docs.sleeper.com/#getting-matchups-in-a-league)
defines ordered starters for a requested matchup week; it does not define a
null weekly starter list as permission to copy another period's lineup.
The fixture preserves all 12 weekly rows in each league and their nulls.

## Confirmed defects and repair

On main `00f21264c06f81a93f74e598b352e3a6f57aa9ec`, the ownership classifier
rejected active Week 2 / display Week 1 as malformed. That prevented stored
authority reads and complete-horizon synchronization for both leagues.
The repair accepts independently moving display and scoring weeks within
the same valid season/type, preserving lifecycle, source identity, freshness
and regression checks. The active scoring week remains the operational anchor.
No database constraint imposes the removed ordering rule.

Rosters also compared a selected week with the display week to decide whether
complete future lineups were required. That classified active Week 2 as future
and hid every roster when one weekly lineup was incomplete. Readiness and
current metadata now use the known active scoring week, retaining the existing
display fallback when active authority is unavailable. Exact-week membership
validation still hides an incomplete team; it does not synthesize starters.
The default week selector continues to follow Sleeper's display week.

Regression evidence covers the classifier, stored authority reader, both
league horizons, roster membership and historical metadata isolation, plus
the captured source response. Three ownership regressions and the roster
visibility regression failed before their respective application fixes.

## Separate source gate

The captured Week 2 slate has all 12 roster rows and six complete pairings per
league. League One roster 2 and League Two roster 10 each have
`starters: null` and `starters_points: []`. Their current roster endpoints
have nine starters, which is retained as diagnostic evidence, not used as
an exact-week substitute. The other 11 weekly rows in each league have nine
starter slots.

Strict full-source readiness therefore still rejects a complete projection
publication for each league. This fixture is an expected incomplete-source
case, not successful materialization evidence. A production repair is not
operationally complete until fresh Week 2 lineups satisfy the existing
validation and naturally scheduled workers publish/verify both leagues.

## Release and recovery

This is a compatible application-only repair. No migration, pointer rewrite,
provider configuration change, new cron, or manual Tank01 retrieval is needed.
Before merge, complete repository verification, independent review, actual
Vercel preview inspection, and fresh repository/service/ownership checks.
Verify the exact merged SHA in Production.

After deployment, inspect naturally scheduled current/observer/future outcomes,
fresh authority and watch ownership, pending/readiness diagnostics and existing
snapshot lineage. Verify real Week 2 full and revision responses for both
leagues, non-null projections and correct period headers after source readiness
passes. Healthy Week 1 readers alone do not prove Week 2 recovery. Never force
publication or replace the missing exact-week lineups to satisfy this gate.

Rollback is a protected application revert with normal release checks. Preserve
stored history and pointers; no destructive database rollback is needed.
