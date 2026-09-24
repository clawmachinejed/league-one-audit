# My Fantasy

## Scope and selection

`/my-fantasy` is a global public page, immediately before My Team in desktop and mobile navigation. Its cards come from the existing `LEAGUE_SITES` registry: League One, League Two and Dynasty League. The league count describes these website leagues, not verified account participation. Sleeper discovery and account linking do not add cards, enroll leagues or create additional dashboards.

Each card uses that league's existing My Team browser preference, scoped to its resolved current Sleeper league ID. Without a valid saved choice, the shared selection helper uses the first team in official standings order without saving that fallback. This is not account ownership or a cross-league manager match; equal roster numbers in different leagues are unrelated. Selections remain editable through the existing manager profile controls.

## Cards and summary

The collapsed card shows the selected team and opponent, current official points, available projected finishes, record and current-to-projected rank. Rank movement compares the projection with current official standings; it is not historical movement since last week. The shared `projectStandings` calculator uses completed official history and all league matchups. My Fantasy displays a projected rank only when every matchup is covered, with no unresolved teams. Missing scores, baselines or rank evidence remain unavailable rather than becoming zero.

Expanding a card reuses `MatchupBoard` and its existing starter, bench and paired box-score disclosures. The selected team stays on the left, and bench points do not enter team totals. The separate **Enter league** link opens `/my-team`, `/league2/my-team` or `/dynasty/my-team`.

The page summary counts projected wins, losses and ties only from available selected matchups in the same season and week, labeling partial coverage. It aggregates known lineup issues without interpreting unavailable leagues as clear. A failed league receives its own unavailable card; the others remain usable.

## Lineup attention

Attention is limited to explicit empty starting slots, starters on a bye, and a Sleeper `OUT` designation before that player's known kickoff in the active period. Live or final game evidence prevents an OUT warning for a game already underway. Unknown period, lineup or game evidence stays unverified; known issues may coexist with incomplete coverage. Completed matchups receive a completion state rather than an all-clear claim.

Injury designations come from the existing cached Sleeper player metadata and can lag the provider. “Clear” means no supported issue was found in the available evidence; it does not confirm live NFL active status or that a roster change is permitted. Questionable, missing projections and zero points are not classified as OUT. No advice assumes a post-kickoff substitution is allowed.

## Shared data and refresh

`loadLeagueMatchups` preserves the existing exact-week snapshot, bounded rollover rereads and official server fallback. `loadMyFantasyLeagues` resolves each website league independently; failed standings history or honors do not discard usable matchups. Per-card league, selection and honors providers keep identities and links scoped correctly.

Each league uses one existing `useMatchupSnapshot` instance for its summary and expanded card. Visible current/future periods check stored revisions every 60 seconds; historical periods do not poll. The existing rollover hook and bounded refresh rebuild the page's official standings baseline when the period changes. Changed record or final-result evidence requests an immediate page refresh and at most two settling retries, 65 seconds apart. This lets a failed request or stale cached response recover without requiring another scoring change. New route-prop objects do not reset the retry budget; new record/final evidence supersedes the earlier retry sequence. Hidden pages pause retries, returning to visibility sends at most one overdue attempt, and unmounting cancels them. The budget remains capped even when all attempts fail.

The route renders at request time so those refreshes reread accepted standings rather than a prerendered page. Existing provider fallback caches remain unchanged and may still briefly return older information; a refreshed prop object or timestamp alone does not prove that cached records have advanced. These checks do not accelerate collection. Inline box-score data remains lazy and uses the existing stored-data endpoint.

This adds no provider, browser-to-provider request, Tank01 call, scorer, worker, publication path, enrollment or database migration. Repository implementation does not establish a production release; deployment and live behavior still require the normal [release evidence](release-validation.md).
