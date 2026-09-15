# My Team

## Page and selection

The ribbon's My Team jersey icon sits immediately before Matchups. League One uses `/my-team`; League Two uses `/league2/my-team`. Switching leagues preserves this section and each league's independent saved selection.

The page shares `LeagueMatchupsPage`, `MatchupsView`, and `MatchupBoard` with Matchups. It displays one matchup for the viewed week and defaults to the current week. The selected team is always the left side; moving the whole side preserves its team, score, lineup and opponent relationship. With no valid saved team, `compareTeams` supplies the same official order as Standings: win percentage, PF, higher PA, then alphabetical team name and roster ID. This display default does not write a preference during hydration. A selected team without a posted matchup gets a named unavailable state rather than another team's matchup.

The current week follows the site calendar: noon Eastern on the day after the week's last scheduled NFL game. My Team uses the exact same compact `WeekSelector` as Matchups: dropdown, previous/next arrows, Current marker and return-to-current link. Navigation stays on the active league's My Team route. Valid `?week=N` queries load that exact week; absent or invalid queries follow the current week through the same parser, calendar validation, stored reader and official fallback. An explicit week remains selected across reloads and calendar refreshes. Selecting Current from the dropdown or using the Current link returns to the bare route and resumes following the current week. As on Matchups, switching leagues opens the destination league's current week while preserving the section and each saved team.

On Matchups, a saved My Team selection places that matchup first and the selected team on its left for the displayed week. The remaining matchups retain their relative order. Without a saved selection, Matchups preserves source order and side orientation; the standings fallback belongs only to the My Team page. Both pages move the complete side only for display, leaving stored scores, lineups and snapshots unchanged.

## Bench authority and scoring

The existing bulk Sleeper matchup request supplies exact-week `players`, `starters` and `players_points`. A validated bench is the requested-week player list minus occupied starter IDs. Current reserve/taxi exclusions apply only when the loader has authoritative current-period roster context. Missing, malformed or conflicting membership produces an unavailable bench, not an assumption that all players are benched. An explicit empty starter slot remains different from an unavailable starter list.

Every bench actual comes from Sleeper's numeric `players_points` entry, including explicit zero. Missing or invalid points remain null. No participation assumption or projection supplies an actual score. The canonical adapter rechecks membership and numeric source points before the worker uses them.

The existing worker, identity resolution, baseline lookup and `clock-v1` calculation supply bench projections. Bench data is optional: unusable identity/game/baseline/clock evidence leaves the projection unavailable without failing valid starters. No new required identity or projection candidate is created solely for the bench. Frozen baselines and the existing final-game projection policy remain intact. Team points remain Sleeper's official team result, and team projections sum starters only.

Available bench game references enter the existing game-state lineage and freshness metadata. Already mapped bench actuals use the same official observation batch with `isStarter: false`; valid source points also remain in `sourceData.benchPointsEvidence`. Bench evidence cannot satisfy required starter counts. No new database table, migration, provider request, publication path or cron schedule is introduced.

## Refresh and compatibility

Visible active and future My Team pages use the same compact revision checks every minute, fetching full payloads only when changed; completed historical weeks do not poll. Those browser checks never call providers or run workers. Week changes retain the existing cancellation, stale-response rejection and lineup/box-score reset behavior. Historical snapshots without bench evidence remain unavailable and never borrow a current roster. The existing active/idle freshness rules and scheduled collection apply. `lineup-v1` retains its starter-only meaning; bench-only membership changes appear on the next normal full refresh instead of introducing another observer or cadence.

`MatchupSide.bench` is optional and nullable. Old immutable snapshots remain readable and show Bench unavailable until a normal worker publication includes bench evidence. Empty arrays mean a known empty bench. Valid arrays may contain players with null actuals or projections. The same structural shape validates full JSON and compact SQL; both freshness paths account for bench game windows.

The expanded card retains the existing starter rows and paired box-score disclosure. Bench rows use the same player/score layout and separate paired disclosure keys. The existing bounded box-score endpoint accepts stored bench identities and reads the same all-player history; it adds no provider request. Unequal bench lengths render blank opposite cells instead of fabricated empty starter slots.

## Verification and release

Before release, run the complete repository workflow, including guarded isolated Neon tests. Verify exact-week membership, source zero/null behavior, shared scorer/frozen-baseline rules, strict starter totals, full/compact validation, snapshot replay and immutable historical compatibility. Browser checks cover default and saved team selection, side orientation, both benches, paired expansion, rollover reuse, league switching and phone/desktop navigation fit.

Preview uses ordinary disabled persistence or an explicitly isolated database. A preview with provider fallback can prove page and membership behavior; null projections there do not prove production worker output. Verify the final preview commit in Vercel and inspect both league pages in the built-in browser.

Deployment needs no migration or configuration change. Under release authority, merge the reviewed PR, verify the exact merged SHA in production, check both league readers/pages and observe normal scheduled publication of bench payloads. Do not invoke a worker solely to force release evidence. Record any older snapshot still awaiting normal refresh.

Rollback uses a protected code revert and the existing release checks. The previous application ignores the optional bench field; preserve immutable snapshots, official observations, frozen baselines and current pointers. No history deletion or database rollback is needed.
