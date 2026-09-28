# Backend contracts

This is the normative target design, not a description of shipped APIs. Names below identify logical contracts; implementation should reuse existing modules/tables. [Migration design](migration.md) defines the transition from current contracts.

## 1. Bounded collection catalogue

Collect what a current feature needs, plus the settings and evidence needed to interpret it. A refresh plan declares the resource family, exact scope, field set, continuation, audience, deadline, and request budget. Do not retrieve an entire account history during a page request.

| Family | Fields collected or normalized | Scope / update trigger | Authority and consumer |
| --- | --- | --- | --- |
| Connection/discovery | Provider account key, display identity, accessible league keys, team memberships, consent scopes, connection state | Account/provider; connect, reconcile, revoke | Provider access evidence plus website account state; AccountLibrary/PortfolioSummary |
| League/season | Native league/game keys, name/logo, sport, season, lifecycle, predecessor evidence, visibility, available periods | League season; initial sync, settings, renewal | Host facts; navigation/LeagueOverview |
| Settings | Native scoring/stat catalogue, slot definitions, roster limits, lineup/substitution rules, competition structure, waiver/FAAB/division/playoff settings | Versioned league-season configuration | Host settings; interpretation and feature assessment |
| Teams/managers | Native team/roster key, names/artwork, manager keys/roles, source membership | League season; membership/name changes | Host facts; team and manager views |
| Standings | Record, PF/PA, provider rank/seed/division when supplied, waiver order/budget | Explicit standings stage/coverage | Host facts; OfficialStandings; calculated ordering kept separate |
| Schedule/matchups | Contest identity, participants, native period/date coverage, official scores, result/winner/finality, supplied adjustment facts | Contest/scoring period; active refresh, correction, history request | Host facts; MatchupDetail/TeamSchedule/history |
| Roster membership | Entities held, native groups and mapped bench/IR/taxi, effective coverage | Team plus provider coverage | Host facts; TeamRoster; current membership is not historical lineup proof |
| Lineup assignments | Slot instance, native slot, eligibility, assigned entity/explicit empty, lock/substitution evidence | Team/scoring period; change and reconcile | Host assignments; MatchupDetail and attention policy |
| Player/defense catalogue | Native entity key/type, canonical mapping, name, NFL team, positions, artwork, current status and source age | Sport/provider catalogue | Named sports/provider source; display and identity |
| Player points/football stats | League-scored official player points when supplied; stat IDs/values/units and coverage/corrections | Entity plus league/profile context and scoring period | Host points or named sports-stat source; box scores/qualified metrics |
| Transactions/waivers | Native event ID/type/status, participants, directional assets, bids/units, picks, timestamps, supplied claim outcomes | League/team, retained interval and pagination | Host facts; ActivityFeed; losing/pending claims only when visible |
| History/honors | Prior connections, completed results, manager participation, coverage; separately curated championships | Explicit seasons and contest classes | Host or curated evidence; ManagerHistory |
| Drafts/picks/brackets | Existing retained native evidence, IDs, dates, supported references | League season/settings/history needs | Preserve current evidence; no new draft-management UI promised |
| Shared sports inputs | Existing Tank01 raw projections, NFL games/schedule, scores/clocks, statistical vectors | NFL season/week/game/model | Existing sports adapters/workers; no browser Tank01 calls |
| League One outputs | Baselines, forecasts, probability, projected standings, PPG/ranks, attention | Exact input revision set/model/profile/scope | Derived output; never substitutes for absent official facts |

Unsupported history is explicitly unavailable. Corrections/removals are synchronization concerns. Retention limits are resource-specific and respect provider terms; this design does not authorize indefinite storage of every raw response.

## 2. Identity and period model

