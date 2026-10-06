# Backend contracts

This is the normative target design under the authority and supersession rules in [the entry point](README.md), reconciled on October 5, 2026. It does not describe shipped APIs. [foundation.json](foundation.json) defines the bounded first-slice fields, D02 value and acceptance cases; [its generated field view](foundation-fields.md) is a checked rendering. Names identify logical responsibilities, not mandatory tables. The [reconciliation record](reconciliation.md) owns observed facts and the next implementation sequence. Earlier [migration proposals](migration.md) apply only where consistent with this reconciled target.

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
  kind: 'enrolled-resource';
  connectionId: Id;
  leagueSeasonId: Id;
  family: ResourceFamily;
  entityId: Id | null;
  scoringPeriodId: Id | null;
  audienceId: Id; // server-resolved visibility partition
  coverageSpecId: Id; // immutable requested interval, fields, entities and filters
};

type DiscoveryScope = {
  kind: 'discovery';
  provider: ProviderCode;
  accessContextId: Id; // server-resolved public access or private grant context
  sourceLeagueKey: string; // opaque candidate key; no enrollment required
  sourceSeasonNamespace: string;
  sport: 'nfl';
  season: number;
  leagueSeasonId: Id | null; // null until an internal identity is proved
  audienceId: Id;
  coverageSpecId: Id;
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

`SourceScope` and the observation/acceptance envelopes above apply after enrollment identity resolution. Pre-enrollment compatibility assessments use `DiscoveryScope`, keyed by provider, native candidate identity, requested sport/season, access context and coverage. Discovery captures retain their own observation IDs and provenance without requiring an official source connection or source-mapping revision. A public access context grants no private permission. Resolving an enrolled identity explicitly links discovery evidence to `SourceScope`; it never invents an ID or enrolls a league merely to assess compatibility. Shared NFL catalogue/projection/game-state resources retain their existing sport/period/feed scope, outside fantasy league identity. They are joined through explicit references, not forced into a fake league scope.

Before a league candidate exists, use the exact `IdentityLookupScope` and `AccountResourceScope` definitions in [the field register](foundation-fields.md). Username lookup is capture-only under an immutable lookup request ID, acquisition context, provider and audience; a mutable username never becomes an accepted-head identity. A successful response explicitly resolves the stable provider account. A league-list receipt then scopes that account, NFL and one queried season with its coverage specification. Neither scope has a fabricated league ID or source-mapping revision. Candidate league captures link explicitly to their originating list receipt. Capture provenance survives failure; normalized content and accepted generation stay null where validation/acceptance never occurred. Any later account-resource head uses the same versioned-policy identity rule, through the existing writer owner, after separate qualification. No such extension is claimed implemented.

The immutable coverage specification identifies requested periods/interval boundaries (including inclusive/exclusive semantics), entity selection, field set and filters. Fetches, scan continuations, accepted heads and jobs reference the same specification; a seven-day transaction request cannot replace a season-wide collection. Observed coverage reports what was actually returned against that request. Pagination cursors belong to a scan, not to a new resource scope. Replay uses the captured source-mapping revision, never today's connection mapping.

### Accepted-head identity and serving selection

The accepted-head identity is `(SourceScope, canonicalNormalizerVersion, validationVersion)`, including all scope fields and equal null entity/period values. Current scoped SQL represents this as `identity = {scope, policy}`; the policy repeats audience/coverage and contains both versions. Retain that identity. The Ground up proposal of a single unversioned resource head is superseded for normalized acceptance. A raw capture can be shared by several interpretations; capture identity does not replace normalized-head identity.

Each versioned head has its own reservation ordinal and acceptance generation. Mapping revision, context revision, lease/deadline and expected generation are write fences, not substitutes for a versioned identity. Comparing ordinals or generations across versioned heads is invalid. A replay may build a new interpretation from retained evidence, but cannot impersonate a new network attempt, refresh membership verification, or overwrite a legacy head. Existing network-only acceptance functions stay network-only until an additive, separately qualified replay path exists through the same writer owner.

A reader contract/cohort pins one qualified `(normalizer, validation)` pair per logical scope. That serving selection is a responsibility of existing configuration/authority and reader composition, not a mandate for another table, writer or publication pipeline. Old/new heads coexist for same-capture comparison. Neither newest timestamp nor semantic-version sorting selects production data. Promotion requires compatible scope/audience/coverage, validated lineage and evidence age, explicit reader binding revision, and comparison acceptance. Commit a changed binding and required pending materialization atomically through the existing owner, or refuse promotion until it can do so. Materializations record binding revision and exact accepted references; older in-flight work cannot publish after a binding change. Rollback selects a compatible still-authorized version with valid evidence; it does not resurrect revoked access or mutate frozen baselines. No general promotion registry is claimed implemented today.

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
  scope: SourceScope | DiscoveryScope;
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

The reconciled target requires one active provider account per L1 actor per provider and one active L1 actor per provider account. Sleeper identification remains read-only and user-asserted; exclusivity is an L1 association rule, not external-account ownership verification. The current nonexclusive implementation is dated source behavior to adapt, not target policy. Guest team selection remains a display preference. Following, managing, and being allowed to read a league stay distinct. D03 mistaken-claim/replacement recovery is open before public exclusive-claim launch; a conflict must not silently replace another association or reveal another L1 identity.

## 9. Adding data and handling provider changes

Start a collection change with a user need and a screen-map entry: field meaning, authority, period, units, required coverage, missing-data behavior and consuming feature. A provider offering a field is not by itself a reason to collect it. Check that access, retention and request budgets cover the addition.

| Change | Required handling | Acceptance evidence |
| --- | --- | --- |
| Add a field for a new feature | Extend the canonical record and reader contract compatibly where possible; map each implemented provider independently. Distinguish not-yet-collected, not-provided and unsupported states. Deploy readers that tolerate absence before requiring the field; version incompatible contracts explicitly. | Old stored records and existing readers still work; new records render correctly; a provider lacking the field produces an explicit limitation. |
| Retrieve past values for the new field | Normalize retained evidence under a new version when it contains the field; otherwise use bounded ordinary collection only where the provider supplies historical evidence. | Replay retains original observation age and lineage. Unavailable history remains missing; today's value never becomes an invented past fact. |
| Provider renames/removes a field or changes its format/meaning | Update that provider's adapter, validation and mapping fixtures. Keep canonical meaning stable when the source still supports it. A genuine new meaning requires a versioned canonical change and affected-feature reassessment. | Old/new response examples have explicit expected mappings. Invalid or ambiguous responses cannot replace accepted facts; unrelated fields/providers remain usable. |
| Provider corrects an official fact | Accept a new source revision under ordering and scope rules; refresh affected official read models and eligible dependent calculations through the existing publication path. | A corrected score is reflected without changing unrelated periods, inventing adjustment reasons, rewriting frozen baselines or mutating immutable published snapshots. New derived revisions preserve lineage. |

Detect unexpected source shapes through runtime validation and scoped diagnostics, including missing required fields and unknown enum values. Tolerate harmless additive fields without automatically exposing or depending on them. Syntactically valid semantic changes also require maintained provider examples and pilot comparisons; schema validation alone cannot prove meaning. Use authorized last-good data only within the resource's freshness policy, otherwise show unavailable. Track the affected adapter/resource and provide an operator-visible failure reason without logging private payloads or credentials. Recovery reuses bounded collection/replay and the same fenced writer.

Package A must include explicit fixtures for additive-field compatibility, provider format/meaning changes and official corrections. These requirements are not implemented tests in this documentation PR.

## 10. Required contract cases

Implementation qualification covers overlapping provider/league IDs; annual renewal; co-managers/replacement; unresolved player/defense; multiweek contest versus NFL week; empty slot versus missing lineup; empty complete collection versus failed/paginated collection; cached age versus verification; past correction; partial scan without deletion; duplicate/out-of-order capture; settings with unknown effective dates; optional scoring profile; official adjustment without invented cause; audience collisions; revocation during fetch/read/publish; partial provider failure; and unsupported analytics with readable official facts.

Discovery fixtures must assess an unenrolled candidate with `leagueSeasonId: null` without creating league/source-connection records, then prove explicit evidence linkage after enrollment. Discovery support is provisional and must be reassessed against accepted configuration and current access before activating enrolled features.

The [provider specimens](provider-mapping.md) are documentation-derived mapping evidence. The [migration gates](migration.md) determine when implemented contracts may serve production readers.

## 11. First slice: identification, shared current teams and stored reads

The bounded internal service path is `IdentifyProviderAccountResult -> DiscoverCurrentTeamsResult -> LeagueAccessDecision -> ReadCurrentRosterResult`. These names are proposed internal result contracts, not new public routes. The [field register](foundation-fields.md) supplies precise normalized names, types, source paths, identities and constraints. Existing `SourceScope`, `DiscoveryScope`, `LeagueSettingsValue`, accepted manager/roster resources and their field coverage remain the nested types; reuse their normalizer and writer. Provider-specific paths stop at the adapter boundary. Yahoo/ESPN have no implemented adapter or access claim in this slice.

Identification preview resolves a username to a stable provider account and retains lookup evidence without enrolling, following or activating a connection. Explicit association activation takes a trusted L1 principal, validates the resolved candidate and commits both active uniqueness constraints atomically. Repeated activation is idempotent; conflicting activation returns a private-safe conflict. A pending lookup grants no access. Directory labels are optional, and qualification must not require an enrolled league's `users` head to establish pre-enrollment identity.

Discovery supplies candidates, not team eligibility. Enumerate all proven owner/co-manager teams from qualified roster-role evidence, including multiple teams; preview sampling or the first matching roster cannot be used as a complete scan. Commissioner flags and presence in a league user list are insufficient. Define and record the required season-query set, completed scopes and strategy version. The existing single `/state/nfl.league_season` query does not prove complete current-team discovery. A candidate initial strategy queries qualified NFL calendar/discovery seasons, their relevant adjacent season and retained current selections; qualification must establish the finite scope for supported Sleeper leagues using cold-start and delayed-renewal fixtures. If relevant coverage cannot be proved, return partial instead of claiming all current teams or absence. This is an engineering qualification gate, not an invented product rule limiting current eligibility to two years.

Current selection is per association and stable league. A completed current season remains available while eligible. A higher year, later enrollment row or globally advanced NFL year cannot replace it. Verified renewal must pin predecessor and successor source-mapping revisions, establish nonconflicting annual continuity, and freshly verify the user's successor owner/co-manager relationship. Initial selection needs equivalent current identity/role qualification; ambiguous successor chains remain unresolved. Separate leagues may select different years. Shared league facts and source connections are independent of these user-specific selections.

A follow belongs to the actor and stable league. Discovery never creates one. Verified renewal carries an existing follow only against its expected preference and selection revisions; a newer unfollow wins. Keep revision/tombstone evidence even where current storage represents unfollow by absence. Genuine membership-loss/regain follow behavior is D04, and last-follower collection/retention is D05. Neither is decided by renewal carryover. Their activation gates do not block independent field, policy and identity work.

### D02: bounded league access, independent account access

The approved policy is **`sleeper-membership-access-v1`, `max_membership_age_seconds = 3600`**. It is approved for implementation and **not deployed**. The immutable approval and adjustment history is retained in [transition evidence](evidence/backend-policy-register.json); its proposed physical table names are not mandatory. `foundation.json` is the reconciled value register. A changed duration requires a newly approved immutable policy version, synchronized field/readable views, explicit deployment version and new boundary tests; never silently rewrite v1 or fall back to a hardcoded runtime default.

Every allow expires at `T + 3600 seconds`, or an earlier applicable authority expiry, where `T` is the latest successful qualifying membership verification. Qualification needs accepted, scope-compatible network evidence of at least one owned/co-managed current team, valid population/role coverage for that positive claim, and current mapping/context/association. `T` is the verified network receipt time retained by the acceptance path, never a cache read, normalization, replay or later materialization time. A same-content fresh network verification may advance it. Unqualified partial evidence may not; a qualified positive role group can be usable even when unrelated display or held-player fields are unavailable. Store that qualification explicitly rather than treating an overall partial response as fresh complete membership.

Allow requires `now < expiresAt`. At equality it is expired, even if no failure or outage has been recorded. Failed, missing, null, partial/unqualified, cached, replayed and bootstrap observations and outage onset never extend the clock. Unknown first-time membership never allows. An accepted complete exclusion of **all** remaining owner/co-manager roles denies earlier. Exhaustive removal requires independently qualified expected team population and known applicable role groups; primary-owner completeness alone cannot prove no co-management. A null owner only proves unowned primary role, not no co-managers. A later valid role correction may restore eligibility, subject to D02 and independent authority, while D04 follow behavior remains unactivated. Expiry is not membership-removal evidence.

Provider outage, disconnect, membership loss and expiry never disable L1 sign-in or change L1 account lifecycle. Separate account/session revocation remains authoritative. Background revalidation retains its independently valid acquisition authority and justified work demand after temporary membership expiry; an authenticated recovery request may schedule bounded work without already possessing the allow it is trying to refresh. It cannot bypass a real disconnect or permission revocation. Shared evidence used by another eligible actor survives an individual disconnect. D05 remains the gate for changing last-follower behavior.

### Stored-read delivery and correction

Authorize the actor, association, selected season, qualifying role evidence, source mapping, acquisition/audience authority, explicit policy version and expiry before composing a stored result. Recheck those dependencies immediately before serialization after slow work. This final successful check is the delivery linearization point; no promise is made to recall already delivered bytes. A response/cache may not outlive the earliest dependency expiry, and every delivery reauthorizes or validates all current dependency revisions. Deep links, aggregate cards and cached reads use the same access service. Denied/indeterminate results disclose no protected league data or competing account identity. Provider acquisition never runs inside a database transaction held open for the request.

`ReadCurrentRosterResult` is a discriminated union, with exact required fields and prohibited extras in `foundation.json`'s `variants`. An authorized `available` result contains the selected league season, all eligible team IDs, opaque resource revision, official roster, coverage/source age and independent feature assessments. Authorized `pending`/`unavailable` results retain the authorized selection and explicit reason, with null roster/revision and empty field/feature arrays until a resource exists. A `denied`/`indeterminate` result contains **only `status` and a safe `reason`**: no league/team IDs, resource revision, roster, field/source metadata, features or internal access dependencies, including when denial precedes selection. `LeagueAccessDecision` is a separate server-side evaluation record and is never serialized as a result field. Missing optional catalog/placement/projections does not hide valid held IDs. A cold resource may be pending without fabricating an empty roster. Current held membership cannot become an exact-week lineup. Valid stale data remains readable with original age only while authorization and the applicable resource display policy permit it. D02 is an access lifetime, not a universal data-freshness threshold.

Append immutable observation/acceptance revisions and retain prior evidence. Later admitted qualified requests may correct values downward; increasing numeric values and response arrival time are not ordering policies. Reject stale reservations, A-B-A mapping work, invalid populations and incompatible audiences before head advancement. Accept manager facts independently from held-player validation, using the existing resource split. A malformed player array must not suppress independently qualified removal, and an unknown role group must not invent removal. Subsequent analytics remain separately versioned, use actual native settings, and preserve official-vs-derived authority, exact-week behavior, `clock-v1`, existing bye/missing policy and immutable baselines/snapshots.

The acceptance register FS01–FS22 specifies the required observations. It is not a set of passing runtime tests. See [reconciliation and implementation gates](reconciliation.md) for reuse, physical adoption dependencies, isolated SQL proof and later history/scale milestones.
