# Full aggregator backend planning coverage

This readable matrix is generated from [backend-coverage.json](backend-coverage.json). Allocates every known approved aggregator domain and current backend compatibility dependency to an owner, selected approach, milestone and falsifiable acceptance. This is full build planning, not completed implementation, complete physical design for every later phase, universal provider support, or proof that all 181 method-inventory entries are mandatory or performed.

**Status:** known scope allocated; target implementation and empirical qualification are not complete. README.md remains the target entry point. Approved user behavior and explicitly delegated lead decisions take precedence. backend-decisions.json owns D03-D05 and ENG01-ENG08 choices; this allocation neither changes D02 nor duplicates runtime DTO authority. Existing source owners are reuse evidence, not proof that the target behavior is installed.

Application baseline: 87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f. Documentation input: e2a37d99d637baf80f1f29db597d75a69d3a78bd. Planning date: 2026-10-06. The [build plan](backend-build-plan.md) sequences delivery; [lead decisions](backend-decisions.md) owns the selected D03–D05 and ENG01–ENG08 policies. Their values are planning choices, not deployed configuration.

The 69 stable BC obligations below cover 20 domains, 16 existing owners and seven milestones. Ten contract-surface groups identify required data families beyond the detailed first-slice ledger. These counts establish allocation only; neither generic family names nor retained raw JSON complete a typed capability.

## Milestones and phase entry

| Milestone | Depends on | Exit intent |
| --- | --- | --- |
| BC-M0 — Plan and design closure | None | Review full-scope coverage, delegated decisions, exact first-slice ERD/DDL/interfaces/security and validation plan. No runtime or production work is implied. |
| BC-M1 — Shared identity, current teams and authorized reads | BC-M0 | Implement and qualify first-slice account, acquisition admission, discovery, current selection and guarded shared roster reads through existing owners. |
| BC-M2 — Complete official current-season resources | BC-M1 | Generalize supported official family composition and resumable current-season import/remaining published schedule; keep legacy presenters isolated. |
| BC-M3 — Shared NFL and analytical feature composition | BC-M2 | Join existing NFL facts, scorer, immutable baselines, forecasts, metrics and probabilities with capability-specific coverage. |
| BC-M4 — Coexistence, capacity, cost and operational qualification | BC-M1, BC-M2, BC-M3 | Measure the selected workload and lead-defined objectives; prove fairness, failure handling, recovery, access and retention before launch claims. |
| BC-M5 — Incremental reader adoption and release | BC-M4 | Qualify compatibility/shadow comparisons, authorized additive migration, guarded cutover, rollback and exact-release evidence. |
| BC-M6 — Future authorized provider adapter | BC-M5 | Later separate provider authorization, adapter and real-data qualification; no Yahoo/ESPN delivery date or access entitlement is promised. |

A milestone cannot enter implementation until its detailed outputs and dependencies are reviewed. The plan allocates that design work now; it does not call absent physical artifacts completed.

Each phase-entry package must include:

- Exact closed runtime fields, scalar/null/unknown domains, key/relationship and source/effective-time semantics for the affected family.
- Existing-column/JSON/derived-view mapping or justified additive DDL/functions/indexes/grants with constraints and rollback; no table created solely to mirror this matrix.
- Independent fixture bytes and expected values, actual writer/reader call paths, adversarial/unknown/failure schedules, and safe executable evidence protocol.
- Dependency review against D02, delegated D/ENG decisions, resource audience, existing capacity lanes and preservation/compatibility gates.

## Source needs and authority