| Entity | Internal identity and relationships | Rules |
| --- | --- | --- |
| WebsiteAccount | Existing account UUID | Website actor never comes from a submitted provider ID |
| ProviderAccount | UUID plus provider and opaque account key/namespace | Separate accounts remain separate; display name is not identity evidence |
| ProviderGrant | UUID, website account, provider account, allowed scope, state/revision, protected credential reference | Public association and verified private access have different assurance |
| League | Existing stable UUID/public route key | Preserve existing links; never merge provider leagues by name |
| LeagueSeason | Existing UUID, League, NFL season, selected official source | Annual continuity needs predecessor evidence or reviewed linking |
| SourceConnection | Existing connection mapping plus proposed stable connection ID/revision metadata | One selected official source per league-season initially; preserve superseded evidence |
| SeasonTeam | Existing season-scoped UUID plus native aliases | Manager change does not create a new team; roster numbers repeat across leagues |
| TeamMembership | Provider manager, SeasonTeam, role, observed/effective validity, assurance | Participation, preference, following, affiliation, and permission are separate |
| ScoringEntity | Existing canonical player/defense plus provider aliases | Unresolved native entities may display; related analytics remain unavailable |
| NflGame | Existing canonical game and aliases | Preserve reviewed crosswalk and schedule consistency |
| ScoringPeriod | Internal ID, LeagueSeason, native key/kind/ordinal/label, nullable start/end, evidenced NFL-week mapping | Current display period, active scoring period, and NFL week are separate facts |
| Contest | Internal ID, LeagueSeason, native reference if present, participant association, one or more ScoringPeriods | Multiweek contest is not one NFL week; median outcome is not a fabricated opponent |
| ConfigurationVersion | Content identity, observation/applicability, optional compiled ScoringProfile, CompetitionProfile | Native settings stay readable without a compiled forecast profile |
| Transaction | Internal ID plus provider/league-scoped event reference | Replay observes the same event; amendments retain lineage |

External lookup uniqueness is `(provider, resource kind, native namespace, native ID)`. Namespace includes parent league/game/season where needed. Native IDs are opaque strings; preserve full composite keys and case. Mappings retain validity, evidence, assurance and conflict state. Conflicting or name-only matches cannot silently merge entities. [Migration design](migration.md) maps these concepts to existing tables.

When a provider supplies no stable matchup ID, keep the canonical Contest ID and a versioned source-derived discriminator scoped by league-season, competition stage, native period set and participant relationships. Preserve native participant ordering when it has meaning; never use a response array index as identity. Ambiguous duplicate contests remain unresolved until reconciliation supplies enough evidence. A changed participant/period tuple requires explicit correction/linking evidence, not a silent identity reassignment.

NFL season type and fantasy competition stage are different fields: a fantasy playoff contest commonly uses an NFL regular-season week. Existing `LeaguePeriod` remains the supported NFL-week calculation contract. Add an evidenced mapping to ScoringPeriod rather than reinterpreting old `seasonType`/`week`. Daily/custom periods can be retained as native facts but remain unsupported for forecast materialization until implemented.

## 3. Observation envelope and acceptance

The TypeScript notation below fixes semantics, not runtime exports. `Id` is an opaque internal identifier serialized as a string; preserve existing UUIDs and content identities. `Instant` is an ISO 8601 UTC timestamp with a `Z` suffix. V2 `Decimal` values serialize as finite base-10 strings, with units and a declared scale/rounding policy on their field definitions; existing v1 numeric payloads remain compatible. SQL types and executable validators are implementation deliverables in package A.

