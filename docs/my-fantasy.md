# My Fantasy

## Scope and selection

`/my-fantasy` is the cross-league awareness screen, immediately before My Team in desktop and mobile navigation. **For the current phase, cards follow explicit My Team choices made on each league's manager profile, in every environment, including production.** Account sign-in is not the selection source for this phase. The supported `LEAGUE_SITES` registry remains League One, League Two and Dynasty League; a league with no saved My Team choice adds no card. A default team displayed by My Team does not count as a saved selection.

Choices are scoped to the current annual league ID and validated against current teams. A stale roster ID adds no card. When a league's data fails but its current league ID and saved choice are known, its card remains unavailable without substituting another manager. Equal roster IDs across leagues are unrelated. Preview and production are separate browser origins and therefore keep separate selections. Cards retain registry order during refreshes.

Affiliations do not create My Fantasy cards. League One and League Two remain available in the league selector; selecting a League One team alone does not add League Two to this page. Managers remains reachable through direct routes and expanded team-profile links, but is absent from the navigation ribbon.

The planned replacement is inclusive aggregation of the signed-in account's associated provider teams. For example, an account associated with clawmachinejedi should receive League One and Dynasty when those are its actual memberships, while affiliated League Two remains accessible through league navigation. That future switch must use account/provider identity evidence, not browser choices, and must retain current-season isolation. Existing account/discovery contracts remain available for that work; this page does not call private account endpoints in the temporary selection phase. Additional discovered leagues still need enrollment and capability checks before website matchup cards are possible. Additional providers are not implemented by this presentation change.

## Week navigation and page heading

My Fantasy reuses `PageIntro`, the Matchups toolbar styles and `WeekSelector`, matching My Team and Matchups typography, season label, content alignment and control spacing. The season comes from accepted league data, with the server-evaluated calendar year used only when no league data is available. The week/league overview follows the season; freshness sits alongside that overview. The empty-selection page retains the same heading and week controls.

`/my-fantasy` follows the current scoring week. A valid `?week=N` selects that exact week across supported leagues through the existing `loadLeagueMatchups` reader/fallback path, and invalid queries retain the existing Current behavior. The shared schedule boundary, bounded settling retry and visibility-return triggers refresh current-week authority. A manually selected week remains pinned through those refreshes. Current returns to the unpinned route. Enter League retains an explicitly selected week when opening that league's My Team page. No new calendar, polling or collection pipeline is introduced.

## Cards and summary

Cards wrap the existing shared `MatchupBoard` presentation. Both fantasy team names, current scores, projections, manager usernames/avatars, current places and records remain. The mirrored manager → rank → record arrangement stays on one row, with records nearest the centered expansion chevron. Identity text absorbs overflow; rank and record do not move into another row. The user is always on the left, and My Fantasy omits championship trophies.

Every league header uses the same logo box and two-row grid. The first row contains the league name; the second contains provider/week and the separate **Enter League ›** link to that league's My Team page. The action keeps a fixed column and shared text baseline. Title and provider/week have a compact row gap; the logo spans both text rows. The 44px navigation hit target does not add space between those rows. A shared 11px status token sizes the card's upper-right dot and the red/green attention-heading circles. A red dot means at least one starting-position issue (including doubtful); green means verified clear; unknown and completed states retain neutral dots with accessible labels, without visible verification messages.

The probability variant occupies the shared full-width footprint. One colored fill runs from the left for the user's share of the entire track. The remainder is dark neutral. Labels stay inside at fixed left/right insets. Greater than 50% uses restrained green, less than 50% competitive coral, exactly 50% neutral; unavailable has no fabricated fill. This variant consumes the same stored probability as Matchups and My Team; it does not calculate separate odds.

Below the track, a compact `9th → 6th` shows current versus projected rank, with an accessible description. No visible “Your rank” or “projected” suffix is added. Each endpoint, and both teams' actual places, uses `relativeRankBand` against the actual league size: ranks through `ceil(N / 3)` are upper/green; ranks through `ceil(2N / 3)` are middle/gold; remaining ranks are lower/coral. This ceiling convention is shared and tested for uneven league sizes. These colors do not encode playoff or relegation rules.

The existing `projectStandings` calculator uses official completed history and all league matchups under its supported standings rules. My Fantasy shows projected rank only when every matchup is covered without unresolved teams. Missing scores, baselines, unsupported rules or rank evidence remain unavailable. Current-to-projected movement describes the selected week's projected result, not a season or postseason forecast.

The global summary counts displayed leagues and projected wins/losses/ties from the same selected week's available projected matchup totals, labeling partial coverage. It does not display the combined season record. Freshness uses the oldest successful matchup source/snapshot timestamp across displayed leagues, never the render time; missing, invalid or future timestamps leave it unavailable.

## Inline disclosure

Each league expands independently. Opening a second league does not close the first. Ordinary snapshot and route refreshes preserve matchup, player-row and Bench expansion state within the same league/season/week/team scope, with stable order and scroll position. Changing that scope resets the detail state.

