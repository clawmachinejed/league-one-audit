# Estimated matchup win chance

Matchups and My Team share a compact win-chance row. `normal-v2` estimates each team's chance of finishing ahead from the existing exact-week starting lineup, league-scored projections, official scores and canonical NFL game state. It is an initial uncalibrated estimate, not an official Sleeper probability or a guarantee. Readers continue to accept stored `normal-v1` estimates.

## Data and calculation

The existing projection worker calculates probabilities in the canonical snapshot builder, before player values are converted for display. This matters because a finished player's displayed projection intentionally remains their frozen pregame baseline; their contribution to the projected team finish is their official score. Bench players never contribute. Each league's existing scorer and scoring profile supply its point values; this feature does not score statistics again.

The expected finishing margin is the difference between the two canonical projected team totals, including an evidenced official team adjustment (official team total minus the sum of supplied starter scores). An adjustment is used only when all those scores are finite. The active-week Out policy below sets the affected starter's expected remaining contribution to zero. Official scores and results remain unchanged; projected totals and projected standings use the corrected forecast through the existing shared path.

Each unfinished starter receives a normal error distribution. Its standard deviation is the larger of a fixed floor and the absolute pregame baseline multiplied by a position coefficient:

| Position | Standard deviation floor | Baseline multiplier |
| --- | ---: | ---: |
| QB | 5 | 0.45 |
| RB | 4 | 0.75 |
| WR | 4 | 0.80 |
| TE | 3 | 0.85 |
| Other offense | 4 | 0.80 |
| K | 3 | 0.60 |
| D/ST | 5 | 0.90 |

These are versioned starting assumptions in fantasy-point units. They are not fitted accuracy claims. The baseline multiplier responds to league scoring, but the floors do not fully adapt to unusual rules. Player errors are treated as independent, so QB/receiver and opposing-player correlations are not modeled. The continuous approximation does not estimate exact-score ties before finality.

Pregame uses full variance. Live offense and kickers use variance multiplied by remaining regulation fraction, with a 5% floor while the game remains live and a 10% overtime floor. These floors prevent a running zero clock from implying certainty. D/ST keeps full variance until final because `clock-v1` holds its pregame mean. Final players and canonical byes contribute zero variance. Standard deviations are not multiplied directly by remaining fraction; variances are.

The normal CDF of expected margin divided by total standard deviation gives the win chance. Results are deterministic, complementary and stored to six decimal places. Nonfinal values stay strictly between zero and one. The UI shows whole percentages, with `<1%` and `>99%` for tails; team-ID-based rounding and lookup preserve each team's percentage when My Team moves it to the left.

The existing percentage row contains two mirrored horizontal bars without a visible label. Each bar starts at its team's outer edge; the center of the card is 100% for either side. Widths use stored probabilities, with green at 50% or higher and red below 50%. Percentage text stays at the outer ends. A final winner fills their half, a loser has an empty red track; ties and unavailable estimates retain neutral text and empty tracks. Screen readers receive the team-specific win chances through the existing expandable card's accessible name. Neither page calculates new probabilities in the browser.

## Missing data and completed weeks

- An occupied starting slot with Sleeper's current `Out` designation contributes zero expected remaining points and zero remaining variance in the active scoring week. Before kickoff its projection is zero; during a game its forecast retains all official points already scored. A missing provider baseline does not veto that explicit product assumption, and an old positive baseline does not override it. The actual starter stays in the lineup. Bench players remain excluded from odds.
- The source explicitly scopes current injury metadata to the site's active season/week using the existing calendar, not Sleeper's display leg. Past/future requests, preseason, a completed season or unavailable calendar authority do not receive this override. Only `Out` qualifies; Questionable, Doubtful and IR are not interchangeable. Canonical exact-period game context and required actuals remain necessary.
- This is a forecast assumption, not evidence of historical participation or permission to save an actual zero. Current catalog status uses the existing daily Sleeper cache, so designation changes are reflected after the cache refresh and an ordinary worker publication. No new provider request is added, and the source request completion timestamp is not an injury-observation timestamp.
- Final players always retain official points and their existing frozen pregame display values, even if they are currently Out. Immutable baselines are never rewritten. A nonzero actual paired with pregame context is not erased by the Out policy.
- Missing starters, other incomplete baselines, untrusted game context, missing required actuals or retained-prior projections make only that matchup's estimate unavailable. They never turn missing evidence into a confident zero.
- Explicit empty slots are valid and add no variance. An entirely absent lineup remains unavailable. If no unresolved variance exists but the matchup is not final, no estimate is invented.
- A final matchup uses the official team totals: winner 100%, loser 0%, or an explicit Tie. No pregame baseline is required to display an official result. Later official corrections can change that result through the existing snapshot path.
- Legacy final snapshots can display their official outcome without a rewrite. Legacy nonfinal snapshots show dashes until a normal worker publication supplies the new field. The browser does not reconstruct estimates from player-row values.

