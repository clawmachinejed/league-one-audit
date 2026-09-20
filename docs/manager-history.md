# Manager regular-season history

The Managers directory has History and current-season tabs in every league. The current-season view remains the default and retains team names, current official records, profile links, and My Team selection.

History displays the union of primary roster owners in the current season and connected completed seasons beginning with 2025. It removes team names, retains manager championship honors, and adds each owner's official head-to-head record within this league. A manager's results in another league do not transfer when promoted or relegated.

## Source and identity

- Resolve the current annual source through the existing accepted league registry.
- Follow Sleeper's `previous_league_id`, verify the exact prior season, source ID, and completed league status, and stop at 2025. No historical league ID is hardcoded.
- Use the existing administration reader, raw matchup adapter, four-request history loader, and completed-standings calculator. No projections, player catalogs, Tank01 calls, worker changes, or database writes are involved.
- Accepted Neon documents for completed prior seasons may be read without the current-page 60-second verification TTL. All existing connection, envelope, league, period, schema, completeness, and conflict guards remain. Observation times are retained. Missing/disabled/unavailable storage falls back to the same public Sleeper reader, cached for 24 hours for completed seasons; this is a read fallback, not a database import.
- Current-page freshness is unchanged. Opening the default season tab does not retrieve historical matchups.
- Retained historical documents also require proven network verification at or after the completed configuration's observation boundary. A pre-final or unverified cached score document cannot become final just because separate league metadata later says complete; it falls back to the existing official reader.
- Join using stable Sleeper primary-owner IDs. Annual roster slots and display names are never identity keys. Prefer the latest season's name/avatar.
- The approved League Two 2026 eneerg-to-tylerawildman display/ownership exception remains restricted to its exact source ID, roster, and source owner. It does not change 2025.
- Historical ownership reflects the source roster captured for that season. This feature does not reconstruct unrecorded midseason ownership transfers or attribute a primary owner's record to co-owners.
- Historical-only managers have no link to a current roster that might belong to somebody else. Returning managers link to their current profile.

## Results and limits

Only Weeks 1–14 are eligible, and a known earlier playoff start further narrows that range. Current-season history stops before the site's active scoring week; pre-season contributes no results, and an unconfirmed boundary yields unavailable records. Completed historical seasons contribute their eligible weekly results.

The existing official completed-standings calculator handles head-to-head wins, losses, ties, exact score comparisons, and commissioner `custom_points` overrides. End-of-season roster totals are not used because they can contain playoff games. Active-week scores and projections never enter these records.

Missing or malformed weekly results, ambiguous ownership, an invalid annual connection, or unsupported median/best-ball/start-week settings display an explicit warning and unavailable combined records. An incomplete subset never appears as a complete career total. The participant list retains all identities that can be established.

History begins at 2025 and the annual source chain is bounded to 20 seasons per request. A broken chain is reported. A historical correction should use the existing reviewed administration import to update accepted evidence; the UI never overwrites retained history.

## Validation and release

Unit coverage tests identity unions, roster reuse, renames, the League Two exception, completed-week boundaries, excluded playoffs, custom zero scores, ties, missing evidence, historical accepted-source guards, scoped route composition and lazy loading. Browser coverage checks the two tabs, manager presentation, profile targets, mobile fit, and unchanged selection.

This release needs no migration, scoring change, or data mutation. Publish the reviewed application through the normal PR/preview/release process. Rollback is a compatible application revert; retained administration observations remain intact.