Expansion shows the existing paired starters. Tapping either player row toggles both eligible players' actual game statistics in a shared area underneath that row, without opening other rows. Existing accepted live/final game evidence controls statistics availability. My Fantasy omits the expanded live/final source note and the per-card box-score freshness/provider footer; the dedicated Matchups and My Team presentations retain that source context. **Bench** is a separate opt-in disclosure, initially closed, and retains its state when the outer matchup is closed and reopened. Its compact centered label sits on a thin green divider across the matchup detail. Bench points never enter team totals. Existing team-profile links remain in the expanded view. Enter League navigates independently while the summary remains collapsed; it never opens Sleeper or toggles starters. Disclosures use button semantics and `aria-expanded`.

## Starting-lineup attention

Only the user's starting positions contribute issues. Explicit empty slots and byes are alerts. Before a known future kickoff, explicit Sleeper injury designations OUT, INACTIVE, SUSPENDED/SUS, IR, PUP or NFI (including their recognized full names) are alerts. DOUBTFUL is a burnt-orange caution with uncertain-participation wording. QUESTIONABLE retains the shared lineup styling and does not by itself enter the attention list.

Each affected starting position counts once, including compound IR/OUT flags. Bench and opponent issues are excluded. Rows follow starting position, player (or EMPTY), designation (or No Player/Bye), and league. Position labels reuse Matchups' RosterSlot component, including flex-slot grids. Subtle column dividers keep fields distinct. Names use the full value when it fits and the shared first-initial/last-name formatter when it does not; the full accessible name remains available. The red heading is a keyboard-operable disclosure that can hide all rows while retaining the affected-starter count. Its state survives ordinary refreshes. Red/green heading circles use the same 11px token as card dots; there is no additional upper-right panel dot.

Known issues can coexist with incomplete coverage. Missing lineup, period or game evidence, an unfamiliar availability designation, or elapsed kickoff without accepted live/final evidence withholds a verified-clear card status. Live/final evidence avoids treating current metadata as a retrospective pregame designation. Completed matchups have a completion state, not green lineup status. After the selected league reports are ready, zero detected issues produces the green boxed “No lineup issues” panel with a green circle and white checkmark. This is a summary of detected issues, not a verification claim; internal unknown states remain intact. The page does not display per-card or aggregate verification messages.

Injury metadata can lag Sleeper. The general catalog active/inactive flag is not game-day inactive evidence and is intentionally not used. These are factual exceptions, not start/sit advice or permission for a post-kickoff substitution.

## Shared data and refresh

`loadLeagueMatchups` retains the existing exact-week snapshot, bounded rollover rereads and official server fallback. `loadMyFantasyLeagues` resolves each supported website league independently; failed standings history or honors do not discard usable matchups. Per-card league and selection providers keep identities and links scoped correctly.

Each league uses one existing `useMatchupSnapshot` instance for summary and expanded detail. Visible current/future periods check stored revisions every 60 seconds; historical periods do not poll. Existing rollover and bounded standings refresh remain unchanged: changed record/final evidence requests an immediate route refresh and at most two settling retries, 65 seconds apart. Hidden pages pause retries and returning to visibility sends at most one overdue attempt. Prop objects and render timestamps do not reset this budget or prove that source data advanced.

The route renders at request time to reread accepted standings. Existing provider fallback caches may still briefly return older information. Refresh does not accelerate collection. Inline box scores remain lazy and use the existing stored-data endpoint. No new provider feed, browser-to-provider call, Tank01 call, scorer, worker, publication path, enrollment or database migration is introduced.

## Validation and limits

Use real phone widths, long names, expanded rows, dark/light contrast and independent hit targets to verify the layout; a mockup alone is not fit evidence. Scoped probability colors provide at least 6.9:1 contrast for their internal percentage text over fill/remainder. Color is accompanied by status words, numbers and accessible descriptions. The four-league/two-minute goal requires real user testing for accurate answers, missed issues and unnecessary navigation; automated layout checks do not establish that usability result.

Implementation is not a production release. Preview, CI and any later authorized production release require the normal [release evidence](release-validation.md).

## Compact overview and availability forecasts

League headers, matchup summaries and between-card gaps are compacted within the My Fantasy variant. Both team identities, the mirrored manager/rank/record row, current/projected scores, probability bar and rank movement remain. The No lineup issues strip stays thin and uses the same neutral surface as the red attention panel, with a green outline, an 11px green circle and white checkmark. The page does not display a saved-My-Team explanatory footer. The collapsed red attention heading keeps a generous tap target. Large text and unusually long names can still require scrolling; four cards fitting one phone viewport is a measured layout goal, not permission to crop information or shrink all text.

The active-week shared normal-v3 forecast treats recognized non-playing designations as zero expected remaining points and variance under the existing exact-period, game-context and official-score guards. Uncertain designations retain ordinary projections; designation text alone never vetoes valid inputs. Attention warnings remain visible. Missing underlying projection or game evidence stays a separate data problem. See [estimated matchup win chance](matchup-win-probability.md) for version compatibility and publication rules.
