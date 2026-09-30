# Internal season overview composition

B2 prepares internal resources for checklist rows 17, 21, 22, 26, 28, 29 and 30,
plus the current record/rank part of row 9 and current waiver state part of row
23. The [Step 2 checklist](step-2-checklist.md) remains the sole status ledger.
Public and account reader adoption is Step 3. Transaction and claim activity is
B3; historical annual lineage and cross-resource readiness remain separate.

## Inventory and scope

The accepted current-roster query already selects the immutable raw roster
capture, its hash, source mapping, receipt and season-team identities. B2 can
project exact official season facts from that same validated capture. No new
table, migration, capture, writer, worker, cache or publication is needed for
this projection. Its optional fields have independent coverage: the existing
players-only acceptance does not establish standings or waiver completeness.

`normalizeTeams` and `compareTeams` remain the compatibility presentation for
Standings. Their missing-value defaults and hundredth-point rounding are not
canonical official facts. Exact W-L-T and PF/PA source components stay separate
from that view. A source rank is not inferred from the local order. Rosters keeps
its separate `compareRosterStandings` policy, including its omission of PA.

Schedules compose B1 native-period and season-team identities with
`buildMyTeamScheduleWeeks` and `selectTeamSchedule`. My Team covers Weeks 1–15;
manager profiles cover Weeks 1–14. Loading remains an explicit, bounded request.
Official score values determine results without display rounding; custom zero
remains an override. Calendar-supported local completion is distinct from
provider finality. Missing or ambiguous pairing is never an invented bye.

Projected standings reuse `buildCompletedStandingsBasis`,
`reconcileStandingsBasis` and `projectStandings`. Their existing hundredth-point
calculation is a derived compatibility result, not an exact official aggregate.
The table can preserve partial projection coverage; current/projected card rank
requires the existing whole-league coverage. Current record/rank overlays stay
current even when attached to a historical matchup.

Roster summaries reuse `calculateTeamPpg`, `rosterHistoryBoundary` and the
existing weekly metric boundary. Player metric references retain the exact
all-player query and result. The store has no immutable metric-publication
ledger; a cutoff result must not be presented as such a publication. Its 4 AM
Eastern cutoff stays independent of the noon Eastern display-period rollover.
Manager ownership reuses accepted team-manager identities; separately dated
user metadata and curated display attribution do not establish ownership.

## Qualification limits

B1 retained matchup manifests and their immutable source reads remain the
source of retained matchup comparison. B2 comparison can freeze its composed
inputs, transformation version and cursor for deterministic interruption/retry.
Such comparison is not database-persisted replay or a durable materialization
checkpoint. No production replay or backfill is authorized or implied.

Historical slot/configuration/calendar/source proof and dated metadata limits
remain visible. A missing or stale derived feature does not suppress reliable
official facts. Current accepted roster/manager resources do not prove their
historical applicability. Reconstructing a historical B2 current-state capture
requires retained evidence of that exact capture, not today's accepted head.

This work does not apply or repeat migrations 030–032, change role grants, or
qualify newly provisioned runtime roles. Existing production-role qualification
is separate. Preview persistence remains disabled; preview checks establish
public behavior, not production B2 coverage.

## Real-store acceptance qualification

The B2 acceptance continuation uses the existing disposable Neon harness and
synthetic captures to exercise `createBundleTwoReader` through its restricted
runtime connection. The same capture is retained for exact field comparisons;
existing administration acceptance, B1 matchup reads, snapshot publication and
all-player metric storage remain the sole paths. A passing deterministic build
or persistence-disabled Preview does not execute these SQL fixtures.

Qualification must record the clean reviewed SHA, complete SQL totals/skips and
the supervisor receipt proving child closure, schema cleanup, credential
revocation and branch deletion. The protected run requires separate approval;
the remaining balance of the earlier cumulative USD10 allowance is unknown.
Current production B2 population and historical applicability remain unverified.

Fresh-role provisioning is a separate gate. Source review confirms that
`030_exact_period_matchups.sql` revokes PUBLIC execution of
`begin_exact_matchup_attempt(jsonb,uuid,integer,jsonb)` and grants it only when
`league_one_runtime` already exists. `provision-runtime-role.sql` does not grant
that function when creating the role later. The normal disposable supervisor
creates roles before migrations, so its pass would not qualify that later
bootstrap order. This is independently checked source control-flow evidence,
not a live SQL reproduction or a permissions repair. No grants are changed by
the B2 fixtures.