## Storage, refresh and cost

The optional `Matchup.winProbability` object is embedded in the existing immutable Neon snapshot. It includes `modelVersion`, `status`, and either probabilities keyed by team ID or an unavailable reason. No migration, new table, probability history stream, provider request, SQL round trip, cron or browser timer is added. No production data is rewritten.

Both current and future materialization use the shared builder. `normal-v2` is included in publication revision material so an old revision cannot conflict with the new payload. The source revision also includes the active injury-status period. Existing content hashing includes probabilities and the existing retention/deduplication behavior remains in effect. The same unchanged inputs produce identical probabilities without a new timestamp or random simulation.

The full reader validates optional structure and semantics. The compact revision reader uses the same semantic predicate with small anonymous probability/team-ID/official-score atoms returned by its existing SQL query. This increases database response bytes even when the full snapshot is unchanged. Older payloads remain valid and return no probability atoms.

The UI follows the existing visible 60-second revision polling and source cadence. Current/future estimates appear when their normal lane next successfully materializes that exact week. Deployment alone does not republish every stored future week, and historical periods are not automatically recalculated. Existing final results still display immediately. No extra provider refresh is triggered by opening a page.

Arithmetic is linear in the starting-player count. Measurements must distinguish model CPU, extra serialized snapshot bytes, compact database response bytes, physical storage and provider traffic. Synthetic payload bytes are not physical Neon table/index/TOAST growth or a billing estimate. No added provider calls does not mean literally zero incremental cost.

## Validation and release

Model tests cover a known normal-CDF value, symmetry, monotonicity, position assumptions, remaining variance, overtime, defenses, negative scores, empty slots, missing evidence, final score adjustments and ties. Builder tests cover real canonical-to-public conversion, frozen final display values, bench exclusion, stable unchanged results, exact period and local failure isolation. The shared full/compact validation corpus covers optional legacy payloads, malformed identities, probability bounds, numeric precision and final-score consistency. Browser fixtures exercise all three leagues, both pages, team orientation, expansion, mobile widths and the existing refresh protocol.

Release needs the repository verification workflow, independent review and the actual Vercel preview. No migration or data operation is needed. After release, verify the exact merged SHA, all three league readers and the first ordinary current-week snapshot carrying `normal-v2`; check both affected Week 2 matchups, both pages and an exact future week after its next materialization. A preview without production snapshots cannot demonstrate live probability availability. The retained public Week 2 fixture contains real starter values but constructed canonical baseline-quality and game-state fields; it is a regression case, not proof of private production baseline contents.

Deploy the updated readers and worker together. A rollback must retain `normal-v2` reader support: the previous `normal-v1`-only application rejects v2 snapshots. If the forecast policy needs reverting, revert its producer changes while retaining both-version validation and presentation, then let the existing worker publish normally. Do not delete or rewrite history. Official results and frozen baselines remain intact. Future coefficient changes require a new probability model version and calibration evidence, not changes to `clock-v1`.

Calibration remains future work: pair genuine pregame forecasts with later official outcomes, evaluate probability calibration and Brier/log loss on held-out periods, and compare against this baseline. Actual-only historical records cannot prove forecast accuracy. Existing retention does not provide an unlimited historical record of live probability trajectories.
