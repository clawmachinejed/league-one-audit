# Manager regular-season history

The Managers directory has History and current-season tabs in every league. The current-season view remains the default and retains team names, current official records, profile links, and My Team selection.

History displays the union of effective roster owners in the current season and connected completed seasons beginning with 2025. Effective ownership follows the source primary account plus the explicit League Two correction below. It removes team names, retains manager championship honors, and adds each owner's official head-to-head record within this league. A manager's results in another league do not transfer when promoted or relegated.

## Source and identity

- Resolve the current annual source through the existing accepted league registry.
- Follow Sleeper's `previous_league_id`, verify the exact prior season, source ID, and completed league status, and stop at 2025. No historical league ID is hardcoded.
- Use the existing administration reader, raw matchup adapter, four-request history loader, and completed-standings calculator. No projections, player catalogs, Tank01 calls, worker changes, or database writes are involved.
- Accepted Neon documents for completed prior seasons may be read without the current-page 60-second verification TTL. All existing connection, envelope, league, period, schema, completeness, and conflict guards remain. Observation times are retained. Missing/disabled/unavailable storage falls back to the same public Sleeper reader, cached for 24 hours for completed seasons; this is a read fallback, not a database import.
- Current-page freshness is unchanged. Opening the default season tab does not retrieve historical matchups.
- Retained historical documents also require proven network verification at or after the completed configuration's observation boundary. A pre-final or unverified cached score document cannot become final just because separate league metadata later says complete; it falls back to the existing official reader.
- Join using stable Sleeper effective-owner IDs. Annual roster slots and display names are never identity keys. Prefer the latest season's name/avatar. When effective ownership differs from the raw primary owner, omit unverified primary-owner artwork and use the existing manager-initials fallback.
- The owner confirmed on September 20, 2026 that **in League Two, whenever `tylerawildman` appears as a co-owner, that roster's record belongs to Tyler**. Match the stable account ID `862177751849877504` in `co_owners`, scoped to the permanent League Two key. Apply this relationship in any source season; do not restrict it to a hardcoded year or annual source ID. It does not reattribute records in League One or Dynasty, nor infer an exception for other co-owners.
- Both captured League Two seasons list roster 1's raw `owner_id` as `95628446075863040` (`eneerg`) and `co_owners` as `["862177751849877504"]`. Retain those raw values unchanged. The explicit owner decision establishes effective attribution; the provider relationship alone was not used to guess who should receive the record.
- Historical ownership otherwise reflects the source roster captured for that season. This feature does not reconstruct unrecorded midseason ownership transfers or generally award a primary owner's record to every co-owner.
- Existing stored matchup snapshots lack owner/co-owner fields. Their narrow 2026 League Two roster-1/source-name compatibility correction remains at render time; this legacy fallback does not rewrite immutable snapshots or broaden its historical evidence.
- Historical-only managers have no link to a current roster that might belong to somebody else. Returning managers link to their current profile.

## Results and limits

Only Weeks 1–14 are eligible, and a known earlier playoff start further narrows that range. Current-season history stops before the site's active scoring week; pre-season contributes no results, and an unconfirmed boundary yields unavailable records. Completed historical seasons contribute their eligible weekly results.

The existing official completed-standings calculator handles head-to-head wins, losses, ties, exact score comparisons, and commissioner `custom_points` overrides. End-of-season roster totals are not used because they can contain playoff games. Active-week scores and projections never enter these records.

Missing or malformed weekly results, ambiguous ownership, an invalid annual connection, or unsupported median/best-ball/start-week settings display an explicit warning and unavailable combined records. An incomplete subset never appears as a complete career total. The participant list retains all identities that can be established.

History begins at 2025 and the annual source chain is bounded to 20 seasons per request. A broken chain is reported. A historical correction should use the existing reviewed administration import to update accepted evidence; the UI never overwrites retained history.

## Validation and release

Unit coverage tests identity unions, roster reuse, renames, the League Two exception, completed-week boundaries, excluded playoffs, custom zero scores, ties, missing evidence, historical accepted-source guards, scoped route composition and lazy loading. Browser coverage checks the two tabs, manager presentation, profile targets, mobile fit, and unchanged selection.

The sanitized fixture `apps/site/test-support/fixtures/manager-history-2025-2026.json` comes from 60 public Sleeper responses captured at `2026-09-20T13:38:53.1519976Z`, with at most four concurrent requests. Expected records were calculated independently from weekly matchup pairs without importing the application aggregation. It retains required manager names/account IDs, raw roster ownership/co-ownership, exact weekly team scores, and provenance; player data, avatars and unrelated metadata are omitted. Offline regression tests compare every effective manager's record and season membership, verify all weekly roster/pair coverage, and check league-wide win/loss totals.

The independent League Two roster results are 2025 Weeks 1–14 **8–6–0**, plus completed 2026 Week 1 **1–0–0**. With the newly approved attribution, Tyler's combined record is **9–6–0**, and he participates in both seasons. Eneerg does not receive that League Two record. The validated manager unions become **13 for League One, 14 for League Two and 10 for Dynasty**. Eneerg's independently earned League One/Dynasty results and championship history remain unchanged. Raw fixture ownership is preserved so the regression proves effective attribution rather than altering provider evidence to match the UI.

This release needs no migration, scoring change, or data mutation. Publish the reviewed application through the normal PR/preview/release process. Rollback is a compatible application revert; retained administration observations remain intact.