| Need | Source / anchor | Scope |
| --- | --- | --- |
| N01 | [../../README.md](../../README.md) — Product mission | One manager home across supported league providers, with shared official views and independent League One analytics. [approved_need_or_repository_constraint] |
| N02 | [evidence/backend-workspace-handoff.md](evidence/backend-workspace-handoff.md) — Sleeper first; other providers are future adapters. | Sleeper read-only identification now; future provider adapters and authorization remain later qualified integrations. [approved_need_or_repository_constraint] |
| N03 | [evidence/backend-workspace-handoff.md](evidence/backend-workspace-handoff.md) — One active provider account per L1 user per provider | Exclusive active associations; separate login, provider identity, acquisition, membership and preferences. [approved_need_or_repository_constraint] |
| N04 | [evidence/backend-workspace-handoff.md](evidence/backend-workspace-handoff.md) — Require a current owned or co-managed team. | Owner/co-manager eligibility and independent multi-user effects; incomplete evidence cannot establish removal. [approved_need_or_repository_constraint] |
| N05 | [evidence/backend-workspace-handoff.md](evidence/backend-workspace-handoff.md) — Current teams advance per league | Verified renewal, mixed years, completed current seasons and newer unfollow precedence; prior-season browsing not required now. [approved_need_or_repository_constraint] |
| N06 | [evidence/backend-workspace-handoff.md](evidence/backend-workspace-handoff.md) — Eventually import all recoverable current-season competitive history | Official current/history/published future schedule with native settings/provenance and independent analytics coverage. [approved_need_or_repository_constraint] |
| N07 | [evidence/backend-workspace-handoff.md](evidence/backend-workspace-handoff.md) — Use each league's actual scoring, roster slots, eligibility and competition settings. | Actual rule interpretation and shared NFL statistics/projections/game state/availability; preserve frozen/live distinction. [approved_need_or_repository_constraint] |
| N08 | [evidence/backend-workspace-handoff.md](evidence/backend-workspace-handoff.md) — Collect shared resources once wherever permissions permit | Shared collection, offline followed maintenance, active aggregate promotion, truthful staleness and response ordering. [approved_need_or_repository_constraint] |
| N09 | [evidence/backend-workspace-handoff.md](evidence/backend-workspace-handoff.md) — Qualification target: 500 distinct leagues per supported provider | 500 all-watched coexistence workload, measured approximately 60-second additional score delay and separate supporting-feed cost target. [approved_need_or_repository_constraint] |
| N10 | [evidence/backend-policy-register.json](evidence/backend-policy-register.json) — max_membership_age_seconds | Approved strict D02=3600; no failed/cache/replay extension, earlier removal/expiry, independent revalidation and L1 sign-in. [approved_need_or_repository_constraint] |
| N11 | [../../AGENTS.md](../../AGENTS.md) — Never duplicate an existing worker | Reuse existing owner architecture, preserve routes/payloads/exact-week/clock-v1/immutable baselines and unrelated leagues. [approved_need_or_repository_constraint] |
| N12 | [../../AGENTS.md](../../AGENTS.md) — Never run destructive integration tests against production. | Isolated implementation/review, no secrets/production test writes, protected release with exact SHA and both-league evidence. [approved_need_or_repository_constraint] |
| N13 | [screen-data-map.md](screen-data-map.md) — Required canonical field categories beyond the visible cards | Detailed existing field groups and backend dependencies; inventory is candidate design, revalidated against current source. [candidate_inventory_supported_by_current_source] |
| N14 | [evidence/backend-workspace-handoff.md](evidence/backend-workspace-handoff.md) — Open product decisions: D03 | Claim recovery, genuine loss/regain follows and last-follower lifecycle use the lead engineer's separately recorded delegated decisions. [approved_need_or_repository_constraint] |
| N15 | [https://docs.sleeper.com/](https://docs.sleeper.com/) — For commercial use of the Sleeper API | Sleeper currently describes free non-commercial access and directs commercial users to discuss licensing; obtain applicable terms/permission before commercial activation. [official_provider_documentation_checked_2026-10-06] |
| N16 | [backend-decisions.md](backend-decisions.md) — ENG08 — Privacy, provenance retention and disposal | Lead-selected reliability, actor export/deletion, reference-aware retention and operational accountability extend the product brief within delegated planning authority. [delegated_engineering_policy_not_deployed] |

N14 preserves the original unresolved-decision history. The user subsequently delegated decisions to the lead engineer; the current decision ledger supplies D03–D05. The original D02 approval is unchanged. Sleeper commercial licensing is an external activation requirement, not a purchase or outreach authorization.

## Existing responsibility owners

| Owner | Source modules | Design evidence |
| --- | --- | --- |
| ACCOUNT — Account/auth owner | [apps/site/lib/accounts/auth.ts](../../apps/site/lib/accounts/auth.ts); [apps/site/lib/accounts/store.ts](../../apps/site/lib/accounts/store.ts); [apps/site/lib/accounts/http.ts](../../apps/site/lib/accounts/http.ts) | [contracts.md](contracts.md); [relational-design.md](relational-design.md); [behavior-security-design.md](behavior-security-design.md) |
| DISCOVERY — Existing account discovery/onboarding owner | [apps/site/lib/accounts/sleeper-discovery.ts](../../apps/site/lib/accounts/sleeper-discovery.ts); [apps/site/lib/accounts/sleeper-link-preview.ts](../../apps/site/lib/accounts/sleeper-link-preview.ts); [apps/site/lib/accounts/onboarding.ts](../../apps/site/lib/accounts/onboarding.ts) | [contracts.md](contracts.md); [relational-design.md](relational-design.md) |
| ADMIN — Shared administration acquisition/normalization/persistence owner | [apps/site/lib/league-administration/runtime.ts](../../apps/site/lib/league-administration/runtime.ts); [apps/site/lib/league-administration/normalize.ts](../../apps/site/lib/league-administration/normalize.ts); [apps/site/lib/league-administration/maintenance.ts](../../apps/site/lib/league-administration/maintenance.ts); [apps/site/lib/league-administration/neon/administration.ts](../../apps/site/lib/league-administration/neon/administration.ts) | [contracts.md](contracts.md); [mapping-revisions.md](mapping-revisions.md); [league-season-settings.md](league-season-settings.md) |
| PERIOD — Native period and calendar owner | [apps/site/lib/league-administration/period-mapping.ts](../../apps/site/lib/league-administration/period-mapping.ts); [apps/site/lib/site-calendar-authority.ts](../../apps/site/lib/site-calendar-authority.ts); [apps/site/lib/matchup-period.ts](../../apps/site/lib/matchup-period.ts) | [exact-period-matchups.md](exact-period-matchups.md); [league-season-settings.md](league-season-settings.md) |
| ROSTER — Shared current-roster/team-manager owner | [apps/site/lib/aggregator/current-roster.ts](../../apps/site/lib/aggregator/current-roster.ts); [apps/site/lib/aggregator/team-managers.ts](../../apps/site/lib/aggregator/team-managers.ts); [apps/site/lib/aggregator/current-roster-groups.ts](../../apps/site/lib/aggregator/current-roster-groups.ts) | [current-roster-acceptance.md](current-roster-acceptance.md); [team-manager-relationships.md](team-manager-relationships.md); [contracts.md](contracts.md) |
| MATCHUP — Exact-matchup/B1 composition owner | [apps/site/lib/aggregator/exact-matchups.ts](../../apps/site/lib/aggregator/exact-matchups.ts); [apps/site/lib/aggregator/bundle-one.ts](../../apps/site/lib/aggregator/bundle-one.ts); [apps/site/lib/aggregator/exact-matchup-reader.ts](../../apps/site/lib/aggregator/exact-matchup-reader.ts) | [exact-period-matchups.md](exact-period-matchups.md); [exact-matchup-compatibility.md](exact-matchup-compatibility.md) |
| SEASON — Season-overview/B2 owner | [apps/site/lib/aggregator/bundle-two.ts](../../apps/site/lib/aggregator/bundle-two.ts); [apps/site/lib/aggregator/season-overview-source-contracts.ts](../../apps/site/lib/aggregator/season-overview-source-contracts.ts); [apps/site/lib/aggregator/season-overview-schedules.ts](../../apps/site/lib/aggregator/season-overview-schedules.ts) | [season-overview.md](season-overview.md); [screen-data-map.md](screen-data-map.md) |
| ACTIVITY — Transaction capture/B3 owner | [apps/site/lib/aggregator/transaction-activity-contracts.ts](../../apps/site/lib/aggregator/transaction-activity-contracts.ts); [apps/site/lib/aggregator/transaction-activity.ts](../../apps/site/lib/aggregator/transaction-activity.ts); [apps/site/lib/league-administration/neon/transactions.ts](../../apps/site/lib/league-administration/neon/transactions.ts) | [transaction-activity.md](transaction-activity.md) |
| HISTORY — Historical-continuity/B4 owner | [apps/site/lib/aggregator/bundle-four.ts](../../apps/site/lib/aggregator/bundle-four.ts); [apps/site/lib/aggregator/historical-continuity.ts](../../apps/site/lib/aggregator/historical-continuity.ts); [apps/site/lib/manager-history.ts](../../apps/site/lib/manager-history.ts) | [historical-continuity.md](historical-continuity.md); [retained-matchup-comparison.md](retained-matchup-comparison.md) |
| NFL — Shared NFL adapter/runtime owner | [apps/site/lib/projections/runtime/shared-services.ts](../../apps/site/lib/projections/runtime/shared-services.ts); [apps/site/lib/projections/adapters/tank01/projection-feed.ts](../../apps/site/lib/projections/adapters/tank01/projection-feed.ts); [apps/site/lib/projections/adapters/tank01/game-state-feed.ts](../../apps/site/lib/projections/adapters/tank01/game-state-feed.ts); [apps/site/lib/projections/adapters/sleeper/all-player-stats.ts](../../apps/site/lib/projections/adapters/sleeper/all-player-stats.ts) | [../all-player-statistics.md](../all-player-statistics.md); [../lineup-freshness.md](../lineup-freshness.md) |
| ANALYTICS — Single scorer/forecast/snapshot owner | [apps/site/lib/projections/domain/scoring.ts](../../apps/site/lib/projections/domain/scoring.ts); [apps/site/lib/projections/domain/live-calculation.ts](../../apps/site/lib/projections/domain/live-calculation.ts); [apps/site/lib/projections/domain/win-probability.ts](../../apps/site/lib/projections/domain/win-probability.ts); [apps/site/lib/projected-standings.ts](../../apps/site/lib/projected-standings.ts) | [../lineup-freshness.md](../lineup-freshness.md); [../live-defense-projections.md](../live-defense-projections.md); [../matchup-win-probability.md](../matchup-win-probability.md) |
| METRICS — Shared all-player statistics/eligibility owner | [apps/site/lib/projections/domain/all-player-statistics.ts](../../apps/site/lib/projections/domain/all-player-statistics.ts); [apps/site/lib/projections/domain/all-player-eligibility.ts](../../apps/site/lib/projections/domain/all-player-eligibility.ts); [apps/site/lib/projections/adapters/neon/all-player-metrics.ts](../../apps/site/lib/projections/adapters/neon/all-player-metrics.ts) | [../all-player-statistics.md](../all-player-statistics.md); [../weekly-roster-metrics.md](../weekly-roster-metrics.md); [../all-player-eligibility.md](../all-player-eligibility.md) |
| WORKER — Existing scheduled lanes/job repository/publication owner | [apps/site/lib/projections/runtime/projection-composition.ts](../../apps/site/lib/projections/runtime/projection-composition.ts); [apps/site/lib/projections/runtime/future-projection-composition.ts](../../apps/site/lib/projections/runtime/future-projection-composition.ts); [apps/site/lib/projections/runtime/lineup-observation-composition.ts](../../apps/site/lib/projections/runtime/lineup-observation-composition.ts); [apps/site/lib/projections/adapters/neon/job-repository.ts](../../apps/site/lib/projections/adapters/neon/job-repository.ts) | [../lineup-freshness.md](../lineup-freshness.md); [../future-week-projections.md](../future-week-projections.md); [calculation-source-history.md](calculation-source-history.md) |
| READERS — Existing account/portfolio/shared read owner | [apps/site/lib/accounts/fantasy.ts](../../apps/site/lib/accounts/fantasy.ts); [apps/site/lib/accounts/library.ts](../../apps/site/lib/accounts/library.ts); [apps/site/lib/my-fantasy.ts](../../apps/site/lib/my-fantasy.ts); [apps/site/lib/projection-reader.ts](../../apps/site/lib/projection-reader.ts) | [screen-data-map.md](screen-data-map.md); [step-2-checklist.md](step-2-checklist.md); [contracts.md](contracts.md) |
| OPERATIONS — Existing worker/account diagnostics and release operator | [apps/site/lib/projections/ports/logger.ts](../../apps/site/lib/projections/ports/logger.ts); [apps/site/lib/accounts/http.ts](../../apps/site/lib/accounts/http.ts); [apps/site/vercel.json](../../apps/site/vercel.json) | [quality-operations.md](quality-operations.md); [../collection-capacity-validation.md](../collection-capacity-validation.md); [../release-validation.md](../release-validation.md) |
| RELEASE — Repository/migration/harness/review owners | [docs/release-validation.md](../../docs/release-validation.md); [apps/site/integration/README.md](../../apps/site/integration/README.md); [AGENTS.md](../../AGENTS.md) | [migration.md](migration.md); [reconciliation.md](reconciliation.md); [verification.md](verification.md) |

Source modules establish reuse boundaries. Their presence or historical implementation notes do not prove this target is installed, every new combination is safe, or a current runtime test passed.

## Contract surface and domain allocation

### CF01 — Evidence and scope

**Existing type/owner anchors:** `apps/site/lib/aggregator/contracts.ts:SourceScope, ProviderReference, FieldGroup<T>`; `foundation.json:ResourceEvidence, DependencyRef`.

**Required field groups:** provider/kind/namespace/native ID; leagueSeason/sourceConnection/audience/access-context/mapping revision; immutable attempt/capture/acceptance/version refs; source event time nullable; request/observation/verification/persistence/calculation/publication times distinct; per-resource coverage, availability, freshness and feature support.

**Representation plan:** Reuse existing receipt/head/immutable-source owners. Preserve each qualified field type's exact state union; do not collapse unknown/absent/null/empty/zero into one default.

**Allocated obligations:** BC010, BC012, BC044, BC053.

### CF02 — Official settings and periods

**Existing type/owner anchors:** `apps/site/lib/aggregator/league-settings.ts:LeagueSettingsValue`; `apps/site/lib/aggregator/exact-matchups.ts:NativeMatchupPeriod`.

**Required field groups:** native scoring/roster/competition/waiver dialect and raw settings; ordered slot identity/count/eligibility; native period and separately evidenced NFL mapping; source lifecycle/finality distinct from local completion.

**Representation plan:** Extend existing typed B1/settings projections and compatibility adapters; no universal week1-14 or current global year assumption.

**Allocated obligations:** BC013, BC015, BC016, BC020, BC027.

### CF03 — Official roster, scores and standings

**Existing type/owner anchors:** `apps/site/lib/aggregator/exact-matchups.ts:ExactMatchupTeam`; `apps/site/lib/aggregator/season-overview-source-contracts.ts:SeasonOverviewTeamFacts`.

**Required field groups:** ordered slots/vacancies/point-source; exact-period nonstarter vs bench applicability; current reserve/taxi; raw/custom/effective team score and adjustment evidence; W/L/T/PF/PA/provider rank/seed/division versus local ordering; metadata effective/as-of time.

**Representation plan:** Project qualified facts from the same immutable capture; keep current metadata and legacy formatting separate. Do not assert recovered lexical precision beyond parsed source values.

**Allocated obligations:** BC017, BC018, BC019, BC021.

### CF04 — Activity and administrative assets

**Existing type/owner anchors:** `apps/site/lib/aggregator/transaction-activity-contracts.ts:TransactionActivityEvent, TransactionActivityPage`.

**Required field groups:** event/participant native and canonical IDs; player/pick/FAAB movements; source timestamps/status/type/claim visibility; native week/window/page cursor/revision/coverage; draft/bracket source refs and supported typed capability.

**Representation plan:** Reuse B3 retained selections and administration evidence. Preserve supplied-only claims, unknown times and week0; qualify typed draft/bracket fields at BC-M2 entry.

**Allocated obligations:** BC022, BC023, BC024, BC025.

### CF05 — Season import coverage and resume

**Existing type/owner anchors:** `apps/site/lib/league-administration/contracts.ts:existing source/capture/job owner`; `apps/site/lib/aggregator/transaction-activity-contracts.ts:sourceCoverage`.

**Required field groups:** run/request identity and plan version; leagueSeason/sourceConnection/mapping/audience binding; declared resource/native-period/page unit set; per-unit pending/complete/partial/unavailable/unpublished/unsupported/conflict disposition and evidence refs; continuation/checkpoint and terminal state; current-season coverage versus broader history limitation.

**Representation plan:** Selected SeasonCoverageManifest is a projection of immutable receipts plus a durable checkpoint in the existing administration job system. Phase BC-M2 must specify exact closed job-payload schema, idempotency/size bounds, storage constraints and reader shape; no new acquisition pipeline is selected.

**Allocated obligations:** BC024, BC026, BC027, BC028.

### CF06 — Shared NFL source facts

**Existing type/owner anchors:** `apps/site/lib/projections/domain/contracts.ts:ProjectionSlate, GameStateObservation, NflWeekSchedule`; `apps/site/lib/projections/domain/all-player-observation-evidence.ts:AllPlayerStatObservation`.

**Required field groups:** player/defense identity and crosswalk revisions; game/season/type/week and assignment/bye evidence; sparse statistics/whole capture and source coverage; projection raw statistics/slate checks; availability/participation/effective metadata.

**Representation plan:** One shared NFL layer through existing providers and ports; source-specific provenance never becomes host-fantasy official authority.

**Allocated obligations:** BC030, BC031, BC032, BC033, BC034, BC035.

### CF07 — Analytical outputs

**Existing type/owner anchors:** `apps/site/lib/projections/domain/contracts.ts:CanonicalScoringProfile, ProjectedMatchupSnapshot`; `apps/site/lib/projections/domain/all-player-statistics.ts:AllPlayerScoreSet`.

**Required field groups:** scorer/profile/model revisions; immutable baseline versus live phase contribution; official actuals vs computed actual statistics; probability status/team identity; projected standings/metric cutoff/denominator/population coverage; exact source refs and calculation/publication time.

**Representation plan:** Reuse single scorer, clock-v1, defensive model, probability/metric owners and publication path. Version outputs and retain reader support during rollback.

**Allocated obligations:** BC036, BC037, BC038, BC039, BC040, BC041.

### CF08 — Portfolio/private serving

**Existing type/owner anchors:** `foundation.json:DiscoverCurrentTeamsResult, ReadCurrentRosterResult`; `apps/site/lib/accounts/contracts.ts:existing account view contracts`.

**Required field groups:** account/library relationship and per-league current team; explicit preference revision versus effective eligible demand; per-card period/coverage and aggregate denominator; safe public response and server-only authority envelope.

**Representation plan:** Compose server-side from shared facts with final actor/audience checks. New reader contracts are qualified before public/website adoption.

**Allocated obligations:** BC002, BC006, BC007, BC008, BC042, BC043, BC052.

### CF09 — Demand, permits and operational evidence

**Existing type/owner anchors:** `apps/site/lib/projections/adapters/neon/job-repository.ts:existing durable job owner`; `backend-decisions.json:ENG01-ENG08`; `quality-operations.md:typed diagnostic contract`.

**Required field groups:** demand/cohort/intent and admission ownership; actual-start permit accounting and expiry; job lease/deadline/continuation/pending acknowledgment; queue/capture/publication latency with uncertainty; safe counters/reasons and restricted retention.

**Representation plan:** Selected continuous mode remains the same worker pipeline and sole lane ownership; exact admission and auth lifetime schemas come from the companion first-slice design. Measurements and licensing remain qualification evidence.

**Allocated obligations:** BC011, BC046, BC047, BC048, BC049, BC050, BC051, BC055, BC056, BC058.

### CF10 — Privacy and operational lifecycle

**Existing type/owner anchors:** `apps/site/lib/accounts/store.ts: account-owned records`; `apps/site/lib/projections/ports/logger.ts: operational logging port`.

**Required field groups:** actor export/delete operation scope, state, delivery authorization and expiry; retention class/time origin, reference closure, hold disposition, sweep checkpoint and backup restoration disposition; eligible-read SLI/error-budget classification, visible-render freshness and accountable escalation.

**Representation plan:** BC-M4 phase entry must supply exact types, ownership, storage and privilege contracts for these new operations; this matrix selects scope and independent acceptance without claiming existing implementation.

**Allocated obligations:** BC055, BC058, BC067, BC068, BC069.

## Full obligation inventory

| ID / obligation | Domain | Need | Owner | Milestone | Decisions | Acceptance |
| --- | --- | --- | --- | --- | --- | --- |
| BC001 — Canonical ownership and incremental composition | governance | N01, N11, N12 | RELEASE | BC-M0 | ENG07 | V-BC001 |
| BC002 — Independent L1 session and account lifecycle | identity | N03, N10 | ACCOUNT | BC-M1 | ENG01 | V-BC002 |
| BC003 — Read-only stable provider identification | identity | N02, N03 | DISCOVERY | BC-M1 | ENG02 | V-BC003 |
| BC004 — Exclusive provider association and mistaken claim | identity | N03, N14 | ACCOUNT | BC-M1 | D03, ENG01, ENG08 | V-BC004 |
| BC005 — Current owner/co-manager eligibility | identity | N04 | ROSTER | BC-M1 | ENG01 | V-BC005 |
| BC006 — Strict D02 expiry and independent recovery | identity | N10, N08 | ACCOUNT | BC-M1 | ENG01, ENG02 | V-BC006 |
| BC007 — Per-league current season and verified renewal | identity | N05 | ACCOUNT | BC-M1 | D04, ENG01 | V-BC007 |
| BC008 — Preferences, disconnection and regained membership | identity | N03, N04, N05, N14 | ACCOUNT | BC-M1 | D03, D04, D05, ENG04 | V-BC008 |
| BC009 — Resumable complete-scope current-team discovery | discovery | N02, N04, N05 | DISCOVERY | BC-M1 | ENG02, ENG05 | V-BC009 |
| BC010 — Access context and permission-aware sharing | acquisition | N02, N03, N08 | ADMIN | BC-M1 | ENG01, ENG02, ENG05 | V-BC010 |
| BC011 — Atomic admission and durable account-to-worker commands | acquisition | N08, N09 | ADMIN | BC-M1 | ENG01, ENG02, ENG03 | V-BC011 |
| BC012 — Immutable evidence, versioned heads and corrections | evidence | N06, N08, N10 | ADMIN | BC-M1 | ENG01, ENG07 | V-BC012 |
| BC013 — League metadata, lifecycle and native settings | official | N06, N07, N13 | ADMIN | BC-M2 | ENG05 | V-BC013 |
| BC014 — Stable leagues, annual team and manager references | official | N03, N05, N06 | ADMIN | BC-M2 | ENG05 | V-BC014 |
| BC015 — Native periods and separate NFL calendar mapping | official | N06, N07, N11 | PERIOD | BC-M2 | ENG05 | V-BC015 |
| BC016 — Roster slots and eligibility rules | official | N07, N13 | ROSTER | BC-M2 | Existing preserved behavior / selected plan | V-BC016 |
| BC017 — Current held roster and groups | official | N06, N07 | ROSTER | BC-M2 | Existing preserved behavior / selected plan | V-BC017 |
| BC018 — Exact-period ordered lineups and player scores | official | N06, N07, N13 | MATCHUP | BC-M2 | Existing preserved behavior / selected plan | V-BC018 |
| BC019 — Provider-authoritative team score and adjustments | official | N01, N06, N13 | MATCHUP | BC-M2 | Existing preserved behavior / selected plan | V-BC019 |
| BC020 — Matchup grouping, results and finality | official | N01, N06, N07 | MATCHUP | BC-M2 | Existing preserved behavior / selected plan | V-BC020 |
| BC021 — Season-to-date standings and source rank | official | N01, N06 | SEASON | BC-M2 | Existing preserved behavior / selected plan | V-BC021 |
| BC022 — Current waiver state and actual policy | official | N06, N07, N13 | SEASON | BC-M2 | Existing preserved behavior / selected plan | V-BC022 |
| BC023 — Transaction event and asset coverage | official | N01, N06, N13 | ACTIVITY | BC-M2 | Existing preserved behavior / selected plan | V-BC023 |
| BC024 — Transaction continuation, filters and corrections | official | N06, N08 | ACTIVITY | BC-M2 | Existing preserved behavior / selected plan | V-BC024 |
| BC025 — Draft and playoff administrative evidence | official | N06, N13 | ADMIN | BC-M2 | ENG05 | V-BC025 |
| BC026 — Full recoverable current-season import | official | N06, N08 | ADMIN | BC-M2 | ENG02, ENG04, ENG05 | V-BC026 |
| BC027 — Remaining provider-published schedule | official | N06, N07 | SEASON | BC-M2 | Existing preserved behavior / selected plan | V-BC027 |
| BC028 — Historical continuity and curated attribution | history | N01, N05, N06 | HISTORY | BC-M2 | ENG04, ENG05 | V-BC028 |
| BC029 — Official data independent of analytics support | capability | N01, N06, N07 | ADMIN | BC-M2 | ENG05 | V-BC029 |
| BC030 — Shared football identities and catalog metadata | nfl | N07, N08 | NFL | BC-M3 | Existing preserved behavior / selected plan | V-BC030 |
| BC031 — NFL schedules, assignment and bye evidence | nfl | N07, N11 | NFL | BC-M3 | Existing preserved behavior / selected plan | V-BC031 |
| BC032 — Shared game state, clocks and plausibility | nfl | N07, N11 | NFL | BC-M3 | Existing preserved behavior / selected plan | V-BC032 |
| BC033 — Actual NFL statistics and box-score detail | nfl | N07, N13 | METRICS | BC-M3 | Existing preserved behavior / selected plan | V-BC033 |
| BC034 — Reliable availability and participation | nfl | N07, N13 | METRICS | BC-M3 | Existing preserved behavior / selected plan | V-BC034 |
| BC035 — Shared projection-statistics slate | nfl | N07, N08 | NFL | BC-M3 | Existing preserved behavior / selected plan | V-BC035 |
| BC036 — Actual league scoring and rules provenance | analytics | N07, N11 | ANALYTICS | BC-M3 | Existing preserved behavior / selected plan | V-BC036 |
| BC037 — Immutable pregame baseline and missing policy | analytics | N07, N11 | ANALYTICS | BC-M3 | Existing preserved behavior / selected plan | V-BC037 |
| BC038 — Live projected finish and defensive model | analytics | N07, N11 | ANALYTICS | BC-M3 | Existing preserved behavior / selected plan | V-BC038 |
| BC039 — Win probability with honest model status | analytics | N01, N07 | ANALYTICS | BC-M3 | Existing preserved behavior / selected plan | V-BC039 |
| BC040 — Projected standings separate from official baseline | analytics | N01, N07 | ANALYTICS | BC-M3 | Existing preserved behavior / selected plan | V-BC040 |
| BC041 — Roster actual metrics, PPG and position ranks | analytics | N01, N07, N13 | METRICS | BC-M3 | Existing preserved behavior / selected plan | V-BC041 |
| BC042 — Account library and selected team continuity | readers | N01, N03, N05 | READERS | BC-M1 | ENG01 | V-BC042 |
| BC043 — Portfolio aggregate and partial analytical coverage | readers | N01, N05, N07 | READERS | BC-M3 | Existing preserved behavior / selected plan | V-BC043 |
| BC044 — Resource freshness and versioned reader envelopes | readers | N06, N08 | READERS | BC-M2 | Existing preserved behavior / selected plan | V-BC044 |
| BC045 — Compatibility presenters and revision adoption | readers | N11, N13 | READERS | BC-M5 | ENG07 | V-BC045 |
| BC046 — Followed maintenance and active-view promotion | freshness | N08, N09 | WORKER | BC-M4 | ENG02, ENG03, D05 | V-BC046 |
| BC047 — Exact-current-future scheduling and ownership | freshness | N07, N08, N11 | WORKER | BC-M4 | ENG03 | V-BC047 |
| BC048 — Leases, idempotency, crash recovery and fairness | reliability | N08, N09 | WORKER | BC-M4 | ENG01, ENG02, ENG03 | V-BC048 |
| BC049 — All-HTTP-start workload and 500-league qualification | capacity | N09 | OPERATIONS | BC-M4 | ENG03 | V-BC049 |
| BC050 — Measured additional visible score-delay objective | capacity | N09, N08, N16 | OPERATIONS | BC-M4 | ENG03 | V-BC050 |
| BC051 — Supporting-feed cost and provider entitlement | capacity | N09, N15 | OPERATIONS | BC-M4 | ENG03, ENG05 | V-BC051 |
| BC052 — Authorization on every private resource read/action | security | N03, N04, N10 | ACCOUNT | BC-M1 | ENG01, ENG08 | V-BC052 |
| BC053 — Private cache keys and forged references | security | N03, N08, N11 | READERS | BC-M2 | Existing preserved behavior / selected plan | V-BC053 |
| BC054 — Least privilege, input/origin and optional-data safety | security | N11, N12 | ACCOUNT | BC-M1 | ENG01, ENG08 | V-BC054 |
| BC055 — Data minimization, diagnostic access and retention | privacy | N03, N11, N12 | OPERATIONS | BC-M4 | ENG06, ENG08, D05 | V-BC055 |
| BC056 — Last-follower collection, retention and reactivation | lifecycle | N04, N08, N14 | WORKER | BC-M4 | D05, ENG04, ENG08 | V-BC056 |
| BC057 — Failure isolation and stale official service | reliability | N06, N08, N11 | WORKER | BC-M4 | Existing preserved behavior / selected plan | V-BC057 |
| BC058 — Observability, diagnosis and operational exercises | operations | N08, N09, N12 | OPERATIONS | BC-M4 | ENG06 | V-BC058 |
| BC059 — Additive migrations and conflict census | delivery | N11, N12 | RELEASE | BC-M5 | ENG07 | V-BC059 |
| BC060 — Shadow comparisons and staged reader cutover | delivery | N11, N12 | READERS | BC-M5 | ENG07 | V-BC060 |
| BC061 — Rollback, restore and incident containment | delivery | N11, N12 | RELEASE | BC-M5 | ENG06, ENG07 | V-BC061 |
| BC062 — Independent verification and safe isolated execution | delivery | N12 | RELEASE | BC-M5 | ENG07 | V-BC062 |
| BC063 — Publication, release ownership and exact production evidence | delivery | N12 | RELEASE | BC-M5 | ENG07 | V-BC063 |
| BC064 — Future adapter, authorization and licensing boundary | providers | N01, N02, N07, N15 | ADMIN | BC-M6 | ENG05 | V-BC064 |
| BC065 — Phase-entry design detail and change impact | governance | N01, N11, N12 | RELEASE | BC-M0 | ENG07 | V-BC065 |
| BC066 — Commercial activation and unresolved external facts | operations | N09, N15, N12 | OPERATIONS | BC-M4 | ENG03, ENG05, ENG06 | V-BC066 |
| BC067 — Actor export and account deletion | privacy | N16, N03, N12 | ACCOUNT | BC-M4 | ENG01, ENG08 | V-BC067 |
| BC068 — Reference-aware disposal and backup lifecycle | privacy | N16, N03, N12 | OPERATIONS | BC-M4 | ENG08, D05 | V-BC068 |
| BC069 — Stored-read service objectives and accountable response | operations | N16, N03, N12 | OPERATIONS | BC-M4 | ENG03, ENG06 | V-BC069 |

## Selected work and independent acceptance

Every acceptance below is specified, not executed. Run only the cases appropriate to the actual implementation change, through the existing source/role/harness owners. Preserve the exact fixture, implementation SHA, expected result, actual result, failures and skips. Existing application tests, model checks, source fixtures, real SQL tests, load measurements and user validation answer different questions.

### BC001 — Canonical ownership and incremental composition

**Allocation:** RELEASE; BC-M0; needs N01, N11, N12. Dependencies: none.

**Fields/domains:** repository/source SHA; resource owner; reader/version binding.

**Selected plan:** Keep the canonical repository and one administration/NFL/scoring/snapshot/publication composition. Extend owners by ports/adapters; keep legacy presenters during adoption.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [migration.md](migration.md); [reconciliation.md](reconciliation.md); [verification.md](verification.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG07.

**V-BC001 — independent acceptance:** Dependency/route inspection finds one owner per acquisition/calculation/publication responsibility; baseline and target outputs compare on the same captures.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC001; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

**Specific exclusions:** Blank replacement repository; Parallel provider/scoring/publication pipeline.

### BC002 — Independent L1 session and account lifecycle

**Allocation:** ACCOUNT; BC-M1; needs N03, N10. Dependencies: BC001.

**Fields/domains:** Actor; login identity; exact session; admission epoch; UTC expiry.

**Selected plan:** Reuse maintained auth and restricted account owner. Apply ENG01 command/read authority boundary; provider state never disables L1 login.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [contracts.md](contracts.md); [relational-design.md](relational-design.md); [behavior-security-design.md](behavior-security-design.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG01.

**V-BC002 — independent acceptance:** Outage, link end, removal and D02 equality affect only the scoped league; revocation and coordinator-loss schedules produce no unauthorized command/read.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC002; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC003 — Read-only stable provider identification

**Allocation:** DISCOVERY; BC-M1; needs N02, N03. Dependencies: BC002.

**Fields/domains:** provider/namespace/native account ID; lookup receipt; username/displayName/avatar Field states.

**Selected plan:** Resolve supplied username to stable opaque ID; optional display data is decoration. Identification cannot activate a link, enroll or prove external ownership.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [contracts.md](contracts.md); [relational-design.md](relational-design.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG02.

**V-BC003 — independent acceptance:** Renamed username keeps identity; missing/invalid optional fields do not discard a qualified ID; failed lookup causes zero identity/league/follow mutation.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC003; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC004 — Exclusive provider association and mistaken claim

**Allocation:** ACCOUNT; BC-M1; needs N03, N14. Dependencies: BC003.

**Fields/domains:** association UUID/revision; subjectLookupEvidenceRef; actor/provider and provider-account active keys.

**Selected plan:** Use both active uniqueness constraints and immutable history. D03 permits authenticated incumbent release or independently validated provider-control proof from an approved implemented mechanism; unsupported disputed proof remains locked as an accepted limitation. No automatic conflict displacement.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [contracts.md](contracts.md); [relational-design.md](relational-design.md); [behavior-security-design.md](behavior-security-design.md); [backend-decisions.json](backend-decisions.json). Decision IDs: D03, ENG01, ENG08.

**V-BC004 — independent acceptance:** Both claimant lock orders yield one active claim and private conflict; idempotent retries preserve identity; D03 recovery cases prove evidence, audit, revocation and no takeover by username alone.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC004; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC005 — Current owner/co-manager eligibility

**Allocation:** ROSTER; BC-M1; needs N04. Dependencies: BC004.

**Fields/domains:** team/season membership; primary/co-manager role; population/field coverage; positive/adverse receipts.

**Selected plan:** Evaluate independently qualified manager evidence for every team. Commissioner/member status alone grants no participation; one co-manager's changes do not alter another's access.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [current-roster-acceptance.md](current-roster-acceptance.md); [team-manager-relationships.md](team-manager-relationships.md); [contracts.md](contracts.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG01.

**V-BC005 — independent acceptance:** Multiple teams/co-managers, unknown co-manager lists, commissioner-only and complete exclusion fixtures yield exact independent eligibility; roster-player errors cannot erase valid manager evidence.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC005; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC006 — Strict D02 expiry and independent recovery

**Allocation:** ACCOUNT; BC-M1; needs N10, N08. Dependencies: BC005.

**Fields/domains:** verification time; policy version; earlier authority deadlines; revalidation intent.

**Selected plan:** Retain approved 3600-second policy and original qualified clock. Recovery admission is independent of expired serving and uses the same bounded shared owner.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [contracts.md](contracts.md); [relational-design.md](relational-design.md); [behavior-security-design.md](behavior-security-design.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG01, ENG02.

**V-BC006 — independent acceptance:** T+3599 can allow, T+3600/3601 cannot without fresh qualified proof; failed/partial/cache/replay never advance T; admitted recovery can restore access while expired.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC006; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC007 — Per-league current season and verified renewal

**Allocation:** ACCOUNT; BC-M1; needs N05. Dependencies: BC005, BC006.

**Fields/domains:** stable league; annual source mapping; selection revision; successor proof; follow revision.

**Selected plan:** Select current season per stable league/association after qualified successor lineage and membership. Retain eligible completed current seasons and mixed-year portfolios.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [contracts.md](contracts.md); [relational-design.md](relational-design.md); [behavior-security-design.md](behavior-security-design.md); [backend-decisions.json](backend-decisions.json). Decision IDs: D04, ENG01.

**V-BC007 — independent acceptance:** Two leagues in different years remain visible; circular/forked/wrong-year lineage cannot advance; renewal versus newer unfollow in both orders never resurrects preference.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC007; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC008 — Preferences, disconnection and regained membership

**Allocation:** ACCOUNT; BC-M1; needs N03, N04, N05, N14. Dependencies: BC004, BC007.

**Fields/domains:** follow/tombstone; favorite/order/preferred team; association end; preference revision.

**Selected plan:** Store explicit follow intent/revision separately from effective eligible following. D04 suspends effective access/collection on expiry/removal/disconnect; qualified recovery resumes only unchanged intent. Never auto-follow discovery or resurrect a newer unfollow. D03/D05 govern claim and zero-demand lifecycle.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [contracts.md](contracts.md); [relational-design.md](relational-design.md); [behavior-security-design.md](behavior-security-design.md); [backend-decisions.json](backend-decisions.json). Decision IDs: D03, D04, D05, ENG04.

**V-BC008 — independent acceptance:** Disconnect/unfollow/removal for A leaves B and shared facts intact; CAS retries cannot undo newer commands; loss/regain executes exactly the delegated policy.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC008; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC009 — Resumable complete-scope current-team discovery

**Allocation:** DISCOVERY; BC-M1; needs N02, N04, N05. Dependencies: BC003, BC007.

**Fields/domains:** strategy version; declared season query set; candidate refs; continuation; list vs role coverage.

**Selected plan:** Use the lead's current season/prior two seasons plus retained selections strategy; traverse qualified predecessor links through resumable bounded work. Persist explicit query/chain coverage and role qualification through the existing owner. Completion means the declared qualified scope, never all possible provider history.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [contracts.md](contracts.md); [relational-design.md](relational-design.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG02, ENG05.

**V-BC009 — independent acceptance:** Interrupted multi-year scan resumes without duplicates; failed/unqueried seasons stay partial; one unqualified candidate prevents complete current-teams claim without hiding proven results.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC009; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC010 — Access context and permission-aware sharing

**Allocation:** ADMIN; BC-M1; needs N02, N03, N08. Dependencies: BC002.

**Fields/domains:** ProviderAccessContext; audience; credential capability reference; context revision/expiry.

**Selected plan:** Share public facts once per compatible source scope; partition private data by actual authorization audience/context. Workers acquire from valid context, never from a user view's stale allow.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [contracts.md](contracts.md); [mapping-revisions.md](mapping-revisions.md); [league-season-settings.md](league-season-settings.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG01, ENG02, ENG05.

**V-BC010 — independent acceptance:** Cross-audience/context references fail at capture/cache/read boundaries; expired acquisition context blocks fetch; one user's unfollow does not cancel another valid shared demand.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC010; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

**Specific exclusions:** Persisting secrets in evidence or logs.

### BC011 — Atomic admission and durable account-to-worker commands

**Allocation:** ADMIN; BC-M1; needs N08, N09. Dependencies: BC010.

**Fields/domains:** command ID; scope/context/actor revisions; reservation/accounting; deadline; durable work intent.

**Selected plan:** Use ENG02 finite shared admission and the exact guarded command interface; debit actual HTTP starts including retries and legacy lanes. Coalesce identical demand without treating dedup as a global budget.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [contracts.md](contracts.md); [mapping-revisions.md](mapping-revisions.md); [league-season-settings.md](league-season-settings.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG01, ENG02, ENG03.

**V-BC011 — independent acceptance:** Concurrent unique usernames/scopes cannot exceed the chosen shared/actor budget; rejection is safe; crash/unknown commit reconciles the same command and leaves no orphan admitted request or double debit. Delay permits across reservation/start boundaries and synchronize independent workers: expired or abandoned permits cannot authorize a later start that violates the strict rolling actual-start limit.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC011; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC012 — Immutable evidence, versioned heads and corrections

**Allocation:** ADMIN; BC-M1; needs N06, N08, N10. Dependencies: BC010, BC011.

**Fields/domains:** scope/normalizer/validation head key; attempt ordinal; mapping generation; capture/acceptance refs; coverage clocks.

**Selected plan:** Preserve captures/receipts and independent versioned heads; choose explicit reader binding. Keep historical adverse evidence through policy suspension until qualified supersession.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [contracts.md](contracts.md); [mapping-revisions.md](mapping-revisions.md); [league-season-settings.md](league-season-settings.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG01, ENG07.

**V-BC012 — independent acceptance:** Late response, A-B-A mapping, shadow promotion/rollback and policy suspension cannot overwrite newer acceptance or revive removed access; replay preserves original evidence age.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC012; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC013 — League metadata, lifecycle and native settings

**Allocation:** ADMIN; BC-M2; needs N06, N07, N13. Dependencies: BC012.

**Fields/domains:** LeagueSettingsValue identity/name/artwork/lifecycle/visibility; nativeSettings; teamCount; scoring/roster/competition/waiver dialects.

**Selected plan:** Reuse the settings shadow resource and source-path field states. Normalize supported concepts while retaining raw native settings; missing decoration never invents identity/lifecycle.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [contracts.md](contracts.md); [mapping-revisions.md](mapping-revisions.md); [league-season-settings.md](league-season-settings.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG05.

**V-BC013 — independent acceptance:** Unknown settings survive round-trip provenance; malformed optional fields do not invalidate independently qualified league identity; zero/empty/null/absent remain distinct.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC013; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC014 — Stable leagues, annual team and manager references

**Allocation:** ADMIN; BC-M2; needs N03, N05, N06. Dependencies: BC007, BC012.

**Fields/domains:** stable league UUID; leagueSeason UUID; source mapping revision; seasonTeam ID; native manager alias.

**Selected plan:** Reuse qualified annual mappings and provider/type/namespace-scoped aliases. Manager/team display or reused roster number cannot establish cross-season identity.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [contracts.md](contracts.md); [mapping-revisions.md](mapping-revisions.md); [league-season-settings.md](league-season-settings.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG05.

**V-BC014 — independent acceptance:** Identical native IDs in different leagues/providers/kinds remain distinct; renewed native league IDs preserve verified stable lineage; cross-league FK/reference injection fails.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC014; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC015 — Native periods and separate NFL calendar mapping

**Allocation:** PERIOD; BC-M2; needs N06, N07, N11. Dependencies: BC013, BC014.

**Fields/domains:** native competition-period key; season type; period start/end/finality; NFL-period evidence refs.

**Selected plan:** Keep native matchup/transaction periods separate from NFL weeks. Generalized service uses actual competition boundaries; legacy exact-week/noon-Eastern behavior remains in compatibility readers.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [exact-period-matchups.md](exact-period-matchups.md); [league-season-settings.md](league-season-settings.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG05.

**V-BC015 — independent acceptance:** Multiweek/median/unpaired/unknown mapping never becomes a fabricated week/opponent; exact requested period is never substituted by current/highest stored snapshot.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC015; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC016 — Roster slots and eligibility rules

**Allocation:** ROSTER; BC-M2; needs N07, N13. Dependencies: BC013, BC015.

**Fields/domains:** ordered native slot/index; eligible positions; reserve/taxi/substitution rules; configuration revision.

**Selected plan:** Reuse native roster settings and canonical eligibility adapters. Position metadata, placement and provider eligibility remain distinct; unsupported slot/rule limits only dependent features.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [current-roster-acceptance.md](current-roster-acceptance.md); [team-manager-relationships.md](team-manager-relationships.md); [contracts.md](contracts.md).

**V-BC016 — independent acceptance:** Repeated FLEX slots retain indexes; empty slot differs from absent lineup; ambiguous/unsupported eligibility is explicit without blocking independently reliable official totals.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC016; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC017 — Current held roster and groups

**Allocation:** ROSTER; BC-M2; needs N06, N07. Dependencies: BC005, BC016.

**Fields/domains:** HeldRoster; players; starter/bench/reserve/taxi applicability; metadataAsOf.

**Selected plan:** Reuse accepted current roster/team manager ownership and independent field-group coverage; optional catalog failure does not delete held identities.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [current-roster-acceptance.md](current-roster-acceptance.md); [team-manager-relationships.md](team-manager-relationships.md); [contracts.md](contracts.md).

**V-BC017 — independent acceptance:** Known empty, null, absent and invalid groups remain distinct; duplicate/conflicting identities fail the affected group; current IR/taxi is not applied to historical lineups.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC017; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC018 — Exact-period ordered lineups and player scores

**Allocation:** MATCHUP; BC-M2; needs N06, N07, N13. Dependencies: BC015, BC016, BC017.

**Fields/domains:** ExactMatchupTeam.starters/nonstarters/bench; OfficialPoint; pointSource; lineup applicability refs.

**Selected plan:** Reuse B1 same-capture projection and starter-index score precedence. Preserve native vacancy marker/index; classify historical bench only with matching period applicability evidence.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [exact-period-matchups.md](exact-period-matchups.md); [exact-matchup-compatibility.md](exact-matchup-compatibility.md).

**V-BC018 — independent acceptance:** Custom zero/fractional/negative player points survive; starter-index zero outranks player map; unknown whole lineup/bench never becomes empty; no current roster backfill for past periods.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC018; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC019 — Provider-authoritative team score and adjustments

**Allocation:** MATCHUP; BC-M2; needs N01, N06, N13. Dependencies: BC018.

**Fields/domains:** officialTeamPoints.raw/custom/effective; adjustment kind/reason state; source receipt.

**Selected plan:** Use provider effective score with explicit custom override, never sum displayed players to replace official team totals. Keep parsed numeric precision/provenance honest.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [exact-period-matchups.md](exact-period-matchups.md); [exact-matchup-compatibility.md](exact-matchup-compatibility.md).

**V-BC019 — independent acceptance:** Same-capture comparison proves custom_points=0 wins, negative/fractional values unchanged, missing totals null, and corrected immutable capture changes only current accepted selection.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC019; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC020 — Matchup grouping, results and finality

**Allocation:** MATCHUP; BC-M2; needs N01, N06, N07. Dependencies: BC015, BC019.

**Fields/domains:** participant team IDs; native grouping; paired/unpaired/multiple format; provider vs local finality/outcome.

**Selected plan:** Reuse B1 participants and exact official scores; retain source finality separately from calendar-completion inference. Unsupported competition stays represented with limited result interpretation.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [exact-period-matchups.md](exact-period-matchups.md); [exact-matchup-compatibility.md](exact-matchup-compatibility.md).

**V-BC020 — independent acceptance:** Unpaired teams remain visible; no guessed winner/tie/final from absent score, kickoff time or unsupported multiple-opponent format; actual source corrections can revise accepted result without changing frozen history.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC020; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC021 — Season-to-date standings and source rank

**Allocation:** SEASON; BC-M2; needs N01, N06. Dependencies: BC013, BC019.

**Fields/domains:** record W/L/T; exact PF/PA whole/fraction; provider rank/seed/division; local ordering version.

**Selected plan:** Reuse SeasonOverviewTeamFacts and independent standings coverage. Keep source rank separate from local tiebreak/order; preserve legacy zero/rounding behavior solely in compatibility view.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [season-overview.md](season-overview.md); [screen-data-map.md](screen-data-map.md).

**V-BC021 — independent acceptance:** Incomplete record remains unknown; PF/PA exact source components survive; source rank is never inferred from response order; same-capture legacy comparison accounts for deliberate presenter differences.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC021; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC022 — Current waiver state and actual policy

**Allocation:** SEASON; BC-M2; needs N06, N07, N13. Dependencies: BC013, BC021.

**Fields/domains:** waiver priority; budget/budgetUsed; FAAB unit; native waiver rules.

**Selected plan:** Reuse B2 current waiver facts and existing waiver calculation. Preserve native policy and missing states; FAAB is not currency and transaction history cannot reconstruct unknown prior balances.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [season-overview.md](season-overview.md); [screen-data-map.md](screen-data-map.md).

**V-BC022 — independent acceptance:** Zero budget, negative used adjustments, missing priority and native waiver modes retain defined semantics; current remaining calculation agrees with the existing presenter on identical inputs.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC022; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC023 — Transaction event and asset coverage

**Allocation:** ACTIVITY; BC-M2; needs N01, N06, N13. Dependencies: BC014, BC015, BC022.

**Fields/domains:** TransactionActivityEvent; players adds/drops; pick season/round/original/from/to; FAAB transfer; native status/type/time.

**Selected plan:** Reuse B3 capture/normalizer/feed and typed player/pick/budget assets; retain unknown native extensions. Interpret only supplied claim/bid/outcome evidence.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [transaction-activity.md](transaction-activity.md).

**V-BC023 — independent acceptance:** Trades/waivers/free agents/multi-party events preserve participants and assets; missing timestamp/bid remains unknown; absence of losing claims never proves none existed.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC023; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC024 — Transaction continuation, filters and corrections

**Allocation:** ACTIVITY; BC-M2; needs N06, N08. Dependencies: BC023, BC012.

**Fields/domains:** week 0/native range; retained selection revision; window/cursor; sourceCoverage/windowCoverage/conflicts.

**Selected plan:** Keep bounded immutable feed selections and cursor revision; resume failed native scopes. Team filters use scoped participants, not names; equal-time conflicts remain explicit.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [transaction-activity.md](transaction-activity.md).

**V-BC024 — independent acceptance:** Concurrent correction cannot duplicate/skip events within a pinned page sequence; unknown-time events and failed weeks remain flagged; week0 and offseason events are not discarded as invalid NFL weeks.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC024; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC025 — Draft and playoff administrative evidence

**Allocation:** ADMIN; BC-M2; needs N06, N13. Dependencies: BC013, BC020, BC023.

**Fields/domains:** draft identity/results/traded picks; bracket participants/progression/native outcome; capability/source coverage.

**Selected plan:** Reuse existing administration capture where exposed; retain draft-pick provenance for transactions and provider playoff facts for supported competition. Supply typed backend interpretation only for qualified capabilities.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [contracts.md](contracts.md); [mapping-revisions.md](mapping-revisions.md); [league-season-settings.md](league-season-settings.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG05.

**V-BC025 — independent acceptance:** Missing/unpublished bracket or draft data stays unavailable; native progression references stay scoped and never become fabricated playoff winners or ownership; pick transfer identities compare with B3.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC025; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

**Specific exclusions:** Draft-room or bracket website UX; Provider write operations.

### BC026 — Full recoverable current-season import

**Allocation:** ADMIN; BC-M2; needs N06, N08. Dependencies: BC013, BC015, BC018, BC020, BC024, BC025.

**Fields/domains:** SeasonCoverageManifest; required native units; capture refs; coverage reason; checkpoint/continuation.

**Selected plan:** Extend existing administration durable job/checkpoint ownership. Derive finite current-season work from actual competition and exposed provider endpoints; retain explicit unavailable/unpublished/unsupported units instead of invented history.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [contracts.md](contracts.md); [mapping-revisions.md](mapping-revisions.md); [league-season-settings.md](league-season-settings.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG02, ENG04, ENG05.

**V-BC026 — independent acceptance:** An unrelated league with different start/playoff/period settings imports all declared recoverable units, resumes interruption and reports exact omissions; no universal1–14 or named-league start-year assumption.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC026; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

**Specific exclusions:** Inventing historical lineups or unavailable source facts.

### BC027 — Remaining provider-published schedule

**Allocation:** SEASON; BC-M2; needs N06, N07. Dependencies: BC015, BC020, BC025, BC026.

**Fields/domains:** native future period; participants/opponent state; published source refs; unpublished/conditional status.

**Selected plan:** Generalize B2 schedule composition using actual horizon and native schedule/bracket evidence. Preserve old MyTeam1–15/profile1–14 presentation ranges until separately authorized cutover.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [season-overview.md](season-overview.md); [screen-data-map.md](screen-data-map.md).

**V-BC027 — independent acceptance:** Different horizon/byes/conditional playoff slots yield faithful published facts; unknown future opponent remains unknown and does not trigger fabricated pairing or finality.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC027; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC028 — Historical continuity and curated attribution

**Allocation:** HISTORY; BC-M2; needs N01, N05, N06. Dependencies: BC014, BC020, BC026.

**Fields/domains:** qualified predecessor links; effective owner attribution; official completed results; curated honors/provenance; requested historical horizon; per-season/family import coverage; resumable predecessor checkpoint; temporal settings/identity attribution.

**Selected plan:** Preserve B4/current manager-history compatibility and distinguish curated honors from provider outcomes. At BC-M2 generalize finite provider-recoverable current and prior-season competitive history using qualified predecessor links and retained explicit selections. Persist each requested season/family's available, missing, inaccessible and not-yet-imported coverage; resume traversal/import without arbitrary named-league start-year or fixed historical-week limits. The first vertical slice may serve current season before historical import completes.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [historical-continuity.md](historical-continuity.md); [retained-matchup-comparison.md](retained-matchup-comparison.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG04, ENG05.

**V-BC028 — independent acceptance:** Annual ID changes, transfers/co-managers, curated LeagueTwo attribution and official corrections never merge by name or relabel honors as provider results; missing historical ownership withholds aggregates. A league with a longer/shorter history than either named league traverses its evidenced finite predecessor chain, detects cycles/gaps, resumes interruption and serves only actually supported periods with time-applicable metadata. Missing old endpoints produce explicit partial coverage rather than a false complete-history claim.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC028; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

**Specific exclusions:** Universal retrospective prior-season browsing guarantee.

### BC029 — Official data independent of analytics support

**Allocation:** ADMIN; BC-M2; needs N01, N06, N07. Dependencies: BC013, BC020, BC021.

**Fields/domains:** FeatureAssessment; configuration/source/model revisions; supported/limited/unavailable reasons.

**Selected plan:** Separate enrollment/official reading from each derived capability. Actual unsupported scoring/format gates only computations needing it; version capability decisions with supporting evidence.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [contracts.md](contracts.md); [mapping-revisions.md](mapping-revisions.md); [league-season-settings.md](league-season-settings.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG05.

**V-BC029 — independent acceptance:** Official roster/score/standings remain accessible when forecasts/probability/metrics are unavailable; later analytics qualification adds support without mutating frozen profiles/history.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC029; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC030 — Shared football identities and catalog metadata

**Allocation:** NFL; BC-M3; needs N07, N08. Dependencies: BC014, BC029.

**Fields/domains:** player vs team-defense canonical ID; provider alias/crosswalk; position/team metadata; effective/as-of time.

**Selected plan:** Reuse shared crosswalk/catalog owner; distinguish entity kind, provider namespace and effective metadata. Never match ambiguous identities by display name.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [../all-player-statistics.md](../all-player-statistics.md); [../lineup-freshness.md](../lineup-freshness.md).

**V-BC030 — independent acceptance:** Player/defense string collision, traded player, duplicate aliases and roster-required missing identity are detected; current injury/team label is never asserted as historical fact.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC030; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC031 — NFL schedules, assignment and bye evidence

**Allocation:** NFL; BC-M3; needs N07, N11. Dependencies: BC015, BC030.

**Fields/domains:** season/type/week; game ID; participants/kickoff; player game assignment; bye evidence.

**Selected plan:** Reuse shared schedule/calendar; map native league periods only with evidence. Missing/ambiguous schedule is unavailable, not a bye.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [../all-player-statistics.md](../all-player-statistics.md); [../lineup-freshness.md](../lineup-freshness.md).

**V-BC031 — independent acceptance:** Rescheduled games, cross-year weeks, missing starter game and actual bye maintain exact identities; no substitution of unrelated NFL week or kickoff date.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC031; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC032 — Shared game state, clocks and plausibility

**Allocation:** NFL; BC-M3; needs N07, N11. Dependencies: BC031.

**Fields/domains:** game phase/period/clock; observedAt; provider raw state; source set/skew.

**Selected plan:** Reuse Tank01 game-state normalization and existing monotonic/plausibility/publication rules; retain observed clock, not browser-invented countdown.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [../all-player-statistics.md](../all-player-statistics.md); [../lineup-freshness.md](../lineup-freshness.md).

**V-BC032 — independent acceptance:** Clock regressions, interruption, overtime, stale/missing game and conflicting final status take existing safe fallback/rejection; source skew remains enforced against calculation time.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC032; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC033 — Actual NFL statistics and box-score detail

**Allocation:** METRICS; BC-M3; needs N07, N13. Dependencies: BC018, BC030, BC032.

**Fields/domains:** immutable stat capture; sparse stat keys; entity/game/period; whole-capture selection; coverage.

**Selected plan:** Reuse shared all-player/raw-stat evidence and exact box-score reader. Do not stitch missing fields from older captures or substitute NFL statistics for host fantasy official points.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [../all-player-statistics.md](../all-player-statistics.md); [../weekly-roster-metrics.md](../weekly-roster-metrics.md); [../all-player-eligibility.md](../all-player-eligibility.md).

**V-BC033 — independent acceptance:** Missing key differs from zero; current/final whole-capture selection and exact-game identity remain coherent; every exposed box-score field meets whitelist and no private/raw scoring fields leak.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC033; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC034 — Reliable availability and participation

**Allocation:** METRICS; BC-M3; needs N07, N13. Dependencies: BC017, BC031, BC033.

**Fields/domains:** availability reason/source/as-of; eligibility/appearance evidence; lineup attention coverage.

**Selected plan:** Reuse versioned player availability and participation rules; preserve explicit assumption provenance. No observed issue is not verified clear when roster/schedule/status coverage is missing.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [../all-player-statistics.md](../all-player-statistics.md); [../weekly-roster-metrics.md](../weekly-roster-metrics.md); [../all-player-eligibility.md](../all-player-eligibility.md).

**V-BC034 — independent acceptance:** Pregame out/inactive/bye/empty/unknown scenarios produce exact issue plus coverage; historical injury is not inferred from current catalog; participation assumptions are separately labelled and bounded.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC034; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC035 — Shared projection-statistics slate

**Allocation:** NFL; BC-M3; needs N07, N08. Dependencies: BC030, BC031, BC011.

**Fields/domains:** ProjectionSlate; provider-period/raw-content hash; slate coverage; identity warnings; source time.

**Selected plan:** Reuse one Tank01 projection feed/cache/slate validator per provider period. Keep raw forecast statistics independent of league scoring and future materialization.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [../all-player-statistics.md](../all-player-statistics.md); [../lineup-freshness.md](../lineup-freshness.md).

**V-BC035 — independent acceptance:** Two leagues share one compatible acquisition; malformed/incomplete slate fails shared validation, isolated unmapped projection-only free agents remain explicit coverage limitations; no page-triggered feed.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC035; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC036 — Actual league scoring and rules provenance

**Allocation:** ANALYTICS; BC-M3; needs N07, N11. Dependencies: BC013, BC029, BC033, BC035.

**Fields/domains:** raw settings/hash; canonical events; unsupported rules; scorer/profile revision.

**Selected plan:** Reuse one provider-neutral scorer and adapter mapping. Score the same NFL statistics once per unique effective rule profile while retaining native hash/provenance and unsupported-key reasons.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [../lineup-freshness.md](../lineup-freshness.md); [../live-defense-projections.md](../live-defense-projections.md); [../matchup-win-probability.md](../matchup-win-probability.md).

**V-BC036 — independent acceptance:** Different supported league settings yield independently expected scores; unsupported rules never become silent zero support or alter official totals; legacy hashes and deterministic IDs remain stable.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC036; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC037 — Immutable pregame baseline and missing policy

**Allocation:** ANALYTICS; BC-M3; needs N07, N11. Dependencies: BC031, BC035, BC036.

**Fields/domains:** FrozenBaseline; source/model/profile refs; kickoff eligibility; missing baseline quality.

**Selected plan:** Preserve last eligible pregame freeze and existing trusted-slate isolated zero calculation policy; do not fabricate persisted frozen rows for missing baselines.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [../lineup-freshness.md](../lineup-freshness.md); [../live-defense-projections.md](../live-defense-projections.md); [../matchup-win-probability.md](../matchup-win-probability.md).

**V-BC037 — independent acceptance:** Late arrivals cannot rewrite frozen baseline; invalid whole slate does not qualify isolated zero; final visible missing baseline remains unavailable while official final team contribution is exact.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC037; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC038 — Live projected finish and defensive model

**Allocation:** ANALYTICS; BC-M3; needs N07, N11. Dependencies: BC019, BC032, BC037.

**Fields/domains:** clock-v1; phase-appropriate player contribution; defense-components-v1; actual/frozen/source refs.

**Selected plan:** Reuse existing offense/kicker clock-v1 and defensive component algorithm/fallback. Keep official earned values, frozen forecast and live finish distinct.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [../lineup-freshness.md](../lineup-freshness.md); [../live-defense-projections.md](../live-defense-projections.md); [../matchup-win-probability.md](../matchup-win-probability.md).

**V-BC038 — independent acceptance:** Offense/kicker formula and defensive points-allowed replacement match independent vectors; unsupported future bonuses not forecast; final player display uses baseline while team uses official final points.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC038; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC039 — Win probability with honest model status

**Allocation:** ANALYTICS; BC-M3; needs N01, N07. Dependencies: BC020, BC038.

**Fields/domains:** probability model/version; team identity; estimated/final/tie/unavailable; input evidence.

**Selected plan:** Reuse current probability model and reader compatibility; do not equate deterministic output tests with calibration. Future coefficient changes require versioned held-out forecast/outcome evaluation.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [../lineup-freshness.md](../lineup-freshness.md); [../live-defense-projections.md](../live-defense-projections.md); [../matchup-win-probability.md](../matchup-win-probability.md).

**V-BC039 — independent acceptance:** Swapping display sides preserves each team's probability; missing/unsupported evidence yields unavailable; final/tie is correct; calibration receipt includes genuine pregame forecasts, held-out outcomes and Brier/log-loss before accuracy claims.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC039; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC040 — Projected standings separate from official baseline

**Allocation:** ANALYTICS; BC-M3; needs N01, N07. Dependencies: BC020, BC021, BC038.

**Fields/domains:** completed official baseline; active projected result; coverage denominator; current/projected rank.

**Selected plan:** Reuse projected-standings owner; separate current record, exact viewed matchup period and locally projected order. No double counting of completed results.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [../lineup-freshness.md](../lineup-freshness.md); [../live-defense-projections.md](../live-defense-projections.md); [../matchup-win-probability.md](../matchup-win-probability.md).

**V-BC040 — independent acceptance:** Completed/custom-score/tie/partial fixtures preserve official table and exact counts; unsupported formats withhold affected projection; portfolio projected rank requires qualified full-league inputs.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC040; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC041 — Roster actual metrics, PPG and position ranks

**Allocation:** METRICS; BC-M3; needs N01, N07, N13. Dependencies: BC033, BC034, BC036.

**Fields/domains:** scored actual stats; eligible/appearance denominator; metric cutoff; position population coverage.

**Selected plan:** Reuse all-player scorer/materialization and metric store. Label metrics as L1 derivations under actual league rules, independent of provider official totals/projections.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [../all-player-statistics.md](../all-player-statistics.md); [../weekly-roster-metrics.md](../weekly-roster-metrics.md); [../all-player-eligibility.md](../all-player-eligibility.md).

**V-BC041 — independent acceptance:** Missing eligibility or incomplete position population cannot claim complete rank; denominators follow existing qualified policy; exact cutoff/game corrections reproduce expected metric changes without counting byes as games.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC041; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC042 — Account library and selected team continuity

**Allocation:** READERS; BC-M1; needs N01, N03, N05. Dependencies: BC007, BC008.

**Fields/domains:** participating/followed/last-known relationship; seasonTeam selection; favorite/order; route mapping.

**Selected plan:** Compose account-scoped library and current-team cards from stored eligibility/preferences; keep guest browser MyTeam compatibility outside target account authority.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [screen-data-map.md](screen-data-map.md); [step-2-checklist.md](step-2-checklist.md); [contracts.md](contracts.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG01.

**V-BC042 — independent acceptance:** Card team and destination team remain identical; affiliation/favorite is not access; disconnected sessions cannot adopt old response; partial one-league failure leaves other eligible cards.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC042; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC043 — Portfolio aggregate and partial analytical coverage

**Allocation:** READERS; BC-M3; needs N01, N05, N07. Dependencies: BC039, BC040, BC042.

**Fields/domains:** per-card native period; covered/expected count; projected W/L/T; oldest qualified update.

**Selected plan:** Reuse My Fantasy aggregation over canonical authorized cards. Aggregate only comparable supported periods and expose denominator; one global year/week cannot override per-league authority.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [screen-data-map.md](screen-data-map.md); [step-2-checklist.md](step-2-checklist.md); [contracts.md](contracts.md).

**V-BC043 — independent acceptance:** Mixed-year/native-period and missing-projection cards remain represented; aggregate does not imply all clear/all complete/oldest update without every required input; no invented forecast for excluded card.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC043; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC044 — Resource freshness and versioned reader envelopes

**Allocation:** READERS; BC-M2; needs N06, N08. Dependencies: BC006, BC012, BC029.

**Fields/domains:** observed/verified/persisted/calculated/published times; resource receipt/revision; freshness/support/coverage.

**Selected plan:** Compose per-field-group evidence instead of one misleading page timestamp. Preserve valid stale data where authority permits, while D02 independently limits protected serving.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [screen-data-map.md](screen-data-map.md); [step-2-checklist.md](step-2-checklist.md); [contracts.md](contracts.md).

**V-BC044 — independent acceptance:** One stale or missing resource cannot restamp peers; unchanged network verification advances only its allowed clocks; assembly time does not become provider update time; access expiry suppresses protected data.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC044; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC045 — Compatibility presenters and revision adoption

**Allocation:** READERS; BC-M5; needs N11, N13. Dependencies: BC042, BC043, BC044.

**Fields/domains:** legacy payload schema; reader binding; revision/content lineage; fallback/selection context.

**Selected plan:** Retain current public routes/payloads/fallbacks/polling and presentations until the explicit cutover milestone. Adapt once at reader boundary, not in every page.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [screen-data-map.md](screen-data-map.md); [step-2-checklist.md](step-2-checklist.md); [contracts.md](contracts.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG07.

**V-BC045 — independent acceptance:** Frozen-input golden comparison covers all existing screen field groups; delayed old actor/league/week/revision response rejected; current/future/completed fallback behavior preserved without browser provider calls.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC045; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

**Specific exclusions:** Unrequested website redesign.

### BC046 — Followed maintenance and active-view promotion

**Allocation:** WORKER; BC-M4; needs N08, N09. Dependencies: BC008, BC011.

**Fields/domains:** demand source; follow count/valid contexts; watched cohort; aggregate-view participation; due bucket.

**Selected plan:** Reuse one owner of existing scheduled lanes plus the selected continuous worker run mode; register eligible follows and active aggregate-view demand under ENG02/ENG03. D04 suspension and D05 recovery/zero-demand rules remain separate from user intent.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [../lineup-freshness.md](../lineup-freshness.md); [../future-week-projections.md](../future-week-projections.md); [calculation-source-history.md](calculation-source-history.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG02, ENG03, D05.

**V-BC046 — independent acceptance:** Offline followers still generate bounded maintenance; multi-user/aggregate views share compatible collection; hiding/leaving views releases priority without deleting shared facts or skipping starvation checks.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC046; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC047 — Exact-current-future scheduling and ownership

**Allocation:** WORKER; BC-M4; needs N07, N08, N11. Dependencies: BC015, BC031, BC035, BC046.

**Fields/domains:** period authority; stable cadence offset; observation/ingestion/materialization policies; pending lineage.

**Selected plan:** Preserve exact-period and existing calculation/publication ownership while adapting dispatch to the sole existing-worker continuous run mode under ENG03. Observation, ingestion and materialization remain separate actions; compatible stored slates avoid projection refetch. Legacy paths change only at reviewed cutover.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [../lineup-freshness.md](../lineup-freshness.md); [../future-week-projections.md](../future-week-projections.md); [calculation-source-history.md](calculation-source-history.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG03.

**V-BC047 — independent acceptance:** Preseason default/current rollover, week+1 canary and pending future change keep correct owner; stale/missing authority blocks unsafe work; no highest-snapshot current-week inference.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC047; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC048 — Leases, idempotency, crash recovery and fairness

**Allocation:** WORKER; BC-M4; needs N08, N09. Dependencies: BC011, BC012, BC026, BC047.

**Fields/domains:** job semantic key; lease owner/attempt/deadline; mapping generation; checkpoint; pending acknowledgment.

**Selected plan:** Reuse durable jobs, fenced claims and atomic acceptance/required-work writes. Continuous run mode retains bounded stages, deadlines, lease fencing and lane accounting; cancellation/worker replacement cannot create a second lane owner or starve maintenance.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [../lineup-freshness.md](../lineup-freshness.md); [../future-week-projections.md](../future-week-projections.md); [calculation-source-history.md](calculation-source-history.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG01, ENG02, ENG03.

**V-BC048 — independent acceptance:** Old/expired worker cannot publish/ack; crash before/after commit leaves coherent source/work state; repeated retry reconciles command; adversarial high-demand actor cannot starve eligible maintenance.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC048; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC049 — All-HTTP-start workload and 500-league qualification

**Allocation:** OPERATIONS; BC-M4; needs N09. Dependencies: BC011, BC026, BC047, BC048.

**Fields/domains:** distinct leagues/accounts/profiles; actual request starts; lane/period/context; queue age; failure/partial rates.

**Selected plan:** Qualify ENG03 at up to 500 distinct all-watched Sleeper leagues while bounded imports, background work and retries coexist. Include legacy fallbacks, catalogs, future periods and probes. The selected future/import lane cannot support unchanged full future cadence for all 500: preserve the two named-league obligations and qualify deduplicated headroom, a lower admitted workload, or a separately authorized larger licensed allowance/budget revision before claiming combined service. Future providers require their own workload and budget qualification; today's 20/min guard is baseline, not proof.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [quality-operations.md](quality-operations.md); [../collection-capacity-validation.md](../collection-capacity-validation.md); [../release-validation.md](../release-validation.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG03.

**V-BC049 — independent acceptance:** Retained measurement traces reconcile requested/admitted/started/completed/deferred counts under cold/warm/steady/failure loads and all lane coexistence; a synthetic fixture alone cannot certify throughput. The 61-second permit accounting must prove its reservation-to-actual-start bound, including cancellation, process pauses and retry; totals must match real socket/request starts.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC049; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC050 — Measured additional visible score-delay objective

**Allocation:** OPERATIONS; BC-M4; needs N09, N08, N16. Dependencies: BC019, BC044, BC049.

**Fields/domains:** provider-visible interval; capture/accept/commit/materialize/read/render timestamps; poll uncertainty; percentiles; unknown and failed sample classification.

**Selected plan:** ENG03 selects 45-second live score observation, normal acceptance/publication p95<=5s and a 10-second visible stored-data observer, with 500-all-watched end-to-end additional score-delay targets p95<=60s/p99<=75s subject to empirical qualification. Measure source visibility uncertainty, queue, acquisition, acceptance, publication, authorized read and visible render together and separately; backend publication alone cannot satisfy the visible target.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [quality-operations.md](quality-operations.md); [../collection-capacity-validation.md](../collection-capacity-validation.md); [../release-validation.md](../release-validation.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG03.

**V-BC050 — independent acceptance:** Controlled changing-source fixtures and independent visible-render timestamps measure end-to-end p50/p95/p99/max and loss/staleness at the admitted mixed workload. Real provider-visible probes bracket rather than invent event time; unknown first observations, failed samples and stale user-minutes remain visible. Stage percentiles are not added to claim an end-to-end percentile. Breach triggers selected admission/degradation response.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC050; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC051 — Supporting-feed cost and provider entitlement

**Allocation:** OPERATIONS; BC-M4; needs N09, N15. Dependencies: BC049.

**Fields/domains:** plan/terms/license evidence; billable request volume; feed cost; infrastructure/storage/egress costs.

**Selected plan:** Use ENG05 commercial license/access gate and ENG03 cost evaluation. Keep approximately$50 supporting feed separate from infrastructure; compare measured workload to actual quoted terms, not assumed free commercial access.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [quality-operations.md](quality-operations.md); [../collection-capacity-validation.md](../collection-capacity-validation.md); [../release-validation.md](../release-validation.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG03, ENG05.

**V-BC051 — independent acceptance:** Dated provider entitlement and full request census support cost projection; unknown licensing/price or over-budget capacity blocks commercial/cost claim. No purchase or contract is authorized by this plan.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC051; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

**Specific exclusions:** Automatic provider subscription purchase.

### BC052 — Authorization on every private resource read/action

**Allocation:** ACCOUNT; BC-M1; needs N03, N04, N10. Dependencies: BC002, BC005, BC006, BC010.

**Fields/domains:** actor/object/field matrix; live session/association/authority; reader capability; safe denial variants.

**Selected plan:** Extend the selected ENG01 guard and BS authorization matrix from roster to all current/period/history/activity/analytics compositions; safe references/caches cannot bypass final authority.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [contracts.md](contracts.md); [relational-design.md](relational-design.md); [behavior-security-design.md](behavior-security-design.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG01, ENG08.

**V-BC052 — independent acceptance:** Cross-actor/resource/audience/season requests, revoked session, unknown membership and expiry expose zero protected fields across every backend family; public route compatibility remains separately scoped.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC052; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC053 — Private cache keys and forged references

**Allocation:** READERS; BC-M2; needs N03, N08, N11. Dependencies: BC010, BC012, BC052.

**Fields/domains:** audience/context/actor scope; exact tuple keys; server-only opaque refs; cache control.

**Selected plan:** Cache shared facts only under compatible source permission; compose user-specific allow/results privately/no-store. Validate all refs against caller scope, not possession of an opaque ID.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [screen-data-map.md](screen-data-map.md); [step-2-checklist.md](step-2-checklist.md); [contracts.md](contracts.md).

**V-BC053 — independent acceptance:** Same native ID across providers/kinds/leagues or foreign acceptance/transition cursor cannot fetch another scope; CDN/browser/shared cache shows no previous actor's data; deny payloads contain only allowlisted keys.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC053; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC054 — Least privilege, input/origin and optional-data safety

**Allocation:** ACCOUNT; BC-M1; needs N11, N12. Dependencies: BC002, BC011.

**Fields/domains:** helper signature/ACL/search_path; body/origin schema; request actor context; allowed source/image identifiers.

**Selected plan:** Retain separate auth/account/runtime owners, exact closed helpers and existing HTTP origin/rate/audit guards. Treat provider strings/URLs and optional data as untrusted; never route arbitrary client URLs or SQL.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [contracts.md](contracts.md); [relational-design.md](relational-design.md); [behavior-security-design.md](behavior-security-design.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG01, ENG08.

**V-BC054 — independent acceptance:** Real restricted-role grants reject unrelated SELECT/UPDATE/EXECUTE; search-path shadowing, pooled context, extra JSON keys, hostile avatar/name and oversize bodies cannot gain authority or leak secrets.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC054; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC055 — Data minimization, diagnostic access and retention

**Allocation:** OPERATIONS; BC-M4; needs N03, N11, N12. Dependencies: BC052, BC054.

**Fields/domains:** typed safe event envelope; request-local correlation; mutation audit mapping; retention/deletion evidence.

**Selected plan:** Apply ENG08/ENG06 privacy and existing immutable identity audit rules; keep bounded diagnostics without raw subject/session/cookie/provider payload. No invented durable join for random read correlations.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [quality-operations.md](quality-operations.md); [../collection-capacity-validation.md](../collection-capacity-validation.md); [../release-validation.md](../release-validation.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG06, ENG08, D05.

**V-BC055 — independent acceptance:** Serialization fixtures reject identifiers/secrets; actual sink ACL/expiry meets selected ceiling; process-local failure counters and restart loss match policy; no runtime claim from documented log shapes alone.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC055; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC056 — Last-follower collection, retention and reactivation

**Allocation:** WORKER; BC-M4; needs N04, N08, N14. Dependencies: BC008, BC012, BC046, BC048.

**Fields/domains:** aggregate demand; retirement/tombstone; retention class; referenced immutable evidence; reactivation state.

**Selected plan:** Apply D05: stop ordinary polling after 30 minutes with no eligible-follow, authorized-view or registry demand. Bounded recovery/import demands authorize only their own scope and cannot reset that cooldown or reactivate ordinary polling for an ineligible follow. Ineligible recovery is at most hourly for seven days from first loss, then requires fresh authenticated user demand; failed attempts never restart the window and disconnect supplies no recovery credential. Last-follower departure never deletes shared history/frozen baselines. Preserve D04, D02 and referenced adverse/audit evidence.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [../lineup-freshness.md](../lineup-freshness.md); [../future-week-projections.md](../future-week-projections.md); [calculation-source-history.md](calculation-source-history.md); [backend-decisions.json](backend-decisions.json). Decision IDs: D05, ENG04, ENG08.

**V-BC056 — independent acceptance:** Final-follower leave/rejoin, other-user active demand, retained removal refs and pending worker races follow exact policy; no accidental deletion of referenced/frozen/audit history or silent continued prohibited collection. Virtual-clock cases prove hourly recovery/import does not extend routine polling, failure does not reset seven days, and disconnected actors cannot use retained intent as credentials.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC056; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC057 — Failure isolation and stale official service

**Allocation:** WORKER; BC-M4; needs N06, N08, N11. Dependencies: BC029, BC044, BC048.

**Fields/domains:** per-resource failure/age; last complete snapshot; source-group failure; pending recovery status.

**Selected plan:** Keep existing league/resource failure isolation, shared-group validation and last-good preservation. Derivative outage must not overwrite official facts; protected stale serving still obeys authority/D02.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [../lineup-freshness.md](../lineup-freshness.md); [../future-week-projections.md](../future-week-projections.md); [calculation-source-history.md](calculation-source-history.md).

**V-BC057 — independent acceptance:** One league error preserves other completions; shared invalid slate rejects affected group; no incomplete publication replaces last good; zero-completion/partial fleet responses and retry lineage remain truthful.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC057; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC058 — Observability, diagnosis and operational exercises

**Allocation:** OPERATIONS; BC-M4; needs N08, N09, N12. Dependencies: BC048, BC050, BC055, BC057.

**Fields/domains:** safe reason counts; oldest pending age; accepted/published lag; failure/loss counters; operator runbook.

**Selected plan:** Use ENG06 existing sinks/job/evidence inspection and typed operational events. Assign stop conditions and recovery actions for forbidden payload, unfenced writer, backlog, source outage and sink failure without a new telemetry service.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [quality-operations.md](quality-operations.md); [../collection-capacity-validation.md](../collection-capacity-validation.md); [../release-validation.md](../release-validation.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG06.

**V-BC058 — independent acceptance:** Fault injection demonstrates operator can locate aggregate failure class and execute safe recovery; mandatory audit failure rolls back mutation; diagnostic failure never authorizes and cannot promise durable observation without evidence.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC058; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC059 — Additive migrations and conflict census

**Allocation:** RELEASE; BC-M5; needs N11, N12. Dependencies: BC001, BC004, BC012, BC054.

**Fields/domains:** proposed DDL/checksums; conflict census; role/function manifests; compatibility/data counts.

**Selected plan:** Apply ENG07 reviewed additive changes through existing migration runner; keep historical migrations immutable. Reconcile active identity conflicts and unqualified legacy evidence before enforcing target constraints.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [migration.md](migration.md); [reconciliation.md](reconciliation.md); [verification.md](verification.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG07.

**V-BC059 — independent acceptance:** Isolated migration runs validate old/new callers, constraints/triggers/grants and pre/post invariants; unresolved conflict stops rather than selecting a user; migration receipt names exact SHA and sanitized identities.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC059; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC060 — Shadow comparisons and staged reader cutover

**Allocation:** READERS; BC-M5; needs N11, N12. Dependencies: BC026, BC029, BC045, BC049, BC052, BC059.

**Fields/domains:** reader/cohort binding; same-capture diff; capability coverage; public payload compatibility.

**Selected plan:** Adopt each internal bundle behind explicit version/cohort selection after field-group qualification; preserve existing routes and fallback behavior until authorized cutover. No global latest-head switch.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [screen-data-map.md](screen-data-map.md); [step-2-checklist.md](step-2-checklist.md); [contracts.md](contracts.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG07.

**V-BC060 — independent acceptance:** All current screen field groups have frozen-input comparisons and negative/missing/unsupported controls; unrelated supported league qualifies; one reader rollback cannot change another cohort's accepted source history.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC060; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC061 — Rollback, restore and incident containment

**Allocation:** RELEASE; BC-M5; needs N11, N12. Dependencies: BC056, BC058, BC059, BC060.

**Fields/domains:** compatible application/source binding; snapshot/model support; forward fix; restore integrity/RPO/RTO evidence.

**Selected plan:** Apply ENG07/ENG06 rollback and restore plan; keep immutable observations/baselines and reader support for produced model versions. Stop unsafe publication before any separately authorized forward schema repair.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [migration.md](migration.md); [reconciliation.md](reconciliation.md); [verification.md](verification.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG06, ENG07.

**V-BC061 — independent acceptance:** Old-compatible reader runs against additive schema; probability/model versions remain readable; restore rehearsal preserves exact identities/refs and reports measured recovery loss/time rather than assumed guarantees.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC061; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC062 — Independent verification and safe isolated execution

**Allocation:** RELEASE; BC-M5; needs N12. Dependencies: BC059.

**Fields/domains:** fixture/implementation SHA; method/oracle; restricted role identity; harness lifecycle receipt; failures/skips.

**Selected plan:** Use independent expected outcomes, real multi-connection/role/SQL tests and existing guarded disposable harness; document/model/unit/preview evidence cannot substitute for each other.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [migration.md](migration.md); [reconciliation.md](reconciliation.md); [verification.md](verification.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG07.

**V-BC062 — independent acceptance:** Every implemented obligation maps to actual case/evidence or explicit unverified result; branch identity, authorization, sentinel,TLS,role,denylist and cleanup all pass before SQL qualification; no retained/production destructive test.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC062; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC063 — Publication, release ownership and exact production evidence

**Allocation:** RELEASE; BC-M5; needs N12. Dependencies: BC060, BC061, BC062.

**Fields/domains:** canonical main/remote/Vercel binding; PR/preview SHA; production SHA; both-league checks.

**Selected plan:** Revalidate identity and observable release ownership before implementation/deployment; use protected PR/full verification/actual preview and separate release authorization. Report local/published/preview/merged/deployed states independently.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [migration.md](migration.md); [reconciliation.md](reconciliation.md); [verification.md](verification.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG07.

**V-BC063 — independent acceptance:** Exact merged SHA reaches canonical Ready production and both LeagueOne/Two validate; source disagreement or missing authority stops; no competing owner observed is limited to inspected evidence.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC063; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC064 — Future adapter, authorization and licensing boundary

**Allocation:** ADMIN; BC-M6; needs N01, N02, N07, N15. Dependencies: BC010, BC014, BC015, BC029, BC051.

**Fields/domains:** provider capability matrix; OAuth/grant expiry/revocation; scoped aliases/native periods; source fixtures/terms.

**Selected plan:** Add future Yahoo/ESPN adapters, mappings and tests behind existing ports only after separately authorized access/terms. Provider-native rules remain in dialect extensions; no undocumented parity assumption.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [contracts.md](contracts.md); [mapping-revisions.md](mapping-revisions.md); [league-season-settings.md](league-season-settings.md); [backend-decisions.json](backend-decisions.json); [provider-mapping.md](provider-mapping.md). Decision IDs: ENG05.

**V-BC064 — independent acceptance:** Authorized real fixtures qualify identity/co-managers/lineup/scores/status/standings/transactions/pagination/grants; unsupported/not-provided facts remain explicit. Shared feature stack and NFL pipeline need no provider fork.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC064; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

**Specific exclusions:** Claiming Yahoo/ESPN shipped; Assuming access to private provider data; Non-NFL expansion.

### BC065 — Phase-entry design detail and change impact

**Allocation:** RELEASE; BC-M0; needs N01, N11, N12. Dependencies: BC001.

**Fields/domains:** stable obligation IDs; source/decision/model/acceptance links; phase-entry deliverables; review disposition.

**Selected plan:** Freeze this full-scope allocation now. Produce exact schema/interface/migration/test detail for each milestone at its entry through named current owners; rerun bidirectional review when a dependency or policy changes.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [migration.md](migration.md); [reconciliation.md](reconciliation.md); [verification.md](verification.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG07.

**V-BC065 — independent acceptance:** No known need or source field family lacks owner/milestone/oracle/dependency/exclusion; each implementation phase has reviewed detail before coding. Coverage counts do not certify correctness or all181 method activities.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC065; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

### BC066 — Commercial activation and unresolved external facts

**Allocation:** OPERATIONS; BC-M4; needs N09, N15, N12. Dependencies: BC051, BC058.

**Fields/domains:** license/terms approval evidence; measured provider completeness; capacity results; operating authorization.

**Selected plan:** Gate commercial activation on ENG05 access/license confirmation, empirical adapter completeness and capacity/cost evidence; engineering delegation does not sign contracts, buy feeds or establish upstream data availability.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [quality-operations.md](quality-operations.md); [../collection-capacity-validation.md](../collection-capacity-validation.md); [../release-validation.md](../release-validation.md); [backend-decisions.json](backend-decisions.json). Decision IDs: ENG03, ENG05, ENG06.

**V-BC066 — independent acceptance:** Unverified source licensing/price/entitlement or missing qualification is recorded as external evidence needed; internal implementation can proceed only within allowed data access and never represent blocked commercial activation as passed.

**Required evidence:** Exact reviewed implementation SHA and sanitized versioned fixture/capture hash for V-BC066; Recorded expected-versus-actual values, denied fields and committed effects for the case-specific oracle; Applicable restricted-role/SQL/source/load/compatibility receipt; failures, skips and external limitations remain explicit.

**Specific exclusions:** Purchasing access or contacting providers without authorization.

### BC067 — Actor export and account deletion

**Allocation:** ACCOUNT; BC-M4; needs N16, N03, N12. Dependencies: BC004, BC052, BC053, BC054.

**Fields/domains:** actor-scoped export manifest; reauthorized delivery handle/expiry; session/association revocation; personal identifiers/preferences disposal state; shared-fact pseudonymization; hold/retry/completion audit.

**Selected plan:** Implement actor-scoped export with current authorization again at delivery; disclose only that actor's authorized personal records and distinguish shared competition facts. ENG08 deletion revokes sessions and associations immediately and removes direct identifiers/preferences within the selected 30-day disposal obligation after applicable hold review. Separate personal scrubbing from preservation of referenced shared official facts; do not revive access through queued work or restored backups.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [backend-decisions.json](backend-decisions.json); [relational-design.md](relational-design.md); [behavior-security-design.md](behavior-security-design.md). Decision IDs: ENG01, ENG08.

**V-BC067 — independent acceptance:** Two-actor export fixtures cannot expose the other actor, private association or raw source payload. Revoke between export request and delivery and require denial. Delete amid in-flight commands, jobs and cache reads; verify immediate authority loss, eventual personal removal, idempotent retries, failure reporting, hold release, and no collateral deletion of another manager's history. A store-by-store manifest includes backup expiry/restoration safeguards and accepted remaining pseudonymous facts.

**Required evidence:** Reviewed implementation SHA, actor/data-store manifest and sanitized fixture or workload hash for V-BC067; Independent expected-versus-actual effects across primary data, queued work, cache, audit, evidence references and backups as applicable; Recorded restricted-role, expiry, failure and operational rehearsal results; unperformed procedures and external dependencies remain explicit.

### BC068 — Reference-aware disposal and backup lifecycle

**Allocation:** OPERATIONS; BC-M4; needs N16, N03, N12. Dependencies: BC012, BC037, BC055, BC056, BC067.

**Fields/domains:** retention class and clock origin; immutable reference closure; hold scope/reason/expiry; raw-payload deduplication; disposal job/tombstone/checkpoint; backup expiry/restore suppression.

**Selected plan:** Apply ENG08 retention by data class with explicit ownership. Unreferenced raw captures expire after the selected 30-day interval; referenced source evidence, normalized official history, scorer/model versions and frozen lineage survive while required by supported views, audit or reproduction. Existing immutable identity-audit restrictions are a distinct class, excluded from the new restricted case-audit retention limit. Last-follower changes never directly delete shared history. Before activation, qualify privacy holds, contractual exceptions, sink expiry and backups against actual service capabilities.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [backend-decisions.json](backend-decisions.json); [quality-operations.md](quality-operations.md); [relational-design.md](relational-design.md). Decision IDs: ENG08, D05.

**V-BC068 — independent acceptance:** A synthetic reference graph with multiple actors, historical baselines, corrected captures and shared content hashes proves collection deletes only eligible unreferenced material. Add/remove a reference concurrently with disposal and verify atomic protection. Exercise hold addition/release, interrupted sweeps, missing backup expiry capability and restoration of deleted personal data; fail qualification when promised class retention or suppression cannot be enforced.

**Required evidence:** Reviewed implementation SHA, actor/data-store manifest and sanitized fixture or workload hash for V-BC068; Independent expected-versus-actual effects across primary data, queued work, cache, audit, evidence references and backups as applicable; Recorded restricted-role, expiry, failure and operational rehearsal results; unperformed procedures and external dependencies remain explicit.

### BC069 — Stored-read service objectives and accountable response

**Allocation:** OPERATIONS; BC-M4; needs N16, N03, N12. Dependencies: BC044, BC050, BC057, BC058.

**Fields/domains:** eligible-read SLI numerator/denominator; rolling 28-day availability; server latency histogram; dependency attribution; freshness SLI independent; error-budget state; duty receiver/escalation/runbook.

**Selected plan:** ENG06 selects 99.9% successful eligible stored reads over 28 days, server p95<=500ms and p99<=1500ms, with freshness tracked independently. Correct unauthorized denials are successful security decisions; unavailable/indeterminate legitimate reads are service failures. Qualify selected paging thresholds, real duty receiver and escalation, error-budget release restraint, and process failover separately from disaster recovery.

**Design/decision references:** [backend-build-plan.md](backend-build-plan.md); [backend-decisions.json](backend-decisions.json); [quality-operations.md](quality-operations.md); [verification.md](verification.md). Decision IDs: ENG03, ENG06.

**V-BC069 — independent acceptance:** An independently classified mixed request corpus verifies denominator inclusion, legitimate failures, unauthorized denials and latency boundaries without silently excluding overload or dependency outages. Inject threshold crossings and prove routed acknowledgement/escalation and runbook stop/recovery actions. Exhaust error budget and confirm ordinary rollout restraint while approved risk fixes remain possible; freshness breaches block expansion even if read availability passes.

**Required evidence:** Reviewed implementation SHA, actor/data-store manifest and sanitized fixture or workload hash for V-BC069; Independent expected-versus-actual effects across primary data, queued work, cache, audit, evidence references and backups as applicable; Recorded restricted-role, expiry, failure and operational rehearsal results; unperformed procedures and external dependencies remain explicit.

## Reverse need coverage

| Need | Obligations |
| --- | --- |
| N01 | BC001, BC019, BC020, BC021, BC023, BC028, BC029, BC039, BC040, BC041, BC042, BC043, BC064, BC065 |
| N02 | BC003, BC009, BC010, BC064 |
| N03 | BC002, BC003, BC004, BC008, BC010, BC014, BC042, BC052, BC053, BC055, BC067, BC068, BC069 |
| N04 | BC005, BC008, BC009, BC052, BC056 |
| N05 | BC007, BC008, BC009, BC014, BC028, BC042, BC043 |
| N06 | BC012, BC013, BC014, BC015, BC017, BC018, BC019, BC020, BC021, BC022, BC023, BC024, BC025, BC026, BC027, BC028, BC029, BC044, BC057 |
| N07 | BC013, BC015, BC016, BC017, BC018, BC020, BC022, BC027, BC029, BC030, BC031, BC032, BC033, BC034, BC035, BC036, BC037, BC038, BC039, BC040, BC041, BC043, BC047, BC064 |
| N08 | BC006, BC010, BC011, BC012, BC024, BC026, BC030, BC035, BC044, BC046, BC047, BC048, BC050, BC053, BC056, BC057, BC058 |
| N09 | BC011, BC046, BC048, BC049, BC050, BC051, BC058, BC066 |
| N10 | BC002, BC006, BC012, BC052 |
| N11 | BC001, BC015, BC031, BC032, BC036, BC037, BC038, BC045, BC047, BC053, BC054, BC055, BC057, BC059, BC060, BC061, BC065 |
| N12 | BC001, BC054, BC055, BC058, BC059, BC060, BC061, BC062, BC063, BC065, BC066, BC067, BC068, BC069 |
| N13 | BC013, BC016, BC018, BC019, BC022, BC023, BC025, BC033, BC034, BC041, BC045 |
| N14 | BC004, BC008, BC056 |
| N15 | BC051, BC064, BC066 |
| N16 | BC050, BC067, BC068, BC069 |

## Known boundaries and remaining evidence

| Boundary | Owner / resolution | Allocation | Disposition |
| --- | --- | --- | --- |
| Detailed first-slice ERD/DDL/admission/auth lifetime | Data/security owners; backend-build-plan.md; relational-design.md; behavior-security-design.md | BC-M0, BC002, BC011, BC054, BC059 | Companion work selects/reviews these details; coverage does not certify completion. |
| Generalized current-season import and full-family joins | ADMIN, PERIOD, MATCHUP, SEASON, ACTIVITY, HISTORY; CF02-CF05; BC-M2 entry | BC015, BC026, BC027, BC028 | Chosen reuse/coverage architecture; exact closed schemas and executable fixtures produced at phase entry. Existing named-league/week limits are compatibility constraints only. |
| External source completeness, licenses, feed price, capacity and calibration | OPERATIONS, NFL, ANALYTICS; backend-decisions.json ENG03/ENG05; BC-M3/4 acceptance | BC009, BC039, BC049, BC050, BC051, BC066 | Known qualification work with explicit evidence and activation limits; no fabricated source support, contractual entitlement, performance or model accuracy. |

## Exclusions

- No runtime code, migrations, environment/secret/database reads, provider writes, production activation or purchase in this planning task.
- Website redesign/new page UX is excluded; backend contract compatibility and release/browser regression evidence remain necessary.
- Yahoo/ESPN and non-NFL sources are not shipped; BC-M6 is a separately authorized later adapter milestone.
- Universal recovery of unavailable prior-season source data is excluded; recoverable historical browsing and its explicit coverage limits are allocated to BC028/BC-M2.
- No requirement for all scoring/competition edge cases to support analytics before reliably represented official data is available.
- No blanket NASA/SEI/SSDF/ASVS/ISO conformance or claim that every inventoried method activity must be executed for every milestone.

No new runtime, migration, provider acquisition, database access, unit/integration execution, service deployment or commercial license was performed by producing this matrix. The complete planning allocation is a reviewable build plan, not a claim of complete correctness or readiness to activate every milestone.