```ts
type SourceScope = {
  connectionId: Id;
  leagueSeasonId: Id;
  family: ResourceFamily;
  entityId: Id | null;
  scoringPeriodId: Id | null;
  audienceId: Id; // server-resolved visibility partition
  coverageSpecId: Id; // immutable requested interval, fields, entities and filters
};

type SourceObservation<T> = {
  schemaVersion: string;
  adapterVersion: string;
  canonicalNormalizerVersion: string;
  sourceMappingRevisionId: Id;
  scope: SourceScope;
  observationId: Id;
  captureId: Id;
  pageIdentity: string | null;
  rawContentRef: Id | null;
  normalizedContentRef: Id;
  nativeRevision: string | null;
  sourceUpdatedAt: Instant | null;
  requestStartedAt: Instant | null;
  requestCompletedAt: Instant | null;
  sourceObservedAt: Instant | null;
  checkedAt: Instant;
  normalizedAt: Instant;
  origin: 'network' | 'cache' | 'retained-replay' | 'bootstrap';
  coverage: {
    periodIds: Id[];
    interval: { from: Instant; to: Instant } | null;
    entitySet: 'full' | 'subset' | 'unknown';
    fields: string[];
    pagination: 'complete' | 'continuation' | 'unknown';
    nextCursor: string | null; // protected server state
    completeness: 'complete' | 'partial' | 'unknown';
    reasons: string[];
  };
  payload: T;
};

type AcceptedResource = {
  scope: SourceScope;
  canonicalNormalizerVersion: string;
  sourceMappingRevisionId: Id;
  contentId: Id;
  observationIds: Id[];
  validationVersion: string;
  acceptedGeneration: number;
  verifiedAt: Instant | null;
  effectiveFrom: Instant | null;
  effectiveTo: Instant | null;
  effectiveEvidence: 'provider' | 'observed' | 'unknown';
};
```

This league-resource scope applies after enrollment identity resolution. Discovery is scoped by provider connection/grant plus requested sport/season with a nullable internal league-season until proven. Shared NFL catalogue/projection/game-state resources retain their existing sport/period/feed scope, outside fantasy league identity. They are joined through explicit references, not forced into a fake league scope.

The immutable coverage specification identifies requested periods/interval boundaries (including inclusive/exclusive semantics), entity selection, field set and filters. Fetches, scan continuations, accepted heads and jobs reference the same specification; a seven-day transaction request cannot replace a season-wide collection. Observed coverage reports what was actually returned against that request. Pagination cursors belong to a scan, not to a new resource scope. Replay uses the captured source-mapping revision, never today's connection mapping. Accepted-head identity also includes the canonical normalizer version, allowing old and new interpretations to coexist during comparison without overwriting each other.

Timestamp meanings:

- `sourceUpdatedAt`: documented provider change time if supplied, otherwise null.
- `requestCompletedAt`: response arrival; not the user's change time or provider freshness guarantee.
- `sourceObservedAt`: when underlying content was observed. Cache/replay inherits the original time; an unproved cache observation time remains null.
- `checkedAt`: this source-check attempt. Re-reading cached content does not reset source age.
- `normalizedAt` and read-model `materializedAt`: our processing times, never presented as provider update times.
- `verifiedAt`: latest successful validation of required resource coverage under its source freshness policy, not merely HTTP success.
- Effective validity describes the facts' scope; an observation alone does not prove a historical start date.

Content hashes deduplicate content; observation IDs record retrieval evidence. Neither proves event order. Acceptance uses transactions, write fences/generations, comparable native revisions where available, and a versioned resource-specific ordering policy. Reject/quarantine conflicting out-of-order captures. A correction to a past week creates a new revision of that scope without regressing active-week authority. Equal-content fresh captures may advance verification without rewriting immutable content.

Complete means complete for the declared entities, fields and period. A replace-style collection must finish all pages and pass its scan-consistency policy before absence implies removal, and replacement/deletion applies only within equivalent coverage specifications. Partial/error/restricted responses never delete accepted members. Without stable scan tokens, record page observation intervals and reconcile changing scans; mark incoherent replacements partial. Retain explicit tombstones/corrections when supplied. Redaction/revocation is not evidence the league was deleted.

Validation outcome (`accepted`, `rejected`, `quarantined`) is separate from completeness. A resource policy may accept partial read evidence, as current box scores and provisional weekly metrics do, without advancing a complete-inventory replacement pointer. Retain its partial status, coverage and exact observation reference. Do not combine arbitrary partial captures into a supposedly complete stat line. Invalid raw captures may be retained for diagnostics under retention policy; they do not acquire an invented normalized record or accepted head.

## 4. Canonical resource records

