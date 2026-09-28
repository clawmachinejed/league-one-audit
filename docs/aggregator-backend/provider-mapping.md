# Second-provider contract probe: Yahoo

Checked 2026-09-28. Design research only: official documentation and indexed official response samples, not an authenticated API session. Some direct Yahoo documentation fetches returned HTTP 429; indexed official documentation supplied the examples. No attempt was made to bypass the throttle. Current documentation still contains historical examples, so retrieval date does not make the sample data current. No credentials, user accounts, or live private leagues were accessed.

## Documented field specimen

The following field paths were observed in [Yahoo's official reference](https://sports.yahoo.com/developer/docs/). Paths abbreviate XML nesting; they are not a claim about JSON serialization. Values below are synthetic unless stated otherwise.

| Input family | Observed source paths | Proposed League One destination |
|---|---|---|
| League | `league_key`, `game_code`, `season`, `current_week` | External league-season reference and period selection |
| Freshness | `league_update_timestamp` | Resource-scoped source timestamp |
| Team | `team_key`, `managers.manager.manager_id` | External team and manager references |
| Slots | `settings.roster_positions.roster_position.{position,count}` | Counted slot definitions |
| Scoring | `stat_categories.stats.stat.stat_id`, `stat_modifiers.stats.stat.{stat_id,value}` | Versioned catalog mapping and native rules |
| Lineup | `eligible_positions.position`, `selected_position.{coverage_type,week,position,is_flex}` | Eligibility and period assignment |
| Scores | `team_points.{coverage_type,week,total}`, `player_points.total` | Official values |
| Forecasts | `team_projected_points`, `win_probability` | Separately attributed provider forecasts, if used |
| Matchups | `week_start`, `week_end`, `status`, `winner_team_key`, `is_tied`, `is_playoffs` | Period, lifecycle, authoritative outcome |
| Standings | `team_standings.{rank,playoff_seed,outcome_totals,points_for,points_against}` | Official standings snapshot |
| Transactions | `transaction_key`, `timestamp`, `status`, `players` | Transaction observation |
| History | `renew`, `renewed` | Unqualified lineage hints |
| Drafts | `/league/{league_key}/draftresults` | Draft-result capability; field shape unqualified |
| Catalog/periods | `/game/{game_key}/stat_categories`, `/game/{game_key}/game_weeks` | Versioned metadata |
| Discovery | `/users;use_login=1/games` | Authorized discovery |
| Pagination | Players: `start`, `count`; transactions: `count` | Adapter continuation state |

Yahoo keys include game/season scope. NFL rosters use weeks; other sports can use dates. League context supplies player fantasy points. Teams may have co-managers. These documented differences inform the following proposed contract choices; they do not establish launch readiness. [Yahoo reference](https://sports.yahoo.com/developer/docs/)

Sleeper's counterpart fields include `league_id`, `season`, `previous_league_id`, `roster_id`, `owner_id`, `players`, ordered `starters`, `scoring_settings`, `matchup_id`, `points`, and `custom_points`. Its roster record statistics include `wins`, `losses`, `ties`, `fpts`, and `fpts_decimal`. Transaction examples use millisecond timestamps (`created`, `status_updated`) and asset movements (`adds`, `drops`, `draft_picks`, `waiver_budget`). `state/nfl` distinguishes `week`, `leg`, and `display_week`. Sleeper documents multiple drafts per league. These are comparison facts, not proposed table names. [Sleeper reference](https://docs.sleeper.com/)

## Contract decisions proposed from this probe

These are League One design choices, not assertions of provider guarantees.

1. Use opaque, provider-qualified string references and retain their scope. Allocate internal IDs separately. Do not coerce a Yahoo composite key into an integer or assume a local roster number is globally unique. Do not infer league continuity or manager equivalence from display names.
2. Separate league continuity, a league's season instance, fantasy team season, real NFL team, and NFL athlete. A provider's fantasy game is not a real NFL game. An imported fantasy player can exist before a confident cross-provider athlete mapping exists.
3. Retain the provider-scoped stat catalog and native settings revision. A stat number is not a canonical football metric without a catalog mapping. The league selects rules; the catalog identifies what their inputs mean. Unmapped rules reduce analytics support without invalidating readable official scores.
4. Represent roster membership separately from selected lineup assignment. Preserve eligible positions, provider slot code, canonical slot category, slot instance, and requested/returned period. Do not reconstruct historical lineups from today's roster. Treat any mismatch between requested and returned period as incomplete or invalid evidence.
5. Keep official totals, individual player totals, official outcomes, provider forecasts, and League One forecasts in different fields with explicit provenance. Never manufacture reconciliation by altering an official total to match a computed sum. Commissioner adjustments and missing player details must remain representable.
6. Preserve official standings ordering and tie outcomes. A renderer must not silently replace a host rank with locally sorted points or apply the ordinary two-team win calculation to every competition. Unknown competition semantics limit derived standings.
7. Resolve each request to an explicit internal period plus native period arguments. Preserve source date boundaries as supplied; only create UTC instants when a timezone is established. Do not assume a provider's current period means today's NFL week or that all competitions use one-week matchups.
8. Use resource-level observation metadata: requested scope, returned scope, observed-at, source-updated-at when meaningful, adapter version, fingerprint, authorization scope, expected/received items, continuation, and publication revision. Fetch time does not prove source freshness. A league metadata update timestamp cannot date every roster or score.
9. Keep native status and normalized status together. Unknown native values must survive quarantine or limited publication with reasons. Distinguish successful empty collections from partial retrieval, denied access, unsupported resources, and transient failure.
10. Cache only a genuinely equivalent resource and permission scope. League-visible finalized transactions may be shared among authorized viewers; private pending actions require a narrower policy or explicit exclusion from the first release.
11. Treat ongoing reconciliation as necessary. No mutation, cursor, webhook, rate ceiling, or historical-retention guarantee is assumed from a sample or endpoint name. Do not invent transaction offset paging from the documented player pagination parameters.

## Authored normalization example

This is an invented teaching fixture, not a copied provider payload, a production schema, or live league data. The source-shaped fragments are deliberately tiny. All example identifiers and scores are fictitious. Equivalent values demonstrate a common destination; they do not imply both fragments describe the same actual league or team.

| Example | Source-shaped fields | Authored normalized interpretation |
|---|---|---|
| Sleeper | `league_id="S-example"`, `roster_id=7`, `matchup_id=3`, `points=87.25`, `custom_points=null` | Provider-scoped team reference; period required from request; official team score 87.25; ordinary matchup grouping only when validated |
| Yahoo | `league_key="G.l.L"`, `team_key="G.l.L.t.7"`, `team_points={coverage_type:"week",week:4,total:"87.25"}` | Provider-scoped team reference; returned week 4 checked against request; official team score 87.25 |

An illustrative common record could be:

```json
{
  "teamSeasonId": "internal-team-example",
  "leagueSeasonId": "internal-season-example",
  "periodId": "internal-period-example",
  "officialScore": {
    "decimal": "87.25",
    "authority": "provider-official",
    "observationId": "observation-example"
  },
  "lineup": {
    "availability": "pending",
    "assignments": null
  },
  "leagueOneForecast": {
    "support": "unavailable",
    "reason": "scoring_mapping_not_qualified",
    "value": null
  }
}
```

The normalizer creates an explicit team reference under the correct provider and league-season scope. It can publish the official score while declining to publish a forecast. It must not substitute an empty lineup, zero forecast, guessed player identity, or fabricated source timestamp. Permission and freshness metadata belong on the referenced observation/read envelope and must be checked by the reader.

## Current access evidence

Yahoo's [developer portal](https://sports.yahoo.com/developer/) describes an application, review, and approval process, OAuth 2.0 authorization, usage throttling, and attribution requirements. Its [access application](https://sports.yahoo.com/developer/access/) says write access is not available at present. The reference still discusses write operations; an endpoint's documentation therefore must not be treated as approval or entitlement. Read-only aggregation is the scope of this design. No Yahoo approval for League One was established in this probe.

Yahoo's [authorization-code guide](https://developer.yahoo.com/oauth2/guide/flows_authcode/) documents access-token expiry, refresh-token replacement, and revocation. It also marks the token response's legacy user-GUID claim deprecated in favor of OpenID Connect identity. Proposed design: credentials stay server-side, token replacement is atomic, connection health is separate from league freshness, and OAuth identity must not be guessed from a league-local manager number.

Sleeper's [current documentation](https://docs.sleeper.com/) describes a tokenless read-only API, free non-commercial use, and contacting Sleeper for commercial licensing. Public accessibility does not itself establish permission for the planned commercial product. This probe does not change existing integrations or determine their agreements.

## Evidence sufficient for design; gaps before pilot launch

The specimen is sufficient to reject Sleeper-shaped universal identities, a single lineup-position field, a single undifferentiated points value, one global last-updated value, and treating a returned collection as necessarily complete. It supports drafting a provider-neutral contract and meaningful conformance fixtures now.

Before Yahoo pilot launch, obtain approved access and authorized, sanitized current-season captures that qualify:

- Account discovery and exact relationship between authenticated identity, team ownership, manager identity, and co-manager access; access revocation and reauthorization.
- Private/public league permissions, viewer-dependent fields, caching, retention, redistribution, attribution, and commercial-use conditions.
- Current settings, stat catalog, point rules, native slot eligibility, defenses, commissioner adjustments, and stat corrections. Require runtime validation; published examples are not complete schemas.
- Current, past, and future requested-week roster correctness; bench, reserve, empty slots, players changing team, and undocumented status values.
- Scoreboard, team and player totals, official standings, ties, nonstandard matchup structures, multiweek play, playoff/consolation fixtures, and unknown future competition types. Do not infer support for median, best ball, or second opponents from generic descriptions.
- Transactions with safe pagination and mutation during traversal, restricted pending actions, all relevant asset movements, and correct timestamp units. Verify duplicate handling, stable identifiers, and completeness semantics.
- Actual draft-result payloads, retained season discovery, renewal relationships, and historical coverage. A documented draft/history route does not prove all history required by our screens is available.
- Serialization chosen by the adapter, empty/singleton collection shapes, throttling/retry signals, request budgeting, timeout behavior, and operational freshness under realistic workload.

These are implementation qualification gates, not blockers to finishing the backend design. Until qualified, feature support is `unverified`, or explicitly `limited`/`unavailable` where evidence establishes that outcome; completeness and freshness may independently be `unknown`. Preserve provider evidence and do not claim complete Yahoo support.
