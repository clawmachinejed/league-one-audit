# Shared league-season and settings shadow resource

This slice adds an internal description of an enrolled league season and its
settings through the existing Sleeper acquisition, normalizer, writer and database
factory. Public readers, enrollment, scoring/projections, exact-week selection,
immutable baselines and cron remain unchanged. Yahoo remains a documentation
fixture, not a shipped integration.

Before editing, clean local/main and GitHub/main both identified
`cf1da509ddce415ae54bbb47518baa09f2e39664`. The coordinator independently inspected
Vercel's canonical `clawmachinejed/league-one-audit` binding, production branch
`main`, and Ready/Latest/Current Production `DdKxdspByDQ3d8PqJqQk8q44CyzU` at that
exact SHA. No competing owner observed in inspected worktrees, PRs and release
evidence. This task owns implementation/PR only; production database leases were
not inspected and production writes are not authorized here.

## Contract and field coverage

`LeagueSettingsValue` uses provider-neutral concept names. Scoring retains provider,
dialect and representation (`flat-weights`, `catalog-modifiers`, or `native`).
Generic competition names do not translate native enum values across providers.
`sourcePath` records each adapter mapping. Native settings preserve unrecognized
fields and structured values. Counts mean counts; other codes, budgets, eligibility
flags and native period boundaries retain provider semantics. A budget is league
FAAB, not money; start/playoff values do not select the site's calendar.

Each field reports `known`, `empty`, `absent`, `null`, or `invalid`. Invalid data
retains raw JSON. Zero is distinct from missing. Optional omissions never fill
defaults or borrow older facts. Previous receipts remain immutable, but their
fields are not blended into a current group. Field provenance resolves through
the returned receipt, raw content hash, captured mapping and acquisition times.
Receipt coverage is complete only for NFL identity (`league_id`, `season`, `sport`),
not all settings. Interpretation support is separate: recognized settings alone
cannot prove analytics readiness. Unknown active scoring rules are retained and
marked limited using the existing scoring-profile translator, without calculation.

| Shared field/group | Exact Sleeper source | Normal and adverse fixture |
| --- | --- | --- |
| League/season UUIDs, provider reference | Enrollment, mapping, `league_id`, `season`, `sport` | SQL exact identity, wrong source/season/sport, remap and isolation |
| Name, artwork, predecessor reference | `name`, `avatar`, `previous_league_id` | Same-capture values, omitted/null/empty/invalid and self-predecessor |
| Lifecycle, season type, visibility | `status`, `season_type`, `settings.public`; public endpoint | Operational hash invariance, absent/null/invalid, no access grant |
| Team count | `total_rosters` | Known/null/invalid; independent v1 population qualification |
| Slots | Ordered `roster_positions` occurrences | Repeated code/count 1/ordinal, empty/missing/invalid/unknown/reordered |
| Native scoring | `scoring_settings` | Exact weights/hash, missing/null/empty/invalid/unknown rule; Yahoo catalog/modifier specimen |
| Competition | `start_week`, `playoff_week_start`, `playoff_teams`, `playoff_type`, `playoff_round_type`, `playoff_seed_type`, `league_average_match`, `best_ball`, `divisions`, `type` under `settings` | Independent literal field map, field invalidity, group missing/null, retained unknown formats |
| Reserve/taxi/substitution | `reserve_slots`, `taxi_slots`, `taxi_years`, `taxi_allow_vets`, `taxi_deadline`, `reserve_allow_out`, `reserve_allow_sus`, `reserve_allow_doubtful`, `max_subs`, `sub_lock_if_starter_active`, `sub_start_time_eligibility` under `settings` | Literal field map, invalidity and missing/null; no new eligibility engine |
| Waiver/trade rules | `waiver_budget`, `waiver_type`, `waiver_clear_days`, `daily_waivers`, `daily_waivers_hour`, `daily_waivers_days`, `trade_deadline` under `settings` | Literal field map, zero/omitted/null/invalid; native units/codes |
| Native periods | `settings.leg`, `settings.last_scored_leg` | Operational change, omissions, source-scoped string references |