Use typed common records with namespaced native extensions/evidence. Shared readers do not interpret raw provider JSON. Fields with common provenance can share metadata; wrapping every scalar is unnecessary.

Providers can report a counted slot category such as two WRs without identifying WR1 versus WR2. Expand equivalent slots into stable canonical instances under a versioned presentation-order policy (using stable entity references to break ties); label that assignment as League One ordering, and retain the native selected category. Do not claim the provider assigned a particular ordinal. If apparently similar slots have different rules, ambiguous assignment limits the affected lineup/forecast feature until qualified.

| Record | Identity and value groups |
| --- | --- |
| LeagueSeasonFacts | League/season/source IDs, name/artwork, NFL season, native/mapped lifecycle, native period pointers, visibility, resource support |
| TeamFacts | SeasonTeam, source reference, name/artwork, manager relationships and display metadata provenance |
| StandingsEntry | SeasonTeam, W/L/T and other native result components, PF/PA, optional provider rank/seed/division, coverage/stage/tiebreak evidence |
| SlotDefinition | Configuration-local instance key, native label, ordinal/count expansion, mapped section/role, eligible position set, unknown conditions |
| RosterMembership | SeasonTeam, source entity, canonical entity or unresolved state, native section, effective coverage |
| LineupAssignment | SeasonTeam/ScoringPeriod/slot; occupied/empty/unknown; source entity/canonical mapping; assignment/lock/substitution evidence |
| ContestFacts | Contest/period IDs, typed participants and matchup kind, official totals, native result/finality, explicit winner/tie/bye/median outcome |
| PlayerPoints | Source entity, SeasonTeam/league scoring context, ScoringPeriod, official value or missing state, correction refs |
| FootballStatLine | Entity, NFL game/week, stat catalogue version, canonical event/value/unit mappings, unsupported native events |
| TransactionFacts | Event/league, native/mapped type/status, participants, event/processing times, directional assets, bid units, claim visibility/outcome evidence |
| HistoryEntry | Manager/team/season, contest class/period coverage, official outcome facts, continuity evidence/completeness |
| CuratedHonor | Provider-qualified or explicitly linked subject, league/year/type, curated evidence/version |
| DerivedResult | Feature/model, exact source manifest, configuration/scoring/competition versions, output values and support/freshness/quality |

Do not reconstruct official team totals from player sums when provider totals are supplied. Preserve adjustments when explicitly supplied; an unexplained difference is not automatically a commissioner adjustment. Bench scores never enter starter totals. Preserve decimal precision and explicit source rounding; display rounding must not become new scoring or forecast input. The existing v1 `projectedOutcome` comparison intentionally uses two-decimal display totals; retain that named presentation-policy exception through compatibility readers, without changing official outcomes or underlying forecasts.

Optional `providerRank` is distinct from a `presentation-derived` order calculated from record/PF/PA under a named policy. Keep current separate ordering policies through compatibility readers until an explicit change unifies them. Current names/injury status may decorate past views only with explicit `current-display` context; they are not historical facts.

ScoringProfile describes statistics to fantasy points. CompetitionProfile describes team scores to results/standings and retains known, unsupported and unknown rules. Both retain native settings even if interpretation is unavailable. Forecast support needs qualified scoring and appropriate competition/lineup semantics; official viewing does not. A universal scoring language or full competition engine is outside this stage.

## 5. Independent state and feature contracts

```ts
type Support = 'full' | 'limited' | 'unavailable' | 'unverified';
type Availability = 'present' | 'empty' | 'pending' | 'missing' | 'failed' | 'redacted';
type Freshness = 'fresh' | 'stale' | 'unknown';
type FieldGroup<T> = {
  value: T | null;
  availability: Availability;
  completeness: 'complete' | 'partial' | 'unknown';
  freshness: Freshness;
  authority: 'provider-official' | 'provider-estimate' | 'sports-source' | 'presentation-derived'
    | 'league-one-estimate' | 'curated';
  temporalContext: 'requested-period' | 'current-display' | 'season-to-date';
  sourceRefs: Id[];
  reasons: string[];
};
type FeatureAssessment = {
  feature: FeatureId;
  support: Support;
  scope: SourceScope;
  configurationVersionId: Id | null;
  requiredInputs: string[];
  missingInputs: string[];
  unsupportedRules: string[];
  approximationPolicy: string | null;
  assessmentVersion: string;
  assessedAt: Instant;
};
```

`FeatureId` covers official overview, roster, lineup, scores/results, standings, schedule, transaction detail, waiver claims, history, box scores, player projection, team forecast, win probability, projected standings, lineup attention, and calculated player/roster metrics. Resource support and per-league rule support both contribute. Runtime availability/age are separate and scoped to the request. Connection/access state is evaluated before any of these client-visible data states; denied requests reveal no private resource details.

Examples: an official score of `0` is present; absent score is missing/null; an evidenced empty bench is empty/complete; missing lineup is not a valid all-empty lineup. A limited projection identifies known omissions and an approximation policy. An unverified scoring rule does not inherit an unrelated existing omission exception. A stale but still authorized last-good resource can remain present/stale with its own source refs and a failed-latest-attempt diagnostic; freshness policy controls whether it is displayable. Numeric forecasts/probability require the existing or explicitly approved coverage policy.

Enrollment requires eligible access, proven league-season identity and enough metadata/team identity for an honest LeagueOverview. A personal card additionally needs a resolved user-team association. Other features are independently assessed. Malformed roster data can leave league metadata readable but cannot produce an invented lineup. Migrate required-profile consumers before allowing official-only enrollment.

## 6. Adapter and ingestion ports

The connector registry is an allowlist of implemented adapter versions. A provider string in a source document never enables arbitrary network requests. Logical operations:

| Operation | Input | Output / boundary |
| --- | --- | --- |
| `discover` | Server-resolved connection/grant, NFL season, opaque continuation, deadline/budget | Candidate source leagues/teams, source coverage and continuation; no automatic enrollment or ownership claim |
| `fetchResource` | Authorized source scope, native resource reference, requested fields, prior validator/cursor, deadline/budget | Capture or unchanged proof; partial/continuation, retryable, permanent or reauthorization outcome; no direct table/pointer writes |
| `normalize` | Existing capture, source references, adapter/schema version, mapping/configuration evidence | Typed proposed records, native extension refs, diagnostics/completeness; pure replay without network |
| `interpretSettings` | Retained native settings plus stat/slot catalogues and versions | Scoring/competition/roster interpretation, explicit unsupported/unknown fields; no fabricated defaults |
| `assessCapabilities` | Interpreted configuration, requested scope, documented connector support | Versioned feature assessments; never grants access or bypasses per-read data validation |

Shared ingestion resolves/validates scope, access, identity, resource schema and capture completeness, then records evidence, accepts typed records and schedules dependent materialization. Dependencies may be unresolved while storing raw evidence, but a reader or calculation cannot accept a field that requires the unresolved identity/configuration.

Extend current ownership leases and database write fences. Logical job uniqueness is resource scope plus purpose/input revision; retries share that identity. Claims include generation/deadline and authorization/mapping revisions. Accepted heads and durable pending downstream work commit together, using existing transactional pending state or an outbox as necessary. A process crash must not lose a required rebuild. Bound continuation, provider-wide budgets, backoff/jitter, permanent failure isolation and priority are part of the contract. Webhooks, when available, schedule reconciliation rather than bypass validation.

Preserve the current cached official fallback during migration. Route it through the same adapter/access boundary and existing request budget, with in-flight deduplication where currently supported; it cannot become an unrestricted per-page collector. Browser polling continues to read stored revisions and never invokes Tank01. Broader replacement of fallback behavior needs a separately qualified reader change.

## 7. Reader ports and compatibility