This acquisition supplies no verified NFL-week mappings: a league document alone
cannot establish them. `nflWeekMappings` is empty and interpretation requires
separate evidence. No canonical period ID is allocated and no ordinal/calendar
guess changes exact-week behavior. No extra calendar request is made. Predecessor
evidence is a native reference, not an invented previous-season UUID or enrollment.

The [Sleeper reference](https://docs.sleeper.com/) documents league identity and
roster ordering. The [Yahoo reference](https://sports.yahoo.com/developer/docs/)
supplies composite-key, counted-slot and category/modifier patterns for the
self-contained synthetic contract specimen. Checked 2026-09-29; the direct Yahoo
fetch failed, so indexed official documentation was used. Fixture values are
synthetic. Unprovided Yahoo groups stay absent. Authorized live acquisition,
serialization, access and semantic qualification remain gates before any cutover.

## Persistence and compatibility

Migration `029_league_season_settings.sql` adds no tables or columns. It extends
the closed reservation registry, receipt/acceptance lineage guards and sole writer
loop over 027's existing scopes, attempts, receipts, acceptances and heads. Their
historical table names retain `roster`; scope now also admits this league policy.
Installed 001–028 remain unchanged, as do existing ACLs.

The collector reserves before its already-required network league acquisition.
Source mapping is captured before acquisition. Cache checks never reserve or
advance the new head; an already-required changed-cache verification reserves
immediately before fetching. Latest reservation, expected generation, mapping,
lease and deadline fence acceptance. League requests must start after reservation.
Partial/wrong identity preserves accepted evidence; optional setting invalidity
can advance identity coverage with explicit field gaps. Exact retries reuse the
receipt; changed evidence under a used attempt fails atomically. A-B-A remaps
cannot reuse an old token.

The preserved v1 writer is called once in the same transaction. League mapping
tokens live in the shared receipt's attempt because the historical observation
mapping relation is roster-only. V1 receives unchanged legacy league input with
new shadow fields/token removed. Old tokenless captures do not become qualified.

Receipts bind exact raw content and real acquisition provenance even when v1
reuses an older same-content observation ID. Configuration versions omit status
and leg changes and cannot alone prove lifecycle or native periods. Readback
validates raw/hash/legacy normalized configuration parity and projects that same
capture through the sole normalizer. A v1 document rejected for optional data can
have no configuration version; null is explicit. No historical hash, observation,
scoring profile or accepted population evidence is rewritten.

Player/manager acceptance still requires independently complete, currently accepted
v1 league configuration with evidenced team count. The identity-only head cannot
qualify population or bypass v1 scoring-profile conflicts. Old callers, readers
and enrollment remain intact. The coordinator's independent pre-commit comparison
of 34 complete/partial variants against actual main found identical legacy outputs
and hashes after excluding only the new `leagueSettings` projection.

## Requests, validation and rollback

There are zero additional provider/Tank01 requests or cron invocations. An existing
network league capture adds one reservation database round trip; completion extends
its existing writer statement. Internal readback uses one scoped query, with no
public-reader caller. Each network attempt adds one receipt and each qualifying
attempt one acceptance, reusing raw content and configuration rows. These are
transport/count assertions, not measured production cost or latency. Isolated SQL
runs stay within the existing $5 total approval, behind exact-SHA review and the
protected GitHub environment gate.

Tests cover field mapping, same-capture compatibility, corrections, partial capture,
ordering, exact/changed retries, remaps, leases, old callers, population and role
boundaries. Full verification, SQL totals/skips/cleanup, final SHA and PR/preview
evidence must be recorded separately. A persistence-disabled Preview verifies
presentation compatibility, not SQL acceptance. Test source alone proves no run.

This implementation task cannot merge, migrate production or deploy. A separately
authorized rollout needs 029 before new callers. Application rollback leaves 029
and immutable evidence intact; old callers stop supplying settings attempts while
their previous behavior continues. Do not delete receipts, reset heads, rewrite
installed migrations or reverse schema as a rollback.