| Read contract | Selector and response |
| --- | --- |
| AccountLibrary | Server-resolved actor; connections, discovered/enrolled/followed leagues, participation, grants, preferences, feature/sync state |
| PortfolioSummary | Actor + exact/current period request + pagination; SeasonTeam cards with opponent/score/record/ranks/qualified forecasts/attention, per-card revision and drilldown IDs |
| LeagueOverview / OfficialStandings | Internal league-season and declared coverage/stage; teams/record groups, optional provider rank, named derived order, waiver metadata |
| MatchupDetail | League-season + resolved ScoringPeriod/contest; official totals, typed participants, exact lineups/bench, qualified forecasts/probability, lazy stat detail |
| TeamRoster | SeasonTeam + exact period; membership/assignment groups, independently dated current decorations, game context and qualified metrics |
| ProjectedStandings | League-season + exact period + explicit enable; qualified completed basis and forecast refs; otherwise official view plus reason |
| ActivityFeed | League/team + retained interval + opaque cursor/type filter; structured transactions/waivers, visibility/coverage by field |
| ManagerDirectory / ManagerHistory | League-season or evidenced season range; provider managers, records, curated honors and coverage |
| TeamSchedule | SeasonTeam + explicit period range; opponents, official scores/result/finality and independent missing rows |

Responses include `contractVersion`, resolved scope, opaque revision, `materializedAt` and field-group provenance/freshness. Complete source manifests can stay server-side behind opaque references; never return credentials or raw private payloads as metadata. Portfolio aggregation includes counts of covered/missing teams rather than silently counting unavailable results as losses or zeros.

The [screen map](screen-data-map.md) defines all required payload value groups and existing source functions. Component names such as `TeamProfileView`, `LeagueWaiversView`, `WebsiteAccountView`, `PeriodSelection` and `LineupAttention` there are subviews/value groups of these reader ports, not independent ingestion services. Player/stat/metric detail remains lazy and references the same accepted resource IDs.

Materialization validates compatible league-season, period, configuration applicability and audience, recording deliberate mixed temporal context. Missing current rank does not invalidate an exact-week score. Incomplete required lineage blocks the affected derived feature. Current/explicit period selection preserves existing calendar policy; older-week snapshots never satisfy exact current-week requests.

Existing numeric `Team.id`, routes, payloads and poll protocol are v1 compatibility contracts. V2 readers expose stable SeasonTeam IDs and metadata. Compatibility presenters retain existing IDs/semantics only where a proven mapping exists. Yahoo must use a v2-capable presenter or explicit adapter, never conversion of its composite key into a numeric roster ID. A typed DTO and serialized fixture for each port above are package A implementation deliverables; this document changes no public endpoint.

## 8. Access, cache and display privacy

Private source observations, read rows, source-manager display metadata, raw blobs and caches retain a proven audience. Default private audience is the individual grant; widen only when provider policy and equal visibility are established. Shared canonical identity does not make private names or payloads globally readable.

Each request resolves the actor server-side, checks a current grant/association, and limits reads to permitted audiences. Cache keys include relevant audience/entitlement revision. Revoke access at read/publish authorization immediately, invalidate retained private responses for serving, and fence in-flight work. Do not fall back to a public cache or another account's private snapshot. Later physical retention/purge follows the approved policy. Credential rotation is coordinated server-side; secrets/cursors are never casually exposed through URLs, logs, fixtures or read contracts.

Public Sleeper links remain user-asserted and nonexclusive. Guest team selection remains a display preference. Following, managing, and being allowed to read a league stay distinct.

## 9. Required contract cases

Implementation qualification covers overlapping provider/league IDs; annual renewal; co-managers/replacement; unresolved player/defense; multiweek contest versus NFL week; empty slot versus missing lineup; empty complete collection versus failed/paginated collection; cached age versus verification; past correction; partial scan without deletion; duplicate/out-of-order capture; settings with unknown effective dates; optional scoring profile; official adjustment without invented cause; audience collisions; revocation during fetch/read/publish; partial provider failure; and unsupported analytics with readable official facts.

The [provider specimens](provider-mapping.md) are documentation-derived mapping evidence. The [migration gates](migration.md) determine when implemented contracts may serve production readers.
